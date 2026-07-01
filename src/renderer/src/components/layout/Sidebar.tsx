import { useAppStore, type SidebarTab } from "../../stores/app-store";
import { cn } from "../../lib/utils";
import { FolderTree, GitBranch, ChevronLeft } from "lucide-react";
import { FileExplorer } from "../explorer/FileExplorer";
import { GitPanel } from "../git/GitPanel";
import { useT } from "../../lib/i18n";

const tabs: { id: SidebarTab; icon: typeof FolderTree; zh: string; en: string }[] = [
  { id: "files", icon: FolderTree, zh: "文件", en: "Files" },
  { id: "git", icon: GitBranch, zh: "Git", en: "Git" },
];

export function Sidebar() {
  const { sidebarOpen, sidebarTab, sidebarWidth, setSidebarOpen, setSidebarTab } = useAppStore();
  const t = useT();
  // 仅 files/git 为真实分区，其余历史值（含已移除的 search）回落到 files。
  const activeTab: SidebarTab = (sidebarTab === "files" || sidebarTab === "git") ? sidebarTab : "files";

  if (!sidebarOpen) {
    return (
      <div className="w-12 border-r border-border/50 bg-[hsl(var(--sidebar-bg))] flex flex-col items-center py-2 gap-1.5 transition-all duration-200">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setSidebarOpen(true); setSidebarTab(tab.id); }}
            className={cn(
              "relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors",
              activeTab === tab.id
                ? "text-foreground bg-card shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
            )}
            title={t(tab.zh, tab.en)}
          >
            <tab.icon size={18} className={activeTab === tab.id ? "text-accent-brand" : ""} />
          </button>
        ))}
        <div className="flex-1" />
      </div>
    );
  }

  return (
    <div
      className="border-r border-border/50 bg-[hsl(var(--sidebar-bg))] flex flex-col transition-all duration-200 animate-fade-in"
      style={{ width: sidebarWidth }}
    >
      {/* 与主区 TabBar 同高（h-10 + border-b），让两条标签栏在同一水平线、看起来连成一体。 */}
      <div className="h-10 flex items-center gap-1 px-2 border-b border-border/50">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSidebarTab(tab.id)}
            className={cn(
              "flex-1 h-7 flex items-center justify-center gap-1.5 px-2 rounded-lg text-xs font-medium transition-all duration-150",
              activeTab === tab.id
                ? "bg-card text-foreground shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
            )}
          >
            <tab.icon size={13} className={activeTab === tab.id ? "text-accent-brand" : ""} />
            <span>{t(tab.zh, tab.en)}</span>
          </button>
        ))}
        <button
          onClick={() => setSidebarOpen(false)}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-accent/60 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title={t("收起侧边栏", "Collapse sidebar")}
        >
          <ChevronLeft size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {activeTab === "files" && <FileExplorer />}
        {activeTab === "git" && <GitPanel />}
      </div>
    </div>
  );
}
