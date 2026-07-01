import { useAppStore } from "../../stores/app-store";
import { Shield, AlertTriangle, X } from "lucide-react";
import { useT } from "../../lib/i18n";

// 全局项目信任确认框：任何入口（欢迎页、标题栏切项目）打开未信任项目时，
// app-store 把路径挂到 pendingTrustPath，由本组件统一弹框确认。确认 → 信任并打开。
export function TrustDialog() {
  const t = useT();
  const pendingTrustPath = useAppStore((s) => s.pendingTrustPath);
  const confirm = useAppStore((s) => s.confirmPendingTrust);
  const cancel = useAppStore((s) => s.cancelPendingTrust);

  if (!pendingTrustPath) return null;

  const name = pendingTrustPath.replace(/\\/g, "/").split("/").pop() || pendingTrustPath;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 animate-fade-in"
      onMouseDown={cancel}>
      <div className="w-[460px] rounded-2xl border border-border bg-card shadow-2xl p-5 space-y-4 animate-slide-up"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Shield size={15} className="text-yellow-500" /> {t("信任此项目？", "Trust this project?")}
          </h3>
          <button onClick={cancel} className="p-1 rounded hover:bg-accent text-muted-foreground">
            <X size={15} />
          </button>
        </div>

        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 text-xs">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            {t(
              "打开项目后，Agent 可读写其中的文件、运行命令、执行该项目的 hooks。请确认你信任此项目来源。",
              "Once opened, the agent can read and write files in this project, run commands, and execute its hooks. Make sure you trust the source of this project."
            )}
          </span>
        </div>

        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground truncate">{name}</div>
          <div className="text-[11px] text-muted-foreground break-all">{pendingTrustPath}</div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={cancel}
            className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40">
            {t("取消", "Cancel")}
          </button>
          <button onClick={confirm}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-foreground text-background font-medium hover:opacity-90">
            <Shield size={13} /> {t("信任并打开", "Trust & Open")}
          </button>
        </div>
      </div>
    </div>
  );
}
