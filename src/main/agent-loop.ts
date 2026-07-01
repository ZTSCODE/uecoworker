import { BrowserWindow, app } from "electron";
import { request as httpsRequest } from "https";
import { request as httpRequest } from "http";
import { executeTool, TOOL_DEFINITIONS, downscaleImageIfNeeded, saveImageBytes, type ToolContext, type AgentImage } from "./tools";
import { PermissionsManager, decideToolAction, mapToolName } from "./permissions-manager";
import { checkpointManager } from "./checkpoint-manager";
import { checklistManager } from "./checklist-manager";
import { hooksManager } from "./hooks-manager";
import { logRequest, logResponse, transportLogEnabled } from "./transport-logger";
import { getEncoding, type Tiktoken } from "js-tiktoken";

// Token 估算（provider 不返回 usage 时的兜底）。多 provider 无统一精确分词器，
// 用 o200k_base（现代模型通用近似）；加载失败退回字符/4。与渲染层 token-count 同源。
let _enc: Tiktoken | null = null;
let _encTried = false;
function estimateTokens(text: string): number {
  if (!text) return 0;
  if (!_encTried) { _encTried = true; try { _enc = getEncoding("o200k_base"); } catch { _enc = null; } }
  if (_enc) { try { return _enc.encode(text).length; } catch {} }
  return Math.ceil(text.length / 4);
}
// 估算一组消息的 token（粗略拼接 role+content）。仅用于兜底，不求精确。
function estimateMessagesTokens(msgs: ChatMessage[]): number {
  let n = 0;
  for (const m of msgs) {
    const c = m.content;
    if (typeof c === "string") n += estimateTokens(c);
    else if (Array.isArray(c)) for (const part of c) if (part && part.type === "text") n += estimateTokens(part.text || "");
    if (m.tool_calls) for (const tc of m.tool_calls) n += estimateTokens(tc.function?.name + " " + (tc.function?.arguments || ""));
    // 图片按近似定额计入(缩到 1568 长边后,各家 vision tokenizer 大致在此量级),
    // 避免带图轮次的上下文统计严重偏低。
    if (Array.isArray(m.images)) n += m.images.length * 1300;
  }
  return n;
}

// 工具定义序列化长度缓存：splitContextTokens 每轮往返都要拿 tools 的字符数，但
// effectiveTools 在一轮内（通常跨轮也）是同一个数组引用 —— 用 WeakMap 按引用缓存，
// 避免每轮 JSON.stringify 整个工具定义数组（挂大型 MCP 时这串可达数十 KB~MB）。
// 纯性能优化：结果与每次现算完全一致，不改变任何对外数字。
const _toolsCharsCache = new WeakMap<object, number>();
function toolsCharLength(tools: any[]): number {
  if (!tools || !tools.length) return 0;
  const cached = _toolsCharsCache.get(tools);
  if (cached !== undefined) return cached;
  const n = JSON.stringify(tools).length;
  _toolsCharsCache.set(tools, n);
  return n;
}

// /context 实测分项：把一次真实请求的「system / 工具定义 / 消息历史」三块各自 tiktoken
// 估算，再按字符占比把 API 实测的精确总 token（prompt_tokens）分摊到各项——分项之和恒
// 等于精确总数，且按真实密度分配，比纯本地估算准。返回各分项 token（已分摊）。
function splitContextTokens(
  msgs: ChatMessage[], tools: any[], exactTotal: number
): { systemTok: number; toolsTok: number; historyTok: number } {
  let sysChars = 0, histChars = 0;
  for (const m of msgs) {
    const c = m.content;
    const txt = typeof c === "string" ? c
      : Array.isArray(c) ? c.map((p: any) => (p && p.type === "text" ? p.text || "" : "")).join("") : "";
    let chars = txt.length;
    if (m.tool_calls) for (const tc of m.tool_calls) chars += (tc.function?.name || "").length + (tc.function?.arguments || "").length;
    if (Array.isArray(m.images)) chars += m.images.length * 5200; // 图片按 ~1300tok×4 折算成字符权重
    if (m.role === "system") sysChars += chars; else histChars += chars;
  }
  const toolsChars = toolsCharLength(tools);
  const totalChars = sysChars + histChars + toolsChars;
  if (totalChars <= 0 || exactTotal <= 0) return { systemTok: 0, toolsTok: 0, historyTok: 0 };
  // 按字符占比分摊精确总数；最后一项用减法补齐，保证三项之和 === exactTotal。
  const systemTok = Math.round(exactTotal * (sysChars / totalChars));
  const toolsTok = Math.round(exactTotal * (toolsChars / totalChars));
  const historyTok = Math.max(0, exactTotal - systemTok - toolsTok);
  return { systemTok, toolsTok, historyTok };
}


// 只取最有信息量的一个字段，截断到合理长度；取不到则返回空串。
function toolCallTarget(name: string, args: any): string {
  if (!args || typeof args !== "object") return "";
  const pick = (v: any) => (typeof v === "string" ? v : "");
  let s = "";
  switch (name) {
    case "read_file": case "write_file": case "edit_file": case "multi_edit": case "apply_diff":
      s = pick(args.file_path); break;
    case "list_files": s = pick(args.dir_path); break;
    case "run_command": case "monitor": s = pick(args.command); break;
    case "search_files": s = pick(args.pattern) + (args.dir_path ? " in " + pick(args.dir_path) : ""); break;
    case "web_search": s = pick(args.query); break;
    case "task": s = pick(args.subagent_type) + (args.description ? ": " + pick(args.description) : ""); break;
    case "generate_image": s = pick(args.prompt); break;
    default:
      // 兜底：常见字段里挑第一个字符串。
      s = pick(args.file_path) || pick(args.path) || pick(args.dir_path) || pick(args.command) || pick(args.query) || pick(args.url) || "";
  }
  // 路径只留文件名 + 上级目录，太长截断。
  s = s.replace(/[\r\n]+/g, " ").trim();
  if (s.length > 80) s = s.slice(0, 77) + "…";
  return s;
}

interface AgentRequest {
  provider: any;
  model: string;
  // 转 base64 data URL，组成 OpenAI vision 的数组 content。
  // 跨轮工具历史回放：assistant 消息可带 tool_calls（重建自上一轮的工具调用），
  // tool 消息带 tool_call_id（与 assistant.tool_calls 配对），使模型跨轮记得自己
  // 做过的工具操作。见 buildApiMessage / 渲染层历史构建。
  messages: {
    role: string;
    content: string;
    images?: string[];
    tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    tool_call_id?: string;
  }[];
  workingDir: string;
  sessionId: string;
  runId: string;
  // Optional per-session permission mode; overrides the global config mode.
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  // Current to-do roadmap (from update_todos), carried so a continued/resumed
  // turn knows the existing list and keeps updating it instead of forgetting.
  todos?: { content: string; status: string; activeForm?: string }[];
  // 已启用 skill 的注入块(name+description+SKILL.md 路径),由 ipc-handlers 经
  // skillsManager.systemPromptBlock 生成。空串=无可用 skill,不注入。
  skillsBlock?: string;
  // 子 agent 名单(roster):可派发的 agent 名 + mode + description,由 ipc-handlers
  // 经 agentsManager.systemPromptBlock 生成。空串=无可用 agent,不注入。与 skillsBlock
  // 同样放在系统提示之后、对话历史之前,落进稳定缓存前缀。
  agentsBlock?: string;
  // 记忆/上下文注入块:CLAUDE.md(global/project/local)+ 常驻长期记忆索引,由
  // ipc-handlers 经 memoryManager.systemPromptBlock 生成。空串=无可用内容,不注入。
  // 放在系统提示之后、对话历史之前,落进 Anthropic 缓存前缀(第二轮起边际成本≈0)。
  memoryBlock?: string;
  // 纯聊天模式(/chat):系统提示去掉「先调查代码库/先读文件」等主动调查引导,
  // 默认直接对话。工具仍可用(模型需要时仍能读文件/搜索),只是不主动伸手读项目。
  chatMode?: boolean;
  // 文字游戏模式(/game):进入 AI RPG。系统提示要求模型按固定结构输出(正文 +
  // 角色卡/背景/状态/物品/地点折叠块 + 末尾 ask_followup_question 给行动选项)。
  gameMode?: boolean;
  // 模型推理强度(/effort):写入 OpenAI 兼容请求体的 reasoning_effort 字段。
  // 取值 minimal|low|medium|high;undefined=不发送该字段,跟随端点默认。
  // 不支持该字段的端点会忽略;Anthropic 协议分支不发送(无此参数)。
  effort?: "minimal" | "low" | "medium" | "high";
  // 扩展思考(/think,仅 Anthropic 协议):true 时请求体注入 thinking 参数(按模型
  // 版本分流 adaptive/budget),display:"summarized" 让模型回传思考摘要,在对话流里
  // 以可折叠的思考气泡展示。其它协议(OpenAI/Responses)忽略此字段。
  thinkingMode?: boolean;
}

/** One UI message in the authoritative turn state (mirrors Cline's clineMessages). */
interface UiMsg {
  id: string;
  role: "assistant" | "tool";
  content: string;
  partial: boolean; // true = still streaming, false = finalized
  toolCall?: { id?: string; name: string; input: any; output?: string; approved?: boolean };
  // 思考原始数据(回传必需,与思考气泡的可读文本解耦):Anthropic thinking 块(含
  // signature/redacted data)与 OpenAI reasoning_content。由主循环在每轮 LLM 往返后经
  // attachAssistantMeta 挂到承载该轮的 assistant 气泡上,随快照落库、跨轮重建后原样
  // 回传——使会话持久化/重载后思考链不丢、不报 400(详见 attachAssistantMeta 注释)。
  thinking?: ThinkingBlock[];
  reasoning_content?: string;
}

// 思考气泡的伪工具名:渲染层据此把这条 role:"tool" 消息识别为「思考过程」,
// 复用工具折叠卡片(默认展开、下一条消息产生时自动折叠),不另起 UI 组件。
const THINKING_TOOL_NAME = "__thinking__";

/**
 * Holds the authoritative message list for a single agent turn and pushes
 * throttled snapshots to the renderer via `agent:turn`. The renderer renders
 * verbatim — it never decides whether to start or append a bubble.
 */
class TurnEmitter {
  private msgs: UiMsg[] = [];
  private cur: UiMsg | null = null; // current streaming assistant bubble
  private seq = 0;
  private lastFlush = 0;
  private pending = false;
  // 节流尾随定时器：被节流窗口挡下的 flush 不能干等下一次事件来补发（流式最后几个
  // token 常落在窗口内，否则要等到 tool-call/done 才显示，观感上「末尾字突现」）。
  // 置 pending 时挂一个定时器，窗口结束兜底补发；真正 flush 时清掉。
  private flushTimer: NodeJS.Timeout | null = null;
  // --- 增量传输（性能优化，叠加在全量快照之上，全量永远是兜底真相源）---
  // 纯文字/思考逐字增长时，不再每 60ms 重发整个消息数组，而是发「增量帧」(只带
  // 当前气泡 id + 追加文本)。增量与全量走同一个 agent:turn 通道(IPC FIFO 保证不
  // 乱序)，接收端按 id 把 delta 追加到对应消息。任何结构性变化(新气泡/工具/done)
  // 仍发全量快照覆盖，把潜在偏差清零。lastFullText 记录「上次已随全量/增量发出的
  // 当前气泡文本」，用于算出真正的增量后缀。
  private lastDeltaId: string | null = null;   // 当前正在做增量的气泡 id
  private lastSentText = "";                    // 该气泡已发出的文本（全量或增量累计）
  private lastFullAt = 0;                        // 上次发全量的时间（纯文字流式定期全量校正）
  private readonly FULL_RESYNC_MS = 1000;       // 纯文字流式每满 1s 强制一次全量兜底
  // contextTokens：真实「上下文窗口占用量」= 最后一次 LLM 往返的输入 token（含
  // cache），用于阈值告警/自动压缩判定。区别于 promptTokens（跨工具迭代累加，用于
  // 计费统计）——后者在工具密集回合会远超窗口真实占用，不能拿来判窗口是否将满。
  private usage: { promptTokens: number; completionTokens: number; contextTokens?: number; estimated?: boolean; cacheCreate?: number; cacheRead?: number; turnCacheRead?: number; breakdown?: { systemTok: number; toolsTok: number; historyTok: number } } | null = null;

  constructor(
    private window: BrowserWindow,
    private sessionId: string,
    private runId: string
  ) {}

  private id(prefix: string): string {
    this.seq++;
    return this.runId + "-" + prefix + "-" + this.seq;
  }

  /** Append a text delta to the current assistant bubble, creating one if needed. */
  appendText(delta: string): void {
    if (!this.cur) {
      this.endThinking(); // 思考段先于文字:文字开始即定格思考气泡
      this.cur = { id: this.id("a"), role: "assistant", content: "", partial: true };
      this.msgs.push(this.cur);
    }
    this.cur.content += delta;
    this.flushStreaming();
  }

  /** Finalize the current assistant bubble (text segment ended). */
  endText(): void {
    // 无条件反映「本轮文字气泡状态」作为 attachAssistantMeta 的锚点:有文字则记该气泡,
    // 无文字(纯工具轮 / 思考先行)则置 null。关键:若仅在 this.cur 存在时才更新锚点,纯
    // 文字轮残留的旧气泡会被下一无文字轮的 attachAssistantMeta 误用,导致思考数据挂到上
    // 一轮 assistant、signature 与内容错位 400。appendThinking 内部调本方法时 this.cur 通常
    // 为 null(思考先于文字),置 null 无害——随后同轮 appendText 重建 cur,主循环末尾 endText
    // 再正确锚定。
    this.lastEndedTextBubble = this.cur;
    if (this.cur) {
      this.cur.partial = false;
      this.cur = null;
    }
  }

  // 本轮(最近一次 LLM 往返)刚定格的 assistant 文字气泡。attachAssistantMeta 以它为锚把
  // 思考原始数据挂上;纯工具轮(模型只回 tool_use 无文字)它为 null,则合成空 assistant 承载。
  private lastEndedTextBubble: UiMsg | null = null;

  /**
   * 把本轮 LLM 往返的「思考原始数据」(回传必需,与思考气泡的可读文本解耦)挂到承载本轮的
   * assistant 气泡上。Anthropic→thinking 块(含 signature/redacted data);OpenAI→reasoning_content。
   *
   * 为什么需要它:思考原始数据原本只活在 streamCompletion 返回值(内存 messages 数组),会话
   * 持久化/重载后丢失。让它搭上「UiMsg 快照→applyTurn→localStorage」这条唯一落库通道,即可
   * 跨轮重建后原样回传(不丢思考链、不报 400)。展示用的思考气泡(__thinking__)维持现状,二者
   * 数据同源但落点不同、互不依赖。
   *
   * 锚点:必须在每轮 endText() 之后、addTool() 之前调用——此时 lastEndedTextBubble 即本轮文字
   * 气泡(若有)。无文字气泡(纯工具轮)则合成一条空 assistant push 到 msgs 尾部承载(后续该轮的
   * 工具气泡会排在其后,与 buildReplayMessages 阶段 A「assistant+随后 tool 配对」结构对称)。
   */
  attachAssistantMeta(thinking?: ThinkingBlock[], reasoning_content?: string, hasTools?: boolean): void {
    const hasThinking = Array.isArray(thinking) && thinking.length > 0;
    // reasoning_content 仅在「确有内容」时才落:空串是 DeepSeek 工具轮的协议占位,不必持久化
    // (重建侧 cleanMessages 会按需补),持久化空串只会增加噪音。
    const hasReasoning = typeof reasoning_content === "string" && reasoning_content.length > 0;
    // 需要一条 assistant 来「承载」本轮时才动作:① 有思考/推理原始数据要挂(回传必需);
    // 或 ② 本轮是工具轮(hasTools)——必须有一条 assistant 承接随后的工具气泡,使每个工具
    // 轮在历史里各自归属独立 assistant。否则连续「纯工具轮」(模型只回工具、无文字无思考,
    // 如 navigate→screenshot)的工具气泡在 store 里相邻无分隔,buildReplayMessages 阶段 A
    // 会把它们贪婪合并进同一条 assistant,每轮改写已缓存的历史前缀、击穿 prompt 缓存。
    // 三者皆无(空响应轮)则不合成,避免留下噪音空气泡。
    if (!hasThinking && !hasReasoning && !hasTools) return;
    let host = this.lastEndedTextBubble;
    if (!host) {
      // 无文字气泡的工具轮 / 纯思考轮:合成空 assistant 承载(它将排在本轮工具气泡之前)。
      host = { id: this.id("a"), role: "assistant", content: "", partial: false };
      this.msgs.push(host);
    }
    if (hasThinking) host.thinking = thinking;
    if (hasReasoning) host.reasoning_content = reasoning_content;
    this.lastEndedTextBubble = null; // 用过即清,避免下一轮误挂到上一轮气泡
    this.flush(true);
  }

  // 当前正在流式的思考气泡(role:"tool" + name=__thinking__)。思考块在 Anthropic
  // 响应里排在 text 之前,故思考气泡也产生在文字气泡之前——下一条文字消息出现即满足
  // 渲染层 hasFollowing 判定,自动折叠。display:"summarized" 下 thinking_delta 累计
  // 进 toolCall.output;display:"omitted" 不会有 delta,则整条不产生(无可展示内容)。
  private curThinking: UiMsg | null = null;

  /** Append a thinking-summary delta to the current thinking bubble, creating one if needed. */
  appendThinking(delta: string): void {
    if (!this.curThinking) {
      this.endText(); // 思考先于文字:确保文字气泡未抢先创建
      this.curThinking = { id: this.id("think"), role: "tool", content: "", partial: true,
        toolCall: { name: THINKING_TOOL_NAME, input: {}, output: "" } };
      this.msgs.push(this.curThinking);
    }
    this.curThinking.toolCall!.output = (this.curThinking.toolCall!.output || "") + delta;
    this.flushStreaming();
  }

  /** Finalize the current thinking bubble (thinking segment ended). */
  endThinking(): void {
    if (this.curThinking) {
      this.curThinking.partial = false;
      this.curThinking = null;
    }
  }

  /** Add a tool message; ends any in-progress text bubble first. */
  addTool(id: string | undefined, name: string, input: any): void {
    this.endThinking(); // 思考→直接工具调用(无中间文字)时也要定格思考气泡
    this.endText();
    this.msgs.push({ id: id || this.id("t"), role: "tool", content: "", partial: true,
      toolCall: { id, name, input } });
    this.flush(true);
  }

  /** Fill a tool message's result by tool_call id. */
  setToolResult(id: string | undefined, output: string, approved: boolean): void {
    const target = id
      ? this.msgs.find((m) => m.role === "tool" && m.toolCall?.id === id)
      : this.msgs.slice().reverse().find((m) => m.role === "tool");
    if (target && target.toolCall) {
      target.toolCall.output = output;
      target.toolCall.approved = approved;
      target.partial = false;
    }
    this.flush(true);
  }

  /** Record cumulative per-turn token usage; surfaced in the turn snapshot.
   *  contextTokens = 本次（最近一次）LLM 往返的输入占用，用于窗口将满判定。
   *  breakdown = 按真实请求字符占比把精确 contextTokens 分摊到 system/工具/历史（/context 用）。
   *  turnCacheRead = 本次（最近一次）往返读取的缓存（瞬时，与 contextTokens 同口径），
   *    专供「上一条消息」命中率显示；cacheRead 仍是 turn 内累加值，供「会话平均」与计费。 */
  setUsage(promptTokens: number, completionTokens: number, estimated: boolean, cacheCreate = 0, cacheRead = 0, contextTokens = 0, breakdown?: { systemTok: number; toolsTok: number; historyTok: number }, turnCacheRead = 0): void {
    this.usage = { promptTokens, completionTokens, contextTokens, estimated, cacheCreate, cacheRead, turnCacheRead, breakdown };
    this.flush(true);
  }

  /** Push a snapshot. Throttled unless `force` (state transitions / completion). */
  flush(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastFlush < 60) {
      this.pending = true;
      // 兜底：若窗口结束仍无新事件来触发 flush，定时器补发最新快照。
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          if (this.pending) this.flush(true);
        }, 60);
      }
      return;
    }
    this.lastFlush = now;
    this.pending = false;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.sendFull(false);
  }

  // 发送全量快照（权威真相源）。同时把增量基线对齐到当前流式气泡的已发文本，
  // 这样紧随其后的增量帧能算出正确的后缀。done=true 时为终态快照。
  private sendFull(done: boolean): void {
    this.lastFlush = Date.now();
    this.lastFullAt = this.lastFlush;
    // 重置增量基线：当前若有流式气泡，则基线 = 它当前的全文（增量从这里续）。
    const live = this.curThinking || this.cur;
    if (live && !done) {
      this.lastDeltaId = live.id;
      this.lastSentText = this.streamTextOf(live);
    } else {
      this.lastDeltaId = null;
      this.lastSentText = "";
    }
    if (this.window.isDestroyed()) return;
    this.window.webContents.send("agent:turn", {
      runId: this.runId,
      sessionId: this.sessionId,
      messages: this.msgs.map((m) => ({ ...m, toolCall: m.toolCall ? { ...m.toolCall } : undefined })),
      usage: this.usage,
      done,
    });
  }

  // 取一条流式气泡「正在增长」的文本：assistant 文字气泡用 content，思考气泡用
  // toolCall.output。增量只针对这两类逐字增长内容。
  private streamTextOf(m: UiMsg): string {
    if (m.role === "tool" && m.toolCall && m.toolCall.name === THINKING_TOOL_NAME) {
      return m.toolCall.output || "";
    }
    return m.content || "";
  }

  // 流式增量路径（appendText/appendThinking 调用）。只对「同一气泡持续增长」发增量
  // 帧；遇到新气泡、距上次全量超过 FULL_RESYNC_MS、或节流窗内，则回退到全量/节流，
  // 保证接收端永远能用全量纠偏。增量帧与全量同走 agent:turn（IPC FIFO 不乱序）。
  private flushStreaming(): void {
    const live = this.curThinking || this.cur;
    if (!live) { this.flush(false); return; }
    const now = Date.now();
    // 新气泡，或上一帧不是针对这个气泡：必须先发一次全量，让接收端先建出该消息。
    if (this.lastDeltaId !== live.id) { this.flush(true); return; }
    // 节流：窗口内不发，挂尾随定时器兜底（与全量同一套 pending/flushTimer 机制）。
    if (now - this.lastFlush < 60) {
      this.pending = true;
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          if (this.pending) this.flushStreaming();
        }, 60);
      }
      return;
    }
    // 定期全量校正：纯文字流式每满 1s 强制发一次全量，把任何潜在偏差清零。
    if (now - this.lastFullAt >= this.FULL_RESYNC_MS) { this.flush(true); return; }
    const full = this.streamTextOf(live);
    // 正常情况增量是 lastSentText 的纯后缀；若不是（极少见，如被改写），回退全量。
    if (!full.startsWith(this.lastSentText)) { this.flush(true); return; }
    const delta = full.slice(this.lastSentText.length);
    if (!delta) return; // 无新增，不发空帧
    this.lastFlush = now;
    this.pending = false;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.lastSentText = full;
    if (this.window.isDestroyed()) return;
    // 增量帧：带 delta 字段（{id, append}）。接收端按 id 把 append 追加到该消息，
    // 找不到该 id 时忽略（下一次全量会补齐），绝不凭增量新建消息。
    this.window.webContents.send("agent:turn", {
      runId: this.runId,
      sessionId: this.sessionId,
      delta: { id: live.id, append: delta },
      done: false,
    });
  }

  /** Finalize everything and send the terminal snapshot. */
  done(): void {
    this.endThinking();
    this.endText();
    for (const m of this.msgs) m.partial = false;
    // 终态前清掉尾随定时器，杜绝 done:true 之后再迟到一个 done:false 快照。
    this.pending = false;
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.sendFull(true);
  }
}

interface ToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

// Anthropic 扩展思考块。原样捕获、原样回放——signature 是不透明加密串,绝不解析或
// 改字节(改了会 400)。两种形态:普通 thinking(带可读 summary + signature)与
// redacted_thinking(安全屏蔽,只有不透明 data)。回放时按模型发出的原始顺序排在
// 同一条 assistant 消息的 text/tool_use 之前(响应里思考块本就排最前)。
type ThinkingBlock =
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

interface ChatMessage {
  role: string;
  content: string | null | any[]; // 数组 = OpenAI vision 多模态 content（文本+图片）
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  usage?: any; // 仅 assistant 消息在流结尾携带 token 统计（不发回 API）
  // tool 消息的图片附件(截图/MCP image 块)。按协议在序列化时回灌给视觉模型:
  // Anthropic→tool_result 内嵌 image block;Responses→function_call_output 带图;
  // OpenAI /chat/completions 不支持,丢弃只留文字占位。base64 不含 data: 前缀。
  images?: AgentImage[];
  // Anthropic 扩展思考(/think):本轮 assistant 回复携带的思考块,跨轮回放时必须
  // 原样带回(尤其带 tool_use 时,缺了会 400)。仅 Anthropic 协议序列化时回灌,
  // 其它协议忽略。空/缺省=无思考块。
  thinking?: ThinkingBlock[];
  // OpenAI 协议推理系模型(如 deepseek 推理)的思考串。部分端点要求带 tool_calls 的
  // assistant 回传时必须把当轮 reasoning_content 一并带回(尤其多 tool_calls 时严格
  // 校验),否则下一轮 400。仅 OpenAI /chat/completions 序列化时回灌,其它协议忽略。
  reasoning_content?: string;
}

// 本地图片 base64 缓存：以「路径 + mtime + size」为 key，命中即复用，避免历史图片
// 每轮都重新 readFile + base64（既阻塞 event loop，又重复 CPU）。缓存值是纯 base64
// （不含 mime/data: 前缀），imagePathToDataUrl 与 imagePathToAgentImage 共用同一份。
// 关键：同一文件每次返回字节级一致的 base64 —— 这对 prompt 缓存前缀是「有利」的
// （保证历史消息字节不漂移），不会引入新的击穿点。
// 有界：按条目数与总字节双上限做 LRU 淘汰（图片可能数 MB，必须防无限增长）。
interface ImgCacheEntry { mtimeMs: number; size: number; base64: string; }
const _imgB64Cache = new Map<string, ImgCacheEntry>();
let _imgB64CacheBytes = 0;
const IMG_CACHE_MAX_ENTRIES = 48;
const IMG_CACHE_MAX_BYTES = 96 * 1024 * 1024; // ~96MB base64 上限

function _imgCacheEvictIfNeeded(): void {
  // Map 按插入序迭代，最旧的在前；超限则从最旧开始淘汰。
  while (
    (_imgB64Cache.size > IMG_CACHE_MAX_ENTRIES || _imgB64CacheBytes > IMG_CACHE_MAX_BYTES) &&
    _imgB64Cache.size > 0
  ) {
    const oldestKey = _imgB64Cache.keys().next().value as string;
    const old = _imgB64Cache.get(oldestKey);
    if (old) _imgB64CacheBytes -= old.base64.length;
    _imgB64Cache.delete(oldestKey);
  }
}

// 异步读取本地图片为 base64（带缓存）。返回 null = 读失败/文件不存在。
async function readImageBase64Cached(p: string): Promise<string | null> {
  try {
    const { readFile, stat } = require("fs/promises");
    const st = await stat(p);
    const cached = _imgB64Cache.get(p);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      // 命中：刷新 LRU 顺序（delete+set 把它移到「最新」端）。
      _imgB64Cache.delete(p);
      _imgB64Cache.set(p, cached);
      return cached.base64;
    }
    const buf = await readFile(p);
    const base64 = buf.toString("base64");
    // 替换旧条目时先扣减旧字节。
    if (cached) _imgB64CacheBytes -= cached.base64.length;
    _imgB64Cache.set(p, { mtimeMs: st.mtimeMs, size: st.size, base64 });
    _imgB64CacheBytes += base64.length;
    _imgCacheEvictIfNeeded();
    return base64;
  } catch {
    return null;
  }
}

// 把本地图片路径读成 base64 data URL（OpenAI vision 接口最通用的图片传法）。
async function imagePathToDataUrl(p: string): Promise<string | null> {
  const b64 = await readImageBase64Cached(p);
  if (b64 == null) return null;
  const { extname } = require("path");
  const ext = (extname(p) || ".png").slice(1).toLowerCase();
  const mime = ext === "jpg" ? "jpeg" : ext;
  return "data:image/" + mime + ";base64," + b64;
}

// 把本地图片路径读成 AgentImage(纯 base64 + mime)。用于把 generate_image 等
// 只落地路径的工具产物补成可回灌的图片对象。
async function imagePathToAgentImage(p: string): Promise<AgentImage | null> {
  const b64 = await readImageBase64Cached(p);
  if (b64 == null) return null;
  const { extname } = require("path");
  const ext = (extname(p) || ".png").slice(1).toLowerCase();
  const mime = ext === "jpg" ? "image/jpeg" : "image/" + ext;
  return { mime, base64: b64 };
}

// 从工具输出末行的 GENERATED_IMAGE_PATHS:["...","..."] 标记解析出落地图片路径。
function parseGeneratedPaths(output: string): string[] {
  if (!output) return [];
  const m = /GENERATED_IMAGE_PATHS:(\[[\s\S]*\])\s*$/.exec(output);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[1]);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

// 构建发往 API 的一条消息：有 images 则组成 [text, image_url...] 数组 content；
// 否则保持纯字符串（兼容非 vision 模型）。跨轮回放时透传 tool_calls（assistant）
// 与 tool_call_id（tool 结果），使协议序列化能重建 assistant↔tool 配对。
function buildApiMessage(m: { role: string; content: string; images?: string[]; tool_calls?: any[]; tool_call_id?: string; thinking?: ThinkingBlock[]; reasoning_content?: string }): ChatMessage | Promise<ChatMessage> {
  if (m.role === "user" && Array.isArray(m.images) && m.images.length > 0) {
    // 异步并发读取本条消息的所有图片，再按原顺序拼装（保证多图顺序不乱）。
    const imgs = m.images;
    return (async () => {
      const parts: any[] = [];
      if (m.content && m.content.trim()) parts.push({ type: "text", text: m.content });
      const urls = await Promise.all(imgs.map((p) => imagePathToDataUrl(p)));
      for (const url of urls) {
        if (url) parts.push({ type: "image_url", image_url: { url } });
      }
      if (parts.length > 0) return { role: m.role, content: parts } as ChatMessage;
      // 无任何图片读成功：退回纯文本（与下方同构）。
      return { role: m.role, content: m.content } as ChatMessage;
    })();
  }
  // tool 结果消息（跨轮回放）：保留 tool_call_id 以与 assistant.tool_calls 配对。
  // 带 images（截图/生图/读图落地的本地路径）时，读盘→与首次发送相同的 downscale→
  // AgentImage[]，挂到 m.images 供三协议序列化转 image block。关键：必须走与实时发送
  // (collectImages→downscaleImageIfNeeded) 完全相同的确定性变换，产出字节一致的
  // base64，否则「首次有图、重建无图/图不同」会击穿缓存前缀。读不出或缩放后超阈值的
  // 图丢弃，并在文本末尾追加占位说明（避免模型误以为没产图）。
  if (m.role === "tool" && m.tool_call_id) {
    if (Array.isArray(m.images) && m.images.length > 0) {
      const imgs = m.images;
      return (async () => {
        const loaded = await Promise.all(imgs.map((p) => imagePathToAgentImage(p)));
        const scaled = loaded
          .map((im) => (im ? downscaleImageIfNeeded(im) : null))
          .filter((im): im is AgentImage => im != null);
        const dropped = imgs.length - scaled.length;
        const out: ChatMessage = { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
        if (scaled.length > 0) out.images = scaled;
        if (dropped > 0) {
          out.content = (typeof m.content === "string" ? m.content : "") +
            "\n[" + dropped + " image(s) unavailable for replay]";
        }
        return out;
      })();
    }
    return { role: "tool", tool_call_id: m.tool_call_id, content: m.content };
  }
  // assistant 消息带重建的 tool_calls（跨轮回放）。思考原始数据(thinking/reasoning_content)
  // 从重建历史原样透传,供下游 toAnthropicRequest / cleanMessages 回灌(回传必需,缺则 400)。
  if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
    const out: ChatMessage = { role: "assistant", content: m.content || null, tool_calls: m.tool_calls };
    if (Array.isArray(m.thinking) && m.thinking.length > 0) out.thinking = m.thinking;
    if (typeof m.reasoning_content === "string") out.reasoning_content = m.reasoning_content;
    return out;
  }
  return { role: m.role, content: m.content };
}

/** Injected by ipc-handlers: prompts the renderer and resolves with the user's decision. */
export type ApprovalFn = (req: {
  callId: string;
  tool: string;
  permTool: string;
  input: any;
}) => Promise<boolean>;

/** A single followup question, optionally with suggested answers. */
export interface FollowupQuestion { question: string; options?: string[]; }

/**
 * Injected by ipc-handlers: asks the user one or more questions, resolves with
 * their answers (one string per question, same order). An empty string means
 * "not answered" for that question.
 */
export type FollowupFn = (req: {
  callId: string;
  questions: FollowupQuestion[];
  // 计划审批专用:非空时表示这是 exit_plan_mode 发起的计划卡,渲染层据此
  // 渲染为「计划审批」并在批准时切出 plan 模式。普通 followup 不带此字段。
  plan?: string;
}) => Promise<string[]>;

/**
 * Agent loop: streams from an OpenAI-compatible API, executes tools (gated by
 * the permission manager), and loops until the model produces a final answer.
 * Provider-agnostic — works with any compatible endpoint.
 */
export async function runAgentLoop(
  req: AgentRequest,
  window: BrowserWindow,
  permissions: PermissionsManager,
  requestApproval: ApprovalFn,
  signal?: AbortSignal,
  requestFollowup?: FollowupFn,
  toolCtx?: ToolContext
): Promise<string> {
  const provider = req.provider;
  const model = req.model;
  const workingDir = req.workingDir;
  const messages: ChatMessage[] = [];
  const emitter = new TurnEmitter(window, req.sessionId, req.runId);

  // 当前权限模式。初值取本轮请求快照,但模型可在本轮内调用 enter_plan_mode
  // 自主切入只读计划模式 —— 那之后这个变量被改写,本轮剩余的权限门 / 系统提示
  // 都读它(而非 req.permissionMode 快照),使「进入计划模式」立即生效。
  let currentMode = req.permissionMode;
  // 进入 plan 模式前的「原始模式」,用于 exit_plan_mode 批准后当轮恢复(使批准即可
  // 写,不必等下一轮)。plan 模式下默认回落到 default。
  let modeBeforePlan: "default" | "acceptEdits" | "bypassPermissions" | "plan" =
    req.permissionMode && req.permissionMode !== "plan" ? req.permissionMode : "default";

  // --- Notification hook: 在 agent「等待用户输入」时触发(权限审批 / 提问 / 计划审批)。---
  // 纯副作用(桌面通知、推送等),不阻塞也不改变等待结果;fire-and-forget,绝不拖慢
  // 审批弹窗。通过包装 requestApproval / requestFollowup 一处接通全部等待点。
  const fireNotification = (message: string): void => {
    try {
      void hooksManager
        .runHooks("Notification", { hook_event_name: "Notification", message, session_id: req.sessionId, cwd: workingDir }, workingDir)
        .catch(() => { /* 通知 hook 失败不影响等待 */ });
    } catch { /* 非阻塞 */ }
  };
  const requestApprovalH: ApprovalFn = (r) => {
    fireNotification('Permission required: tool "' + r.tool + '" is waiting for your approval.');
    return requestApproval(r);
  };
  const requestFollowupH: FollowupFn | undefined = requestFollowup
    ? (r) => {
        fireNotification(r.plan ? "A plan is ready and waiting for your approval." : "The agent is asking a question and waiting for your answer.");
        return requestFollowup(r);
      }
    : undefined;

  messages.push({ role: "system", content: buildSystemPrompt(workingDir, currentMode, req.chatMode, req.gameMode, req.provider && req.provider.vision !== false) });
  // Skills 元数据注入(渐进式披露第一层):模型据此决定是否 read_file 读全文。
  if (typeof req.skillsBlock === "string" && req.skillsBlock.trim()) {
    messages.push({ role: "system", content: req.skillsBlock });
  }
  // 子 agent 名单(roster):放在 skills 之后、对话历史之前,进稳定缓存前缀。task
  // 工具 schema 静态恒定,可派发 agent 名只在此块枚举(启停 agent 只改此块字节)。
  if (typeof req.agentsBlock === "string" && req.agentsBlock.trim()) {
    messages.push({ role: "system", content: req.agentsBlock });
  }
  // 记忆/CLAUDE.md 注入:对话历史之前 → 落进稳定缓存前缀。Tier 0 常驻索引极小,
  // 全文/reference 类靠 recall_memory + read_file 按需召回,不进前缀。
  if (typeof req.memoryBlock === "string" && req.memoryBlock.trim()) {
    messages.push({ role: "system", content: req.memoryBlock });
  }
  // 出图能力提示：告诉模型有哪些图片供应商/模型可选、可指定保存目录。内容随会话的
  // 图片供应商配置决定，但对同一配置字节恒定 → 放在「对话历史之前」进稳定缓存前缀。
  // （此前放在历史尾部，跨轮历史变长会让它的位置漂移、击穿其后整段历史的缓存断点。）
  if (toolCtx && toolCtx.imageGen) {
    const pool = Array.isArray(toolCtx.imageGen.providers) ? toolCtx.imageGen.providers : [];
    if (pool.length > 0) {
      const listed = pool.map(function (p) {
        const ms = (p.models && p.models.length) ? p.models.join(", ") : p.model;
        return "- " + (p.name || "(unnamed)") + " — models: " + ms;
      }).join("\n");
      messages.push({
        role: "system",
        content:
          "Image generation (generate_image tool) is available. By default it uses the user's selected image provider/model and save location. " +
          "ONLY when the user explicitly asks for a specific provider, model, or save folder, pass the `provider` / `model` / `save_dir` arguments accordingly. Available image providers and their models:\n" +
          listed,
      });
    }
  }
  for (const m of req.messages) {
    // buildApiMessage 对带图 user 消息返回 Promise（异步读图，不阻塞 event loop）；
    // 其余分支返回同步值，await 之无害。顺序 push 保证历史消息顺序不变。
    messages.push(await buildApiMessage(m));
  }

  // --- Lifecycle hooks: SessionStart + UserPromptSubmit (协议无关，所有 provider 共享) ---
  // 失败/超时不阻断主流程；exit-0 stdout 作为 system 上下文注入，UserPromptSubmit
  // exit 2 可拒绝该轮（把拒绝理由作为最终答复返回）。
  try {
    const hookCtx = { session_id: req.sessionId, cwd: workingDir };
    const ss = await hooksManager.runHooks("SessionStart", { hook_event_name: "SessionStart", ...hookCtx }, workingDir);
    if (ss.additionalContext) messages.push({ role: "system", content: ss.additionalContext });

    const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
    const promptText = lastUser ? (typeof lastUser.content === "string" ? lastUser.content : "") : "";
    const ups = await hooksManager.runHooks(
      "UserPromptSubmit",
      { hook_event_name: "UserPromptSubmit", prompt: promptText, permission_mode: req.permissionMode, ...hookCtx },
      workingDir
    );
    if (ups.block) {
      const msg = "Prompt rejected by UserPromptSubmit hook: " + (ups.reason || "blocked");
      emitter.appendText(msg);
      emitter.endText();
      emitter.done();
      return msg;
    }
    if (ups.additionalContext) messages.push({ role: "system", content: ups.additionalContext });
  } catch { /* hooks 不可用不影响主流程 */ }

  // Remind the model of the current to-do roadmap (tool history isn't replayed,
  // so without this it would forget the list after an interruption and stop
  // calling update_todos). Appended after the conversation so it's most recent.
  if (Array.isArray(req.todos) && req.todos.length > 0) {
    const lines = req.todos.map((t, i) => {
      const mark = t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]";
      return (i + 1) + ". " + mark + " " + t.content + (t.status === "in_progress" ? " (in progress)" : "");
    });
    messages.push({
      role: "system",
      content:
        "Current to-do roadmap (from update_todos). Continue from here: mark the next step in_progress, " +
        "mark finished steps completed, and call update_todos with the FULL updated list as you progress. " +
        "Do not drop or restart items that are already done.\n" + lines.join("\n"),
    });
  }

  // 内置工具 + MCP 工具（如果有），一并发给模型。MCP 工具名带 "<server>__" 前缀，
  // executeTool 命中前缀时经 toolCtx.mcpCall 路由回对应 MCP 服务器。
  const effectiveTools = (toolCtx && Array.isArray(toolCtx.mcpTools) && toolCtx.mcpTools.length)
    ? TOOL_DEFINITIONS.concat(toolCtx.mcpTools)
    : TOOL_DEFINITIONS;

  // （出图能力提示已上移到对话历史之前的稳定前缀，见 buildSystemPrompt 之后；
  //   此处不再注入，避免跨轮位置漂移击穿缓存。）

  // 把本轮中止信号并入工具上下文，使长时间运行的工具（monitor）能被「停止」按钮
  // 取消（杀子进程、返回已捕获内容），而不是空转到自身超时。
  if (signal) toolCtx = Object.assign({}, toolCtx, { signal });
  // 把当前会话 id 并入工具上下文，使 search_sessions 能排除正在进行的对话自身。
  toolCtx = Object.assign({}, toolCtx, { currentSessionId: req.sessionId });

  // 图片回灌:per-call 缓冲 + collectImages。每次工具调用前清空 _imgBuf,带图工具
  // (截图/MCP image 块)往里推;调用后取出挂到 tool 消息。视觉模型关闭(vision===
  // false)或 OpenAI /chat/completions 协议下,图最终会被丢弃(序列化时处理)。
  const visionOn = !(req.provider && req.provider.vision === false);
  let _imgBuf: AgentImage[] = [];
  toolCtx = Object.assign({}, toolCtx, {
    collectImages: (imgs: AgentImage[]) => { if (Array.isArray(imgs)) for (const im of imgs) if (im && im.base64) _imgBuf.push(im); },
  });
  // 图片不做「按数量淘汰历史截图」：删历史图会改写已缓存的前缀消息、击穿 prompt 缓存
  // （详见下方 toolMsg.push 处注释）。图片总量随 /compact 压缩时连同旧消息一起出局。

  // 迭代上限：此前固定 15 太低，读大项目等正常长任务常被误伤中断。抬到 100 作为
  // 纯安全网（防 token 爆炸/失控），真正的死循环交给下面的「无进展检测」精准识别，
  // 而不是靠低上限一刀切。
  const maxIterations = 100;
  let iteration = 0;
  let fullResponse = "";
  // 无进展（死循环）检测：记录最近若干次「工具调用签名」（name+JSON 参数）。
  // 同一签名连续重复达到阈值，说明模型卡在重复同一个无效调用，主动 break，
  // 而非空转到上限。正常任务每步参数都在变化，不会触发。
  const NO_PROGRESS_LIMIT = 5;
  let lastToolSig = "";
  let repeatCount = 0;
  let abortedForLoop = false;
  // 权限拒绝熔断:模型在 plan 模式(或工具被禁)下反复换不同文件/命令尝试写,每次
  // 参数都不同 → 上面的「签名重复」检测抓不到,会空转到撞网络错误/上限。这里独立
  // 统计「连续被 deny」次数(不看参数),达阈值即主动停下并提示用户切换模式,而不是
  // 闷头空转。任何一次非 deny(成功执行/被批准/只读放行)都清零。
  const DENY_STREAK_LIMIT = 5;
  let denyStreak = 0;
  let abortedForDeny = false;
  // 本轮累计 token（跨多次 LLM 往返，含工具迭代）。
  let turnPromptTokens = 0;
  let turnCompletionTokens = 0;
  // 缓存 token（provider 在 usage 里返回时采集，零额外成本）：缓存创建/缓存读取。
  let turnCacheCreate = 0;
  let turnCacheRead = 0;
  // 最近一次 LLM 往返的输入占用（含 cache），= 当前上下文窗口真实占用，用于阈值判定。
  let lastContextTokens = 0;
  // 最近一次 LLM 往返「读取的缓存」瞬时值（与 lastContextTokens 同一次往返、同口径），
  // 专供「上一条消息」缓存命中率显示。绝不能用 turnCacheRead（那是 turn 内跨多次工具
  // 往返的累加值，拿它除以瞬时的 lastContextTokens 会让命中率远超 100%）。
  let lastTurnCacheRead = 0;

  try {
    while (iteration < maxIterations) {
      if (signal?.aborted) break;
      iteration++;
      const assistantMsg = await streamCompletionWithRetry(provider, model, messages, effectiveTools, window, signal, req.effort, (delta) => {
        fullResponse += delta;
        emitter.appendText(delta);
      }, req.sessionId, 3, req.thinkingMode, (tdelta) => {
        // 思考摘要增量 → 思考气泡(role:"tool" + __thinking__);文字开始时自动定格。
        emitter.appendThinking(tdelta);
      });

      // Text segment for this iteration is complete.
      emitter.endThinking();
      emitter.endText();
      // 把本轮思考原始数据(Anthropic thinking 块 / OpenAI reasoning_content)挂到承载本轮的
      // assistant 气泡,使其随快照落库、跨轮重建后原样回传(根治会话重载后思考链丢失/400)。
      // 必须在 endText 之后、本轮 addTool 之前调用(锚点见 attachAssistantMeta 注释)。
      // 第三参 hasTools:本轮是否要调工具。工具轮即便无思考也要合成 assistant 锚点,使每个
      // 工具轮在历史里各自独立,避免连续纯工具轮被 buildReplayMessages 贪婪合并、击穿缓存。
      const turnHasTools = Array.isArray(assistantMsg.tool_calls) && assistantMsg.tool_calls.length > 0;
      emitter.attachAssistantMeta(assistantMsg.thinking, assistantMsg.reasoning_content, turnHasTools);
      // 累计 token：provider 返回 usage 用真实值；否则用本地估算兜底（保证 UI/统计
      // 永远有数，不再因端点不回 usage 而显示 0）。estimated 标记用于 UI 区分。
      if (assistantMsg.usage) {
        const u = assistantMsg.usage;
        turnPromptTokens += Number(u.prompt_tokens || 0);
        turnCompletionTokens += Number(u.completion_tokens || 0);
        // 缓存 token：兼容 Anthropic 风格（cache_creation/read_input_tokens）与
        // OpenAI 风格（prompt_tokens_details.cached_tokens）。字段缺失则为 0。
        turnCacheCreate += Number(u.cache_creation_input_tokens || 0);
        turnCacheRead += Number(
          u.cache_read_input_tokens != null ? u.cache_read_input_tokens
          : (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0
        );
        // 上下文占用 = 本次往返的输入 token（prompt_tokens 已含 cache），取当前值
        // 而非累加——这才是真正塞进窗口的量，用于将满告警/自动压缩判定。
        lastContextTokens = Number(u.prompt_tokens || 0);
        // 本次往返读取的缓存（瞬时值，与 lastContextTokens 同口径），供「上一条消息」
        // 命中率用。取本次往返值而非 turnCacheRead 累加值，避免命中率超过 100%。
        lastTurnCacheRead = Number(
          u.cache_read_input_tokens != null ? u.cache_read_input_tokens
          : (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0
        );
        delete assistantMsg.usage;
        // 把精确 contextTokens 按真实请求字符占比分摊成 system/工具/历史，供 /context 精确展示。
        const breakdown = splitContextTokens(messages, effectiveTools, lastContextTokens);
        emitter.setUsage(turnPromptTokens, turnCompletionTokens, false, turnCacheCreate, turnCacheRead, lastContextTokens, breakdown, lastTurnCacheRead);
      } else {
        // 估算：输入≈本次发送的全部消息，输出≈本次助手回复。
        turnPromptTokens = estimateMessagesTokens(messages);
        const outText = typeof assistantMsg.content === "string" ? assistantMsg.content : "";
        turnCompletionTokens += estimateTokens(outText) +
          (assistantMsg.tool_calls ? estimateMessagesTokens([{ role: "assistant", content: null, tool_calls: assistantMsg.tool_calls }]) : 0);
        // 估算分支：当前发送的全部消息即为窗口占用近似。
        lastContextTokens = turnPromptTokens;
        // 估算分支无 provider 缓存数据，本次往返缓存读取按 0 计。
        lastTurnCacheRead = 0;
        emitter.setUsage(turnPromptTokens, turnCompletionTokens, true, turnCacheCreate, turnCacheRead, lastContextTokens, undefined, lastTurnCacheRead);
      }
      messages.push(assistantMsg);

      const toolCalls = assistantMsg.tool_calls || [];
      if (toolCalls.length === 0) break; // final answer reached
      if (signal?.aborted) break;

      // 无进展检测：把本轮所有工具调用拼成一个签名，与上一轮比较。完全相同（同名
      // 同参、同顺序）则累加重复计数；任何变化都清零。连续重复达阈值即判定死循环。
      const sig = toolCalls
        .map((tc) => tc.function.name + ":" + (tc.function.arguments || ""))
        .join("|");
      if (sig === lastToolSig) {
        repeatCount++;
        if (repeatCount >= NO_PROGRESS_LIMIT) { abortedForLoop = true; break; }
      } else {
        repeatCount = 0;
        lastToolSig = sig;
      }

      // --- task 工具批量分发(子 agent fan-out)---
      // 同一轮里的多个 task 调用按 mode 分流:全只读 → 并发(Promise.all 同时跑);
      // 任一可写 → 串行(写冲突结构性消除,一次一个,读最新→写完→下一个)。这里只
      // 「启动」分发并把每个 callId 映射到一个 Promise;真正 await 与结果回填仍在下面
      // 的 per-tc 循环里按原顺序进行,保证 assistant.tool_calls 与 tool 结果配对不乱。
      const taskPromises = new Map<string, Promise<string>>();
      if (toolCtx && toolCtx.subagents) {
        const taskCalls = toolCalls.filter((tc) => tc.type === "function" && tc.function.name === "task");
        if (taskCalls.length > 0) {
          const sub = toolCtx.subagents;
          const specOf = (tc: ToolCall) => {
            let a: any = {};
            try { a = JSON.parse(tc.function.arguments || "{}"); } catch {}
            return { subagentType: String(a.subagent_type || ""), prompt: String(a.prompt || ""), description: typeof a.description === "string" ? a.description : undefined, parentCallId: tc.id };
          };
          // 判定本批是否含可写 agent(据 defs 的 mode;未知名按 general 可写处理)。
          const isWrite = (name: string) => {
            const d = sub.defs.find((x) => x.name === name);
            return d ? d.mode === "write" : true;
          };
          const anyWrite = taskCalls.some((tc) => isWrite(specOf(tc).subagentType));
          if (anyWrite) {
            // 串行:用一条 promise 链把后一个的启动挂在前一个完成之后。
            let chain: Promise<void> = Promise.resolve();
            for (const tc of taskCalls) {
              const spec = specOf(tc);
              const p = chain.then(() => sub.runSubAgent(spec));
              taskPromises.set(tc.id, p);
              chain = p.then(() => undefined, () => undefined);
            }
          } else {
            // 并发:全部立即启动,各自独立(子 agent 全只读,无写冲突)。
            for (const tc of taskCalls) {
              taskPromises.set(tc.id, sub.runSubAgent(specOf(tc)));
            }
          }
        }
      }

      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;
        if (signal?.aborted) break;
        const toolName = tc.function.name;
        let toolArgs: any;
        try { toolArgs = JSON.parse(tc.function.arguments || "{}"); } catch { toolArgs = {}; }

        emitter.addTool(tc.id, toolName, toolArgs);

        // 轻量工具调用事件：供远程端（Telegram/Discord relay）显示「调了什么工具 + 相关文件」。
        // 渲染层桌面 UI 走 agent:turn 快照，不依赖此事件；此事件只为远程一行式提示。
        try {
          if (!window.isDestroyed()) {
            window.webContents.send("agent:tool-call", {
              sessionId: req.sessionId, runId: req.runId,
              name: toolName, target: toolCallTarget(toolName, toolArgs),
            });
          }
        } catch { /* window 可能已销毁 */ }

        // --- Interactive tool: ask the user one or more questions, no fs access ---
        if (toolName === "ask_followup_question") {
          // Normalize: accept either `questions[]` (preferred) or single `question`.
          let questions: FollowupQuestion[] = [];
          if (Array.isArray(toolArgs.questions) && toolArgs.questions.length > 0) {
            questions = toolArgs.questions
              .filter((q: any) => q && q.question)
              .map((q: any) => ({ question: String(q.question), options: Array.isArray(q.options) ? q.options : undefined }));
          } else if (toolArgs.question) {
            questions = [{ question: String(toolArgs.question), options: Array.isArray(toolArgs.options) ? toolArgs.options : undefined }];
          }

          let answers: string[] = [];
          if (requestFollowupH && questions.length > 0) {
            answers = await requestFollowupH({ callId: tc.id, questions });
          }

          let followupResult: string;
          if (questions.length === 0) {
            followupResult = "No question was provided.";
          } else {
            const lines = questions.map((q, i) => {
              const a = answers[i] && answers[i].trim();
              return "Q: " + q.question + "\nA: " + (a || "(not answered)");
            });
            const anyAnswered = answers.some((a) => a && a.trim());
            followupResult = anyAnswered
              ? lines.join("\n\n")
              : "User did not answer; proceed using your best judgment.";
          }
          emitter.setToolResult(tc.id, followupResult, true);
          messages.push({ role: "tool", tool_call_id: tc.id, content: followupResult });
          continue;
        }

        // --- Virtual tool: model autonomously enters plan mode, no fs access ---
        // 模型自主判断「任务复杂/高风险」→ 调用 enter_plan_mode 切入只读计划模式。
        // 立即改写本轮 currentMode(后续权限门据此拒绝写工具),并发事件让渲染层
        // 持久化 session 模式(下一轮请求自带 plan + UI 显示计划角标)。已在 plan
        // 模式则无操作。
        if (toolName === "enter_plan_mode") {
          let enterResult: string;
          if (currentMode === "plan") {
            enterResult = "Already in plan mode. Continue investigating read-only, then call exit_plan_mode with your plan.";
          } else {
            // 记录进入 plan 前的模式,供 exit_plan_mode 批准后当轮恢复。
            modeBeforePlan = currentMode || "default";
            currentMode = "plan";
            const reason = typeof toolArgs.reason === "string" ? toolArgs.reason : "";
            try {
              window.webContents.send("agent:enter-plan", { sessionId: req.sessionId, runId: req.runId, reason });
            } catch { /* window may be gone */ }
            // 只读约束直接写进 tool 结果(不能在 tool_calls 与其 tool 响应之间插
            // system 消息 —— 同批多个 tool_call 时会破坏配对,触发 API 400)。tool
            // 消息本身可长,模型据此当轮即遵守 PLAN MODE 规则。
            enterResult =
              "## PLAN MODE (read-only) — NOW ACTIVE\n" +
              "You just entered plan mode. ALL mutating tools (write_file, edit_file, multi_edit, apply_diff, run_command) are now blocked and will be denied. " +
              "Investigate with read-only tools only (read_file, search_files, glob_files, list_files, web_search, web_fetch), then hand off your plan by CALLING the exit_plan_mode tool with the full plan text (goal, files involved, concrete steps, how to verify) — do this the moment the plan is ready, in the same turn. " +
              "Do NOT write the plan as a plain text reply and stop: presenting the plan ONLY counts if you call exit_plan_mode. Do not attempt any write until the user approves.";
          }
          emitter.setToolResult(tc.id, enterResult, true);
          messages.push({ role: "tool", tool_call_id: tc.id, content: enterResult });
          continue;
        }

        // --- Interactive tool: present the plan for approval, no fs access ---
        // 复用 followup 通道:把计划作为一张特殊 followup 卡(带 plan 字段)推给
        // 渲染层。用户「批准并执行」→ 渲染层切出 plan 模式;「继续调整计划」→ 模型
        // 继续在只读模式下修订。批准与否都由渲染层决定,这里只回传文本结果。
        if (toolName === "exit_plan_mode") {
          const planText = typeof toolArgs.plan === "string" ? toolArgs.plan : "";
          let answers: string[] = [];
          if (requestFollowupH) {
            answers = await requestFollowupH({
              callId: tc.id,
              plan: planText,
              questions: [{ question: "已产出实施计划,是否批准并开始执行?", options: ["批准并执行", "继续调整计划"] }],
            });
          }
          const choice = (answers[0] || "").trim();
          const approved = choice === "批准并执行";
          // 关键:批准后当轮立即切出 plan 模式(恢复进入 plan 前的原始模式),使
          // 本轮后续的写工具立刻可执行——不必等下一轮请求带 default 模式才能动手。
          // 与 enter_plan_mode 当轮即改 currentMode 对称。渲染层也会持久化 session 模式。
          if (approved) currentMode = modeBeforePlan;
          const planResult = approved
            ? "User APPROVED the plan and the session has switched out of plan mode (mutating tools are now unlocked for THIS turn). Begin implementing the plan now, step by step, in this same turn — do not wait."
            : (choice
                ? "User did not approve; they want changes: " + choice + ". Revise the plan and call exit_plan_mode again. Stay read-only."
                : "User did not respond. Stay in plan mode; do not attempt any write operations.");
          emitter.setToolResult(tc.id, planResult, true);
          messages.push({ role: "tool", tool_call_id: tc.id, content: planResult });
          continue;
        }

        // --- Interactive tool: update the visible to-do roadmap, no fs access ---
        // Each call replaces the whole list; we normalize then push it to the
        // renderer (keyed by sessionId) for the live roadmap panel.
        if (toolName === "update_todos") {
          const VALID = ["pending", "in_progress", "completed"];
          const todos = (Array.isArray(toolArgs.todos) ? toolArgs.todos : [])
            .filter((t: any) => t && typeof t.content === "string" && t.content.trim())
            .map((t: any) => ({
              content: String(t.content),
              status: VALID.indexOf(t.status) !== -1 ? t.status : "pending",
              activeForm: typeof t.activeForm === "string" ? t.activeForm : undefined,
            }));
          try {
            window.webContents.send("agent:todos", { sessionId: req.sessionId, runId: req.runId, todos });
          } catch { /* window may be gone */ }
          const todoResult = "Updated todos (" + todos.length + " items).";
          emitter.setToolResult(tc.id, todoResult, true);
          messages.push({ role: "tool", tool_call_id: tc.id, content: todoResult });
          continue;
        }

        // --- checklist_read / checklist_submit: 持久项目任务清单(跨会话,用户+AI 共维护)。
        // 在 .claude/checklist.json,与对话内临时 update_todos 完全独立。读/写都即时落盘,
        // 并向渲染层推 agent:checklist 事件(submit 时让 UI 下拉自动弹开+高亮改动条)。
        if (toolName === "checklist_read") {
          let result: string;
          try {
            const items = await checklistManager.list(workingDir);
            if (items.length === 0) result = "The project checklist is empty.";
            else result = "Project checklist (" + items.length + " items):\n" + items.map((it) => {
              const mark = it.status === "done" ? "[done]" : it.status === "needs_verification" ? "[needs verification]" : "[todo]";
              return "- " + mark + " " + it.content;
            }).join("\n");
          } catch (e: any) { result = "Failed to read checklist: " + (e?.message || e); }
          emitter.setToolResult(tc.id, result, true);
          messages.push({ role: "tool", tool_call_id: tc.id, content: result });
          continue;
        }
        if (toolName === "checklist_submit") {
          const content = typeof toolArgs.content === "string" ? toolArgs.content.trim() : "";
          let result: string;
          if (!content) {
            result = "checklist_submit requires a non-empty 'content'.";
            emitter.setToolResult(tc.id, result, false);
          } else {
            try {
              const res = await checklistManager.submit(workingDir, content);
              result = res.action === "matched"
                ? "Matched an existing checklist item and moved it to 'needs verification' (awaiting the user's confirmation): " + res.item.content
                : "Added a new checklist item as 'needs verification' (awaiting the user's confirmation): " + res.item.content;
              try {
                window.webContents.send("checklist:changed", { projectPath: workingDir });
                window.webContents.send("agent:checklist", { sessionId: req.sessionId, action: res.action, item: res.item });
              } catch { /* window may be gone */ }
              emitter.setToolResult(tc.id, result, true);
            } catch (e: any) {
              result = "Failed to update checklist: " + (e?.message || e);
              emitter.setToolResult(tc.id, result, false);
            }
          }
          messages.push({ role: "tool", tool_call_id: tc.id, content: result });
          continue;
        }

        // --- task: 子 agent 派发(已在本轮批量分发阶段启动,这里 await 其结果)。---
        // 派发本身只读(过 Task 权限门);子 agent 内部真正的写工具各自再过门。
        if (toolName === "task") {
          let taskResult: string;
          const pending = taskPromises.get(tc.id);
          if (!pending) {
            taskResult = "Sub-agents are not available in this session (no task context).";
          } else {
            const decision = decideToolAction(permissions, "task", currentMode);
            let approved = decision === "allow";
            if (decision === "ask") {
              approved = await requestApprovalH({ callId: tc.id, tool: "task", permTool: "Task", input: toolArgs });
            }
            if (!approved) {
              taskResult = decision === "deny"
                ? "Permission denied: delegating to sub-agents is not allowed in the current mode."
                : "User declined the sub-agent delegation.";
            } else {
              try { taskResult = await pending; }
              catch (e: any) { taskResult = "Sub-agent failed: " + (e?.message || String(e)); }
            }
          }
          emitter.setToolResult(tc.id, taskResult, true);
          messages.push({ role: "tool", tool_call_id: tc.id, content: taskResult });
          continue;
        }

        // --- PreToolUse hook: 可拦截工具执行（协议无关，所有 provider 共享路径）---
        // 在权限门之前运行。任一命中命令 exit 2 / 返回 deny 控制 JSON → 阻止本次工具，
        // 把理由作为工具结果回灌给模型（模型据此调整），不进 executeTool。
        const permName = mapToolName(toolName);
        try {
          const pre = await hooksManager.runHooks(
            "PreToolUse",
            { hook_event_name: "PreToolUse", tool_name: permName, tool_input: toolArgs, session_id: req.sessionId, cwd: workingDir },
            workingDir
          );
          if (pre.block) {
            const blocked = "Blocked by PreToolUse hook: " + (pre.reason || "operation not allowed");
            emitter.setToolResult(tc.id, blocked, false);
            messages.push({ role: "tool", tool_call_id: tc.id, content: blocked });
            continue;
          }
          if (pre.additionalContext) {
            messages.push({ role: "system", content: pre.additionalContext });
          }
        } catch { /* hooks 不可用不影响主流程 */ }

        // --- Permission gate ---
        const decision = decideToolAction(permissions, toolName, currentMode);
        let approved = decision === "allow";
        if (decision === "ask") {
          approved = await requestApprovalH({
            callId: tc.id,
            tool: toolName,
            permTool: mapToolName(toolName),
            input: toolArgs,
          });
        }

        let toolResult: string;
        if (!approved) {
          toolResult = decision === "deny"
            ? `Permission denied: tool "${toolName}" is not allowed in the current mode.`
            : `User declined the "${toolName}" operation.`;
          // 权限熔断计数:仅「模式拒绝(deny)」累加;用户主动拒绝(ask→false)不算
          // (那是用户的选择,不是模型空转)。
          if (decision === "deny") denyStreak++; else denyStreak = 0;
        } else {
          denyStreak = 0; // 有工具真正放行 → 不是空转
          _imgBuf = []; // 清空 per-call 图片缓冲,只收本次工具调用产出的图
          try {
            toolResult = await executeTool(toolName, toolArgs, workingDir, toolCtx);
          } catch (e: any) {
            toolResult = "Error: " + (e?.message || String(e));
          }
          // Emit artifact preview AFTER the write/edit, reading the FULL file
          // back from disk — so edit_file previews the whole file, not just the
          // changed snippet (otherwise HTML/CSS can't render).
          if ((toolName === "write_file" || toolName === "edit_file" || toolName === "multi_edit" || toolName === "apply_diff") && toolArgs.file_path) {
            await emitArtifact(window, tc.id, toolName, toolArgs, workingDir);
            // 文件改动后建检查点（影子 git），让用户可一键回滚 agent 的改动。
            try {
              const cp = await checkpointManager.snapshot(workingDir, toolName + " " + toolArgs.file_path, req.sessionId);
              if (cp && !window.isDestroyed()) {
                window.webContents.send("agent:checkpoint", { sessionId: req.sessionId, runId: req.runId, checkpoint: cp });
              }
            } catch { /* 影子 git 不可用不影响主流程 */ }
          }
          // configure_hooks：agent 改了项目 hooks 配置，通知渲染层 Hooks 面板
          // 若正打开则自动重载（无需用户手动「重新加载」）。
          if (toolName === "configure_hooks" && !window.isDestroyed()) {
            try { window.webContents.send("hooks:changed", { cwd: workingDir }); } catch { /* window 可能已销毁 */ }
          }
        }

        // --- PostToolUse hook: 工具执行后副作用（格式化/lint/日志）。非阻塞。 ---
        // 仅对真正执行了的工具触发（被拒/被 PreToolUse 阻止的不算）。
        if (approved) {
          try {
            const post = await hooksManager.runHooks(
              "PostToolUse",
              { hook_event_name: "PostToolUse", tool_name: permName, tool_input: toolArgs, tool_output: toolResult, session_id: req.sessionId, cwd: workingDir },
              workingDir
            );
            if (post.additionalContext) {
              messages.push({ role: "system", content: post.additionalContext });
            }
          } catch { /* 非阻塞 */ }
        }

        emitter.setToolResult(tc.id, toolResult, approved);
        // 收集本次工具产出的图片回灌给视觉模型。capture_window/MCP 截图已经过
        // collectImages 推入 _imgBuf;generate_image 只落地路径,从输出解析路径补读。
        let callImages: AgentImage[] = _imgBuf.slice();
        if (callImages.length === 0 && (toolName === "generate_image" || toolName === "capture_window")) {
          for (const p of parseGeneratedPaths(toolResult)) {
            const im = await imagePathToAgentImage(p);
            if (im) callImages.push(im);
          }
        }
        // 跨轮持久化所需的「稳定本地路径」。优先复用工具输出里 GENERATED_IMAGE_PATHS 标记的
        // 磁盘原图路径(generate_image/capture_window/read 图都会打该标记);仅当确有回灌图片却
        // 无可解析路径时(纯 MCP 截图只回 base64、不落盘),才把原始字节落盘换取路径。
        // 这些路径经 agent:generated-images 事件写进 store 的 toolCall.images,跨轮重建时
        // buildApiMessage 据此读盘→downscale 重现图片块,使带图回合稳定命中 prompt 缓存。
        // 不落盘/不发事件 → toolCall.images 永远为空 → 图变成历史后被剥离、每轮击穿缓存。
        let imagePaths: string[] = parseGeneratedPaths(toolResult);
        if (imagePaths.length === 0 && callImages.length > 0) {
          // 无标记路径的回灌图(MCP 截图):落原始 base64 字节得路径(与上面路径来源同构——都指向
          // 磁盘原图,重建走相同的「读盘→downscale」确定性变换,字节一致)。只在图首次产生这一轮
          // 落一次:跨轮重建的 tool 消息来自 req.messages(已带路径),不再进此处,不会重复落盘换路径。
          for (const im of callImages) {
            try {
              const ext = (im.mime && im.mime.indexOf("/") >= 0) ? im.mime.split("/")[1] : "png";
              const p = saveImageBytes(Buffer.from(im.base64, "base64"), ext);
              imagePaths.push(p);
            } catch { /* 落盘失败:跳过该图的持久化(当轮仍正常发送,只是跨轮可能丢) */ }
          }
        }
        const toolMsg: ChatMessage = { role: "tool", tool_call_id: tc.id, content: toolResult };
        // vision 关闭时丢弃图片(模型看不到,只留文字占位避免误导)。开启时缩放后附带。
        // downscaleImageIfNeeded 对「无法缩放且仍超体积阈值」的图返回 null,filter 掉,
        // 绝不把超大 base64 塞进请求体(防撑爆上下文/被 API 拒)。
        if (visionOn && callImages.length > 0) {
          const scaled = callImages.map((im) => downscaleImageIfNeeded(im)).filter((im): im is AgentImage => im != null);
          if (scaled.length > 0) toolMsg.images = scaled;
        }
        messages.push(toolMsg);
        // 把本轮工具产图的本地路径送进渲染层 store 的 toolCall.images(经 setToolImages),
        // 使图片随会话持久化、跨轮重建后可回放——这是「图变历史后不被剥离」的关键通道。
        // 仅 vision 开启(关闭时图被丢弃,无需持久化)且确有路径时发。preload 已转发该事件、
        // renderer onAgentGeneratedImages 已监听,无需改两侧。applyTurn 的 prevImages 机制
        // 会在后续全量快照里按 toolCall.id 保留这些 images,不被覆盖。
        if (visionOn && imagePaths.length > 0 && !window.isDestroyed()) {
          try {
            window.webContents.send("agent:generated-images", {
              sessionId: req.sessionId, runId: req.runId, id: tc.id, paths: imagePaths,
            });
          } catch { /* window 可能已销毁 */ }
        }
        // 注：此前这里调用 enforceImageCap() 删除最早的历史截图以限制图片数，但删图会
        // 改写「已进入缓存前缀」的历史消息（其 API 表示从含 base64 变为不含），击穿
        // prompt 缓存、按全价重算整段历史（实测一次击穿 ~8 万 token）。与 buildReplayMessages
        // 阶段 B 的设计一致：不做会变动的历史淘汰，图片总量随 /compact 压缩时连同旧消息
        // 一起出局。代价是图密集回合上下文偏大，但图片每轮字节级一致、稳定命中缓存。

        // 权限熔断:连续被模式拒绝达阈值 → 模型在只读/受限模式下空转,主动停下,
        // 由下方统一终止说明提示用户切换模式(而非闷头烧到撞网络错误或迭代上限)。
        if (denyStreak >= DENY_STREAK_LIMIT) { abortedForDeny = true; break; }
      }
      if (abortedForDeny) break;
    }
    // 终止说明：循环跳出可能因为①达到安全上限 ②检测到死循环 ③权限连续拒绝熔断。
    // 都明确告知用户，避免静默停止被误当作「正常结束」。正常完成不会进这里。
    if (!signal?.aborted) {
      if (abortedForDeny && !window.isDestroyed()) {
        const modeHint = currentMode === "plan"
          ? "当前处于「计划（只读）」模式，写文件 / 改文件 / 跑命令都会被拒绝。请在计划卡里点「批准并执行」，或退出计划模式后重试。"
          : "当前模式或权限设置禁止了所需的写操作。请在权限设置里启用对应工具，或切换权限模式后重试。";
        window.webContents.send("agent:error", {
          message: "Agent 连续多次因权限被拒、无法继续，已自动停止以免空转。" + modeHint,
          sessionId: req.sessionId,
        });
      } else if (abortedForLoop && !window.isDestroyed()) {
        window.webContents.send("agent:error", {
          message: "检测到 Agent 在重复同一个工具调用且无进展，已自动停止以避免死循环。可补充信息后重试。",
          sessionId: req.sessionId,
        });
      } else if (iteration >= maxIterations && !window.isDestroyed()) {
        window.webContents.send("agent:error", {
          message: "本轮已达到最大工具迭代次数(" + maxIterations + ")并停止。任务可能过大，建议拆分或让 Agent 继续。",
          sessionId: req.sessionId,
        });
      }
    }
    // --- Stop hook: 本轮 agent 结束后触发（纯副作用，非阻塞）。---
    try {
      await hooksManager.runHooks("Stop", { hook_event_name: "Stop", session_id: req.sessionId, cwd: workingDir }, workingDir);
    } catch { /* 非阻塞 */ }
  } finally {
    emitter.done();
  }

  return fullResponse;
}

/**
 * 子 agent(subagent)定义:由 ipc-handlers 从 AgentsManager 解析后传入。
 */
export interface SubAgentDef {
  name: string;
  mode: "read-only" | "write";
  tools?: string[];   // 工具白名单(省略=继承父级全部内置工具)
  model?: string;     // 期望模型(运行期在父供应商 models[] 内校验)
  prompt: string;     // 子 agent 系统提示(.md 正文)
  builtin?: boolean;
}

/** 启动一个子 agent 一轮所需的全部上下文。父 agent 的供应商/权限/批准桥全部透传。 */
export interface SubAgentRunContext {
  provider: any;            // 父供应商(子 agent 永远用它,同 key/baseUrl/protocol)
  resolveModel: (model?: string) => string; // 把期望模型校验到父供应商 models[] 内
  workingDir: string;
  sessionId: string;
  parentRunId: string;
  permissions: PermissionsManager;
  requestApproval: ApprovalFn;
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan";
  signal?: AbortSignal;
  toolCtx?: ToolContext;    // 父级工具上下文(search/imageGen/mcp);会被剥掉 subagents 防递归
  vision?: boolean;
}

let _subAgentSeq = 0;

/**
 * 运行一个子 agent 一轮:独立 messages、独立系统提示(.md 正文)、子集工具(永不含
 * task —— 限一层防递归爆炸)、独立 token 账。复用 streamCompletion + 权限门 +
 * checkpoint + Pre/PostToolUse hooks(与主 agent 同一套设施),但不发 agent:turn
 * (不污染主对话),改发 agent:subagent 生命周期事件供渲染层在 task 气泡内内联展示。
 * 结束触发 SubagentStop hook。返回子 agent 的最终报告(末条文本 + 写入文件清单),
 * 作为父 agent 的 task 工具结果。
 */
export async function runSubAgentLoop(
  def: SubAgentDef,
  taskPrompt: string,
  taskDescription: string | undefined,
  parentCallId: string,
  ctx: SubAgentRunContext,
  window: BrowserWindow
): Promise<string> {
  const subId = ctx.parentRunId + "-sub-" + (++_subAgentSeq);
  const model = ctx.resolveModel(def.model);
  const { sessionId, workingDir, permissions, requestApproval, signal } = ctx;
  // plan 模式向子 agent 透传为只读语义;read-only agent 自身也强制只读。
  const subMode: "default" | "acceptEdits" | "bypassPermissions" | "plan" =
    def.mode === "read-only" ? "plan" : (ctx.permissionMode || "default");

  // agent:subagent 生命周期事件(spawned/streaming-text/tool-call/tool-result/done)。
  const emit = (phase: string, extra?: any) => {
    if (window.isDestroyed()) return;
    try {
      window.webContents.send("agent:subagent", {
        sessionId, runId: ctx.parentRunId, parentCallId, subId,
        agentName: def.name, model, mode: def.mode, builtin: !!def.builtin,
        description: taskDescription || "",
        phase, ...(extra || {}),
      });
    } catch { /* window 可能已销毁 */ }
  };

  // 子 agent 的工具集:从父级内置工具 + MCP 工具里取,剔除 task(防递归)与一切
  // 交互/会话级工具(子 agent 不与用户交互、不动主对话路线图/计划)。再按 .md 的
  // tools 白名单(若有)过滤;read-only agent 额外剔掉写工具(双保险,权限门也会拦)。
  const EXCLUDE = new Set(["task", "ask_followup_question", "enter_plan_mode", "exit_plan_mode", "update_todos", "checklist_read", "checklist_submit"]);
  const WRITE = new Set(["write_file", "edit_file", "multi_edit", "apply_diff", "run_command", "monitor", "generate_image", "configure_hooks"]);
  const mcpTools = (ctx.toolCtx && Array.isArray(ctx.toolCtx.mcpTools)) ? ctx.toolCtx.mcpTools : [];
  const allTools = TOOL_DEFINITIONS.concat(mcpTools);
  const whitelist = def.tools && def.tools.length ? new Set(def.tools) : null;
  const subTools = allTools.filter((t) => {
    const n = t.function.name;
    if (EXCLUDE.has(n)) return false;
    if (def.mode === "read-only" && WRITE.has(n)) return false;
    if (whitelist && !whitelist.has(n)) return false;
    return true;
  });

  // 子 agent 工具上下文:复用父级 search/imageGen/mcp,但剥掉 subagents(限一层)。
  // 图片回灌通道独立(子 agent 不把图回灌主对话,只在自身循环内用)。
  let _imgBuf: AgentImage[] = [];
  const subToolCtx: ToolContext = Object.assign({}, ctx.toolCtx, {
    subagents: undefined,
    signal,
    collectImages: (imgs: AgentImage[]) => { if (Array.isArray(imgs)) for (const im of imgs) if (im && im.base64) _imgBuf.push(im); },
  });

  // 独立系统提示:.md 正文 + 工作目录/日期。子 agent 不带主 agent 的大段系统提示
  // (它有自己的专职 persona),但补一句工作目录与只读约束。
  const sysLines = [
    def.prompt || "You are a helpful sub-agent.",
    "",
    def.mode === "read-only"
      ? "You are running in READ-ONLY mode: all file-mutating tools and commands are blocked. Investigate and report; do not attempt to change anything."
      : "Carry out the task end to end. Make changes that fit the existing code, and verify your work.",
    "",
    "Current working directory: " + workingDir,
    "Current date & time: " + currentDateString(),
    "",
    // 收尾约定:子 agent 的最后一条消息(没有工具调用的那条)就是回传父 agent 的报告。
    // 要求它用固定结构化片段收尾,父 agent 才能机械地比对/归并,而不是读一段散文。
    "## How to report back (your FINAL message, the one with no tool calls)",
    "End with a single structured report in EXACTLY this format. Keep it tight; no preamble before it:",
    "",
    "### Conclusion",
    "1-3 sentences: the direct answer / outcome of the task you were given.",
    "",
    "### Files",
    def.mode === "read-only"
    ? "The key files/locations you relied on, each as `path:line` when you can, one per line. Write `- none` if not applicable."
    : "Every file you created or modified, one `path` per line, with a few words on the change. Write `- none` if you changed nothing.",
    "",
    "### Evidence",
    "The concrete facts that back your conclusion: exact symbols, signatures, snippets, command output, or `path:line` references. Quote, don't paraphrase, when precision matters. One bullet each.",
    "",
    "### Confidence",
    "One of `high` / `medium` / `low`, then a short clause on what would raise it or what you could not verify.",
    ];
  const messages: ChatMessage[] = [
    { role: "system", content: sysLines.join("\n") },
    { role: "user", content: taskPrompt || "(no task prompt provided)" },
  ];

  emit("spawned");

  const writtenFiles: string[] = [];
  let finalText = "";
  const maxIterations = 60; // 子 agent 比主循环更受限(防失控)
  let iteration = 0;
  const visionOn = ctx.vision !== false;
  // 权限拒绝熔断(与主循环同款):只读子 agent 反复尝试写会被连续 deny,达阈值即停。
  const DENY_STREAK_LIMIT = 5;
  let denyStreak = 0;

  try {
    while (iteration < maxIterations) {
      if (signal?.aborted) break;
      iteration++;
      let iterText = "";
      const assistantMsg = await streamCompletionWithRetry(
        ctx.provider, model, messages, subTools, window, signal, undefined,
        (delta) => { iterText += delta; emit("streaming-text", { delta }); },
        sessionId
      );
      if (assistantMsg.usage) delete assistantMsg.usage;
      if (typeof assistantMsg.content === "string" && assistantMsg.content) finalText = assistantMsg.content;
      messages.push(assistantMsg);

      const toolCalls = assistantMsg.tool_calls || [];
      if (toolCalls.length === 0) break; // 子 agent 给出最终报告
      if (signal?.aborted) break;

      for (const tc of toolCalls) {
        if (tc.type !== "function") continue;
        if (signal?.aborted) break;
        const toolName = tc.function.name;
        let toolArgs: any;
        try { toolArgs = JSON.parse(tc.function.arguments || "{}"); } catch { toolArgs = {}; }
        emit("tool-call", { callId: tc.id, name: toolName, input: toolArgs });

        const permName = mapToolName(toolName);
        // PreToolUse hook(与主 agent 同路径)。
        try {
          const pre = await hooksManager.runHooks(
            "PreToolUse",
            { hook_event_name: "PreToolUse", tool_name: permName, tool_input: toolArgs, session_id: sessionId, cwd: workingDir },
            workingDir
          );
          if (pre.block) {
            const blocked = "Blocked by PreToolUse hook: " + (pre.reason || "operation not allowed");
            emit("tool-result", { callId: tc.id, name: toolName, output: blocked, approved: false });
            messages.push({ role: "tool", tool_call_id: tc.id, content: blocked });
            continue;
          }
          if (pre.additionalContext) messages.push({ role: "system", content: pre.additionalContext });
        } catch { /* 非阻塞 */ }

        // 权限门:子 agent 的每个工具调用照走 decideToolAction + 批准桥(铁律①)。
        const decision = decideToolAction(permissions, toolName, subMode);
        let approved = decision === "allow";
        if (decision === "ask") {
          try {
            void hooksManager
              .runHooks("Notification", { hook_event_name: "Notification", message: 'Sub-agent permission required: tool "' + toolName + '" is waiting for your approval.', session_id: sessionId, cwd: workingDir }, workingDir)
              .catch(() => {});
          } catch { /* 非阻塞 */ }
          approved = await requestApproval({ callId: tc.id, tool: toolName, permTool: permName, input: toolArgs });
        }

        let toolResult: string;
        if (!approved) {
          toolResult = decision === "deny"
            ? `Permission denied: tool "${toolName}" is not allowed in the current mode.`
            : `User declined the "${toolName}" operation.`;
          if (decision === "deny") denyStreak++; else denyStreak = 0;
        } else {
          denyStreak = 0;
          _imgBuf = [];
          try { toolResult = await executeTool(toolName, toolArgs, workingDir, subToolCtx); }
          catch (e: any) { toolResult = "Error: " + (e?.message || String(e)); }
          // 写工具:建检查点(影子 git,与主 agent 同款,用户可回滚子 agent 改动)+
          // 发 artifact 预览 + 记录到写入清单(回报父 agent)。
          if ((toolName === "write_file" || toolName === "edit_file" || toolName === "multi_edit" || toolName === "apply_diff") && toolArgs.file_path) {
            writtenFiles.push(String(toolArgs.file_path));
            await emitArtifact(window, tc.id, toolName, toolArgs, workingDir);
            try {
              const cp = await checkpointManager.snapshot(workingDir, "[" + def.name + "] " + toolName + " " + toolArgs.file_path, sessionId);
              if (cp && !window.isDestroyed()) window.webContents.send("agent:checkpoint", { sessionId, runId: ctx.parentRunId, checkpoint: cp });
            } catch { /* 影子 git 不可用不影响主流程 */ }
          }
        }

        // PostToolUse hook(仅真正执行了的)。
        if (approved) {
          try {
            const post = await hooksManager.runHooks(
              "PostToolUse",
              { hook_event_name: "PostToolUse", tool_name: permName, tool_input: toolArgs, tool_output: toolResult, session_id: sessionId, cwd: workingDir },
              workingDir
            );
            if (post.additionalContext) messages.push({ role: "system", content: post.additionalContext });
          } catch { /* 非阻塞 */ }
        }

        emit("tool-result", { callId: tc.id, name: toolName, output: toolResult, approved });
        const toolMsg: ChatMessage = { role: "tool", tool_call_id: tc.id, content: toolResult };
        if (visionOn && _imgBuf.length > 0) {
          const scaled = _imgBuf.map((im) => downscaleImageIfNeeded(im)).filter((im): im is AgentImage => im != null);
          if (scaled.length > 0) toolMsg.images = scaled.slice(0, 3);
        }
        messages.push(toolMsg);

        // 权限熔断:连续被拒达阈值(如只读子 agent 反复尝试写)→ 停下,把原因并入
        // 报告回传父 agent,而非空转到迭代上限。
        if (denyStreak >= DENY_STREAK_LIMIT) {
          finalText = (finalText ? finalText + "\n\n" : "") +
            "[stopped] 子 agent「" + def.name + "」连续多次被权限拒绝" +
            (def.mode === "read-only" ? "（只读模式无法写文件/跑命令）" : "") +
            "，已停止。该子任务需要的写操作超出其权限。";
          break;
        }
      }
      if (denyStreak >= DENY_STREAK_LIMIT) break;
    }
  } catch (e: any) {
    finalText = (finalText ? finalText + "\n\n" : "") + "[sub-agent error] " + (e?.message || String(e));
  } finally {
    // SubagentStop hook:子 agent 结束(纯副作用,非阻塞)。
    try {
      await hooksManager.runHooks("SubagentStop", { hook_event_name: "SubagentStop", session_id: sessionId, cwd: workingDir }, workingDir);
    } catch { /* 非阻塞 */ }
  }

  const report = finalText.trim() || "(sub-agent produced no textual summary)";
  const filesNote = writtenFiles.length
    ? "\n\nFiles modified by this sub-agent:\n" + writtenFiles.map((f) => "- " + f).join("\n")
    : "";
  emit("done", { report, files: writtenFiles });
  return "[sub-agent: " + def.name + "]\n" + report + filesNote;
}

async function emitArtifact(window: BrowserWindow, id: string, toolName: string, toolArgs: any, workingDir: string): Promise<void> {
  const ext = (toolArgs.file_path || "").split(".").pop()?.toLowerCase() || "";
  const langMap: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", py: "python",
    html: "html", css: "css", json: "json", md: "markdown", svg: "xml",
  };
  // Read the FULL file from disk so the preview always has complete content
  // (edit_file only carries a snippet in its args). Fall back to args on error.
  let content = "";
  try {
    const { readFile } = require("fs/promises");
    const { resolve } = require("path");
    content = await readFile(resolve(workingDir, toolArgs.file_path), "utf-8");
  } catch {
    content = toolArgs.content || toolArgs.new_string || "";
  }
  if (window.isDestroyed()) return;
  window.webContents.send("agent:artifact", {
    id,
    fileName: String(toolArgs.file_path).replace(/[\\/]/g, "/").split("/").pop(),
    filePath: toolArgs.file_path,
    content,
    language: langMap[ext] || "text",
    action: toolName === "write_file" ? "created" : "modified",
    timestamp: Date.now(),
  });
}

// 文字游戏模式(/game)的系统提示。把模型变成一个 AI RPG 主持人(GM/旁白),
// 强约束每回合的输出结构,使其能与渲染层的 <details> 折叠块、ask_followup_question
// 选项卡配合,形成沉浸式文字角色扮演体验(对标 AI 风月 / 魅魔岛等)。
function buildGamePrompt(cwd: string): string {
  return [
    "你是一位顶尖的文字 RPG 游戏主持人(GM)兼旁白，如果需要也可以扮演主角之一,正在主持一场沉浸式互动文字冒险。最重要的是，你需要在游戏开始前就设计好核心卖点、核心玩法循环、严格的数值、高可玩性、玩法曲线等专业且完整的设计，而并非只是简单的文字堆砌游戏。玩家通过选择行动推进剧情,你负责描绘世界、扮演所有 NPC、裁定结果、维护数值。",
    "全程使用生动的中文叙事(第二人称『你』称呼玩家)。这是虚构的角色扮演创作,请投入地演绎。",
    "",
    "## 开局(仅当对话刚开始 / 玩家还没有角色时)",
    "若这是第一回合且玩家尚未设定世界与角色:先用简短欢迎语,然后【调用 ask_followup_question】让玩家做开局选择,不要替玩家擅自决定。把以下问题放在一次调用的 questions 数组里:",
    "1. 题材世界(给 4 个预设选项 + 允许自定义。",
    "2. 角色设定:性别 / 大致身份或职业(给预设选项)。",
    "3. 难度或基调:如『轻松休闲』『标准冒险』『硬核生存』。",
    "4. 配图开关:『是否要为这局生成插图?』给『要插图』『纯文字(不生图)』两个选项。",
    "5. 配图节奏(仅当上一题选了要插图):『多久生成一张插图?』给四个选项 ——『每回合都生成』『每三回合生成一次』『仅重要时刻自动生成(战斗、登场、转折、新场景等)』+ 允许自定义。",
    "6. 玩家形象(仅当要插图):『主角立绘由谁定?』给两个选项 ——『由你(GM)生成并固定』+ 允许自定义。",
    "拿到选择后,正式开局:用一段正文把玩家带入开场场景,并按下面的【固定输出结构】给出完整面板与第一组行动选项。开局这一刻就要把【配图设定面板】填好(见下),并据此决定开场是否出图。",
    "",
    "## 每回合的固定输出结构(非常重要,务必严格遵守)",
    "每一回合都按以下顺序输出。正文之外的所有面板,一律用 HTML 的 <details> 折叠块包裹(默认收起,玩家点开才看),折叠块标题放在 <summary> 里。正文不要折叠。",
    "",
    "### 1) 正文(不折叠)",
    "直接写当前场景的叙事:环境、事件、NPC 的言行、玩家行动的结果。2~5 段,大于400字，有画面感和代入感。对话用引号。可以在关键处制造悬念或抉择压力。剧情必须有所推进不能重复或者类似上一轮的内容。",
    "",
    "### 2) 折叠面板(每个都用 <details>,默认收起)",
    "依次输出以下折叠块(没有内容变化的也要给出当前快照,保持面板完整):",
    "",
    "<details><summary>👤 角色卡（包含主要角色）</summary>",
    "姓名 / 称号、性别、身份或职业、年龄、外貌简述、性格标签。用简短条目列出。",
    "</details>",
    "",
    "<details><summary>🎨 配图设定</summary>",
    "【每回合都要复述这一面板,确保设定不丢失。】记录本局开局确定的配图设定:",
    "- 配图节奏:每回合 / 每三回合 / 仅重要时刻 / 玩家自定义(写明玩家原话)。预计在第x（根据玩家选择和当前轮次更改）轮后生成图片。",
    "- 立绘归属:GM 生成 / 玩家自述。",
    "- **主角外貌提示词(锁定)**:一段固定的英文外貌描述(发型发色、瞳色、面部、体型、典型服饰、气质等具体特征)。每次生图都必须原样带上这段,保证主角在所有插图里长相一致。若玩家选『纯文字』则此面板写『本局不配图』即可。",
    "</details>",
    "",
    "<details><summary>📜 背景故事</summary>",
    "角色的来历、当前处境、核心动机或目标。开局时写好,之后基本固定,有重大剧情揭示时再更新。",
    "</details>",
    "",
    "<details><summary>❤️ 状态</summary>",
    "用条目或表格展示当前数值,例如:生命 HP 80/100、法力/精力 MP、体力、心情、金钱。",
    "若有 NPC 好感度 / 关系值,也列在这里(如 『艾拉 好感 35/100』)。",
    "再补一行【异常/增益状态】(如中毒、疲惫、祝福),没有则写『无』。",
    "</details>",
    "",
    "<details><summary>🎒 物品 / 技能</summary>",
    "背包关键物品(名称 + 数量 + 一句话作用)与已掌握的技能/能力。空则写『暂无』。",
    "</details>",
    "",
    "<details><summary>📍 所在地点</summary>",
    "地名 + 环境氛围描写(2~3 句)+ 当前在场的人物 + 可前往的方向/出口。",
    "</details>",
    "",
    "<details><summary>🗺️ 剧情进度</summary>",
    "当前主线目标、已知线索、未解之谜。帮助玩家记住自己在追什么。",
    "</details>",
    "",
    "### 3) 行动选项(每回合结尾必做)",
    "正文与面板输出完毕后,【必须调用 ask_followup_question 工具】给玩家提供本回合的行动选择,以此驱动下一回合。要求:",
    "- 用 questions 数组里的一个问题(如『你接下来要做什么?』),配 3~5 个 options 预设行动。",
    "- 选项要具体、有差异、贴合当前情境(例:『推开那扇门』『质问神秘女子』『悄悄退回走廊』),让不同选择导向不同发展。",
    "- 玩家也可以自己输入自定义行动(工具本身支持),你要能灵活接住玩家的任何输入。",
    "- 选项一律通过 ask_followup_question 给出。",
    "",
    "### 4) 本回合配图(按开局设定的节奏判定;仅当本局开启了插图)",
    "若本局为『纯文字』,跳过本节,永远不生图。否则在每回合正文与面板输出完毕后,按【配图设定面板】里的节奏决定本回合是否出图:",
    "- 每回合:每回合都生成一张。",
    "- 每三回合:第 1、4、7… 回合(及任何你判定的重要时刻)生成。计算上一次生图的轮次，判断是否符合生图条件。",
    "- 仅重要时刻:仅在战斗、关键 NPC 登场、场景切换、剧情转折、获得重要物品等时刻生成;平淡过场不生成。",
    "- 玩家自定义:按玩家在开局说明的规则来。",
    "判定为『要出图』时,调用 generate_image 工具(它会出图并内联显示在对话里)。要求:",
    "- 用【单个英文 prompt】描述本回合的画面,内容必须综合:① 当前场景/环境(地点、光线、氛围),② 在场的主角——【必须原样拼入〖配图设定面板〗里锁定的主角外貌提示词】,这样主角每张图长相一致,③ 当前正在发生的关键事件/动作/在场 NPC,④ 适当的画风词(如 anime style / cinematic / fantasy illustration)。",
    "- 主角不在场的画面(纯风景、某 NPC 特写)可不带主角外貌词,但只要主角出镜就必须带。",
    "- 依画面选择合适尺寸。",
    "- 生图较慢:每回合最多生成 1 张,先出图,再调用 ask_followup_question 给行动选项收尾。",
    "- 若工具返回『未配置图片端点』之类的提示,说明玩家环境没配好图片供应商:本回合直接跳过配图,继续用文字推进,不要反复重试,可温和提示玩家去设置里配置图片供应商。",
    "",
    "## 视觉表现(善用富文本,让画面更生动,但服务于沉浸感、不要堆砌)",
    "渲染层支持完整的 GitHub 风格 Markdown,请在合适的地方用以下效果丰富呈现:",
    "- **Emoji**:在标题、面板、关键名词、情绪节点点缀(⚔️战斗、💰金钱、❤️生命、🗝️钥匙、🌙夜晚、😱惊恐…),让面板和叙事一眼可读,但别每句都塞。",
    "- **强调**:用 **粗体** 标关键人物/物品/地名/数值,*斜体* 表心理活动或环境细节,`行内代码` 标特殊术语、技能名、骰点结果。",
    "- **GitHub Callout 提示框**:用 > [!NOTE](说明/旁白)、> [!TIP](提示/攻略)、> [!IMPORTANT](关键剧情/任务)、> [!WARNING](警告/危险临近)、> [!CAUTION](致命风险/最后警告)。适合做系统提示、战斗警报、任务提醒、抉择后果预警。例:",
    "  > [!WARNING]",
    "  > 你听见身后传来沉重的脚步声,危险正在逼近。",
    "- **表格**:状态数值、物品清单、技能列表、多个 NPC 好感度等结构化信息,用 Markdown 表格呈现更清晰(可放进对应折叠面板里)。",
    "- **Mermaid 图表**:需要时用 ```mermaid 代码块画图——如关系图(graph)、地图/路线、任务流程、剧情分支树、时间线。例:用 graph LR 画当前可去的几个地点及其连接。不必每回合都画,在探索新区域、展示人物关系或复杂抉择时使用。",
    "- **分隔线 ---、引用、列表**:合理分段,让长内容层次分明。",
    "原则:视觉效果是为沉浸感和可读性服务的调味料,用在刀刃上;正文叙事本身的文学质感才是主体,不要被格式淹没。",
    "",
    "## 主持规则",
    "- 维护连续性:记住已发生的剧情、玩家的选择、NPC 关系与数值变化,前后一致,不要自相矛盾。",
    "- 主角外貌锁定:一旦在开局确定了主角外貌(无论 GM 生成还是玩家自述),整局保持不变除非玩家要求或剧情导致。",
    "- 数值要随剧情合理变动(受伤扣 HP、休息回体力、消费减金钱、互动改好感),并在状态面板反映。",
    "- 你扮演世界与所有 NPC,但【绝不替玩家做决定】——玩家角色的行动只能由玩家通过选项或输入决定，根据玩家的决定需要明确推进剧情不能反复导致剧情反复。",
    "- 节奏明快,每回合推进剧情,适时抛出冲突、奖励、转折,保持张力与新鲜感。",
    "- 失败、危险、死亡都可以发生(依难度),让选择有重量;但给玩家翻盘或应对的余地。",
    "- 这是工具调用驱动的循环:输出正文+面板 →(按节奏可选生成插图)→ 调 ask_followup_question → 等玩家选择 → 据此续写下一回合。不要在没有玩家输入时擅自连续推进多回合。",
    "- 除了 generate_image(配图)与 ask_followup_question(行动选项)外,这是纯创作,不需要读取或修改本地项目文件;除非玩家明确要求,否则不要使用文件/命令类工具。",
    "",
    "当前工作目录: " + cwd,
    "当前日期: " + currentDateString(),
  ].join("\n");
}

export function buildSystemPrompt(cwd: string, mode?: "default" | "acceptEdits" | "bypassPermissions" | "plan", chatMode?: boolean, gameMode?: boolean, vision?: boolean): string {
  // 文字游戏模式(/game):AI RPG。详见 buildGamePrompt——按固定结构输出(正文 + 折叠块
  // + 末尾 ask_followup_question)。优先级高于 chat / 普通模式。
  if (gameMode) {
    return buildGamePrompt(cwd);
  }
  // 纯聊天模式(/chat):面向「单纯对话」,不主动调查项目。给一份精简提示——仍可在
  // 用户明确要求时用工具(读文件/搜索/跑命令),但默认直接回答,不主动伸手读代码库。
  if (chatMode) {
    return [
      "You are a helpful, knowledgeable assistant chatting with the user.",
      "",
      "## How to work",
      "- This is a plain conversation. Answer directly from your knowledge; be clear, accurate, and concise.",
      "- Do NOT proactively investigate the project, read files, or run commands. The user just wants to talk.",
      "- You still HAVE tools (read files, search, run commands) and MAY use them — but ONLY when the user explicitly asks you to look at something or do something that requires them. Otherwise, just reply.",
      "- If a request would clearly benefit from acting on the project, you can suggest switching out of chat mode, but don't force it.",
      "- For anything time-sensitive (news, latest versions, 'today', current events), do not rely on training knowledge — use web_search.",
      "",
      "## Style",
      "- Respond in Chinese when the user speaks Chinese (code, file names, paths, and commands stay as-is).",
      "- The chat UI renders full GitHub-flavored Markdown: use ```mermaid fenced blocks to draw diagrams (flows, relationships, sequences, timelines) when a picture explains better than text, callout boxes (`> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`) to highlight what matters, plus tables and code blocks. Use them when they aid clarity; skip them for short, direct answers.",
      "",
      "Current working directory: " + cwd,
      "Current date & time: " + currentDateString(),
    ].join("\n");
  }
  const lines: string[] = [
    "You are UE Coworker, an AI coding assistant operating inside the user's project with tools to read, write, and edit files, run commands, and search the codebase.",
    "",
    "## How to work",
    "- At the START of a task, take stock of what's already available before improvising: check whether a SKILL applies (the skills roster is injected below — invoke a matching one instead of reinventing its logic), and scan the project's existing files, configs, and conventions. Reuse mature, established code/patterns/libraries already present or widely-used over inventing your own from imagination — search first, build second.",
    "- Understand the request first. For anything non-trivial, investigate before you act: read the relevant files and search the codebase so your changes fit the existing patterns, naming, and style.",
    "- ALWAYS read a file before editing it. Make changes that read like the surrounding code — match its conventions, don't impose new ones.",
    "- When you have enough information to act, act. Don't re-derive facts already established, don't restate what the user already knows, and don't narrate options you won't pursue — give a recommendation and proceed.",
    "- For multi-step or non-trivial tasks, call update_todos to keep a visible roadmap: declare all steps first, mark exactly one 'in_progress' before starting it, mark it 'completed' as soon as it's done, and send the full list each call. Skip it for trivial single-step requests.",
    "- This project has a PERSISTENT checklist (separate from update_todos, which is only this turn's roadmap): a long-lived list of tasks shared with the user across sessions. At the START of work, call checklist_read to see outstanding tasks. Whenever you FINISH a discrete task — especially any change that needs the user to verify it at runtime — you MUST call checklist_submit with its description; do not consider the work wrapped up until you have logged it. checklist_submit matches an existing item (moving it to 'needs verification') or adds a new one. A common failure is making edits and ending the turn without submitting — don't do that; every concrete change you make should leave a checklist entry behind. You can NEVER mark an item 'done'; only the user verifies and completes items in the UI.",
    "- When the request is genuinely ambiguous or a decision is the user's to make, call ask_followup_question instead of guessing. Don't ask about things you can determine yourself from the code.",
    "- Before acting on a COMPLEX or HIGH-RISK task, call enter_plan_mode first: significant new functionality, changes spanning multiple files, several viable approaches, an architectural decision, or destructive/hard-to-reverse operations. It switches you to read-only so you investigate and write a plan the user approves before any writes. Skip it for small, well-scoped, or read-only work — just do those directly.",
    "- To set up project automation (run a formatter after edits, block edits to sensitive files, log commands, inject context at session start), use the configure_hooks tool — don't hand-edit .claude/settings.json. It validates input and preserves other settings.",
    "",
    "## Grounding — do not hallucinate",
    "- Base every answer and every edit on what you actually read with tools. If you haven't read it, don't assert it.",
    "- NEVER invent function names, file paths, APIs, imports, config keys, or fields that you have not verified exist. If unsure whether something exists, search or read to confirm before relying on it.",
    "- If something the user described contradicts what you find in the code, surface that instead of proceeding on the wrong assumption.",
    "- When your prior knowledge or assumptions conflict with what the user states OR with what the tools/code actually show, do NOT silently pick one — cross-check the sources (re-read the file, search, or web_search) and resolve the discrepancy before acting. Treat what you find with tools as ground truth over your training knowledge.",
    "- For anything time-sensitive (news, latest versions, 'today', current events), DO NOT rely on training knowledge — call web_search. Your training data is outdated; the real current date is below.",
    "- Do NOT act on memory alone. Whenever the context shifts, or right BEFORE you draw a conclusion or take an action, fetch the latest state with tools and re-verify your recollection still holds — never trust remembered facts, file paths, config, or state without a fresh check. A remembered detail may be stale or have changed since you last saw it.",
    "",
    "## Finishing — check your work",
    "- When a task is done, verify it against the user's ORIGINAL intent: did you actually satisfy what they asked, end to end? Did you miss anything they listed?",
    "- State plainly how to verify the result (e.g. run X, open Y, check Z). If a step failed or was skipped, say so with the evidence — do not claim success you didn't confirm.",
    "- Be concise but complete: report what changed and where, using file references the user can click.",
    "",
    "## Safety",
    "- Treat destructive or hard-to-reverse actions (deleting/overwriting files, force operations, anything sent to an external service) with care: before deleting or overwriting, look at the target — if it contradicts how it was described, or you didn't create it, surface that rather than proceeding. When in doubt, confirm first unless the user has clearly authorized it.",
    "",
    "## Version control (git)",
    "- When initializing a new project, ask the user (via ask_followup_question) whether to init a git repo and stage files, which kinds of files to track, and whether large files should be ignored — let them decide, don't run git init/add on your own. After each round of changes, ask whether to commit.",
    "",
    "## Tools",
    "- write_file creates or overwrites a whole file. For existing files prefer edit_file (one change), multi_edit (several changes in one file, atomic), or apply_diff (a unified diff).",
    "- read_file output is line-number prefixed and may be paged for large files — pass offset/limit to read more.",
    "- glob_files finds files by name pattern; search_files greps contents; list_files lists a directory.",
    "- run_command runs shell commands. web_search finds current/external info; web_fetch reads a specific URL.",
    "- You can call multiple tools in sequence. After executing tools, wait for results before proceeding. If a tool fails or is denied, explain and try an alternative.",
    "- The tool names and signatures available in THIS environment are the authoritative ones — they may differ from names you remember from other environments. Before calling, confirm the tool actually exists here with the exact name/parameters shown to you.",
    "",
    "## Style",
    "- Respond in Chinese when the user speaks Chinese (code, file names, paths, and commands stay as-is).",
    "",
    "## Rich output — the chat UI renders full GitHub-flavored Markdown",
    "Your replies render as Markdown, not plain terminal text. Default to plain prose, `inline code`, fenced code blocks, and tables — these cover almost everything. The two below are special-purpose; each has a strict bar to clear before you use it:",
    "- **Mermaid diagrams** (fenced ```mermaid): a diagram earns its place ONLY when the relationships between three or more parts are the actual subject and prose would force the reader to hold a structure in their head — e.g. the user asks how modules connect, for an architecture/flow/sequence/state overview, or to compare branching paths. Before drawing, check: have I already conveyed this structure in the words or code just above? If yes, do not restate it as a diagram. At most ONE diagram per reply, and only for the single most structural idea. A list, a short code snippet, or one sentence is the better answer for anything simpler.",
    "  Syntax: `graph LR`, `flowchart TD`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram`, `erDiagram`. Put marker line + quoted content as shown for callouts below.",
    "- **Callout boxes** (GitHub alert syntax) are reserved for a consequence the reader would regret missing — not for general emphasis, summaries, or restating a point. Reach for one only when there is a concrete risk or required action attached: `> [!WARNING]` (real risk — breaking change, data loss, perf trap) or `> [!CAUTION]` (destructive/irreversible — deletes, force ops, prod changes). `> [!NOTE]` / `> [!TIP]` / `> [!IMPORTANT]` are also available for a genuinely useful aside, suggestion, or key point in a fitting spot; if the same sentence works inline without the box, keep it inline. Format:",
    "  > [!WARNING]",
    "  > This drops the table and cannot be undone.",
    "Rule of thumb: these are exceptions that punctuate an answer, not the texture of it. If a reply has no genuinely structural relationship and no real-world risk, it should contain neither a diagram nor a callout — that is the normal case.",
  ];

  // Vision guidance: tell the model whether it can actually see images, so it
  // picks the right browser tool. When vision is OFF, screenshots are useless
  // (the bytes are dropped before reaching the model) — steer it to the text
  // accessibility snapshot instead.
  if (vision === false) {
    lines.push(
      "",
      "## Images — THIS MODEL CANNOT SEE IMAGES",
      "The current provider/model does not accept image input. Screenshots will NOT reach you — do not call screenshot tools (browser_take_screenshot, capture_window, or any 'take screenshot' MCP tool); their image output is discarded and you'd be guessing blind.",
      "To inspect a web page or local HTML, use the Playwright browser_snapshot tool (or equivalent), which returns a TEXT accessibility tree (elements, roles, text) you CAN read. Reason about layout/content from that text, not from pixels."
    );
  } else {
    lines.push(
      "",
      "## Images — you can see images",
      "You can receive images. To screenshot a desktop window (e.g. an editor or other running app), call capture_window with a title keyword; the screenshot is saved and shown back to you. For a web page or local HTML, browser_snapshot (text accessibility tree) is cheaper for structure/text/DOM questions, and a browser screenshot is the way to inspect rendered pixels (visual layout, styling, colors)."
    );
  }

  if (mode === "plan") {
    lines.push(
      "",
      "## PLAN MODE (read-only) — ACTIVE",
      "You are currently in plan mode. ALL mutating tools (write_file, edit_file, multi_edit, apply_diff, run_command) are blocked and will be denied — do not attempt them.",
      "Your job right now is to PLAN, not to execute:",
      "1. Use only read-only tools (read_file, search_files, glob_files, list_files, web_search, web_fetch) to investigate thoroughly.",
      "2. Produce a clear implementation plan: the goal, the files involved, the concrete steps, and how the result will be verified.",
      "3. The ONLY way to present the plan is by CALLING the exit_plan_mode tool with the full plan text — pass the whole plan as its `plan` argument. Do this the MOMENT the plan is ready, in the SAME turn you finish thinking.",
      "CRITICAL: Do NOT write the plan out as an ordinary text message. If you reply with the plan as plain text and end your turn WITHOUT calling exit_plan_mode, the user sees no approval card and the whole flow stalls — you must wait for another user message to recover. Always hand off the plan through the exit_plan_mode tool call itself, never as text.",
      "Do NOT attempt any write or command until the user approves and the mode switches out of plan."
    );
  }

  // UE Coworker 自我说明（渐进式披露第一层 = 文档索引）。让 agent 能回答「这个软件
  // 本身」的问题、帮用户排查软件故障/教用法。这里只给「索引」（主题+一句话+文档绝对
  // 路径），详细实现/排障写在 resources/agent-docs/*.md，需要时用 read_file 读那一篇。
  // 索引内容字节恒定（路径在同一安装下固定），落在系统提示稳定前缀，不破缓存。
  const docsDir = app.isPackaged
    ? require("path").join(process.resourcesPath, "agent-docs")
    : require("path").join(__dirname, "../../resources/agent-docs");
  const docPath = (f: string) => require("path").join(docsDir, f);
  lines.push(
    "",
    "## About this app (UE Coworker) — answering questions about the software ITSELF",
    "You run inside UE Coworker, an Electron desktop AI-agent IDE. When the user asks how to USE the app, where its settings/logs are, why a feature (MCP/skills/memory/permissions/providers/relay) isn't working, or how the software works internally — DON'T guess. There is a set of authoritative implementation/troubleshooting docs on disk; `read_file` the relevant one FIRST, then answer grounded in it. These describe the APP itself, not the user's project.",
    "Docs (read the matching file before answering app questions):",
    "- `" + docPath("data-layout.md") + "` — where every config/log/data file lives under userData; transport-logs (how to enable, what they record); secrets encryption.",
    "- `" + docPath("agent-loop.md") + "` — the conversation loop, system-prompt block order, TOKEN ASSEMBLY, PROMPT-CACHE strategy (ephemeral breakpoints, why date is day-only, cache iron-rules), tool-call loop, approval/abort.",
    "- `" + docPath("providers.md") + "` — Providers & the three protocols (anthropic/responses/openai-compat), request-body differences, thinking config, empty-stream / context-overflow / balance causes.",
    "- `" + docPath("mcp.md") + "` — MCP config, stdio/http transport, tool-prefix routing, bundled Node runtime, and the real reasons a server won't connect.",
    "- `" + docPath("skills-agents-memory.md") + "` — Skills / Sub-agents / Memory / CLAUDE.md progressive disclosure, enable-state files, and why each might not take effect.",
    "- `" + docPath("permissions-checkpoints.md") + "` — permission modes (default/acceptEdits/bypassPermissions/plan), why a tool always prompts or is denied, and checkpoint ('undo the agent') internals.",
    "- `" + docPath("relay-remote-control.md") + "` — Discord/Telegram/WeChat remote control: utilityProcess gateway, neutral protocol, prompt round-trip, why 'app not responding' was fixed.",
    "Quick troubleshooting reflexes: tool stuck 'waiting for approval' → permission mode is `default` and the approval card is off-screen/window hidden (suggest acceptEdits/bypassPermissions). MCP won't connect → its command/env in ue-coworker-mcp.json (bundled Node is on PATH; registry installs with required keys stay disabled until filled). Bad/empty model reply → enable transport-logs and read the latest jsonl. The Settings panels have 'Open folder' buttons to locate these files."
  );

  lines.push(
    "",
    "Current working directory: " + cwd,
    "Current date & time: " + currentDateString()
  );
  return lines.join("\n");
}

// Human-readable current date so the model knows "today" (its training
// knowledge is stale). Main-process Date is unrestricted.
//
// DATE-ONLY ON PURPOSE: this string sits inside the system prompt, which carries
// a cache_control:ephemeral breakpoint. A minute/second-precision timestamp would
// change every turn, byte-breaking the cached prefix and forcing a full-price
// recompute of system+history on every request (the exact "volatile content in a
// stable cached prefix" failure mode that silently inflates cost). Day-level
// precision is all the model needs for time-sensitive grounding and keeps the
// prefix stable for the whole session. getUTCDay matches the UTC date string so
// weekday and date stay consistent across local midnight.
function currentDateString(): string {
  const d = new Date();
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[d.getUTCDay()] + ", " + d.toISOString().slice(0, 10) + " (UTC)";
}

// Anthropic 各模型的最大输出 token 上限(从模型名推断,避免写死单值导致长回答被
// 截断)。命中已知系列用其真实上限;未知模型给一个安全的较大默认值。
function anthropicMaxTokens(model: string): number {
  const m = (model || "").toLowerCase();
  // claude-3-5/3-7-haiku、3-haiku 等较小上限;opus/sonnet 4.x 支持 64K。
  if (m.indexOf("haiku") !== -1) return 8192;
  if (m.indexOf("opus-4") !== -1 || m.indexOf("sonnet-4") !== -1) return 64000;
  if (m.indexOf("3-7-sonnet") !== -1 || m.indexOf("3.7") !== -1) return 64000;
  if (m.indexOf("3-5-sonnet") !== -1 || m.indexOf("3.5") !== -1) return 8192;
  // 未知模型:给一个不易触顶、又被绝大多数模型接受的上限。
  return 16384;
}

// 扩展思考(/think)的 thinking 请求参数,按模型版本分流——发错形态会被 API 400:
//   - adaptive 系(opus 4.6/4.7/4.8、sonnet 4.6、fable/mythos):{type:"adaptive"};
//     发 budget_tokens 会 400。adaptive 自动开启交错思考(工具间思考),无需 beta 头。
//   - budget 系(3.7、4.0、4.1、opus 4.5、haiku 4.5 等较老 4.x):
//     {type:"enabled", budget_tokens:N},N 必须 < max_tokens。发 adaptive 会 400。
//   - 未知模型(中转站乱名):本项目默认用最新模型(见 CLAUDE.md),按 adaptive 处理。
// display:"summarized" 让模型回传可读思考摘要(原始思考永不返回),供 UI 折叠气泡展示;
// 不设则 4.7+ 默认 "omitted"(空思考文本)、看不到内容。budget 系老模型不认 display,
// 故仅 adaptive 形态附带 display 字段。
function anthropicThinkingConfig(model: string, maxTokens: number): any {
  const m = (model || "").toLowerCase();
  const isBudgetEra =
    m.indexOf("haiku") !== -1 ||                                  // 含 haiku-4-5
    m.indexOf("opus-4-5") !== -1 || m.indexOf("opus-4.5") !== -1 ||
    m.indexOf("sonnet-4-5") !== -1 || m.indexOf("sonnet-4.5") !== -1 ||
    m.indexOf("opus-4-1") !== -1 || m.indexOf("opus-4.1") !== -1 ||
    m.indexOf("opus-4-0") !== -1 || m.indexOf("opus-4-2025") !== -1 ||
    m.indexOf("sonnet-4-0") !== -1 || m.indexOf("sonnet-4-2025") !== -1 ||
    m.indexOf("3-7") !== -1 || m.indexOf("3.7") !== -1;
  if (isBudgetEra) {
    // budget 必须严格小于 max_tokens;取一半且夹在 [1024, 32000](官方建议>32k走批处理)。
    const budget = Math.max(1024, Math.min(32000, Math.floor(maxTokens / 2)));
    return { type: "enabled", budget_tokens: budget };
  }
  // adaptive 系(及未知模型默认):由模型自行决定思考深度,附 display 取回摘要。
  return { type: "adaptive", display: "summarized" };
}


/**
 * 把内部 OpenAI 形态的 messages/tools 转成 Anthropic /v1/messages 请求体的
 * 三个组成部分:顶层 system 块数组、messages 数组(content 用 block)、tools 数组。
 * - system 消息合并成顶层 system 字段(Anthropic 不接受 messages 里的 system role)
 * - assistant 的 tool_calls → tool_use content block
 * - tool 角色结果 → user 消息里的 tool_result block
 * - 相邻同角色消息合并(多个连续工具结果要并进同一条 user 消息)
 * - user 的 vision 数组(image_url data URL)→ Anthropic image block
 *
 * Prompt caching:在 tools 末尾、system 末尾、以及倒数第二条消息末尾打
 * cache_control:ephemeral 断点(Anthropic 最多 4 个)。稳定前缀(工具定义 +
 * 系统提示 + 大部分历史)命中缓存后便宜 ~90%,大幅降低多轮开销。断点选「倒数
 * 第二条」而非最后一条,使每轮新增的尾部消息成为缓存增量、稳定前缀持续复用。
 */
function toAnthropicRequest(messages: ChatMessage[], tools: any[]): { system: any[]; messages: any[]; tools: any[] } {
  const CACHE = { type: "ephemeral" as const };
  const systemParts: string[] = [];
  const conv: any[] = [];
  // 区分「真系统提示」与「易变状态注入」:对话内容出现前的 system 消息是稳定的
  // 系统提示,提到顶层 system 字段并参与缓存;对话开始后才出现的 system 消息
  // (如每轮变化的 to-do 路线图)是易变注入,若也并入被缓存的 system 块会逐轮
  // 击穿前缀、使 system+历史全部按全价重算。因此把它们按 user 消息内联在原位置,
  // 让其落在历史缓存断点「之后」,只作为尾部增量计费。OpenAI 路径不受影响。
  let seenConv = false;
  for (const m of messages) {
    if (m.role === "system") {
      if (typeof m.content === "string" && m.content) {
        if (seenConv) conv.push({ role: "user", content: m.content });
        else systemParts.push(m.content);
      }
      continue;
    }
    seenConv = true;
    if (m.role === "tool") {
      // 工具结果带图:tool_result 只放文字,图片作为「同一条 user 消息里、紧跟在
      // tool_result 之后的同级 image block」发送 —— 而不是嵌进 tool_result.content。
      // 原因:实测部分中转站会剥离 tool_result 内嵌的 image(prompt_tokens 不随图
      // 上涨、模型读不到),但对 user 消息顶层的 image block(与聊天框拖图同构)正常
      // 转发。Anthropic 协议允许回应 tool_use 的 user turn 在 tool_result 后追加
      // 其它块,故此结构合法且对官方端点等价。无图时保持纯字符串(兼容)。
      const textPart = typeof m.content === "string" ? m.content : "";
      if (Array.isArray(m.images) && m.images.length > 0) {
        const userContent: any[] = [
          { type: "tool_result", tool_use_id: m.tool_call_id, content: textPart || "(image returned; see below)" },
        ];
        for (const im of m.images) {
          userContent.push({ type: "image", source: { type: "base64", media_type: im.mime || "image/png", data: im.base64 } });
        }
        conv.push({ role: "user", content: userContent });
      } else {
        conv.push({ role: "user", content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: textPart }] });
      }
      continue;
    }
    if (m.role === "assistant") {
      const blocks: any[] = [];
      // 扩展思考:思考块必须排在 assistant content 最前(响应里本就如此),且逐字
      // 原样回放——signature/data 是不透明加密串,改一个字节就 400。带 tool_use 时
      // 缺思考块也会 400,故这里无条件把捕获到的思考块前置。仅 Anthropic 协议序列化
      // 走这里;OpenAI/Responses 路径不读 m.thinking,自然忽略。
      if (Array.isArray(m.thinking)) {
        for (const tb of m.thinking) {
          if (tb && tb.type === "thinking") {
            blocks.push({ type: "thinking", thinking: tb.thinking, signature: tb.signature });
          } else if (tb && tb.type === "redacted_thinking") {
            blocks.push({ type: "redacted_thinking", data: tb.data });
          }
        }
      }
      if (typeof m.content === "string" && m.content) blocks.push({ type: "text", text: m.content });
      else if (Array.isArray(m.content)) for (const p of m.content) if (p && p.type === "text") blocks.push({ type: "text", text: p.text });
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          let input: any = {};
          try { input = JSON.parse(tc.function.arguments || "{}"); } catch { input = {}; }
          blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
      }
      if (blocks.length === 0) blocks.push({ type: "text", text: "" });
      conv.push({ role: "assistant", content: blocks });
      continue;
    }
    // user
    if (typeof m.content === "string") {
      conv.push({ role: "user", content: m.content });
    } else if (Array.isArray(m.content)) {
      const blocks: any[] = [];
      for (const p of m.content) {
        if (p && p.type === "text") blocks.push({ type: "text", text: p.text });
        else if (p && p.type === "image_url") {
          const url = (p.image_url && p.image_url.url) || "";
          const match = /^data:(image\/[a-zA-Z+]+);base64,(.*)$/.exec(url);
          if (match) blocks.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
        }
      }
      conv.push({ role: "user", content: blocks.length ? blocks : "" });
    }
  }
  // 合并相邻同角色消息(Anthropic 要求 user/assistant 交替;连续工具结果需并入一条 user)。
  const merged: any[] = [];
  for (const msg of conv) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      const la = Array.isArray(last.content) ? last.content : [{ type: "text", text: String(last.content) }];
      const ma = Array.isArray(msg.content) ? msg.content : [{ type: "text", text: String(msg.content) }];
      last.content = la.concat(ma);
    } else {
      merged.push({ role: msg.role, content: Array.isArray(msg.content) ? msg.content : [{ type: "text", text: String(msg.content) }] });
    }
  }
  // 归一化每条 user 消息的块顺序:所有 tool_result 必须排在最前(Anthropic 硬性
  // 要求),其余块(工具返图的同级 image、文字)按原相对顺序排其后。多个返图工具
  // 合并到一条 user 时,上面的 concat 会产出 [tr_A, img_A, tr_B, img_B] 这种交错,
  // 此处稳定重排为 [tr_A, tr_B, img_A, img_B],既满足协议又保持配对可读。
  for (const msg of merged) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
    const hasTR = msg.content.some((b: any) => b && b.type === "tool_result");
    if (!hasTR) continue;
    const trs = msg.content.filter((b: any) => b && b.type === "tool_result");
    const rest = msg.content.filter((b: any) => !(b && b.type === "tool_result"));
    msg.content = trs.concat(rest);
  }
  // tools:转 Anthropic 形态,并在最后一个工具定义上打缓存断点(工具定义最稳定)。
  const atools = (tools || []).map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
  if (atools.length) (atools[atools.length - 1] as any).cache_control = CACHE;
  // system:转成块数组,末块打缓存断点(系统提示在一次会话内基本不变)。
  const system: any[] = [];
  if (systemParts.length) {
    system.push({ type: "text", text: systemParts.join("\n\n"), cache_control: CACHE });
  }
  // messages:在「倒数第二条」消息的最后一个 content block 上打缓存断点,让稳定
  // 历史前缀被缓存,每轮仅尾部新增内容计入未命中。少于 2 条时不打(无稳定前缀)。
  if (merged.length >= 2) {
    const target = merged[merged.length - 2];
    const blocks = target.content as any[];
    if (Array.isArray(blocks) && blocks.length) blocks[blocks.length - 1].cache_control = CACHE;
  }
  return { system, messages: merged, tools: atools };
}

/**
 * 转 OpenAI Responses API 请求体。messages(内部 OpenAI-chat 形态)→ Responses 的
 * `input` 数组 + `instructions`(system 合并) + 扁平 tools。关键差异:
 * - system → instructions 字符串(对话中途的 system 注入作为 input_text 内联)
 * - assistant.tool_calls → 每个 tool_call 一个 {type:"function_call", call_id, name, arguments}
 * - tool 结果 → {type:"function_call_output", call_id, output}; 带图时 output 是
 *   内容数组([{type:"input_text"}, {type:"input_image", image_url:dataURL}])
 * - user 图片(vision 数组)→ message content 的 input_image 项
 */
function toResponsesRequest(messages: ChatMessage[], tools: any[]): { input: any[]; instructions: string; tools: any[] } {
  const input: any[] = [];
  const systemParts: string[] = [];
  let seenConv = false;
  for (const m of messages) {
    if (m.role === "system") {
      if (typeof m.content === "string" && m.content) {
        if (seenConv) input.push({ type: "message", role: "user", content: [{ type: "input_text", text: m.content }] });
        else systemParts.push(m.content);
      }
      continue;
    }
    seenConv = true;
    if (m.role === "tool") {
      const textPart = typeof m.content === "string" ? m.content : "";
      if (Array.isArray(m.images) && m.images.length > 0) {
        const out: any[] = [];
        if (textPart) out.push({ type: "input_text", text: textPart });
        for (const im of m.images) {
          out.push({ type: "input_image", image_url: "data:" + (im.mime || "image/png") + ";base64," + im.base64, detail: "auto" });
        }
        input.push({ type: "function_call_output", call_id: m.tool_call_id, output: out });
      } else {
        input.push({ type: "function_call_output", call_id: m.tool_call_id, output: textPart });
      }
      continue;
    }
    if (m.role === "assistant") {
      const text = typeof m.content === "string" ? m.content
        : Array.isArray(m.content) ? m.content.filter((p: any) => p && p.type === "text").map((p: any) => p.text).join("") : "";
      if (text) input.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
      if (Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          input.push({ type: "function_call", call_id: tc.id, name: tc.function.name, arguments: tc.function.arguments || "{}" });
        }
      }
      continue;
    }
    // user
    if (typeof m.content === "string") {
      input.push({ type: "message", role: "user", content: [{ type: "input_text", text: m.content }] });
    } else if (Array.isArray(m.content)) {
      const parts: any[] = [];
      for (const p of m.content) {
        if (p && p.type === "text") parts.push({ type: "input_text", text: p.text });
        else if (p && p.type === "image_url") {
          const url = (p.image_url && p.image_url.url) || "";
          if (url) parts.push({ type: "input_image", image_url: url, detail: "auto" });
        }
      }
      if (parts.length) input.push({ type: "message", role: "user", content: parts });
    }
  }
  const rtools = (tools || []).map((t) => ({
    type: "function",
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
  return { input, instructions: systemParts.join("\n\n"), tools: rtools };
}

/**
 * 判断一个错误响应是否为「上下文窗口溢出」。不同 provider/模型/中转的措辞差异很大，
 * 故关键词放得尽量宽泛，覆盖 OpenAI、Anthropic、各类兼容端点与中文报错。命中即触发
 * 前端的自动压缩+重试。状态码不限定（多为 400，少数端点用 413/422），主要看正文。
 */
function isContextOverflowError(_status: number | undefined, body: string): boolean {
  if (!body) return false;
  const t = body.toLowerCase();
  const needles = [
    "context length", "context_length", "context window", "context_window",
    "contextlength", "maximum context", "max context", "context limit",
    "context_length_exceeded", "too many tokens", "too long", "prompt is too long",
    "input is too long", "exceeds the maximum", "exceed the maximum", "exceeds maximum",
    "maximum number of tokens", "max tokens", "maximum tokens", "token limit",
    "reduce the length", "reduce the number of tokens", "reduce input",
    "too large", "request too large", "payload too large", "string too long",
    "上下文", "超出", "过长", "太长", "长度超过", "令牌", "token 数",
  ];
  return needles.some((n) => t.indexOf(n) !== -1);
}

/**
 * 传输层重试包装器:对「连接级失败 / 5xx / 429 且尚未流出任何文本」的瞬时错误做
 * 指数退避重试(默认 3 次)。这是「执行保证」的第一层——中转站 socket hang up、
 * 网关 502、限流 429 不再让整轮直接死。
 *
 * 安全保证:
 *  - 只重试 err.retryable(由 streamCompletion 标记:仅在未流出文本时为 true),
 *    故绝不会重复已经显示给用户的内容。
 *  - 中间尝试传 suppressRetryableToast=true,不弹 agent:error(避免每次重试都报错);
 *    最后一次失败时正常弹错并抛出,与原行为一致。
 *  - 用户 abort 立即停止重试。
 */
async function streamCompletionWithRetry(
  provider: any,
  model: string,
  messages: ChatMessage[],
  tools: any[],
  window: BrowserWindow,
  signal: AbortSignal | undefined,
  effort: "minimal" | "low" | "medium" | "high" | undefined,
  onDelta: (text: string) => void,
  sessionId?: string,
  maxRetries = 3,
  // 扩展思考(/think):是否注入 thinking 参数;onThinking 接收思考摘要增量(仅
  // Anthropic + display:summarized 下有值)。默认关闭/空操作,保持既有行为不变。
  thinkingMode?: boolean,
  onThinking?: (text: string) => void
): Promise<ChatMessage> {
  let attempt = 0;
  for (;;) {
    const isLast = attempt >= maxRetries;
    try {
      return await streamCompletion(provider, model, messages, tools, window, signal, effort, onDelta, sessionId, !isLast, thinkingMode, onThinking);
    } catch (err: any) {
      // 不可重试(已流出文本 / 上下文溢出 / 4xx 非 429)或已到次数上限或用户中止:抛出。
      if (!err?.retryable || isLast || signal?.aborted) throw err;
      attempt++;
      // 指数退避:0.8s, 1.6s, 3.2s …(带小抖动),期间若 abort 立即停。
      const delay = Math.min(8000, 800 * Math.pow(2, attempt - 1)) + Math.floor(Math.random() * 200);
      const aborted = await new Promise<boolean>((res) => {
        const t = setTimeout(() => { signal?.removeEventListener("abort", onAb); res(false); }, delay);
        const onAb = () => { clearTimeout(t); res(true); };
        if (signal?.aborted) { clearTimeout(t); res(true); return; }
        signal?.addEventListener("abort", onAb, { once: true });
      });
      if (aborted) throw err;
      // 重试前给用户一个轻量提示(非错误,只说明在重连),不打断流程。
      try {
        if (!window.isDestroyed()) {
          window.webContents.send("agent:error", {
            message: "连接中断,正在重试(" + attempt + "/" + maxRetries + ")…",
            transient: true,
            sessionId,
          });
        }
      } catch { /* window 可能已销毁 */ }
    }
  }
}

/**
 * 发送前结构归一化:消除「首次实时发送」与「跨轮重建(渲染层 buildReplayMessages)」
 * 的结构差异,防止自我击穿 prompt 缓存。
 *
 * 背景:模型在一轮里**串行**多次调用工具时(先 glob、拿到结果后又单独 read),实时
 * 循环把每次调用各存为一条独立 assistant 消息;但这些消息落库后,**无前导文字的
 * 后续回合不会生成 assistant 气泡**,重建时(buildReplayMessages 阶段 A)那些相邻
 * tool 结果会被贪婪并入前一条 assistant 的 tool_calls,形成「一条 assistant 带多个
 * tool_use」的合并态。于是同一段历史:首次发送是串行多条 assistant,跨轮重建是合并
 * 单条 —— 结构发散,从该处起击穿其后全部缓存前缀。
 *
 * 修法:让首次发送也走与重建一致的合并态。把「紧跟在 tool 结果之后、自身只有
 * tool_calls 而无实质文字、且无 thinking 块」的 assistant,其 tool_calls 上提合并进
 * 前一条 assistant,自身删除 —— 精确复刻落库丢失中间 assistant 后的重建结构。
 *
 * thinking 约束:带 thinking 块的 assistant 绝不参与合并(无论作为被并入方还是接收
 * 方)。thinking 的 signature 与单次响应内容绑定,合并两次响应的 thinking 会 400;
 * 且跨轮重建路径根本不保留 thinking(落库即丢),只有「无 thinking」的回合两路径才
 * 真正同构。故仅合并双方都无 thinking 的串行单工具回合,带 thinking 的保持独立。
 *
 * 纯函数:不修改入参 messages 及其元素对象(主循环复用同一数组,污染会导致下一轮
 * 读到被改写的 tool_calls)。需要合并时以浅拷贝替换 out 里的承载消息。
 */
function normalizeAssistantToolStructure(messages: ChatMessage[]): ChatMessage[] {
  // 一条 assistant 是否「有实质文字」(决定它落库时是否会生成 assistant 气泡)。
  const hasText = (m: ChatMessage): boolean => {
    if (typeof m.content === "string") return m.content.trim().length > 0;
    if (Array.isArray(m.content)) return m.content.some((p: any) => p && p.type === "text" && String(p.text || "").trim());
    return false;
  };
  const hasThinking = (m: ChatMessage): boolean => Array.isArray(m.thinking) && m.thinking.length > 0;
  const isToolResult = (m: ChatMessage): boolean => m.role === "tool";

  const out: ChatMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    // 候选被合并方:assistant、带 tool_calls、无实质文字、无 thinking,且前一条已是
    // tool 结果(说明它是「串行后续回合」),且 out 末尾能找到可接收的前置 assistant。
    if (
      m.role === "assistant" &&
      Array.isArray(m.tool_calls) && m.tool_calls.length > 0 &&
      !hasText(m) && !hasThinking(m) &&
      i > 0 && isToolResult(messages[i - 1])
    ) {
      // 在 out 里回溯,跳过已并入的 tool 结果,找到承载它们的那条 assistant。
      let hostIdx = -1;
      for (let k = out.length - 1; k >= 0; k--) {
        if (out[k].role === "tool") continue;
        if (out[k].role === "assistant" && Array.isArray(out[k].tool_calls) && out[k].tool_calls!.length > 0 && !hasThinking(out[k])) {
          hostIdx = k;
        }
        break; // 只认紧邻的 assistant(中间只能隔 tool 结果);遇到非 tool/非合格 assistant 即停
      }
      if (hostIdx >= 0) {
        // 浅拷贝替换,绝不修改原对象:新 tool_calls = 承载方原有 + 本条的。
        const host = out[hostIdx];
        out[hostIdx] = { ...host, tool_calls: host.tool_calls!.concat(m.tool_calls) };
        continue; // 丢弃这条 assistant 本身,其 tool 结果随后原样追加,顺序不变
      }
    }
    out.push(m);
  }
  return out;
}

/**
 * Stream a chat completion. Supports three wire protocols, selected by
 * provider.protocol: "anthropic" → POST /v1/messages (native, tool_result images
 * supported); "responses" → POST /v1/responses (native, function_call_output
 * images supported); anything else → OpenAI-compatible POST /v1/chat/completions
 * (tool images NOT supported — stripped with a text placeholder). Either way it
 * calls onDelta for each text chunk, reassembles tool calls, and resolves the
 * SAME OpenAI-shaped ChatMessage (role/content/tool_calls/usage) so the rest of
 * the loop is protocol-agnostic.
 */
function streamCompletion(
  provider: any,
  model: string,
  messages: ChatMessage[],
  tools: any[],
  window: BrowserWindow,
  signal: AbortSignal | undefined,
  effort: "minimal" | "low" | "medium" | "high" | undefined,
  onDelta: (text: string) => void,
  sessionId?: string,
  // 传输层重试用:为 true 时,本次属于「可重试错误且尚未流出文本」的情形不弹
  // agent:error(由重试包装器决定最终是否提示),只 reject 让上层重试。
  suppressRetryableToast?: boolean,
  // 扩展思考(/think):thinkingMode=true 时在 Anthropic 请求体注入 thinking 参数;
  // onThinking 接收思考摘要增量(display:summarized 下的 thinking_delta)。其它协议忽略。
  thinkingMode?: boolean,
  onThinking?: (text: string) => void
): Promise<ChatMessage> {
  const isAnthropic = provider.protocol === "anthropic";
  const isResponses = provider.protocol === "responses";
  // 发送前结构归一化:让首次实时发送与跨轮重建(buildReplayMessages)产出同构的
  // assistant↔tool 结构,消除串行多工具回合的自我击穿(详见函数注释)。
  // 仅 Anthropic 协议生效:① 该合并的缓存价值主要在 Anthropic(显式 cache_control 断点);
  // ② OpenAI 协议下「一条 assistant 多 tool_calls」会触发部分推理模型(如 deepseek
  // 推理系)的「reasoning_content 必须回传」严格校验而 400(本项目未回传 reasoning_content),
  // 而 OpenAI 端的前缀缓存是自动的、不依赖此合并。故 OpenAI/Responses 保持原样不合并。
  if (isAnthropic) messages = normalizeAssistantToolStructure(messages);
  let baseUrl = (provider.baseUrl || "").replace(/\/+$/, "");
  let urlObj: URL;
  let body: string;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (isAnthropic) {
    // Anthropic native: endpoint is <root>/v1/messages; auth via x-api-key.
    const root = baseUrl.replace(/\/v1$/, "");
    urlObj = new URL(root + "/v1/messages");
    const conv = toAnthropicRequest(messages, tools);
    const maxTok = anthropicMaxTokens(model);
    const reqBody: any = {
      model,
      max_tokens: maxTok,
      messages: conv.messages,
      stream: true,
    };
    if (conv.system.length) reqBody.system = conv.system;
    if (conv.tools.length) reqBody.tools = conv.tools;
    // 扩展思考(/think):注入 thinking 参数(按模型版本分流 adaptive/budget)。仅
    // 切换开关那一轮会失效 messages 缓存;system+tools 稳定前缀不受影响。注意:
    // thinking 与 temperature/top_k/强制 tool_choice 不兼容——本分支均未设置,安全。
    if (thinkingMode) reqBody.thinking = anthropicThinkingConfig(model, maxTok);
    body = JSON.stringify(reqBody);
    headers["x-api-key"] = provider.apiKey || "";
    headers["anthropic-version"] = "2023-06-01";
  } else if (isResponses) {
    // OpenAI Responses API: <root>/v1/responses. 原生支持 function_call_output
    // 内嵌图片(input_image)。请求体用 input 数组 + typed SSE 事件流。
    if (baseUrl.indexOf("/v1") === -1) baseUrl += "/v1";
    urlObj = new URL(baseUrl + "/responses");
    const conv = toResponsesRequest(messages, tools);
    const reqBody: any = {
      model,
      input: conv.input,
      stream: true,
    };
    if (conv.instructions) reqBody.instructions = conv.instructions;
    if (conv.tools.length) reqBody.tools = conv.tools;
    if (effort) reqBody.reasoning = { effort };
    body = JSON.stringify(reqBody);
    headers["Authorization"] = "Bearer " + (provider.apiKey || "");
  } else {
    if (baseUrl.indexOf("/v1") === -1) baseUrl += "/v1";
    urlObj = new URL(baseUrl + "/chat/completions");
    // /chat/completions 的 tool 消息不能带图。剥离 images 字段(避免严格端点 400),
    // 并对原本带图的 tool 消息追加文字占位,提示模型「有图但当前协议不支持」。
    const cleanMessages = messages.map((m) => {
      if (m.role === "tool" && Array.isArray(m.images) && m.images.length > 0) {
        const note = "\n[" + m.images.length + " image(s) were produced by this tool but cannot be shown to the model on the OpenAI /chat/completions protocol. Switch this provider to the Anthropic or Responses protocol to see tool images, or use browser_snapshot for a text view.]";
        const base = typeof m.content === "string" ? m.content : "";
        return { role: m.role, tool_call_id: m.tool_call_id, content: base + note };
      }
      // 其余消息剥掉自定义 images 字段(若有),只保留 OpenAI 标准字段。
      const { images, ...rest } = m as any;
      // thinking 是 Anthropic 专用块(含 signature),OpenAI /chat/completions 不识别且可能
      // 因未知字段报错,序列化时剥离(OpenAI 思考链走 reasoning_content,与此独立)。
      if ("thinking" in rest) delete rest.thinking;
      // reasoning_content(DeepSeek V4 thinking mode):带 tool_calls 的 assistant 必须携带,
      // 否则 400。现已全链路保真——同轮迭代由 streamCompletion 挂、跨轮重建由
      // buildReplayMessages→buildApiMessage 原样带回,绝大多数情况是**真实思考串**。此处
      // 仅作双保险:极端边界(早于本次改动的旧会话历史无此字段、或那轮模型确实未产思考)
      // 缺失时补空串(官方接受空串满足校验,且此时"空"即真实值,非折中)。无 tool_calls 的
      // assistant 不补(纯回答轮端点会忽略 reasoning_content)。
      if (rest.role === "assistant" && Array.isArray(rest.tool_calls) && rest.tool_calls.length > 0 && rest.reasoning_content == null) {
        rest.reasoning_content = "";
      }
      return rest;
    });
    const reqBody: any = {
      model,
      messages: cleanMessages,
      tools,
      tool_choice: "auto",
      stream: true,
      // 让兼容 OpenAI 的流在结尾带 usage（token 统计）。不支持的服务会忽略此字段。
      stream_options: { include_usage: true },
    };
    // 推理强度（/effort）：仅在用户显式设置时发送。不支持的端点会忽略此字段。
    if (effort) reqBody.reasoning_effort = effort;
    body = JSON.stringify(reqBody);
    headers["Authorization"] = "Bearer " + (provider.apiKey || "");
  }
  const isHttps = urlObj.protocol === "https:";
  const transport = isHttps ? httpsRequest : httpRequest;
  if (provider.headers) for (const k in provider.headers) headers[k] = provider.headers[k];

  // 传输日志（默认关闭，CW_TRANSPORT_LOG=1 开启）：记录真正发出的请求体 + headers，
  // 响应结束后再配对记录 usage。reqTs 用于把请求/响应两条记录关联起来。
  const _proto = isAnthropic ? "anthropic" : isResponses ? "responses" : "openai";
  const _reqTs = logRequest({ sessionId, protocol: _proto, model, url: urlObj.toString(), headers, body });

  return new Promise((resolve, reject) => {
    if (signal?.aborted) { resolve({ role: "assistant", content: null }); return; }
    let settled = false;
    let resRef: any = null;
    let accumulated = ""; // text seen so far, returned on abort
    // Register the abort handler at REQUEST level so it works even before the
    // response headers arrive (e.g. user hits Stop during TTFB). Tears down the
    // socket and resolves with whatever text we have — no further iterations.
    const onAbort = () => {
      try { req.destroy(); resRef?.destroy?.(); } catch {}
      if (!settled) {
        settled = true;
        // 诊断:abort 是唯一不写响应日志的退出路径,导致中断时日志里「请求发出却无响应、
        // 无错误」,无法区分「用户点停止」与「上游静默掉线」。补一条 aborted 记录,带上
        // 已流出的文本长度,便于事后定位中断点。
        logResponse({ reqTs: _reqTs, sessionId, protocol: _proto, model, error: "aborted (signal); streamed_chars=" + accumulated.length });
        resolve({ role: "assistant", content: accumulated || null });
      }
    };
    const req = transport({
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers,
    }, (res: any) => {
      resRef = res;
      if (signal?.aborted) { onAbort(); return; }
      if (res.statusCode !== 200) {
        let eb = "";
        res.on("data", (c: Buffer) => { eb += c.toString(); });
        res.on("end", () => {
          // 报错完整化：保留状态码 + 较完整的错误体（不再砍到 300）。极长时保留首尾，
          // 中间省略，避免关键信息（错误类型/字段）被尾部截断丢失。
          const full = eb.trim();
          let bodyText = full;
          if (full.length > 4000) {
            bodyText = full.slice(0, 2400) + "\n…（已省略 " + (full.length - 4000) + " 字）…\n" + full.slice(-1600);
          }
          logResponse({ reqTs: _reqTs, sessionId, protocol: _proto, model, status: res.statusCode, error: full.slice(0, 4000) });
          // 5xx / 429 是服务端瞬时错误(网关抖动 / 限流),可重试;且非上下文溢出
          // (溢出要交给前端走压缩重试,不在此重试)。中间尝试不弹错,由包装器决定。
          const sc = res.statusCode || 0;
          const overflow = isContextOverflowError(res.statusCode, full);
          const retryable = !overflow && (sc === 429 || (sc >= 500 && sc <= 599));
          if (!(retryable && suppressRetryableToast)) {
            window.webContents.send("agent:error", {
              message: "API " + res.statusCode + ": " + bodyText,
              status: res.statusCode,
              body: full,
              kind: overflow ? "context_overflow" : undefined,
              sessionId,
            });
          }
          const httpErr: any = new Error("HTTP " + res.statusCode);
          httpErr.retryable = retryable;
          reject(httpErr);
        });
        return;
      }

      let content = "";
      // OpenAI 推理系模型(如 deepseek 推理)在流里单独给 delta.reasoning_content。
      // 部分端点(DeepSeek 官方)要求:带 tool_calls 的 assistant 回传时必须把当轮的
      // reasoning_content 一并带回,否则下一轮 400(尤其一条 assistant 含多个 tool_calls
      // 时严格校验)。故在此累计,结束时挂到返回消息,并在 OpenAI 序列化时原样回灌。
      let reasoningContent = "";
      // tool_calls are streamed by index; accumulate arguments per index.
      const toolAcc: Record<number, ToolCall> = {};
      let usage: any = null; // 末帧的 token 统计（若服务返回）
      // Anthropic 用 input_tokens/output_tokens 分两帧给;在此累计后转成 OpenAI 形态。
      let aInputTokens = 0, aOutputTokens = 0, aCacheCreate = 0, aCacheRead = 0;
      let aStopReason = ""; // Anthropic 停止原因:end_turn/tool_use/max_tokens/...
      // 扩展思考(/think):按 content block index 累计思考块,供逐字回放。普通 thinking
      // 累计 thinking 文本(summary)+ signature;redacted_thinking 累计不透明 data。
      // 结束时按 index 升序排成 ThinkingBlock[] 挂到返回消息,原样回灌下一轮(缺则 400)。
      const thinkingAcc: Record<number, { type: "thinking"; thinking: string; signature: string } | { type: "redacted_thinking"; data: string }> = {};
      // 诊断(仅 thinkingMode):统计实际见到的思考相关 SSE 事件,定位「请求带了 thinking
      // 但中转站不回思考块」这类问题——是中转站没回,还是本地解析漏了。
      let dbgThinkingEvents = 0;
      let buf = "";
      const LF = String.fromCharCode(10);
      // 调试用：开启传输日志时，原样累积整段流，便于排查"200 空流"（服务器返回 200
      // 却没有任何内容帧）这类静默失败——看清中转站到底吐了什么。最多留前 16KB。
      // thinkingMode 时也强制累积:用于诊断「请求带了 thinking 但看不到思考」。
      const logOn = transportLogEnabled();
      const captureRaw = logOn || !!thinkingMode;
      let rawStream = "";

      res.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        if (captureRaw && rawStream.length < 16000) rawStream += chunk.toString();
        const lines = buf.split(LF);
        buf = lines.pop() || "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line || line.indexOf("data:") !== 0) continue;
          const jsonStr = line.slice(5).trim();
          if (jsonStr === "[DONE]") continue;
          let parsed: any;
          try { parsed = JSON.parse(jsonStr); } catch { continue; }

          if (isAnthropic) {
            // Anthropic SSE: typed events. Map to the same content/toolAcc/usage.
            const type = parsed.type;
            if (type === "message_start" && parsed.message?.usage) {
              aInputTokens = Number(parsed.message.usage.input_tokens || 0);
              aCacheCreate = Number(parsed.message.usage.cache_creation_input_tokens || 0);
              aCacheRead = Number(parsed.message.usage.cache_read_input_tokens || 0);
            } else if (type === "content_block_start") {
              const cb = parsed.content_block;
              if (cb && cb.type === "tool_use") {
                const idx = parsed.index ?? 0;
                toolAcc[idx] = { id: cb.id || "call_" + idx, type: "function", function: { name: cb.name || "", arguments: "" } };
              } else if (cb && cb.type === "thinking") {
                // 思考块开始:种子里可能已带初始 thinking/signature(通常为空,靠 delta 累计)。
                const idx = parsed.index ?? 0;
                thinkingAcc[idx] = { type: "thinking", thinking: String(cb.thinking || ""), signature: String(cb.signature || "") };
                dbgThinkingEvents++;
              } else if (cb && cb.type === "redacted_thinking") {
                // 安全屏蔽思考块:只有不透明 data,原样存、原样回放。
                const idx = parsed.index ?? 0;
                thinkingAcc[idx] = { type: "redacted_thinking", data: String(cb.data || "") };
                dbgThinkingEvents++;
              }
            } else if (type === "content_block_delta") {
              const d = parsed.delta;
              if (d && d.type === "text_delta" && d.text) {
                content += d.text;
                accumulated = content;
                onDelta(d.text);
              } else if (d && d.type === "input_json_delta") {
                const idx = parsed.index ?? 0;
                if (toolAcc[idx]) toolAcc[idx].function.arguments += d.partial_json || "";
              } else if (d && d.type === "thinking_delta") {
                // 思考摘要增量(display:summarized):累计进对应块,并经 onThinking 流给 UI。
                const idx = parsed.index ?? 0;
                const blk = thinkingAcc[idx];
                if (blk && blk.type === "thinking") blk.thinking += d.thinking || "";
                if (d.thinking && onThinking) onThinking(d.thinking);
                dbgThinkingEvents++;
              } else if (d && d.type === "signature_delta") {
                // 思考块签名(content_block_stop 前到达):不透明加密串,原样累计,绝不解析。
                const idx = parsed.index ?? 0;
                const blk = thinkingAcc[idx];
                if (blk && blk.type === "thinking") blk.signature += d.signature || "";
              }
            } else if (type === "message_delta") {
              if (parsed.usage) aOutputTokens = Number(parsed.usage.output_tokens || 0);
              if (parsed.delta && parsed.delta.stop_reason) aStopReason = parsed.delta.stop_reason;
            }
            continue;
          }

          if (isResponses) {
            // OpenAI Responses SSE: typed events. Map text/tool-calls/usage to the
            // same content/toolAcc/usage so downstream handling is unchanged.
            const type = parsed.type;
            if (type === "response.output_text.delta" && typeof parsed.delta === "string") {
              content += parsed.delta;
              accumulated = content;
              onDelta(parsed.delta);
            } else if (type === "response.output_item.added" && parsed.item && parsed.item.type === "function_call") {
              const idx = parsed.output_index ?? Object.keys(toolAcc).length;
              toolAcc[idx] = {
                id: parsed.item.call_id || parsed.item.id || "call_" + idx,
                type: "function",
                function: { name: parsed.item.name || "", arguments: parsed.item.arguments || "" },
                _itemIndex: parsed.output_index,
              } as any;
            } else if (type === "response.function_call_arguments.delta" && typeof parsed.delta === "string") {
              // 用 output_index 找回对应工具调用累加参数。
              const oi = parsed.output_index;
              let target: any = null;
              for (const k of Object.keys(toolAcc)) {
                if ((toolAcc[Number(k)] as any)._itemIndex === oi) { target = toolAcc[Number(k)]; break; }
              }
              if (!target) { target = toolAcc[oi]; }
              if (target) target.function.arguments += parsed.delta;
            } else if (type === "response.completed" && parsed.response && parsed.response.usage) {
              const u = parsed.response.usage;
              usage = {
                prompt_tokens: Number(u.input_tokens || 0),
                completion_tokens: Number(u.output_tokens || 0),
                total_tokens: Number(u.total_tokens || 0),
              };
            } else if (type === "error" || type === "response.failed") {
              const msg = (parsed.message || (parsed.response && parsed.response.error && parsed.response.error.message)) || "Responses stream error";
              if (!window.isDestroyed()) window.webContents.send("agent:error", { message: String(msg), sessionId });
            }
            continue;
          }

          // OpenAI-compatible SSE.
          // usage 通常出现在最后一帧（choices 为空）；累计到 usage。
          if (parsed.usage) usage = parsed.usage;
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            content += delta.content;
            accumulated = content; // mirror for abort-path resolution
            onDelta(delta.content);
          }

          // 推理系模型(DeepSeek 等)的思考增量:① 累计进 reasoningContent 供回传校验;
          // ② 同步经 onThinking 流给 UI 思考气泡(与 Anthropic thinking_delta 同一通道),
          // 使三协议思考过程都实时可见。不经 onDelta(它是思考过程,非最终回答正文)。
          // 字段名兼容 reasoning_content(DeepSeek)与 reasoning。
          if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
            reasoningContent += delta.reasoning_content;
            if (onThinking) onThinking(delta.reasoning_content);
          } else if (typeof delta.reasoning === "string" && delta.reasoning) {
            reasoningContent += delta.reasoning;
            if (onThinking) onThinking(delta.reasoning);
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tcDelta of delta.tool_calls) {
              const idx = tcDelta.index ?? 0;
              if (!toolAcc[idx]) {
                toolAcc[idx] = { id: tcDelta.id || "call_" + idx, type: "function", function: { name: "", arguments: "" } };
              }
              const acc = toolAcc[idx];
              if (tcDelta.id) acc.id = tcDelta.id;
              if (tcDelta.function?.name) acc.function.name += tcDelta.function.name;
              if (tcDelta.function?.arguments) acc.function.arguments += tcDelta.function.arguments;
            }
          }
        }
      });

      res.on("end", () => {
        signal?.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        const toolCalls = Object.keys(toolAcc)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => toolAcc[Number(k)]);
        // Anthropic: synthesize an OpenAI-shaped usage object so upstream token
        // accounting works unchanged. 语义对齐:Anthropic 的 input_tokens 不含缓存
        // token,而 OpenAI 的 prompt_tokens 含(cached 是其子集)。故 prompt_tokens
        // 合成为「非缓存输入 + 缓存创建 + 缓存读取」= 真实总输入,cache_read 仍作为
        // 其子集单独报告,这样总输入与缓存命中都不丢、不重复计。
        if (isAnthropic && (aInputTokens || aOutputTokens || aCacheCreate || aCacheRead)) {
          usage = {
            prompt_tokens: aInputTokens + aCacheCreate + aCacheRead,
            completion_tokens: aOutputTokens,
            cache_creation_input_tokens: aCacheCreate,
            cache_read_input_tokens: aCacheRead,
          };
        }
        // 截断告警:stop_reason=max_tokens 表示回答被输出上限截断(不是正常结束)。
        // 明确提示用户,避免静默截断被误当作完整回答。
        if (isAnthropic && aStopReason === "max_tokens" && !window.isDestroyed()) {
          window.webContents.send("agent:error", { message: "回答因达到输出上限(max_tokens)被截断,可让模型继续或拆分任务。" });
        }
        const msg: ChatMessage = { role: "assistant", content: content || null };
        if (toolCalls.length > 0) msg.tool_calls = toolCalls;
        if (usage) msg.usage = usage;
        // 推理系模型(OpenAI 协议)的思考串回传规则(DeepSeek V4 thinking mode):带 tool_calls
        // 的 assistant 在后续轮**必须**携带本轮 reasoning_content,否则 400。关键陷阱:那条
        // 「没有思考输出的工具轮」也必须带——空字符串被接受且满足校验(官方与 litellm
        // #26395 实证)。故只要本轮有 tool_calls 就无条件挂,空则用 ""。纯文本回答轮无须
        // 携带(端点会忽略),不挂以免污染历史。仅 OpenAI /chat/completions 序列化时回灌。
        if (toolCalls.length > 0) msg.reasoning_content = reasoningContent || "";
        // 扩展思考:按 content block index 升序收齐思考块,挂到消息上供下一轮原样回放
        // (尤其带 tool_use 时,缺思考块会 400)。display:omitted 下 thinking 文本为空,
        // 但 signature 仍在——仍须回放。空块(无 signature 无 data)丢弃,避免污染。
        const thinkingBlocks = Object.keys(thinkingAcc)
          .sort((a, b) => Number(a) - Number(b))
          .map((k) => thinkingAcc[Number(k)])
          .filter((b) => (b.type === "thinking" ? !!b.signature : !!b.data));
        if (thinkingBlocks.length > 0) msg.thinking = thinkingBlocks;
        // 空响应检测：HTTP 200 却没有任何文本/工具调用产出（中转站返回空流的典型症状）。
        // 之前会 resolve 出 content:null 的空消息——既不报错也不显示，用户看到"发了没反应"。
        // 这里给用户一条明确提示，并把原始响应体记进日志（开启传输日志时）以便排查。
        const isEmpty = !content && toolCalls.length === 0;
        // 思考诊断:开了 thinkingMode 却一个思考事件都没收到 → 多半是中转站接受
        // thinking 参数但不真正回思考块(或回了非标准事件名)。把原始流头记进日志,
        // 配合事件计数(写进 note),一眼定位是「中转站没回」还是「本地解析漏了」。
        logResponse({
          reqTs: _reqTs, sessionId, protocol: _proto, model, status: 200, usage,
          note: isEmpty ? "empty stream (200 but no content/tool_calls)"
            : (thinkingMode ? ("thinking diag: events=" + dbgThinkingEvents + " blocks=" + thinkingBlocks.length) : undefined),
          // TEMP DEBUG（capture_window 排查）：无条件记录原始响应流，用于核对模型实际吐出的
          // tool_use 块（区分「模型没发」vs「发了但本地序列化/中转站吞掉」）。排查完恢复为
          // 原条件 (isEmpty || thinkingMode)，避免长期记录大体积响应原文。
          raw: rawStream.slice(0, 16000),
        });
        if (isEmpty && !window.isDestroyed()) {
          window.webContents.send("agent:error", {
            message: "服务器返回 200 但响应内容为空（无正文、无工具调用）。多为中转/供应商问题：模型名不被该端点支持、上游静默拒绝或返回了非标准流。可换个模型/供应商重试；如需排查，开启「设置→传输调试日志」后复现并查看响应原文。",
            sessionId,
          });
        }
        resolve(msg);
      });

      res.on("error", (err: Error) => {
        signal?.removeEventListener("abort", onAbort);
        if (settled) return;
        settled = true;
        // Aborted by user: resolve with partial text instead of erroring.
        if (signal?.aborted) { resolve({ role: "assistant", content: content || null }); return; }
        logResponse({ reqTs: _reqTs, sessionId, protocol: _proto, model, error: "stream: " + err.message });
        // 流中途断开(socket hang up 等)且尚未流出任何文本:可重试,中间尝试不弹错。
        // 已流出部分文本则不重试(重试会重复输出),照常弹错并 reject。
        const retryable = !content;
        if (!(retryable && suppressRetryableToast)) {
          window.webContents.send("agent:error", { message: "Stream: " + err.message });
        }
        (err as any).retryable = retryable;
        reject(err);
      });
    });

    // Abort works even before the response arrives (TTFB) — registered here.
    signal?.addEventListener("abort", onAbort, { once: true });

    req.on("error", (err: Error) => {
      signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      if (signal?.aborted) { resolve({ role: "assistant", content: accumulated || null }); return; }
      logResponse({ reqTs: _reqTs, sessionId, protocol: _proto, model, error: "request: " + err.message });
      // 连接级失败(socket hang up / ECONNRESET / ETIMEDOUT 等)且尚未流出任何文本:
      // 标记为可重试,交由重试包装器决定是否最终弹错(中间尝试不弹,避免噪音)。
      const retryable = !accumulated;
      if (!(retryable && suppressRetryableToast)) {
        window.webContents.send("agent:error", { message: "Request: " + err.message });
      }
      (err as any).retryable = retryable;
      reject(err);
    });
    req.write(body);
    req.end();
  });
}
