import { useState, useEffect } from "react";
import { useAppStore } from "../../stores/app-store";
import { FolderOpen, Shield, Star, Clock, ArrowRight } from "lucide-react";
import { isTrusted } from "../../lib/trust";
import appIcon from "../../assets/app-icon.png";
import { useT } from "../../lib/i18n";

interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
}

export function WelcomeScreen() {
  const t = useT();
  const { requestProject } = useAppStore();
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  // 用 localStorage 版本号触发重渲染：确认信任后图标从盾牌变星星。
  const [trustVersion, setTrustVersion] = useState(0);
  const pendingTrustPath = useAppStore((s) => s.pendingTrustPath);

  useEffect(() => {
    window.api.getRecentProjects().then(setRecentProjects);
  }, []);

  // 全局信任框确认完毕（pendingTrustPath 归空）后，刷新一次以更新星/盾图标。
  useEffect(() => {
    if (!pendingTrustPath) setTrustVersion((v) => v + 1);
  }, [pendingTrustPath]);

  const handleOpenProject = async () => {
    const path = await window.api.openDirectory();
    if (path) {
      // 选目录后经 requestProject 统一信任门槛：首次会弹确认框，已信任则直开。
      requestProject(path);
    }
  };

  // 已信任直接打开；未信任经 requestProject 触发全局确认框（方案2）。
  const handleOpenRecent = (path: string) => {
    requestProject(path);
  };

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 3600000) return "Just now";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    return Math.floor(diff / 86400000) + "d ago";
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="w-full max-w-lg flex flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center shadow-lg shadow-purple-500/20">
            <img src={appIcon} alt="UE Coworker" className="w-full h-full object-cover" draggable={false} />
          </div>
          <h1 className="text-2xl font-bold text-foreground">UE Coworker</h1>
          <p className="text-sm text-muted-foreground text-center max-w-xs">
            A multi-agent desktop IDE powered by Claude Code.
            Open a project to get started.
          </p>
        </div>

        <button
          onClick={handleOpenProject}
          className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <FolderOpen size={18} />
          <span>Open Project</span>
          <ArrowRight size={16} />
        </button>

        {recentProjects.length > 0 && (
          <div className="w-full space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock size={12} />
              <span>Recent</span>
            </div>
            {recentProjects.map((proj) => {
              // trustVersion 变化会触发组件重渲染，使 isTrusted 重新求值（盾→星）。
              void trustVersion;
              const trusted = isTrusted(proj.path);
              return (
                <button
                  key={proj.path}
                  onClick={() => handleOpenRecent(proj.path)}
                  title={trusted ? proj.path : t("未信任的项目，点击需先确认信任", "Untrusted project — confirm trust before opening")}
                  className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border hover:bg-accent transition-colors text-left group"
                >
                  <div className={trusted ? "text-green-500" : "text-yellow-500"}>
                    {trusted ? <Star size={16} /> : <Shield size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">{proj.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{proj.path}</div>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{formatTime(proj.lastOpened)}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
