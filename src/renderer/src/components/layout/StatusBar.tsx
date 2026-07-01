import { useAppStore } from "../../stores/app-store";
import { useProviderStore } from "../../stores/provider-store";
import { useChatStore } from "../../stores/chat-store";
import { Terminal, FolderOpen, Clock, Wallet } from "lucide-react";
import { balanceColor } from "../../lib/provider-icon";
import { useT } from "../../lib/i18n";

export function StatusBar() {
  const t = useT();
  const { sidebarOpen, setSidebarOpen, setSidebarTab } = useAppStore();
  const bottomPanelOpen = useAppStore((s) => s.bottomPanelOpen);
  const toggleBottomPanel = useAppStore((s) => s.toggleBottomPanel);
  const providers = useProviderStore((s) => s.providers);
  const defaultProviderId = useProviderStore((s) => s.selectedProviderId);
  const balances = useProviderStore((s) => s.balances);
  // Show balance for the *active session's* provider (per-session selection),
  // falling back to the global default. Mirrors ChatView's resolution.
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  let selectedProviderId = defaultProviderId;
  if (activeSession) {
    if (activeSession.providerId && providers.some((p) => p.id === activeSession.providerId)) {
      selectedProviderId = activeSession.providerId;
    } else {
      const byName = providers.find((p) => p.name === activeSession.provider);
      if (byName) selectedProviderId = byName.id;
    }
  }
  const bal = selectedProviderId ? balances[selectedProviderId] : undefined;
  const sym = bal ? (bal.unit === "CNY" ? "¥" : "$") : "";

  return (
    <div className="h-6 bg-card shadow-[0_-1px_2px_rgb(0_0_0/0.08)] flex items-center px-3 gap-3 text-[11px] text-muted-foreground select-none">
      <button
        onClick={() => {
          if (sidebarOpen) {
            setSidebarOpen(false);
          } else {
            setSidebarOpen(true);
            setSidebarTab("files");
          }
        }}
        className="flex items-center gap-1 hover:text-foreground transition-colors"
      >
        <FolderOpen size={12} />
        <span>Explorer</span>
      </button>
      <span className="text-border">|</span>
      {/* 切换底部停靠终端面板（类似 VSCode 集成终端），复用主 Terminal 视图的会话。 */}
      <button
        onClick={toggleBottomPanel}
        title={t("终端面板（Ctrl+`）", "Terminal panel (Ctrl+`)")}
        className={"flex items-center gap-1 transition-colors " + (bottomPanelOpen ? "text-foreground" : "hover:text-foreground")}
      >
        <Terminal size={12} />
        <span>Terminal</span>
      </button>
      <span className="flex-1" />
      {/* Account balance (best-effort; hover shows today's spend, derived by subtraction). */}
      {bal && (
        <span
          className="flex items-center gap-1 font-medium"
          style={{ color: balanceColor(bal.remaining) }}
          title={t("账户余额（每5分钟刷新）· 今日已用 ", "Account balance (refreshes every 5 min) · Spent today ") + sym + (bal.usedToday ?? 0).toFixed(2) +
            t(" · 更新于 ", " · Updated ") + new Date(bal.fetchedAt).toLocaleTimeString()}
        >
          <Wallet size={12} />
          <span>{sym + bal.remaining.toFixed(2)}</span>
          {typeof bal.usedToday === "number" && bal.usedToday > 0 && (
            <span className="text-muted-foreground/60 font-normal">({t("今日", "today")} −{sym + bal.usedToday.toFixed(2)})</span>
          )}
        </span>
      )}
      <span className="flex items-center gap-1">
        <Clock size={12} />
        <span>{new Date().toLocaleTimeString()}</span>
      </span>
    </div>
  );
}
