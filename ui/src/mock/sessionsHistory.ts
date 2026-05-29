// Per-project sessions history — mocks ZeroU running multiple sessions on the
// same project over time. Real wire-in will read from daemon's sessions table
// (`SELECT * FROM sessions WHERE demo_id = ?`).

import type { ProjectStatus } from './projects.js';

export interface SessionSummary {
  id: number;
  projectId: number;
  status: ProjectStatus;
  startedAt: number;
  endedAt: number | null;
  /** Short note about why this session ran or what changed */
  title: string;
  /** Number of gaps the differ found in this run */
  gapsFound: number;
  gapsDone: number;
  gapsNeedHuman: number;
  /** Total commits merged during this session */
  commitCount: number;
  /** Highest commit risk band hit */
  topRisk: 'low' | 'mid' | 'high' | 'none';
  /** Estimated cost for this single session */
  costUsd: number;
  /** Total agent calls across all 6 roles */
  agentCalls: number;
}

const NOW = Date.now();
const m = (mins: number) => NOW - mins * 60_000;
const h = (hours: number) => NOW - hours * 60 * 60_000;
const d = (days: number) => NOW - days * 24 * 60 * 60_000;

// agent-game-platform sessions — 4 runs spread over recent days
export const mockSessionsByProject: Record<number, SessionSummary[]> = {
  8: [
    {
      id: 41,
      projectId: 8,
      status: 'looping',
      startedAt: m(45),
      endedAt: null,
      title: 'iter-2 §5 achievements + events + themes',
      gapsFound: 8,
      gapsDone: 5,
      gapsNeedHuman: 0,
      commitCount: 5,
      topRisk: 'mid',
      costUsd: 0.84,
      agentCalls: 38,
    },
    {
      id: 38,
      projectId: 8,
      status: 'done',
      startedAt: h(8),
      endedAt: h(2),
      title: 'iter-2 §1-4 lobby + watch + agents + social',
      gapsFound: 14,
      gapsDone: 14,
      gapsNeedHuman: 0,
      commitCount: 11,
      topRisk: 'high',
      costUsd: 1.42,
      agentCalls: 72,
    },
    {
      id: 31,
      projectId: 8,
      status: 'done',
      startedAt: d(2),
      endedAt: d(2),
      title: 'Mode A §3-5 social + agents + e2e tests',
      gapsFound: 9,
      gapsDone: 8,
      gapsNeedHuman: 1,
      commitCount: 7,
      topRisk: 'mid',
      costUsd: 0.58,
      agentCalls: 51,
    },
    {
      id: 22,
      projectId: 8,
      status: 'error',
      startedAt: d(4),
      endedAt: d(4),
      title: 'Mode A §1-2 lobby + watch — implementer NEED_HUMAN',
      gapsFound: 6,
      gapsDone: 4,
      gapsNeedHuman: 2,
      commitCount: 4,
      topRisk: 'high',
      costUsd: 0.31,
      agentCalls: 28,
    },
  ],

  7: [
    {
      id: 7,
      projectId: 7,
      status: 'looping',
      startedAt: m(45),
      endedAt: null,
      title: 'preset compliance pass — env / readme / health',
      gapsFound: 8,
      gapsDone: 2,
      gapsNeedHuman: 0,
      commitCount: 2,
      topRisk: 'mid',
      costUsd: 1.27,
      agentCalls: 22,
    },
  ],

  6: [
    {
      id: 6,
      projectId: 6,
      status: 'paused',
      startedAt: h(4),
      endedAt: null,
      title: 'parser --json flag + edge cases',
      gapsFound: 6,
      gapsDone: 4,
      gapsNeedHuman: 0,
      commitCount: 4,
      topRisk: 'low',
      costUsd: 0.54,
      agentCalls: 19,
    },
  ],

  5: [
    {
      id: 5,
      projectId: 5,
      status: 'done',
      startedAt: d(2),
      endedAt: d(2),
      title: 'final ship — RSS + analytics + a11y',
      gapsFound: 12,
      gapsDone: 12,
      gapsNeedHuman: 0,
      commitCount: 9,
      topRisk: 'mid',
      costUsd: 3.18,
      agentCalls: 87,
    },
  ],

  4: [
    {
      id: 4,
      projectId: 4,
      status: 'error',
      startedAt: h(8),
      endedAt: null,
      title: 'auth flow — implementer stuck at attempt 4 (NEED_HUMAN)',
      gapsFound: 12,
      gapsDone: 3,
      gapsNeedHuman: 4,
      commitCount: 2,
      topRisk: 'high',
      costUsd: 0.81,
      agentCalls: 31,
    },
  ],

  3: [
    {
      id: 3,
      projectId: 3,
      status: 'idle',
      startedAt: d(5),
      endedAt: d(5),
      title: 'coverage + docs pass',
      gapsFound: 5,
      gapsDone: 5,
      gapsNeedHuman: 0,
      commitCount: 5,
      topRisk: 'low',
      costUsd: 0.93,
      agentCalls: 34,
    },
  ],
};

export function sessionsForProject(projectId: number): SessionSummary[] {
  return mockSessionsByProject[projectId] ?? [];
}
