import { create } from "zustand";

export interface StreamEvent {
  id: string;
  type: "user" | "assistant" | "tool_use" | "tool_result" | "system";
  timestamp: string;
  data: any;
  sessionId: string;
}

interface StreamState {
  events: StreamEvent[];
  activeSessionId: string | null;
  watching: boolean;

  addEvent: (event: StreamEvent) => void;
  addEvents: (events: StreamEvent[]) => void;
  clearEvents: () => void;
  setActiveSessionId: (id: string | null) => void;
  setWatching: (watching: boolean) => void;
}

export const useStreamStore = create<StreamState>((set) => ({
  events: [],
  activeSessionId: null,
  watching: false,

  addEvent: (event) =>
    set((s) => ({
      events: [...s.events, event].slice(-500), // Keep last 500 events
    })),

  addEvents: (events) =>
    set((s) => ({
      events: [...s.events, ...events].slice(-500),
    })),

  clearEvents: () => set({ events: [] }),
  setActiveSessionId: (id) => set({ activeSessionId: id }),
  setWatching: (watching) => set({ watching }),
}));
