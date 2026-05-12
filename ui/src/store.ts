import { create } from 'zustand';
import type { HealthResponse, SseEnvelope } from './api.js';

interface Store {
  health: HealthResponse | null;
  events: SseEnvelope[];
  setHealth: (h: HealthResponse | null) => void;
  pushEvent: (e: SseEnvelope) => void;
  clearEvents: () => void;
}

export const useStore = create<Store>((set) => ({
  health: null,
  events: [],
  setHealth: (h) => set({ health: h }),
  pushEvent: (e) =>
    set((s) => {
      const next = s.events.concat([e]);
      // ring buffer 500
      if (next.length > 500) next.splice(0, next.length - 500);
      return { events: next };
    }),
  clearEvents: () => set({ events: [] }),
}));
