import { useAppStore } from "../../stores/app-store";
import { useTerminalStore } from "../../stores/terminal-store";
import { cn } from "../../lib/utils";
import { Plus, Wand2 } from "lucide-react";
import { ChatSecondary } from "../chat/ChatView";
import { configSections } from "../config/ConfigPanel";
import { RANGES } from "../dashboard/AnalyticsDashboard";
import { startMakePluginChat } from "../plugins/UEPluginView";
import { useLangStore } from "../../lib/i18n";

/**
 * 全局次级工具栏：作为顶部统一面板的第二行，内容随当前主视图变化。
 * - chat      → 历史/新建/回滚 + todo 路线图（ChatSecondary）
 * - terminal  → 终端窗口标签切换 + 新建
 * - analytics → 今天 / 近7天 / 全部 时间范围
 * - config    → 横排分区导航（窄屏只显示图标）
 * 其余视图不渲染次级行（返回 null，面板只剩主标签行）。
 */
export function SecondaryBar() {
  const activeView = useAppStore((s) => s.activeView);

  let content: React.ReactNode = null;
  if (activeView === "chat") content = <ChatSecondary />;
  else if (activeView === "terminal") content = <TerminalSecondary />;
  else if (activeView === "analytics") content = <AnalyticsSecondary />;
  else if (activeView === "ueplugin") content = <PluginSecondary />;
  else if (activeView === "config") content = <ConfigSecondary />;

  if (!content) return null;
  // 次级行：与主标签行同款内边距，留足 h-7 控件高度不被裁切。
  return <div className="flex items-center px-2 pb-2 pt-0.5 min-h-[40px]">{content}</div>;
}

// 终端窗口标签 + 新建。复用 terminal-store 与 activeTerminalId。
function TerminalSecondary() {
  const projectPath = useAppStore((s) => s.projectPath);
  const setActiveTerminalId = useAppStore((s) => s.setActiveTerminalId);
  const lang = useLangStore((s) => s.lang);
  const { sessions, addSession, removeSession, setActive } = useTerminalStore();

  const newSession = async () => {
    if (!projectPath) return;
    try {
      const session = await window.api.ptyCreate({ cwd: projectPath, model: "sonnet", name: "Shell" });
      if (!session || (session as any).error || !session.id) return;
      addSession(session);
      setActiveTerminalId(session.id);
    } catch (e) { /* ignore */ }
  };

  return (
    <div className="flex items-center gap-1 w-full overflow-x-auto cw-no-scrollbar">
      {sessions.map((session) => (
        <div
          key={session.id}
          role="tab"
          tabIndex={0}
          onClick={() => { setActive(session.id); setActiveTerminalId(session.id); }}
          className={cn(
            "flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs font-medium transition-colors cursor-pointer select-none shrink-0",
            session.active
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
          )}
        >
          <span className={cn("w-1.5 h-1.5 rounded-full", session.active ? "bg-green-400" : "bg-green-500")} />
          <span>{session.name}</span>
          <button
            onClick={(e) => { e.stopPropagation(); window.api.ptyKill(session.id); removeSession(session.id); }}
            className={cn("ml-1 w-4 h-4 flex items-center justify-center rounded transition-colors",
              session.active ? "hover:bg-background/20" : "hover:bg-destructive/20 hover:text-destructive")}
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={newSession}
        title={lang === "en" ? "New terminal" : "新建终端"}
        className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

// 分析时间范围切换。
function AnalyticsSecondary() {
  const range = useAppStore((s) => s.analyticsRange);
  const setRange = useAppStore((s) => s.setAnalyticsRange);
  const lang = useLangStore((s) => s.lang);
  return (
    <div className="flex items-center gap-1">
      {RANGES.map((r) => (
        <button
          key={r.value}
          onClick={() => setRange(r.value)}
          className={cn(
            "px-3 h-7 text-xs rounded-lg transition-colors",
            range === r.value
              ? "bg-foreground text-background font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
          )}
        >
          {lang === "en" ? r.labelEn : r.label}
        </button>
      ))}
    </div>
  );
}

// 插件次级栏:市场 / 我的插件 切换 + 「自己做插件」入口。
function PluginSecondary() {
  const active = useAppStore((s) => s.pluginSection);
  const setActive = useAppStore((s) => s.setPluginSection);
  const lang = useLangStore((s) => s.lang);
  const tabs = [
    { id: "market" as const, zh: "市场", en: "Marketplace" },
    { id: "installed" as const, zh: "我的插件", en: "My Plugins" },
  ];
  return (
    <div className="flex items-center gap-1 w-full">
      {tabs.map((tb) => (
        <button
          key={tb.id}
          onClick={() => setActive(tb.id)}
          className={cn(
            "px-3 h-7 text-xs rounded-lg transition-colors",
            active === tb.id
              ? "bg-foreground text-background font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
          )}
        >
          {lang === "en" ? tb.en : tb.zh}
        </button>
      ))}
      <div className="flex-1" />
      <button
        onClick={startMakePluginChat}
        className="flex items-center gap-1.5 px-3 h-7 text-xs rounded-lg bg-accent-brand text-white font-medium hover:opacity-90 transition-opacity shrink-0"
        title={lang === "en" ? "Let AI build a UE plugin for you" : "由 AI 引导,从零做一款 UE 插件"}
      >
        <Wand2 size={13} />
        {lang === "en" ? "Make a plugin" : "自己做插件"}
      </button>
    </div>
  );
}

// 配置分区横排导航。窄屏自动只剩图标（标题 hidden，靠 title 提示）。
function ConfigSecondary() {
  const active = useAppStore((s) => s.configSection);
  const setActive = useAppStore((s) => s.setConfigSection);
  const lang = useLangStore((s) => s.lang);
  return (
    <div className="flex items-center gap-1 w-full overflow-x-auto cw-no-scrollbar">
      {configSections.map((section) => {
        const Icon = section.icon;
        const isActive = active === section.id;
        const label = lang === "en" ? section.labelEn : section.label;
        return (
          <button
            key={section.id}
            onClick={() => setActive(section.id)}
            title={label}
            className={cn(
              "flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-xs font-medium transition-colors shrink-0",
              isActive
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
            )}
          >
            <Icon size={13} className="shrink-0" />
            {/* 宽屏显示标题；窄屏(xl 以下)隐藏只留图标，靠 title 提示。横向也可滚动兜底。 */}
            <span className="hidden xl:inline whitespace-nowrap">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
