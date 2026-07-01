/**
 * WeixinAdapter —— 微信官方 iLink 机器人（clawbot）平台网关适配器。
 *
 * 与 Discord/Telegram 的关键差异：
 * - 登录不是固定 Bot Token，而是扫码：startLogin() 拉起扫码状态机，把二维码/状态经
 *   host.emit(weixin-qr) 推给桌面 UI；用户确认后拿到凭据，经 host.emit(weixin-logged-in)
 *   回传主进程持久化，并立即用该凭据上线长轮询。
 * - 收消息靠长轮询 ilink/bot/getupdates（35s/轮），用 sync cursor 续传。
 * - 微信只有纯文本：富文本降级为纯文本；选项提问/计划审批降级为「回复编号」文本交互。
 *
 * connect(token, config)：config 带已持久化的 { accountId, baseUrl, userId }。有凭据则
 * 直接起长轮询；无凭据则上报 offline，等 UI 触发扫码登录。
 */
import type { RelayAdapter, AdapterHost } from "./adapter";
import type { RelayPrompt, RelayEmit } from "./protocol";
import { createWeixinTransport, type WeixinTransport } from "./weixin/transport";
import { weixinQrLogin } from "./weixin/login";
import { MessageItemType, type WeixinMessage } from "./weixin/types";
import { downloadInboundMedia } from "./weixin/media/media_download";
import { uploadImageToWeixin, uploadFileAttachmentToWeixin } from "./weixin/media/upload";
import { sendImageMessageWeixin, sendFileMessageWeixin } from "./weixin/media/send";
import { getMimeFromFilename } from "./weixin/media/mime";
import { randomUUID } from "node:crypto";
import { stat as fsStat } from "node:fs/promises";
import { basename } from "node:path";

// 微信单条消息体量限制（保守取值，超出按字数切分多条发送）。
const MAX_WX = 4000;
const TYPING_START = 1;
const LONG_POLL_TIMEOUT_MS = 35_000;
// 微信 CDN 基地址（c2c 媒体上传下载）。
const WEIXIN_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";
// 出站文件大小上限（保守 50MB，防大文件撑爆网关内存）。
const MAX_OUTBOUND_FILE_BYTES = 50 * 1024 * 1024;

// 命令菜单（微信无命令补全 UI，靠 /help 列编号菜单，回数字执行）。命令也接受中文别名直接打。
const HELP_TITLE = "📋 命令菜单（也可直接发消息提问，无需命令）";
const HELP_ITEMS: { label: string; value: string }[] = [
  { label: "切换权限模式（/mode）", value: "mode" },
  { label: "切换供应商/模型（/provider）", value: "provider" },
  { label: "新建空白会话（/clear）", value: "clear" },
  { label: "中止当前请求（/stop）", value: "stop" },
];

export class WeixinAdapter implements RelayAdapter {
  private host: AdapterHost;
  private transport: WeixinTransport | null = null;

  // 持久化凭据（connect 时由 config 带入；扫码登录成功后也回填）。
  private accountId = "";
  private token = "";
  private baseUrl = "";
  private userId = "";

  private seq = 0;
  private online = false;
  private wantConnected = false;     // 是否应保持长轮询（disconnect 时置 false）
  private polling = false;
  private syncCursor = "";

  // 扫码登录的中止开关。
  private loginAbort = false;
  private loggingIn = false;

  // 每个 from_user_id（= channelId/会话标识）缓存 context_token：发回消息必需。
  private contextTokens = new Map<string, string>();
  // 每个 from_user_id 缓存 typing_ticket（getConfig 拿到后复用）。
  private typingTickets = new Map<string, string>();

  // 等待「回复编号/文本」作答的提问：一个 channel 同时只挂一个。
  private prompts = new Map<string, {
    channelId: string;
    options?: string[];
    settle: (answer: string) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  // channelId -> 当前挂起的 promptId。
  private awaiting = new Map<string, string>();

  // 微信无可点击按钮：命令一律「文本命令 + 编号菜单 + 回数字」。
  // 每个 channel 缓存上一次发出的菜单（来自 provider/mode 的 menu emit），
  // 用户回纯数字 N → 取第 N 项 value 作为对应命令的参数。
  private pendingChoice = new Map<string, { kind: "provider" | "mode" | "help"; items: { label: string; value: string }[] }>();

  constructor(host: AdapterHost) { this.host = host; }

  async connect(token: string, config: Record<string, any>): Promise<void> {
    this.token = token || String(config?.token || "");
    this.accountId = String(config?.accountId || "");
    this.baseUrl = String(config?.baseUrl || "https://ilinkai.weixin.qq.com");
    this.userId = String(config?.userId || "");
    this.wantConnected = true;

    if (!this.token || !this.accountId) {
      // 没有凭据：保持离线，等 UI 触发扫码登录（startLogin）。
      this.online = false;
      this.host.emit({ type: "status", source: "weixin", status: "offline" });
      return;
    }
    await this.startPolling();
  }

  async disconnect(): Promise<void> {
    this.wantConnected = false;
    this.online = false;
    this.polling = false;
    this.loginAbort = true;
    for (const p of this.prompts.values()) { clearTimeout(p.timer); p.settle(""); }
    this.prompts.clear();
    this.awaiting.clear();
    this.host.emit({ type: "status", source: "weixin", status: "offline" });
  }

  // ---- 扫码登录（gateway 对微信特殊调用，不在 RelayAdapter 接口内）----

  async startLogin(): Promise<void> {
    if (this.loggingIn) return;
    this.loggingIn = true;
    this.loginAbort = false;
    this.host.emit({ type: "status", source: "weixin", status: "connecting" });
    try {
      const creds = await weixinQrLogin({
        shouldAbort: () => this.loginAbort,
        onQrCode: ({ qrcode, qrcodeImageContent }) => {
          this.host.emit({ type: "weixin-qr", qrcode, qrcodeImageContent, status: "wait" });
        },
        onStatus: ({ status, qrcode }) => {
          this.host.emit({ type: "weixin-qr", qrcode, status });
        },
      });
      if (!creds) {
        if (!this.loginAbort) {
          this.host.emit({ type: "weixin-qr", qrcode: "", status: "expired", error: "login timeout or cancelled" });
        }
        this.host.emit({ type: "status", source: "weixin", status: this.token ? "online" : "offline" });
        return;
      }
      // 登录成功：回填凭据 + 回传主进程持久化 + 立即上线。
      this.accountId = creds.accountId;
      this.token = creds.token;
      this.baseUrl = creds.baseUrl;
      this.userId = creds.userId;
      this.host.emit({ type: "weixin-qr", qrcode: "", status: "confirmed" });
      this.host.emit({
        type: "weixin-logged-in",
        accountId: creds.accountId,
        token: creds.token,
        baseUrl: creds.baseUrl,
        userId: creds.userId,
      });
      this.wantConnected = true;
      await this.startPolling();
    } catch (err: any) {
      this.host.emit({ type: "weixin-qr", qrcode: "", status: "error", error: String(err?.message || err) });
      this.host.emit({ type: "status", source: "weixin", status: "error", error: String(err?.message || err) });
    } finally {
      this.loggingIn = false;
    }
  }

  cancelLogin(): void {
    this.loginAbort = true;
  }

  // ---- 长轮询收消息 ----

  private async startPolling(): Promise<void> {
    this.transport = createWeixinTransport({ baseUrl: this.baseUrl, token: this.token });
    this.online = true;
    this.host.emit({ type: "status", source: "weixin", status: "online", botTag: this.accountId });
    if (this.polling) return;
    this.polling = true;
    this.pollLoop().catch((err) => {
      console.error("[weixin-adapter] poll loop crashed:", err);
    });
  }

  private async pollLoop(): Promise<void> {
    while (this.wantConnected && this.transport) {
      try {
        const resp = await this.transport.getUpdates({ syncCursor: this.syncCursor, timeoutMs: LONG_POLL_TIMEOUT_MS });
        // 鉴权失效 / 服务端错误：标错误并退避重试。
        if (resp.errcode && resp.errcode !== 0) {
          this.online = false;
          this.host.emit({ type: "status", source: "weixin", status: "error", error: resp.errmsg || ("errcode " + resp.errcode) });
          await sleep(3000);
          continue;
        }
        if (!this.online) {
          this.online = true;
          this.host.emit({ type: "status", source: "weixin", status: "online", botTag: this.accountId });
        }
        this.syncCursor = resp.get_updates_buf ?? this.syncCursor;
        for (const msg of resp.msgs ?? []) {
          this.handleInbound(msg).catch((e) => console.error("[weixin-adapter] inbound:", e));
        }
      } catch (err: any) {
        if (!this.wantConnected) break;
        this.online = false;
        this.host.emit({ type: "status", source: "weixin", status: "error", error: String(err?.message || err) });
        await sleep(2000);
      }
    }
    this.polling = false;
  }

  // 入站消息归一化：提取文本/图片/文件 + context_token，翻译成 RelayCommand 上报。
  private async handleInbound(msg: WeixinMessage): Promise<void> {
    // 只处理用户发来的消息（message_type=2 为 BOT，机器人自己发的回显跳过）。
    if (msg.message_type === 2) return;
    const fromUserId = String(msg.from_user_id ?? "").trim();
    if (!fromUserId) return;

    const contextToken = String(msg.context_token ?? "").trim();
    if (contextToken) this.contextTokens.set(fromUserId, contextToken);

    const items = msg.item_list ?? [];
    const text = extractText(items);
    if (text) console.log("[weixin-adapter] inbound text:", JSON.stringify(text).slice(0, 120));

    // 1) 有文本时：可能是提问答复、命令/数字选择，也可能是普通提问。
    if (text) {
      const waitId = this.awaiting.get(fromUserId);
      if (waitId) {
        const p = this.prompts.get(waitId);
        if (p) {
          const answer = this.resolveAnswer(p.options, text);
          this.resolvePrompt(waitId, answer);
          return;
        }
      }
      // 命令 / 编号选择（菜单回数字）。命中即返回，不再当作提问。
      if (this.handleCommandText(fromUserId, text)) return;
      this.emitCommand(fromUserId, { kind: "ask", prompt: text });
      return;
    }

    // 2) 无文本：尝试处理图片/文件（下载解密到 temp）。
    const mediaItem = items.find((it) =>
      Number(it?.type) === MessageItemType.IMAGE || Number(it?.type) === MessageItemType.FILE);
    if (mediaItem) {
      try {
        const media = await downloadInboundMedia(mediaItem, { cdnBaseUrl: WEIXIN_CDN_BASE_URL, label: "weixin-inbound" });
        if (media?.kind === "image") {
          // 图片：作为 vision 输入交给 AI。
          this.emitCommand(fromUserId, { kind: "ask", prompt: "请看这张图片。", images: [media.filePath] });
          return;
        }
        if (media?.kind === "file") {
          // 文件：把本地路径塞进 prompt，让 AI 用 read_file 读取处理。
          const prompt = "我上传了一个文件，路径：" + media.filePath + "，请按需读取处理。";
          this.emitCommand(fromUserId, { kind: "ask", prompt });
          return;
        }
      } catch (e: any) {
        this.sendText(fromUserId, "⚠️ 接收媒体失败：" + (e?.message || String(e))).catch(() => {});
        return;
      }
    }

    // 3) 语音/视频等暂不支持：给个轻提示（仅当确实有非文本条目时）。
    const hasVoiceOrVideo = items.some((it) =>
      Number(it?.type) === MessageItemType.VOICE || Number(it?.type) === MessageItemType.VIDEO);
    if (hasVoiceOrVideo) {
      this.sendText(fromUserId, "（暂不支持语音/视频，请发送文字、图片或文件）").catch(() => {});
    }
  }

  // 上报一条 RelayCommand 到主进程。channelId 用 from_user_id（也是发回时的 to_user_id）。
  private emitCommand(fromUserId: string, payload: { kind: "ask"; prompt: string; images?: string[] }): void {
    this.dispatchCommand(fromUserId, payload);
  }

  // 通用：把任意 RelayCommand payload 上报主进程（ask / provider / mode / session 等）。
  private dispatchCommand(fromUserId: string, payload: Record<string, any>): void {
    const replyTo = "wx-" + Date.now() + "-" + (++this.seq);
    this.host.emit({
      type: "command",
      source: "weixin",
      channelId: fromUserId,
      userId: fromUserId,
      replyTo,
      ...payload,
    } as any);
  }

  // 微信命令交互（受协议限制：纯文本命令 + 编号菜单 + 回数字，无可点击按钮）。
  // 命中命令/数字选择返回 true（不再当提问）；否则返回 false。
  private handleCommandText(fromUserId: string, raw: string): boolean {
    const text = raw.trim();
    console.log("[weixin-adapter] handleCommandText:", JSON.stringify(text).slice(0, 80));

    // 1) 若上一条是菜单且本条是纯数字 → 取对应项 value 派发。
    const pend = this.pendingChoice.get(fromUserId);
    if (pend && /^\d+$/.test(text)) {
      const idx = Number(text) - 1;
      const picked = pend.items[idx];
      if (!picked) {
        this.sendText(fromUserId, `请回复 1～${pend.items.length} 之间的编号。`).catch((e) => console.error("[weixin-adapter] send number-range failed:", e));
        return true;
      }
      this.pendingChoice.delete(fromUserId);
      if (pend.kind === "help") {
        // help 菜单：value 是命令名，执行对应命令（mode/provider 会再发各自的编号菜单）。
        this.runNamedCommand(fromUserId, picked.value);
      } else if (pend.kind === "provider") {
        // value 形如 provpick:（选供应商→再弹模型菜单）/ provsw:（选模型→切换）/
        // provpage:（翻页）/ provback（从模型菜单返回供应商列表）。
        if (picked.value === "provback") {
          this.dispatchCommand(fromUserId, { kind: "provider", op: "list" });
        } else if (picked.value.startsWith("provpage:")) {
          this.dispatchCommand(fromUserId, { kind: "provider", op: "list", arg: "page:" + picked.value.slice("provpage:".length) });
        } else {
          this.dispatchCommand(fromUserId, { kind: "provider", op: "switch", arg: picked.value });
        }
      } else {
        // mode：value 形如 modeset:<mode>。
        const mode = picked.value.startsWith("modeset:") ? picked.value.slice("modeset:".length) : picked.value;
        this.dispatchCommand(fromUserId, { kind: "mode", mode });
      }
      return true;
    }

    // 2) 斜杠 / 中文命令词。只认 / 开头或精确的中文别名，避免误吞普通提问。
    const lower = text.toLowerCase();
    const isSlash = text.startsWith("/");
    const word = isSlash ? lower.slice(1).split(/\s+/)[0] : lower;

    if (text === "菜单" || text === "帮助" || word === "help" || word === "menu" || word === "?" || word === "？") {
      this.pendingChoice.set(fromUserId, { kind: "help", items: HELP_ITEMS });
      const lines = [HELP_TITLE, ...HELP_ITEMS.map((it, i) => `${i + 1}. ${it.label}`), "", "👉 回复编号执行。"];
      this.sendText(fromUserId, lines.join("\n")).catch((e) => console.error("[weixin-adapter] send HELP failed:", e));
      return true;
    }
    if (word === "clear" || word === "new" || text === "新建会话" || text === "清空") {
      this.runNamedCommand(fromUserId, "clear");
      return true;
    }
    if (word === "stop" || text === "停止" || text === "中止") {
      this.runNamedCommand(fromUserId, "stop");
      return true;
    }
    if (word === "mode" || text === "模式") {
      this.runNamedCommand(fromUserId, "mode");
      return true;
    }
    if (word === "provider" || text === "供应商" || text === "模型") {
      this.runNamedCommand(fromUserId, "provider");
      return true;
    }
    // 其余 / 开头但不认识的命令：轻提示，不当提问。
    if (isSlash) {
      this.sendText(fromUserId, "未知命令。发送 /help 查看可用命令。").catch((e) => console.error("[weixin-adapter] send unknown-cmd failed:", e));
      return true;
    }
    return false;
  }

  // 执行一个具名命令（来自命令词或 help 菜单选项）。mode/provider 会触发各自的编号菜单。
  private runNamedCommand(fromUserId: string, name: string): void {
    this.pendingChoice.delete(fromUserId);
    switch (name) {
      case "mode":
        this.dispatchCommand(fromUserId, { kind: "mode" });           // 无参 → 返回 mode 菜单
        break;
      case "provider":
        this.dispatchCommand(fromUserId, { kind: "provider", op: "list" });
        break;
      case "clear":
        this.dispatchCommand(fromUserId, { kind: "session", op: "new" });
        break;
      case "stop":
        this.dispatchCommand(fromUserId, { kind: "session", op: "switch", arg: "__stop__" });
        break;
      default:
        this.sendText(fromUserId, "未知命令。发送 /help 查看可用命令。").catch(() => {});
    }
  }


  private resolveAnswer(options: string[] | undefined, text: string): string {
    const t = text.trim();
    if (options && options.length) {
      const n = Number(t);
      if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1];
    }
    return t;
  }

  // ---- 结果回送 ----
  emit(msg: RelayEmit): void {
    if (!this.transport) return;
    const toUserId = msg.channelId;

    if (msg.kind === "typing") {
      this.sendTyping(toUserId).catch(() => {});
      return;
    }
    // 微信暂不支持按钮菜单 / 置顶栏：menu 降级为纯文本，board 忽略。
    if (msg.kind === "board") return;
    // 图片与文件：都以「文件」形式发送（保留原图原画质，无需压缩到 200KB）。
    if (msg.kind === "image" || msg.kind === "document") {
      if (msg.filePath) {
        this.sendMediaFile(toUserId, msg.filePath, msg.text).catch((e) => {
          console.error("[weixin-adapter] sendMediaFile:", e);
          this.sendText(toUserId, "⚠️ 发送" + (msg.kind === "image" ? "图片" : "文件") + "失败：" + (e?.message || String(e))).catch(() => {});
        });
      } else if (msg.text) {
        this.sendText(toUserId, plainText(msg.text)).catch(() => {});
      }
      return;
    }
    if (msg.kind === "menu" && msg.menu) {
      const items = msg.menu.items || [];
      // 判定菜单类别：value 前缀决定回数字后派发到 provider 还是 mode。
      const kind: "provider" | "mode" =
        items.some((it) => /^(provpick:|provsw:|provpage:)/.test(it.value)) ? "provider" : "mode";
      this.pendingChoice.set(toUserId, { kind, items });
      const lines = [msg.menu.title, ...items.map((it, i) => `${i + 1}. ${it.label}`), "", "👉 回复编号选择。"];
      this.sendText(toUserId, lines.join("\n")).catch(() => {});
      return;
    }

    const text = plainText(msg.text || "(空)");
    this.sendText(toUserId, text).catch((e) => console.error("[weixin-adapter] send:", e));
  }

  // 发文本（超长按字数切分多条）。
  private async sendText(toUserId: string, text: string): Promise<void> {
    if (!this.transport) { console.error("[weixin-adapter] sendText: no transport"); return; }
    const contextToken = this.contextTokens.get(toUserId) ?? null;
    if (!contextToken) console.warn("[weixin-adapter] sendText: no contextToken for", toUserId, "— reply may be rejected by WeChat");
    const chunks = splitText(text, MAX_WX);
    for (const chunk of chunks) {
      await this.transport.sendMessage({
        toUserId,
        text: chunk,
        contextToken,
        clientId: "ue-coworker-weixin-" + randomUUID(),
      });
      if (chunks.length > 1) await sleep(300);
    }
  }

  // 发媒体文件：图片与文件都以「文件」形式上传发送（保留原图原画质，不压缩）。
  // 图片单独走 sendImageMessageWeixin 让手机端内联显示；非图片走 sendFileMessageWeixin。
  private async sendMediaFile(toUserId: string, filePath: string, caption?: string): Promise<void> {
    if (!this.transport) return;
    // 体积闸：超上限不发，回提示（防大文件撑爆网关内存 / 被微信服务端拒）。
    let size = 0;
    try { size = (await fsStat(filePath)).size; } catch (e: any) {
      throw new Error("文件不存在或不可读：" + (e?.message || String(e)));
    }
    if (size > MAX_OUTBOUND_FILE_BYTES) {
      await this.sendText(toUserId, `⚠️ 文件过大（${(size / 1024 / 1024).toFixed(1)}MB），超过 ${MAX_OUTBOUND_FILE_BYTES / 1024 / 1024}MB 上限，未发送。`);
      return;
    }
    const contextToken = this.contextTokens.get(toUserId) ?? null;
    const opts = { baseUrl: this.baseUrl, token: this.token, contextToken };
    const mime = getMimeFromFilename(filePath);
    const text = caption ? plainText(caption).slice(0, 1000) : "";

    if (mime.startsWith("image/")) {
      const uploaded = await uploadImageToWeixin({ filePath, toUserId, opts, cdnBaseUrl: WEIXIN_CDN_BASE_URL });
      await sendImageMessageWeixin({ to: toUserId, text, uploaded, opts });
      return;
    }
    const fileName = basename(filePath) || "file.bin";
    const uploaded = await uploadFileAttachmentToWeixin({ filePath, toUserId, opts, cdnBaseUrl: WEIXIN_CDN_BASE_URL });
    await sendFileMessageWeixin({ to: toUserId, text, fileName, uploaded, opts });
  }

  private async sendTyping(toUserId: string): Promise<void> {
    if (!this.transport) return;
    let ticket = this.typingTickets.get(toUserId);
    if (!ticket) {
      try {
        const contextToken = this.contextTokens.get(toUserId) ?? null;
        const cfg = await this.transport.getConfig({ userId: toUserId, contextToken });
        ticket = String(cfg.typing_ticket ?? "");
        if (ticket) this.typingTickets.set(toUserId, ticket);
      } catch { /* typing 可选，失败静默 */ }
    }
    if (ticket) {
      await this.transport.sendTyping({ toUserId, typingTicket: ticket, status: TYPING_START });
    }
  }

  // ---- 提问 ----
  prompt(req: RelayPrompt): void {
    if (!this.transport) { this.host.emit({ type: "answer", promptId: req.promptId, answer: "" }); return; }
    const channelId = req.channelId;
    const opts = (req.options || []).filter(Boolean).slice(0, 9);
    const timeoutMs = req.timeoutMs ?? 10 * 60 * 1000;

    // 组装纯文本提问：计划全文（若有）+ 问题 + 编号选项。
    const parts: string[] = [];
    if (req.plan) parts.push("📋 计划：\n" + plainText(req.plan));
    parts.push("C❓ " + plainText(req.question));
    if (opts.length) {
      parts.push(opts.map((o, i) => `${i + 1}. ${o}`).join("\n"));
      parts.push("👉 请回复编号" + (req.allowText !== false ? "，或直接回复文字。" : "。"));
    } else {
      parts.push("👉 请回复你的答复。");
    }
    this.sendText(channelId, parts.join("\n\n")).catch(() => {});

    let settled = false;
    const settle = (answer: string) => {
      if (settled) return;
      settled = true;
      this.host.emit({ type: "answer", promptId: req.promptId, answer });
    };
    const timer = setTimeout(() => {
      this.prompts.delete(req.promptId);
      this.awaiting.delete(channelId);
      this.sendText(channelId, "⏱️ 提问超时。").catch(() => {});
      settle("");
    }, timeoutMs);

    this.prompts.set(req.promptId, { channelId, options: opts.length ? opts : undefined, settle, timer });
    this.awaiting.set(channelId, req.promptId);
  }

  cancelPrompt(promptId: string): void {
    const p = this.prompts.get(promptId);
    if (!p) return;
    clearTimeout(p.timer);
    this.prompts.delete(promptId);
    this.awaiting.delete(p.channelId);
    // cancel 不回 answer（核心侧已解决）。
  }

  private resolvePrompt(promptId: string, answer: string): void {
    const p = this.prompts.get(promptId);
    if (!p) return;
    clearTimeout(p.timer);
    this.prompts.delete(promptId);
    this.awaiting.delete(p.channelId);
    p.settle(answer);
  }
}

// ---- 工具函数 ----

function extractText(items: { type?: number; text_item?: { text?: string } }[]): string {
  for (const item of items) {
    if (Number(item?.type) === MessageItemType.TEXT) {
      const t = String(item?.text_item?.text ?? "").trim();
      if (t) return t;
    }
  }
  return "";
}

// 把 AI 的 Markdown 退化为微信可读的纯文本：去掉围栏/行内代码标记、强调符号、标题井号、
// 把列表符统一成 •，保留链接文字。微信客户端不渲染任何富文本，故只做"去噪"不做转义。
function plainText(src: string): string {
  let t = String(src);
  t = t.replace(/```[\w-]*\n?([\s\S]*?)```/g, (_m, code) => String(code).replace(/\n$/, ""));
  t = t.replace(/`([^`\n]+)`/g, "$1");
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/\*\*([^\n*]+)\*\*/g, "$1").replace(/__([^\n_]+)__/g, "$1");
  t = t.replace(/(^|[^*])\*([^\n*]+)\*(?!\*)/g, "$1$2");
  t = t.replace(/~~([^\n~]+)~~/g, "$1");
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1（$2）");
  t = t.replace(/^[ \t]*[-*]\s+/gm, "• ");
  return t;
}

// 按字数切分长文本，优先在换行处断开。
function splitText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
