import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useAppStore } from "../../stores/app-store";
import { ProviderSettings } from "./ProviderSettings";
import { McpMarketplace } from "./McpMarketplace";
import { ContextManager } from "./ContextManager";
import { PermissionsSettings } from "./PermissionsSettings";
import { MemorySettings } from "./MemorySettings";
import { DiscordSettings } from "./DiscordSettings";
import { TelegramSettings } from "./TelegramSettings";
import { WeixinSettings } from "./WeixinSettings";
import { ConfigTransfer } from "./ConfigTransfer";
import {
  FileText, Server, Wand2, Bot, Webhook, Globe, Shield, Palette, Search, FolderOpen,
  Sun, Moon, Type, ALargeSmall, Bell, Plus, Trash2, FileCode, Brain, Radio, Send, Download, Upload, Settings, Languages,
  Loader2, ExternalLink, Star, AlertTriangle, X, Bug, Keyboard
} from "lucide-react";
import { useSearchStore, SEARCH_BACKENDS, type SearchKind } from "../../stores/search-store";
import { useProviderStore } from "../../stores/provider-store";
import { notifyEnabled, setNotifyEnabled, ensurePermission } from "../../lib/notify";
import { useLangStore, useT, tr } from "../../lib/i18n";
import { Check } from "lucide-react";
import { useEffect } from "react";
import { cn } from "../../lib/utils";
import { PageHeader, SoftCard, GhostButton, PrimaryButton, Section, Tabs, Segmented, Hint, INPUT_CLS } from "../ui/settings";

// 配置分区定义。导出供全局次级栏(SecondaryBar)横排渲染复用。
// label 为中文、labelEn 为英文，由消费方按当前界面语言择一显示。
export const configSections = [
  { id: "providers", icon: Globe, label: "API 供应商", labelEn: "API Providers" },
  { id: "search", icon: Search, label: "网络搜索", labelEn: "Web Search" },
  { id: "appearance", icon: Settings, label: "设置", labelEn: "Settings" },
  { id: "claude-md", icon: FileText, label: "CLAUDE.md", labelEn: "CLAUDE.md" },
  { id: "memory", icon: Brain, label: "记忆", labelEn: "Memory" },
  { id: "mcp", icon: Server, label: "MCP 服务器", labelEn: "MCP Servers" },
  { id: "skills", icon: Wand2, label: "Skills", labelEn: "Skills" },
  { id: "agents", icon: Bot, label: "Agents", labelEn: "Agents" },
  { id: "hooks", icon: Webhook, label: "Hooks", labelEn: "Hooks" },
  { id: "permissions", icon: Shield, label: "权限", labelEn: "Permissions" },
  { id: "links", icon: Send, label: "链接", labelEn: "Links" },
];

export function ConfigPanel() {
  const { projectPath } = useAppStore();
  const configTab = useAppStore((s) => s.configTab);
  // 当前分区改由全局 store 持有（次级栏切换、斜杠命令深链共用）。
  const activeSection = useAppStore((s) => s.configSection);
  const setActiveSection = useAppStore((s) => s.setConfigSection);

  // 斜杠命令 / 其它组件深链到指定分区（如 /mcp → "mcp"），消费后清空信号。
  useEffect(() => {
    if (configTab && configSections.some((s) => s.id === configTab)) {
      setActiveSection(configTab);
      useAppStore.setState({ configTab: null });
    }
  }, [configTab, setActiveSection]);

  if (!projectPath) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <p>Open a project to manage configuration</p>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* 竖排导航已上移到顶部统一次级栏；这里只剩内容区。顶部留白清开悬浮面板。 */}
      <div className="flex-1 overflow-y-auto px-7 pb-10 pt-[104px]">
        <div className="max-w-3xl mx-auto">
        {activeSection === "providers" && <ProviderSettings />}
        {activeSection === "search" && <SearchSettings />}
        {activeSection === "appearance" && <AppearanceSettings />}
        {activeSection === "claude-md" && <ContextManager />}
        {activeSection === "memory" && <MemorySettings />}
        {activeSection === "mcp" && <McpMarketplace />}
        {activeSection === "skills" && <SkillsSettings />}
        {activeSection === "agents" && <AgentsSettings />}
        {activeSection === "hooks" && <HooksSettings />}
        {activeSection === "permissions" && <PermissionsSettings />}
        {activeSection === "links" && <LinksSettings />}
        </div>
      </div>
    </div>
  );
}

// 「链接」分区：远程控制入口。顶部 tab 切换 Telegram / 微信 / Discord，一次只显示一个。
function LinksSettings() {
  const t = useT();
  const [tab, setTab] = useState<"telegram" | "weixin" | "discord">("telegram");
  return (
    <div className="space-y-5">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "telegram", label: "Telegram", badge: <span className="text-[9px] font-semibold uppercase text-emerald-500 bg-emerald-500/10 px-1 py-0.5 rounded">{t("推荐", "Rec")}</span> },
          { value: "weixin", label: t("微信", "WeChat") },
          { value: "discord", label: "Discord" },
        ]}
      />
      {tab === "telegram" ? <TelegramSettings /> : tab === "weixin" ? <WeixinSettings /> : <DiscordSettings />}
    </div>
  );
}

function SearchSettings() {
  const t = useT();
  const enabled = useSearchStore((s) => s.enabled);
  const hasKey = useSearchStore((s) => s.hasKey);
  const toggleEnabled = useSearchStore((s) => s.toggleEnabled);
  const setKey = useSearchStore((s) => s.setKey);
  const refreshKeyFlags = useSearchStore((s) => s.refreshKeyFlags);

  useEffect(() => { refreshKeyFlags(); }, []);

  const activeCount = SEARCH_BACKENDS.filter((b) => enabled[b.kind] && hasKey[b.kind]).length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Search}
        title={t("网络搜索", "Web Search")}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {t("默认免 key，可加 API 作为更可靠兜底", "Key-free by default; add APIs as reliable fallbacks")}
            <Hint>
              {t("Agent 的 web_search 工具默认免 key（公共 SearXNG / DuckDuckGo），但公共实例不一定稳定。启用一个或多个搜索 API 作为更可靠的兜底——搜索时按顺序逐个尝试，一个失败自动试下一个，全部失败再回落免 key。哪个上次成功，下次自动优先。密钥加密存于本机。", "The agent's web_search tool works key-free by default (public SearXNG / DuckDuckGo), but public instances aren't always reliable. Enable one or more search APIs as more reliable fallbacks — tried in order, the next on failure, falling back to key-free if all fail. Whichever succeeded last is prioritized next time. Keys are encrypted and stored locally.")}
            </Hint>
            {activeCount > 0 && <span className="text-[11px] text-emerald-500">· {t("已启用", "Enabled")} {activeCount}</span>}
          </span>
        }
      />

      <Section title={t("搜索 API（可多选）", "Search APIs (multiple allowed)")}>
        <div className="space-y-2">
          {SEARCH_BACKENDS.map((b) => (
            <SearchBackendRow
              key={b.kind}
              kind={b.kind}
              label={b.label}
              hint={t(b.hint, b.hintEn)}
              enabled={!!enabled[b.kind]}
              hasKey={!!hasKey[b.kind]}
              onToggle={(on) => toggleEnabled(b.kind, on)}
              onSaveKey={(k) => setKey(b.kind, k)}
              onClearKey={() => setKey(b.kind, "")}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

function SearchBackendRow(props: {
  kind: SearchKind;
  label: string;
  hint: string;
  enabled: boolean;
  hasKey: boolean;
  onToggle: (on: boolean) => void;
  onSaveKey: (key: string) => Promise<void> | void;
  onClearKey: () => void;
}) {
  const { label, hint, enabled, hasKey, onToggle, onSaveKey, onClearKey } = props;
  const t = useT();
  const [draft, setDraft] = useState<string | undefined>(undefined);

  const save = async () => {
    if (draft === undefined || !draft) return;
    await onSaveKey(draft);
    setDraft(undefined);
    onToggle(true); // saving a key auto-enables this backend
  };

  // A backend can only be enabled once it has a key.
  const canEnable = hasKey;

  return (
    <div className={cn("rounded-xl ring-1 transition-colors",
      enabled && hasKey ? "ring-ring/40 bg-muted/60" : "ring-border/40 bg-muted/30")}>
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <button
          onClick={() => canEnable && onToggle(!enabled)}
          disabled={!canEnable}
          title={canEnable ? (enabled ? t("已启用，点击停用", "Enabled — click to disable") : t("点击启用", "Click to enable")) : t("先填入 API key", "Enter an API key first")}
          className={cn("w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors",
            enabled && hasKey
              ? "bg-foreground border-foreground text-background"
              : "border-muted-foreground/40",
            !canEnable && "opacity-40 cursor-not-allowed")}>
          {enabled && hasKey && <Check size={11} strokeWidth={3} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-foreground flex items-center gap-1.5">
            {label}
            {hasKey && <span className="text-[10px] text-emerald-500">• {t("已配置", "Configured")}</span>}
          </div>
          <div className="text-[11px] text-muted-foreground">{hint}</div>
        </div>
      </div>
      <div className="px-3.5 pb-3 pt-0.5 flex items-center gap-2">
        <input type="password"
          value={draft !== undefined ? draft : ""}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={hasKey ? t("•••••••• (已保存，输入以替换)", "•••••••• (saved, type to replace)") : t("粘贴 ", "Paste ") + label + t(" API key", " API key")}
          className={cn(INPUT_CLS, "font-mono min-w-0 flex-1")} />
        <PrimaryButton onClick={save} disabled={!draft} className="shrink-0">
          {t("保存", "Save")}
        </PrimaryButton>
        {hasKey && (
          <button onClick={onClearKey}
            className="shrink-0 whitespace-nowrap px-2.5 py-1.5 text-[11px] text-destructive hover:bg-destructive/10 rounded-lg transition-colors">
            {t("清除", "Clear")}
          </button>
        )}
      </div>
    </div>
  );
}

// label/labelEn 在渲染时按当前语言取值（见 <option> 里 t(...)），不在模块级用 tr() 固化。
const FONT_CHOICES = [
  { label: "系统默认（无衬线）", labelEn: "System default (sans-serif)", value: "" },
  { label: "Inter", labelEn: "Inter", value: '"Inter", sans-serif' },
  { label: "system-ui", labelEn: "system-ui", value: "system-ui, sans-serif" },
  { label: "苹方 / PingFang", labelEn: "PingFang", value: '"PingFang SC", "Microsoft YaHei", sans-serif' },
  { label: "Segoe UI", labelEn: "Segoe UI", value: '"Segoe UI", sans-serif' },
  { label: "等宽 JetBrains Mono", labelEn: "JetBrains Mono (monospace)", value: '"JetBrains Mono", monospace' },
  { label: "Georgia（衬线）", labelEn: "Georgia (serif)", value: 'Georgia, serif' },
];
// Skills 面板:扫描 .claude/skills(项目+全局),列出/开关每个 skill。
// 渐进式披露——这里只管理元数据与启用态;正文由 agent 经 read_file 按需读取。
function SkillsSettings() {
  const t = useT();
  const { projectPath } = useAppStore();
  const [skills, setSkills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"installed" | "market">("installed");

  const load = () => {
    setLoading(true);
    (window.api as any).skillsList?.(projectPath).then((rows: any[]) => {
      setSkills(Array.isArray(rows) ? rows : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, [projectPath]);

  const toggle = async (id: string, enabled: boolean) => {
    setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
    try { await (window.api as any).skillsSetEnabled?.(id, enabled); } catch { load(); }
  };

  const remove = async (skill: any) => {
    try {
      const r = await (window.api as any).skillsRemove?.(skill.id, projectPath);
      if (r?.ok) setSkills((prev) => prev.filter((s) => s.id !== skill.id));
      else { alert(t("删除失败：", "Delete failed: ") + (r?.error || "unknown")); load(); }
    } catch (e: any) { alert(t("删除失败：", "Delete failed: ") + (e?.message || e)); load(); }
  };

  const projectDir = projectPath ? projectPath + "/.claude/skills" : "";
  const openDir = (dir: string) => { if (dir) window.api.openPath?.(dir); };

  const project = skills.filter((s) => s.source === "project");
  const global = skills.filter((s) => s.source === "global");

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wand2}
        title="Skills"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {t("可复用的渐进式技能，与 Claude Code 生态互通", "Reusable progressive skills, interoperable with Claude Code")}
            <Hint>
              {t("扫描 .claude/skills/（项目与全局 ~/.claude/skills/）。每个 skill 是一个含 SKILL.md 的目录。启用后，其名称与说明注入对话；当与任务相关时 AI 会自行读取完整说明（渐进式披露，省 token）。把任何公开 skill 仓库 clone 进去即可，如 ", "Scans .claude/skills/ (project and global ~/.claude/skills/). Each skill is a directory with SKILL.md. Once enabled, its name and description are injected; when relevant the AI reads the full instructions itself (progressive disclosure, saving tokens). Just clone any public skill repo in, e.g. ")}
              <button onClick={() => window.api.openExternal?.("https://github.com/anthropics/skills")} className="text-accent-brand hover:underline">anthropics/skills</button>。
            </Hint>
          </span>
        }
        actions={
          <>
            {projectPath && (
              <GhostButton onClick={() => openDir(projectDir)} title={t("打开项目 skills 目录", "Open project skills folder")}>
                <FolderOpen size={12} /> {t("打开项目 skills 目录", "Open project skills folder")}
              </GhostButton>
            )}
            <GhostButton onClick={load} title={t("重新扫描", "Rescan")}>{t("重新扫描", "Rescan")}</GhostButton>
          </>
        }
      />

      {/* Tabs：已安装 / 市场 */}
      <Tabs
        value={view}
        onChange={setView}
        tabs={[
          { value: "installed", label: t("已安装", "Installed") },
          { value: "market", label: t("市场", "Marketplace") },
        ]}
      />

      {view === "market" ? (
        <SkillMarket projectPath={projectPath ?? undefined} onInstalled={load} />
      ) : (
      <>

      {loading ? (
        <p className="text-xs text-muted-foreground">{t("扫描中…", "Scanning…")}</p>
      ) : skills.length === 0 ? (
        <div className="rounded-xl bg-muted/30 ring-1 ring-border/40 p-6 text-center space-y-1.5">
          <p className="text-xs text-foreground/80">{t("还没有任何 skill。", "No skills yet.")}</p>
          <p className="text-[11px] text-muted-foreground">
            {t("在 ", "Create ")}<code className="text-[10px] bg-muted px-1 rounded">{projectDir || "~/.claude/skills"}</code>{t(" 下创建", " under ")}
            <code className="text-[10px] bg-muted px-1 rounded mx-0.5">&lt;name&gt;/SKILL.md</code>{t(",或 clone 一个 skill 仓库进去,然后点「重新扫描」。", ", or clone a skill repo in, then click \"Rescan\".")}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {[{ label: t("项目", "Project"), rows: project }, { label: t("全局", "Global"), rows: global }].map((grp) =>
            grp.rows.length === 0 ? null : (
              <section key={grp.label} className="space-y-2">
                <h3 className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-[0.08em]">{grp.label}（{grp.rows.length}）</h3>
                {grp.rows.map((s) => (
                  <SkillRow key={s.id} skill={s} onToggle={toggle} onOpen={openDir} onDelete={remove} />
                ))}
              </section>
            )
          )}
        </div>
      )}
      </>
      )}
    </div>
  );
}


// Skill 市场:聚合 claudemarketplaces / skillsllm 等公开 API,搜索并一键下载到
// .claude/skills/。后端在 skills-market.ts(IPC: skillsMarketSearch/Install)。
function SkillMarket({ projectPath, onInstalled }: { projectPath?: string; onInstalled: () => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scope, setScope] = useState<"project" | "global">(projectPath ? "project" : "global");

  const run = async (q?: string) => {
    setLoading(true); setError(null);
    try {
      const rows = await (window.api as any).skillsMarketSearch?.(q);
      setItems(Array.isArray(rows) ? rows : []);
    } catch (e: any) { setError(e?.message || String(e)); setItems([]); }
    setLoading(false);
  };
  // 首次自动加载热门。
  useEffect(() => { run(); }, []);

  const install = async (it: any) => {
    setBusyId(it.id);
    try {
      const r = await (window.api as any).skillsMarketInstall?.(it.id, scope, projectPath);
      if (r?.ok) { setNotice(t("已安装 ", "Installed ") + it.name); onInstalled(); }
      else setNotice(t("安装失败：", "Install failed: ") + (r?.error || "unknown"));
    } catch (e: any) { setNotice(t("安装失败：", "Install failed: ") + (e?.message || e)); }
    setBusyId(null);
    setTimeout(() => setNotice(null), 5000);
  };

  return (
    <div className="space-y-3">
      <form className="relative" onSubmit={(e) => { e.preventDefault(); run(query); }}>
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={t("搜索 skill（名称 / 介绍 / 作者，回车搜索）", "Search skills (name / desc / author, press Enter)")}
          className={cn(INPUT_CLS, "pl-9")} />
      </form>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{t("安装到：", "Install to: ")}</span>
        {([["project", t("项目", "Project")], ["global", t("全局", "Global")]] as const).map((s) => (
          <button key={s[0]} onClick={() => setScope(s[0])} disabled={s[0] === "project" && !projectPath}
            className={cn("px-2.5 py-1 rounded-lg transition-colors",
              scope === s[0] ? "bg-muted ring-1 ring-ring/40 text-foreground" : "bg-muted/60 text-muted-foreground hover:text-foreground",
              s[0] === "project" && !projectPath ? "opacity-40 cursor-not-allowed" : "")}>
            {s[1]}
          </button>
        ))}
      </div>

      {notice && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 text-xs">
          <Check size={13} /><span>{notice}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground text-xs">
          <Loader2 size={14} className="animate-spin mr-2" /> {t("加载中…", "Loading…")}
        </div>
      ) : error ? (
        <div className="text-center py-8 px-4 space-y-2">
          <AlertTriangle size={24} className="mx-auto text-destructive/60" />
          <p className="text-xs text-destructive">{t("加载失败：", "Failed: ")}{error}</p>
          <button onClick={() => run(query)} className="text-xs text-accent-brand hover:underline">{t("重试", "Retry")}</button>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-10 text-xs text-muted-foreground">{t("没有结果，换个关键词试试。", "No results — try another keyword.")}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((it) => {
            const placeholder = !it.description || it.description.trim().toLowerCase() === (it.name || "").toLowerCase();
            return (
              <SoftCard key={it.id} className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <Wand2 size={15} className="text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-foreground flex items-center gap-1.5">
                      <span className="truncate">{it.name}</span>
                      <button onClick={() => window.api.openExternal?.(it.skillUrl || it.repoUrl)} title={it.repoUrl}
                        className="text-muted-foreground/60 hover:text-foreground shrink-0 transition-colors"><ExternalLink size={12} /></button>
                    </div>
                    <div className={cn("text-[11px] line-clamp-2 mt-0.5", placeholder ? "text-muted-foreground/50 italic" : "text-muted-foreground")}>
                      {placeholder ? t("（无介绍）", "(no description)") : it.description}
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 mt-1 flex items-center gap-2.5 flex-wrap">
                      <span className="truncate max-w-[140px] font-mono">{it.repo}</span>
                      {typeof it.stars === "number" && <span className="flex items-center gap-0.5"><Star size={9} />{it.stars >= 1000 ? (it.stars / 1000).toFixed(1) + "k" : it.stars}</span>}
                      {typeof it.installs === "number" && it.installs > 0 && <span className="flex items-center gap-0.5"><Download size={9} />{it.installs >= 1000 ? (it.installs / 1000).toFixed(0) + "k" : it.installs}</span>}
                    </div>
                  </div>
                </div>
                <PrimaryButton onClick={() => install(it)} disabled={busyId === it.id} className="mt-auto w-full">
                  {busyId === it.id ? <><Loader2 size={11} className="animate-spin" />{t("安装中…", "Installing…")}</> : <><Download size={11} />{t("安装", "Install")}</>}
                </PrimaryButton>
              </SoftCard>
            );
          })}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        {t("数据来自 claudemarketplaces.com 与 skillsllm.com。安装后自动出现在「已安装」，需到该列表启用。", "Data from claudemarketplaces.com and skillsllm.com. Installed skills appear under \"Installed\"; enable them there.")}
      </p>
    </div>
  );
}


function SkillRow({ skill, onToggle, onOpen, onDelete }: {
  skill: any; onToggle: (id: string, enabled: boolean) => void; onOpen: (dir: string) => void; onDelete: (skill: any) => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const hasError = !!skill.error && skill.error.indexOf("已以目录名为准") !== 0;
  return (
    <div className={cn("rounded-xl ring-1 transition-colors px-3.5 py-3",
      skill.enabled && !hasError ? "ring-ring/40 bg-muted/60" : "ring-border/40 bg-muted/30")}>
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => !hasError && onToggle(skill.id, !skill.enabled)}
          disabled={hasError}
          title={hasError ? t("解析错误,无法启用", "Parse error — cannot enable") : (skill.enabled ? t("已启用,点击停用", "Enabled — click to disable") : t("点击启用", "Click to enable"))}
          className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
            skill.enabled && !hasError ? "bg-foreground border-foreground text-background" : "border-muted-foreground/40",
            hasError && "opacity-40 cursor-not-allowed")}>
          {skill.enabled && !hasError && <Check size={11} strokeWidth={3} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground flex items-center gap-1.5">
            {skill.name}
            <span className="text-[10px] text-muted-foreground font-normal">{skill.source}</span>
          </div>
          <div className="text-[11px] text-muted-foreground line-clamp-2">{skill.description || t("(无 description)", "(no description)")}</div>
          {skill.error && (
            <div className={cn("text-[10px] mt-0.5", hasError ? "text-destructive" : "text-amber-500")}>{skill.error}</div>
          )}
        </div>
        <button onClick={() => onOpen(skill.dir)} title={t("打开目录", "Open folder")}
          className="shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
          <FolderOpen size={13} />
        </button>
        {confirming ? (
          <span className="shrink-0 flex items-center gap-1">
            <button onClick={() => onDelete(skill)} title={t("确认删除", "Confirm delete")}
              className="px-1.5 py-0.5 text-[10px] rounded bg-destructive text-white hover:opacity-90 transition-opacity">
              {t("删除", "Delete")}
            </button>
            <button onClick={() => setConfirming(false)} title={t("取消", "Cancel")}
              className="p-1 rounded hover:bg-accent text-muted-foreground"><X size={12} /></button>
          </span>
        ) : (
          <button onClick={() => setConfirming(true)} title={t("删除本地文件", "Delete local files")}
            className="shrink-0 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Sub-agents：扫描 .claude/agents，列出/启停可经 task 工具派发的子 agent ----
// 仿 SkillsSettings。model 仅展示用——子 agent 永远继承父供应商,model 只能从当前
// 供应商 models[] 里选(运行期校验,不在列表则回落父模型)。
function AgentsSettings() {
  const t = useT();
  const { projectPath } = useAppStore();
  const providers = useProviderStore((s) => s.providers);
  const selectedProviderId = useProviderStore((s) => s.selectedProviderId);
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const curProvider = providers.find((p) => p.id === selectedProviderId) || providers[0];
  const providerModels: string[] = (curProvider && Array.isArray(curProvider.models)) ? curProvider.models : [];

  const load = () => {
    setLoading(true);
    (window.api as any).agentsList?.(projectPath).then((rows: any[]) => {
      setAgents(Array.isArray(rows) ? rows : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, [projectPath]);

  const toggle = async (id: string, enabled: boolean) => {
    setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, enabled } : a)));
    try { await (window.api as any).agentsSetEnabled?.(id, enabled); } catch { load(); }
  };

  const projectDir = projectPath ? projectPath + "/.claude/agents" : "";
  // agents 目录可能尚未创建：点开时先确保存在再打开，避免系统弹「找不到文件夹」。
  const openDir = (dir: string) => { if (dir) window.api.ensureDirAndOpen?.(dir); };

  const builtin = agents.filter((a) => a.source === "builtin");
  const project = agents.filter((a) => a.source === "project");
  const global = agents.filter((a) => a.source === "global");

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Bot}
        title="Sub-agents"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {t("可经 task 工具派发的子 agent，沿用当前供应商", "Sub-agents delegated via the task tool, using the current provider")}
            <Hint>
              {t("扫描 .claude/agents/（项目与全局 ~/.claude/agents/）。每个 agent 是一个含 frontmatter 的 <name>.md 文件（description 必填，可选 tools / model / mode）。启用后主 agent 可用 task 工具把子任务派发给它。子 agent 永远沿用当前供应商（同 key/协议）：只读 agent 可多个并行调查，含写 agent 串行执行；每个工具调用照走权限门。", "Scans .claude/agents/ (project and global). Each agent is a <name>.md file with frontmatter (description required; optional tools / model / mode). Once enabled, the main agent can delegate subtasks via the task tool. Sub-agents always use the current provider (same key/protocol): read-only ones can investigate in parallel, writers run serially; every tool call still goes through the permission gate.")}
            </Hint>
          </span>
        }
        actions={
          <>
            {projectPath && (
              <GhostButton onClick={() => openDir(projectDir)} title={t("打开项目 agents 目录", "Open project agents folder")}>
                <FolderOpen size={12} /> {t("打开项目 agents 目录", "Open project agents folder")}
              </GhostButton>
            )}
            <GhostButton onClick={load} title={t("重新扫描", "Rescan")}>{t("重新扫描", "Rescan")}</GhostButton>
          </>
        }
      />

      {loading ? (
        <p className="text-xs text-muted-foreground">{t("扫描中…", "Scanning…")}</p>
      ) : (
        <div className="space-y-5">
          {[{ label: t("内置", "Built-in"), rows: builtin }, { label: t("项目", "Project"), rows: project }, { label: t("全局", "Global"), rows: global }].map((grp) =>
            grp.rows.length === 0 ? null : (
              <section key={grp.label} className="space-y-2">
                <h3 className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-[0.08em]">{grp.label}（{grp.rows.length}）</h3>
                {grp.rows.map((a) => (
                  <AgentRow key={a.id} agent={a} providerModels={providerModels} onToggle={toggle} onOpen={openDir} />
                ))}
              </section>
            )
          )}
        </div>
      )}
    </div>
  );
}

function AgentRow({ agent, providerModels, onToggle, onOpen }: {
  agent: any; providerModels: string[];
  onToggle: (id: string, enabled: boolean) => void; onOpen: (dir: string) => void;
}) {
  const t = useT();
  const hasError = !!agent.error && agent.error.indexOf("已以文件名为准") !== 0;
  // model 在当前供应商列表内才会真正生效;不在列表则运行期回落父模型,这里加提示。
  const modelOk = !agent.model || providerModels.indexOf(agent.model) !== -1;
  return (
    <div className={cn("rounded-xl ring-1 transition-colors px-3.5 py-3",
      agent.enabled && !hasError ? "ring-ring/40 bg-muted/60" : "ring-border/40 bg-muted/30")}>
      <div className="flex items-center gap-2.5">
        <button
          onClick={() => !hasError && onToggle(agent.id, !agent.enabled)}
          disabled={hasError}
          title={hasError ? t("解析错误,无法启用", "Parse error — cannot enable") : (agent.enabled ? t("已启用,点击停用", "Enabled — click to disable") : t("点击启用", "Click to enable"))}
          className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors",
            agent.enabled && !hasError ? "bg-foreground border-foreground text-background" : "border-muted-foreground/40",
            hasError && "opacity-40 cursor-not-allowed")}>
          {agent.enabled && !hasError && <Check size={11} strokeWidth={3} />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground flex items-center gap-1.5 flex-wrap">
            {agent.name}
            <span className={cn("text-[9px] px-1 rounded font-normal",
              agent.mode === "read-only" ? "bg-blue-500/15 text-blue-400" : "bg-amber-500/15 text-amber-400")}>
              {agent.mode === "read-only" ? t("只读", "Read-only") : t("可写", "Writable")}
            </span>
            <span className="text-[10px] text-muted-foreground font-normal">{agent.source}</span>
            {agent.model && (
              <span className={cn("text-[9px] px-1 rounded font-mono", modelOk ? "bg-muted text-muted-foreground" : "bg-destructive/15 text-destructive")}
                title={modelOk ? t("子 agent 使用该模型(在当前供应商内)", "Sub-agent uses this model (within the current provider)") : t("当前供应商无此模型,运行时将回落到父模型", "Current provider lacks this model; will fall back to the parent model at runtime")}>
                {agent.model}{modelOk ? "" : " ⚠"}
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground line-clamp-2">{agent.description || t("(无 description)", "(no description)")}</div>
          {agent.tools && agent.tools.length > 0 && (
            <div className="text-[10px] text-muted-foreground/80 mt-0.5">{t("工具: ", "Tools: ")}<span className="font-mono">{agent.tools.join(", ")}</span></div>
          )}
          {agent.error && (
            <div className={cn("text-[10px] mt-0.5", hasError ? "text-destructive" : "text-amber-500")}>{agent.error}</div>
          )}
        </div>
        {agent.filePath && (
          <button onClick={() => onOpen(agent.filePath.replace(/[\\/][^\\/]+$/, ""))} title={t("打开所在目录", "Open containing folder")}
            className="shrink-0 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <FolderOpen size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Hooks：事件驱动自动化可视化编辑器 ----
// 读写项目 .claude/settings.json 的 hooks 字段，与 Claude Code / Codex 规范互通。
// descZh/descEn 在渲染时按当前语言取值（见 HookEventGroup 内 t(...)），不能在模块级用 tr()
// 预先固化，否则切语言后这些说明不更新。
const HOOK_EVENTS: { id: string; descZh: string; descEn: string; hasMatcher: boolean; wired: boolean }[] = [
  { id: "PreToolUse", descZh: "工具执行前触发，可拦截（命令退出码 2 或返回 deny 即阻止该工具）", descEn: "Fires before a tool runs; can intercept (exit code 2 or returning deny blocks the tool)", hasMatcher: true, wired: true },
  { id: "PostToolUse", descZh: "工具执行后触发（自动格式化、lint、日志等），不可阻止", descEn: "Fires after a tool runs (auto-format, lint, logging, etc.); cannot block", hasMatcher: true, wired: true },
  { id: "SessionStart", descZh: "每轮会话开始时触发；命令的标准输出会作为上下文注入", descEn: "Fires at the start of each session; the command's stdout is injected as context", hasMatcher: false, wired: true },
  { id: "UserPromptSubmit", descZh: "提交用户消息前触发；可注入上下文，退出码 2 拒绝该轮", descEn: "Fires before a user message is submitted; can inject context, exit code 2 rejects the turn", hasMatcher: false, wired: true },
  { id: "Stop", descZh: "本轮 agent 结束后触发（纯副作用）", descEn: "Fires after the agent finishes this turn (side effects only)", hasMatcher: false, wired: true },
  { id: "SubagentStop", descZh: "子 agent 结束后触发", descEn: "Fires after a sub-agent finishes", hasMatcher: false, wired: true },
  { id: "Notification", descZh: "需要你介入时触发（权限审批 / 提问 / 计划审批等待中），适合做桌面提醒", descEn: "Fires when your input is needed (waiting on permission approval / a question / plan approval); good for desktop reminders", hasMatcher: false, wired: true },
  { id: "PreCompact", descZh: "上下文压缩前触发；退出码 2 或返回 deny 可阻止本次压缩", descEn: "Fires before context compaction; exit code 2 or returning deny blocks the compaction", hasMatcher: false, wired: true },
];

type HookCmd = { type: "command"; command: string; timeout?: number };
type HookEntry = { matcher?: string; hooks: HookCmd[] };
type HooksCfg = Record<string, HookEntry[]>;

function HooksSettings() {
  const t = useT();
  const { projectPath } = useAppStore();
  const [cfg, setCfg] = useState<HooksCfg>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = () => {
    if (!projectPath) { setLoading(false); return; }
    setLoading(true);
    (window.api as any).hooksGet?.(projectPath).then((h: HooksCfg) => {
      setCfg(h && typeof h === "object" ? h : {});
      setLoading(false);
    }).catch(() => setLoading(false));
  };
  useEffect(() => { load(); }, [projectPath]);

  // agent 用 configure_hooks 工具改了配置 → 自动重载（无需手动「重新加载」）。
  useEffect(() => {
    const off = (window.api as any).onHooksChanged?.((data: { cwd: string }) => {
      if (!projectPath || !data || data.cwd === projectPath) load();
    });
    return () => { if (typeof off === "function") off(); };
  }, [projectPath]);

  // 任何改动后整体落盘（debounce 不必要——改动是离散的按钮/失焦操作）。
  const persist = async (next: HooksCfg) => {
    setCfg(next);
    if (!projectPath) return;
    setSaving(true);
    try { await (window.api as any).hooksSave?.(projectPath, next); } finally { setSaving(false); }
  };

  const addEntry = (event: string, hasMatcher: boolean) => {
    const next = { ...cfg };
    const groups = Array.isArray(next[event]) ? [...next[event]] : [];
    groups.push({ ...(hasMatcher ? { matcher: "*" } : {}), hooks: [{ type: "command", command: "" }] });
    next[event] = groups;
    persist(next);
  };

  const updateEntry = (event: string, idx: number, patch: Partial<HookEntry & HookCmd>) => {
    const next = { ...cfg };
    const groups = [...(next[event] || [])];
    const entry = { ...groups[idx] };
    const cmd = { ...(entry.hooks?.[0] || { type: "command" as const, command: "" }) };
    if (patch.matcher !== undefined) entry.matcher = patch.matcher;
    if (patch.command !== undefined) cmd.command = patch.command;
    if (patch.timeout !== undefined) cmd.timeout = patch.timeout;
    entry.hooks = [cmd];
    groups[idx] = entry;
    next[event] = groups;
    persist(next);
  };

  const removeEntry = (event: string, idx: number) => {
    const next = { ...cfg };
    const groups = [...(next[event] || [])];
    groups.splice(idx, 1);
    if (groups.length) next[event] = groups; else delete next[event];
    persist(next);
  };

  if (!projectPath) {
    return <p className="text-xs text-muted-foreground">{t("打开一个项目以配置 hooks。", "Open a project to configure hooks.")}</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Webhook}
        title="Hooks"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {t("在 agent 生命周期关键点自动运行命令", "Run commands automatically at key agent lifecycle moments")}
            <Hint>
              {t("事件驱动自动化：命令通过 stdin 收到事件 JSON，退出码 2 可阻止工具执行（仅 PreToolUse）。配置存于项目 .claude/settings.json，与 Claude Code / Codex 互通——对所有 provider（OpenAI / Claude / 第三方）生效。", "Event-driven automation: commands receive the event JSON via stdin; exit code 2 can block tool execution (PreToolUse only). Config is stored in the project's .claude/settings.json, interoperable with Claude Code / Codex — applies to all providers.")}
            </Hint>
          </span>
        }
        actions={
          <>
            <GhostButton onClick={() => (window.api as any).hooksOpenFile?.(projectPath)} title={t("编辑 settings.json", "Edit settings.json")}>
              <FileCode size={12} /> {t("编辑文件", "Edit file")}
            </GhostButton>
            <GhostButton onClick={load} title={t("重新加载", "Reload")}>{t("重新加载", "Reload")}</GhostButton>
          </>
        }
      />

      {loading ? (
        <p className="text-xs text-muted-foreground">{t("加载中…", "Loading…")}</p>
      ) : (
        <div className="space-y-4">
          {saving && <p className="text-[11px] text-muted-foreground">{t("保存中…", "Saving…")}</p>}
          {HOOK_EVENTS.map((ev) => (
            <HookEventGroup
              key={ev.id}
              event={ev}
              entries={cfg[ev.id] || []}
              onAdd={() => addEntry(ev.id, ev.hasMatcher)}
              onUpdate={(idx, patch) => updateEntry(ev.id, idx, patch)}
              onRemove={(idx) => removeEntry(ev.id, idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HookEventGroup({ event, entries, onAdd, onUpdate, onRemove }: {
  event: { id: string; descZh: string; descEn: string; hasMatcher: boolean; wired: boolean };
  entries: HookEntry[];
  onAdd: () => void;
  onUpdate: (idx: number, patch: Partial<HookEntry & HookCmd>) => void;
  onRemove: (idx: number) => void;
}) {
  const t = useT();
  return (
    <section className="rounded-xl ring-1 ring-border/40 bg-muted/30 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-foreground flex items-center gap-1.5">
            {event.id}
            {!event.wired && <span className="text-[10px] text-amber-500 font-normal">{t("触发点开发中", "Trigger in development")}</span>}
            {entries.length > 0 && <span className="text-[10px] text-muted-foreground font-normal">（{entries.length}）</span>}
          </div>
          <div className="text-[11px] text-muted-foreground">{t(event.descZh, event.descEn)}</div>
        </div>
        <button onClick={onAdd} title={t("添加 hook", "Add hook")}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-lg bg-muted/60 hover:bg-muted text-foreground/80 hover:text-foreground transition-colors">
          <Plus size={12} /> {t("添加", "Add")}
        </button>
      </div>
      {entries.length > 0 && (
        <div className="px-2.5 pb-2.5 space-y-2.5">
          {entries.map((entry, idx) => (
            <div key={idx} className="rounded-lg bg-background/60 ring-1 ring-border/40 p-2.5 space-y-2">
              {event.hasMatcher && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-muted-foreground w-14 shrink-0">{t("匹配工具", "Match tool")}</label>
                  <input
                    defaultValue={entry.matcher || ""}
                    onBlur={(e) => onUpdate(idx, { matcher: e.target.value })}
                    placeholder={t("* 或 Edit|Write 或 Bash", "* or Edit|Write or Bash")}
                    className="flex-1 px-2 py-1 text-[11px] bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring text-foreground font-mono" />
                </div>
              )}
              <div className="flex items-start gap-2">
                <label className="text-[10px] text-muted-foreground w-14 shrink-0 pt-1.5">{t("命令", "Command")}</label>
                <textarea
                  defaultValue={entry.hooks?.[0]?.command || ""}
                  onBlur={(e) => onUpdate(idx, { command: e.target.value })}
                  rows={2}
                  placeholder={t('例如：npx prettier --write "$CLAUDE_PROJECT_DIR"', 'e.g. npx prettier --write "$CLAUDE_PROJECT_DIR"')}
                  className="flex-1 px-2 py-1 text-[11px] bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring text-foreground font-mono resize-y" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-muted-foreground w-14 shrink-0">{t("超时(秒)", "Timeout (s)")}</label>
                <input
                  type="number" min={1}
                  defaultValue={entry.hooks?.[0]?.timeout ?? 60}
                  onBlur={(e) => onUpdate(idx, { timeout: Math.max(1, Number(e.target.value) || 60) })}
                  className="w-20 px-2 py-1 text-[11px] bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring text-foreground font-mono" />
                <div className="flex-1" />
                <button onClick={() => onRemove(idx)} title={t("删除", "Delete")}
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// 外观栏目内统一的设置卡片：大写小标题（带图标）+ 柔和面容器，与全局设计语言一致。
function SettingCard({ icon: Icon, title, hint, children }: {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-[0.08em] flex items-center gap-1.5">
        <Icon size={13} className="text-muted-foreground" />
        {title}
        {hint && <Hint>{hint}</Hint>}
      </h3>
      <div className="rounded-xl bg-muted/40 ring-1 ring-border/40 p-4 space-y-3">
        {children}
      </div>
    </section>
  );
}

const SELECT_CLS =
  "w-full max-w-sm text-xs bg-muted/50 rounded-lg ring-1 ring-border/40 px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40 transition-all";

// 系统桌面通知开关 + 权限状态。
function NotifySetting() {
  const t = useT();
  const [on, setOn] = useState(notifyEnabled());
  const [perm, setPerm] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );
  const toggle = async () => {
    const next = !on;
    setOn(next);
    setNotifyEnabled(next);
    if (next) { await ensurePermission(); setPerm(typeof Notification !== "undefined" ? Notification.permission : "denied"); }
  };
  return (
    <SettingCard icon={Bell} title={t("系统通知", "System notifications")}
      hint={t("Agent 回答完成、等待你授权工具、等待你回答问题时，若窗口在后台则弹系统通知提醒。窗口在前台时不打扰。", "When the agent finishes answering, is waiting for you to authorize a tool, or is waiting for your reply, a system notification is shown if the window is in the background. No interruptions when in the foreground.")}>
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={toggle}
          className={cn("px-3.5 py-1.5 text-xs rounded-lg transition-colors",
            on ? "bg-muted ring-1 ring-ring/40 text-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted")}>
          {on ? t("已启用（点击关闭）", "Enabled (click to turn off)") : t("已关闭（点击启用）", "Off (click to enable)")}
        </button>
        {on && perm === "denied" && (
          <span className="text-[11px] text-amber-500">{t("系统已拒绝通知权限，请在操作系统设置中允许本应用通知。", "Notification permission was denied by the system. Please allow notifications for this app in your OS settings.")}</span>
        )}
        {on && perm === "default" && (
          <span className="text-[11px] text-muted-foreground">{t("首次触发时会申请权限。", "Permission will be requested on first trigger.")}</span>
        )}
      </div>
    </SettingCard>
  );
}

// 传输调试日志：一键开关（无需重启），完整记录每次发往 LLM 的请求体 / headers /
// 响应状态 / 报错正文，按会话落盘 JSONL。排查 provider 问题时打开，复现后发日志给我。
function TransportLogSetting() {
  const t = useT();
  const [on, setOn] = useState(false);
  const [dir, setDir] = useState("");
  useEffect(() => {
    (window.api as any).transportLogSetEnabled?.().then((r: any) => {
      if (r) { setOn(!!r.enabled); setDir(r.dir || ""); }
    }).catch(() => {});
  }, []);
  const toggle = async () => {
    const next = !on;
    setOn(next);
    try {
      const r = await (window.api as any).transportLogSetEnabled?.(next);
      if (r) setDir(r.dir || "");
    } catch {}
  };
  const open = async () => {
    try { const r = await (window.api as any).transportLogOpen?.(); if (r) setDir(r.dir || ""); } catch {}
  };
  return (
    <SettingCard icon={Bug} title={t("传输调试日志", "Transport debug log")}
      hint={t("开启后，每次发往 AI 的请求（完整消息体、headers，敏感字段已脱敏）与响应（状态码、用量、报错正文）都会按会话写入 JSONL 日志文件。会增加磁盘写入，平时建议关闭。", "When enabled, every request sent to the AI (full message body and headers, with secrets redacted) and its response (status code, usage, error body) are written to per-session JSONL log files. It adds disk writes — keep it off normally.")}>
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={toggle}
          className={cn("px-3.5 py-1.5 text-xs rounded-lg transition-colors",
            on ? "bg-muted ring-1 ring-ring/40 text-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted")}>
          {on ? t("已开启（点击关闭）", "On (click to turn off)") : t("已关闭（点击开启）", "Off (click to enable)")}
        </button>
        <GhostButton onClick={open}>
          <FolderOpen size={12} /> {t("打开日志文件夹", "Open log folder")}
        </GhostButton>
      </div>
      {dir && <p className="text-[10px] text-muted-foreground/60 font-mono break-all">{dir}</p>}
    </SettingCard>
  );
}
// 把 KeyboardEvent 转成 Electron accelerator（如 "CommandOrControl+Shift+Q"）。
// 仅当按下了至少一个修饰键 + 一个非修饰主键时才返回，否则返回空串（无效组合）。
function eventToAccelerator(e: React.KeyboardEvent): string {
  const key = e.key;
  // 纯修饰键本身不作为主键。
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return "";
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (parts.length === 0) return ""; // 必须带修饰键，避免抢占普通按键
  let main = key.length === 1 ? key.toUpperCase() : key;
  // 常见特殊键名映射到 Electron 接受的写法。
  const map: Record<string, string> = { " ": "Space", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Escape: "Esc" };
  if (map[main]) main = map[main];
  parts.push(main);
  return parts.join("+");
}

// 把 accelerator 显示成更友好的形式（CommandOrControl → Ctrl）。
function formatAccelerator(acc: string): string {
  return acc.replace("CommandOrControl", "Ctrl");
}

function AppearanceSettings() {
  const chatFontSize = useAppStore((s) => s.chatFontSize);
  const setChatFontSize = useAppStore((s) => s.setChatFontSize);
  const chatFontFamily = useAppStore((s) => s.chatFontFamily);
  const setChatFontFamily = useAppStore((s) => s.setChatFontFamily);
  const uiFontFamily = useAppStore((s) => s.uiFontFamily);
  const setUiFontFamily = useAppStore((s) => s.setUiFontFamily);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);
  const miniShortcut = useAppStore((s) => s.miniShortcut);
  const setMiniShortcut = useAppStore((s) => s.setMiniShortcut);
  const setMiniMode = useAppStore((s) => s.setMiniMode);
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const t = useT();
  const [transfer, setTransfer] = useState<"export" | "import" | null>(null);
  // 快捷键录制态：聚焦后捕获下一个组合键。shortcutError 标记上次注册失败（被占用）。
  const [recording, setRecording] = useState(false);
  const [shortcutError, setShortcutError] = useState(false);

  const themeOptions = [
    { value: "light" as const, label: t("浅色", "Light"), icon: Sun },
    { value: "dark" as const, label: t("深色", "Dark"), icon: Moon },
  ];

  const langOptions = [
    { value: "zh" as const, label: "中文" },
    { value: "en" as const, label: "English" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Settings}
        title={t("设置", "Settings")}
        subtitle={t("界面主题、字体、字号与全部配置的导入/导出", "Theme, fonts, sizing and import/export of all settings")}
        actions={
          <>
            <GhostButton onClick={() => setTransfer("export")} title={t("导出配置", "Export settings")}>
              <Upload size={12} /> {t("导出", "Export")}
            </GhostButton>
            <GhostButton onClick={() => setTransfer("import")} title={t("导入配置", "Import settings")}>
              <Download size={12} /> {t("导入", "Import")}
            </GhostButton>
          </>
        }
      />

      {transfer && <ConfigTransfer mode={transfer} onClose={() => setTransfer(null)} />}

      <SettingCard icon={Languages} title={t("界面语言", "Language")} hint={t("仅切换界面显示语言，不影响发送给 AI 的内容。", "Switches the interface language only; does not affect content sent to the AI.")}>
        <Segmented
          value={lang}
          onChange={(v) => setLang(v)}
          options={langOptions.map((o) => ({ value: o.value, label: o.label }))}
        />
      </SettingCard>

      <SettingCard icon={Palette} title={t("主题", "Theme")}>
        <Segmented
          value={theme}
          onChange={(v) => { if (v !== theme) toggleTheme(); }}
          options={themeOptions.map((o) => ({ value: o.value, label: o.label, icon: o.icon }))}
        />
      </SettingCard>

      <NotifySetting />

      <TransportLogSetting />

      <SettingCard icon={Type} title={t("界面字体", "Interface font")} hint={t("影响整个应用界面（侧栏、按钮、菜单等）。", "Affects the entire app interface (sidebar, buttons, menus, etc.).")}>
        <select value={uiFontFamily} onChange={(e) => setUiFontFamily(e.target.value)} className={SELECT_CLS}>
          {FONT_CHOICES.map((f) => (
            <option key={f.label} value={f.value}>{t(f.label, f.labelEn)}</option>
          ))}
        </select>
      </SettingCard>

      <SettingCard icon={ALargeSmall} title={t("聊天字号", "Chat font size")}>
        <div className="flex items-center gap-3">
          <input type="range" min={11} max={22} step={1} value={chatFontSize}
            onChange={(e) => setChatFontSize(Number(e.target.value))}
            className="cw-range flex-1 max-w-sm"
            style={{ ["--cw-pct" as string]: `${((chatFontSize - 11) / (22 - 11)) * 100}%` }} />
          <span className="text-xs font-mono text-foreground w-10 text-right tabular-nums">{chatFontSize}px</span>
        </div>
        <div className="rounded-md bg-muted/40 border border-border/60 px-3 py-2">
          <p className="text-foreground/80 leading-relaxed" style={{ fontSize: chatFontSize }}>
            {t("预览：这是聊天消息的字号效果。", "Preview: chat message font size. ")}The quick brown fox.
          </p>
        </div>
      </SettingCard>

      <SettingCard icon={Type} title={t("聊天字体", "Chat font")}>
        <select value={chatFontFamily} onChange={(e) => setChatFontFamily(e.target.value)} className={SELECT_CLS}>
          {FONT_CHOICES.map((f) => (
            <option key={f.label} value={f.value}>{t(f.label, f.labelEn)}</option>
          ))}
        </select>
        <div className="rounded-md bg-muted/40 border border-border/60 px-3 py-2">
          <p className="text-sm text-foreground/80 leading-relaxed" style={{ fontFamily: chatFontFamily || undefined }}>
            {t("预览：这是聊天消息的字体效果。", "Preview: chat message font. ")}The quick brown fox jumps.
          </p>
        </div>
      </SettingCard>

      <SettingCard icon={Keyboard} title={t("小窗呼出快捷键", "Mini view shortcut")}
        hint={t("全局快捷键：在任意窗口按下即把主窗口切成置顶小窗（两个气泡 + 输入框）。点击下方输入框再按组合键即可设置。", "Global shortcut: press it anywhere to switch the main window into a pinned mini view (two bubbles + composer). Click the box below, then press a key combo to set it.")}>
        <div className="flex items-center gap-2">
          <button
            onKeyDown={(e) => {
              e.preventDefault();
              const acc = eventToAccelerator(e);
              if (!acc) return;
              setRecording(false);
              setMiniShortcut(acc).then((ok) => setShortcutError(!ok));
              (e.target as HTMLElement).blur();
            }}
            onFocus={() => { setRecording(true); setShortcutError(false); }}
            onBlur={() => setRecording(false)}
            className={cn("min-w-[160px] px-3.5 py-1.5 text-xs rounded-lg font-mono text-left transition-all outline-none",
              recording ? "bg-muted ring-2 ring-accent-brand/40 text-foreground" : "bg-muted/60 text-foreground hover:bg-muted")}>
            {recording ? t("按下组合键…", "Press a combo…") : formatAccelerator(miniShortcut)}
          </button>
          <GhostButton onClick={() => setMiniMode(true)}>
            {t("进入小窗", "Enter mini")}
          </GhostButton>
        </div>
        {shortcutError && (
          <p className="text-[11px] text-destructive flex items-center gap-1">
            <AlertTriangle size={11} /> {t("该组合可能被系统或其它程序占用，注册失败。请换一个。", "That combo may be taken by the system or another app; registration failed. Try another.")}
          </p>
        )}
      </SettingCard>
    </div>
  );
}


