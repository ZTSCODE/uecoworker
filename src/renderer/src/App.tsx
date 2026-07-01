import { useState, useEffect, useCallback } from "react";
import { useAppStore } from "./stores/app-store";
import { TitleBar } from "./components/layout/TitleBar";
import { Sidebar } from "./components/layout/Sidebar";
import { TabBar } from "./components/layout/TabBar";
import { SecondaryBar } from "./components/layout/SecondaryBar";
import { StatusBar } from "./components/layout/StatusBar";
import { BottomPanel } from "./components/layout/BottomPanel";
import { WelcomeScreen } from "./components/dashboard/WelcomeScreen";
import { TrustDialog } from "./components/dashboard/TrustDialog";
import { ChatView } from "./components/chat/ChatView";
import { TerminalPane } from "./components/terminal/TerminalPane";
import { CodeEditor } from "./components/editor/CodeEditor";
import { FileExplorer } from "./components/explorer/FileExplorer";
import { AnalyticsDashboard } from "./components/dashboard/AnalyticsDashboard";
import { ActivityTrail } from "./components/dashboard/ActivityTrail";
import { ConfigPanel } from "./components/config/ConfigPanel";
import { UEPluginView } from "./components/plugins/UEPluginView";
import { DiscordRelay } from "./components/discord/DiscordRelay";
import { GlobalTooltip } from "./components/ui/GlobalTooltip";

export function App() {
  const { projectPath, activeView, theme, sidebarOpen, chatFontSize, chatFontFamily, setSidebarOpen, setActiveView, toggleTheme } = useAppStore();
  const miniMode = useAppStore((s) => s.miniMode);
  const miniShortcut = useAppStore((s) => s.miniShortcut);
  const [showWelcome, setShowWelcome] = useState(!projectPath);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Apply the persisted chat font size to the CSS variable on load/change.
  useEffect(() => {
    document.documentElement.style.setProperty("--chat-font-size", chatFontSize + "px");
  }, [chatFontSize]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--chat-font-family", chatFontFamily || "var(--font-sans, inherit)"
    );
  }, [chatFontFamily]);

  useEffect(() => {
    setShowWelcome(!projectPath);
  }, [projectPath]);

  // 手机 relay 切换/新建项目 → 直接信任并打开（手机端无法弹信任框）。
  // 装在 App 顶层而非 DiscordRelay：后者只在「已打开项目」时挂载，冷启动/欢迎页收不到事件。
  useEffect(() => {
    const off = (window.api as any).onRelayOpenProject?.((data: { path: string }) => {
      if (data?.path) {
        try { useAppStore.getState().openProjectTrusted(data.path); } catch {}
      }
    });
    return () => { if (typeof off === "function") off(); };
  }, []);

  // 启动时把持久化的呼出快捷键重注册到主进程（覆盖主进程默认的 Ctrl+Q）。
  useEffect(() => {
    try { (window.api as any).setMiniShortcut?.(miniShortcut); } catch {}
  }, []);

  // 全局快捷键「呼出小窗」：不在小窗则切到小窗；已在小窗则只聚焦输入框。
  // 无论哪种都派发 cw:focus-mini-input 事件，ChatView 据此聚焦输入框（含已选中小窗未聚焦的情况）。
  useEffect(() => {
    const off = (window.api as any).onToggleMiniRequest?.(() => {
      const s = useAppStore.getState();
      if (!s.miniMode) {
        s.setActiveView("chat");
        s.setMiniMode(true);
      }
      // 延时派发，等窗口/视图就绪再聚焦。
      setTimeout(() => { try { window.dispatchEvent(new CustomEvent("cw:focus-mini-input")); } catch {} }, 90);
    });
    return () => { if (typeof off === "function") off(); };
  }, []);

  // 主进程请求退出小窗（托盘「还原窗口」/双击托盘）：把 store 切回大窗，
  // setMiniMode(false) 会回调 setMini→exitMiniMode 同步窗口形态。
  useEffect(() => {
    const off = (window.api as any).onRestoreRequest?.(() => {
      const s = useAppStore.getState();
      if (s.miniMode) s.setMiniMode(false);
    });
    return () => { if (typeof off === "function") off(); };
  }, []);


  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === "b") { e.preventDefault(); setSidebarOpen(!sidebarOpen); return; }
    if (ctrl && e.key === "1") { e.preventDefault(); setActiveView("chat"); return; }
    if (ctrl && e.key === "2") { e.preventDefault(); setActiveView("terminal"); return; }
    if (ctrl && e.key === "3") { e.preventDefault(); setActiveView("editor"); return; }
    if (ctrl && e.key === "4") { e.preventDefault(); setActiveView("explorer"); return; }
    if (ctrl && e.key === "5") { e.preventDefault(); setActiveView("config"); return; }
    if (ctrl && e.shiftKey && (e.key === "L" || e.key === "l")) { e.preventDefault(); toggleTheme(); return; }
    // Ctrl/Cmd + ` 切换底部终端面板（类似 VSCode）。
    if (ctrl && e.key === "`") { e.preventDefault(); useAppStore.getState().toggleBottomPanel(); return; }
  }, [sidebarOpen]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // 小窗模式：只渲染 ChatView（它内部去掉顶部栏、用精简输入框），不要主窗口的
  // 标题栏/侧栏/标签栏/状态栏。同一个 ChatView 实例、同一个 store，消息链路完全一致。
  if (miniMode) {
    return (
      <div className="h-screen flex flex-col overflow-hidden bg-background">
        <ChatView />
        <TrustDialog />
        <DiscordRelay />
        <GlobalTooltip />
      </div>
    );
  }

  if (showWelcome) {
    return (
      <div className="h-screen flex flex-col bg-background">
        <TitleBar />
        <WelcomeScreen />
        <TrustDialog />
        <GlobalTooltip />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* 统一悬浮面板：主标签行 + 次级栏。像底部输入框那样的悬浮卡片——圆角 + 全边框 +
              阴影 + 浮起不贴边。云母半透明，chat 内容可滚到背后透出；其余视图垫留白避免遮挡。 */}
          <div className="absolute top-0 left-0 right-0 z-30 px-3 pt-3 pointer-events-none">
            <div className="pointer-events-auto relative cw-mica border border-border rounded-2xl shadow-lg shadow-black/10">
              <TabBar />
              <SecondaryBar />
            </div>
          </div>
          <div className="flex-1 flex overflow-hidden">
            {/* 所有视图统一：内容铺到顶、可滚到悬浮面板背后透出。各视图自行在顶部留白。 */}
            <div className="flex-1 min-w-0">
              {/* ChatView 始终挂载、仅用 display 隐藏——绝不随切换标签页而卸载。原因：agent
                  的每条 agent:turn 是「全量快照」流，监听器装在 ChatView 内；一旦卸载，期间
                  主进程发出的快照（尤其是一次性的 done 收尾快照）会被直接丢弃，导致切回后
                  消息停在半截、streaming 卡住且不落盘，必须发消息/点停止才"接上"。常驻后
                  监听器永远在线，任何快照都不丢；心跳看门狗与转圈状态也保持连续。 */}
              <div className="h-full" style={{ display: activeView === "chat" ? undefined : "none" }}>
                <ChatView />
              </div>
              {activeView === "terminal" && <TerminalPane />}
              {activeView === "editor" && <CodeEditor />}
              {activeView === "explorer" && <FileExplorer />}
              {activeView === "analytics" && <AnalyticsDashboard />}
              {activeView === "activity" && <ActivityTrail />}
              {activeView === "ueplugin" && <UEPluginView />}
              {activeView === "config" && <ConfigPanel />}
            </div>
          </div>
          {/* 底部停靠终端面板（类似 VSCode）：贴在内容区底部、状态栏之上，全宽。
              常驻挂载，靠自身高度过渡做收起/展开动画（收起后内部卸载终端）。 */}
          <BottomPanel />
        </div>
      </div>
      <StatusBar />
      <TrustDialog />
      <DiscordRelay />
      <GlobalTooltip />
    </div>
  );
}
