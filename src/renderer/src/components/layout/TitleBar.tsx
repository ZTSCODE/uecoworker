import { useState, useEffect, useRef } from "react";
import { useAppStore } from "../../stores/app-store";
import { useT } from "../../lib/i18n";
import { Minus, Square, X, Moon, Sun, ChevronDown, FolderOpen, Check, Clock, PanelTopDashed } from "lucide-react";
import appIcon from "../../assets/app-icon.png";

interface RecentProject { path: string; name: string; lastOpened: number; }

export function TitleBar() {
  const { projectName, projectPath, theme, toggleTheme, requestProject } = useAppStore();
  const setActiveView = useAppStore((s) => s.setActiveView);
  const setMiniMode = useAppStore((s) => s.setMiniMode);
  const t = useT();
  const [maximized, setMaximized] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = window.api.onWindowMaximized(setMaximized);
    window.api.isMaximized().then(setMaximized);
    return unsub;
  }, []);

  // Load recent projects whenever the dropdown opens (cheap, keeps order fresh).
  useEffect(() => {
    if (menuOpen) window.api.getRecentProjects().then(setRecent);
  }, [menuOpen]);

  // Close on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // 切到最近项目：经 requestProject 统一信任门槛（未信任会弹全局确认框）。
  const switchTo = (path: string) => {
    setMenuOpen(false);
    requestProject(path);
  };

  // 选目录后经 requestProject 统一信任门槛：首次打开会弹确认框，已信任则直开。
  const openOther = async () => {
    setMenuOpen(false);
    const path = await window.api.openDirectory();
    if (path) requestProject(path);
  };

  return (
    <div className="h-9 bg-card border-b border-border flex items-center select-none titlebar-drag">
      <div className="flex-1 flex items-center gap-2 px-3 min-w-0">
        <img src={appIcon} alt="" className="w-4 h-4 shrink-0 rounded-sm" draggable={false} />
        <span className="text-sm font-semibold text-foreground/80 shrink-0">UE Coworker</span>
        {projectName && (
          <>
            <span className="text-muted-foreground/40 shrink-0">—</span>
            <div className="relative titlebar-no-drag min-w-0" ref={menuRef}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-accent text-xs text-muted-foreground hover:text-foreground transition-colors max-w-[240px]"
                title={t("切换项目", "Switch project")}
              >
                <span className="truncate">{projectName}</span>
                <ChevronDown size={12} className="shrink-0 opacity-70" />
              </button>
              {menuOpen && (
                <div className="absolute left-0 top-full mt-1 w-72 max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-card shadow-lg z-50 py-1 animate-fade-in">
                  <button
                    onClick={openOther}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-accent transition-colors"
                  >
                    <FolderOpen size={14} className="text-accent-brand" />
                    <span>{t("打开其他项目…", "Open another project…")}</span>
                  </button>
                  {recent.length > 0 && (
                    <>
                      <div className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] text-muted-foreground/60">
                        <Clock size={10} /><span>{t("最近项目", "Recent projects")}</span>
                      </div>
                      {recent.map((p) => {
                        const active = p.path === projectPath;
                        return (
                          <button
                            key={p.path}
                            onClick={() => switchTo(p.path)}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-accent transition-colors"
                          >
                            <span className="w-3.5 shrink-0 text-accent-brand">
                              {active && <Check size={13} />}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-xs text-foreground truncate">{p.name}</span>
                              <span className="block text-[10px] text-muted-foreground truncate">{p.path}</span>
                            </span>
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center titlebar-no-drag">
        <button onClick={() => { setActiveView("chat"); setMiniMode(true); }} className="h-9 w-9 flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" title={t("进入小窗模式", "Enter mini mode")}>
          <PanelTopDashed size={14} />
        </button>
        <button onClick={toggleTheme} className="h-9 w-9 flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" title={t("切换主题", "Toggle theme")}>
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button onClick={() => window.api.minimize()} className="h-9 w-11 flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
          <Minus size={14} />
        </button>
        <button onClick={() => window.api.maximize()} className="h-9 w-11 flex items-center justify-center hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
          <Square size={12} />
        </button>
        <button onClick={() => window.api.close()} className="h-9 w-11 flex items-center justify-center hover:bg-destructive hover:text-destructive-foreground text-muted-foreground transition-colors">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
