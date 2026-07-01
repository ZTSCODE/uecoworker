import { useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../../stores/app-store";
import { useTerminalStore } from "../../stores/terminal-store";
import { TERMINAL_THEMES } from "../../lib/terminal-themes";
import { XtermInstance } from "./XtermInstance";

export function TerminalPane() {
  const { projectPath, setActiveTerminalId, setActiveView } = useAppStore();
  const appTheme = useAppStore((s) => s.theme);
  const { sessions, addSession, removeSession } = useTerminalStore();
  const themeIndex = useTerminalStore((s) => s.themeIndex);
  const setThemeIndex = useTerminalStore((s) => s.setThemeIndex);
  const activeSession = sessions.find((s) => s.active);
  // 单飞锁：避免 React StrictMode/重复渲染下连开多个会话（曾导致「打开就有两个终端」）。
  const startingRef = useRef(false);

  // 终端主题跟随应用亮/暗模式：亮色→白底(index 1)，暗色→深色(index 0)。
  // 用户仍可用次级栏下拉手动改其它主题；切换应用主题时会重新同步到默认明/暗。
  useEffect(() => {
    setThemeIndex(appTheme === "light" ? 1 : 0);
  }, [appTheme, setThemeIndex]);

  const startSession = useCallback(async () => {
    if (!projectPath || startingRef.current) return;
    startingRef.current = true;
    try {
      const session = await window.api.ptyCreate({
        cwd: projectPath,
        name: "Shell",
      });
      // 创建失败（如 node-pty 原生模块缺失）会返回 {error}，此时不要建标签。
      if (!session || (session as any).error || !session.id) {
        console.error("Failed to create PTY session:", (session as any)?.error);
        return;
      }
      addSession(session);
      setActiveTerminalId(session.id);
    } catch (err) {
      console.error("Failed to create PTY session:", err);
    } finally {
      startingRef.current = false;
    }
  }, [projectPath, addSession, setActiveTerminalId]);

  useEffect(() => {
    if (!activeSession && projectPath) {
      startSession();
    }
  }, [activeSession, projectPath]);

  if (!projectPath) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-muted-foreground text-sm">Open a project to start a terminal session</p>
          <button
            onClick={() => setActiveView("explorer")}
            className="text-xs text-primary hover:underline"
          >
            Open Project
          </button>
        </div>
      </div>
    );
  }

  // 容器底色跟随终端主题，避免 .xterm padding / fit 间隙露出 App 背景形成「黑边」。
  const termBg = (TERMINAL_THEMES[themeIndex] || TERMINAL_THEMES[0]).colors.background;
  return (
    <div className="h-full flex flex-col pt-[104px] px-3 pb-1">
      {/* 顶部留白与其他视图统一，悬浮面板不遮挡；xterm 容器背景色由 XtermInstance 自行管理。 */}
      {activeSession ? (
        <XtermInstance
          key={activeSession.id}
          sessionId={activeSession.id}
          themeIndex={themeIndex}
          className="flex-1"
          onExit={() => removeSession(activeSession.id)}
        />
      ) : (
        <div className="flex-1" style={{ background: termBg }} />
      )}
    </div>
  );
}
