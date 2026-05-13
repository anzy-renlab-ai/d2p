// Minimal GitHub REST client. No `gh` CLI dependency — raw fetch.
// Token is sent as `Authorization: token <pat>`. NEVER logged.

export interface ParsedRepo {
  owner: string;
  repo: string;
}

export interface OpenPRInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string; // branch name; for fork add "user:branch"
  base: string;
}

export interface PRResult {
  number: number;
  htmlUrl: string;
  apiUrl: string;
  state: string;
}

/** Parse "https://github.com/USER/REPO(.git)" or "git@github.com:USER/REPO.git". */
export function parseGitHubRemote(remoteUrl: string): ParsedRepo | null {
  let m = /^https:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(remoteUrl.trim());
  if (m && m[1] && m[2]) return { owner: m[1], repo: m[2] };
  m = /^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(remoteUrl.trim());
  if (m && m[1] && m[2]) return { owner: m[1], repo: m[2] };
  return null;
}

export class GitHubClient {
  constructor(
    private readonly token: string,
    private readonly baseUrl: string = 'https://api.github.com',
  ) {}

  private headers(): Record<string, string> {
    return {
      authorization: `token ${this.token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'd2p',
    };
  }

  async getRepo(owner: string, repo: string): Promise<{ defaultBranch: string } | { error: string }> {
    const res = await fetch(`${this.baseUrl}/repos/${owner}/${repo}`, { headers: this.headers() });
    if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const j = (await res.json()) as { default_branch?: string };
    return { defaultBranch: j.default_branch ?? 'main' };
  }

  async openPR(input: OpenPRInput): Promise<PRResult | { error: string }> {
    const res = await fetch(`${this.baseUrl}/repos/${input.owner}/${input.repo}/pulls`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        body: input.body,
        head: input.head,
        base: input.base,
      }),
    });
    const raw = await res.text();
    if (!res.ok) return { error: `HTTP ${res.status}: ${raw.slice(0, 300)}` };
    const j = JSON.parse(raw) as { number?: number; html_url?: string; url?: string; state?: string };
    if (typeof j.number !== 'number' || !j.html_url || !j.url) {
      return { error: 'PR response missing fields' };
    }
    return { number: j.number, htmlUrl: j.html_url, apiUrl: j.url, state: j.state ?? 'open' };
  }

  /** GET viewer (verifies token works). */
  async verifyToken(): Promise<{ ok: true; login: string } | { ok: false; error: string }> {
    const res = await fetch(`${this.baseUrl}/user`, { headers: this.headers() });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const j = (await res.json()) as { login?: string };
    if (!j.login) return { ok: false, error: 'no login in response' };
    return { ok: true, login: j.login };
  }
}
