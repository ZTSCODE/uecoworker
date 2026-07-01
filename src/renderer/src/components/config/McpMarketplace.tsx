import { useState, useEffect, useCallback } from "react";
import {
  Server, Search, Plus, Trash2, ChevronDown, RefreshCw, Check, X,
  Loader2, Plug, AlertTriangle, Wrench, Globe, Terminal, ExternalLink, Package, FolderOpen,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useT, tr } from "../../lib/i18n";
import { PageHeader, GhostButton, Tabs } from "../ui/settings";
import type { McpServerConfig, McpStatusRow, McpRegistryItem } from "../../../../preload/index.d";

// 真实 MCP 设置面板：管理 ~/userData/ue-coworker-mcp.json 里的服务器，连接官方
// @modelcontextprotocol/sdk 客户端，展示实时连接状态与已发现的工具。
// 目录（CATALOG）只是「一键填好配置」的模板（真实 npx 命令），不是假开关。

interface CatalogItem {
  id: string;
  name: string;
  // description/argHint 为中文、descriptionEn/argHintEn 为英文；渲染时按当前界面语言择一显示，
  // 不在模块级用 tr() 预先固化（否则切语言后目录文案不更新）。
  description: string;
  descriptionEn: string;
  command: string;
  args: string[];
  envKeys?: string[];     // 需要填写的环境变量名（API key 等）
  argHint?: string;       // 需要用户补充的参数说明（如路径）
  argHintEn?: string;
}

// 官方 / 社区常用 MCP 服务器（均为 npx 可直接拉起的 stdio server）。
var CATALOG: CatalogItem[] = [
  { id: "filesystem", name: "Filesystem", description: "受限目录内的文件读写操作", descriptionEn: "Read/write files within a restricted directory", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."], argHint: "把最后一个参数改成要开放的目录", argHintEn: "Change the last argument to the directory to expose" },
  { id: "github", name: "GitHub", description: "仓库、Issue、PR、Actions 管理", descriptionEn: "Manage repos, issues, PRs and Actions", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], envKeys: ["GITHUB_PERSONAL_ACCESS_TOKEN"] },
  { id: "git", name: "Git", description: "本地 Git 仓库操作（log/diff/blame 等）", descriptionEn: "Local Git operations (log/diff/blame, etc.)", command: "npx", args: ["-y", "mcp-server-git", "--repository", "."], argHint: "把 --repository 改成仓库路径", argHintEn: "Change --repository to your repo path" },
  { id: "memory", name: "Memory", description: "持久化知识图谱记忆", descriptionEn: "Persistent knowledge-graph memory", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] },
  { id: "sequential-thinking", name: "Sequential Thinking", description: "复杂问题的分步推理", descriptionEn: "Step-by-step reasoning for complex problems", command: "npx", args: ["-y", "@modelcontextprotocol/server-sequential-thinking"] },
  { id: "fetch", name: "Fetch", description: "抓取网页并转为适合模型阅读的内容", descriptionEn: "Fetch web pages and convert them into model-readable content", command: "npx", args: ["-y", "mcp-server-fetch"] },
  { id: "brave-search", name: "Brave Search", description: "Brave API 的 Web/本地搜索", descriptionEn: "Web/local search via the Brave API", command: "npx", args: ["-y", "@modelcontextprotocol/server-brave-search"], envKeys: ["BRAVE_API_KEY"] },
  { id: "postgres", name: "PostgreSQL", description: "查询/管理 PostgreSQL 数据库", descriptionEn: "Query/manage PostgreSQL databases", command: "npx", args: ["-y", "@modelcontextprotocol/server-postgres"], argHint: "追加数据库连接串参数", argHintEn: "Append a database connection string argument" },
  { id: "sqlite", name: "SQLite", description: "查询/管理 SQLite 数据库", descriptionEn: "Query/manage SQLite databases", command: "npx", args: ["-y", "mcp-server-sqlite", "--db-path", "./data.db"], argHint: "把 --db-path 改成你的 .db 路径", argHintEn: "Change --db-path to your .db path" },
  { id: "puppeteer", name: "Puppeteer", description: "浏览器自动化与网页抓取", descriptionEn: "Browser automation and web scraping", command: "npx", args: ["-y", "@modelcontextprotocol/server-puppeteer"] },
  { id: "playwright", name: "Playwright", description: "微软官方浏览器自动化：通过无障碍快照操控网页（点击/填表/导航/抓取）", descriptionEn: "Microsoft's official browser automation: drive web pages via accessibility snapshots (click/fill/navigate/scrape)", command: "npx", args: ["@playwright/mcp@latest"], argHint: "首次使用需先运行 npx playwright install 安装浏览器；可加 --headless 无头运行", argHintEn: "First run requires npx playwright install to install browsers; add --headless to run headless" },
  { id: "slack", name: "Slack", description: "发送消息、搜索频道、管理工作区", descriptionEn: "Send messages, search channels, manage workspaces", command: "npx", args: ["-y", "@modelcontextprotocol/server-slack"], envKeys: ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"] },
];

function rowStatusColor(status?: string): string {
  if (status === "connected") return "bg-green-500";
  if (status === "connecting") return "bg-yellow-500";
  if (status === "error") return "bg-destructive";
  return "bg-muted-foreground/30";
}

export function McpMarketplace() {
  var t = useT();
  var [servers, setServers] = useState<McpServerConfig[]>([]);
  var [status, setStatus] = useState<Record<string, McpStatusRow>>({});
  var [loading, setLoading] = useState(true);
  var [busyId, setBusyId] = useState<string | null>(null);
  var [reconnecting, setReconnecting] = useState(false);
  var [expandedId, setExpandedId] = useState<string | null>(null);
  var [searchQuery, setSearchQuery] = useState("");
  var [showAdd, setShowAdd] = useState(false);
  // 编辑模式：存正在编辑的服务器配置（打开预填对话框）；null=不在编辑。
  var [editing, setEditing] = useState<McpServerConfig | null>(null);
  var [tab, setTab] = useState<"installed" | "catalog" | "registry">("installed");
  var [notice, setNotice] = useState<string | null>(null);
  // 在线市场（官方注册表）状态。
  var [regItems, setRegItems] = useState<McpRegistryItem[]>([]);
  var [regLoading, setRegLoading] = useState(false);
  var [regError, setRegError] = useState<string | null>(null);
  var [regQuery, setRegQuery] = useState("");
  var [regSearched, setRegSearched] = useState(false);   // 是否已发起过一次搜索（区分「未搜索」与「搜了无结果」）

  var api = (window as any).api;

  var refreshStatus = useCallback(async function () {
    try {
      var rows: McpStatusRow[] = await api.mcpStatus();
      var map: Record<string, McpStatusRow> = {};
      (rows || []).forEach(function (r) { map[r.id] = r; });
      setStatus(map);
    } catch (e) {}
  }, [api]);

  var load = useCallback(async function () {
    setLoading(true);
    try {
      var list: McpServerConfig[] = await api.mcpList();
      setServers(Array.isArray(list) ? list : []);
    } catch (e) { setServers([]); }
    await refreshStatus();
    setLoading(false);
  }, [api, refreshStatus]);

  useEffect(function () { load(); }, [load]);
  // 连接状态轮询（连接需要时间，子进程拉起后工具才出现）。
  useEffect(function () {
    var t = setInterval(refreshStatus, 2500);
    return function () { clearInterval(t); };
  }, [refreshStatus]);

  var flash = function (msg: string) { setNotice(msg); setTimeout(function () { setNotice(null); }, 4000); };

  var persist = useCallback(async function (next: McpServerConfig[]) {
    setServers(next);
    await api.mcpSave(next);
  }, [api]);

  // 添加一条服务器配置（去重 id），保存后若启用则立即尝试连接。
  var addServer = useCallback(async function (cfg: McpServerConfig) {
    var id = cfg.id;
    if (servers.some(function (s) { return s.id === id; })) {
      // id 冲突 → 追加数字后缀。
      var n = 2;
      while (servers.some(function (s) { return s.id === id + "-" + n; })) n++;
      id = id + "-" + n;
      cfg = Object.assign({}, cfg, { id: id });
    }
    var next = servers.concat([cfg]);
    await persist(next);
    setTab("installed");
    if (cfg.enabled) { setBusyId(id); try { await api.mcpConnect(cfg); } catch (e) {} setBusyId(null); }
    await refreshStatus();
    flash(tr("已添加 ", "Added ") + id + (cfg.enabled ? tr("，正在连接…", " — connecting…") : ""));
  }, [servers, persist, api, refreshStatus]);

  var removeServer = useCallback(async function (id: string) {
    try { await api.mcpDisconnect(id); } catch (e) {}
    await persist(servers.filter(function (s) { return s.id !== id; }));
    await refreshStatus();
  }, [servers, persist, api, refreshStatus]);

  // 编辑已有服务器：按原 id 覆盖整条配置，先断开旧连接，启用则用新配置重连。
  // 用于给一键装的服务器补填密钥/参数。
  var updateServer = useCallback(async function (origId: string, cfg: McpServerConfig) {
    try { await api.mcpDisconnect(origId); } catch (e) {}
    var next = servers.map(function (s) { return s.id === origId ? cfg : s; });
    await persist(next);
    if (cfg.enabled) { setBusyId(cfg.id); try { await api.mcpConnect(cfg); } catch (e) {} setBusyId(null); }
    await refreshStatus();
    flash(tr("已更新 ", "Updated ") + cfg.id);
  }, [servers, persist, api, refreshStatus]);

  // 启用/停用：更新配置并连接或断开。
  var toggleEnabled = useCallback(async function (id: string) {
    var target = servers.find(function (s) { return s.id === id; });
    if (!target) return;
    var nextCfg = Object.assign({}, target, { enabled: !target.enabled });
    await persist(servers.map(function (s) { return s.id === id ? nextCfg : s; }));
    setBusyId(id);
    try {
      if (nextCfg.enabled) await api.mcpConnect(nextCfg);
      else await api.mcpDisconnect(id);
    } catch (e) {}
    setBusyId(null);
    await refreshStatus();
  }, [servers, persist, api, refreshStatus]);

  var reconnect = useCallback(async function (id: string) {
    var target = servers.find(function (s) { return s.id === id; });
    if (!target) return;
    setBusyId(id);
    try { await api.mcpConnect(target); } catch (e) {}
    setBusyId(null);
    await refreshStatus();
  }, [servers, api, refreshStatus]);

  var reconnectAll = useCallback(async function () {
    setReconnecting(true);
    try { await api.mcpReconnectAll(); } catch (e) {}
    setReconnecting(false);
    await refreshStatus();
    flash(tr("已重新连接全部服务器", "Reconnected all servers"));
  }, [api, refreshStatus]);

  var connectedCount = servers.filter(function (s) { return status[s.id]?.status === "connected"; }).length;
  var totalTools = Object.values(status).reduce(function (n, r) { return n + (r.tools?.length || 0); }, 0);

  var catalogFiltered = CATALOG.filter(function (c) {
    if (!searchQuery) return true;
    var q = searchQuery.toLowerCase();
    return c.name.toLowerCase().indexOf(q) !== -1 || c.description.toLowerCase().indexOf(q) !== -1 || c.descriptionEn.toLowerCase().indexOf(q) !== -1;
  });

  // 在线市场：查官方 MCP 注册表（registry.modelcontextprotocol.io）。必须有关键词。
  var runRegistrySearch = useCallback(async function (q?: string) {
    var query = (q || "").trim();
    // 空查询不请求：注册表空查询返回按字母序的前 N 条（被误认为「固定广告」）。
    if (!query) { setRegItems([]); setRegSearched(false); setRegError(null); return; }
    setRegLoading(true); setRegError(null); setRegSearched(true);
    try {
      var r = await api.mcpRegistrySearch(query);
      var items = Array.isArray(r?.items) ? r.items : [];
      // 注册表对查询的匹配较宽松，仍可能混入弱相关项。客户端再按关键词做相关性过滤：
      // 名称/标题/描述/作者须命中全部关键词，剔除噪声。
      var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      items = items.filter(function (it: McpRegistryItem) {
        var hay = ((it.title || "") + " " + (it.name || "") + " " + (it.description || "") + " " + (it.author || "")).toLowerCase();
        return terms.every(function (t: string) { return hay.indexOf(t) >= 0; });
      });
      setRegItems(items);
    } catch (e: any) {
      setRegError(e?.message || String(e));
      setRegItems([]);
    }
    setRegLoading(false);
  }, [api]);

  // 不再「切到在线市场就自动加载」：空查询时注册表返回的是按字母序的前 N 条
  // （ac.inference.sh / ai.adadvisor / ai.agentic-news / ai.agenticshelf 等），
  // 看起来像「固定广告」。改为必须输入关键词搜索才请求，空查询展示引导文案。

  // 从注册表条目一键添加：直接用其预置的 install 草稿（密钥占位留空，需用户补）。
  var addFromRegistry = useCallback(function (it: McpRegistryItem) {
    var cfg = Object.assign({}, it.install, { enabled: !it.requiresInput });
    addServer(cfg);
    if (it.requiresInput) flash(tr("已添加 ", "Added ") + cfg.id + tr("，请到「已安装」补全密钥/参数后启用", " — fill in keys/args under \"Installed\", then enable"));
  }, [addServer]);

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Server}
        title={t("MCP 服务器", "MCP Servers")}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {t("为 Agent 扩展工具", "Extend the agent with more tools")}
            <span className="text-muted-foreground/70">· {t("已连接", "Connected")} <strong className="text-foreground">{connectedCount}</strong>/{servers.length} · <strong className="text-foreground">{totalTools}</strong> {t("工具", "tools")}</span>
          </span>
        }
        actions={
          <>
            <GhostButton onClick={async function () {
              try { var p = await api.mcpConfigPath(); if (p) api.showInFolder(p); } catch (e) {}
            }} title={t("打开配置文件目录", "Open config folder")}>
              <FolderOpen size={12} />
              <span>{t("配置目录", "Config folder")}</span>
            </GhostButton>
            <GhostButton onClick={reconnectAll} disabled={reconnecting} title={t("全部重连", "Reconnect all")}>
              {reconnecting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              <span>{t("全部重连", "Reconnect all")}</span>
            </GhostButton>
          </>
        }
      />

      {notice && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 text-xs">
          <Check size={13} /><span>{notice}</span>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(v) => setTab(v)}
        tabs={[
          { value: "installed", label: t("已安装", "Installed"), badge: servers.length > 0 ? <span className="text-[10px] opacity-60">({servers.length})</span> : undefined },
          { value: "registry", label: t("在线市场", "Marketplace") },
          { value: "catalog", label: t("常用", "Featured") },
        ]}
        action={tab === "installed" ? (
          <button onClick={function () { setShowAdd(true); }}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity whitespace-nowrap">
            <Plus size={12} /><span>{t("自定义", "Custom")}</span>
          </button>
        ) : undefined}
      />

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-xs">
          <Loader2 size={14} className="animate-spin mr-2" /> {t("加载中…", "Loading…")}
        </div>
      ) : tab === "installed" ? (
        servers.length === 0 ? (
          <div className="text-center py-10 px-4 space-y-2">
            <Server size={28} className="mx-auto text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">{t("还没有配置任何 MCP 服务器。", "No MCP servers configured yet.")}</p>
            <button onClick={function () { setTab("catalog"); }}
              className="text-xs text-accent-brand hover:underline">{t("从目录添加一个 →", "Add one from the catalog →")}</button>
          </div>
        ) : (
          <div className="space-y-2">
            {servers.map(function (srv) {
              var st = status[srv.id];
              var tools = st?.tools || [];
              var isBusy = busyId === srv.id;
              return (
                <div key={srv.id}
                  className={cn("rounded-lg border transition-colors",
                    st?.status === "connected" ? "border-green-500/30 bg-green-500/[0.04]"
                      : st?.status === "error" ? "border-destructive/30 bg-destructive/[0.03]" : "border-border bg-card")}>
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <span className={cn("w-2 h-2 rounded-full shrink-0", rowStatusColor(st?.status))} />
                    {srv.url ? <Globe size={14} className="text-muted-foreground shrink-0" /> : <Terminal size={14} className="text-muted-foreground shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground flex items-center gap-2">
                        {srv.id}
                        {st?.status === "connected" && tools.length > 0 && (
                          <span className="text-[10px] text-emerald-500 flex items-center gap-0.5"><Wrench size={9} />{tools.length}</span>
                        )}
                        {isBusy && <Loader2 size={11} className="animate-spin text-muted-foreground" />}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate font-mono">
                        {srv.url ? srv.url : [srv.command].concat(srv.args || []).join(" ")}
                      </div>
                      {st?.status === "error" && st.error && (
                        <div className="text-[10px] text-destructive truncate mt-0.5 flex items-center gap-1">
                          <AlertTriangle size={9} className="shrink-0" />{st.error}
                        </div>
                      )}
                    </div>
                    {/* 启用开关 */}
                    <button onClick={function () { toggleEnabled(srv.id); }} disabled={isBusy}
                      title={srv.enabled ? t("已启用，点击停用", "Enabled — click to disable") : t("点击启用并连接", "Click to enable and connect")}
                      className={cn("w-9 h-5 rounded-full relative transition-colors shrink-0",
                        srv.enabled ? "bg-foreground" : "bg-muted-foreground/30")}>
                      <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-background transition-all",
                        srv.enabled ? "left-[18px]" : "left-0.5")} />
                    </button>
                    <button onClick={function () { setExpandedId(expandedId === srv.id ? null : srv.id); }}
                      className="p-1 rounded hover:bg-accent text-muted-foreground shrink-0">
                      <ChevronDown size={14} className={cn("transition-transform", expandedId === srv.id && "rotate-180")} />
                    </button>
                  </div>

                  {expandedId === srv.id && (
                    <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/50">
                      {/* 工具列表 */}
                      {tools.length > 0 ? (
                        <div className="space-y-1">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("工具", "Tools")}（{tools.length}）</div>
                          {tools.map(function (tool) {
                            return (
                              <div key={tool.name} className="flex items-start gap-2 text-[11px]">
                                <Wrench size={10} className="text-muted-foreground mt-0.5 shrink-0" />
                                <span className="font-mono text-foreground shrink-0">{tool.name}</span>
                                <span className="text-muted-foreground truncate">{tool.description}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          {st?.status === "connected" ? t("该服务器未暴露工具。", "This server exposes no tools.") : st?.status === "error" ? t("连接失败，检查命令/密钥后重试。", "Connection failed — check the command/keys and retry.") : t("未连接。", "Not connected.")}
                        </p>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button onClick={function () { reconnect(srv.id); }} disabled={isBusy}
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-accent text-foreground hover:bg-accent/70 transition-colors disabled:opacity-50">
                          {isBusy ? <Loader2 size={10} className="animate-spin" /> : <Plug size={10} />}<span>{t("重新连接", "Reconnect")}</span>
                        </button>
                        <button onClick={function () { setEditing(srv); }}
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-accent text-foreground hover:bg-accent/70 transition-colors">
                          <Wrench size={10} /><span>{t("编辑", "Edit")}</span>
                        </button>
                        <button onClick={function () { removeServer(srv.id); }}
                          className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded text-destructive hover:bg-destructive/10 transition-colors">
                          <Trash2 size={10} /><span>{t("移除", "Remove")}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : tab === "catalog" ? (
        // 常用模板
        <div className="space-y-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={searchQuery} onChange={function (e) { setSearchQuery((e.target as HTMLInputElement).value); }}
              placeholder={t("搜索 MCP 服务器…", "Search MCP servers…")}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring text-foreground placeholder:text-muted-foreground" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {catalogFiltered.map(function (c) {
              var installed = servers.some(function (s) { return s.id === c.id || (s.command === c.command && JSON.stringify(s.args) === JSON.stringify(c.args)); });
              return (
                <div key={c.id} className="rounded-lg border border-border bg-card p-3 flex flex-col gap-2">
                  <div className="flex items-start gap-2">
                    <Server size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">{c.name}</div>
                      <div className="text-[10px] text-muted-foreground">{t(c.description, c.descriptionEn)}</div>
                    </div>
                  </div>
                  {(c.envKeys || c.argHint) && (
                    <div className="text-[10px] text-yellow-600/90 dark:text-yellow-500/90 flex items-start gap-1">
                      <AlertTriangle size={9} className="mt-0.5 shrink-0" />
                      <span>{c.envKeys ? t("需配置：", "Requires: ") + c.envKeys.join(", ") : t(c.argHint || "", c.argHintEn || c.argHint || "")}</span>
                    </div>
                  )}
                  <button
                    onClick={function () {
                      var env: Record<string, string> = {};
                      (c.envKeys || []).forEach(function (k) { env[k] = ""; });
                      addServer({ id: c.id, enabled: !c.envKeys, command: c.command, args: c.args.slice(), env: c.envKeys ? env : undefined });
                    }}
                    disabled={installed}
                    className={cn("mt-auto flex items-center justify-center gap-1 px-2.5 py-1 text-[11px] rounded font-medium transition-colors",
                      installed ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-foreground text-background hover:opacity-90")}>
                    {installed ? <><Check size={10} />{t("已添加", "Added")}</> : <><Plus size={10} />{t("添加", "Add")}</>}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {t("添加后到「已安装」里启用。需要密钥的服务器请先在配置里填好 env 再启用。", "After adding, enable it under \"Installed\". For servers that need keys, fill in the env in the config before enabling.")}
          </p>
        </div>
      ) : (
        // 在线市场：官方 MCP 注册表实时搜索
        <div className="space-y-3">
          <form className="relative" onSubmit={function (e) { e.preventDefault(); runRegistrySearch(regQuery); }}>
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={regQuery} onChange={function (e) { setRegQuery((e.target as HTMLInputElement).value); }}
              placeholder={t("搜索官方注册表（回车搜索）…", "Search the official registry (press Enter)…")}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring text-foreground placeholder:text-muted-foreground" />
          </form>

          {regLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-xs">
              <Loader2 size={14} className="animate-spin mr-2" /> {t("搜索中…", "Searching…")}
            </div>
          ) : regError ? (
            <div className="text-center py-8 px-4 space-y-2">
              <AlertTriangle size={24} className="mx-auto text-destructive/60" />
              <p className="text-xs text-destructive">{t("搜索失败：", "Search failed: ")}{regError}</p>
              <button onClick={function () { runRegistrySearch(regQuery); }} className="text-xs text-accent-brand hover:underline">{t("重试", "Retry")}</button>
            </div>
          ) : regItems.length === 0 ? (
            <div className="text-center py-10 text-xs text-muted-foreground">
              {regSearched ? t("没有结果，换个关键词试试。", "No results — try another keyword.") : t("输入关键词搜索官方 MCP 注册表。", "Type a keyword to search the official MCP registry.")}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 auto-rows-fr items-stretch">
              {regItems.map(function (it) {
                var installed = servers.some(function (s) { return s.id === it.install.id; });
                return (
                  <div key={it.id} className="rounded-lg border border-border bg-card p-3 flex flex-col gap-2 h-full">
                    <div className="flex items-start gap-2">
                      <Package size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
                          <span className="truncate">{it.title || it.name}</span>
                          {it.repoUrl && (
                            <button onClick={function () { api.openExternal(it.repoUrl); }} title={it.repoUrl}
                              className="text-muted-foreground hover:text-foreground shrink-0"><ExternalLink size={11} /></button>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground line-clamp-2">{it.description}</div>
                        <div className="text-[10px] text-muted-foreground/70 mt-0.5 flex items-center gap-2 flex-wrap">
                          {it.author && <span className="truncate max-w-[120px]">{it.author}</span>}
                          <span className="px-1 rounded bg-muted">{it.transport}</span>
                          {it.version && <span>v{it.version}</span>}
                        </div>
                      </div>
                    </div>
                    {it.requiresInput && it.inputHints.length > 0 && (
                      <div className="text-[10px] text-yellow-600/90 dark:text-yellow-500/90 flex items-start gap-1">
                        <AlertTriangle size={9} className="mt-0.5 shrink-0" />
                        <span>{t("需配置：", "Requires: ")}{it.inputHints.join(", ")}</span>
                      </div>
                    )}
                    <button onClick={function () { addFromRegistry(it); }} disabled={installed}
                      className={cn("mt-auto flex items-center justify-center gap-1 px-2.5 py-1 text-[11px] rounded font-medium transition-colors",
                        installed ? "bg-muted text-muted-foreground cursor-not-allowed" : "bg-foreground text-background hover:opacity-90")}>
                      {installed ? <><Check size={10} />{t("已添加", "Added")}</> : <><Plus size={10} />{t("添加", "Add")}</>}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            {t("数据来自官方 MCP 注册表 registry.modelcontextprotocol.io。添加后到「已安装」里补全密钥再启用。", "Data from the official MCP registry registry.modelcontextprotocol.io. After adding, fill in keys under \"Installed\" before enabling.")}
          </p>
        </div>
      )}

      {showAdd && <AddServerDialog onClose={function () { setShowAdd(false); }} onAdd={function (cfg) { setShowAdd(false); addServer(cfg); }} />}
      {editing && <AddServerDialog initial={editing} onClose={function () { setEditing(null); }} onAdd={function (cfg) { var origId = editing!.id; setEditing(null); updateServer(origId, cfg); }} />}
    </div>
  );
}

// 自定义服务器对话框：支持 stdio（command/args/env）与远程（url/headers）。
// 传 initial 进入编辑模式：预填字段、按原 id 覆盖（id 锁定不可改，保证工具前缀稳定）。
function AddServerDialog({ onClose, onAdd, initial }: { onClose: () => void; onAdd: (cfg: McpServerConfig) => void; initial?: McpServerConfig; }) {
  var t = useT();
  // env/headers 对象回填成「KEY=value」每行文本（parseKv 的逆操作）。
  var kvToText = function (obj?: Record<string, string>): string {
    if (!obj) return "";
    return Object.keys(obj).map(function (k) { return k + "=" + obj[k]; }).join("\n");
  };
  var isEdit = !!initial;
  var initKind: "stdio" | "remote" = initial && initial.url ? "remote" : "stdio";
  var [kind, setKind] = useState<"stdio" | "remote">(initKind);
  var [id, setId] = useState(initial ? initial.id : "");
  var [command, setCommand] = useState(initial && initial.command ? initial.command : "npx");
  var [argsText, setArgsText] = useState(initial && initial.args ? initial.args.join(" ") : "");
  var [envText, setEnvText] = useState(kvToText(initial ? initial.env : undefined));
  var [url, setUrl] = useState(initial && initial.url ? initial.url : "");
  var [headersText, setHeadersText] = useState(kvToText(initial ? (initial as any).headers : undefined));

  function parseKv(text: string): Record<string, string> {
    var out: Record<string, string> = {};
    text.split(/\n+/).forEach(function (line) {
      var i = line.indexOf("=");
      if (i === -1) i = line.indexOf(":");
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
    return out;
  }

  var canSubmit = id.trim() && (kind === "stdio" ? command.trim() : url.trim());

  var submit = function () {
    if (!canSubmit) return;
    // 编辑模式保留原 enabled 状态；新增默认 enabled:true。
    var enabled = initial ? !!initial.enabled : true;
    if (kind === "stdio") {
      var args = argsText.split(/\s+/).filter(Boolean);
      var env = parseKv(envText);
      onAdd({ id: id.trim(), enabled: enabled, command: command.trim(), args: args, env: Object.keys(env).length ? env : undefined });
    } else {
      var headers = parseKv(headersText);
      onAdd({ id: id.trim(), enabled: enabled, url: url.trim(), type: "http", headers: Object.keys(headers).length ? headers : undefined });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onMouseDown={onClose}>
      <div className="w-[480px] max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl p-5 space-y-4 animate-slide-up"
        onMouseDown={function (e) { e.stopPropagation(); }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{isEdit ? t("编辑 MCP 服务器", "Edit MCP Server") : t("添加 MCP 服务器", "Add MCP Server")}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground"><X size={15} /></button>
        </div>

        <div className="flex gap-1.5">
          {([["stdio", t("本地命令 (stdio)", "Local command (stdio)")], ["remote", t("远程 (HTTP/SSE)", "Remote (HTTP/SSE)")]] as const).map(function (k) {
            return (
              <button key={k[0]} onClick={function () { if (!isEdit) setKind(k[0]); }} disabled={isEdit && kind !== k[0]}
                className={cn("flex-1 px-3 py-1.5 text-xs rounded-lg border transition-colors",
                  kind === k[0] ? "border-foreground bg-accent text-foreground font-medium" : "border-border text-muted-foreground hover:text-foreground",
                  isEdit && "opacity-60 cursor-not-allowed")}>
                {k[1]}
              </button>
            );
          })}
        </div>

        <Field label={t("ID（唯一名，用作工具前缀）", "ID (unique name, used as the tool prefix)")}>
          <input value={id} disabled={isEdit} onChange={function (e) { setId((e.target as HTMLInputElement).value.replace(/[^a-zA-Z0-9_-]/g, "-")); }}
            placeholder="my-server" className={cn(inputCls, isEdit && "opacity-60 cursor-not-allowed")} />
        </Field>

        {kind === "stdio" ? (
          <>
            <Field label={t("命令", "Command")}>
              <input value={command} onChange={function (e) { setCommand((e.target as HTMLInputElement).value); }} placeholder="npx" className={inputCls} />
            </Field>
            <Field label={t("参数（空格分隔）", "Arguments (space-separated)")}>
              <input value={argsText} onChange={function (e) { setArgsText((e.target as HTMLInputElement).value); }}
                placeholder="-y @modelcontextprotocol/server-filesystem ." className={inputCls} />
            </Field>
            <Field label={t("环境变量（每行 KEY=value，可选）", "Environment variables (KEY=value per line, optional)")}>
              <textarea value={envText} onChange={function (e) { setEnvText((e.target as HTMLTextAreaElement).value); }}
                placeholder={"GITHUB_PERSONAL_ACCESS_TOKEN=ghp_..."} rows={2} className={cn(inputCls, "font-mono resize-none")} />
            </Field>
          </>
        ) : (
          <>
            <Field label="URL">
              <input value={url} onChange={function (e) { setUrl((e.target as HTMLInputElement).value); }}
                placeholder="https://mcp.example.com/mcp" className={inputCls} />
            </Field>
            <Field label={t("请求头（每行 Key: value，可选）", "Headers (Key: value per line, optional)")}>
              <textarea value={headersText} onChange={function (e) { setHeadersText((e.target as HTMLTextAreaElement).value); }}
                placeholder={"Authorization: Bearer xxx"} rows={2} className={cn(inputCls, "font-mono resize-none")} />
            </Field>
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors">{t("取消", "Cancel")}</button>
          <button onClick={submit} disabled={!canSubmit}
            className="px-3 py-1.5 text-xs rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity disabled:opacity-40">
            {isEdit ? t("保存并重连", "Save and reconnect") : t("添加并连接", "Add and connect")}
          </button>
        </div>
      </div>
    </div>
  );
}

var inputCls = "w-full px-2.5 py-1.5 text-xs bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring text-foreground placeholder:text-muted-foreground";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
