/**
 * RelayCore —— 主进程侧的统一远程控制中枢。
 *
 * 取代原 discord-bot-manager 的"主进程持有 bot"模型：bot 网关现在跑在独立的
 * utilityProcess（gateway.ts）里。RelayCore 负责：
 * - 管理各平台（discord/telegram）的配置与 token（token 走 SecretsManager 加密存储）。
 * - fork / 监管网关子进程，转发 connect/disconnect。
 * - 接收网关上报的 status（广播给渲染层 UI）、command（交给注入的 bridge 处理）、
 *   answer（喂回挂起的 prompt）。
 * - 向网关下发 prompt（提问）/ emit（结果/进度/错误）/ prompt-cancel（撤卡）。
 *
 * 业务逻辑（跑 agent、session 操作、tool 执行）不在这里，仍由 ipc-handlers 注入的
 * bridge 委托渲染层/主进程工具完成 —— RelayCore 只做"网关 ↔ 业务"的编排。
 */
import { app, utilityProcess, type UtilityProcess, type BrowserWindow } from "electron";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { SecretsManager } from "../secrets-manager";
import type { ToGateway, FromGateway, RelaySource, RelayCommand } from "./protocol";

export type RelayStatusValue = "offline" | "connecting" | "online" | "error";

/** 单平台配置（持久化到 userData，不含 token）。 */
export interface RelaySourceConfig {
  allowedUserId: string;
  autoConnect?: boolean;
  // Discord 专属
  applicationId?: string;
  guildId?: string;
  // 微信专属（扫码登录后回填）
  accountId?: string;
  baseUrl?: string;
  userId?: string;
}

/**
 * 业务桥：RelayCore 把网关上报的命令交给它处理，它用桌面已选 Provider / 主进程工具
 * 执行后返回结果。与平台无关 —— 由 ipc-handlers 注入（复用现有 discordBridge 逻辑）。
 */
export interface RelayBridge {
  /** 跑一轮 agent。source/channelId 透传，供 followup 把提问转回原频道。images=手机发来的图片路径。 */
  runTurn: (prompt: string, ctx: { source: RelaySource; channelId: string; images?: string[] }) => Promise<{ ok: boolean; text?: string; error?: string; images?: string[] }>;
  /** 会话操作 new/list/switch（switch __stop__ = 中止）。 */
  sessionOp: (op: "new" | "list" | "switch", ctx: { source: RelaySource; channelId: string }, arg?: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
  /** 不需要 AI 的工具命令（file/git/run/search/status）。 */
  runTool: (tool: string, args: Record<string, any>, ctx: { source: RelaySource; channelId: string }) => Promise<{ ok: boolean; text?: string; error?: string; filename?: string }>;
  /** Provider 操作 list/switch。list 可返回菜单（按钮+分页）。 */
  providerOp: (op: "list" | "switch", ctx: { source: RelaySource; channelId: string }, arg?: string) => Promise<{ ok: boolean; text?: string; error?: string; menu?: { title: string; items: { label: string; value: string }[] } }>;
  /** 权限模式操作：mode 为空=查看（返回菜单）；否则切换。 */
  modeOp: (mode: string | undefined, ctx: { source: RelaySource; channelId: string }) => Promise<{ ok: boolean; text?: string; error?: string; menu?: { title: string; items: { label: string; value: string }[] } }>;
  /** 项目操作（切换/新建/逐级选目录）。可返回菜单（menu）或文本结果。 */
  projectOp: (op: string, arg: string | undefined, ctx: { source: RelaySource; channelId: string }) => Promise<{ ok: boolean; text?: string; error?: string; menu?: { title: string; items: { label: string; value: string }[] } }>;
  /** UI 行为：chat/game/agent（行为模式）、compact（真实压缩上下文）。 */
  uiOp: (op: string, ctx: { source: RelaySource; channelId: string }) => Promise<{ ok: boolean; text?: string; error?: string }>;
  /** 当前状态栏（项目/模型/权限模式），供置顶面板展示。读取桌面活动会话，快速只读。 */
  statusLine?: (ctx: { source: RelaySource; channelId: string }) => Promise<{ project?: string; model?: string; mode?: string }>;
}

const TOKEN_KEY: Record<RelaySource, string> = {
  discord: "__discord_bot_token__",          // 与旧 discord-bot-manager 同 key，平滑复用
  telegram: "__telegram_bot_token__",
  weixin: "__weixin_bot_token__",
};
const CONFIG_FILE = "ue-coworker-relay.json";

// 变量遭遍各平台时的统一列表（新增平台只需改这里）。
const ALL_SOURCES: RelaySource[] = ["discord", "telegram", "weixin"];

interface PersistShape {
  discord?: RelaySourceConfig;
  telegram?: RelaySourceConfig;
  weixin?: RelaySourceConfig;
}

export class RelayCore {
  private secrets: SecretsManager;
  private bridge: RelayBridge;
  private getWindow: () => BrowserWindow | null;
  private configPath: string;

  private config: PersistShape = {};
  private status: Record<RelaySource, { status: RelayStatusValue; error?: string; botTag?: string }> = {
    discord: { status: "offline" },
    telegram: { status: "offline" },
    weixin: { status: "offline" },
  };

  private proc: UtilityProcess | null = null;
  private procReady = false;
  private pendingToGateway: ToGateway[] = [];   // 子进程 ready 前缓冲
  private shuttingDown = false;                  // 主动关闭中（应用退出）→ 不触发网关自愈重启
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;

  // 挂起的 prompt：promptId -> 等待答复的 resolver。
  private pendingPrompts = new Map<string, (answer: string) => void>();
  private promptSeq = 0;

  constructor(
    secrets: SecretsManager,
    bridge: RelayBridge,
    getWindow: () => BrowserWindow | null,
  ) {
    this.secrets = secrets;
    this.bridge = bridge;
    this.getWindow = getWindow;
    this.configPath = join(app.getPath("userData"), CONFIG_FILE);
  }

  // ---- 配置读写 ----
  async loadConfig(source: RelaySource): Promise<RelaySourceConfig & { hasToken: boolean; status: RelayStatusValue; error?: string; botTag?: string }> {
    await this.ensureConfigLoaded();
    const cfg = this.config[source] || { allowedUserId: "" };
    const hasToken = await this.secrets.hasSecret(TOKEN_KEY[source]);
    const st = this.status[source];
    return { ...cfg, hasToken, status: st.status, error: st.error, botTag: st.botTag };
  }

  async saveConfig(source: RelaySource, patch: Partial<RelaySourceConfig> & { token?: string }): Promise<void> {
    await this.ensureConfigLoaded();
    const cur = this.config[source] || { allowedUserId: "" };
    const next: RelaySourceConfig = { ...cur };
    if (patch.allowedUserId !== undefined) next.allowedUserId = patch.allowedUserId;
    if (patch.autoConnect !== undefined) next.autoConnect = patch.autoConnect;
    if (patch.applicationId !== undefined) next.applicationId = patch.applicationId;
    if (patch.guildId !== undefined) next.guildId = patch.guildId;
    if (patch.accountId !== undefined) next.accountId = patch.accountId;
    if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl;
    if (patch.userId !== undefined) next.userId = patch.userId;
    this.config[source] = next;

    if (patch.token !== undefined) {
      await this.secrets.setSecret(TOKEN_KEY[source], patch.token);
    }
    await this.persistConfig();
  }

  private configLoaded = false;
  private async ensureConfigLoaded(): Promise<void> {
    if (this.configLoaded) return;
    try {
      if (existsSync(this.configPath)) {
        const raw = await readFile(this.configPath, "utf-8");
        this.config = JSON.parse(raw) || {};
      }
    } catch { /* 忽略解析错误 */ }
    this.configLoaded = true;
  }

  private async persistConfig(): Promise<void> {
    const dir = join(this.configPath, "..");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(this.configPath, JSON.stringify(this.config, null, 2), "utf-8");
  }

  // ---- 子进程生命周期 ----
  private ensureProc(): void {
    if (this.proc) return;
    // 网关脚本与主进程同目录（out/main/relay-gateway.js）。__dirname 在打包后即该目录。
    const script = join(__dirname, "relay-gateway.js");
    this.proc = utilityProcess.fork(script, [], { stdio: "pipe" });
    this.procReady = false;

    this.proc.on("message", (msg: FromGateway) => {
      this.onGatewayMessage(msg).catch((e) => console.error("[relay-core] msg error:", e));
    });
    this.proc.on("exit", (code) => {
      console.log("[relay-core] gateway exited:", code);
      this.proc = null;
      this.procReady = false;
      // 记下退出前在线/连接中的平台，子进程重启后自动重连（用户无需回桌面重新点链接）。
      const toRevive: RelaySource[] = [];
      for (const s of ALL_SOURCES) {
        if (this.status[s].status === "online" || this.status[s].status === "connecting") toRevive.push(s);
      }
      // 子进程退出 → 所有平台标记离线、清挂起 prompt（喂空串解锁等待）。
      for (const s of ALL_SOURCES) {
        this.setStatus({ type: "status", source: s, status: "offline" });
      }
      for (const [, resolve] of this.pendingPrompts) resolve("");
      this.pendingPrompts.clear();
      // 非主动 shutdown 导致的意外退出：延迟重启网关并重连先前在线的平台。
      // shutdown() 把 shuttingDown 置 true，正常关闭不触发自愈。
      if (!this.shuttingDown && toRevive.length > 0) {
        if (this.respawnTimer) clearTimeout(this.respawnTimer);
        this.respawnTimer = setTimeout(() => {
          this.respawnTimer = null;
          for (const s of toRevive) this.connect(s).catch(() => {});
        }, 2000);
      }
    });
    // 子进程 stderr/stdout 转主进程日志，便于排查。
    this.proc.stdout?.on("data", (d) => console.log("[gateway]", String(d).trimEnd()));
    this.proc.stderr?.on("data", (d) => console.error("[gateway]", String(d).trimEnd()));
  }

  private sendToGateway(msg: ToGateway): void {
    this.ensureProc();
    if (this.procReady && this.proc) {
      this.proc.postMessage(msg);
    } else {
      this.pendingToGateway.push(msg);   // ready 后 flush
    }
  }

  // ---- 连接 / 断开 ----
  async connect(source: RelaySource): Promise<{ ok: boolean; error?: string }> {
    await this.ensureConfigLoaded();
    const token = await this.secrets.getSecret(TOKEN_KEY[source]);
    const cfg = this.config[source] || { allowedUserId: "" };
    if (source === "weixin") {
      // 微信：有已持久化凭据则起长轮询；无凭据走扫码登录。
      if (!token || !cfg.accountId) {
        return { ok: false, error: "微信未登录，请先扫码登录" };
      }
      this.setStatus({ type: "status", source, status: "connecting" });
      this.sendToGateway({ type: "connect", source, token, config: cfg as Record<string, any> });
      return { ok: true };
    }
    if (!token) return { ok: false, error: "未配置 Bot Token" };
    if (source === "discord" && !cfg.applicationId) {
      return { ok: false, error: "未配置 Application ID" };
    }
    this.setStatus({ type: "status", source, status: "connecting" });
    this.sendToGateway({ type: "connect", source, token, config: cfg as Record<string, any> });
    return { ok: true };
  }

  /** 微信扫码登录：拉起网关侧登录状态机（二维码/状态经 relay:weixinQr 推给 UI）。 */
  startWeixinLogin(): void {
    this.setStatus({ type: "status", source: "weixin", status: "connecting" });
    this.sendToGateway({ type: "weixin-login-start" });
  }

  /** 取消正在进行的微信扫码登录。 */
  cancelWeixinLogin(): void {
    this.sendToGateway({ type: "weixin-login-cancel" });
  }

  async disconnect(source: RelaySource): Promise<void> {
    this.sendToGateway({ type: "disconnect", source });
    this.setStatus({ type: "status", source, status: "offline" });
  }

  getStatus(source: RelaySource): { status: RelayStatusValue; error?: string; botTag?: string } {
    return this.status[source];
  }

  /** 启动时自动上线：凡配置了 token 的平台都尝试连接（无需 autoConnect 开关，失败不抛、不提示）。 */
  async autoConnectAll(): Promise<void> {
    await this.ensureConfigLoaded();
    for (const s of ALL_SOURCES) {
      if (await this.secrets.hasSecret(TOKEN_KEY[s])) {
        // Discord 还需 applicationId 才能连；缺则跳过。
        if (s === "discord" && !this.config[s]?.applicationId) continue;
        // 微信还需扫码凭据 accountId；缺则跳过（等 UI 扫码登录）。
        if (s === "weixin" && !this.config[s]?.accountId) continue;
        this.connect(s).catch(() => {});
      }
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.respawnTimer) { clearTimeout(this.respawnTimer); this.respawnTimer = null; }
    try { this.proc?.kill(); } catch { /* ignore */ }
    this.proc = null;
  }

  // ---- 网关上报处理 ----
  private async onGatewayMessage(msg: FromGateway): Promise<void> {
    switch (msg.type) {
      case "ready": {
        this.procReady = true;
        const buf = this.pendingToGateway.splice(0);
        for (const m of buf) this.proc?.postMessage(m);
        break;
      }
      case "status":
        this.setStatus(msg);
        break;
      case "command":
        await this.handleCommand(msg);
        break;
      case "answer": {
        const resolve = this.pendingPrompts.get(msg.promptId);
        if (resolve) { this.pendingPrompts.delete(msg.promptId); resolve(msg.answer || ""); }
        break;
      }
      case "weixin-qr": {
        // 扫码登录二维码/状态：转给渲染层 UI 展示。
        try {
          const win = this.getWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send("relay:weixinQr", {
              qrcode: msg.qrcode, qrcodeImageContent: msg.qrcodeImageContent, status: msg.status, error: msg.error,
            });
          }
        } catch { /* 窗口不可用忽略 */ }
        break;
      }
      case "weixin-logged-in": {
        // 扫码登录成功：持久化凭据（token 入 SecretsManager，其余入 config）。
        await this.saveConfig("weixin", {
          token: msg.token,
          accountId: msg.accountId,
          baseUrl: msg.baseUrl,
          userId: msg.userId,
        });
        break;
      }
    }
  }

  private setStatus(msg: { type?: "status"; source: RelaySource; status: RelayStatusValue; error?: string; botTag?: string }): void {
    this.status[msg.source] = { status: msg.status, error: msg.error, botTag: msg.botTag };
    try {
      const win = this.getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("relay:statusChange", {
          source: msg.source, status: msg.status, error: msg.error, botTag: msg.botTag,
        });
      }
    } catch { /* 窗口不可用忽略 */ }
  }

  // ---- 命令处理：交给 bridge，结果经 emit 发回 ----
  private async handleCommand(cmd: RelayCommand): Promise<void> {
    const ctx = { source: cmd.source, channelId: cmd.channelId };
    const reply = (r: { ok: boolean; text?: string; error?: string; filename?: string }) => {
      this.sendToGateway({
        type: "emit", source: cmd.source, channelId: cmd.channelId, replyTo: cmd.replyTo,
        kind: r.ok ? "result" : "error",
        text: r.ok ? (r.text || "(无内容)") : (r.error || "处理失败"),
        filename: r.filename,
      });
    };
    try {
      if (cmd.kind === "ask" && cmd.prompt) {
        const r = await this.bridge.runTurn(cmd.prompt, { ...ctx, images: cmd.images });
        reply(r);
        // AI 产出的图片回传手机（generate_image 等）。
        if (r.ok && Array.isArray(r.images)) {
          for (const p of r.images.slice(0, 6)) {
            this.sendToGateway({ type: "emit", source: cmd.source, channelId: cmd.channelId, kind: "image", filePath: p });
          }
        }
      } else if (cmd.kind === "session" && (cmd.op === "new" || cmd.op === "list" || cmd.op === "switch")) {
        reply(await this.bridge.sessionOp(cmd.op, ctx, cmd.arg));
      } else if (cmd.kind === "tool" && cmd.tool) {
        reply(await this.bridge.runTool(cmd.tool, cmd.args || {}, ctx));
      } else if (cmd.kind === "provider" && (cmd.op === "list" || cmd.op === "switch")) {
        const r = await this.bridge.providerOp(cmd.op, ctx, cmd.arg);
        if (r.menu) this.sendToGateway({ type: "emit", source: cmd.source, channelId: cmd.channelId, replyTo: cmd.replyTo, kind: "menu", menu: r.menu });
        else reply(r);
      } else if (cmd.kind === "mode") {
        const r = await this.bridge.modeOp(cmd.mode, ctx);
        if (r.menu) this.sendToGateway({ type: "emit", source: cmd.source, channelId: cmd.channelId, replyTo: cmd.replyTo, kind: "menu", menu: r.menu });
        else reply(r);
      } else if (cmd.kind === "project" && cmd.op) {
        const r = await this.bridge.projectOp(cmd.op, cmd.arg, ctx);
        if (r.menu) {
          // 菜单结果：发结构化 menu emit（网关渲染成按钮）。
          this.sendToGateway({ type: "emit", source: cmd.source, channelId: cmd.channelId, replyTo: cmd.replyTo, kind: "menu", menu: r.menu });
        } else {
          reply(r);
        }
      } else if (cmd.kind === "ui" && cmd.op) {
        reply(await this.bridge.uiOp(cmd.op, ctx));
      } else {
        reply({ ok: false, error: "无法识别的命令" });
      }
    } catch (err: any) {
      reply({ ok: false, error: err?.message || String(err) });
    }
    // 每条命令处理后刷新置顶状态栏（项目/模型/权限模式）。只读、失败静默，不阻塞结果。
    try {
      if (this.bridge.statusLine) {
        const board = await this.bridge.statusLine(ctx);
        if (board && (board.project || board.model || board.mode)) {
          this.sendToGateway({ type: "emit", source: cmd.source, channelId: cmd.channelId, kind: "board", board });
        }
      }
    } catch { /* 状态栏失败不影响主流程 */ }
  }

  // ---- 对外：供 followup 桥向远程频道提问 ----
  /**
   * 向某平台频道提问，返回用户答复（空串=超时/取消/abort）。
   * options 非空→按钮；为空→自由文本；plan 非空→计划审批。
   * abort 由调用方在外层通过 cancelPrompt 解锁（与桌面卡片双通道）。
   */
  askPrompt(req: {
    source: RelaySource;
    channelId: string;
    question: string;
    options?: string[];
    plan?: string;
    allowText?: boolean;
    timeoutMs?: number;
  }): { promptId: string; answer: Promise<string> } {
    const promptId = "p-" + Date.now() + "-" + (++this.promptSeq);
    const answer = new Promise<string>((resolve) => {
      this.pendingPrompts.set(promptId, resolve);
    });
    this.sendToGateway({
      type: "prompt", source: req.source, channelId: req.channelId, promptId,
      question: req.question, options: req.options, plan: req.plan,
      allowText: req.allowText, timeoutMs: req.timeoutMs,
    });
    return { promptId, answer };
  }

  /** 撤回一张未答的远程提问（其它通道已解决/abort）。 */
  cancelPrompt(promptId: string): void {
    const resolve = this.pendingPrompts.get(promptId);
    if (resolve) { this.pendingPrompts.delete(promptId); resolve(""); }
    this.sendToGateway({ type: "prompt-cancel", promptId });
  }

  /** 主动向频道推送只读消息（进度/错误等）。 */
  pushEmit(source: RelaySource, channelId: string, kind: "progress" | "error" | "typing", text?: string): void {
    this.sendToGateway({ type: "emit", source, channelId, kind, text });
  }

  /** 是否有任一平台在线（供 followup 桥决定是否走远程通道）。 */
  anyOnline(): boolean {
    return ALL_SOURCES.some((s) => this.status[s].status === "online");
  }

  /** 某平台是否在线。 */
  isOnline(source: RelaySource): boolean {
    return this.status[source].status === "online";
  }
}

export let relayCore: RelayCore | null = null;

export function initRelayCore(
  secrets: SecretsManager,
  bridge: RelayBridge,
  getWindow: () => BrowserWindow | null,
): RelayCore {
  relayCore = new RelayCore(secrets, bridge, getWindow);
  return relayCore;
}
