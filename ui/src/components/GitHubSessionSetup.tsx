import { useState } from 'react';
import { Button } from './Button.js';
import { ErrorBanner } from './ErrorBanner.js';
import { useStore } from '../store.js';

export function GitHubSessionSetup() {
  const session = useStore((s) => s.session);
  const refresh = useStore((s) => s.refreshAll);
  const [open, setOpen] = useState(false);
  const [repo, setRepo] = useState('');
  const [base, setBase] = useState('main');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return null;
  const isPRMode = session.mode === 'github-pr';

  async function activate() {
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = { baseBranch: base };
      if (repo.trim()) body.repo = repo.trim();
      const res = await fetch('/api/github/configure-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (isPRMode) {
    return (
      <div className="bg-coralsoft/30 border border-coral/30 rounded-md p-3 text-sm">
        ✓ 当前 session 是 <strong>GitHub PR 模式</strong>：
        repo <code className="bg-cream px-1 rounded">{session.githubRepo ?? '(自动从 origin 检测)'}</code>,
        base <code className="bg-cream px-1 rounded">{session.baseBranch}</code>。
        <div className="mt-1 text-xs text-muted">
          每个 fix 会自动 push 到 origin 并开 PR，但不自动 merge（你在 GitHub 上点 merge）。
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        切到 GitHub PR 模式（可选）
      </Button>
    );
  }

  return (
    <div className="border border-warmline rounded-md p-3 bg-paper space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">GitHub PR 模式</span>
        <button className="text-xs text-muted hover:text-ink" onClick={() => setOpen(false)}>
          取消
        </button>
      </div>
      <div className="text-xs text-muted leading-relaxed">
        d2p 会用你在 Settings 里填的 GitHub token，把 fix 分支 push 到 origin 并开 PR。
        不填 repo 就从仓库的 origin URL 自动推断。
      </div>
      <div>
        <label className="label">仓库（owner/repo，留空自动推断）</label>
        <input
          type="text"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          placeholder="Upp-Ljl/my-demo"
          className="input input-mono"
        />
      </div>
      <div>
        <label className="label">base branch</label>
        <input
          type="text"
          value={base}
          onChange={(e) => setBase(e.target.value)}
          className="input input-mono"
        />
      </div>
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <div className="flex justify-end">
        <Button onClick={() => void activate()} disabled={busy}>
          {busy ? '配置中…' : '激活 PR 模式'}
        </Button>
      </div>
    </div>
  );
}
