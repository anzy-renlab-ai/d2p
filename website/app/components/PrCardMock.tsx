'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, GitMerge, X } from 'lucide-react';

export function PrCardMock() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      {/* Commit chip preview */}
      <div className="rounded-2xl bg-cream p-6 ring-1 ring-warmline/60">
        <div className="flex items-center gap-2 border-b border-warmline pb-4">
          <span className="h-2 w-2 rounded-full bg-forest" aria-hidden="true" />
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
            commit → main
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted">d2p · auto-fix</span>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-15%' }}
          transition={{ duration: 0.4 }}
          className="mt-4 flex items-center gap-3 rounded-xl bg-paper px-4 py-3 ring-1 ring-warmline"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-forest/15 text-forest">
            <GitMerge size={14} strokeWidth={2} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[12px] text-ink">
              4b58841 · merged → main
            </div>
            <div className="font-mono text-[10px] text-muted truncate">
              fix/readme-minimal-incomplete · attempt 3
            </div>
          </div>
        </motion.div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-coralsoft px-3 py-1.5 font-mono text-[12px] text-coral ring-1 ring-coral/20 transition-colors hover:bg-coral hover:text-cream"
        >
          PR #6 opened on GitHub
          <ExternalLink size={12} aria-hidden="true" />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="GitHub PR #6 preview"
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl bg-white shadow-2xl ring-1 ring-black/10"
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="absolute right-3 top-3 rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
                aria-label="Close"
              >
                <X size={16} aria-hidden="true" />
              </button>

              {/* Mimic GitHub PR header */}
              <header className="border-b border-gray-200 px-6 py-5">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span>anzy-renlab-ai / agent-game-platform</span>
                </div>
                <h3 className="mt-1 text-xl text-gray-900">
                  fix: readme-minimal-incomplete{' '}
                  <span className="font-normal text-gray-500">#6</span>
                </h3>
                <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#8957e5] px-3 py-1 text-xs font-medium text-white">
                  <GitMerge size={12} aria-hidden="true" />
                  Merged
                </div>
              </header>

              <div className="px-6 py-5 font-mono text-[12.5px] leading-relaxed text-gray-800">
                <div className="rounded border border-gray-200 bg-gray-50 p-4">
                  <div className="text-gray-500"># Gap meta</div>
                  <div>
                    slug:{' '}
                    <span className="text-gray-900">readme-minimal-incomplete</span>
                  </div>
                  <div>
                    severity: <span className="text-amber-700">medium</span>
                  </div>
                  <div>
                    attempts: <span className="text-gray-900">3</span>
                  </div>
                  <div>commit: 4b58841</div>
                </div>

                <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4">
                  <div className="text-gray-500"># Reviewer scores</div>
                  <div>
                    static_gate: <span className="text-green-700">PASS</span>
                  </div>
                  <div>
                    alignment: <span className="text-green-700">8.2 / 10</span>
                  </div>
                  <div>
                    behavioral: <span className="text-green-700">APPROVE</span>
                  </div>
                  <div>
                    adversarial: <span className="text-gray-500">SKIPPED</span>
                  </div>
                </div>

                <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4">
                  <div className="text-gray-500"># NEED_HUMAN (24)</div>
                  <div>auth-csrf-protection · ALIGNMENT_LOW</div>
                  <div>auth-password-recovery · BUGGY</div>
                  <div>db-backup-path · INCOMPLETE</div>
                  <div>ci-pipeline-missing · STATIC_GATE</div>
                  <div className="text-gray-500">… 20 more</div>
                </div>

                <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4">
                  <div className="text-gray-500"># Cost footer</div>
                  <div>
                    duration: <span className="text-gray-900">1h 31min</span>
                  </div>
                  <div>
                    cost: <span className="text-gray-900">$4.24</span>
                  </div>
                  <div>tokens: 454,674 in / 237,787 out</div>
                </div>

                <a
                  href="https://github.com/anzy-renlab-ai/agent-game-platform/pull/6"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex items-center gap-2 text-sm text-[#0969da] hover:underline"
                >
                  Open on GitHub
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
