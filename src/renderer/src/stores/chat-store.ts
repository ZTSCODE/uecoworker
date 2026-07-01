import { create } from "zustand";

// Anthropic 扩展思考块(回传必需,原样持久化/回放——signature 是不透明加密串,改一字节
// 即 400)。与 main 端 agent-loop.ts 的 ThinkingBlock 同构。
export type ThinkingBlock =
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCall?: { id?: string; name: string; input: any; output?: string; approved?: boolean; images?: string[] };
  timestamp: number;
  streaming?: boolean;
  runId?: string; // set on agent-produced messages so applyTurn can replace them as a block
  tokens?: number;
  cost?: number;
  // 用户消息附带的本地图片绝对路径（落盘持久化；发送时后端从路径读出转 base64）。
  images?: string[];
  // /compact 在对话流里插入的「上下文已压缩」分隔标记。只读、纯 UI 标记。
  // content 存摘要正文（仅作发送侧上下文，不在 UI 展示）。不进入发送给 AI 的历史。
  divider?: boolean;
  // 分隔标记上显示的压缩信息：压缩前/后的估算 token，用于「省下 X」提示。
  compactInfo?: { before: number; after: number };
  // 内联错误提示：在对话流里以灰色小字展示的一条只读提示（API 报错/自动压缩等）。
  // 不进入发送给 AI 的历史，纯 UI。content 留空，文案放这里。
  errorNotice?: string;
  // 产生这条消息时**实际使用**的模型/供应商名（在轮次发起时定格）。历史消息据此渲染
  // 头像与名称，不随用户之后切换的模型而变。旧消息无此字段时回退到当前选择。
  modelName?: string;
  providerName?: string;
  // 本轮 assistant 回复的「思考原始数据」(回传必需,与思考气泡的可读展示解耦)。随会话
  // localStorage 持久化,跨轮重建(buildReplayMessages)后原样回传给 API——使会话重载后
  // 思考链不丢、推理模型多轮工具调用不报 400。thinking=Anthropic 扩展思考块(含 signature);
  // reasoning_content=OpenAI 推理系思考串。仅 assistant 消息携带,缺省=无。
  thinking?: ThinkingBlock[];
  reasoning_content?: string;
}

export type SessionPermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

// 一条排队中的用户输入。images=随消息一起发送的本地图片绝对路径（busy 时也可排队）。
export interface QueuedInput {
  text: string;
  images?: string[];
}

// 模型推理强度（reasoning effort）。透传到 OpenAI 兼容的 reasoning_effort 字段，
// 不支持的端点会忽略。undefined → 跟随端点默认（不发送该字段）。
export type SessionEffort = "minimal" | "low" | "medium" | "high";

// 一条待办项（agent 通过 update_todos 工具维护，UI 顶部路线图渲染）。
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export interface ChatSession {
  id: string;
  name: string;
  /** Provider id this session uses (stable across renames). Older sessions saved
   *  before this field exists fall back to matching `provider` (name) at use time. */
  providerId?: string;
  provider: string;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  // Per-session permission mode override (higher priority than global config).
  // Undefined → follow the global config mode.
  permissionMode?: SessionPermissionMode;
  // 纯聊天模式（/chat）：开启后该会话不主动调查项目——系统提示去掉「先读代码库」
  // 等引导，默认直接对话。工具仍然保留（需要时可用），只是不主动伸手读项目。
  chatMode?: boolean;
  // 文字游戏模式（/game）：开启后进入 AI RPG——系统提示要求按「正文 + 角色卡/背景/
  // 状态/物品/地点 折叠块 + 末尾 ask_followup_question 给预设行动选项」的固定结构输出。
  // 与 chatMode 互斥。
  gameMode?: boolean;
  // 模型推理强度（/effort）。undefined → 不发送 reasoning_effort，跟随端点默认。
  effort?: SessionEffort;
  // 扩展思考（/think，仅 Anthropic 端点）。true → 请求体注入 thinking 参数，模型
  // 回传思考摘要，在对话流里以可折叠思考气泡展示。undefined/false → 不发送。
  thinkingMode?: boolean;
  // Latest to-do roadmap (from update_todos). Persisted so it survives restarts
  // and reminds the user where the last run left off.
  todos?: TodoItem[];
  // 上下文压缩（/compact）：发送侧摘要 + 摘要覆盖到的最后一条消息 id。
  // 仅影响发往 AI 的历史（runTurn 用「摘要 + 该消息之后的对话」代替全量），
  // UI 上的完整对话不受影响、一条不删。
  contextSummary?: string;
  summaryUpTo?: string;
  // 会话累计 token 用量（真实优先，估算兜底）。落盘，供 Analytics 聚合真实数据。
  // cacheCreate/cacheRead：provider 在 usage 里返回的缓存 token（采集自已有响应，零成本）。
  usageTotals?: { promptTokens: number; completionTokens: number; turns: number; estimated?: boolean; cacheCreate?: number; cacheRead?: number };
}

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  selectedProviderId: string;
  setSelectedProviderId: (id: string) => void;
  isProcessing: boolean;

  // The project these sessions belong to (drives disk persistence path).
  projectPath: string | null;

  // Per-session FIFO queue of pending user inputs (Roo-Code style).
  // 队列项带可选 images：busy 时带图片附件的消息也能排队，而不是被拒绝。
  queues: Record<string, QueuedInput[]>;

  // Pending interactive requests, keyed by sessionId — kept in the store (not
  // component state) so switching tabs / unmounting ChatView never loses them
  // (which would leave the backend promise hanging forever).
  pendingApproval: Record<string, { callId: string; tool: string; permTool: string; input: any }>;
  pendingFollowup: Record<string, { callId: string; questions: { question: string; options?: string[] }[]; plan?: string }>;
  setPendingApproval: (sessionId: string, v: { callId: string; tool: string; permTool: string; input: any } | null) => void;
  setPendingFollowup: (sessionId: string, v: { callId: string; questions: { question: string; options?: string[] }[]; plan?: string } | null) => void;

  // ── 角标系统（瞬态，不落盘）──
  // sessionCompleted：会话「本轮任务完成」灰色勾角标。设为 true 后在历史列表显示，
  // 用户「读」了该会话（切到它为活动会话）即清除（已阅即消，区别于问号角标需行动才消）。
  sessionCompleted: Record<string, boolean>;
  setSessionCompleted: (sessionId: string, v: boolean) => void;
  // badgeUnread：当任意会话出现「新角标」（完成勾 / 问号 / 失败）时置位，驱动「历史
  // 对话」按钮左上角的紫色未读点。用户点开历史对话列表即清（不论角标是否还在）。
  badgeUnread: boolean;
  markBadgeUnread: () => void;
  clearBadgeUnread: () => void;
  // generating：会话「正在生成」指示。value=最近一次进展的时间戳（ms）。列表里
  // 据此渲染转圈角标，并按「now - 该时间戳」在 0→genTimeout 内由紫确定性插值到红；
  // 每次有新消息回传时把它刷新为 now（颜色回紫）。结束（done / 停止 / 失败）时删除。
  generating: Record<string, number>;
  // genTimeout：该会话本轮的超时上限（ms）。agent 轮次 90s，直接出图 120s。心跳据此
  // 判超时、颜色据此算红度。随 setGenerating 一起设/清。
  genTimeout: Record<string, number>;
  setGenerating: (sessionId: string, ts: number | null, timeoutMs?: number) => void;
  // sessionFailed：超时或失败终止的红色感叹号角标。读该会话或新一轮开始即清。
  sessionFailed: Record<string, boolean>;
  setSessionFailed: (sessionId: string, v: boolean) => void;

  // Update a session's to-do roadmap (from update_todos). Each call replaces the
  // whole list; persisted with the session so it survives restarts.
  setSessionTodos: (sessionId: string, todos: TodoItem[]) => void;

  // 每会话最近一轮的 token 用量（瞬态，不落盘）。来自 agent:turn 的 usage 字段。
  // estimated=true 表示 provider 未返回 usage、由本地分词器估算（UI 标「~」）。
  // contextTokens=最近一次 LLM 往返的输入占用（含 cache），用于窗口将满告警/自动压缩。
  // cacheCreate/cacheRead=最近一次往返的缓存写/读 token（算缓存命中率：cacheRead/contextTokens）。
  // breakdown=按真实请求字符占比把精确 contextTokens 分摊成 system/工具/历史（/context 精确展示）。
  sessionUsage: Record<string, { promptTokens: number; completionTokens: number; contextTokens?: number; estimated?: boolean; cacheCreate?: number; cacheRead?: number; breakdown?: { systemTok: number; toolsTok: number; historyTok: number } }>;
  setSessionUsage: (sessionId: string, usage: { promptTokens: number; completionTokens: number; contextTokens?: number; estimated?: boolean; cacheCreate?: number; cacheRead?: number; turnCacheRead?: number; breakdown?: { systemTok: number; toolsTok: number; historyTok: number } } | null) => void;

  // 把一轮的 token 用量累加到会话累计并落盘（done 时调用，供 Analytics 聚合）。
  addTurnUsage: (sessionId: string, usage: { promptTokens: number; completionTokens: number; estimated?: boolean; cacheCreate?: number; cacheRead?: number }) => void;

  // 压缩上下文：设置「发送侧摘要」+ 在对话流追加一条只读分隔标记。UI 完整对话
  // 保留不动。后续 runTurn 拼历史时用「摘要 + 摘要之后的新消息」代替全量历史，
  // 降低真正发往 AI 的 token。对标 Claude Code 的 /compact（压的是上下文，不是记录）。
  compactSession: (sessionId: string, summary: string, info?: { before: number; after: number }) => void;
  // 在对话流追加一条只读的灰色错误/状态提示（不发往 AI，纯 UI）。
  addNotice: (sessionId: string, text: string) => void;

  // 每会话的检查点列表（影子 git 快照，瞬态）。最近在前。
  sessionCheckpoints: Record<string, { id: string; message: string; timestamp: number }[]>;
  addCheckpoint: (sessionId: string, cp: { id: string; message: string; timestamp: number }) => void;

  // 生图工具（generate_image）出图后，把本地图片路径写入对应工具消息（按 toolCall.id）。
  // 渲染层据此在工具气泡里内联显示图片；随 toolCall 一起落盘持久化。
  setToolImages: (sessionId: string, toolCallId: string, paths: string[]) => void;

  // 按 id 局部更新一条消息并落盘（合并 patch）。直接出图用它把占位 assistant 消息
  // 填上正文与图片，避免裸 setState 不持久化。
  updateMessage: (sessionId: string, msgId: string, patch: Partial<ChatMessage>) => void;

  // Search → jump: ChatView scrolls to & highlights this message id, then clears it.
  scrollToMessageId: string | null;
  setScrollToMessageId: (id: string | null) => void;

  createSession: (provider: string, model: string, providerId?: string) => string;
  renameSession: (id: string, name: string) => void;
  /** Switch the provider/model bound to one session (per-session model selection). */
  setSessionModel: (id: string, providerId: string, providerName: string, model: string) => void;
  setSessionPermissionMode: (id: string, mode: SessionPermissionMode) => void;
  setSessionChatMode: (id: string, chatMode: boolean) => void;
  setSessionGameMode: (id: string, gameMode: boolean) => void;
  setSessionEffort: (id: string, effort: SessionEffort | undefined) => void;
  setSessionThinking: (id: string, thinkingMode: boolean) => void;
  deleteSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  addMessage: (sessionId: string, msg: ChatMessage) => void;
  getActiveSession: () => ChatSession | undefined;
  setIsProcessing: (v: boolean) => void;

  // Disk persistence (one JSONL per session, grouped by project).
  loadFromDisk: (projectPath: string) => Promise<void>;
  deleteMessage: (sessionId: string, msgId: string) => void;
  truncateAfter: (sessionId: string, msgId: string) => void;

  // Apply an authoritative turn snapshot from the backend. The backend owns the
  // assistant/tool message list; the renderer just replaces the runId block.
  // `stamp` records the model/provider actually used for this run so历史消息渲染
  // 时锁定当时的模型，不随之后切换而改变。
  applyTurn: (sessionId: string, runId: string, msgs: Array<{
    id: string; role: "assistant" | "tool"; content: string; partial: boolean;
    toolCall?: { id?: string; name: string; input: any; output?: string; approved?: boolean; images?: string[] };
    thinking?: ThinkingBlock[]; reasoning_content?: string;
  }>, done: boolean, stamp?: { modelName?: string; providerName?: string }) => void;

  // 增量帧：把 append 文本追加到 runId 块里 id 对应消息的「流式文本」（assistant→
  // content，思考气泡→toolCall.output）。找不到该 id 则忽略（等下一次全量快照补齐）。
  // 纯性能路径，叠加在 applyTurn 全量快照之上；全量永远是兜底真相源。
  appendTurnDelta: (sessionId: string, runId: string, id: string, append: string) => void;

  // Queue ops
  enqueue: (sessionId: string, text: string, images?: string[]) => void;
  dequeue: (sessionId: string) => QueuedInput | undefined;
  removeQueued: (sessionId: string, index: number) => void;

  // 每会话输入框草稿（瞬态，不落盘）。切标签页后组件卸载不丢失。
  inputDrafts: Record<string, string>;
  setInputDraft: (sessionId: string, text: string) => void;
}

let msgCounter = 0;
function genId() { return "msg-" + Date.now() + "-" + (++msgCounter); }
function genSessionId() { return "chat-" + Date.now() + "-" + (++msgCounter); }

// Strip transient fields and drop unfinished (streaming) messages before saving.
function toRecordSession(s: ChatSession) {
  return {
    id: s.id, name: s.name, providerId: s.providerId, provider: s.provider, model: s.model, createdAt: s.createdAt,
    permissionMode: s.permissionMode,
    chatMode: s.chatMode,
    gameMode: s.gameMode,
    effort: s.effort,
    thinkingMode: s.thinkingMode,
    todos: s.todos,
    contextSummary: s.contextSummary, summaryUpTo: s.summaryUpTo,
    usageTotals: s.usageTotals,
    messages: s.messages
      .filter((m) => !m.streaming)
      .map((m) => ({
        id: m.id, role: m.role, content: m.content, toolCall: m.toolCall,
        timestamp: m.timestamp, runId: m.runId, tokens: m.tokens, cost: m.cost,
        images: m.images, divider: m.divider, compactInfo: m.compactInfo,
        modelName: m.modelName, providerName: m.providerName,
        // 思考原始数据必须随磁盘持久化(此前白名单遗漏,导致关闭应用重开后思考链丢失:
        // Anthropic thinking 块含 signature、OpenAI reasoning_content)。落盘读写层
        // (chat-store-manager) 已 JSON.stringify/parse 原样透传,补进白名单即跨进程保真。
        thinking: m.thinking, reasoning_content: m.reasoning_content,
      })),
  };
}

// Debounced full-session rewrite. Coalesces rapid updates (streaming finishes,
// message edits) into one disk write per session.
const persistTimers: Record<string, any> = {};
function persistSession(projectPath: string | null, session: ChatSession | undefined): void {
  if (!projectPath || !session) return;
  const key = session.id;
  if (persistTimers[key]) clearTimeout(persistTimers[key]);
  persistTimers[key] = setTimeout(() => {
    delete persistTimers[key];
    try { (window as any).api?.writeChatSession?.(projectPath, toRecordSession(session)); } catch {}
  }, 300);
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  selectedProviderId: "",
  setSelectedProviderId: (id) => set({ selectedProviderId: id }),
  isProcessing: false,
  projectPath: null,
  queues: {},
  pendingApproval: {},
  pendingFollowup: {},
  scrollToMessageId: null,
  setScrollToMessageId: (id) => set({ scrollToMessageId: id }),

  sessionUsage: {},
  setSessionUsage: (sessionId, usage) => set((s) => {
    const next = { ...s.sessionUsage };
    if (usage) next[sessionId] = usage; else delete next[sessionId];
    return { sessionUsage: next };
  }),

  addTurnUsage: (sessionId, usage) => set((s) => {
    const sessions = s.sessions.map((ss) => {
      if (ss.id !== sessionId) return ss;
      const prev = ss.usageTotals || { promptTokens: 0, completionTokens: 0, turns: 0, cacheCreate: 0, cacheRead: 0 };
      return {
        ...ss,
        usageTotals: {
          promptTokens: prev.promptTokens + (usage.promptTokens || 0),
          completionTokens: prev.completionTokens + (usage.completionTokens || 0),
          cacheCreate: (prev.cacheCreate || 0) + (usage.cacheCreate || 0),
          cacheRead: (prev.cacheRead || 0) + (usage.cacheRead || 0),
          turns: prev.turns + 1,
          // 只要有一轮是估算的，整体标记为含估算。
          estimated: prev.estimated || usage.estimated,
        },
      };
    });
    persistSession(s.projectPath, sessions.find((ss) => ss.id === sessionId));
    return { sessions };
  }),

  compactSession: (sessionId, summary, info) => set((s) => {
    const sessions = s.sessions.map((ss) => {
      if (ss.id !== sessionId) return ss;
      // 边界 = 当前最后一条真实消息（不含将要追加的分隔标记本身）。
      const lastId = ss.messages.length ? ss.messages[ss.messages.length - 1].id : undefined;
      // 在对话流追加一条只读分隔标记（content 存摘要正文，仅作发送侧上下文）。
      const divider: ChatMessage = {
        id: genId(), role: "assistant", content: summary,
        timestamp: Date.now(), divider: true, compactInfo: info,
      };
      return {
        ...ss,
        contextSummary: summary,
        summaryUpTo: lastId,
        messages: [...ss.messages, divider],
      };
    });
    persistSession(s.projectPath, sessions.find((ss) => ss.id === sessionId));
    return { sessions };
  }),

  addNotice: (sessionId, text) => set((s) => {
    const sessions = s.sessions.map((ss) => {
      if (ss.id !== sessionId) return ss;
      const notice: ChatMessage = {
        id: genId(), role: "assistant", content: "",
        timestamp: Date.now(), errorNotice: text,
      };
      return { ...ss, messages: [...ss.messages, notice] };
    });
    persistSession(s.projectPath, sessions.find((ss) => ss.id === sessionId));
    return { sessions };
  }),

  sessionCheckpoints: {},
  addCheckpoint: (sessionId, cp) => set((s) => {
    const list = (s.sessionCheckpoints[sessionId] || []).slice();
    if (list.some((c) => c.id === cp.id)) return {} as any; // 去重
    list.unshift(cp);
    return { sessionCheckpoints: { ...s.sessionCheckpoints, [sessionId]: list.slice(0, 50) } };
  }),

  setToolImages: (sessionId, toolCallId, paths) => set((s) => {
    let changed = false;
    const sessions = s.sessions.map((ss) => {
      if (ss.id !== sessionId) return ss;
      const messages = ss.messages.map((m) => {
        if (m.toolCall && m.toolCall.id === toolCallId) {
          changed = true;
          return { ...m, toolCall: { ...m.toolCall, images: paths } };
        }
        return m;
      });
      return changed ? { ...ss, messages } : ss;
    });
    if (changed) persistSession(s.projectPath, sessions.find((ss) => ss.id === sessionId));
    return changed ? { sessions } : ({} as any);
  }),

  updateMessage: (sessionId, msgId, patch) => set((s) => {
    let changed = false;
    const sessions = s.sessions.map((ss) => {
      if (ss.id !== sessionId) return ss;
      const messages = ss.messages.map((m) => {
        if (m.id !== msgId) return m;
        changed = true;
        return { ...m, ...patch };
      });
      return changed ? { ...ss, messages } : ss;
    });
    if (changed) persistSession(s.projectPath, sessions.find((ss) => ss.id === sessionId));
    return changed ? { sessions } : ({} as any);
  }),

  setPendingApproval: (sessionId, v) => set((s) => {
    const next = { ...s.pendingApproval };
    if (v) next[sessionId] = v; else delete next[sessionId];
    // 紫点只提示「不在当前视野的会话有更新」：仅当更新的不是当前活动会话时点亮。
    const ping = v && s.activeSessionId !== sessionId;
    return { pendingApproval: next, badgeUnread: ping ? true : s.badgeUnread };
  }),
  setPendingFollowup: (sessionId, v) => set((s) => {
    const next = { ...s.pendingFollowup };
    if (v) next[sessionId] = v; else delete next[sessionId];
    const ping = v && s.activeSessionId !== sessionId;
    return { pendingFollowup: next, badgeUnread: ping ? true : s.badgeUnread };
  }),

  sessionCompleted: {},
  setSessionCompleted: (sessionId, v) => set((s) => {
    // 切到该会话为活动会话时不点亮勾（用户正在看，无需提醒）。
    if (v && s.activeSessionId === sessionId) return {} as any;
    const next = { ...s.sessionCompleted };
    if (v) next[sessionId] = true; else delete next[sessionId];
    return { sessionCompleted: next, badgeUnread: v ? true : s.badgeUnread };
  }),

  badgeUnread: false,
  markBadgeUnread: () => set({ badgeUnread: true }),
  clearBadgeUnread: () => set({ badgeUnread: false }),

  generating: {},
  genTimeout: {},
  setGenerating: (sessionId, ts, timeoutMs) => set((s) => {
    const next = { ...s.generating };
    const nextTo = { ...s.genTimeout };
    if (ts === null) {
      delete next[sessionId];
      delete nextTo[sessionId];
    } else {
      next[sessionId] = ts;
      // 刷新进度时保留已设的上限；首次设置（或显式传入）时写入，缺省 90s。
      if (timeoutMs != null) nextTo[sessionId] = timeoutMs;
      else if (nextTo[sessionId] == null) nextTo[sessionId] = 90000;
    }
    return { generating: next, genTimeout: nextTo };
  }),

  sessionFailed: {},
  setSessionFailed: (sessionId, v) => set((s) => {
    const next = { ...s.sessionFailed };
    if (v) next[sessionId] = true; else delete next[sessionId];
    // 紫点只提示非当前视野会话：当前活动会话失败，用户已能在视图里看到，不点亮。
    const ping = v && s.activeSessionId !== sessionId;
    return { sessionFailed: next, badgeUnread: ping ? true : s.badgeUnread };
  }),

  setSessionTodos: (sessionId, todos) => set((s) => {
    const sessions = s.sessions.map((ss) => (ss.id === sessionId ? { ...ss, todos } : ss));
    persistSession(s.projectPath, sessions.find((ss) => ss.id === sessionId));
    return { sessions };
  }),

  createSession: (provider, model, providerId) => {
    const id = genSessionId();
    const session: ChatSession = {
      id, name: "New Chat", providerId, provider, model,
      messages: [], createdAt: Date.now()
    };
    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionId: id,
    }));
    return id;
  },

  renameSession: (id, name) => set((s) => {
    const sessions = s.sessions.map((ss) => (ss.id === id ? { ...ss, name } : ss));
    persistSession(s.projectPath, sessions.find((ss) => ss.id === id));
    return { sessions };
  }),

  setSessionModel: (id, providerId, providerName, model) => set((s) => {
    const sessions = s.sessions.map((ss) =>
      (ss.id === id ? { ...ss, providerId, provider: providerName, model } : ss));
    persistSession(s.projectPath, sessions.find((ss) => ss.id === id));
    return { sessions };
  }),

  setSessionPermissionMode: (id, mode) => set((s) => {
    // 三模式互斥:plan 与 chat / game 不能同开。切到 plan 时一并关掉后两者,
    // 使所有调用点(/plan 命令、模型自主 enter_plan_mode、UI 下拉)都自动互斥。
    const patch = mode === "plan" ? { permissionMode: mode, chatMode: false, gameMode: false } : { permissionMode: mode };
    const sessions = s.sessions.map((ss) => (ss.id === id ? { ...ss, ...patch } : ss));
    persistSession(s.projectPath, sessions.find((ss) => ss.id === id));
    return { sessions };
  }),

  setSessionChatMode: (id, chatMode) => set((s) => {
    // 打开 chat 时,关掉 game、若当前在 plan 模式则切回 default(三模式互斥,防同开)。
    const sessions = s.sessions.map((ss) => {
      if (ss.id !== id) return ss;
      const next = { ...ss, chatMode };
      if (chatMode) {
        next.gameMode = false;
        if (ss.permissionMode === "plan") next.permissionMode = "default";
      }
      return next;
    });
    persistSession(s.projectPath, sessions.find((ss) => ss.id === id));
    return { sessions };
  }),

  setSessionGameMode: (id, gameMode) => set((s) => {
    // 打开 game 时,若当前在 plan 模式则切回 default(互斥,防同开)。
    const sessions = s.sessions.map((ss) => {
      if (ss.id !== id) return ss;
      const next = { ...ss, gameMode };
      if (gameMode) {
        next.chatMode = false;
        if (ss.permissionMode === "plan") next.permissionMode = "default";
      }
      return next;
    });
    persistSession(s.projectPath, sessions.find((ss) => ss.id === id));
    return { sessions };
  }),

  setSessionEffort: (id, effort) => set((s) => {
    const sessions = s.sessions.map((ss) => (ss.id === id ? { ...ss, effort } : ss));
    persistSession(s.projectPath, sessions.find((ss) => ss.id === id));
    return { sessions };
  }),

  setSessionThinking: (id, thinkingMode) => set((s) => {
    const sessions = s.sessions.map((ss) => (ss.id === id ? { ...ss, thinkingMode } : ss));
    persistSession(s.projectPath, sessions.find((ss) => ss.id === id));
    return { sessions };
  }),

  deleteSession: (id) => {
    const pp = get().projectPath;
    if (pp) { try { (window as any).api?.deleteChat?.(pp, id); } catch {} }
    set((s) => ({
      sessions: s.sessions.filter((ss) => ss.id !== id),
      activeSessionId: s.activeSessionId === id
        ? (s.sessions.find((ss) => ss.id !== id)?.id || null)
        : s.activeSessionId,
    }));
  },

  setActiveSession: (id) => set((s) => {
    // 读即消：切到某会话即清除它的「完成」灰勾与「失败」红叹号角标（问号角标不在
    // 此清，需用户行动）。
    const hasCompleted = !!s.sessionCompleted[id];
    const hasFailed = !!s.sessionFailed[id];
    if (!hasCompleted && !hasFailed) return { activeSessionId: id };
    const patch: any = { activeSessionId: id };
    if (hasCompleted) { const n = { ...s.sessionCompleted }; delete n[id]; patch.sessionCompleted = n; }
    if (hasFailed) { const n = { ...s.sessionFailed }; delete n[id]; patch.sessionFailed = n; }
    return patch;
  }),

  addMessage: (sessionId, msg) => set((s) => {
    const sessions = s.sessions.map((ss) => {
      if (ss.id !== sessionId) return ss;
      return { ...ss, messages: [...ss.messages, msg] };
    });
    persistSession(s.projectPath, sessions.find((ss) => ss.id === sessionId));
    return { sessions };
  }),

  loadFromDisk: async (projectPath) => {
    // Load once per project. Re-mounting ChatView (e.g. switching tabs and back)
    // must NOT overwrite in-memory sessions — a turn that's mid-flight (awaiting
    // a permission prompt, not yet persisted) would otherwise be wiped, leaving
    // only the user's already-saved messages.
    if (get().projectPath === projectPath && get().sessions.length > 0) return;
    let loaded: any[] = [];
    try { loaded = (await (window as any).api?.listChats?.(projectPath)) || []; } catch {}
    const sessions: ChatSession[] = loaded.map((s: any) => ({
      id: s.id, name: s.name || "Chat", providerId: s.providerId, provider: s.provider || "",
      model: s.model || "", createdAt: s.createdAt || Date.now(),
      permissionMode: s.permissionMode,
      chatMode: !!s.chatMode,
      gameMode: !!s.gameMode,
      effort: s.effort,
      thinkingMode: !!s.thinkingMode,
      todos: Array.isArray(s.todos) ? s.todos : undefined,
      contextSummary: s.contextSummary, summaryUpTo: s.summaryUpTo,
      usageTotals: s.usageTotals,
      messages: Array.isArray(s.messages) ? s.messages : [],
    }));
    set({
      projectPath,
      sessions,
      activeSessionId: sessions[0]?.id || null,
    });
  },

  deleteMessage: (sessionId, msgId) => set((s) => {
    const sessions = s.sessions.map((ss) => {
      if (ss.id !== sessionId) return ss;
      return { ...ss, messages: ss.messages.filter((m) => m.id !== msgId) };
    });
    persistSession(s.projectPath, sessions.find((ss) => ss.id === sessionId));
    return { sessions };
  }),

  truncateAfter: (sessionId, msgId) => set((s) => {
    const sessions = s.sessions.map((ss) => {
      if (ss.id !== sessionId) return ss;
      const idx = ss.messages.findIndex((m) => m.id === msgId);
      if (idx === -1) return ss;
      return { ...ss, messages: ss.messages.slice(0, idx) };
    });
    persistSession(s.projectPath, sessions.find((ss) => ss.id === sessionId));
    return { sessions };
  }),

  applyTurn: (sessionId, runId, msgs, done, stamp) => set((s) => {
    // 保留上一份同 runId 块里各工具消息的 images（生图事件单独写入，turn 快照不带
    // images；重建块时按 toolCall.id merge 回来，否则会被覆盖丢失）。
    const session = s.sessions.find((ss) => ss.id === sessionId);
    const prevImages: Record<string, string[]> = {};
    // 同 runId 块里上一份消息已盖的模型/供应商章。若本次 applyTurn 没带 stamp
    // （收尾/中断的尾随快照在 stamp 缓存被清后才到），用旧章兜底，避免把头像名字抹掉。
    let prevModelName: string | undefined;
    let prevProviderName: string | undefined;
    if (session) {
      for (const m of session.messages) {
        if (m.runId === runId && m.toolCall && m.toolCall.id && m.toolCall.images && m.toolCall.images.length) {
          prevImages[m.toolCall.id] = m.toolCall.images;
        }
        if (m.runId === runId) {
          if (prevModelName === undefined && m.modelName) prevModelName = m.modelName;
          if (prevProviderName === undefined && m.providerName) prevProviderName = m.providerName;
        }
      }
    }
    const stampModel = stamp?.modelName ?? prevModelName;
    const stampProvider = stamp?.providerName ?? prevProviderName;
    const mapped: ChatMessage[] = msgs.map((m) => {
      const tc = m.toolCall;
      const merged = tc
        ? { ...tc, images: tc.images || (tc.id ? prevImages[tc.id] : undefined) }
        : undefined;
      return {
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: Date.now(),
        streaming: !done && m.partial,
        runId,
        toolCall: merged,
        modelName: stampModel,
        providerName: stampProvider,
        // 思考原始数据随快照落库 → localStorage 持久化 → 跨轮重建回传(根治重载后思考链丢失)。
        thinking: m.thinking,
        reasoning_content: m.reasoning_content,
      };
    });
    const sessions = s.sessions.map((ss) => {
      if (ss.id !== sessionId) return ss;
      // Keep everything that isn't part of this run, then append the fresh block.
      // Since a run's messages are always contiguous at the tail, filtering by
      // runId and re-appending preserves order without index bookkeeping.
      const kept = ss.messages.filter((m) => m.runId !== runId);
      return { ...ss, messages: [...kept, ...mapped] };
    });
    // Persist once the turn is finalized (skip mid-stream snapshots).
    if (done) persistSession(s.projectPath, sessions.find((ss) => ss.id === sessionId));
    return { sessions };
  }),

  appendTurnDelta: (sessionId, runId, id, append) => set((s) => {
    if (!append) return {};
    const session = s.sessions.find((ss) => ss.id === sessionId);
    if (!session) return {};
    let hit = false;
    const messages = session.messages.map((m) => {
      if (m.id !== id || m.runId !== runId) return m;
      hit = true;
      // 思考气泡（role:tool + __thinking__）追加到 toolCall.output；其余追加到 content。
      // 新建对象（身份变）以触发 memo 刷新，与 applyTurn 重建块的语义一致。
      if (m.role === "tool" && m.toolCall && m.toolCall.name === "__thinking__") {
        return { ...m, toolCall: { ...m.toolCall, output: (m.toolCall.output || "") + append }, streaming: true };
      }
      return { ...m, content: (m.content || "") + append, streaming: true };
    });
    // 找不到该 id（增量先于全量到，或已被新全量替换）：忽略，等下次全量补齐。
    if (!hit) return {};
    const sessions = s.sessions.map((ss) => (ss.id === sessionId ? { ...ss, messages } : ss));
    return { sessions };
  }),

  getActiveSession: () => {
    const { sessions, activeSessionId } = get();
    return sessions.find((s) => s.id === activeSessionId);
  },

  setIsProcessing: (v) => set({ isProcessing: v }),

  enqueue: (sessionId, text, images) => set((s) => {
    const q = s.queues[sessionId] || [];
    const item: QueuedInput = { text, images: images && images.length ? images : undefined };
    return { queues: { ...s.queues, [sessionId]: [...q, item] } };
  }),

  dequeue: (sessionId) => {
    const q = get().queues[sessionId] || [];
    if (q.length === 0) return undefined;
    const [head, ...rest] = q;
    set((s) => ({ queues: { ...s.queues, [sessionId]: rest } }));
    return head;
  },

  removeQueued: (sessionId, index) => set((s) => {
    const q = s.queues[sessionId] || [];
    return { queues: { ...s.queues, [sessionId]: q.filter((_, i) => i !== index) } };
  }),

  inputDrafts: {},
  setInputDraft: (sessionId, text) => set((s) => ({
    inputDrafts: { ...s.inputDrafts, [sessionId]: text },
  })),
}));
