import { app } from "electron";
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// 传输层日志：把「真正发往 LLM 的字节」与「响应里的 usage」配对落盘，用于离线
// 验证 system 提示拼接、消息历史结构、prompt 缓存命中（cache_read_input_tokens）
// 等。默认关闭，零开销；开启后每次 LLM 往返写一条 JSONL 记录。
//
// 开关（任一为真即开启）：
//   - 环境变量 CW_TRANSPORT_LOG=1
//   - 把下方 FORCE_ON 改成 true（临时本地调试用）
//
// 落盘位置：<userData>/transport-logs/transport-YYYY-MM-DD.jsonl
//   （userData 不可用时退回系统临时目录）
//
// 脱敏：Authorization / x-api-key / 任何含 key/token/secret 的 header 一律脱敏。
// 体积控制：请求体里的 data:image base64 折叠为 [image <mime> <N> bytes b64]，
//   保留长度与类型（验证拼接足够），不让单张图把日志撑爆。
// ---------------------------------------------------------------------------

const FORCE_ON = false;

// 运行期开关（UI 一键开/关，无需重启）。优先级高于 env/FORCE_ON：一旦被显式设置，
// 即以它为准；未设置（null）时回落 FORCE_ON / 环境变量。
let _runtimeOn: boolean | null = null;
export function setTransportLogEnabled(on: boolean): void {
  _runtimeOn = !!on;
}

export function transportLogEnabled(): boolean {
  if (_runtimeOn !== null) return _runtimeOn;
  return FORCE_ON || process.env.CW_TRANSPORT_LOG === "1";
}

// 暴露日志目录路径（供 IPC「打开日志文件夹」用）。
export function transportLogDir(): string {
  return logDir();
}

let _dir: string | null = null;
function logDir(): string {
  if (_dir) return _dir;
  let base = "";
  try { base = app.getPath("userData"); } catch { /* app 未就绪时退回 */ }
  if (!base) base = process.env.TEMP || process.env.TMP || ".";
  const dir = join(base, "transport-logs");
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); } catch {}
  _dir = dir;
  return dir;
}

// sessionId → 会话标题（渲染层经 agent:send 传入，存这里供命名日志文件）。
const _labels = new Map<string, string>();
export function setSessionLabel(sessionId: string, label: string): void {
  if (sessionId && label) _labels.set(sessionId, label);
}

// 文件名中的非法字符清理（Windows + 通用）：保留中英文，替换斜杠/冒号等。
function safeFileName(s: string): string {
  return String(s || "")
    .replace(/[\\/:*?"<>|]/g, "_")   // 文件系统非法字符
    .replace(/\s+/g, "_")             // 空白转下划线
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "session";
}

function today(): string {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// 日志文件名：<会话标题>-<sessionId前6位>-<日期>.jsonl。
// 加 sessionId 短哈希的原因:多个新会话默认标题都叫「New Chat」,只用标题会让不同
// 会话的日志混进同一个文件(看起来像「覆盖」)。带上 sessionId 片段即可一会话一文件,
// 标题仅作可读前缀。无 sessionId 时退回纯标题/session。同会话同一天仍追加同一文件。
//
// 文件名一旦为某 sessionId 定下就缓存住、不再变:否则标题中途从「截断首句」变成
// 「AI 生成正式标题」会改变文件名,把同一会话拆成两个文件。首次写入时按当时标题定名,
// 之后该会话当天一直写这个文件。
const _fileBySession = new Map<string, string>();
function logFile(sessionId?: string): string {
  if (sessionId) {
    const cached = _fileBySession.get(sessionId);
    if (cached) return cached;
  }
  const label = sessionId ? _labels.get(sessionId) : "";
  const titlePart = label ? safeFileName(label) : "session";
  const idPart = sessionId ? sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) : "";
  const namePart = idPart ? titlePart + "-" + idPart : titlePart;
  const full = join(logDir(), namePart + "-" + today() + ".jsonl");
  // 仅在已有真实标题时固化文件名;标题还没到位(label 为空)时不缓存,等有标题再定名,
  // 避免把整段会话锁死在 "session-xxxxxx" 这种无标题文件名上。
  if (sessionId && label) _fileBySession.set(sessionId, full);
  return full;
}

// header 脱敏：敏感字段只保留前 4 末 4 字符，中间用长度占位。
function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const sensitive = /(authorization|api[-_]?key|x-api-key|token|secret|cookie)/i;
  for (const k in headers) {
    const v = String(headers[k] ?? "");
    if (sensitive.test(k)) {
      out[k] = v.length <= 8 ? "[redacted]" : v.slice(0, 4) + "…[redacted " + v.length + "]…" + v.slice(-4);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// 把请求体里的大块 data:image base64 折叠成占位（保留 mime 与长度），其余原样。
// 递归处理对象/数组，命中形如 "data:image/png;base64,XXXX" 的字符串即折叠。
function foldImages(node: any): any {
  if (typeof node === "string") {
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/.exec(node);
    if (m) return "[image " + m[1] + " " + m[2].length + " bytes b64]";
    return node;
  }
  if (Array.isArray(node)) return node.map(foldImages);
  if (node && typeof node === "object") {
    const out: any = {};
    for (const k in node) out[k] = foldImages(node[k]);
    return out;
  }
  return node;
}

export interface TransportLogEntry {
  ts: string;
  sessionId?: string;
  protocol: string;       // anthropic | responses | openai
  model: string;
  url: string;
  headers: Record<string, string>;
  // 解析后的请求体（图片已折叠）。解析失败则放原始字符串到 bodyRaw。
  body?: any;
  bodyRaw?: string;
  bodyBytes: number;      // 原始请求体字节数（折叠前），用于体积/413 判断
  // 响应侧（请求发出时为空，响应结束后补写一条单独的 paired 记录）。
  status?: number;
  usage?: any;
  error?: string;
  raw?: string;          // 原始响应体（调试空响应/异常格式时）
  note?: string;         // 附注，如 "empty stream"
}

// 写一条记录（请求或响应）。失败静默，绝不影响主流程。
export function writeTransportLog(entry: TransportLogEntry): void {
  if (!transportLogEnabled()) return;
  try {
    appendFileSync(logFile(entry.sessionId), JSON.stringify(entry) + "\n", "utf8");
  } catch { /* 日志失败不影响请求 */ }
}

// 便捷封装：记录请求侧。返回一个 token（时间戳）供响应侧配对。
export function logRequest(args: {
  sessionId?: string;
  protocol: string;
  model: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}): string {
  const ts = new Date().toISOString();
  if (!transportLogEnabled()) return ts;
  let parsed: any;
  try { parsed = JSON.parse(args.body); } catch { parsed = null; }
  writeTransportLog({
    ts,
    sessionId: args.sessionId,
    protocol: args.protocol,
    model: args.model,
    url: args.url,
    headers: redactHeaders(args.headers),
    body: parsed ? foldImages(parsed) : undefined,
    bodyRaw: parsed ? undefined : args.body,
    bodyBytes: Buffer.byteLength(args.body, "utf8"),
  });
  return ts;
}

// 便捷封装：记录响应侧 usage（与请求 ts 配对）。raw=原始响应体（调试空响应/异常格式
// 时填，便于看清服务器到底吐了什么）；note=附注（如 "empty stream"）。
export function logResponse(args: {
  reqTs: string;
  sessionId?: string;
  protocol: string;
  model: string;
  status?: number;
  usage?: any;
  error?: string;
  raw?: string;
  note?: string;
}): void {
  if (!transportLogEnabled()) return;
  writeTransportLog({
    ts: new Date().toISOString(),
    sessionId: args.sessionId,
    protocol: args.protocol,
    model: args.model,
    url: "(response for " + args.reqTs + ")",
    headers: {},
    bodyBytes: args.raw ? Buffer.byteLength(args.raw, "utf8") : 0,
    status: args.status,
    usage: args.usage,
    error: args.error,
    raw: args.raw,
    note: args.note,
  });
}
