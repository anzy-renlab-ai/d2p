import { useState } from 'react';
import { useStore } from '../store.js';
import { Button } from '../components/Button.js';
import { ErrorBanner } from '../components/ErrorBanner.js';

export function Landing() {
  const startSession = useStore((s) => s.startSession);
  const healthError = useStore((s) => s.healthError);
  const health = useStore((s) => s.health);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onStart() {
    setError(null);
    if (!path.trim()) {
      setError('请填一个绝对路径');
      return;
    }
    setBusy(true);
    try {
      await startSession(path.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto py-12 px-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">d2p</h1>
        <p className="text-slate-600 text-sm">把 demo 推到 product。</p>
      </div>

      {healthError && (
        <ErrorBanner
          message={
            <>
              连不上 daemon（{healthError}）。
              <br />
              先在终端跑 <code className="bg-red-100 px-1 rounded">d2p start</code> 或{' '}
              <code className="bg-red-100 px-1 rounded">npm run dev</code>。
            </>
          }
        />
      )}

      {health && !health.claudeCli.found && (
        <ErrorBanner
          message={
            <>
              没找到 <code>claude</code> CLI。安装 Claude Code 并 <code>claude login</code> 后再来。
            </>
          }
        />
      )}

      <div className="bg-white rounded border p-4 space-y-3">
        <div>
          <label className="block text-sm font-medium mb-1">Demo 文件夹（绝对路径）</label>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder={navigator.platform.startsWith('Win') ? 'D:\\demos\\my-saas' : '/Users/me/demos/my-saas'}
            className="w-full px-3 py-2 border rounded text-sm font-mono"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void onStart();
            }}
          />
        </div>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <div className="flex justify-end">
          <Button onClick={() => void onStart()} disabled={busy || !health}>
            {busy ? '建中…' : 'Start session'}
          </Button>
        </div>
      </div>

      <div className="text-xs text-slate-500">
        d2p 会在该路径下 <code>git init</code>（若没有 <code>.git</code>），把 worktree
        放在<strong>父目录</strong>的 <code>.d2p-worktrees/</code>，不污染你的仓库。
      </div>
    </div>
  );
}
