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
    <div className="min-h-screen bg-paper">
      <div className="max-w-2xl mx-auto pt-20 px-6">
        <header className="mb-12">
          <h1 className="text-5xl tracking-tight text-ink">d2p</h1>
          <p className="text-lg text-muted mt-3 font-serif italic">
            把 demo 推到 product。
          </p>
          <p className="text-sm text-muted mt-2 leading-relaxed">
            你给一个本地 demo + 一句愿景。
            d2p 派 Claude 自动迭代，4 层 reviewer 把关，
            preset 与 vision 双绿才停手。
          </p>
        </header>

        {healthError && (
          <div className="mb-6">
            <ErrorBanner
              message={
                <>
                  连不上 daemon（{healthError}）。
                  先在终端跑 <code className="bg-coralsoft px-1.5 py-0.5 rounded">d2p start</code> 或{' '}
                  <code className="bg-coralsoft px-1.5 py-0.5 rounded">npm run dev</code>。
                </>
              }
            />
          </div>
        )}

        {health && !health.claudeCli.found && (
          <div className="mb-6">
            <ErrorBanner
              message={
                <>
                  没找到 <code>claude</code> CLI。装 Claude Code 并 <code>claude login</code>，
                  或在 <strong>设置</strong> 里换成 OpenAI-compat / Anthropic-API。
                </>
              }
            />
          </div>
        )}

        <section className="card p-6 space-y-4">
          <div>
            <label className="label">Demo 文件夹（绝对路径）</label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={navigator.platform.startsWith('Win') ? 'D:\\demos\\my-saas' : '/Users/me/demos/my-saas'}
              className="input input-mono text-base py-3"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onStart();
              }}
            />
          </div>
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-muted leading-relaxed max-w-xs">
              没 <code>.git</code> 自动 init，worktree 放在父目录的
              <code> .d2p-worktrees/</code>，不污染你的仓库。
            </p>
            <Button
              onClick={() => void onStart()}
              disabled={!health}
              loading={busy}
              loadingText="新建 session 中…"
            >
              Start session →
            </Button>
          </div>
        </section>

        <div className="mt-12 text-xs text-muted/70 text-center font-serif italic">
          demo → product · made for hands-off iteration
        </div>
      </div>
    </div>
  );
}
