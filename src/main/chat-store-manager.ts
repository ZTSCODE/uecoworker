import { readFile, writeFile, appendFile, mkdir, readdir, rm } from "fs/promises";
import { join } from "path";
import { app } from "electron";
import { existsSync } from "fs";

/**
 * Disk persistence for chat sessions — one JSONL file per session, grouped by
 * project. Mirrors Claude Code (~/.claude/projects/<encoded>/<id>.jsonl) and
 * Codex (~/.codex/sessions/.../rollout-*.jsonl): the first line is session
 * metadata, each subsequent line is one message. Append-only on the hot path;
 * full rewrite only when messages are deleted/truncated.
 *
 * Layout: <userData>/chats/<encodedProjectPath>/<sessionId>.jsonl
 */

const LF = String.fromCharCode(10);

export interface ChatMessageRecord {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCall?: { id?: string; name: string; input: any; output?: string; approved?: boolean };
  timestamp: number;
  runId?: string;
  tokens?: number;
  cost?: number;
}

export interface ChatSessionMeta {
  id: string;
  name: string;
  provider: string;
  model: string;
  createdAt: number;
  // Optional per-session fields persisted in the meta header. Kept loosely typed
  // here (the renderer owns their shape); we just round-trip them verbatim.
  permissionMode?: string;
  todos?: any[];
  // 会话累计 token 用量（真实优先，估算兜底）。供 Analytics 聚合真实数据。
  usageTotals?: { promptTokens: number; completionTokens: number; turns: number; estimated?: boolean; cacheCreate?: number; cacheRead?: number };
}

export interface ChatSessionRecord extends ChatSessionMeta {
  messages: ChatMessageRecord[];
}

/** First-line marker distinguishing the meta header from message lines. */
interface MetaLine extends ChatSessionMeta { __type: "meta"; }

export class ChatStoreManager {
  private root: string;

  constructor() {
    this.root = join(app.getPath("userData"), "chats");
  }

  /** Encode a project path into a filesystem-safe directory name (Claude Code style). */
  private encodeProject(projectPath: string): string {
    return (projectPath || "default")
      .replace(/[\\/:]/g, "-")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
  }

  private projectDir(projectPath: string): string {
    return join(this.root, this.encodeProject(projectPath));
  }

  private sessionFile(projectPath: string, sessionId: string): string {
    return join(this.projectDir(projectPath), sessionId + ".jsonl");
  }

  private async ensureDir(projectPath: string): Promise<void> {
    const dir = this.projectDir(projectPath);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  /** Read all sessions for a project, newest first. */
  async listChats(projectPath: string): Promise<ChatSessionRecord[]> {
    const dir = this.projectDir(projectPath);
    if (!existsSync(dir)) return [];
    const sessions: ChatSessionRecord[] = [];
    let files: string[] = [];
    try { files = await readdir(dir); } catch { return []; }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      try {
        const raw = await readFile(join(dir, f), "utf-8");
        const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length === 0) continue;
        const head = JSON.parse(lines[0]);
        if (!head || head.__type !== "meta") continue;
        const messages: ChatMessageRecord[] = [];
        for (let i = 1; i < lines.length; i++) {
          try { messages.push(JSON.parse(lines[i])); } catch {}
        }
        sessions.push({
          id: head.id, name: head.name, provider: head.provider,
          model: head.model, createdAt: head.createdAt, messages,
          permissionMode: head.permissionMode,
          todos: Array.isArray(head.todos) ? head.todos : undefined,
          usageTotals: head.usageTotals,
        });
      } catch {}
    }
    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 轻量摘要：只解析每个会话文件的首行 meta + 统计消息行数，不反序列化每条消息。
   * 供 Analytics 聚合（它只用 meta.usageTotals 与 messageCount），避免把可能数 MB 的
   * 全部消息逐条 JSON.parse 进内存。messageCount 用「非空行数 - 1（meta 行）」近似，
   * 与原先 messages.length 等价（每条消息一行）。
   */
  async listSessionSummaries(projectPath: string): Promise<(ChatSessionMeta & { messageCount: number })[]> {
    const dir = this.projectDir(projectPath);
    if (!existsSync(dir)) return [];
    let files: string[] = [];
    try { files = await readdir(dir); } catch { return []; }
    const out: (ChatSessionMeta & { messageCount: number })[] = [];
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      try {
        const raw = await readFile(join(dir, f), "utf-8");
        const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length === 0) continue;
        const head = JSON.parse(lines[0]);
        if (!head || head.__type !== "meta") continue;
        out.push({
          id: head.id, name: head.name, provider: head.provider,
          model: head.model, createdAt: head.createdAt,
          permissionMode: head.permissionMode,
          todos: Array.isArray(head.todos) ? head.todos : undefined,
          usageTotals: head.usageTotals,
          messageCount: lines.length - 1,
        });
      } catch {}
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Append one finalized message; writes the meta header first if new. */
  async appendMessage(projectPath: string, meta: ChatSessionMeta, message: ChatMessageRecord): Promise<void> {
    await this.ensureDir(projectPath);
    const file = this.sessionFile(projectPath, meta.id);
    if (!existsSync(file)) {
      const metaLine: MetaLine = { __type: "meta", ...meta };
      await writeFile(file, JSON.stringify(metaLine) + LF, "utf-8");
    }
    await appendFile(file, JSON.stringify(message) + LF, "utf-8");
  }

  /** Rewrite an entire session file (used after delete/truncate). */
  async writeSession(projectPath: string, session: ChatSessionRecord): Promise<void> {
    await this.ensureDir(projectPath);
    const file = this.sessionFile(projectPath, session.id);
    const metaLine: MetaLine = {
      __type: "meta", id: session.id, name: session.name,
      provider: session.provider, model: session.model, createdAt: session.createdAt,
      permissionMode: session.permissionMode,
      todos: session.todos,
      usageTotals: session.usageTotals,
    };
    const lines = [JSON.stringify(metaLine)];
    for (const m of session.messages) lines.push(JSON.stringify(m));
    await writeFile(file, lines.join(LF) + LF, "utf-8");
  }

  async deleteChat(projectPath: string, sessionId: string): Promise<void> {
    const file = this.sessionFile(projectPath, sessionId);
    try { await rm(file, { force: true }); } catch {}
  }

  /**
   * 聚合一个项目下所有会话的真实 token 用量，供 Analytics 面板。
   * 数据来自 UE Coworker 自己的聊天记录（usageTotals，真实优先/估算兜底），
   * 不再读 Claude Code CLI 的日志目录（那与本应用无关）。
   */
  async analytics(projectPath: string): Promise<{
    totalSessions: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalCacheCreate: number;
    totalCacheRead: number;
    totalTokens: number;
    totalTurns: number;
    cacheHitRate: number; // 缓存读取 / (缓存读取 + 新增输入)，无缓存时为 0
    hasEstimated: boolean;
    byModel: { model: string; provider: string; promptTokens: number; completionTokens: number; cacheCreate: number; cacheRead: number; tokens: number; sessions: number; turns: number }[];
    sessions: { id: string; name: string; model: string; provider: string; createdAt: number; promptTokens: number; completionTokens: number; cacheCreate: number; cacheRead: number; tokens: number; turns: number; messageCount: number; estimated: boolean }[];
  }> {
    // 只读首行 meta + 行数，不解析每条消息（analytics 只需 usageTotals 与 messageCount）。
    const all = await this.listSessionSummaries(projectPath);
    let totalPrompt = 0, totalCompletion = 0, totalCacheCreate = 0, totalCacheRead = 0, totalTurns = 0, hasEstimated = false;
    const modelMap: Record<string, { model: string; provider: string; promptTokens: number; completionTokens: number; cacheCreate: number; cacheRead: number; tokens: number; sessions: number; turns: number }> = {};
    const sessions = all.map((s) => {
      const u = s.usageTotals || { promptTokens: 0, completionTokens: 0, turns: 0, estimated: false, cacheCreate: 0, cacheRead: 0 };
      const cc = u.cacheCreate || 0, cr = u.cacheRead || 0;
      totalPrompt += u.promptTokens; totalCompletion += u.completionTokens;
      totalCacheCreate += cc; totalCacheRead += cr; totalTurns += u.turns;
      if (u.estimated) hasEstimated = true;
      const key = (s.provider || "") + "/" + (s.model || "");
      if (!modelMap[key]) modelMap[key] = { model: s.model || "未知", provider: s.provider || "", promptTokens: 0, completionTokens: 0, cacheCreate: 0, cacheRead: 0, tokens: 0, sessions: 0, turns: 0 };
      const mm = modelMap[key];
      mm.promptTokens += u.promptTokens; mm.completionTokens += u.completionTokens;
      mm.cacheCreate += cc; mm.cacheRead += cr;
      mm.tokens += u.promptTokens + u.completionTokens; mm.sessions += 1; mm.turns += u.turns;
      return {
        id: s.id, name: s.name, model: s.model || "", provider: s.provider || "",
        createdAt: s.createdAt,
        promptTokens: u.promptTokens, completionTokens: u.completionTokens,
        cacheCreate: cc, cacheRead: cr,
        tokens: u.promptTokens + u.completionTokens, turns: u.turns,
        messageCount: s.messageCount, estimated: !!u.estimated,
      };
    });
    const byModel = Object.keys(modelMap).map((k) => modelMap[k]).sort((a, b) => b.tokens - a.tokens);
    // 命中率：缓存读取占「总输入」的比例。注意 promptTokens 已含 cache_read（OpenAI 规范
    // 中 cached_tokens 是 prompt_tokens 的子集；Anthropic 侧在 agent-loop 也已合成为含缓存的
    // 总输入），故分母就是 totalPrompt，不能再加一遍 cacheRead（否则双重计数，命中率最高只到 50%）。
    const denom = totalPrompt;
    const cacheHitRate = denom > 0 ? totalCacheRead / denom : 0;
    return {
      totalSessions: all.length,
      totalPromptTokens: totalPrompt,
      totalCompletionTokens: totalCompletion,
      totalCacheCreate, totalCacheRead,
      totalTokens: totalPrompt + totalCompletion,
      totalTurns,
      cacheHitRate,
      hasEstimated,
      byModel,
      sessions: sessions.sort((a, b) => b.createdAt - a.createdAt),
    };
  }

  /**
   * 跨会话关键词检索（供 agent 的 search_sessions 工具）。遍历所有项目目录下的
   * 会话 JSONL，对消息正文做大小写不敏感的字面匹配，返回命中片段。范围跨项目，
   * 让模型能在新会话里翻出以前任意项目聊过的内容（用户明确要跨项目）。
   * excludeSessionId 排除当前会话自身，避免把正在进行的对话搜回来。
   * 结果按会话创建时间倒序，最多 limit 个会话、每会话最多 perSession 条片段。
   */
  async searchAcrossSessions(
    query: string,
    opts?: { excludeSessionId?: string; limit?: number; perSession?: number }
  ): Promise<Array<{ sessionId: string; sessionName: string; project: string; createdAt: number; hits: Array<{ role: string; snippet: string; timestamp?: number }> }>> {
    const q = (query || "").trim().toLowerCase();
    if (!q) return [];
    const limit = opts?.limit ?? 10;
    const perSession = opts?.perSession ?? 5;
    const exclude = opts?.excludeSessionId;
    if (!existsSync(this.root)) return [];

    let projectDirs: string[] = [];
    try { projectDirs = await readdir(this.root); } catch { return []; }

    const results: Array<{ sessionId: string; sessionName: string; project: string; createdAt: number; hits: Array<{ role: string; snippet: string; timestamp?: number }> }> = [];
    for (const pd of projectDirs) {
      const dir = join(this.root, pd);
      let files: string[] = [];
      try { files = await readdir(dir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const sessionId = f.slice(0, -6);
        if (exclude && sessionId === exclude) continue;
        let raw: string;
        try { raw = await readFile(join(dir, f), "utf-8"); } catch { continue; }
        const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length === 0) continue;
        let meta: ChatSessionMeta | null = null;
        try { const h = JSON.parse(lines[0]); if (h && h.__type === "meta") meta = h; } catch {}
        const hits: Array<{ role: string; snippet: string; timestamp?: number }> = [];
        for (let i = 1; i < lines.length && hits.length < perSession; i++) {
          let msg: ChatMessageRecord;
          try { msg = JSON.parse(lines[i]); } catch { continue; }
          const text = String(msg.content || "");
          const idx = text.toLowerCase().indexOf(q);
          if (idx === -1) continue;
          // 截取命中处前后窗口，压成单行片段。
          const start = Math.max(0, idx - 80);
          const snippet = (start > 0 ? "…" : "") + text.slice(start, idx + q.length + 120).replace(/\s+/g, " ").trim() + "…";
          hits.push({ role: msg.role, snippet, timestamp: msg.timestamp });
        }
        if (hits.length > 0) {
          results.push({
            sessionId,
            sessionName: meta?.name || sessionId,
            project: pd,
            createdAt: meta?.createdAt || 0,
            hits,
          });
        }
      }
    }
    results.sort((a, b) => b.createdAt - a.createdAt);
    return results.slice(0, limit);
  }

  /**
   * 按 sessionId 读取一个会话（供 read_session 工具）。跨项目扫描，命中即返回。
   * 找不到返回 null。供工具层做截断/格式化，本方法只负责把 JSONL 反序列化为记录。
   */
  async readSessionById(sessionId: string): Promise<{ project: string; record: ChatSessionRecord } | null> {
    if (!existsSync(this.root)) return null;
    let projectDirs: string[] = [];
    try { projectDirs = await readdir(this.root); } catch { return null; }
    for (const pd of projectDirs) {
      const file = join(this.root, pd, sessionId + ".jsonl");
      if (!existsSync(file)) continue;
      let raw: string;
      try { raw = await readFile(file, "utf-8"); } catch { continue; }
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) continue;
      let head: any = null;
      try { head = JSON.parse(lines[0]); } catch {}
      if (!head || head.__type !== "meta") continue;
      const messages: ChatMessageRecord[] = [];
      for (let i = 1; i < lines.length; i++) {
        try { messages.push(JSON.parse(lines[i])); } catch {}
      }
      return {
        project: pd,
        record: {
          id: head.id, name: head.name, provider: head.provider, model: head.model,
          createdAt: head.createdAt, messages,
          permissionMode: head.permissionMode,
          todos: Array.isArray(head.todos) ? head.todos : undefined,
          usageTotals: head.usageTotals,
        },
      };
    }
    return null;
  }
}

// 单例：工具层（tools.ts）与 IPC 层（ipc-handlers.ts）共用同一实例，避免各自
// new 出多份、root 路径计算重复。ipc-handlers 仍可保留自己的 new（无状态、幂等）。
export const chatStoreManager = new ChatStoreManager();
