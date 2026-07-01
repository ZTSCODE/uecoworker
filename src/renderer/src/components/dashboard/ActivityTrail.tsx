import { useState, useEffect } from "react";
import { useAppStore } from "../../stores/app-store";
import { FileCode, FolderOpen, Clock, ExternalLink } from "lucide-react";
import { cn } from "../../lib/utils";

interface FileActivity {
  path: string;
  action: "created" | "modified" | "deleted";
  timestamp: string;
  sessionId: string;
  location: string;
}

export function ActivityTrail() {
  var { projectPath } = useAppStore();
  var [activities, setActivities] = useState<FileActivity[]>([]);
  var [filter, setFilter] = useState<"all" | "1h" | "4h" | "24h" | "7d">("all");
  var [expandedLocations, setExpandedLocations] = useState<Set<string>>(new Set());
  var [loading, setLoading] = useState(true);

  useEffect(function() {
    if (!projectPath) return;
    setLoading(true);

    // Read from Claude Code's file history
    window.api.readDir(projectPath).then(function() {
      // For now, generate mock activities based on actual project files
      var mockActivities: FileActivity[] = [];
      var now = Date.now();
      var hours = [0.1, 0.5, 1, 2, 3, 6, 12, 24, 48, 72];
      var actions: ("created" | "modified" | "deleted")[] = ["created", "modified", "modified", "modified", "modified"];
      var files = [
        "src/main/index.ts", "src/renderer/src/App.tsx",
        "package.json", "tsconfig.json", "tailwind.config.ts",
        ".claude/CLAUDE.md", ".claude/settings.json",
        "README.md", "src/renderer/src/components/chat/ChatView.tsx",
      ];

      for (var i = 0; i < files.length; i++) {
        mockActivities.push({
          path: files[i],
          action: actions[i % actions.length],
          timestamp: new Date(now - hours[i] * 3600000).toISOString(),
          sessionId: "session-" + (i % 3 + 1),
          location: files[i].split("/").slice(0, -1).join("/") || "root",
        });
      }
      setActivities(mockActivities);
      setLoading(false);
    });
  }, [projectPath]);

  var filtered = activities.filter(function(a) {
    if (filter === "all") return true;
    var age = Date.now() - new Date(a.timestamp).getTime();
    var limits: Record<string, number> = { "1h": 3600000, "4h": 14400000, "24h": 86400000, "7d": 604800000 };
    return age <= (limits[filter] || Infinity);
  });

  var grouped = filtered.reduce(function(acc: Record<string, FileActivity[]>, a) {
    if (!acc[a.location]) acc[a.location] = [];
    acc[a.location].push(a);
    return acc;
  }, {});

  var formatTime = function(ts: string) {
    var diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    return Math.floor(diff / 86400000) + "d ago";
  };

  if (!projectPath) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <p>Open a project to view activity</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-muted-foreground" />
          <h3 className="text-xs font-semibold text-foreground/70">Activity Trail</h3>
        </div>
        <div className="flex gap-0.5">
          {(["all", "1h", "4h", "24h", "7d"] as const).map(function(f) {
            return (
              <button
                key={f}
                onClick={function() { setFilter(f); }}
                className={cn(
                  "px-2 py-0.5 text-[10px] rounded transition-colors",
                  filter === f ? "bg-accent text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                )}>
                {f === "all" ? "All" : f}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="text-xs text-muted-foreground p-3">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-xs text-muted-foreground p-3 text-center">No activity in this time range</div>
        ) : (
          <div className="space-y-3">
            {Object.keys(grouped).sort().map(function(location) {
              var acts = grouped[location];
              var expanded = expandedLocations.has(location);
              return (
                <div key={location} className="rounded-lg border border-border overflow-hidden">
                  <button
                    onClick={function() {
                      var next = new Set(expandedLocations);
                      if (next.has(location)) next.delete(location); else next.add(location);
                      setExpandedLocations(next);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/30 transition-colors text-left"
                  >
                    <FolderOpen size={13} className="text-yellow-500/70" />
                    <span className="text-xs font-medium text-foreground/80 flex-1">
                      {location === "root" ? "Project Root" : location}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{acts.length} files</span>
                  </button>

                  {(expanded || expandedLocations.size === 0) && (
                    <div className="border-t border-border/50">
                      {acts.map(function(act, idx) {
                        return (
                          <div key={idx} className="flex items-center gap-3 px-4 py-1.5 hover:bg-accent/20 transition-colors text-xs border-b border-border/20 last:border-0">
                            <FileCode size={12} className={
                              act.action === "created" ? "text-green-400" :
                              act.action === "modified" ? "text-yellow-400" : "text-red-400"
                            } />
                            <span className="flex-1 truncate text-foreground/70 font-mono text-[11px]">
                              {act.path.split("/").pop() || act.path}
                            </span>
                            <span className={cn(
                              "text-[10px] px-1.5 py-0.5 rounded",
                              act.action === "created" ? "bg-green-500/10 text-green-500" :
                              act.action === "modified" ? "bg-yellow-500/10 text-yellow-500" : "bg-red-500/10 text-red-500"
                            )}>
                              {act.action}
                            </span>
                            <span className="text-[10px] text-muted-foreground/60 w-14 text-right">
                              {formatTime(act.timestamp)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
