import { Hono } from 'hono';
import { queries } from './session.js';
import { loadConfig } from '../config/load.js';
import { GitHubClient, parseGitHubRemote } from '../github/client.js';
import { readOriginUrl } from '../git/push.js';

export const githubRoutes = new Hono();

// Configure the current session for GitHub PR mode.
githubRoutes.post('/configure-session', async (c) => {
  const session = queries.getCurrentActiveSession();
  if (!session) {
    return c.json({ type: 'about:blank', title: 'no active session', status: 409, code: 'INVALID_STATE' }, 409);
  }
  const demo = queries.getDemo(session.demoId);
  if (!demo) {
    return c.json({ type: 'about:blank', title: 'demo missing', status: 500, code: 'INTERNAL' }, 500);
  }
  let body: { repo?: string; baseBranch?: string };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ type: 'about:blank', title: 'bad json', status: 400, code: 'BAD_REQUEST' }, 400);
  }
  let repoSpec = body.repo;
  if (!repoSpec) {
    const origin = await readOriginUrl(demo.path as unknown as string);
    const parsed = origin ? parseGitHubRemote(origin) : null;
    if (!parsed) {
      return c.json(
        {
          type: 'about:blank',
          title: 'cannot infer repo',
          status: 400,
          code: 'BAD_REQUEST',
          detail: 'demo origin is not a GitHub URL; pass `repo` explicitly',
        },
        400,
      );
    }
    repoSpec = `${parsed.owner}/${parsed.repo}`;
  }
  const base = body.baseBranch ?? 'main';
  queries.setSessionMode(session.id, 'github-pr', repoSpec, base);
  return c.json({ ok: true, repo: repoSpec, baseBranch: base, mode: 'github-pr' });
});

// Verify the configured PAT works by hitting /user.
githubRoutes.get('/verify', async (c) => {
  const cfg = await loadConfig();
  if (!cfg.github?.token) return c.json({ ok: false, error: 'no github token in config' }, 400);
  const gh = new GitHubClient(cfg.github.token);
  const v = await gh.verifyToken();
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);
  return c.json({ ok: true, login: v.login });
});

// Quick repo metadata fetch (for UI to pre-fill default branch).
githubRoutes.get('/repo', async (c) => {
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  if (!owner || !repo) {
    return c.json({ type: 'about:blank', title: 'owner+repo required', status: 400, code: 'BAD_REQUEST' }, 400);
  }
  const cfg = await loadConfig();
  if (!cfg.github?.token) return c.json({ error: 'no github token' }, 400);
  const gh = new GitHubClient(cfg.github.token);
  const r = await gh.getRepo(owner, repo);
  if ('error' in r) return c.json({ error: r.error }, 400);
  return c.json({ defaultBranch: r.defaultBranch });
});
