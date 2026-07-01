// 真实 MCP 客户端管理器（复用官方 @modelcontextprotocol/sdk，不自造协议）。
//
// 职责：
//  - 读取/保存 MCP 服务器配置（userData/ue-coworker-mcp.json，沿用 Claude Desktop /
//    Cline / Cursor 通用的 `mcpServers` 形态：stdio 用 command/args/env；远程用 url）。
//  - 按需连接每个启用的服务器（stdio 子进程 / streamable-HTTP / SSE）。
//  - 汇总各服务器的工具，名字加 "<serverId>__<tool>" 前缀避免冲突，并清洗为
//    OpenAI 允许的函数名字符集（^[a-zA-Z0-9_-]{1,64}$）。
//  - 把工具转成 OpenAI tools 数组供 agent-loop 注入；按前缀名路由回 callTool。
//  - 进程退出时清理所有传输/子进程。
//
// SDK 同时发布 CJS 与 ESM；electron-vite 把 main 打成 CJS 并 externalize 依赖，
// 因此这里用普通 import（编译为 require → dist/cjs/...），运行期可用。

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { app } from "electron";
import { join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { resolveCommand, augmentPath } from "./node-runtime";

// 单个服务器配置。type 缺省按是否有 url 推断：有 url=remote(http)，否则 stdio。
export interface McpServerConfig {
  id: string;                 // 唯一标识（也用作工具名前缀）
  enabled: boolean;
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  // remote
  url?: string;
  type?: "stdio" | "http" | "sse" | "streamable-http";
  headers?: Record<string, string>;
}

// 官方注册表(registry.modelcontextprotocol.io)搜索结果的一条:已抽成「展示信息
// + 一键安装模板」。install 是把它转成的可直接保存/连接的 McpServerConfig 草稿
// (env/headers 里需要用户补的密钥值留空,UI 据 requiresInput 提示)。
export interface McpRegistryItem {
  id: string;                 // 建议的服务器 id(由 name 推导,UI 可再去重)
  name: string;               // registry 里的规范名(如 io.github.owner/repo)
  title: string;              // 友好显示名
  description: string;
  version?: string;
  author?: string;            // 从 name / 仓库推导的作者/组织
  repoUrl?: string;           // 源码仓库链接
  transport: "stdio" | "http" | "sse" | "streamable-http";
  install: McpServerConfig;   // 一键安装草稿
  requiresInput: boolean;     // 是否有必填的密钥/参数待用户补
  inputHints: string[];       // 需要补的字段说明(env 名 / 参数说明)
}

export interface McpToolInfo {
  serverId: string;
  toolName: string;           // 服务器侧原始名
  qualifiedName: string;      // 注入给模型的前缀名
  description: string;
  inputSchema: any;
}

// 单台服务器的运行态。
interface ServerRuntime {
  config: McpServerConfig;
  client: Client | null;
  transport: any;
  status: "disconnected" | "connecting" | "connected" | "error";
  error?: string;
  tools: McpToolInfo[];
}

// 工具名清洗：OpenAI / Anthropic 函数名只允许 [a-zA-Z0-9_-]，长度 1-64。
function sanitizeName(s: string): string {
  return (s || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "_";
}

const QUALIFY_SEP = "__"; // <serverId>__<tool>

// 把一台服务器的工具名批量转成「注入给模型的前缀名」，硬约束：
//  - 字符集 [a-zA-Z0-9_-]，总长 ≤ 64（OpenAI / Anthropic 同限）。
//  - 同一批内**保证唯一**——否则 API 直接 400 "Tool names must be unique"。
// 截断策略：超长时**保留工具名尾部**（材质类工具差异多在尾段，如
// ..._create_instance / ..._set_param），比掐头更利于模型分辨语义。
// 唯一性兜底：若截断后仍撞名，用原始全名的 4 位哈希替换尾部 5 字符，
// 既保唯一又尽量少破坏可读性。返回 原始名→前缀名 的映射。
function assignQualifiedNames(serverId: string, toolNames: string[]): Map<string, string> {
  const prefix = sanitizeName(serverId);
  const head = prefix + QUALIFY_SEP;
  const budget = Math.max(1, 64 - head.length); // 留给工具名部分的字符数
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const raw of toolNames) {
    const clean = sanitizeName(raw); // 已 ≤60
    // 超长保留尾部；不超长原样。
    let namePart = clean.length > budget ? clean.slice(clean.length - budget) : clean;
    let qualified = head + namePart;
    if (used.has(qualified)) {
      // 撞名：用原始名哈希做 4 位后缀，替换 namePart 尾部以腾出空间。
      const h = hash4(raw);
      const keep = Math.max(0, namePart.length - 5);
      namePart = namePart.slice(0, keep) + "_" + h;
      qualified = head + namePart;
      // 极端情况（prefix 过长）仍可能撞，循环加哈希直到唯一。
      let n = 0;
      while (used.has(qualified) && n < 1000) {
        namePart = namePart.slice(0, Math.max(0, namePart.length - 5)) + "_" + hash4(raw + "#" + n);
        qualified = head + namePart;
        n++;
      }
    }
    used.add(qualified);
    out.set(raw, qualified);
  }
  return out;
}

// 短哈希（4 位 base36），仅用于工具名去重，无安全用途。
function hash4(s: string): string {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 1679616).toString(36).padStart(4, "0").slice(0, 4); // 36^4
}

export class McpManager {
  private configPath: string;
  private servers = new Map<string, ServerRuntime>();

  constructor() {
    this.configPath = join(app.getPath("userData"), "ue-coworker-mcp.json");
  }

  // MCP 配置文件(ue-coworker-mcp.json)绝对路径——供"打开目录"按钮定位。
  getConfigPath(): string {
    return this.configPath;
  }

  // ---- 配置读写 ----

  async loadConfig(): Promise<McpServerConfig[]> {
    try {
      if (!existsSync(this.configPath)) return [];
      const raw = await readFile(this.configPath, "utf-8");
      const parsed = JSON.parse(raw);
      // 同时支持两种形态：{ servers: [...] }（我们自己的） 或 { mcpServers: {...} }（通用）。
      if (Array.isArray(parsed?.servers)) return parsed.servers as McpServerConfig[];
      if (parsed?.mcpServers && typeof parsed.mcpServers === "object") {
        return Object.keys(parsed.mcpServers).map((id) => {
          const s = parsed.mcpServers[id] || {};
          return { id, enabled: s.enabled !== false, ...s } as McpServerConfig;
        });
      }
      return [];
    } catch {
      return [];
    }
  }

  async saveConfig(servers: McpServerConfig[]): Promise<void> {
    const dir = join(app.getPath("userData"));
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(this.configPath, JSON.stringify({ servers }, null, 2), "utf-8");
  }

  // ---- 连接 / 断开 ----

  private buildTransport(cfg: McpServerConfig): any {
    const kind = cfg.type || (cfg.url ? "http" : "stdio");
    if (kind === "stdio" || (!cfg.url && cfg.command)) {
      // 默认 env 仅含安全白名单子集；显式并入 process.env 以便服务器拿到 API key。
      let env: Record<string, string> = {
        ...getDefaultEnvironment(),
        ...(process.env as Record<string, string>),
        ...(cfg.env || {}),
      };
      // 内置 node 运行时：把 PATH 前置到打包的 node 目录，使 npx/node 型服务器无需
      // 用户自装 Node.js；command 若是 node/npm/npx 则解析到内置版绝对路径。
      env = augmentPath(env);
      const command = resolveCommand(cfg.command || "");
      return new StdioClientTransport({
        command,
        args: cfg.args || [],
        env,
        cwd: cfg.cwd,
        stderr: "pipe",
      });
    }
    // 远程：http(streamable) 优先，sse 次之。带自定义请求头。
    const url = new URL(cfg.url || "");
    const reqInit = cfg.headers ? { requestInit: { headers: cfg.headers } } : undefined;
    if (kind === "sse") return new SSEClientTransport(url, reqInit as any);
    return new StreamableHTTPClientTransport(url, reqInit as any);
  }

  // 连接单台服务器并拉取工具列表。带超时，失败标记 error 不抛出。
  async connectServer(cfg: McpServerConfig): Promise<ServerRuntime> {
    // 已有运行态先断开（重连场景）。
    await this.disconnectServer(cfg.id);

    const rt: ServerRuntime = { config: cfg, client: null, transport: null, status: "connecting", tools: [] };
    this.servers.set(cfg.id, rt);

    try {
      const transport = this.buildTransport(cfg);
      rt.transport = transport;
      const client = new Client({ name: "ue-coworker", version: "1.0.0" }, { capabilities: {} });
      rt.client = client;

      // 传输级错误/关闭：标记状态，便于 UI 显示。
      transport.onerror = (err: any) => { rt.status = "error"; rt.error = (err && err.message) || String(err); };
      transport.onclose = () => { if (rt.status === "connected") rt.status = "disconnected"; };

      // 自带超时：misbehaving server 可能让 connect 卡在 initialize 握手。
      await withTimeout(client.connect(transport), 20000, "connect timed out");

      // 监听 tools/list_changed：服务器（如渐进式披露的 unreal-mcp）在运行期
      // 加载新 toolset 后会发此通知。收到则重新拉取，更新内部 rt.tools。
      // listOpenAITools() 每轮请求实时读取，故下一轮 agent 自动拿到新工具；
      // 仅在真收到通知时才变动 tools 块，不破坏当轮的 prompt 缓存前缀。
      try {
        client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
          this.refreshTools(cfg.id).catch(() => {});
        });
      } catch {}

      // 拉工具。部分服务器不支持 tools → 容错为空。
      await this.refreshTools(cfg.id, client);

      rt.status = "connected";
      return rt;
    } catch (e: any) {
      rt.status = "error";
      rt.error = (e && e.message) || String(e);
      try { await rt.transport?.close?.(); } catch {}
      rt.client = null;
      return rt;
    }
  }

  // 重新拉取并重建某台服务器的工具列表（连接时 + 收到 list_changed 时调用）。
  // client 可显式传入（连接流程中 rt.client 尚未确保可用时）；否则用运行态里的。
  // 失败时保留原 tools 不清空（避免一次抖动把工具抹掉）；连接初次失败才为空。
  private async refreshTools(id: string, client?: Client): Promise<void> {
    const rt = this.servers.get(id);
    if (!rt) return;
    const c = client || rt.client;
    if (!c) return;
    try {
      const res: any = await withTimeout(c.listTools(), 15000, "listTools timed out");
      const list = Array.isArray(res?.tools) ? res.tools : [];
      const names = list.map((t: any) => String(t.name));
      const nameMap = assignQualifiedNames(id, names);
      rt.tools = list.map((t: any) => ({
        serverId: id,
        toolName: String(t.name),
        qualifiedName: nameMap.get(String(t.name)) || (sanitizeName(id) + QUALIFY_SEP + sanitizeName(t.name)).slice(0, 64),
        description: String(t.description || ""),
        inputSchema: t.inputSchema && typeof t.inputSchema === "object"
          ? t.inputSchema
          : { type: "object", properties: {} },
      } as McpToolInfo));
    } catch (e: any) {
      // 初次连接（无既有工具）时容错为空；运行期刷新失败保留旧快照。
      if (!rt.tools.length) rt.tools = [];
    }
  }

  async disconnectServer(id: string): Promise<void> {
    const rt = this.servers.get(id);
    if (!rt) return;
    try { await rt.client?.close?.(); } catch {}
    try { await rt.transport?.close?.(); } catch {}
    rt.client = null;
    rt.transport = null;
    rt.status = "disconnected";
    rt.tools = [];
  }

  // 连接所有启用的服务器（并行）。返回各自运行态摘要。
  async connectAll(): Promise<void> {
    const cfgs = await this.loadConfig();
    await Promise.all(
      cfgs.filter((c) => c.enabled && (c.command || c.url)).map((c) => this.connectServer(c).catch(() => {}))
    );
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(Array.from(this.servers.keys()).map((id) => this.disconnectServer(id)));
    this.servers.clear();
  }

  // ---- 给 agent-loop / UI 用 ----

  // 当前所有已连接服务器的工具，转成 OpenAI tools 数组（function 形态）。
  listOpenAITools(): any[] {
    const out: any[] = [];
    for (const rt of this.servers.values()) {
      if (rt.status !== "connected") continue;
      for (const t of rt.tools) {
        out.push({
          type: "function",
          function: {
            name: t.qualifiedName,
            description: (t.description || ("MCP tool from " + t.serverId)) +
              "\n(MCP server: " + t.serverId + ")",
            parameters: t.inputSchema || { type: "object", properties: {} },
          },
        });
      }
    }
    return out;
  }

  // 是否存在该前缀工具（agent-loop 用以判断走 MCP 还是内置工具）。
  hasTool(qualifiedName: string): boolean {
    for (const rt of this.servers.values()) {
      if (rt.tools.some((t) => t.qualifiedName === qualifiedName)) return true;
    }
    return false;
  }

  // 按前缀名路由调用对应服务器的原始工具，返回拍平成字符串的文本结果。
  // onImages(可选):MCP 返回的 image 块经此回传完整 base64 给调用方(agent-loop
  // 的图片回灌通道),文字结果里仍保留占位说明供无视觉模型阅读。
  async callTool(qualifiedName: string, args: any, onImages?: (imgs: McpImage[]) => void): Promise<string> {
    for (const rt of this.servers.values()) {
      const t = rt.tools.find((x) => x.qualifiedName === qualifiedName);
      if (!t) continue;
      if (!rt.client || rt.status !== "connected") {
        return "MCP server '" + rt.config.id + "' is not connected.";
      }
      try {
        const res: any = await withTimeout(
          rt.client.callTool({ name: t.toolName, arguments: args || {} }),
          60000,
          "tool call timed out"
        );
        return flattenContent(res, onImages);
      } catch (e: any) {
        return "MCP tool error (" + qualifiedName + "): " + ((e && e.message) || String(e));
      }
    }
    return "Unknown MCP tool: " + qualifiedName;
  }

  // ---- 官方注册表搜索(市场)----

  // 搜索 registry.modelcontextprotocol.io,返回展示信息 + 一键安装模板。
  // query 空时返回最新一批;带 cursor 翻页。失败返回空(UI 容错显示)。
  async registrySearch(query?: string, cursor?: string): Promise<{ items: McpRegistryItem[]; nextCursor?: string }> {
    const base = "https://registry.modelcontextprotocol.io/v0/servers";
    const params = new URLSearchParams();
    params.set("limit", "30");
    if (query && query.trim()) params.set("search", query.trim());
    if (cursor) params.set("cursor", cursor);
    const url = base + "?" + params.toString();

    let json: any;
    try {
      const res = await withTimeout(fetch(url, { headers: { Accept: "application/json" } }), 15000, "registry search timed out");
      if (!res.ok) return { items: [] };
      json = await res.json();
    } catch {
      return { items: [] };
    }

    const rows = Array.isArray(json?.servers) ? json.servers : [];
    const items: McpRegistryItem[] = [];
    const seenName = new Set<string>(); // 同名多版本只保留首个(API 已按 isLatest 排)
    for (const row of rows) {
      const s = row?.server || row;
      if (!s || typeof s !== "object") continue;
      if (seenName.has(s.name)) continue;
      const item = mapRegistryServer(s);
      if (!item) continue;
      seenName.add(s.name);
      items.push(item);
    }
    return { items, nextCursor: json?.metadata?.nextCursor };
  }

  // 运行态摘要（给 UI 显示连接状态与工具数）。
  statusSummary(): Array<{ id: string; status: string; error?: string; tools: { name: string; description: string }[] }> {
    return Array.from(this.servers.values()).map((rt) => ({
      id: rt.config.id,
      status: rt.status,
      error: rt.error,
      tools: rt.tools.map((t) => ({ name: t.toolName, description: t.description })),
    }));
  }
}

// MCP 返回的图片(回传给视觉模型)。base64 不含 data: 前缀。
export interface McpImage { mime: string; base64: string; }

// MCP callTool 返回 { content: ContentBlock[] }，content 是块数组（text/image/...）。
// 把可读文本拍平；图片块保留占位说明(供无视觉模型阅读),同时经 onImages 把完整
// base64 回传给调用方(用于发给视觉模型)。isError 时前缀标注。
function flattenContent(res: any, onImages?: (imgs: McpImage[]) => void): string {
  if (!res) return "(no result)";
  const blocks = Array.isArray(res.content) ? res.content : [];
  const parts: string[] = [];
  const images: McpImage[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text") parts.push(String(b.text || ""));
    else if (b.type === "image") {
      parts.push("[image " + (b.mimeType || "") + ", " + (String(b.data || "").length) + " bytes base64]");
      if (b.data) images.push({ mime: String(b.mimeType || "image/png"), base64: String(b.data) });
    }
    else if (b.type === "resource") parts.push("[resource " + (b.resource?.uri || "") + "]");
    else parts.push("[" + (b.type || "unknown") + " block]");
  }
  if (images.length && onImages) {
    try { onImages(images); } catch {}
  }
  // 结构化输出（如果有）附在后面，便于模型消费。
  if (res.structuredContent && typeof res.structuredContent === "object") {
    try { parts.push("structured: " + JSON.stringify(res.structuredContent)); } catch {}
  }
  let text = parts.join("\n").trim() || "(empty result)";
  if (res.isError) text = "Tool reported an error:\n" + text;
  return text;
}

// Promise 超时包装（misbehaving MCP server 不至于卡死整条 agent 链）。
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

// 把 registry 的一条 server 记录映射成展示信息 + 一键安装模板。
// 优先用 packages(stdio:npm→npx / pypi→uvx),否则用 remotes(http/sse)。
// 既不支持就返回 null(UI 不显示无法一键装的条目)。
function mapRegistryServer(s: any): McpRegistryItem | null {
  const name: string = String(s.name || "");
  if (!name) return null;
  const title: string = String(s.title || shortName(name));
  const description: string = String(s.description || "");
  const repoUrl: string | undefined = s.repository?.url ? String(s.repository.url) : undefined;
  const author = deriveAuthor(name, repoUrl);
  const id = sanitizeName(shortName(name)) || sanitizeName(name);

  const inputHints: string[] = [];
  let requiresInput = false;

  const pkgs = Array.isArray(s.packages) ? s.packages : [];
  const pkg = pkgs.find((p: any) => p?.transport?.type === "stdio") || pkgs[0];
  if (pkg && (pkg.registryType === "npm" || pkg.registryType === "pypi" || pkg.runtimeHint)) {
    const isPypi = pkg.registryType === "pypi";
    const command = String(pkg.runtimeHint || (isPypi ? "uvx" : "npx"));
    // runtimeArguments(运行器参数,如 -y)在前,然后包标识,再 package_arguments。
    const args: string[] = [];
    for (const ra of (pkg.runtimeArguments || [])) {
      const v = argValue(ra); if (v != null) args.push(v);
    }
    if (command === "npx" && !args.includes("-y")) args.unshift("-y");
    args.push(String(pkg.identifier || name));
    for (const pa of (pkg.packageArguments || [])) {
      const v = argValue(pa);
      if (v != null) args.push(v);
      else if (pa?.description) { requiresInput = true; inputHints.push(t_argHint(pa)); }
    }
    const env: Record<string, string> = {};
    for (const ev of (pkg.environmentVariables || [])) {
      if (!ev?.name) continue;
      env[ev.name] = ev.default != null ? String(ev.default) : "";
      if (ev.isRequired && ev.default == null) { requiresInput = true; inputHints.push(ev.name + (ev.description ? " — " + ev.description : "")); }
    }
    const install: McpServerConfig = {
      id, enabled: !requiresInput, command, args,
      env: Object.keys(env).length ? env : undefined,
    };
    return { id, name, title, description, version: s.version, author, repoUrl, transport: "stdio", install, requiresInput, inputHints };
  }

  const remotes = Array.isArray(s.remotes) ? s.remotes : [];
  const remote = remotes[0];
  if (remote && remote.url) {
    const kind = remote.type === "sse" ? "sse" : "http";
    const headers: Record<string, string> = {};
    for (const h of (remote.headers || [])) {
      if (!h?.name) continue;
      headers[h.name] = h.value != null ? String(h.value) : "";
      if (h.isRequired) { requiresInput = true; inputHints.push(h.name + (h.description ? " — " + h.description : "")); }
    }
    const install: McpServerConfig = {
      id, enabled: !requiresInput, url: String(remote.url),
      type: kind as any, headers: Object.keys(headers).length ? headers : undefined,
    };
    return { id, name, title, description, version: s.version, author, repoUrl, transport: kind as any, install, requiresInput, inputHints };
  }

  return null;
}

// registry 参数对象 → 字面值(positional 用 value;named 用 name=value 或 name value)。
// 无固定 value(需用户补)时返回 null。
function argValue(a: any): string | null {
  if (!a || typeof a !== "object") return null;
  if (a.value != null) {
    if (a.type === "named" && a.name) return String(a.name) + (a.valueHint ? "" : "") + " " + String(a.value);
    return String(a.value);
  }
  if (a.type === "named" && a.name && a.default != null) return String(a.name) + " " + String(a.default);
  return null;
}

function t_argHint(a: any): string {
  const n = a?.name || a?.valueHint || "argument";
  return String(n) + (a?.description ? " — " + a.description : "");
}

// io.github.owner/repo / ai.smithery/foo → 末段作短名。
function shortName(name: string): string {
  const slash = name.lastIndexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

// 作者:优先从仓库 URL(github.com/<owner>),否则从反向域名 name(io.github.<owner>/..)。
function deriveAuthor(name: string, repoUrl?: string): string | undefined {
  if (repoUrl) {
    const m = /github\.com\/([^/]+)/i.exec(repoUrl);
    if (m) return m[1];
  }
  const m = /^io\.github\.([^/.]+)/i.exec(name);
  if (m) return m[1];
  const slash = name.indexOf("/");
  if (slash > 0) return name.slice(0, slash);
  return undefined;
}

// 进程级单例。
export const mcpManager = new McpManager();
