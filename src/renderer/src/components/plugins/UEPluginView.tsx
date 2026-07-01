import { useEffect, useState } from "react";
import { useAppStore } from "../../stores/app-store";
import { useChatStore } from "../../stores/chat-store";
import { useProviderStore } from "../../stores/provider-store";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import {
  Package, Search, FolderOpen, AlertTriangle, Loader2, ExternalLink, Star, Clock,
  Download, Check, Upload, Trash2, RefreshCw,
} from "lucide-react";
import { PageHeader, SoftCard, GhostButton, PrimaryButton, Hint, INPUT_CLS } from "../ui/settings";

// UE 插件顶级视图。两分区由全局 SecondaryBar 切换(pluginSection):
//  - market    → 社区插件市场(GitHub topic: ue-coworker-plugin),一键装到当前工程 Plugins/
//  - installed → 我的插件(扫描当前工程 Plugins/ 已装插件,可打开目录/卸载)
// 顶部「自己做插件」按钮:跳到聊天、新开会话、预填一段引导 prompt,由 AI 全程带做。
export function UEPluginView() {
  const section = useAppStore((s) => s.pluginSection);
  return (
    <div className="h-full overflow-y-auto px-7 pb-8 pt-[104px]">
      <div className="max-w-3xl mx-auto">
        {section === "installed" ? <InstalledPlugins /> : <PluginMarket />}
      </div>
    </div>
  );
}

// ---- 引导式「自己做插件」:切聊天 + 新会话 + 预填 prompt ----
// 单一入口,顶部按钮调用。引导词不限 UE,可做任意插件(含给 UE Coworker 本体的扩展)。
export function startMakePluginChat() {
  const app = useAppStore.getState();
  const chat = useChatStore.getState();
  const ps = useProviderStore.getState();
  const provider = ps.providers.find((p) => p.id === ps.selectedProviderId);
  const model = (provider?.models && provider.models[0]) || ps.selectedModel || "";
  const sid = chat.createSession(provider?.name || "Agent", model, ps.selectedProviderId);
  chat.setActiveSession(sid);
  chat.setInputDraft(sid, MAKE_PLUGIN_PROMPT);
  app.setActiveView("chat");
}

// 预填给 AI 的引导词:让模型主动访谈用户需求,再从零做出一款可用的插件——
// 可以是 UE 插件、也可以是给 UE Coworker 本体扩展功能的插件,或其它任意类型。
// 最后引导用户上传分享(打 topic 即上架本市场)。
const MAKE_PLUGIN_PROMPT = [
  "我想做一款插件。请你作为插件开发向导,全程带我完成,流程如下:",
  "",
  "1. 先用几个问题访谈我:这款插件要解决什么问题/实现什么想法、面向哪个宿主(比如 Unreal Engine 工程、UE Coworker 本体,或其它平台/框架)、是编辑器/工具类还是运行时功能、用什么语言或技术栈。一次问清,不要让我猜。",
  "2. 根据我的回答给出方案,确认后在合适的位置从零创建完整插件:目录结构、描述/清单文件、源码模块、必要的资源(图标等),保证宿主能识别并加载/编译。具体形态按宿主而定(UE 插件用 .uplugin + Source/Build.cs;给 UE Coworker 本体的插件按其插件规范来;其它平台同理)。",
  "3. 边做边向我解释关键文件的作用,做完给出在对应宿主里启用/编译/测试的步骤。",
  "4. 完成后告诉我插件已就绪,以及在哪里能看到/启用它。",
  "5. 最后引导我把它上传分享:初始化 git 仓库、推到我的 GitHub,并在仓库打上 topic `ue-coworker-plugin` —— 这样它就自动上架到本插件市场,别人也能一键安装。",
  "",
  "现在开始第 1 步,先访谈我的需求。",
].join("\n");

// ============================ 我的插件 ============================
function InstalledPlugins() {
  const t = useT();
  const { projectPath } = useAppStore();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = async () => {
    if (!projectPath) { setItems([]); return; }
    setLoading(true);
    try {
      const rows = await (window.api as any).pluginsMarketListInstalled?.(projectPath);
      setItems(Array.isArray(rows) ? rows : []);
    } catch { setItems([]); }
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [projectPath]);

  const uninstall = async (name: string) => {
    setBusyName(name);
    try {
      const r = await (window.api as any).pluginsMarketUninstall?.(name, projectPath);
      if (r?.ok) setItems((prev) => prev.filter((it) => it.name !== name));
    } catch { /* ignore */ }
    setBusyName(null);
    setConfirming(null);
  };

  const openDir = (dir: string) => window.api.ensureDirAndOpen?.(dir);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Package}
        title={t("我的插件", "My Plugins")}
        subtitle={t("当前工程已安装的插件", "Plugins installed in the current project")}
        actions={
          <GhostButton onClick={load} title={t("刷新", "Refresh")}>
            <RefreshCw size={12} /> {t("刷新", "Refresh")}
          </GhostButton>
        }
      />

      {!projectPath ? (
        <EmptyHint icon={Package} text={t("尚未打开工程。打开一个 UE 工程以查看其已装插件。", "No project open. Open a UE project to see its installed plugins.")} />
      ) : loading ? (
        <LoadingRow t={t} />
      ) : items.length === 0 ? (
        <EmptyHint icon={Package} text={t("该工程还没有插件。去市场安装,或用顶部「自己做插件」从零做一个。", "No plugins yet. Install from the marketplace, or use “Make a plugin” above.")} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((it) => (
            <SoftCard key={it.name} className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Package size={16} className="text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-foreground flex items-center gap-1.5">
                    <span className="truncate">{it.friendlyName || it.name}</span>
                    {it.version && <span className="text-[10px] text-muted-foreground font-normal shrink-0">v{it.version}</span>}
                  </div>
                  <div className={cn("text-[11px] line-clamp-2 mt-0.5", !it.description ? "text-muted-foreground/50 italic" : "text-muted-foreground")}>
                    {it.description || t("（无介绍）", "(no description)")}
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 mt-1 truncate font-mono">{it.name}</div>
                </div>
              </div>
              <div className="mt-auto flex items-center gap-2">
                <GhostButton onClick={() => openDir(it.dir)}>
                  <FolderOpen size={12} /> {t("目录", "Folder")}
                </GhostButton>
                {confirming === it.name ? (
                  <span className="flex items-center gap-1.5 ml-auto">
                    <button onClick={() => uninstall(it.name)} disabled={busyName === it.name}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-lg bg-destructive text-white hover:opacity-90 disabled:opacity-50 transition-opacity">
                      {busyName === it.name ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                      {t("确认", "Confirm")}
                    </button>
                    <GhostButton onClick={() => setConfirming(null)}>{t("取消", "Cancel")}</GhostButton>
                  </span>
                ) : (
                  <button onClick={() => setConfirming(it.name)} title={t("卸载", "Uninstall")}
                    className="ml-auto flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg text-destructive hover:bg-destructive/10 transition-colors">
                    <Trash2 size={12} /> {t("卸载", "Uninstall")}
                  </button>
                )}
              </div>
            </SoftCard>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================ 插件市场 ============================
// 后端在 plugins-market.ts(IPC: pluginsMarketSearch/Install)。
function PluginMarket() {
  const t = useT();
  const { projectPath } = useAppStore();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Record<string, string>>({});  // id -> 安装后的目录名
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const run = async (q?: string) => {
    setLoading(true); setError(null);
    try {
      const rows = await (window.api as any).pluginsMarketSearch?.(q);
      setItems(Array.isArray(rows) ? rows : []);
    } catch (e: any) { setError(e?.message || String(e)); setItems([]); }
    setLoading(false);
  };
  useEffect(() => { run(); /* eslint-disable-next-line */ }, []);

  const install = async (it: any) => {
    if (!projectPath) { setNotice({ kind: "err", text: t("请先打开一个 UE 工程目录", "Open a UE project folder first") }); return; }
    setBusyId(it.id);
    try {
      const r = await (window.api as any).pluginsMarketInstall?.(it.id, projectPath);
      if (r?.ok) {
        setInstalled((prev) => ({ ...prev, [it.id]: r.name || it.name }));
        setNotice({ kind: "ok", text: t("已安装 ", "Installed ") + (r.name || it.name) + t(" 到 Plugins/", " to Plugins/") });
      } else {
        setNotice({ kind: "err", text: t("安装失败：", "Install failed: ") + (r?.error || "unknown") });
      }
    } catch (e: any) { setNotice({ kind: "err", text: t("安装失败：", "Install failed: ") + (e?.message || e) }); }
    setBusyId(null);
    setTimeout(() => setNotice(null), 6000);
  };

  const openPluginsDir = () => { if (projectPath) window.api.ensureDirAndOpen?.(projectPath + "/Plugins"); };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Package}
        title={t("插件市场", "Marketplace")}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {t("社区分享、一键装入当前工程", "Community-shared, one-click into the current project")}
            <Hint>
              {t("去中心化、开放免费。任何人给插件仓库打上 GitHub topic ", "Decentralized and free. Anyone can publish by adding the GitHub topic ")}
              <button onClick={() => window.api.openExternal?.("https://github.com/topics/ue-coworker-plugin")} className="text-accent-brand hover:underline font-mono">ue-coworker-plugin</button>
              {t(" 即可自助上架。安装即把仓库内插件目录下载到当前工程 ", " to self-publish. Installing downloads the plugin folder into the project's ")}
              <code className="text-[10px] bg-muted px-1 rounded">Plugins/</code>
              {t("，重启编辑器后生效。", "; restart the editor to apply.")}
            </Hint>
          </span>
        }
        actions={
          <>
            {projectPath && (
              <GhostButton onClick={openPluginsDir} title={t("打开工程 Plugins 目录", "Open project Plugins folder")}>
                <FolderOpen size={12} /> Plugins
              </GhostButton>
            )}
            <GhostButton onClick={() => run(query)} title={t("刷新", "Refresh")}>
              <RefreshCw size={12} /> {t("刷新", "Refresh")}
            </GhostButton>
          </>
        }
      />

      {!projectPath && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-500 text-xs">
          <AlertTriangle size={13} className="shrink-0" />
          <span>{t("尚未打开工程。插件将装入所打开工程的 Plugins/ 目录,请先打开一个 UE 工程。", "No project open. Plugins install into the opened project's Plugins/ — open a UE project first.")}</span>
        </div>
      )}

      <form className="relative" onSubmit={(e) => { e.preventDefault(); run(query); }}>
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={t("搜索插件（名称 / 介绍 / 作者，回车搜索）", "Search plugins (name / desc / author, press Enter)")}
          className={cn(INPUT_CLS, "pl-9")} />
      </form>

      {notice && (
        <div className={cn("flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs",
          notice.kind === "ok" ? "bg-emerald-500/10 text-emerald-500" : "bg-destructive/10 text-destructive")}>
          {notice.kind === "ok" ? <Check size={13} /> : <AlertTriangle size={13} />}<span>{notice.text}</span>
        </div>
      )}

      {loading ? (
        <LoadingRow t={t} />
      ) : error ? (
        <div className="text-center py-10 px-4 space-y-2">
          <AlertTriangle size={24} className="mx-auto text-destructive/60" />
          <p className="text-xs text-destructive">{t("加载失败：", "Failed: ")}{error}</p>
          <button onClick={() => run(query)} className="text-xs text-accent-brand hover:underline">{t("重试", "Retry")}</button>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 px-4 space-y-4">
          <Package size={30} className="mx-auto text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">{t("还没有插件。换个关键词,或用顶部「自己做插件」从零做一个。", "No plugins yet. Try another keyword, or use “Make a plugin” above.")}</p>
          <div className="flex items-center justify-center">
            <GhostButton onClick={() => window.api.openExternal?.("https://github.com/topics/ue-coworker-plugin")}>
              <Upload size={13} /> {t("上架我的插件", "Publish mine")}
            </GhostButton>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((it) => {
            const done = !!installed[it.id];
            return (
              <SoftCard key={it.id} className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Package size={16} className="text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-foreground flex items-center gap-1.5">
                      <span className="truncate">{it.name}</span>
                      <button onClick={() => window.api.openExternal?.(it.repoUrl)} title={it.repoUrl}
                        className="text-muted-foreground/60 hover:text-foreground shrink-0 transition-colors"><ExternalLink size={12} /></button>
                    </div>
                    <div className={cn("text-[11px] line-clamp-2 mt-0.5", !it.description ? "text-muted-foreground/50 italic" : "text-muted-foreground")}>
                      {it.description || t("（无介绍）", "(no description)")}
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 mt-1 flex items-center gap-2.5 flex-wrap">
                      <span className="truncate max-w-[140px] font-mono">{it.repo}</span>
                      {typeof it.stars === "number" && <span className="flex items-center gap-0.5"><Star size={9} />{it.stars >= 1000 ? (it.stars / 1000).toFixed(1) + "k" : it.stars}</span>}
                      {it.updatedAt && <span className="flex items-center gap-0.5"><Clock size={9} />{String(it.updatedAt).slice(0, 10)}</span>}
                    </div>
                  </div>
                </div>
                {done ? (
                  <div className="mt-auto flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg bg-emerald-500/10 text-emerald-500 font-medium">
                    <Check size={12} />{t("已安装", "Installed")}
                  </div>
                ) : (
                  <PrimaryButton onClick={() => install(it)} disabled={busyId === it.id || !projectPath} className="mt-auto w-full">
                    {busyId === it.id ? <><Loader2 size={11} className="animate-spin" />{t("安装中…", "Installing…")}</>
                      : <><Download size={11} />{t("安装", "Install")}</>}
                  </PrimaryButton>
                )}
              </SoftCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 通用空态 / 加载态(柔和、克制)。
function EmptyHint({ icon: Icon, text }: { icon: typeof Package; text: string }) {
  return (
    <div className="text-center py-12 px-4 space-y-3">
      <Icon size={30} className="mx-auto text-muted-foreground/30" />
      <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">{text}</p>
    </div>
  );
}

function LoadingRow({ t }: { t: (zh: string, en: string) => string }) {
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground text-xs">
      <Loader2 size={14} className="animate-spin mr-2" /> {t("加载中…", "Loading…")}
    </div>
  );
}
