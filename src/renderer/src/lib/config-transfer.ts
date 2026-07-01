/**
 * 配置导入/导出。把设置各分区（API Providers、网络搜索、外观、CLAUDE.md、记忆、
 * MCP、Skills、Hooks、Permissions、Discord）序列化为一个可移植的 JSON 文件，
 * 并支持「增量合并」式导入——重复项更新、新项追加，绝不整体覆盖丢数据。
 *
 * 安全提示：导出会包含明文 API key / token（从主进程解密读出），便于换机整体迁移。
 * UI 在导出前会显式警告。
 */
import { useProviderStore, type Provider } from "../stores/provider-store";
import { useSearchStore, SEARCH_BACKENDS, searchSecretId, type SearchKind } from "../stores/search-store";
import { useAppStore, type Theme } from "../stores/app-store";
import { setNotifyEnabled, notifyEnabled } from "./notify";
import { tr } from "./i18n";

// Relay（Discord + Telegram）的 token 在 SecretsManager 里的 key，与主进程 RelayCore
// 的 TOKEN_KEY 对齐——导出/导入直接读写这两个 secret。
const RELAY_TOKEN_ID: Record<"discord" | "telegram", string> = {
  discord: "__discord_bot_token__",
  telegram: "__telegram_bot_token__",
};

export interface TransferSection {
  id: string;
  // labelZh/labelEn 由消费方（ConfigTransfer）在渲染时按当前界面语言择一显示——
  // 不要在此用 tr() 预先固化，否则切语言后不更新。
  labelZh: string;
  labelEn: string;
  /** 收集本分区当前配置；无内容时返回 null（导出时该分区灰显）。 */
  collect: (ctx: TransferCtx) => Promise<any>;
  /** 合并式导入本分区数据。 */
  apply: (data: any, ctx: TransferCtx) => Promise<void>;
}

export interface TransferCtx {
  projectPath?: string;
}

export interface ConfigBundle {
  type: "ue-coworker-config";
  version: number;
  exportedAt: number;
  sections: Record<string, any>;
}

const api = () => (window as any).api as any;

// ---- providers ----
async function collectProviders(): Promise<any> {
  const st = useProviderStore.getState();
  const providers = await Promise.all(
    st.providers.map(async (p) => {
      let apiKey = "";
      try { apiKey = (await api().getSecret?.(p.id)) || ""; } catch { /* ignore */ }
      return { ...p, apiKey };
    })
  );
  if (providers.length === 0) return null;
  return { providers, selectedProviderId: st.selectedProviderId, selectedModel: st.selectedModel };
}

async function applyProviders(data: any): Promise<void> {
  if (!data || !Array.isArray(data.providers)) return;
  // 去重键：用「全字段签名」而非仅 name+baseUrl。用户可能故意添加多个 name+url 相同、
  // 仅模型不同的副本以便快速切换——这些必须各自保留为独立项。只有「完全一致」(同名、
  // 同 url、同模型列表、同协议/headers 等)才视为同一项、不重复添加；任何差异都作为新项追加。
  const sig = (p: Partial<Provider>) => JSON.stringify({
    name: p.name || "", baseUrl: p.baseUrl || "",
    models: Array.isArray(p.models) ? p.models : [],
    headers: p.headers || {}, protocol: p.protocol || "",
    vision: p.vision, balanceScript: p.balanceScript || "",
    imageGen: !!p.imageGen, imageEndpoint: p.imageEndpoint || "",
  });
  for (const imp of data.providers as Array<Provider & { apiKey?: string }>) {
    const apiKey = imp.apiKey || "";
    const meta: Omit<Provider, "id"> = {
      name: imp.name, baseUrl: imp.baseUrl, models: Array.isArray(imp.models) ? imp.models : [],
      headers: imp.headers || {}, protocol: imp.protocol, vision: imp.vision,
      balanceScript: imp.balanceScript, imageGen: imp.imageGen, imageEndpoint: imp.imageEndpoint,
    };
    const existing = useProviderStore.getState().providers.find((p) => sig(p) === sig(imp));
    let id: string;
    if (existing) {
      // 完全一致：元数据本就相同，仅刷新 key——防止重复导入时无限堆叠相同项。
      id = existing.id;
    } else {
      id = useProviderStore.getState().addProvider(meta);
    }
    if (apiKey) { try { await useProviderStore.getState().setKey(id, apiKey); } catch { /* ignore */ } }
  }
}

// ---- search ----
async function collectSearch(): Promise<any> {
  const st = useSearchStore.getState();
  const out: any = { enabled: {}, keys: {} };
  let any = false;
  for (const b of SEARCH_BACKENDS) {
    out.enabled[b.kind] = !!st.enabled[b.kind];
    if (st.enabled[b.kind]) any = true;
    try {
      const k = (await api().getSecret?.(searchSecretId(b.kind))) || "";
      if (k) { out.keys[b.kind] = k; any = true; }
    } catch { /* ignore */ }
  }
  return any ? out : null;
}

async function applySearch(data: any): Promise<void> {
  if (!data) return;
  const st = useSearchStore.getState();
  for (const b of SEARCH_BACKENDS) {
    const kind = b.kind as SearchKind;
    const key = data.keys?.[kind];
    if (key) { try { await st.setKey(kind, key); } catch { /* ignore */ } }
    // 合并启用：导入为 true 则启用（OR），不关闭本地已启用项。
    if (data.enabled?.[kind]) st.toggleEnabled(kind, true);
  }
}

// ---- appearance / settings ----
async function collectAppearance(): Promise<any> {
  const s = useAppStore.getState();
  let lang: string | undefined;
  try { lang = localStorage.getItem("ue-coworker-ui-lang") || undefined; } catch { /* ignore */ }
  return {
    theme: s.theme,
    chatFontSize: s.chatFontSize,
    chatFontFamily: s.chatFontFamily,
    uiFontFamily: s.uiFontFamily,
    miniShortcut: s.miniShortcut,
    lang,
    notify: notifyEnabled(),
  };
}

async function applyAppearance(data: any): Promise<void> {
  if (!data) return;
  const s = useAppStore.getState();
  if (data.theme === "dark" || data.theme === "light") s.setTheme(data.theme as Theme);
  if (typeof data.chatFontSize === "number") s.setChatFontSize(data.chatFontSize);
  if (typeof data.chatFontFamily === "string") s.setChatFontFamily(data.chatFontFamily);
  if (typeof data.uiFontFamily === "string") s.setUiFontFamily(data.uiFontFamily);
  // 全局快捷键：注册可能因被占用而失败，忽略返回值（best-effort）。
  if (typeof data.miniShortcut === "string" && data.miniShortcut) {
    try { await s.setMiniShortcut(data.miniShortcut); } catch { /* ignore */ }
  }
  // 界面语言：直接写 localStorage（与 useLangStore 的 loadLang 对齐），下次读取生效。
  if (data.lang === "zh" || data.lang === "en") {
    try { localStorage.setItem("ue-coworker-ui-lang", data.lang); } catch { /* ignore */ }
  }
  if (typeof data.notify === "boolean") setNotifyEnabled(data.notify);
}

// ---- CLAUDE.md ----
const CLAUDE_LEVELS = ["global", "project", "local"] as const;
async function claudeMdPaths(projectPath?: string): Promise<Record<string, string> | null> {
  if (!projectPath) return null;
  const home = await api().getHomeDir?.();
  return {
    global: home + "/.claude/CLAUDE.md",
    project: projectPath + "/CLAUDE.md",
    local: projectPath + "/.claude/CLAUDE.md",
  };
}

async function collectClaudeMd(ctx: TransferCtx): Promise<any> {
  const paths = await claudeMdPaths(ctx.projectPath);
  if (!paths) return null;
  const out: Record<string, string> = {};
  let any = false;
  for (const lvl of CLAUDE_LEVELS) {
    try {
      const r = await api().readFile?.(paths[lvl]);
      if (r && r.content) { out[lvl] = r.content; any = true; }
    } catch { /* ignore */ }
  }
  return any ? out : null;
}

async function applyClaudeMd(data: any, ctx: TransferCtx): Promise<void> {
  if (!data) return;
  const paths = await claudeMdPaths(ctx.projectPath);
  if (!paths) return;
  for (const lvl of CLAUDE_LEVELS) {
    const incoming: string = data[lvl];
    if (!incoming) continue;
    let existing = "";
    try { const r = await api().readFile?.(paths[lvl]); existing = (r && r.content) || ""; } catch { /* ignore */ }
    // 合并：已包含则跳过；空则直接写；否则追加（分隔标记，避免覆盖既有指令）。
    let next: string;
    if (!existing.trim()) next = incoming;
    else if (existing.indexOf(incoming.trim()) !== -1) next = existing;
    else next = existing.replace(/\s*$/, "") + "\n\n# --- 导入合并 ---\n\n" + incoming;
    if (next !== existing) { try { await api().writeFile?.(paths[lvl], next); } catch { /* ignore */ } }
  }
}

// ---- memory ----
async function collectMemory(ctx: TransferCtx): Promise<any> {
  try {
    const entries = (await api().memoryList?.(ctx.projectPath)) || [];
    const exportable = entries
      .filter((e: any) => !e.error)
      .map((e: any) => ({ name: e.name, description: e.description, type: e.type, body: e.body, source: e.source }));
    return exportable.length ? { entries: exportable } : null;
  } catch { return null; }
}

async function applyMemory(data: any, ctx: TransferCtx): Promise<void> {
  if (!data || !Array.isArray(data.entries)) return;
  // memorySave 按 name+source 去重（已存在则覆盖正文/描述），天然增量合并。
  for (const e of data.entries) {
    try {
      await api().memorySave?.(ctx.projectPath, {
        name: e.name, description: e.description, type: e.type, body: e.body, source: e.source,
      });
    } catch { /* ignore */ }
  }
}

// ---- mcp ----
async function collectMcp(): Promise<any> {
  try {
    const servers = (await api().mcpList?.()) || [];
    return servers.length ? { servers } : null;
  } catch { return null; }
}

async function applyMcp(data: any): Promise<void> {
  if (!data || !Array.isArray(data.servers)) return;
  let existing: any[] = [];
  try { existing = (await api().mcpList?.()) || []; } catch { /* ignore */ }
  const byId = new Map<string, any>(existing.map((s) => [s.id, s]));
  for (const s of data.servers) {
    if (s && s.id) byId.set(s.id, { ...byId.get(s.id), ...s }); // 同 id 更新，新 id 追加
  }
  try {
    await api().mcpSave?.([...byId.values()]);
    await api().mcpReconnectAll?.();
  } catch { /* ignore */ }
}

// ---- skills（仅启用状态） ----
async function collectSkills(ctx: TransferCtx): Promise<any> {
  try {
    const skills = (await api().skillsList?.(ctx.projectPath)) || [];
    const states = skills.map((s: any) => ({ id: s.id, enabled: s.enabled }));
    return states.length ? { states } : null;
  } catch { return null; }
}

async function applySkills(data: any): Promise<void> {
  if (!data || !Array.isArray(data.states)) return;
  for (const s of data.states) {
    try { await api().skillsSetEnabled?.(s.id, !!s.enabled); } catch { /* ignore */ }
  }
}

// ---- hooks ----
async function collectHooks(ctx: TransferCtx): Promise<any> {
  if (!ctx.projectPath) return null;
  try {
    const hooks = (await api().hooksGet?.(ctx.projectPath)) || {};
    return Object.keys(hooks).length ? { hooks } : null;
  } catch { return null; }
}

async function applyHooks(data: any, ctx: TransferCtx): Promise<void> {
  if (!data || !data.hooks || !ctx.projectPath) return;
  let existing: Record<string, any[]> = {};
  try { existing = (await api().hooksGet?.(ctx.projectPath)) || {}; } catch { /* ignore */ }
  const merged: Record<string, any[]> = { ...existing };
  for (const event of Object.keys(data.hooks)) {
    const cur = Array.isArray(merged[event]) ? [...merged[event]] : [];
    const seen = new Set(cur.map((e) => JSON.stringify(e)));
    for (const entry of (data.hooks[event] || [])) {
      const sig = JSON.stringify(entry);
      if (!seen.has(sig)) { cur.push(entry); seen.add(sig); } // 去重追加
    }
    merged[event] = cur;
  }
  try { await api().hooksSave?.(ctx.projectPath, merged); } catch { /* ignore */ }
}

// ---- permissions ----
async function collectPermissions(): Promise<any> {
  try {
    const cfg = await api().getPermissions?.();
    return cfg || null;
  } catch { return null; }
}

async function applyPermissions(data: any): Promise<void> {
  if (!data) return;
  try {
    if (data.mode) await api().setPermissionMode?.(data.mode);
    if (Array.isArray(data.tools)) {
      for (const t of data.tools) {
        if (!t || !t.tool) continue;
        await api().setToolPermission?.(t.tool, !!t.allowed); // 逐工具覆盖
        if (typeof t.auto === "boolean") await api().setToolAuto?.(t.tool, t.auto);
      }
    }
  } catch { /* ignore */ }
}

// ---- relay（Discord + Telegram，统一 RelayCore）----
// 收集两平台各自的配置 + 解密 token。旧的 discord:getConfig 已废弃，统一走 relay:*。
async function collectOneRelay(source: "discord" | "telegram"): Promise<any | null> {
  try {
    const cfg = await api().relayGetConfig?.(source);
    if (!cfg) return null;
    let token = "";
    try { token = (await api().getSecret?.(RELAY_TOKEN_ID[source])) || ""; } catch { /* ignore */ }
    const has = cfg.applicationId || cfg.allowedUserId || cfg.guildId || token;
    if (!has) return null;
    // 只导出可移植字段（不含运行态 status/hasToken/botTag）。
    return {
      applicationId: cfg.applicationId, allowedUserId: cfg.allowedUserId,
      guildId: cfg.guildId, autoConnect: cfg.autoConnect, token,
    };
  } catch { return null; }
}

async function collectRelay(): Promise<any> {
  const discord = await collectOneRelay("discord");
  const telegram = await collectOneRelay("telegram");
  if (!discord && !telegram) return null;
  const out: any = {};
  if (discord) out.discord = discord;
  if (telegram) out.telegram = telegram;
  return out;
}

async function applyOneRelay(source: "discord" | "telegram", data: any): Promise<void> {
  if (!data) return;
  const cfg: any = {};
  if (data.applicationId !== undefined) cfg.applicationId = data.applicationId;
  if (data.allowedUserId !== undefined) cfg.allowedUserId = data.allowedUserId;
  if (data.guildId !== undefined) cfg.guildId = data.guildId;
  if (data.autoConnect !== undefined) cfg.autoConnect = data.autoConnect;
  if (data.token) cfg.token = data.token;
  try { await api().relaySaveConfig?.(source, cfg); } catch { /* ignore */ }
}

async function applyRelay(data: any): Promise<void> {
  if (!data) return;
  // 向后兼容：旧导出文件用扁平的 discord 结构（applicationId/token 直接在顶层），
  // 没有 discord/telegram 子键时整体当作 discord 处理。
  if (data.discord || data.telegram) {
    await applyOneRelay("discord", data.discord);
    await applyOneRelay("telegram", data.telegram);
  } else {
    await applyOneRelay("discord", data);
  }
}

// ---- 分区注册表（id 与 configSections 对齐） ----
export const TRANSFER_SECTIONS: TransferSection[] = [
  { id: "providers", labelZh: "API 供应商", labelEn: "API Providers", collect: collectProviders, apply: applyProviders },
  { id: "search", labelZh: "网络搜索", labelEn: "Web Search", collect: collectSearch, apply: applySearch },
  { id: "appearance", labelZh: "设置（主题/字体/语言/快捷键）", labelEn: "Settings (theme/font/lang/shortcut)", collect: collectAppearance, apply: applyAppearance },
  { id: "claude-md", labelZh: "CLAUDE.md", labelEn: "CLAUDE.md", collect: collectClaudeMd, apply: applyClaudeMd },
  { id: "memory", labelZh: "记忆", labelEn: "Memory", collect: collectMemory, apply: applyMemory },
  { id: "mcp", labelZh: "MCP 服务器", labelEn: "MCP Servers", collect: collectMcp, apply: applyMcp },
  { id: "skills", labelZh: "Skills（启用状态）", labelEn: "Skills (enabled state)", collect: collectSkills, apply: applySkills },
  { id: "hooks", labelZh: "Hooks", labelEn: "Hooks", collect: collectHooks, apply: applyHooks },
  { id: "permissions", labelZh: "权限", labelEn: "Permissions", collect: collectPermissions, apply: applyPermissions },
  // links：统一的远程控制（Discord + Telegram）。导入兼容旧的 "discord" 分区 id。
  { id: "links", labelZh: "链接（Discord / Telegram）", labelEn: "Links (Discord / Telegram)", collect: collectRelay, apply: applyRelay },
];

/** 探测每个分区当前是否有可导出的内容（用于 UI 灰显空分区）。 */
export async function probeSections(ctx: TransferCtx): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  await Promise.all(TRANSFER_SECTIONS.map(async (s) => {
    try { out[s.id] = (await s.collect(ctx)) != null; } catch { out[s.id] = false; }
  }));
  return out;
}

/** 导出选中分区为 bundle JSON 字符串。 */
export async function exportConfig(sectionIds: string[], ctx: TransferCtx): Promise<string> {
  const sections: Record<string, any> = {};
  for (const s of TRANSFER_SECTIONS) {
    if (sectionIds.indexOf(s.id) === -1) continue;
    try {
      const data = await s.collect(ctx);
      if (data != null) sections[s.id] = data;
    } catch { /* skip failed section */ }
  }
  const bundle: ConfigBundle = {
    type: "ue-coworker-config", version: 1, exportedAt: Date.now(), sections,
  };
  return JSON.stringify(bundle, null, 2);
}

/** 解析 bundle，返回其中包含的分区 id（用于导入前让用户勾选）。 */
export function parseBundle(text: string): { bundle: ConfigBundle; sectionIds: string[] } | { error: string } {
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { return { error: tr("不是有效的 JSON 文件", "Not a valid JSON file") }; }
  if (!parsed || parsed.type !== "ue-coworker-config" || typeof parsed.sections !== "object") {
    return { error: tr("不是 UE Coworker 配置文件", "Not a UE Coworker config file") };
  }
  // 向后兼容：旧版导出用 "discord" 分区 id（仅含 Discord 扁平结构）。统一迁移到
  // 新的 "links" 分区（applyRelay 内部会把扁平结构当 discord 处理）。
  if (parsed.sections.discord && !parsed.sections.links) {
    parsed.sections.links = parsed.sections.discord;
    delete parsed.sections.discord;
  }
  return { bundle: parsed as ConfigBundle, sectionIds: Object.keys(parsed.sections) };
}

/** 合并式导入选中分区。 */
export async function importConfig(bundle: ConfigBundle, sectionIds: string[], ctx: TransferCtx): Promise<void> {
  for (const s of TRANSFER_SECTIONS) {
    if (sectionIds.indexOf(s.id) === -1) continue;
    const data = bundle.sections[s.id];
    if (data == null) continue;
    try { await s.apply(data, ctx); } catch { /* skip failed section */ }
  }
}
