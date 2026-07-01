import { useTerminalStore } from "../../stores/terminal-store";
import { useAppStore } from "../../stores/app-store";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { Terminal, BarChart3, Settings, MessageSquare, Package } from "lucide-react";

// Explorer 已并入侧边栏文件树;Editor / Stream 视图已下线,故不在标签栏出现。
const viewTabs = [
  { id: "chat" as const, icon: MessageSquare, zh: "对话", en: "Chat" },
  { id: "terminal" as const, icon: Terminal, zh: "终端", en: "Terminal" },
  { id: "analytics" as const, icon: BarChart3, zh: "分析", en: "Analytics" },
  { id: "ueplugin" as const, icon: Package, zh: "插件", en: "Plugins" },
  { id: "config" as const, icon: Settings, zh: "配置", en: "Config" },
];

export function TabBar() {
  const { activeView, setActiveView } = useAppStore();
  const t = useT();

  // 透明主标签行：背景/定位由外层统一云母面板提供，这里只排标签。
  return (
    <div className="h-10 flex items-center gap-1 px-2 overflow-x-auto">
      {viewTabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveView(tab.id)}
          className={cn(
            "h-7 px-3 flex items-center gap-1.5 text-xs font-medium whitespace-nowrap rounded-lg transition-all duration-150",
            activeView === tab.id
              ? "bg-card text-foreground shadow-sm ring-1 ring-border -translate-y-px"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/60 hover:-translate-y-px"
          )}
        >
          <tab.icon size={13} className={activeView === tab.id ? "text-accent-brand" : ""} />
          <span>{t(tab.zh, tab.en)}</span>
        </button>
      ))}
      <div className="flex-1" />
    </div>
  );
}
