import { create } from 'zustand';
import type {
  CurrentSessionRes,
  Demo,
  DetectorOutput,
  Gap,
  HealthResponse,
  MultiTurnState,
  PresetStatusItem,
  Session,
  SseEnvelope,
  VisionRoundRes,
  CostTotals,
  LoopState,
} from './types.js';
import { api, openLogStream, openCcStream } from './api.js';
import type { MultiTurnTurn, MultiTurnPhase, ScratchpadNote } from './types.js';
import { mockStoreFor } from './mock/data.js';
import { startMockMultiTurnStream, mockMultiTurnIdle } from './mock/multiTurn.js';

interface Store {
  // health
  health: HealthResponse | null;
  healthError: string | null;

  // session
  session: Session | null;
  demo: Demo | null;
  presetStatus: PresetStatusItem[];
  costTotals: CostTotals;

  // loop
  loopState: LoopState | null;

  // setup flow
  detector: DetectorOutput | null;
  detectorError: string | null;
  presetMd: string | null;
  visionRound: VisionRoundRes | null;
  visionAnswers: Record<string, string>;
  visionError: string | null;

  // workspace
  gaps: Gap[];
  events: SseEnvelope[];
  sseConnected: boolean;

  // multi-turn (complex gap autonomous run)
  multiTurn: MultiTurnState | null;
  multiTurnDemoMode: boolean;
  setMultiTurn: (s: MultiTurnState | null) => void;
  openMultiTurnStream: (meta: {
    runId?: string;
    gapId?: number;
    gapTitle?: string;
    gapSlug?: string;
  }) => void;
  closeMultiTurnStream: (reason: string | null) => void;
  /** Demo only — drives multiTurn with mock data, no daemon/SSE.
   *  For showing the user what multi-turn looks like in production UI
   *  before any real complex gap has fired. */
  startMultiTurnDemo: () => void;
  stopMultiTurnDemo: () => void;
  /** Within an active demo, start the multi-turn mock stream. Lets the
   *  user see the multi-turn fullscreen view on demand instead of being
   *  thrown into it. */
  startMultiTurnDemoStream: () => void;

  // end
  summaryMdPath: string | null;

  // ui chrome
  showSettings: boolean;
  setShowSettings: (b: boolean) => void;
  /** Set when the user clicks a project on ProjectsHome → enter Workspace.
   *  null means stay on ProjectsHome (default home for multi-project users). */
  selectedProjectId: number | null;
  setSelectedProjectId: (id: number | null) => void;

  // actions
  refreshHealth: () => Promise<void>;
  refreshSession: () => Promise<void>;
  refreshGaps: () => Promise<void>;
  refreshLoopState: () => Promise<void>;
  refreshAll: () => Promise<void>;
  pushEvent: (e: SseEnvelope) => void;
  setSseConnected: (b: boolean) => void;
  startSession: (demoPath: string) => Promise<void>;
  runDetector: () => Promise<void>;
  choosePreset: (type: string) => Promise<void>;
  loadVisionRound: () => Promise<void>;
  submitVisionAnswers: () => Promise<void>;
  setVisionAnswer: (qId: string, val: string) => void;
  finalizeVision: () => Promise<void>;
  startLoop: () => Promise<void>;
  pauseLoop: () => Promise<void>;
  resumeLoop: () => Promise<void>;
  skipGap: (id: number) => Promise<void>;
  endSession: () => Promise<void>;
  clearError: () => void;
}

const emptyCost: CostTotals = { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 };

const demoStopHandle: { fn: () => void } = { fn: () => undefined };

// Manages the lifecycle of the cc-stream EventSource for the active complex
// gap. Singleton (only one fix can run at a time).
const multiTurnStream = {
  close: () => {
    /* replaced when start() runs */
  },
  start(runId: string, runStartedAt: number) {
    const close = openCcStream(runId, (snap) => {
      const cur = useStore.getState().multiTurn;
      if (!cur || cur.runId !== runId) return; // stale snapshot — already moved on

      // Merge scratchpad (server-authoritative)
      const scratchpad: ScratchpadNote[] = snap.scratchpad.map((n) => ({
        turn: n.turn,
        ts: n.ts,
        text: n.text,
      }));

      // Build turns timeline from cc_turn_events: one entry per unique
      // turn_idx seen. Status:
      //   - latest turn = 'running' if no later turn yet
      //   - earlier turns = 'done'
      const turnIdxs = new Set<number>();
      let lastAssistantText = cur.lastAssistantText;
      let lastTurnIdx = cur.currentTurn;
      for (const ev of snap.newEvents) {
        turnIdxs.add(ev.turnIdx);
        if (ev.turnIdx > lastTurnIdx) lastTurnIdx = ev.turnIdx;
        const p = ev.payload as { last_assistant_message?: string } | null;
        if (p && typeof p.last_assistant_message === 'string') {
          lastAssistantText = p.last_assistant_message;
        }
      }
      // Always derive from full scratchpad too (so we don't lose history
      // on reconnect)
      for (const n of scratchpad) turnIdxs.add(n.turn);

      const sorted = Array.from(turnIdxs).sort((a, b) => a - b);
      const turns: MultiTurnTurn[] = sorted.map((idx) => {
        const note = scratchpad.find((n) => n.turn === idx);
        const isLast = idx === sorted[sorted.length - 1];
        return {
          index: idx,
          title: note ? note.text.slice(0, 60) : `turn ${idx}`,
          summary: note ? note.text : '…',
          status: isLast ? 'running' : 'done',
          ts: note?.ts ?? Date.now(),
        };
      });

      useStore.setState({
        multiTurn: {
          ...cur,
          currentTurn: lastTurnIdx,
          ccSessionId: snap.ccSessionId,
          elapsedMs: Date.now() - runStartedAt,
          lastAssistantText,
          scratchpad,
          turns,
        },
      });
    });
    multiTurnStream.close = close;
  },
};

export const useStore = create<Store>((set, get) => ({
  health: null,
  healthError: null,
  session: null,
  demo: null,
  presetStatus: [],
  costTotals: emptyCost,
  loopState: null,
  detector: null,
  detectorError: null,
  presetMd: null,
  visionRound: null,
  visionAnswers: {},
  visionError: null,
  gaps: [],
  events: [],
  sseConnected: false,
  multiTurn: null,
  multiTurnDemoMode: false,
  setMultiTurn: (s) => set({ multiTurn: s }),
  openMultiTurnStream(meta) {
    // Close any prior stream first.
    multiTurnStream.close();
    if (!meta.runId) return;
    const runId = meta.runId;
    const start = Date.now();
    set({
      multiTurn: {
        runId,
        gapId: meta.gapId ?? 0,
        gapTitle: meta.gapTitle ?? '',
        gapSlug: meta.gapSlug ?? '',
        complexity: 'complex',
        phase: 'running',
        currentTurn: 0,
        maxTurns: 12,
        ccSessionId: null,
        elapsedMs: 0,
        capMs: 6 * 60 * 60 * 1000,
        tokensIn: 0,
        tokensOut: 0,
        estimatedUsd: 0,
        lastAssistantText: '',
        scratchpad: [],
        turns: [],
        selfReportedComplete: false,
      },
    });
    multiTurnStream.start(runId, start);
  },
  closeMultiTurnStream(reason) {
    multiTurnStream.close();
    const cur = get().multiTurn;
    if (!cur) return;
    const phase: MultiTurnPhase =
      reason === 'self-reported-complete' || reason === 'turn-cap' || reason === 'time-cap'
        ? 'finalizing'
        : reason === 'aborted'
          ? 'paused'
          : 'done';
    set({ multiTurn: { ...cur, phase } });
  },
  startMultiTurnDemo() {
    multiTurnStream.close();
    // Synchronously inject full mock state so the user never sees a blank
    // Workspace mid-import (race fix — previously dynamic-imported and the
    // UI flashed empty gap-list / commits / sessions for a frame).
    const base = mockStoreFor({ status: 'LOOPING' }) as Record<string, unknown> & {
      session: Session | null;
    };
    // Suppress SidePanel's vision-md fetch (would 404 with no daemon).
    if (base.session) base.session = { ...base.session, visionMdPath: null };
    set({ ...base, multiTurnDemoMode: true, multiTurn: null });
  },
  startMultiTurnDemoStream() {
    if (!get().multiTurnDemoMode) return;
    demoStopHandle.fn();
    useStore.setState({ multiTurn: mockMultiTurnIdle });
    const stop = startMockMultiTurnStream((s) => {
      if (!useStore.getState().multiTurnDemoMode) {
        stop();
        return;
      }
      useStore.setState({ multiTurn: s });
    });
    demoStopHandle.fn = stop;
  },
  stopMultiTurnDemo() {
    demoStopHandle.fn();
    demoStopHandle.fn = () => undefined;
    set({
      multiTurnDemoMode: false,
      multiTurn: null,
      // Clear all the mock seed state so the user returns to a clean Landing
      // (real daemon will re-populate via refreshAll on bootstrap).
      session: null,
      demo: null,
      presetStatus: [],
      gaps: [],
      events: [],
      loopState: null,
      summaryMdPath: null,
    });
  },
  summaryMdPath: null,
  showSettings: false,
  setShowSettings: (b) => set({ showSettings: b }),
  selectedProjectId: null,
  setSelectedProjectId: (id) => set({ selectedProjectId: id }),

  async refreshHealth() {
    try {
      const h = await api.health();
      set({ health: h, healthError: null });
    } catch (e) {
      set({ health: null, healthError: (e as Error).message });
    }
  },

  async refreshSession() {
    try {
      const r: CurrentSessionRes = await api.currentSession();
      set({
        session: r.session,
        demo: r.demo,
        presetStatus: r.presetStatus,
        costTotals: r.costTotals,
      });
    } catch {
      // ignore transient
    }
  },

  async refreshGaps() {
    if (!get().session) return;
    try {
      const r = await api.listGaps();
      set({ gaps: r.gaps });
    } catch {
      // ignore
    }
  },

  async refreshLoopState() {
    try {
      const s = await api.loopState();
      set({ loopState: s });
    } catch {
      // ignore
    }
  },

  async refreshAll() {
    await Promise.all([
      get().refreshHealth(),
      get().refreshSession(),
      get().refreshGaps(),
      get().refreshLoopState(),
    ]);
  },

  pushEvent(e) {
    set((s) => {
      const next = s.events.concat([e]);
      if (next.length > 500) next.splice(0, next.length - 500);
      return { events: next };
    });
    const refresh = get();
    if (
      e.kind === 'GAP_PICKED' ||
      e.kind === 'GAP_DONE' ||
      e.kind === 'GAP_SKIPPED' ||
      e.kind === 'GAP_ESCALATED' ||
      e.kind === 'DIFF_PRODUCED' ||
      e.kind === 'MERGED' ||
      e.kind === 'SESSION_DONE' ||
      e.kind === 'SESSION_ENDED' ||
      e.kind === 'LOOP_PAUSED' ||
      e.kind === 'LOOP_RESUMED' ||
      e.kind === 'VISION_FINALIZED' ||
      e.kind === 'PRESET_CHOSEN' ||
      e.kind === 'TYPE_DETECTED'
    ) {
      void refresh.refreshSession();
      void refresh.refreshGaps();
      void refresh.refreshLoopState();
    }
    if (e.kind === 'AGENT_START' && (e.payload as { mode?: string }).mode === 'multi-turn') {
      const p = e.payload as {
        runId?: string;
        gapId?: number;
        gapTitle?: string;
        gapSlug?: string;
      };
      if (typeof p.runId === 'string') refresh.openMultiTurnStream(p);
    }
    if (e.kind === 'AGENT_END' && (e.payload as { mode?: string }).mode === 'multi-turn') {
      refresh.closeMultiTurnStream(
        (e.payload as { stopReason?: string }).stopReason ?? null,
      );
    }
  },

  setSseConnected(b) {
    set({ sseConnected: b });
  },

  async startSession(demoPath) {
    await api.startSession(demoPath);
    await get().refreshAll();
  },

  async runDetector() {
    try {
      const d = await api.runDetector();
      set({ detector: d, detectorError: null });
      await get().refreshSession();
    } catch (e) {
      set({ detectorError: (e as Error).message });
    }
  },

  async choosePreset(type) {
    const r = await api.choosePreset(type);
    set({ presetMd: r.presetMd });
    await get().refreshSession();
  },

  async loadVisionRound() {
    try {
      const r = await api.visionRound();
      set({ visionRound: r, visionError: null });
      if (r.done) await get().refreshSession();
    } catch (e) {
      set({ visionError: (e as Error).message });
    }
  },

  setVisionAnswer(qId, val) {
    set((s) => ({ visionAnswers: { ...s.visionAnswers, [qId]: val } }));
  },

  async submitVisionAnswers() {
    const { visionRound, visionAnswers } = get();
    if (!visionRound?.questions) return;
    const answers = visionRound.questions
      .filter((q) => visionAnswers[q.id])
      .map((q) => ({
        questionId: q.id,
        question: q.question,
        answer: visionAnswers[q.id] ?? '',
      }));
    if (!answers.length) {
      set({ visionError: '请至少回答一题' });
      return;
    }
    try {
      const r = await api.answerVision(answers);
      set({ visionRound: r, visionAnswers: {}, visionError: null });
      await get().refreshSession();
    } catch (e) {
      set({ visionError: (e as Error).message });
    }
  },

  async finalizeVision() {
    try {
      const r = await api.finalizeVision();
      set({ visionRound: r });
      await get().refreshSession();
    } catch (e) {
      set({ visionError: (e as Error).message });
    }
  },

  async startLoop() {
    await api.startLoop();
    await get().refreshAll();
  },

  async pauseLoop() {
    await api.pauseLoop();
    await get().refreshAll();
  },

  async resumeLoop() {
    await api.resumeLoop();
    await get().refreshAll();
  },

  async skipGap(id) {
    await api.skipGap(id);
    await Promise.all([get().refreshGaps(), get().refreshSession()]);
  },

  async endSession() {
    const r = await api.endSession();
    set({ summaryMdPath: r.summaryMdPath ?? null });
    await get().refreshAll();
  },

  clearError() {
    set({ healthError: null, detectorError: null, visionError: null });
  },
}));

/** Wire up health polling + SSE subscription. Returns cleanup. */
export function bootstrap(): () => void {
  const s = useStore.getState();
  void s.refreshAll();
  const healthInterval = setInterval(() => void useStore.getState().refreshHealth(), 10_000);
  const close = openLogStream(
    (e) => useStore.getState().pushEvent(e),
    (connected) => useStore.getState().setSseConnected(connected),
  );
  void s;
  return () => {
    clearInterval(healthInterval);
    close();
  };
}
