import { useState } from 'react';
import { useStore } from '../store.js';
import { Button } from '../components/Button.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { ProjectsHome } from '../components/ProjectsHome.js';
import type { ProjectSummary } from '../mock/projects.js';

export function Landing() {
  const startSession = useStore((s) => s.startSession);
  const startDemo = useStore((s) => s.startMultiTurnDemo);
  const setSelectedProjectId = useStore((s) => s.setSelectedProjectId);
  const healthError = useStore((s) => s.healthError);
  const health = useStore((s) => s.health);
  const [showAdd, setShowAdd] = useState(false);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open a project → drill into its Workspace. The store routes by
  // selectedProjectId; real wire-in will populate session state for that
  // project once daemon tracks multiple projects.
  const onOpenProject = (p: ProjectSummary) => {
    setSelectedProjectId(p.id);
  };

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
    <>
      <ProjectsHome
        onOpenProject={onOpenProject}
        onAddProject={() => setShowAdd(true)}
        onDemoMode={() => startDemo()}
      />

      {(healthError || (health && !health.claudeCli.found)) && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 max-w-2xl w-full px-4 z-30 anim-drift-in">
          {healthError && (
            <ErrorBanner
              message={
                <>
                  连不上 daemon（{healthError}）。
                  先在终端跑{' '}
                  <code className="bg-coralsoft px-1.5 py-0.5 rounded">d2p start</code>{' '}
                  或{' '}
                  <code className="bg-coralsoft px-1.5 py-0.5 rounded">npm run dev</code>。
                </>
              }
            />
          )}
          {health && !health.claudeCli.found && (
            <ErrorBanner
              message={
                <>
                  没找到 <code>claude</code> CLI。装 Claude Code 并 <code>claude login</code>，
                  或在 <strong>设置</strong> 里换成 OpenAI-compat / Anthropic-API。
                </>
              }
            />
          )}
        </div>
      )}

      {showAdd && (
        <div
          className="fixed inset-0 bg-ink/40 flex items-center justify-center z-50 anim-drift-in"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="bg-cream rounded-2xl shadow-cardHover max-w-lg w-full p-6 space-y-4 mx-4 anim-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xl font-medium text-ink">新建项目</div>
            <p className="text-sm text-muted">
              给个本地文件夹路径，d2p 自动 init git、识别项目类型、问你 vision，然后接手。
            </p>
            <div>
              <label className="label">Demo 文件夹（绝对路径）</label>
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder={navigator.platform.startsWith('Win') ? 'D:\\demos\\my-saas' : '/Users/me/demos/my-saas'}
                className="input input-mono text-base py-3"
                spellCheck={false}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onStart();
                }}
              />
            </div>
            {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 text-sm text-muted hover:text-ink transition-colors font-sans"
              >
                取消
              </button>
              <Button
                onClick={() => void onStart()}
                disabled={!health}
                loading={busy}
                loadingText="新建 session 中…"
              >
                开始 →
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
