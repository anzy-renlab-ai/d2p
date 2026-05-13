import { create } from 'zustand';
import type {
  CurrentSessionRes,
  Demo,
  DetectorOutput,
  Gap,
  HealthResponse,
  PresetStatusItem,
  Session,
  SseEnvelope,
  VisionRoundRes,
  CostTotals,
  LoopState,
} from './types.js';
import { api, openLogStream } from './api.js';

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

  // end
  summaryMdPath: string | null;

  // ui chrome
  showSettings: boolean;
  setShowSettings: (b: boolean) => void;

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
  summaryMdPath: null,
  showSettings: false,
  setShowSettings: (b) => set({ showSettings: b }),

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
