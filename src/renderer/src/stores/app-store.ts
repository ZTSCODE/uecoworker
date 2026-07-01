import { create } from "zustand";
import { isTrusted, addTrusted } from "../lib/trust";

export type ActiveView = "chat" | "terminal" | "editor" | "explorer" | "analytics" | "config" | "activity" | "ueplugin";
export type Theme = "dark" | "light";
export type SidebarTab = "files" | "search" | "git" | "sessions" | "config" | "activity";

interface AppState {
  projectPath: string | null;
  projectName: string;

  // 项目信任门槛：未信任的项目在打开前需用户确认。requestProject 是切项目的
  // 统一入口——已信任直接打开，未信任则挂起到 pendingTrustPath，由全局确认框消费。
  pendingTrustPath: string | null;
  requestProject: (path: string) => void;
  openProjectTrusted: (path: string) => void;
  confirmPendingTrust: () => void;
  cancelPendingTrust: () => void;
  activeView: ActiveView;
  theme: Theme;
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  sidebarWidth: number;
  activeTerminalId: string | null;
  openFiles: string[];
  chatFontSize: number;
  chatFontFamily: string;
  uiFontFamily: string;

  // 小窗模式（Mini Float 视图）：主窗口缩成无边框置顶小窗，渲染层 ChatView 切到
  // mini 分支。同组件、同 store、同发送链路——只是另一种渲染形态。**不持久化**：
  // 每次启动回到大窗。
  miniMode: boolean;
  setMiniMode: (v: boolean) => void;
  // 呼出小窗的全局快捷键（Electron accelerator，如 "CommandOrControl+Q"）。持久化。
  miniShortcut: string;
  setMiniShortcut: (accelerator: string) => Promise<boolean>;

  // 「发送给 agent」单通道：任意组件调用 requestChatInput(text) 把文本注入聊天
  // 输入框（ChatView 订阅消费）。nonce 自增以便重复注入同一文本也能触发。
  chatInputRequest: { text: string; nonce: number } | null;
  requestChatInput: (text: string) => void;

  // 设置面板的目标分区（斜杠命令 /mcp、/settings 等用来深链到指定分区）。
  // ConfigPanel 订阅消费后清空。
  configTab: string | null;
  openConfig: (tab?: string) => void;

  // 全局次级工具栏(SecondaryBar)用的视图级 UI 状态——从各视图组件内部提升上来，
  // 以便顶部统一面板能驱动它们。
  // config 当前分区(取代 ConfigPanel 内部 activeSection)。
  configSection: string;
  setConfigSection: (id: string) => void;
  // analytics 时间范围(取代 AnalyticsDashboard 内部 range)。
  analyticsRange: "today" | "week" | "all";
  setAnalyticsRange: (r: "today" | "week" | "all") => void;
  // UE 插件视图当前分区(市场 / 我的插件),由 SecondaryBar 横排切换。
  pluginSection: "market" | "installed";
  setPluginSection: (id: "market" | "installed") => void;

  // 底部停靠终端面板（类似 VSCode 集成终端）。复用主 Terminal 视图的活动 PTY 会话，
  // 双向同步。**不持久化**：每次启动收起。高度可拖拽，持久化到 localStorage。
  bottomPanelOpen: boolean;
  setBottomPanelOpen: (v: boolean) => void;
  toggleBottomPanel: () => void;
  bottomPanelHeight: number;
  setBottomPanelHeight: (px: number) => void;

  setProject: (path: string) => void;
  setChatFontSize: (px: number) => void;
  setChatFontFamily: (family: string) => void;
  setUiFontFamily: (family: string) => void;
  setActiveView: (view: ActiveView) => void;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setSidebarWidth: (width: number) => void;
  setActiveTerminalId: (id: string | null) => void;
  addOpenFile: (path: string) => void;
  removeOpenFile: (path: string) => void;
  setOpenFiles: (files: string[]) => void;
}

function loadChatFontSize(): number {
  const v = Number(localStorage.getItem("ue-coworker-chat-font-size"));
  return v >= 11 && v <= 22 ? v : 13;
}

function loadChatFontFamily(): string {
  return localStorage.getItem("ue-coworker-chat-font-family") || "";
}

function loadUiFontFamily(): string {
  return localStorage.getItem("ue-coworker-ui-font-family") || "";
}

// 底部终端面板高度持久化（夹在 160~720px）。默认 280。
function loadBottomPanelHeight(): number {
  const v = Number(localStorage.getItem("ue-coworker-bottom-panel-height"));
  return v >= 160 && v <= 720 ? v : 280;
}

// 小窗呼出快捷键持久化。默认 Ctrl/Cmd+Q。
function loadMiniShortcut(): string {
  return localStorage.getItem("ue-coworker-mini-shortcut") || "CommandOrControl+Q";
}

// 主题持久化:默认亮色(light)。读不到旧值时回落 light。
function loadTheme(): Theme {
  const v = localStorage.getItem("ue-coworker-theme");
  return v === "dark" || v === "light" ? v : "light";
}

// The app's default sans stack — appended after the user's font so that any
// weight the chosen font lacks (e.g. some CJK fonts ship only Regular) falls
// back to a system font that has bold, preserving the type hierarchy.
const DEFAULT_SANS = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif';

function applyUiFont(family: string): void {
  if (typeof document === "undefined") return;
  // Empty → clear override (Tailwind's font-sans applies). Otherwise append the
  // default stack as fallback and allow synthetic bold/italic.
  document.body.style.fontFamily = family ? family + ", " + DEFAULT_SANS : "";
  (document.body.style as any).fontSynthesis = family ? "weight style" : "";
}

// Apply the global UI font once at startup (empty → keep the default stack).
if (typeof document !== "undefined") {
  applyUiFont(loadUiFontFamily());
}

export const useAppStore = create<AppState>((set, get) => ({
  projectPath: null,
  projectName: "",
  pendingTrustPath: null,
  activeView: "chat",
  theme: loadTheme(),
  sidebarOpen: true,
  sidebarTab: "files",
  sidebarWidth: 280,
  activeTerminalId: null,
  openFiles: [],
  chatFontSize: loadChatFontSize(),
  chatFontFamily: loadChatFontFamily(),
  uiFontFamily: loadUiFontFamily(),
  miniMode: false,
  miniShortcut: loadMiniShortcut(),
  chatInputRequest: null,
  configTab: null,
  configSection: "providers",
  analyticsRange: "all",
  pluginSection: "market",
  bottomPanelOpen: false,
  bottomPanelHeight: loadBottomPanelHeight(),
  requestChatInput: (text) => set((s) => ({
    chatInputRequest: { text, nonce: (s.chatInputRequest?.nonce || 0) + 1 },
  })),

  openConfig: (tab) => set({ activeView: "config", configTab: tab || null }),
  setConfigSection: (id) => set({ configSection: id }),
  setAnalyticsRange: (r) => set({ analyticsRange: r }),
  setPluginSection: (id) => set({ pluginSection: id }),

  setBottomPanelOpen: (v) => set({ bottomPanelOpen: v }),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  setBottomPanelHeight: (px) => {
    const clamped = Math.max(160, Math.min(720, Math.round(px)));
    try { localStorage.setItem("ue-coworker-bottom-panel-height", String(clamped)); } catch { /* ignore */ }
    set({ bottomPanelHeight: clamped });
  },

  setProject: (path) => {
    const name = path.replace(/\\/g, "/").split("/").pop() || path;
    set({ projectPath: path, projectName: name });
  },

  // 切项目统一入口：已信任直接打开；未信任挂起，等全局确认框确认。
  // window.api.addRecentProject 让最近列表保持新鲜（与旧各组件行为一致）。
  requestProject: (path) => {
    if (!path) return;
    if (isTrusted(path)) {
      try { window.api.addRecentProject(path); } catch {}
      const name = path.replace(/\\/g, "/").split("/").pop() || path;
      set({ projectPath: path, projectName: name, pendingTrustPath: null });
    } else {
      set({ pendingTrustPath: path });
    }
  },
  confirmPendingTrust: () => {
    const path = get().pendingTrustPath;
    if (!path) return;
    addTrusted(path);
    try { window.api.addRecentProject(path); } catch {}
    const name = path.replace(/\\/g, "/").split("/").pop() || path;
    set({ projectPath: path, projectName: name, pendingTrustPath: null });
  },
  cancelPendingTrust: () => set({ pendingTrustPath: null }),
  // 直接信任并打开：供手机 relay 切项目用（用户已在手机上确认，桌面无法弹框）。
  openProjectTrusted: (path) => {
    if (!path) return;
    addTrusted(path);
    try { window.api.addRecentProject(path); } catch {}
    const name = path.replace(/\\/g, "/").split("/").pop() || path;
    set({ projectPath: path, projectName: name, pendingTrustPath: null });
  },
  setChatFontSize: (px) => {
    const clamped = Math.max(11, Math.min(22, px));
    localStorage.setItem("ue-coworker-chat-font-size", String(clamped));
    document.documentElement.style.setProperty("--chat-font-size", clamped + "px");
    set({ chatFontSize: clamped });
  },
  setUiFontFamily: (family) => {
    localStorage.setItem("ue-coworker-ui-font-family", family);
    applyUiFont(family); // appends fallback stack + enables synthetic bold
    set({ uiFontFamily: family });
  },
  setChatFontFamily: (family) => {
    localStorage.setItem("ue-coworker-chat-font-family", family);
    // Empty → inherit the global sans stack.
    document.documentElement.style.setProperty("--chat-font-family", family || "var(--font-sans, inherit)");
    set({ chatFontFamily: family });
  },
  setActiveView: (view) => set({ activeView: view }),

  // 进/出小窗：set 渲染态，并通知主进程切换窗口形态（缩小/置顶/跨工作区 ↔ 恢复）。
  setMiniMode: (v) => {
    try { (window.api as any).setMini?.(v); } catch {}
    set({ miniMode: v });
  },
  // 改快捷键：先落盘 set，再通知主进程重注册全局快捷键。注册失败（组合被占用）
  // 返回 false 给 UI 提示，但本地配置仍按用户输入保存。
  setMiniShortcut: async (accelerator) => {
    localStorage.setItem("ue-coworker-mini-shortcut", accelerator);
    set({ miniShortcut: accelerator });
    try {
      const ok = await (window.api as any).setMiniShortcut?.(accelerator);
      return ok !== false;
    } catch {
      return false;
    }
  },
  toggleTheme: () => set((s) => {
    const theme: Theme = s.theme === "dark" ? "light" : "dark";
    localStorage.setItem("ue-coworker-theme", theme);
    return { theme };
  }),
  setTheme: (theme) => { localStorage.setItem("ue-coworker-theme", theme); set({ theme }); },
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setActiveTerminalId: (id) => set({ activeTerminalId: id }),
  addOpenFile: (path) => set((s) => ({
    openFiles: s.openFiles.includes(path) ? s.openFiles : [...s.openFiles, path],
  })),
  removeOpenFile: (path) => set((s) => ({
    openFiles: s.openFiles.filter((f) => f !== path),
  })),
  setOpenFiles: (files) => set({ openFiles: files }),
}));
