/**
 * DiscordBotManager — Discord Bot 远程控制模块。
 *
 * 嵌入 Electron 主进程，把手机 Discord 的斜杠命令「转发」到桌面端 UE Coworker。
 * Bot 只是一个传话的管道：/ask 经 IPC 桥交给渲染进程，用你在桌面已经选好的
 * Provider 正常跑一轮（消息也出现在桌面聊天里），拿到最终回复后再转发回 Discord。
 * Bot 自己不持有任何 Provider/Key，也不另起独立 Agent。
 *
 * /file /git /run /search /status 等不需要 AI 的命令，仍在主进程直接调工具执行。
 *
 * 依赖: discord.js v14+
 */
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { ComponentType } from "discord.js";
import type { ChatInputCommandInteraction, Interaction } from "discord.js";
import { BrowserWindow, app } from "electron";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { executeTool, TOOL_DEFINITIONS } from "./tools";
import { SecretsManager } from "./secrets-manager";
import { gitManager } from "./git-manager";
import { mcpManager } from "./mcp-manager";

/**
 * 桥接到渲染进程的回调（由 ipc-handlers 注入）。Bot 不直接跑 Agent，
 * 而是把请求经这两个回调转给渲染层，渲染层用桌面已选 Provider 执行后回传结果。
 */
export interface DiscordRendererBridge {
  /**
   * 委托渲染进程在「Discord 专用会话」里跑一轮 Agent，返回最终回复文本。
   * channelId 透传给渲染层 → agentReq.discordChannelId → 主进程 requestFollowup
   * 据此把 agent 的提问/计划卡转回该 Discord 频道（而非只弹桌面卡片）。
   */
  runTurn: (prompt: string, channelId: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
  /** 会话操作：new[名称] / list / switch<名称或序号>。返回给用户看的状态文本。 */
  sessionOp: (op: "new" | "list" | "switch", arg?: string) => Promise<{ ok: boolean; text?: string; error?: string }>;
}

// ---- 常量 ----
const DISCORD_TOKEN_KEY = "__discord_bot_token__";
const DISCORD_CONFIG_KEY = "ue-coworker-discord.json";
const MAX_MSG = 2000;       // Discord 普通消息字符限制
const MAX_EMBED = 4096;     // Embed description 字符限制

// ---- 配置接口 ----
export interface DiscordConfig {
  applicationId: string;
  allowedUserId: string;    // 仅响应此用户（白名单）
  guildId?: string;         // 可选：限制为特定服务器（加速命令注册）
  autoConnect?: boolean;    // UE Coworker 启动时自动连接
}

export type DiscordStatus = "offline" | "connecting" | "online" | "error";

// ---- 斜杠命令定义 ----
const commands = [
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("向桌面 UE Coworker 提问或下达指令（用桌面已选的 Provider）")
    .addStringOption((o) => o.setName("prompt").setDescription("你的问题或指令").setRequired(true)),

  new SlashCommandBuilder()
    .setName("session")
    .setDescription("管理 Discord 专用会话")
    .addSubcommand((sub) => sub.setName("new").setDescription("新建一个 Discord 会话并切换过去")
      .addStringOption((o) => o.setName("name").setDescription("会话名称（可选）")))
    .addSubcommand((sub) => sub.setName("list").setDescription("列出全部会话"))
    .addSubcommand((sub) => sub.setName("switch").setDescription("切换到指定会话")
      .addStringOption((o) => o.setName("target").setDescription("会话名称或序号").setRequired(true))),

  new SlashCommandBuilder()
    .setName("file")
    .setDescription("读取或列出文件")
    .addSubcommand((sub) =>
      sub.setName("read").setDescription("读取文件内容")
        .addStringOption((o) => o.setName("path").setDescription("文件路径（相对于项目根目录）").setRequired(true))
        .addIntegerOption((o) => o.setName("offset").setDescription("起始行号（可选）"))
        .addIntegerOption((o) => o.setName("limit").setDescription("最大读取行数（可选）")))
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("列出目录内容")
        .addStringOption((o) => o.setName("path").setDescription("目录路径（可选，默认项目根）"))),

  new SlashCommandBuilder()
    .setName("git")
    .setDescription("Git 操作")
    .addSubcommand((sub) => sub.setName("status").setDescription("查看 Git 状态"))
    .addSubcommand((sub) => sub.setName("log").setDescription("查看提交历史")
      .addIntegerOption((o) => o.setName("count").setDescription("显示条数（默认10）")))
    .addSubcommand((sub) => sub.setName("commit").setDescription("提交更改")
      .addStringOption((o) => o.setName("message").setDescription("提交信息").setRequired(true)))
    .addSubcommand((sub) => sub.setName("push").setDescription("推送到远程"))
    .addSubcommand((sub) => sub.setName("pull").setDescription("从远程拉取"))
    .addSubcommand((sub) => sub.setName("branches").setDescription("列出分支"))
    .addSubcommand((sub) => sub.setName("checkout").setDescription("切换分支")
      .addStringOption((o) => o.setName("branch").setDescription("分支名").setRequired(true))),

  new SlashCommandBuilder()
    .setName("run")
    .setDescription("执行终端命令")
    .addStringOption((o) => o.setName("command").setDescription("要执行的命令").setRequired(true))
    .addIntegerOption((o) => o.setName("timeout").setDescription("超时毫秒数（默认30000）")),

  new SlashCommandBuilder()
    .setName("search")
    .setDescription("在项目中搜索文本")
    .addStringOption((o) => o.setName("query").setDescription("搜索内容").setRequired(true))
    .addStringOption((o) => o.setName("path").setDescription("搜索目录（可选）"))
    .addStringOption((o) => o.setName("pattern").setDescription("文件过滤（如 *.ts）")),

  new SlashCommandBuilder()
    .setName("status")
    .setDescription("查看 UE Coworker 当前状态"),

  new SlashCommandBuilder()
    .setName("stop")
    .setDescription("中止正在运行的 Agent"),
];

// ---- 管理器 ----
export class DiscordBotManager {
  private client: Client | null = null;
  private config: DiscordConfig = { applicationId: "", allowedUserId: "" };
  private configPath: string;
  private status: DiscordStatus = "offline";
  private statusError = "";
  private secretsManager: SecretsManager;
  private bridge: DiscordRendererBridge;
  private getWindow: () => BrowserWindow | null;
  private getWorkingDir: () => string;
  // 是否有 /ask 正在等待渲染层返回（全局单飞，避免并发把桌面会话搅乱）。
  private askBusy = false;
  // 当前 /ask 的 interaction：followup 用它的 followUp()/showModal() 把提问发回
  // 同一频道。复用 interaction token（15 分钟有效、不需 guild 成员身份/特权 intent），
  // 避免 channels.fetch 在 User Install 模式下失败导致提问发不出来。
  private activeAsk: ChatInputCommandInteraction | null = null;

  constructor(
    secretsManager: SecretsManager,
    bridge: DiscordRendererBridge,
    getWindow: () => BrowserWindow | null,
    getWorkingDir: () => string
  ) {
    this.secretsManager = secretsManager;
    this.bridge = bridge;
    this.getWindow = getWindow;
    this.getWorkingDir = getWorkingDir;
    this.configPath = join(app.getPath("userData"), DISCORD_CONFIG_KEY);
  }

  // ---- 配置读写 ----
  async loadConfig(): Promise<DiscordConfig & { hasToken: boolean; status: DiscordStatus; error?: string }> {
    try {
      if (existsSync(this.configPath)) {
        const raw = await readFile(this.configPath, "utf-8");
        this.config = { ...this.config, ...JSON.parse(raw) };
      }
    } catch { /* 忽略解析错误 */ }
    const hasToken = await this.secretsManager.hasSecret(DISCORD_TOKEN_KEY);
    return {
      ...this.config,
      hasToken,
      status: this.status,
      error: this.statusError || undefined,
    };
  }

  async saveConfig(cfg: Partial<DiscordConfig> & { token?: string }): Promise<void> {
    if (cfg.applicationId !== undefined) this.config.applicationId = cfg.applicationId;
    if (cfg.allowedUserId !== undefined) this.config.allowedUserId = cfg.allowedUserId;
    if (cfg.guildId !== undefined) this.config.guildId = cfg.guildId;
    if (cfg.autoConnect !== undefined) this.config.autoConnect = cfg.autoConnect;

    // Token 单独走加密存储
    if (cfg.token !== undefined) {
      await this.secretsManager.setSecret(DISCORD_TOKEN_KEY, cfg.token);
    }

    const dir = join(this.configPath, "..");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    // 不存 token 到配置文件
    const { ...persistCfg } = this.config;
    await writeFile(this.configPath, JSON.stringify(persistCfg, null, 2), "utf-8");
  }

  // ---- 生命周期 ----
  async connect(): Promise<{ ok: boolean; error?: string }> {
    if (this.client) {
      return { ok: true }; // 已连接
    }

    const token = await this.secretsManager.getSecret(DISCORD_TOKEN_KEY);
    if (!token) return { ok: false, error: "未配置 Bot Token" };
    if (!this.config.applicationId) return { ok: false, error: "未配置 Application ID" };

    this.setStatus("connecting");

    try {
      // 注册斜杠命令
      const rest = new REST({ version: "10" }).setToken(token);
      const commandData = commands.map((c) => c.toJSON());

      if (this.config.guildId) {
        // Guild 命令：即时生效
        await rest.put(
          Routes.applicationGuildCommands(this.config.applicationId, this.config.guildId),
          { body: commandData }
        );
      } else {
        // 全局命令：最多 1 小时生效
        await rest.put(
          Routes.applicationCommands(this.config.applicationId),
          { body: commandData }
        );
      }

      // 创建 Client。斜杠命令（interaction）只需 Guilds，不需要任何特权 intent。
      // 之前申请 MessageContent（特权 intent）会在开发者门户未开启时导致 login
      // 报 "disallowed intents" → bot 实际没上线 → 命令全部 3 秒超时（"应用未响应"）。
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds],
      });

      this.client.on("ready", () => {
        this.setStatus("online");
        console.log("[Discord] Bot online:", this.client?.user?.tag);
      });

      this.client.on("interactionCreate", (interaction: Interaction) => {
        this.handleInteraction(interaction).catch((err) => {
          console.error("[Discord] Interaction error:", err);
        });
      });

      this.client.on("error", (err) => {
        console.error("[Discord] Client error:", err);
        this.setStatus("error", err.message);
      });

      this.client.on("disconnect", () => {
        this.setStatus("offline");
      });

      await this.client.login(token);
      return { ok: true };
    } catch (err: any) {
      this.setStatus("error", err?.message || String(err));
      this.client?.destroy();
      this.client = null;
      return { ok: false, error: err?.message || String(err) };
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    // 断开时清掉单飞锁：避免一轮卡死后永远挡住后续 /ask。
    this.askBusy = false;
    this.setStatus("offline");
  }

  getStatus(): { status: DiscordStatus; error?: string; botTag?: string } {
    return {
      status: this.status,
      error: this.statusError || undefined,
      botTag: this.client?.user?.tag,
    };
  }

  private setStatus(status: DiscordStatus, error = "") {
    this.status = status;
    this.statusError = error;
    // 通知渲染层状态变化
    try {
      const win = this.getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("discord:statusChange", { status, error });
      }
    } catch { /* 窗口不可用不影响 */ }
  }

  // ---- Interaction 处理 ----
  private async handleInteraction(interaction: Interaction): Promise<void> {
    // 用户白名单检查
    if (this.config.allowedUserId && interaction.user.id !== this.config.allowedUserId) {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: "⛔ 你没有权限使用此 Bot。", ephemeral: true });
      }
      return;
    }

    // 按钮交互不再使用（followup 走桌面端处理），直接忽略。
    if (interaction.isButton()) return;

    if (!interaction.isChatInputCommand()) return;

    const cmd = interaction.commandName;
    const cwd = this.getWorkingDir();

    // 这些命令需要一个已打开的项目（要在项目根下读文件/跑命令/查 git）。
    // /ask /session /status /stop 不依赖 cwd，放行。
    const needsCwd = cmd === "file" || cmd === "git" || cmd === "run" || cmd === "search";
    if (needsCwd && !cwd) {
      await interaction.reply("⚠️ UE Coworker 尚未打开任何项目，请先在桌面端打开一个项目。");
      return;
    }

    try {
      switch (cmd) {
        case "ask":
          await this.handleAsk(interaction);
          break;
        case "session":
          await this.handleSession(interaction);
          break;
        case "file":
          await this.handleFile(interaction, cwd);
          break;
        case "git":
          await this.handleGit(interaction, cwd);
          break;
        case "run":
          await this.handleRun(interaction, cwd);
          break;
        case "search":
          await this.handleSearch(interaction, cwd);
          break;
        case "status":
          await this.handleStatus(interaction, cwd);
          break;
        case "stop":
          await this.handleStop(interaction);
          break;
        default:
          await interaction.reply("❓ 未知命令: " + cmd);
      }
    } catch (err: any) {
      const errMsg = "❌ 命令执行出错: " + (err?.message || String(err));
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(truncate(errMsg, MAX_MSG));
        } else {
          await interaction.reply(truncate(errMsg, MAX_MSG));
        }
      } catch { /* 无法回复 */ }
    }
  }

  // ---- /ask: 转发给桌面端跑一轮（用桌面已选 Provider，消息出现在桌面会话里）----
  private async handleAsk(interaction: ChatInputCommandInteraction): Promise<void> {
    const prompt = interaction.options.getString("prompt", true);

    // 先 defer（Discord 要求 3 秒内确认；Agent 一轮可能很久）。
    await interaction.deferReply();

    // 全局单飞：一次只跑一个 /ask，避免并发把桌面会话搅乱。
    if (this.askBusy) {
      await interaction.editReply("⏳ 上一个 `/ask` 还在处理，请等它完成后再发。");
      return;
    }
    this.askBusy = true;
    this.activeAsk = interaction;

    try {
      const res = await this.bridge.runTurn(prompt, interaction.channelId);
      if (!res.ok) {
        await interaction.editReply("❌ " + (res.error || "桌面端未能处理该请求。"));
        return;
      }
      await sendLongMessage(interaction, res.text || "(无回复内容)");
    } finally {
      this.askBusy = false;
      this.activeAsk = null;
    }
  }

  // ---- /session: 管理 Discord 专用会话（new / list / switch）----
  private async handleSession(interaction: ChatInputCommandInteraction): Promise<void> {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply();

    let res: { ok: boolean; text?: string; error?: string };
    if (sub === "new") {
      res = await this.bridge.sessionOp("new", interaction.options.getString("name") || undefined);
    } else if (sub === "switch") {
      res = await this.bridge.sessionOp("switch", interaction.options.getString("target", true));
    } else {
      res = await this.bridge.sessionOp("list");
    }

    if (!res.ok) {
      await interaction.editReply("❌ " + (res.error || "操作失败。"));
      return;
    }
    await sendLongMessage(interaction, res.text || "(无内容)");
  }

  // ---- followup: 把 agent 的提问/计划卡转到发起的 Discord 频道，等用户回答 ----
  // 复用当前 /ask 的 interaction（followUp/showModal），不走 channels.fetch + send —— 后者
  // 在 User Install 模式（bot 非 guild 成员）会失败，且文字回复需特权 intent。interaction
  // token 15 分钟有效、授权在该频道回复、不依赖任何特权 intent。
  // 有选项 → 出按钮；无选项 → 出「点此回答」按钮 → 弹 Modal 输入框。超时/中止 → 返回空串。
  async askFollowup(req: {
    channelId: string;
    question: string;
    options?: string[];
    plan?: string;
    timeoutMs?: number;
  }): Promise<string> {
    const interaction = this.activeAsk;
    if (!interaction) return "";

    const timeoutMs = req.timeoutMs ?? 10 * 60 * 1000;
    const header = req.plan
      ? "📋 **计划审批**\n" + truncate(req.plan, MAX_EMBED) + "\n\n**" + req.question + "**"
      : "❓ **" + req.question + "**";
    const opts = (req.options || []).filter(Boolean).slice(0, 5);
    const userOk = (uid: string) => !this.config.allowedUserId || uid === this.config.allowedUserId;

    try {
      if (opts.length > 0) {
        // 选项 → 按钮
        const row = new ActionRowBuilder<ButtonBuilder>();
        opts.forEach((opt, i) =>
          row.addComponents(
            new ButtonBuilder().setCustomId("fu_" + i).setLabel(opt.slice(0, 80)).setStyle(ButtonStyle.Primary)
          )
        );
        const msg = await interaction.followUp({ content: truncate(header, MAX_MSG), components: [row] });
        try {
          const picked = await msg.awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: (i: any) => userOk(i.user.id),
            time: timeoutMs,
          });
          const idx = parseInt(String(picked.customId).replace("fu_", ""), 10);
          const answer = opts[idx] || "";
          await picked.update({ content: "✅ 已选择：**" + answer + "**", components: [] }).catch(() => {});
          return answer;
        } catch {
          await msg.edit({ content: truncate(header, MAX_MSG) + "\n⏱️ 超时，未作选择。", components: [] }).catch(() => {});
          return "";
        }
      }
      // 无选项 → 自由文本：先放一个「点此回答」按钮，点击后弹 Modal 输入框。
      return await this.askFreeText(interaction, header, timeoutMs, userOk);
    } catch {
      return "";
    }
  }

  // 自由文本回答：followUp 一个按钮 → 点击 → showModal 输入框 → 读取提交值。
  // 全程都是 interaction，不需要 GuildMessages/MessageContent intent。
  private async askFreeText(
    interaction: ChatInputCommandInteraction,
    header: string,
    timeoutMs: number,
    userOk: (uid: string) => boolean
  ): Promise<string> {
    const btnId = "fu_text_" + Date.now();
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(btnId).setLabel("✍️ 点此回答").setStyle(ButtonStyle.Primary)
    );
    const msg = await interaction.followUp({
      content: truncate(header + "\n点下方按钮输入你的答复。", MAX_MSG),
      components: [row],
    });
    try {
      const click = await msg.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i: any) => i.customId === btnId && userOk(i.user.id),
        time: timeoutMs,
      });
      const modalId = "fu_modal_" + Date.now();
      const modal = new ModalBuilder().setCustomId(modalId).setTitle("回答");
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("answer")
            .setLabel("你的答复")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000)
        )
      );
      await click.showModal(modal);
      const submit = await click.awaitModalSubmit({
        filter: (i: any) => i.customId === modalId && userOk(i.user.id),
        time: timeoutMs,
      });
      const answer = submit.fields.getTextInputValue("answer") || "";
      await submit.reply({ content: "✅ 已收到回答。", ephemeral: true }).catch(() => {});
      await msg.edit({ content: truncate(header, MAX_MSG) + "\n✅ 已回答。", components: [] }).catch(() => {});
      return answer;
    } catch {
      await msg.edit({ content: truncate(header, MAX_MSG) + "\n⏱️ 超时，未收到回答。", components: [] }).catch(() => {});
      return "";
    }
  }


  // ---- /file: 读取/列出文件 ----
  private async handleFile(interaction: ChatInputCommandInteraction, cwd: string): Promise<void> {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply();

    if (sub === "read") {
      const path = interaction.options.getString("path", true);
      const offset = interaction.options.getInteger("offset") ?? undefined;
      const limit = interaction.options.getInteger("limit") ?? undefined;
      const result = await executeTool("read_file", { file_path: path, offset, limit }, cwd);
      await sendLongMessage(interaction, result, path.split(/[\\/]/).pop() || "file");
    } else if (sub === "list") {
      const path = interaction.options.getString("path") || ".";
      const result = await executeTool("list_files", { dir_path: path }, cwd);
      await sendLongMessage(interaction, result);
    }
  }

  // ---- /git: Git 操作 ----
  private async handleGit(interaction: ChatInputCommandInteraction, cwd: string): Promise<void> {
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply();

    let result: string;
    switch (sub) {
      case "status": {
        const s = await gitManager.status(cwd);
        if (s.error) { result = "❌ " + s.error; break; }
        if (!s.isRepo) { result = "ℹ️ 当前项目不是 Git 仓库。"; break; }
        const staged = s.changes.filter((c) => c.staged);
        const modified = s.changes.filter((c) => c.unstaged && !c.untracked);
        const untracked = s.changes.filter((c) => c.untracked);
        const lines = [
          "📋 **Git 状态** — `" + (s.branch || "unknown") + "`"
            + (s.ahead || s.behind ? "  (↑" + s.ahead + " ↓" + s.behind + ")" : ""),
          "",
          ...staged.map((f) => "🟢 已暂存: `" + f.path + "`"),
          ...modified.map((f) => "🟡 已修改: `" + f.path + "`"),
          ...untracked.map((f) => "⚪ 未跟踪: `" + f.path + "`"),
        ];
        if (s.changes.length === 0) lines.push("✨ 工作目录干净");
        result = lines.join("\n");
        break;
      }
      case "log": {
        const count = interaction.options.getInteger("count") || 10;
        const logs = await gitManager.log(cwd, count);
        if (Array.isArray(logs) && logs.length > 0) {
          result = logs.map((l) =>
            "`" + (l.hash || "").slice(0, 7) + "` " + (l.subject || "") + " — " + (l.author || "") + " " + (l.date || "")
          ).join("\n");
        } else {
          result = "暂无提交记录。";
        }
        break;
      }
      case "commit": {
        const message = interaction.options.getString("message", true);
        const r = await gitManager.commit(cwd, message);
        result = r.ok ? "✅ 提交成功: `" + (r.hash || "").slice(0, 7) + "` " + message : "❌ " + (r.error || "提交失败");
        break;
      }
      case "push": {
        const r = await gitManager.push(cwd);
        result = r.ok ? "✅ 推送成功" : "❌ " + (r.error || "推送失败");
        break;
      }
      case "pull": {
        const r = await gitManager.pull(cwd);
        result = r.ok ? "✅ 拉取成功" : "❌ " + (r.error || "拉取失败");
        break;
      }
      case "branches": {
        const b = await gitManager.branches(cwd);
        const all = Array.isArray(b.all) ? b.all : [];
        result = all.map((name) =>
          (name === b.current ? "▶ " : "  ") + "`" + name + "`"
        ).join("\n") || "暂无分支。";
        break;
      }
      case "checkout": {
        const branch = interaction.options.getString("branch", true);
        const r = await gitManager.checkout(cwd, branch);
        result = r.ok ? "✅ 已切换到分支: `" + branch + "`" : "❌ " + (r.error || "切换失败");
        break;
      }
      default:
        result = "未知子命令: " + sub;
    }

    await sendLongMessage(interaction, result);
  }

  // ---- /run: 执行终端命令 ----
  private async handleRun(interaction: ChatInputCommandInteraction, cwd: string): Promise<void> {
    const command = interaction.options.getString("command", true);
    const timeout = interaction.options.getInteger("timeout") ?? 30000;
    await interaction.deferReply();

    const result = await executeTool("run_command", { command, timeout }, cwd);
    await sendLongMessage(interaction, "```\n" + result + "\n```", "output.txt");
  }

  // ---- /search: 搜索项目文件 ----
  private async handleSearch(interaction: ChatInputCommandInteraction, cwd: string): Promise<void> {
    const query = interaction.options.getString("query", true);
    const dirPath = interaction.options.getString("path") || ".";
    const filePattern = interaction.options.getString("pattern") || undefined;
    await interaction.deferReply();

    const result = await executeTool("search_files", {
      pattern: query, dir_path: dirPath, file_pattern: filePattern,
    }, cwd);
    await sendLongMessage(interaction, result, "search-results.txt");
  }

  // ---- /status: 当前状态 ----
  private async handleStatus(interaction: ChatInputCommandInteraction, cwd: string): Promise<void> {
    const mcpStatus = mcpManager.statusSummary();
    const mcpOnline = mcpStatus.filter((s: any) => s.status === "connected").length;

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle("📊 UE Coworker 状态")
      .addFields(
        { name: "📁 项目路径", value: "`" + (cwd || "（未打开项目）") + "`", inline: false },
        { name: "🤖 /ask", value: this.askBusy ? "🟢 处理中" : "💤 空闲", inline: true },
        { name: "🔌 MCP", value: mcpOnline + "/" + mcpStatus.length + " 已连接", inline: true },
        { name: "🛠️ 工具数", value: String(TOOL_DEFINITIONS.length), inline: true },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  // ---- /stop: 中止正在跑的 /ask（委托渲染层停当前 Discord 会话）----
  private async handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply();
    const res = await this.bridge.sessionOp("switch", "__stop__");
    if (res.ok) {
      await interaction.editReply("🛑 已发送停止信号。");
    } else {
      await interaction.editReply("ℹ️ " + (res.error || "当前没有正在运行的请求。"));
    }
  }
}

// ---- 辅助函数 ----

/** 截断文本到指定长度 */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 20) + "\n\n…（已截断）";
}

/**
 * 发送长消息到 Discord，自动处理长度限制：
 * - ≤2000: 直接发
 * - ≤4096: 用 Embed
 * - >4096: 上传为文件附件
 */
async function sendLongMessage(
  interaction: ChatInputCommandInteraction,
  content: string,
  filename?: string
): Promise<void> {
  if (!content) content = "(空)";

  if (content.length <= MAX_MSG) {
    await interaction.editReply(content);
    return;
  }

  if (content.length <= MAX_EMBED) {
    const embed = new EmbedBuilder()
      .setDescription(content)
      .setColor(0x5865F2);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // 超长内容 → 文件附件
  const buf = Buffer.from(content, "utf-8");
  const name = filename || "output.txt";
  const attachment = new AttachmentBuilder(buf, { name });
  await interaction.editReply({
    content: "📄 输出过长（" + content.length + " 字符），已作为文件发送：",
    files: [attachment],
  });
}

// 导出单例（延迟初始化，在 ipc-handlers 中实例化）
export let discordBotManager: DiscordBotManager | null = null;

export function initDiscordBotManager(
  secretsManager: SecretsManager,
  bridge: DiscordRendererBridge,
  getWindow: () => BrowserWindow | null,
  getWorkingDir: () => string
): DiscordBotManager {
  discordBotManager = new DiscordBotManager(secretsManager, bridge, getWindow, getWorkingDir);
  return discordBotManager;
}
