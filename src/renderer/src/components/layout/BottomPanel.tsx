import { useRef, useEffect, useState, useCallback } from "react";
import { useAppStore } from "../../stores/app-store";
import { useTerminalStore } from "../../stores/terminal-store";
import { Terminal, X, Maximize2, Plus, ChevronDown } from "lucide-react";
import { TERMINAL_THEMES } from "../../lib/terminal-themes";
import { XtermInstance } from "../terminal/XtermInstance";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";

/**
 * 底部停靠终端面板（类似 VSCode 集成终端）：全宽、贴在状态栏上方、可拖拽调高。
 * 复用主 Terminal 视图的 PTY 会话（terminal-store），与 Terminal 标签页是同一批终端、
 * 双向同步。顶部可切换/新建会话；右上「在主视图打开」跳到 Terminal 标签页。
 * 收起仅隐藏面板，不结束任何会话。
 *
 * 收起/展开动画：组件常驻挂载，外层高度在 0 ↔ height 间做 CSS 过渡（200ms）。
 * 终端内容只在「已展开或正在收起动画中」(rendered) 时挂载——完全收起后卸载，
 * 避免后台空跑；拖拽调高时临时去掉过渡以跟手。
 */
export function BottomPanel() {
  const t = useT();
  const { projectPath, setActiveView, setActiveTerminalId, setBottomPanelOpen } = useAppStore();
  const open = useAppStore((s) => s.bottomPanelOpen);
  const height = useAppStore((s) => s.bottomPanelHeight);
  const setHeight = useAppStore((s) => s.setBottomPanelHeight);
  const appTheme = useAppStore((s) => s.theme);
  const { sessions, addSession, removeSession, setActive } = useTerminalStore();
  const themeIndex = useTerminalStore((s) => s.themeIndex);
  const setThemeIndex = useTerminalStore((s) => s.setThemeIndex);
  const activeSession = sessions.find((s) => s.active) || sessions[0];
  const startingRef = useRef(false);
  // rendered：内容是否挂载（展开时立即 true；收起时等高度动画结束再 false）。
  const [rendered, setRendered] = useState(open);
  // expanded：驱动高度过渡的目标态。挂载后下一帧才置 true，让 0→height 真正过渡
  // （若挂载即用 open，首帧就是满高，不会有动画）。
  const [expanded, setExpanded] = useState(open);
  // dragging：拖拽中去掉高度过渡，保证跟手不卡顿。
  const [dragging, setDragging] = useState(false);

  // open 变化驱动动画：展开→先挂载(rendered)，下一帧再撑高(expanded)；收起→先落高。
  useEffect(() => {
    if (open) {
      setRendered(true);
      const id = requestAnimationFrame(() => setExpanded(true));
      return () => cancelAnimationFrame(id);
    }
    setExpanded(false);
  }, [open]);

  // 终端主题跟随应用亮/暗模式。
  useEffect(() => {
    setThemeIndex(appTheme === "light" ? 1 : 0);
  }, [appTheme, setThemeIndex]);

  const termBg = (TERMINAL_THEMES[themeIndex] || TERMINAL_THEMES[0]).colors.background;

  // 没有任何会话时，展开即自动新建。
  const newSession = useCallback(async () => {
    if (!projectPath || startingRef.current) return;
    startingRef.current = true;
    try {
      const session = await window.api.ptyCreate({ cwd: projectPath, name: "Shell" });
      if (session && !(session as any).error && session.id) {
        addSession(session);
        setActiveTerminalId(session.id);
      }
    } catch (e) { console.error("Failed to create PTY session:", e); }
    finally { startingRef.current = false; }
  }, [projectPath, addSession, setActiveTerminalId]);

  useEffect(() => {
    if (open && !activeSession && projectPath) newSession();
  }, [open, activeSession, projectPath, newSession]);

  // 拖拽顶边调整高度（向上拖变高）。拖拽期间关过渡，跟手。
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = useAppStore.getState().bottomPanelHeight;
    setDragging(true);
    const onMove = (ev: MouseEvent) => setHeight(startH + (startY - ev.clientY));
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      setDragging(false);
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [setHeight]);

  const openInMainView = useCallback(() => {
    if (activeSession) { setActive(activeSession.id); setActiveTerminalId(activeSession.id); }
    setActiveView("terminal");
    setBottomPanelOpen(false);
  }, [activeSession, setActive, setActiveTerminalId, setActiveView, setBottomPanelOpen]);

  // 完全收起后才卸载内容（让收起动画跑完）。
  const onTransitionEnd = (e: React.TransitionEvent) => {
    if (e.propertyName === "height" && !open) setRendered(false);
  };

  // 既未展开也已收起完成：渲染一个 0 高的占位（不占视觉、不挂终端）。
  if (!open && !rendered) {
    return <div className="shrink-0 h-0 overflow-hidden" />;
  }

  return (
    <div
      onTransitionEnd={onTransitionEnd}
      className={cn(
        "shrink-0 flex flex-col border-t border-border/60 overflow-hidden",
        !dragging && "transition-[height] duration-200 ease-out"
      )}
      style={{ height: expanded ? height : 0, background: termBg }}
    >
      {/* 拖拽手柄 */}
      <div
        onMouseDown={onDragStart}
        className="h-1 shrink-0 cursor-row-resize hover:bg-accent-brand/40 transition-colors"
        title={t("拖拽调整高度", "Drag to resize")}
      />
      {/* 顶部工具条：会话标签 + 新建 + 在主视图打开 + 收起 */}
      <div className="h-8 shrink-0 flex items-center gap-1 px-2 border-b border-border/30">
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto cw-no-scrollbar">
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => { setActive(s.id); setActiveTerminalId(s.id); }}
              className={cn(
                "flex items-center gap-1.5 px-2.5 h-6 rounded-md text-[11px] font-medium cursor-pointer select-none shrink-0 transition-colors",
                s.active ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-foreground/5"
              )}
            >
              <Terminal size={11} className={s.active ? "text-accent-brand" : ""} />
              <span className="max-w-[120px] truncate">{s.name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); window.api.ptyKill(s.id); removeSession(s.id); }}
                className="ml-0.5 w-3.5 h-3.5 flex items-center justify-center rounded hover:bg-destructive/20 hover:text-destructive transition-colors"
              >
                <X size={10} />
              </button>
            </div>
          ))}
          <button
            onClick={newSession}
            title={t("新建终端", "New terminal")}
            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
          >
            <Plus size={13} />
          </button>
        </div>
        <button
          onClick={openInMainView}
          title={t("在主视图打开", "Open in main view")}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
        >
          <Maximize2 size={12} />
        </button>
        <button
          onClick={() => setBottomPanelOpen(false)}
          title={t("收起面板（不结束会话）", "Hide panel (keep sessions)")}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {/* 主体 */}
      <div className="flex-1 min-h-0">
        {!projectPath ? (
          <div className="h-full flex items-center justify-center text-muted-foreground text-xs px-4 text-center">
            {t("打开项目以使用终端", "Open a project to use the terminal")}
          </div>
        ) : activeSession ? (
          <XtermInstance
            key={activeSession.id}
            sessionId={activeSession.id}
            themeIndex={themeIndex}
            className="h-full p-1"
          />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
            {t("正在启动终端…", "Starting terminal…")}
          </div>
        )}
      </div>
    </div>
  );
}
