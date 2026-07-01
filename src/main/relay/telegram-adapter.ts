/**
 * TelegramAdapter —— Telegram 平台网关适配器（grammy，long polling）。
 *
 * Telegram 私聊默认收到用户全部文本、无 3 秒 ACK 限制、无特权 intent 概念，故体验比
 * Discord 顺：
 * - 直接发消息（不以 / 开头）= /ask，无需命令前缀。
 * - 提问有选项 → inline keyboard（callbackQuery）；无选项 → forceReply（用户回一条消息即可），
 *   省掉 Discord 的"按钮→Modal"两段式。
 * - 命令执行全部异步回主进程，靠 replyTo 关联结果后 editMessageText / 新发消息。
 */
import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { Context } from "grammy";
import type { RelayAdapter, AdapterHost } from "./adapter";
import type { RelayPrompt, RelayEmit } from "./protocol";
import { get as httpsGet } from "https";
import { createWriteStream } from "fs";
import { tmpdir } from "os";
import { join as pathJoin } from "path";

const MAX_TG = 4096;

// 命令清单 → Telegram 输入框 "/" 自动补全（既然能补全，就不再单设 /help）。
// Telegram 的命令弹层是「扁平列表」、原生不支持分组：这里用「按组排序 + 给描述加分类
// emoji 前缀」让同类命令在视觉上聚成块。顺序即展示顺序，分组前缀对齐。
const BOT_COMMANDS = [
  // 🧭 模式与行为
  { command: "mode", description: "🧭 模式 · 查看/切换权限模式" },
  { command: "plan", description: "🧭 模式 · 计划模式（只读）" },
  { command: "agent", description: "🧭 模式 · Agent 模式" },
  { command: "chat", description: "🧭 模式 · 纯聊天模式" },
  { command: "compact", description: "🧭 上下文 · 压缩降低 token" },
  // 🗂️ 会话与项目
  { command: "session", description: "🗂️ 会话 · 新建/列表/切换" },
  { command: "clear", description: "🗂️ 会话 · 新建空白对话" },
  { command: "project", description: "🗂️ 项目 · 切换/新建" },
  { command: "provider", description: "🔌 供应商 · 列出/切换模型" },
  // 🛠️ 工具
  { command: "file", description: "🛠️ 工具 · 读取/列出文件" },
  { command: "git", description: "🛠️ 工具 · Git 操作" },
  { command: "run", description: "🛠️ 工具 · 执行终端命令" },
  { command: "search", description: "🛠️ 工具 · 搜索项目文件" },
  { command: "status", description: "🛠️ 工具 · 查看软件状态" },
  // ✨ AI 任务
  { command: "init", description: "✨ 任务 · 生成项目指南" },
  { command: "explain", description: "✨ 任务 · 解释代码/模块" },
  { command: "fix", description: "✨ 任务 · 定位并修复 bug" },
  { command: "test", description: "✨ 任务 · 编写单元测试" },
  { command: "review", description: "✨ 任务 · 代码审查" },
  { command: "commit", description: "✨ 任务 · 生成提交信息" },
  // ⏹️ 控制
  { command: "stop", description: "⏹️ 控制 · 中止当前请求" },
];

// prompt 类命令的模板（与桌面 slash-commands.ts 对齐，作为 ask 提示词发送）。arg 为命令后的文本。
const PROMPT_TEMPLATES: Record<string, (arg: string) => string> = {
  init: () => "请分析当前项目并生成一份简洁的项目指南，写入仓库根目录的 UE-COWORKER.md 文件。内容包含：项目用途、技术栈、目录结构要点、构建/运行/测试命令、关键约定。先用工具浏览代码再动笔，已存在则更新而非覆盖无关内容。",
  explain: (a) => a ? "请解释 " + a + " 的工作原理：用途、关键流程、依赖关系，必要时读取相关文件。" : "请解释当前项目的整体架构与关键模块如何协作，先浏览代码再说明。",
  fix: (a) => a ? "请定位并修复以下问题：" + a + "。先复现/定位根因，再做最小改动，最后说明修复点。" : "请检查项目中的明显错误并修复，先定位根因再做最小改动。",
  test: (a) => (a ? "请为 " + a + " 编写单元测试。" : "请为关键模块补充单元测试。") + "遵循项目已有的测试框架与风格，先查看现有测试再编写。",
  review: (a) => (a ? "请审查 " + a + "。" : "请审查最近改动的代码。") + "关注正确性、边界条件、安全与性能问题，按优先级列出并给出具体修改建议。",
  commit: () => "请用 run_command 执行 `git status` 和 `git diff` 查看当前改动，然后总结改动并生成一条符合 Conventional Commits 规范的提交信息（英文）。先展示给我确认，不要自动提交。",
};

/**
 * 把 AI 输出的 Markdown 轻量转成 Telegram 支持的 HTML 子集，让粗体/代码/标题等正确渲染。
 * Telegram 的 HTML 只认少数标签：<b> <i> <u> <s> <code> <pre> <a>。
 * 用 HTML（而非 MarkdownV2）是因为只需转义 < > &，对 AI 自由文本远比 MarkdownV2 稳妥
 * （后者 . ! - ( ) 等都要转义，漏一个整条消息发送失败）。失败时调用方回落纯文本。
 */
function mdToHtml(src: string): string {
  // 先抽出代码块/行内代码，避免里面的 Markdown 符号被二次处理。哨兵用纯 ASCII token，
  // 正文不可能出现。
  const stash: string[] = [];
  const hold = (html: string) => { stash.push(html); return "@@CW" + (stash.length - 1) + "WC@@"; };
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let t = src;
  // 围栏代码块 ```lang\n...```
  t = t.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_m, code) => hold("<pre>" + esc(code.replace(/\n$/, "")) + "</pre>"));
  // 行内代码 `...`
  t = t.replace(/`([^`\n]+)`/g, (_m, code) => hold("<code>" + esc(code) + "</code>"));

  // 转义其余正文的 HTML 特殊字符。
  t = esc(t);

  // 标题 # ～ ###### → 粗体（Telegram 无标题概念）。
  t = t.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  // 粗体 **x** / __x__
  t = t.replace(/\*\*([^\n*]+)\*\*/g, "<b>$1</b>").replace(/__([^\n_]+)__/g, "<b>$1</b>");
  // 斜体 *x* / _x_（避开已配对的 **，上一步已消费）
  t = t.replace(/(^|[^*])\*([^\n*]+)\*(?!\*)/g, "$1<i>$2</i>");
  t = t.replace(/(^|[^_])_([^\n_]+)_(?!_)/g, "$1<i>$2</i>");
  // 删除线 ~~x~~
  t = t.replace(/~~([^\n~]+)~~/g, "<s>$1</s>");
  // 链接 [text](url)
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  // 列表符号 - / * 开头 → •（仅行首）
  t = t.replace(/^[ \t]*[-*]\s+/gm, "• ");

  // 还原代码占位。
  t = t.replace(/@@CW(\d+)WC@@/g, (_m, i) => stash[Number(i)] || "");
  return t;
}

export class TelegramAdapter implements RelayAdapter {
  private host: AdapterHost;
  private bot: Bot | null = null;
  private allowedUserId = "";
  private seq = 0;
  // 保存 token/config 供断线自动重连。
  private token = "";
  private config: Record<string, any> = {};
  private online = false;
  private wantConnected = false;        // 是否应保持连接（disconnect 时置 false，阻止自动重连）
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // replyTo -> { chatId, statusMsgId }：发命令时先回一条"处理中"占位，结果到达后编辑它。
  private pendingReplies = new Map<string, { chatId: number; msgId: number }>();
  // promptId -> 处理中的提问上下文（用于 cancel 撤回）。
  private prompts = new Map<string, {
    chatId: number;
    msgId: number;          // 提问消息 id
    mode: "choice" | "text";
    options?: string[];
    settle: (answer: string) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  // chatId -> 等待 forceReply 文本答复的 promptId（一个 chat 同时只挂一个自由文本提问）。
  private awaitingText = new Map<number, string>();
  // chatId -> 等待"下一条文本作为某命令参数"的上下文（实现"斜杠命令不接内容、分步交互"）。
  // 例如 /run 后发命令、/git commit 后发提交信息、/provider 后回数字切换。
  private pendingInput = new Map<number, { kind: string }>();
  // 菜单项值的短 id 映射（Telegram callback_data 上限 64 字节，长路径放不下，故用短 id 间接）。
  private menuValues = new Map<string, string>();
  private menuSeq = 0;
  // chatId -> 新建项目时选定的父目录（等用户回复文件夹名）。
  private newProjectBase = new Map<number, string>();
  // chatId -> 活跃 ask 一轮的进度消息：工具调用/todo 累积编辑进这一条（不刷屏）。
  // Telegram 对 editMessageText 限速（~1 次/秒/消息），故用去抖合并：累积内容后
  // 最多每 1.5s flush 一次，避免 429 把更新全吞掉（这正是"看不到实时更新"的根因）。
  // 最终答到达后作为新消息发在其后（进度在前、答案在后）。
  private activeProgress = new Map<number, {
    replyTo: string; msgId: number;
    tools: string[];          // 工具调用行（保留最近若干条）
    todos: string;            // 最近一次 todo 块（整块替换）
    dirty: boolean;           // 有未 flush 的变更
    flushTimer: ReturnType<typeof setTimeout> | null;
    lastBody: string;         // 上次已发送的正文，去重避免 "not modified"
    userMsgId: number;        // 触发本轮的用户消息 id（用于表情回应状态）
    working: boolean;         // 是否已打"处理中 ✍️"表情（首条进度时打一次）
  }>();
  // chatId -> 置顶状态栏消息：维护一条 pin 的「项目/模型/模式」面板，变更时编辑。
  private boards = new Map<number, { msgId: number; last: string }>();

  constructor(host: AdapterHost) { this.host = host; }

  async connect(token: string, config: Record<string, any>): Promise<void> {
    this.token = token;
    this.config = config || {};
    this.allowedUserId = String(config.allowedUserId || "");
    this.wantConnected = true;
    await this.startBot();
    this.startHeartbeat();
  }

  // 实际起 bot（首连与自动重连共用）。
  private async startBot(): Promise<void> {
    this.host.emit({ type: "status", source: "telegram", status: "connecting" });
    try {
      // 先停掉旧实例（重连场景）。
      if (this.bot) { try { await this.bot.stop(); } catch { /* ignore */ } this.bot = null; }
      this.bot = new Bot(this.token);
      this.bot.catch((err) => {
        // grammy 运行期错误：标记错误并触发重连（轮询可能已断）。
        this.online = false;
        this.host.emit({ type: "status", source: "telegram", status: "error", error: String((err as any)?.message || err) });
        this.scheduleReconnect();
      });
      this.registerHandlers(this.bot);
      this.bot.api.setMyCommands(BOT_COMMANDS).catch(() => {});
      // start() 持续轮询不 resolve，故不 await；onStart 标在线。
      this.bot.start({
        onStart: (info) => {
          this.online = true;
          this.host.emit({ type: "status", source: "telegram", status: "online", botTag: info.username });
        },
      }).catch((err: any) => {
        this.online = false;
        this.host.emit({ type: "status", source: "telegram", status: "error", error: String(err?.message || err) });
        this.scheduleReconnect();
      });
    } catch (err: any) {
      this.online = false;
      this.host.emit({ type: "status", source: "telegram", status: "error", error: err?.message || String(err) });
      this.scheduleReconnect();
    }
  }

  // 心跳：每 30s 用 getMe 探活；失败即标错误并重连。让电脑端能实时反映断线。
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (!this.wantConnected || !this.bot) return;
      this.bot.api.getMe().then(() => {
        if (!this.online) {
          this.online = true;
          this.host.emit({ type: "status", source: "telegram", status: "online" });
        }
      }).catch(() => {
        if (this.online) {
          this.online = false;
          this.host.emit({ type: "status", source: "telegram", status: "error", error: "心跳失败，连接可能已断，正在重连…" });
        }
        this.scheduleReconnect();
      });
    }, 30 * 1000);
  }
  private stopHeartbeat(): void {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
  }

  // 自动重连：去抖，5s 后重起 bot（仅在仍希望连接时）。
  private scheduleReconnect(): void {
    if (!this.wantConnected || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantConnected) this.startBot().catch(() => {});
    }, 5 * 1000);
  }

  async disconnect(): Promise<void> {
    this.wantConnected = false;
    this.online = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    try { await this.bot?.stop(); } catch { /* ignore */ }
    this.bot = null;
    for (const p of this.prompts.values()) { clearTimeout(p.timer); p.settle(""); }
    this.prompts.clear();
    this.awaitingText.clear();
    this.pendingReplies.clear();
    for (const p of this.activeProgress.values()) { if (p.flushTimer) clearTimeout(p.flushTimer); }
    this.activeProgress.clear();
    this.boards.clear();
    this.host.emit({ type: "status", source: "telegram", status: "offline" });
  }

  private userOk(uid?: number): boolean {
    return !this.allowedUserId || String(uid) === this.allowedUserId;
  }

  private registerHandlers(bot: Bot): void {
    // 选项提问的回调（inline keyboard）。不匹配 fu: 的放行给下游 cmd: 菜单回调。
    bot.on("callback_query:data", async (ctx, next) => {
      if (!this.userOk(ctx.from?.id)) { await ctx.answerCallbackQuery("⛔ 无权限").catch(() => {}); return; }
      const data = ctx.callbackQuery.data || "";
      // 已决定的卡片留了一枚 noop 按钮（仅作状态展示），点它只回个轻提示。
      if (data === "noop") { await ctx.answerCallbackQuery("已处理").catch(() => {}); return; }
      const m = /^fu:([^:]+):(\d+)$/.exec(data);
      if (!m) { await next(); return; }
      const promptId = m[1];
      const idx = parseInt(m[2], 10);
      const p = this.prompts.get(promptId);
      if (!p || p.mode !== "choice") { await ctx.answerCallbackQuery("已失效").catch(() => {}); return; }
      const answer = (p.options || [])[idx] || "";
      await ctx.answerCallbackQuery("✅ " + answer.slice(0, 180)).catch(() => {});
      // 保留问题正文，只把按钮换成"✅ 已选择：X"的状态按钮（不再覆盖整段问题）。
      this.markPromptDecided(p, "✅ 已选择：" + answer);
      this.resolvePrompt(promptId, answer);
    });

    // 文本消息：可能是自由文本提问的答复、斜杠命令、或直接提问。
    // 注意 grammy 按注册顺序执行中间件：本处理器在 command 之前，遇到斜杠命令必须
    // await next() 放行给下游 command 处理器，否则斜杠命令永远收不到。
    bot.on("message:text", async (ctx, next) => {
      if (!this.userOk(ctx.from?.id)) { await ctx.reply("⛔ 你没有权限使用此 Bot。").catch(() => {}); return; }
      const chatId = ctx.chat.id;
      const text = ctx.message.text || "";

      // 1) 若该 chat 正等待自由文本答复 → 当作答复（无论是否 reply 引用）。
      const waitId = this.awaitingText.get(chatId);
      if (waitId) {
        const p = this.prompts.get(waitId);
        if (p) this.markPromptDecided(p, p.mode === "choice" ? "✅ 已选择：" + text : "✅ 已回答");
        this.resolvePrompt(waitId, text);
        return;
      }

      // 2) 若某命令正等参数（如 /run 后的命令、/provider 后的数字）→ 用本条消息作参数。
      const pend = this.pendingInput.get(chatId);
      if (pend && !text.startsWith("/")) {
        const arg = text.trim();
        if (arg) {
          this.pendingInput.delete(chatId);
          await this.runPending(ctx, pend.kind, arg);
          return;
        }
      }

      // 3) 斜杠命令 → 放行给下游 command 处理器。
      if (text.startsWith("/")) { await next(); return; }

      // 4) 直接发消息 = 提问。
      await this.dispatchAsk(ctx, text);
    });

    // 菜单按钮回调：cmd:<kind>:<value>。value 可能是短 id（#n），先还原成真实值。
    bot.on("callback_query:data", async (ctx, next) => {
      if (!this.userOk(ctx.from?.id)) { return; }
      const data = ctx.callbackQuery.data || "";
      const m = /^cmd:([^:]+):(.*)$/.exec(data);
      if (!m) { await next(); return; }
      await ctx.answerCallbackQuery().catch(() => {});
      // 点了按钮即视为已用按钮作答：清掉「下一条消息当数字/参数回复」的待输入态。
      // 否则像 /provider、/mode 这类先登记数字回退、再弹按钮的命令，用户点完按钮后
      // 随便发一条消息会被误当成数字选择。runPending 内若还需后续参数会自行重新登记。
      const cbChatId = ctx.chat?.id;
      if (cbChatId != null) this.pendingInput.delete(cbChatId);
      await this.runPending(ctx, m[1], this.resolveVal(m[2]));
    });

    // 斜杠命令（去掉 /ask：直接发消息即提问）。所有需要参数的命令都不再接内容，
    // 而是弹菜单（点按钮）或提示回复（发一条消息）——见 runPending / askParam / showMenu。

    // 图片/文件入站：手机发图/文件 → 下载到本地 → 作为带图的 ask 交给 AI（vision）。
    bot.on(["message:photo", "message:document"], async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      try {
        const file = await ctx.getFile();             // 取 file_path
        const path = await this.downloadFile(file.file_path || "");
        if (!path) { await ctx.reply("⚠️ 文件下载失败。"); return; }
        const caption = (ctx.message?.caption || "").trim();
        const isImage = !!ctx.message?.photo || /\.(png|jpe?g|gif|webp|bmp)$/i.test(path);
        if (isImage) {
          const prompt = caption || "请看这张图片。";
          await this.dispatchCommand(ctx, { kind: "ask", prompt, images: [path] }, "🖼️ 已收到图片，处理中…");
        } else {
          // 非图片文件：把路径作为引用，让 AI 用 read_file 读。
          const prompt = (caption ? caption + "\n\n" : "") + "我上传了一个文件，路径：" + path + "，请按需读取处理。";
          await this.dispatchCommand(ctx, { kind: "ask", prompt }, "📎 已收到文件，处理中…");
        }
      } catch (e: any) {
        await ctx.reply("⚠️ 处理文件出错：" + (e?.message || String(e))).catch(() => {});
      }
    });

    bot.command("stop", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      await this.dispatchCommand(ctx, { kind: "session", op: "switch", arg: "__stop__" }, "🛑 处理中…");
    });
    bot.command("status", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      await this.dispatchCommand(ctx, { kind: "tool", tool: "status", args: {} }, "📊 查询中…");
    });
    bot.command("plan", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      await this.dispatchCommand(ctx, { kind: "mode", mode: "plan" }, "🔐 处理中…");
    });
    bot.command("clear", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      await this.dispatchCommand(ctx, { kind: "session", op: "new" }, "🆕 新建会话…");
    });
    bot.command("compact", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      await this.dispatchCommand(ctx, { kind: "ui", op: "compact" }, "🗜️ 压缩中…");
    });
    bot.command("chat", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      await this.dispatchCommand(ctx, { kind: "ui", op: "chat" }, "💬 处理中…");
    });
    bot.command("agent", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      await this.dispatchCommand(ctx, { kind: "ui", op: "agent" }, "🤖 处理中…");
    });
    // /provider /mode：列出后既可点按钮、也可直接回数字（runPending 处理）。
    bot.command("provider", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      this.pendingInput.set(ctx.chat.id, { kind: "provider.switch" });
      await this.dispatchCommand(ctx, { kind: "provider", op: "list" }, "🧩 处理中…");
    });
    bot.command("mode", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      this.pendingInput.set(ctx.chat.id, { kind: "mode.set" });
      await this.dispatchCommand(ctx, { kind: "mode" }, "🔐 处理中…");
    });
    // /session：弹「新建 / 列表 / 切换」菜单。
    bot.command("session", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      await this.showMenu(ctx, "🗂️ 会话操作", [
        ["session.new", "🆕 新建"], ["session.list", "📋 列表"], ["session.switch", "🔀 切换"],
      ]);
    });
    // /run /search：提示回复内容（不接在命令后）。
    bot.command("run", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      await this.askParam(ctx, "run", "⚙️ 请回复要执行的终端命令：");
    });
    bot.command("search", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      await this.askParam(ctx, "search", "🔍 请回复要搜索的关键词：");
    });
    // /file：弹「读取 / 列目录」菜单。
    bot.command("file", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      await this.showMenu(ctx, "📁 文件操作", [["file.read", "📄 读取文件"], ["file.list", "📂 列目录"]]);
    });
    // /git：弹子命令菜单。
    bot.command("git", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      await this.showMenu(ctx, "🔧 Git 操作", [
        ["git.status", "status"], ["git.log", "log"], ["git.commit", "commit"],
        ["git.push", "push"], ["git.pull", "pull"], ["git.branches", "branches"], ["git.checkout", "checkout"],
      ]);
    });
    // /project：切换项目（最近 / 新建）——见 showProjectMenu。
    bot.command("project", async (ctx) => {
      if (!this.userOk(ctx.from?.id)) return;
      await this.showProjectRoot(ctx);
    });

    // prompt 类命令：展开为提示词作为 ask 发送（与桌面 slash-commands 对齐）。
    for (const name of Object.keys(PROMPT_TEMPLATES)) {
      bot.command(name, async (ctx) => {
        if (!this.userOk(ctx.from?.id)) return;
        const arg = (ctx.match || "").trim();
        await this.dispatchAsk(ctx, PROMPT_TEMPLATES[name](arg));
      });
    }
  }

  // 弹一个 inline keyboard 菜单（每项 cmd:<kind>:<value>），点按钮即触发 runPending。
  private async showMenu(ctx: Context, title: string, items: [string, string][]): Promise<void> {
    const kb = new InlineKeyboard();
    items.forEach(([val, label], i) => { kb.text(label, "cmd:menu:" + this.shortVal(val)); if (i % 2 === 1) kb.row(); });
    await ctx.reply(title, { reply_markup: kb }).catch(() => {});
  }

  // callback_data 上限 64 字节：短值直接用，长值（如长路径）存映射、用 #n 占位。
  private shortVal(val: string): string {
    if (val.length <= 40) return val;
    const id = "#" + (this.menuSeq++);
    this.menuValues.set(id, val);
    // 限制映射规模，避免无限增长。
    if (this.menuValues.size > 500) { const first = this.menuValues.keys().next().value; if (first) this.menuValues.delete(first); }
    return id;
  }
  private resolveVal(v: string): string {
    if (v.startsWith("#")) return this.menuValues.get(v) || v;
    return v;
  }

  // 提示用户回复一个参数（下一条文本作为 kind 的参数）。
  private async askParam(ctx: Context, kind: string, prompt: string): Promise<void> {
    this.pendingInput.set(ctx.chat!.id, { kind });
    await ctx.reply(prompt, { reply_markup: { force_reply: true } }).catch(() => {});
  }

  // 把分步交互的"菜单选择 / 回复参数"翻译成实际命令。kind 形如 "menu"(值是子项)、
  // "run"/"search"(自由文本)、"provider.switch"/"mode.set"(数字/名称)、"git.commit"(提交信息)等。
  private async runPending(ctx: Context, kind: string, value: string): Promise<void> {
    const v = (value || "").trim();
    // 菜单项：值本身是下一步的 kind（如 git.status / file.read / session.new）。
    if (kind === "menu") {
      if (v === "git.status" || v === "git.log" || v === "git.push" || v === "git.pull" || v === "git.branches") {
        const tool = "git." + v.split(".")[1];
        await this.dispatchCommand(ctx, { kind: "tool", tool, args: v.endsWith("log") ? { count: 10 } : {} }, "🔧 处理中…");
      } else if (v === "git.commit") {
        await this.askParam(ctx, "git.commit", "✍️ 请回复提交信息：");
      } else if (v === "git.checkout") {
        await this.askParam(ctx, "git.checkout", "🔀 请回复要切换到的分支名：");
      } else if (v === "file.read") {
        await this.askParam(ctx, "file.read", "📄 请回复要读取的文件路径（相对项目根）：");
      } else if (v === "file.list") {
        await this.askParam(ctx, "file.list", "📂 请回复要列出的目录（留空发「.」表示项目根）：");
      } else if (v === "session.new") {
        await this.dispatchCommand(ctx, { kind: "session", op: "new" }, "🆕 新建会话…");
      } else if (v === "session.list") {
        await this.dispatchCommand(ctx, { kind: "session", op: "list" }, "🗂️ 处理中…");
      } else if (v === "session.switch") {
        this.pendingInput.set(ctx.chat!.id, { kind: "session.switch" });
        await this.dispatchCommand(ctx, { kind: "session", op: "list" }, "🗂️ 处理中…");
      } else if (/^(recent|new|drive|here|open):/.test(v)) {
        // 项目菜单项（handleRelayProjectOp 返回的 value）。
        await this.handleProjectPick(ctx, v);
      } else if (v.startsWith("provpage:")) {
        // 供应商列表翻页。
        await this.dispatchCommand(ctx, { kind: "provider", op: "list", arg: "page:" + v.slice(9) }, "🧩 处理中…");
      } else if (v === "provback") {
        // 从模型菜单返回供应商列表。
        this.pendingInput.set(ctx.chat!.id, { kind: "provider.switch" });
        await this.dispatchCommand(ctx, { kind: "provider", op: "list" }, "🧩 处理中…");
      } else if (v.startsWith("provpick:") || v.startsWith("provsw:")) {
        // 选供应商（弹模型菜单）或选模型（切换）。
        await this.dispatchCommand(ctx, { kind: "provider", op: "switch", arg: v }, "🧩 处理中…");
      } else if (v.startsWith("modeset:")) {
        await this.dispatchCommand(ctx, { kind: "mode", mode: v.slice(8) }, "🔐 切换中…");
      }
      return;
    }
    // 参数回复：
    if (kind === "run") {
      await this.dispatchCommand(ctx, { kind: "tool", tool: "run", args: { command: v, timeout: 30000 } }, "⚙️ 执行中…");
    } else if (kind === "search") {
      await this.dispatchCommand(ctx, { kind: "tool", tool: "search", args: { query: v, path: "." } }, "🔍 搜索中…");
    } else if (kind === "file.read") {
      await this.dispatchCommand(ctx, { kind: "tool", tool: "file.read", args: { path: v } }, "📄 读取中…");
    } else if (kind === "file.list") {
      await this.dispatchCommand(ctx, { kind: "tool", tool: "file.list", args: { path: v || "." } }, "📂 列目录…");
    } else if (kind === "git.commit") {
      await this.dispatchCommand(ctx, { kind: "tool", tool: "git.commit", args: { message: v } }, "🔧 提交中…");
    } else if (kind === "git.checkout") {
      await this.dispatchCommand(ctx, { kind: "tool", tool: "git.checkout", args: { branch: v } }, "🔧 切换中…");
    } else if (kind === "session.switch") {
      await this.dispatchCommand(ctx, { kind: "session", op: "switch", arg: v }, "🔀 切换中…");
    } else if (kind === "provider.switch") {
      await this.dispatchCommand(ctx, { kind: "provider", op: "switch", arg: v }, "🧩 切换中…");
    } else if (kind === "mode.set") {
      await this.dispatchCommand(ctx, { kind: "mode", mode: v }, "🔐 切换中…");
    } else if (kind === "project.pick") {
      await this.handleProjectPick(ctx, v);
    } else if (kind === "project.newname") {
      const base = this.newProjectBase.get(ctx.chat!.id) || "";
      this.newProjectBase.delete(ctx.chat!.id);
      await this.dispatchCommand(ctx, { kind: "project", op: "create", arg: base + "\n" + v }, "📁 创建中…");
    }
  }

  // 项目切换入口：让主进程返回"最近项目 + 新建"菜单。
  private async showProjectRoot(ctx: Context): Promise<void> {
    await this.dispatchCommand(ctx, { kind: "project", op: "list" }, "📁 加载项目…");
  }

  // 项目菜单选择：value 约定
  //  recent:<path>  → 打开最近项目
  //  new            → 开始新建（列盘符）
  //  drive:<path>   → 列某目录子文件夹
  //  here:<path>    → 在此目录新建（询问名称）
  //  open:<path>    → 直接打开该已存在目录
  private async handleProjectPick(ctx: Context, value: string): Promise<void> {
    const ci = value.indexOf(":");
    const tag = ci >= 0 ? value.slice(0, ci) : value;
    const arg = ci >= 0 ? value.slice(ci + 1) : "";
    if (tag === "recent" || tag === "open") {
      await this.dispatchCommand(ctx, { kind: "project", op: "open", arg }, "📂 打开中…");
    } else if (tag === "new") {
      await this.dispatchCommand(ctx, { kind: "project", op: "listDrives" }, "💽 列出盘符…");
    } else if (tag === "drive") {
      await this.dispatchCommand(ctx, { kind: "project", op: "listDir", arg }, "📂 列目录…");
    } else if (tag === "here") {
      this.pendingInput.set(ctx.chat!.id, { kind: "project.newname" });
      // 把当前目录记下来，create 时拼接（用占位 reply 记录目录）。
      this.newProjectBase.set(ctx.chat!.id, arg);
      await ctx.reply("📁 在此目录新建：" + arg + "\n请回复新项目文件夹名：", { reply_markup: { force_reply: true } }).catch(() => {});
    }
  }

  private async dispatchAsk(ctx: Context, prompt: string): Promise<void> {
    await this.dispatchCommand(ctx, { kind: "ask", prompt }, "🤖 思考中…");
  }

  // 先回一条占位消息，记录 replyTo，结果到达后编辑它。
  private async dispatchCommand(
    ctx: Context,
    payload: { kind: "ask" | "session" | "tool" | "provider" | "mode" | "project" | "ui"; prompt?: string; op?: any; arg?: string; tool?: string; args?: Record<string, any>; mode?: string; images?: string[] },
    placeholder: string,
  ): Promise<void> {
    const chatId = ctx.chat!.id;
    const replyTo = "tg-" + Date.now() + "-" + (++this.seq);
    let msgId = 0;
    try {
      const sent = await ctx.reply(placeholder);
      msgId = sent.message_id;
    } catch { /* 占位失败也继续，结果会新发一条 */ }
    this.pendingReplies.set(replyTo, { chatId, msgId });
    // ask 一轮：把占位消息登记为"进度消息"，工具调用/todo 累积编辑进它；最终答另发新消息。
    // 同时给触发本轮的用户消息打 👀（收到）；首条进度→✍️；收尾→👍/💔（轻量状态，不刷屏）。
    const userMsgId = ctx.message?.message_id || 0;
    if (payload.kind === "ask" && msgId) {
      this.activeProgress.set(chatId, { replyTo, msgId, tools: [], todos: "", dirty: false, flushTimer: null, lastBody: "", userMsgId, working: false });
      this.react(chatId, userMsgId, "👀");
    }
    this.host.emit({
      type: "command", source: "telegram", channelId: String(chatId), userId: String(ctx.from?.id || ""), replyTo,
      ...payload,
    });
  }

  // ---- 结果回送 ----
  emit(msg: RelayEmit): void {
    if (!this.bot) return;
    const chatIdNum = Number(msg.channelId);
    if (msg.kind === "typing") {
      this.bot.api.sendChatAction(chatIdNum, "typing").catch(() => {});
      return;
    }

    // 结构化菜单（项目/供应商/模式等）→ inline keyboard。若有 replyTo 占位则就地编辑，否则新发。
    if (msg.kind === "menu" && msg.menu) {
      const kb = new InlineKeyboard();
      msg.menu.items.slice(0, 90).forEach((it, i) => { kb.text(it.label.slice(0, 60), "cmd:menu:" + this.shortVal(it.value)); if (i % 2 === 1) kb.row(); });
      const ref = msg.replyTo ? this.pendingReplies.get(msg.replyTo) : null;
      if (msg.replyTo) this.pendingReplies.delete(msg.replyTo);
      if (ref && ref.msgId) {
        this.bot.api.editMessageText(ref.chatId, ref.msgId, msg.menu.title, { reply_markup: kb })
          .catch(() => { this.bot!.api.sendMessage(ref.chatId, msg.menu!.title, { reply_markup: kb }).catch(() => {}); });
      } else {
        this.bot.api.sendMessage(chatIdNum, msg.menu.title, { reply_markup: kb }).catch(() => {});
      }
      return;
    }
    // 置顶状态栏：维护一条 pin 的「项目/模型/模式」面板。
    if (msg.kind === "board" && msg.board) {
      this.updateBoard(chatIdNum, msg.board).catch((e: any) => console.error("[telegram-adapter] board:", e));
      return;
    }
    // 图片 / 文件互传：把图片发给用户（内联照片，不是链接）。发送前先发 chatAction。
    // filePath 三种形态都支持：本地路径(InputFile)、远程 URL(直接传字符串，Telegram 服务端抓取)、
    // data:image base64(解码成 Buffer)。模型把图以 URL/dataURI 写进正文时也能内联显示。
    if (msg.kind === "image" && msg.filePath) {
      this.bot.api.sendChatAction(chatIdNum, "upload_photo").catch(() => {});
      const fp = msg.filePath;
      let photo: any;
      const dm = /^data:image\/[^;]+;base64,(.+)$/i.exec(fp);
      if (dm) photo = new InputFile(Buffer.from(dm[1], "base64"), "image.png");
      else if (/^https?:\/\//i.test(fp)) photo = fp;          // 远程 URL：Telegram 服务端抓取
      else photo = new InputFile(fp);                         // 本地路径
      this.bot.api.sendPhoto(chatIdNum, photo, msg.text ? { caption: msg.text.slice(0, 1000) } : undefined)
        .catch((e: any) => console.error("[telegram-adapter] sendPhoto:", e));
      return;
    }
    if (msg.kind === "document" && msg.filePath) {
      this.bot.api.sendChatAction(chatIdNum, "upload_document").catch(() => {});
      this.bot.api.sendDocument(chatIdNum, new InputFile(msg.filePath), msg.text ? { caption: msg.text.slice(0, 1000) } : undefined)
        .catch((e: any) => console.error("[telegram-adapter] sendDocument:", e));
      return;
    }
    // 进度（工具调用 / todo 更新）：累积到该 chat 的活跃进度消息，去抖 flush（防限速吞更新）。
    if (msg.kind === "progress") {
      const prog = this.activeProgress.get(chatIdNum);
      if (prog) {
        const t = msg.text || "";
        if (t.startsWith("📋")) {
          prog.todos = t;                       // todo 块整体替换
        } else {
          prog.tools.push(t);                   // 工具调用行追加
          if (prog.tools.length > 20) prog.tools = prog.tools.slice(-20);
        }
        // 首条进度到达 → 把用户消息表情从 👀 切到 ✍️（处理中）。
        if (!prog.working) { prog.working = true; this.react(chatIdNum, prog.userMsgId, "✍️"); }
        this.scheduleProgressFlush(chatIdNum);
      } else {
        this.sendRich(chatIdNum, msg.text || "").catch(() => {});
      }
      return;
    }

    const text = msg.text || "(空)";
    const ref = msg.replyTo ? this.pendingReplies.get(msg.replyTo) : null;
    if (msg.replyTo) this.pendingReplies.delete(msg.replyTo);
    const chatId = ref ? ref.chatId : chatIdNum;
    const prog = this.activeProgress.get(chatId);
    // 这是某个 ask 一轮的最终结果（replyTo 命中活跃进度）→ 答案作为新消息发在进度之后。
    const isAskFinal = !!(prog && ref && prog.replyTo === msg.replyTo);
    // 一轮收尾的表情：结果 👍 / 错误 💔（在 endProgress 清掉 prog 前先取 userMsgId）。
    if (isAskFinal && prog) this.react(chatId, prog.userMsgId, msg.kind === "error" ? "💔" : "👍");

    // 超长结果：分段发成多条普通消息（每段 <4096），而不是甩一个 txt 文档。
    // 之前甩 output.txt 既看不到正文、又像"突然来个文件就断了"，体验很差。
    if (text.length > MAX_TG) {
      if (isAskFinal) this.endProgress(chatId, true);
      this.sendLong(chatId, text).catch((e) => console.error("[telegram-adapter] sendLong:", e));
      return;
    }

    if (isAskFinal) {
      // 进度消息保留为"工具调用记录"（先做最后一次 flush 定格），最终答另发新消息。
      this.endProgress(chatId, true);
      this.sendRich(chatId, text).catch((e) => console.error("[telegram-adapter] send:", e));
      return;
    }

    // 非 ask（/git /file 等）：直接编辑占位消息为结果。
    if (ref && ref.msgId) {
      this.editRich(chatId, ref.msgId, text).catch((e) => console.error("[telegram-adapter] edit:", e));
    } else {
      this.sendRich(chatId, text).catch((e) => console.error("[telegram-adapter] send:", e));
    }
  }

  // 组装进度正文（Telegram HTML）：标题 + 工具调用放进「可展开引用」(<blockquote
  // expandable>) 默认折叠只露几行、点开看全部，不再一长串刷屏；todo 块紧随其后。
  private progressBody(prog: { tools: string[]; todos: string }): string {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const parts: string[] = ["🤖 <b>处理中…</b>"];
    if (prog.tools.length) {
      parts.push("<blockquote expandable>" + prog.tools.slice(-20).map(esc).join("\n") + "</blockquote>");
    }
    if (prog.todos) parts.push(esc(prog.todos));
    return parts.join("\n\n").slice(0, MAX_TG);
  }

  // 用 HTML 编辑进度消息（含 blockquote）。失败回落纯文本编辑，保证不报错。
  private editProgress(chatId: number, msgId: number, html: string): void {
    this.bot!.api.editMessageText(chatId, msgId, html, { parse_mode: "HTML", link_preview_options: { is_disabled: true } })
      .catch(() => { this.bot!.api.editMessageText(chatId, msgId, html.replace(/<[^>]+>/g, "").slice(0, MAX_TG)).catch(() => {}); });
  }

  // 去抖调度进度 flush：限速窗口 1.5s，避免 editMessageText 429 把更新吞掉。
  private scheduleProgressFlush(chatId: number): void {
    const prog = this.activeProgress.get(chatId);
    if (!prog) return;
    prog.dirty = true;
    if (prog.flushTimer) return;        // 已排程
    prog.flushTimer = setTimeout(() => {
      const p = this.activeProgress.get(chatId);
      if (!p) return;
      p.flushTimer = null;
      if (!p.dirty) return;
      p.dirty = false;
      const body = this.progressBody(p);
      if (body === p.lastBody) return;   // 去重避免 "message is not modified"
      p.lastBody = body;
      this.editProgress(chatId, p.msgId, body);
    }, 1500);
  }

  // 结束一轮进度：最后一次同步 flush 定格，清掉定时器与状态。
  private endProgress(chatId: number, finalFlush: boolean): void {
    const prog = this.activeProgress.get(chatId);
    if (!prog) return;
    if (prog.flushTimer) { clearTimeout(prog.flushTimer); prog.flushTimer = null; }
    if (finalFlush) {
      const body = this.progressBody(prog);
      if (body && body !== prog.lastBody) this.editProgress(chatId, prog.msgId, body);
    }
    this.activeProgress.delete(chatId);
  }

  // 从 Telegram 服务器下载文件到本地临时目录，返回绝对路径（供 AI vision / read_file）。
  private downloadFile(filePath: string): Promise<string> {
    return new Promise((resolve) => {
      if (!filePath || !this.token) { resolve(""); return; }
      const url = "https://api.telegram.org/file/bot" + this.token + "/" + filePath;
      const ext = (filePath.match(/\.[a-zA-Z0-9]+$/) || [".bin"])[0];
      const dest = pathJoin(tmpdir(), "cw-tg-" + this.seq++ + "-" + (filePath.split("/").pop() || ("file" + ext)));
      const out = createWriteStream(dest);
      httpsGet(url, (res) => {
        if (res.statusCode !== 200) { res.resume(); resolve(""); return; }
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve(dest)));
      }).on("error", () => resolve(""));
    });
  }

  // 富文本发送：先按 HTML 发，失败（多半是 HTML 实体不配对）回落纯文本，保证消息发得出去。
  private async sendRich(chatId: number, text: string): Promise<void> {
    const html = mdToHtml(text).slice(0, MAX_TG);
    try {
      await this.bot!.api.sendMessage(chatId, html, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    } catch {
      await this.bot!.api.sendMessage(chatId, text.slice(0, MAX_TG));
    }
  }

  // 超长文本分段发：按换行边界切成 <MAX_TG 的块，逐条 sendRich（每条独立富文本，
  // 失败各自回落纯文本）。这样长答案完整可读，而不是被塞进一个 txt 文档。
  private async sendLong(chatId: number, text: string): Promise<void> {
    const CHUNK = MAX_TG - 64;             // 留余量给 HTML 标签膨胀
    const chunks: string[] = [];
    let rest = text;
    while (rest.length > CHUNK) {
      // 优先在最后一个换行处断开，避免切断段落/代码；找不到就硬切。
      let cut = rest.lastIndexOf("\n", CHUNK);
      if (cut < CHUNK * 0.5) cut = CHUNK;  // 换行太靠前则不值得，硬切
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut).replace(/^\n/, "");
    }
    if (rest) chunks.push(rest);
    for (const c of chunks) {
      await this.sendRich(chatId, c);
      // 轻微间隔，规避连发限速（Telegram ~30 msg/s，但同 chat 连发仍宜让步）。
      await new Promise((r) => setTimeout(r, 350));
    }
  }
  private async editRich(chatId: number, msgId: number, text: string): Promise<void> {
    const html = mdToHtml(text).slice(0, MAX_TG);
    try {
      await this.bot!.api.editMessageText(chatId, msgId, html, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    } catch {
      await this.bot!.api.editMessageText(chatId, msgId, text.slice(0, MAX_TG)).catch(() => {
        this.bot!.api.sendMessage(chatId, text.slice(0, MAX_TG)).catch(() => {});
      });
    }
  }
  // 纯文本编辑（用于"已选择/已回答"等固定短句，无需富文本）。
  private async editPlain(chatId: number, msgId: number, text: string): Promise<void> {
    await this.bot!.api.editMessageText(chatId, msgId, text.slice(0, MAX_TG));
  }

  // 给某条用户消息打表情回应，作为轻量状态指示（不刷屏）：👀收到 → ✍️处理中 → 👍完成 / 💔失败。
  // 注意 Telegram 仅允许固定表情集合，这四个都在白名单内。失败静默（权限/消息过旧等）。
  private react(chatId: number, msgId: number, emoji: string): void {
    if (!this.bot || !msgId) return;
    this.bot.api.setMessageReaction(chatId, msgId, [{ type: "emoji", emoji: emoji as any }]).catch(() => {});
  }

  // 提问/审批卡作答后的视觉收尾：选项卡保留问题正文，只把按钮换成一枚"已决定"态按钮
  // （editMessageReplyMarkup，不动正文）；自由文本卡无按钮，则编辑正文为短句。
  private markPromptDecided(p: { chatId: number; msgId: number; mode: "choice" | "text" }, label: string): void {
    if (!this.bot) return;
    if (p.mode === "choice") {
      this.bot.api.editMessageReplyMarkup(p.chatId, p.msgId, {
        reply_markup: { inline_keyboard: [[{ text: label.slice(0, 64), callback_data: "noop" }]] },
      }).catch(() => { this.editPlain(p.chatId, p.msgId, label).catch(() => {}); });
    } else {
      this.editPlain(p.chatId, p.msgId, label).catch(() => {});
    }
  }

  // 维护置顶状态栏：首次发一条并 pin，之后只编辑内容（pin 保持）。内容不变则跳过。
  private async updateBoard(chatId: number, board: { project?: string; model?: string; mode?: string }): Promise<void> {
    if (!this.bot) return;
    const parts: string[] = [];
    if (board.project) parts.push("📂 " + board.project);
    if (board.model) parts.push("🤖 " + board.model);
    if (board.mode) parts.push("🔐 " + board.mode);
    const text = parts.join("\n").slice(0, MAX_TG) || "—";
    const cur = this.boards.get(chatId);
    if (cur && cur.last === text) return;
    if (cur && cur.msgId) {
      try {
        await this.bot.api.editMessageText(chatId, cur.msgId, text);
        this.boards.set(chatId, { msgId: cur.msgId, last: text });
        return;
      } catch { /* 旧消息可能被删，落到下面重发 */ }
    }
    const sent = await this.bot.api.sendMessage(chatId, text, { disable_notification: true });
    this.boards.set(chatId, { msgId: sent.message_id, last: text });
    this.bot.api.pinChatMessage(chatId, sent.message_id, { disable_notification: true }).catch(() => {});
  }

  // ---- 提问 ----
  prompt(req: RelayPrompt): void {
    if (!this.bot) { this.host.emit({ type: "answer", promptId: req.promptId, answer: "" }); return; }
    this.runPrompt(req).catch((e) => {
      console.error("[telegram-adapter] prompt:", e);
      this.host.emit({ type: "answer", promptId: req.promptId, answer: "" });
    });
  }

  cancelPrompt(promptId: string): void {
    const p = this.prompts.get(promptId);
    if (!p) return;
    clearTimeout(p.timer);
    this.prompts.delete(promptId);
    if (p.mode === "text") this.awaitingText.delete(p.chatId);
    this.markPromptDecided(p, "↩️ 已由其它方式处理");
    // cancel 不再回 answer（核心侧已解决）。
  }

  private resolvePrompt(promptId: string, answer: string): void {
    const p = this.prompts.get(promptId);
    if (!p) return;
    clearTimeout(p.timer);
    this.prompts.delete(promptId);
    if (p.mode === "text") this.awaitingText.delete(p.chatId);
    p.settle(answer);
  }

  private async runPrompt(req: RelayPrompt): Promise<void> {
    const chatId = Number(req.channelId);
    const timeoutMs = req.timeoutMs ?? 10 * 60 * 1000;
    // 计划卡：plan 是 markdown，需走 HTML 渲染（之前用裸 sendMessage 丢了格式）。
    const headerPlain = req.plan
      ? "📋 计划审批\n" + req.plan.slice(0, MAX_TG - 200) + "\n\n" + req.question
      : "❓ " + req.question;
    const opts = (req.options || []).filter(Boolean).slice(0, 8);

    let settled = false;
    const settle = (answer: string) => {
      if (settled) return;
      settled = true;
      this.host.emit({ type: "answer", promptId: req.promptId, answer });
    };
    const timer = setTimeout(() => {
      this.prompts.delete(req.promptId);
      this.awaitingText.delete(chatId);
      // 选项卡：换按钮为"⏱️ 超时"状态（保留问题）；文本卡：编辑正文为超时短句。
      this.markPromptDecided({ chatId, msgId, mode: opts.length > 0 ? "choice" : "text" }, opts.length > 0 ? "⏱️ 超时" : headerPlain.slice(0, 200) + "\n⏱️ 超时。");
      settle("");
    }, timeoutMs);

    // 把 header 渲染为 HTML（计划全文用 mdToHtml；问题文本也顺带支持 markdown）。
    // 发送用 HTML，失败回落纯文本，保证一定发得出去。
    const send = async (suffix: string, reply_markup: any): Promise<number> => {
      const htmlBody = (req.plan
        ? "📋 <b>计划审批</b>\n" + mdToHtml(req.plan.slice(0, MAX_TG - 200)) + "\n\n" + mdToHtml(req.question)
        : "❓ " + mdToHtml(req.question)) + suffix;
      try {
        const sent = await this.bot!.api.sendMessage(chatId, htmlBody.slice(0, MAX_TG), { parse_mode: "HTML", reply_markup, link_preview_options: { is_disabled: true } });
        return sent.message_id;
      } catch {
        const sent = await this.bot!.api.sendMessage(chatId, (headerPlain + suffix).slice(0, MAX_TG), { reply_markup });
        return sent.message_id;
      }
    };

    let msgId = 0;
    if (opts.length > 0) {
      const kb = new InlineKeyboard();
      opts.forEach((opt, i) => { kb.text(opt.slice(0, 60), "fu:" + req.promptId + ":" + i); kb.row(); });
      const allowText = req.allowText !== false;
      // 问题卡：除点按钮外也可直接回复文字；计划/受限卡：仅按钮。
      const hint = allowText ? "\n\n💬 点按钮选择，或直接回复文字。" : "\n\n👇 请点按钮选择。";
      msgId = await send(hint, kb);
      this.prompts.set(req.promptId, { chatId, msgId, mode: "choice", options: opts, settle, timer });
      // 仅当允许自由文本时登记 awaitingText：用户打字即作答复，不被当成新 /ask（避免 BUSY）。
      // 受限卡（计划/dashboard）不登记：打字不作答（用户应点按钮），符合桌面端语义。
      if (allowText) this.awaitingText.set(chatId, req.promptId);
    } else {
      msgId = await send("", { force_reply: true });
      this.prompts.set(req.promptId, { chatId, msgId, mode: "text", settle, timer });
      this.awaitingText.set(chatId, req.promptId);
    }
  }
}
