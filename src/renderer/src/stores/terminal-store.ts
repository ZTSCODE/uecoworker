import { create } from "zustand";

export interface TerminalTab {
  id: string;
  name: string;
  cwd: string;
  model: string;
  active: boolean;
}

interface TerminalState {
  sessions: TerminalTab[];
  // 终端主题在 TERMINAL_THEMES 里的下标。由次级栏切换，TerminalPane 订阅并应用到活动终端。
  themeIndex: number;
  setThemeIndex: (i: number) => void;
  addSession: (session: Omit<TerminalTab, "active">) => void;
  removeSession: (id: string) => void;
  setActive: (id: string) => void;
  updateName: (id: string, name: string) => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  sessions: [],
  themeIndex: 0,
  setThemeIndex: (i) => set({ themeIndex: i }),
  addSession: (session) =>
    set((s) => ({
      sessions: [...s.sessions.map((t) => ({ ...t, active: false })), { ...session, active: true }],
    })),
  removeSession: (id) =>
    set((s) => ({
      sessions: s.sessions.filter((t) => t.id !== id),
    })),
  setActive: (id) =>
    set((s) => ({
      sessions: s.sessions.map((t) => ({ ...t, active: t.id === id })),
    })),
  updateName: (id, name) =>
    set((s) => ({
      sessions: s.sessions.map((t) => (t.id === id ? { ...t, name } : t)),
    })),
}));
