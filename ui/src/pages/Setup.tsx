import { useEffect, useState } from 'react';
import { useStore } from '../store.js';
import { Button } from '../components/Button.js';
import { ErrorBanner } from '../components/ErrorBanner.js';
import { InputsEditor } from '../components/InputsEditor.js';
import { PresetOverrideEditor } from '../components/PresetOverrideEditor.js';
import type { ProjectType } from '../types.js';

const PROJECT_TYPES: ProjectType[] = [
  'saas-web',
  'api-service',
  'cli-tool',
  'library',
  'static-site',
  'mobile',
  'desktop-app',
  'ml-script',
  'unknown',
];

export function Setup() {
  const session = useStore((s) => s.session);
  const demo = useStore((s) => s.demo);
  const detector = useStore((s) => s.detector);
  const detectorError = useStore((s) => s.detectorError);
  const runDetector = useStore((s) => s.runDetector);
  const choosePreset = useStore((s) => s.choosePreset);
  const visionRound = useStore((s) => s.visionRound);
  const visionAnswers = useStore((s) => s.visionAnswers);
  const visionError = useStore((s) => s.visionError);
  const loadVisionRound = useStore((s) => s.loadVisionRound);
  const setVisionAnswer = useStore((s) => s.setVisionAnswer);
  const submitVisionAnswers = useStore((s) => s.submitVisionAnswers);
  const finalizeVision = useStore((s) => s.finalizeVision);
  const startLoop = useStore((s) => s.startLoop);
  const endSession = useStore((s) => s.endSession);

  const [typeOverride, setTypeOverride] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!detector && !detectorError) void runDetector();
  }, [detector, detectorError, runDetector]);

  useEffect(() => {
    if (session?.presetType && !session.visionMdPath && !visionRound) {
      void loadVisionRound();
    }
  }, [session?.presetType, session?.visionMdPath, visionRound, loadVisionRound]);

  const typeChosen = !!session?.presetType;
  const visionFinalized = !!session?.visionMdPath;
  const readyToStart = typeChosen && visionFinalized;

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-3xl mx-auto py-10 px-6 space-y-6">
        <header className="flex items-end justify-between pb-6 border-b border-warmline">
          <div>
            <h1 className="text-3xl tracking-tight">d2p</h1>
            <p className="font-mono text-xs text-muted mt-1 break-all">{demo?.path}</p>
          </div>
          <Button variant="ghost" onClick={() => void endSession()}>结束会话</Button>
        </header>

        {/* Step 1 */}
        <section className="card">
          <div className="card-header">Step 1 — 项目类型</div>
          <div className="p-5 space-y-3">
            {detectorError && <ErrorBanner message={`Detector 失败：${detectorError}`} />}
            {!detector && !detectorError && <div className="text-muted text-sm italic font-serif">扫仓库中…</div>}
            {detector && (
              <>
                <div className="text-sm">
                  <span className="font-mono bg-paper border border-warmline px-2 py-0.5 rounded mr-2">
                    {typeOverride ?? detector.type}
                  </span>
                  <span className="text-muted">confidence {(detector.confidence ?? 0).toFixed(2)}</span>
                </div>
                <ul className="text-xs text-muted list-disc pl-5">
                  {detector.evidence.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
                <div className="flex items-center gap-2">
                  <select
                    value={typeOverride ?? detector.type}
                    onChange={(e) => setTypeOverride(e.target.value)}
                    className="text-sm border border-warmline rounded px-2 py-1.5"
                    disabled={typeChosen}
                  >
                    {PROJECT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  {!typeChosen ? (
                    <Button
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await choosePreset(typeOverride ?? detector.type);
                        } finally {
                          setBusy(false);
                        }
                      }}
                      disabled={busy}
                    >
                      确认
                    </Button>
                  ) : (
                    <span className="text-forest text-sm">✓ {session?.presetType}</span>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        {/* Step 2 */}
        <section className={`card ${!typeChosen ? 'opacity-50' : ''}`}>
          <div className="card-header flex items-center justify-between">
            <span>
              Step 2 — Vision 收集
              {visionRound?.roundIndex && (
                <span className="text-muted text-sm font-sans font-normal ml-2">Round {visionRound.roundIndex}/5</span>
              )}
            </span>
            {!visionFinalized && typeChosen && (
              <Button variant="ghost" onClick={() => void finalizeVision()}>
                跳过剩余轮次直接定稿
              </Button>
            )}
          </div>
          <div className="p-5 space-y-3">
            {!typeChosen && <div className="text-muted text-sm italic font-serif">先选项目类型</div>}
            {typeChosen && visionError && <ErrorBanner message={visionError} />}
            {typeChosen && !visionRound && !visionFinalized && (
              <div className="text-muted text-sm italic font-serif">加载提问…</div>
            )}
            {typeChosen && visionFinalized && (
              <div className="text-sm space-y-2">
                <div className="text-forest">✓ vision 已定稿</div>
                {visionRound?.visionMd && (
                  <pre className="bg-paper border border-warmline p-3 rounded text-xs whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {visionRound.visionMd}
                  </pre>
                )}
              </div>
            )}
            {typeChosen && visionRound && !visionRound.done && visionRound.questions && (
              <div className="space-y-4">
                {visionRound.questions.map((q) => (
                  <div key={q.id} className="border-b border-warmline last:border-0 pb-4">
                    <div className="font-medium mb-2 text-sm">{q.question}</div>
                    <div className="space-y-2">
                      {q.options.map((opt, i) => (
                        <label key={i} className="flex items-start gap-2.5 text-sm cursor-pointer rounded hover:bg-paper px-2 py-1.5 -mx-2">
                          <input
                            type="radio"
                            name={q.id}
                            checked={visionAnswers[q.id] === opt.label}
                            onChange={() => setVisionAnswer(q.id, opt.label)}
                            className="mt-1 accent-coral"
                          />
                          <div>
                            <div className="text-ink">{opt.label}</div>
                            <div className="text-xs text-muted">{opt.description}</div>
                          </div>
                        </label>
                      ))}
                      <label className="flex items-center gap-2 text-sm mt-2 px-2 py-1">
                        <input
                          type="radio"
                          name={q.id}
                          checked={visionAnswers[q.id]?.startsWith('其他: ') ?? false}
                          onChange={() => setVisionAnswer(q.id, '其他: ')}
                          className="accent-coral"
                        />
                        <span className="text-muted">其他：</span>
                        <input
                          type="text"
                          value={visionAnswers[q.id]?.startsWith('其他: ') ? visionAnswers[q.id]!.slice(4) : ''}
                          onChange={(e) => setVisionAnswer(q.id, '其他: ' + e.target.value)}
                          className="flex-1 input"
                        />
                      </label>
                    </div>
                  </div>
                ))}
                <div className="flex justify-end">
                  <Button onClick={() => void submitVisionAnswers()}>提交回答</Button>
                </div>
              </div>
            )}
          </div>
        </section>

        {typeChosen && !visionFinalized && (
          <section className="card">
            <div className="card-header">附加材料 <span className="text-xs text-muted ml-2 font-sans">可选</span></div>
            <div className="p-5">
              <InputsEditor />
            </div>
          </section>
        )}

        {typeChosen && (
          <section className="card">
            <div className="card-header">自定义验收清单 <span className="text-xs text-muted ml-2 font-sans">可选</span></div>
            <div className="p-5">
              <PresetOverrideEditor />
            </div>
          </section>
        )}

        {/* Step 3 */}
        <section className={`card ${!readyToStart ? 'opacity-50' : ''}`}>
          <div className="card-header">Step 3 — 启动主循环</div>
          <div className="p-5 flex items-center justify-between">
            <div className="text-sm text-muted">
              {readyToStart
                ? '一切就绪。点 Start 让 agent 开始干活。'
                : '完成 Step 1 + Step 2 后解锁。'}
            </div>
            <Button onClick={() => void startLoop()} disabled={!readyToStart}>
              Start loop →
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
