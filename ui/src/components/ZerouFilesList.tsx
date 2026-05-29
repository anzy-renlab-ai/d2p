import { useState } from 'react';
import type { ReviewFile } from '../types-zerou.js';

const STATUS_PILL: Record<ReviewFile['status'], { label: string; cls: string }> = {
  added:    { label: 'A', cls: 'bg-sage-50 text-sage-600' },
  modified: { label: 'M', cls: 'bg-coralsoft text-coral' },
  deleted:  { label: 'D', cls: 'bg-rust/10 text-rust' },
  renamed:  { label: 'R', cls: 'bg-amber-50 text-amber-600' },
};

const MODULE_TINT: Record<string, string> = {
  logging:    'bg-slate-50 text-slate-600',
  'bug-patch':'bg-coralsoft text-coral',
  health:     'bg-sage-50 text-sage-600',
  sentry:     'bg-plum-50 text-plum-600',
  env:        'bg-amber-50 text-amber-600',
  verify:     'bg-warmline/60 text-muted',
};

export function ZerouFilesList({ files }: { files: ReviewFile[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const current = files.find((f) => f.path === open) ?? null;

  if (files.length === 0) {
    return (
      <div className="card p-6 text-sm text-muted font-mono" data-testid="zerou-files-list">
        No files changed.
      </div>
    );
  }

  return (
    <section className="card overflow-hidden" data-testid="zerou-files-list">
      <div className="card-header flex items-center justify-between">
        <span>Files</span>
        <span className="text-xs font-sans text-muted">{files.length}</span>
      </div>
      <ul className="divide-y divide-warmline">
        {files.map((f) => {
          const pill = STATUS_PILL[f.status];
          return (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => setOpen(f.path)}
                className="w-full text-left px-4 py-2.5 hover:bg-paper transition-colors flex items-start gap-2.5"
                data-testid={`zerou-file-row-${f.path.replace(/[\\/.]/g, '-')}`}
              >
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold flex-shrink-0 ${pill.cls}`}
                  aria-label={f.status}
                >
                  {pill.label}
                </span>
                <span className="flex-1 min-w-0">
                  <div className="text-sm text-ink font-mono truncate" title={f.path}>
                    {f.path}
                  </div>
                  <div className="text-[10px] text-muted/70 font-mono mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>
                      <span className="text-forest">+{f.additions}</span>{' '}
                      <span className="text-rust">-{f.deletions}</span>
                    </span>
                    <span className="text-muted/30">·</span>
                    {f.modules.map((mid) => (
                      <span
                        key={mid}
                        className={`px-1.5 rounded text-[10px] font-sans ${MODULE_TINT[mid] ?? 'bg-warmline/40 text-muted'}`}
                      >
                        {mid}
                      </span>
                    ))}
                  </div>
                </span>
                <span className="text-xs text-muted/60 flex-shrink-0" aria-hidden="true">›</span>
              </button>
            </li>
          );
        })}
      </ul>

      {current && <FileDiffDrawer file={current} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** Lightweight diff drawer that renders raw unifiedDiff. Sibling to
 *  CommitDiffDrawer (which expects parsed hunks) — ZeroU's bundle ships raw
 *  unified diff text so this avoids re-parsing in the UI.
 */
function FileDiffDrawer({ file, onClose }: { file: ReviewFile; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex anim-drift-in"
      onClick={onClose}
      data-testid="zerou-file-drawer"
    >
      <div className="flex-1 bg-ink/30" />
      <div
        className="bg-paper border-l border-warmline w-[780px] max-w-[90vw] flex flex-col shadow-xl anim-drawer-right"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-warmline bg-cream flex-shrink-0">
          <span className="font-mono text-xs text-coral uppercase tracking-wider">{file.status}</span>
          <span className="text-sm text-ink font-medium flex-1 truncate font-mono" title={file.path}>
            {file.path}
          </span>
          <span className="text-[11px] font-mono text-muted">
            <span className="text-forest">+{file.additions}</span>{' '}
            <span className="text-rust">-{file.deletions}</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted hover:text-ink transition-colors ml-2 px-2 py-1 rounded hover:bg-paper"
            aria-label="close diff"
          >
            收起 ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {file.omittedReason ? (
            <div className="bg-cream rounded-lg px-4 py-6 text-xs text-muted/70 text-center italic">
              diff omitted: {file.omittedReason}
            </div>
          ) : file.unifiedDiff.trim().length === 0 ? (
            <div className="text-xs text-muted/60 italic">empty diff</div>
          ) : (
            <pre className="bg-cream border border-warmline rounded-md p-3 text-[11px] font-mono whitespace-pre overflow-x-auto leading-relaxed">
              {file.unifiedDiff.split('\n').map((line, i) => {
                const cls = line.startsWith('+')
                  ? 'text-sage-600 bg-sage-50/40'
                  : line.startsWith('-')
                  ? 'text-rust bg-rust/10'
                  : line.startsWith('@@')
                  ? 'text-coral'
                  : 'text-muted/80';
                return (
                  <div key={i} className={`block px-2 ${cls}`}>
                    {line || ' '}
                  </div>
                );
              })}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
