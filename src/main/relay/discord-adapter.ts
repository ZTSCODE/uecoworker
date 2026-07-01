/**
 * DiscordAdapter —— Discord 平台网关适配器。
 *
 * 把 Discord 斜杠命令翻译成统一协议的 RelayCommand 上报给主进程 RelayCore；把主进程
 * 发回的 prompt（提问/计划审批）用 interaction 的 followUp/showModal 呈现，答复翻译成
 * RelayAnswer；把 emit（结果/错误）editReply 回原交互。
 *
 * 关键设计沿用旧 discord-bot-manager（见记忆 discord-relay-architecture）：
 * - 只用 Guilds intent，斜杠命令不需要任何特权 intent（MessageContent 会导致 login 失败）。
 * - followup 复用当前 /ask 的 interaction（followUp/showModal），不走 channels.fetch+send
 *   —— 后者在 User Install 模式失败。interaction token 15 分钟有效、授权该频道。
 * - 命令的实际执行（agent/git/file/run）全交给主进程，adapter 不碰业务。
 *
 * 与旧实现的差别：bot 现在跑在 utilityProcess，业务经 RelayCommand 异步回主进程，
 * 故 adapter 侧靠 replyTo/promptId 关联请求与结果，而非进程内 await bridge。
 */
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ComponentType } from "discord.js";
import type { ChatInputCommandInteraction, Interaction } from "discord.js";
import type { RelayAdapter, AdapterHost } from "./adapter";
import type { RelayPrompt, RelayEmit } from "./protocol";

const MAX_MSG = 2000;
const MAX_EMBED = 4096;

// 斜杠命令定义（与旧实现一致）。
const commands = [
  new SlashCommandBuilder().setName("ask")
    .setDescription("向桌面 UE Coworker 提问或下达指令（用桌面已选的 Provider）")
    .addStringOption((o) => o.setName("prompt").setDescription("你的问题或指令").setRequired(true)),
  new SlashCommandBuilder().setName("session").setDescription("管理 Discord 专用会话")
    .addSubcommand((s) => s.setName("new").setDescription("新建一个 Discord 会话并切换过去")
      .addStringOption((o) => o.setName("name").setDescription("会话名称（可选）")))
    .addSubcommand((s) => s.setName("list").setDescription("列出全部会话"))
    .addSubcommand((s) => s.setName("switch").setDescription("切换到指定会话")
      .addStringOption((o) => o.setName("target").setDescription("会话名称或序号").setRequired(true))),
  new SlashCommandBuilder().setName("file").setDescription("读取或列出文件")
    .addSubcommand((s) => s.setName("read").setDescription("读取文件内容")
      .addStringOption((o) => o.setName("path").setDescription("文件路径（相对于项目根目录）").setRequired(true))
      .addIntegerOption((o) => o.setName("offset").setDescription("起始行号（可选）"))
      .addIntegerOption((o) => o.setName("limit").setDescription("最大读取行数（可选）")))
    .addSubcommand((s) => s.setName("list").setDescription("列出目录内容")
      .addStringOption((o) => o.setName("path").setDescription("目录路径（可选，默认项目根）"))),
  new SlashCommandBuilder().setName("git").setDescription("Git 操作")
    .addSubcommand((s) => s.setName("status").setDescription("查看 Git 状态"))
    .addSubcommand((s) => s.setName("log").setDescription("查看提交历史")
      .addIntegerOption((o) => o.setName("count").setDescription("显示条数（默认10）")))
    .addSubcommand((s) => s.setName("commit").setDescription("提交更改")
      .addStringOption((o) => o.setName("message").setDescription("提交信息").setRequired(true)))
    .addSubcommand((s) => s.setName("push").setDescription("推送到远程"))
    .addSubcommand((s) => s.setName("pull").setDescription("从远程拉取"))
    .addSubcommand((s) => s.setName("branches").setDescription("列出分支"))
    .addSubcommand((s) => s.setName("checkout").setDescription("切换分支")
      .addStringOption((o) => o.setName("branch").setDescription("分支名").setRequired(true))),
  new SlashCommandBuilder().setName("run").setDescription("执行终端命令")
    .addStringOption((o) => o.setName("command").setDescription("要执行的命令").setRequired(true))
    .addIntegerOption((o) => o.setName("timeout").setDescription("超时毫秒数（默认30000）")),
  new SlashCommandBuilder().setName("search").setDescription("在项目中搜索文本")
    .addStringOption((o) => o.setName("query").setDescription("搜索内容").setRequired(true))
    .addStringOption((o) => o.setName("path").setDescription("搜索目录（可选）"))
    .addStringOption((o) => o.setName("pattern").setDescription("文件过滤（如 *.ts）")),
  new SlashCommandBuilder().setName("status").setDescription("查看 UE Coworker 当前状态"),
  new SlashCommandBuilder().setName("stop").setDescription("中止正在运行的 Agent"),
  new SlashCommandBuilder().setName("provider").setDescription("列出或切换供应商与模型")
    .addStringOption((o) => o.setName("target").setDescription("切换目标：供应商序号或 供应商.模型（如 2 或 2.3）；留空则列出")),
];

export class DiscordAdapter implements RelayAdapter {
  private host: AdapterHost;
  private client: Client | null = null;
  private allowedUserId = "";
  private applicationId = "";
  private guildId = "";

  // replyTo -> 发起命令的 interaction（结果 editReply 回它）。
  private pendingReplies = new Map<string, ChatInputCommandInteraction>();
  // promptId -> 撤卡函数（cancelPrompt 调用，清理按钮收集器并改文案）。
  private promptCancels = new Map<string, () => void>();
  // /ask 单飞锁：一次只跑一个 ask（沿用旧实现，避免并发搅乱会话）。
  private askBusy = false;
  // 当前 /ask 的 interaction：prompt 用它的 followUp/showModal。
  private activeAsk: ChatInputCommandInteraction | null = null;
  private seq = 0;

  constructor(host: AdapterHost) { this.host = host; }

  async connect(token: string, config: Record<string, any>): Promise<void> {
    this.allowedUserId = String(config.allowedUserId || "");
    this.applicationId = String(config.applicationId || "");
    this.guildId = String(config.guildId || "");
    this.host.emit({ type: "status", source: "discord", status: "connecting" });
    try {
      const rest = new REST({ version: "10" }).setToken(token);
      const body = commands.map((c) => c.toJSON());
      if (this.guildId) {
        await rest.put(Routes.applicationGuildCommands(this.applicationId, this.guildId), { body });
      } else {
        await rest.put(Routes.applicationCommands(this.applicationId), { body });
      }
      this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
      this.client.on("ready", () => {
        this.host.emit({ type: "status", source: "discord", status: "online", botTag: this.client?.user?.tag });
      });
      this.client.on("error", (err) => {
        this.host.emit({ type: "status", source: "discord", status: "error", error: err.message });
      });
      this.client.on("interactionCreate", (it: Interaction) => {
        this.onInteraction(it).catch((e) => console.error("[discord-adapter]", e));
      });
      await this.client.login(token);
    } catch (err: any) {
      this.host.emit({ type: "status", source: "discord", status: "error", error: err?.message || String(err) });
      this.client?.destroy();
      this.client = null;
    }
  }

  async disconnect(): Promise<void> {
    this.client?.destroy();
    this.client = null;
    this.askBusy = false;
    this.pendingReplies.clear();
    this.promptCancels.clear();
    this.host.emit({ type: "status", source: "discord", status: "offline" });
  }

  private userOk(uid: string): boolean {
    return !this.allowedUserId || uid === this.allowedUserId;
  }

  // ---- 交互入口：翻译成 RelayCommand 上报 ----
  private async onInteraction(it: Interaction): Promise<void> {
    if (it.isButton()) return;                  // prompt 的按钮在收集器里处理
    if (!it.isChatInputCommand()) return;
    if (this.allowedUserId && it.user.id !== this.allowedUserId) {
      if (it.isRepliable()) await it.reply({ content: "⛔ 你没有权限使用此 Bot。", ephemeral: true });
      return;
    }

    const cmd = it.commandName;
    const replyTo = "dc-" + Date.now() + "-" + (++this.seq);
    const base = { source: "discord" as const, channelId: it.channelId, userId: it.user.id, replyTo };

    if (cmd === "ask") {
      await it.deferReply();
      if (this.askBusy) { await it.editReply("⏳ 上一个 `/ask` 还在处理，请等它完成后再发。"); return; }
      this.askBusy = true;
      this.activeAsk = it;
      this.pendingReplies.set(replyTo, it);
      this.host.emit({ ...base, type: "command", kind: "ask", prompt: it.options.getString("prompt", true) });
      return;
    }

    if (cmd === "session") {
      await it.deferReply();
      this.pendingReplies.set(replyTo, it);
      const sub = it.options.getSubcommand();
      const arg = sub === "new" ? (it.options.getString("name") || undefined)
        : sub === "switch" ? it.options.getString("target", true) : undefined;
      this.host.emit({ ...base, type: "command", kind: "session", op: sub as any, arg });
      return;
    }

    if (cmd === "stop") {
      await it.deferReply();
      this.pendingReplies.set(replyTo, it);
      this.host.emit({ ...base, type: "command", kind: "session", op: "switch", arg: "__stop__" });
      return;
    }

    if (cmd === "status") {
      await it.deferReply();
      this.pendingReplies.set(replyTo, it);
      this.host.emit({ ...base, type: "command", kind: "tool", tool: "status", args: {} });
      return;
    }

    // file / git / run / search → tool 命令
    if (cmd === "file" || cmd === "git" || cmd === "run" || cmd === "search") {
      await it.deferReply();
      this.pendingReplies.set(replyTo, it);
      const args = this.toolArgs(cmd, it);
      this.host.emit({ ...base, type: "command", kind: "tool", tool: args.tool, args: args.args });
      return;
    }

    if (cmd === "provider") {
      await it.deferReply();
      this.pendingReplies.set(replyTo, it);
      const target = (it.options.getString("target") || "").trim();
      this.host.emit({ ...base, type: "command", kind: "provider", op: target ? "switch" : "list", arg: target || undefined });
      return;
    }

    await it.reply("❓ 未知命令: " + cmd);
  }

  // 把 file/git/run/search 的选项打平成 { tool, args }，主进程据此执行。
  private toolArgs(cmd: string, it: ChatInputCommandInteraction): { tool: string; args: Record<string, any> } {
    if (cmd === "run") {
      return { tool: "run", args: { command: it.options.getString("command", true), timeout: it.options.getInteger("timeout") ?? 30000 } };
    }
    if (cmd === "search") {
      return { tool: "search", args: { query: it.options.getString("query", true), path: it.options.getString("path") || ".", pattern: it.options.getString("pattern") || undefined } };
    }
    const sub = it.options.getSubcommand();
    if (cmd === "file") {
      if (sub === "read") return { tool: "file.read", args: { path: it.options.getString("path", true), offset: it.options.getInteger("offset") ?? undefined, limit: it.options.getInteger("limit") ?? undefined } };
      return { tool: "file.list", args: { path: it.options.getString("path") || "." } };
    }
    // git
    const args: Record<string, any> = {};
    if (sub === "log") args.count = it.options.getInteger("count") || 10;
    if (sub === "commit") args.message = it.options.getString("message", true);
    if (sub === "checkout") args.branch = it.options.getString("branch", true);
    return { tool: "git." + sub, args };
  }

  // ---- 结果回送 ----
  emit(msg: RelayEmit): void {
    if (msg.kind === "typing") return;          // Discord 已 defer，无需额外 typing
    const it = msg.replyTo ? this.pendingReplies.get(msg.replyTo) : null;
    if (msg.replyTo) this.pendingReplies.delete(msg.replyTo);
    // ask 结束：解锁单飞。
    if (this.activeAsk && it === this.activeAsk) { this.askBusy = false; this.activeAsk = null; }
    if (!it) return;
    this.sendLong(it, msg.text || "(空)", msg.filename).catch((e) => console.error("[discord-adapter] emit:", e));
  }

  // ---- 提问：复用 activeAsk 的 interaction ----
  prompt(req: RelayPrompt): void {
    const it = this.activeAsk;
    if (!it) { this.host.emit({ type: "answer", promptId: req.promptId, answer: "" }); return; }
    this.runPrompt(it, req).catch((e) => {
      console.error("[discord-adapter] prompt:", e);
      this.host.emit({ type: "answer", promptId: req.promptId, answer: "" });
    });
  }

  cancelPrompt(promptId: string): void {
    const cancel = this.promptCancels.get(promptId);
    if (cancel) { this.promptCancels.delete(promptId); cancel(); }
  }

  private async runPrompt(it: ChatInputCommandInteraction, req: RelayPrompt): Promise<void> {
    const timeoutMs = req.timeoutMs ?? 10 * 60 * 1000;
    const header = req.plan
      ? "📋 **计划审批**\n" + truncate(req.plan, MAX_EMBED) + "\n\n**" + req.question + "**"
      : "❓ **" + req.question + "**";
    const opts = (req.options || []).filter(Boolean).slice(0, 5);
    let settled = false;
    const settle = (answer: string) => {
      if (settled) return;
      settled = true;
      this.promptCancels.delete(req.promptId);
      this.host.emit({ type: "answer", promptId: req.promptId, answer });
    };

    if (opts.length > 0) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      opts.forEach((opt, i) => row.addComponents(
        new ButtonBuilder().setCustomId("fu_" + i).setLabel(opt.slice(0, 80)).setStyle(ButtonStyle.Primary)));
      const m = await it.followUp({ content: truncate(header, MAX_MSG), components: [row] });
      const collector = m.createMessageComponentCollector({ componentType: ComponentType.Button, time: timeoutMs });
      this.promptCancels.set(req.promptId, () => {
        collector.stop("cancel");
        m.edit({ content: truncate(header, MAX_MSG) + "\n↩️ 已由其它方式处理。", components: [] }).catch(() => {});
      });
      collector.on("collect", async (picked) => {
        if (!this.userOk(picked.user.id)) return;
        const idx = parseInt(String(picked.customId).replace("fu_", ""), 10);
        const answer = opts[idx] || "";
        await picked.update({ content: "✅ 已选择：**" + answer + "**", components: [] }).catch(() => {});
        collector.stop("picked");
        settle(answer);
      });
      collector.on("end", (_c, reason) => {
        if (reason !== "picked" && reason !== "cancel") {
          m.edit({ content: truncate(header, MAX_MSG) + "\n⏱️ 超时，未作选择。", components: [] }).catch(() => {});
          settle("");
        } else if (reason === "cancel") {
          settle("");
        }
      });
      return;
    }

    // 自由文本：按钮 → Modal
    const btnId = "fu_text_" + req.promptId;
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(btnId).setLabel("✍️ 点此回答").setStyle(ButtonStyle.Primary));
    const m = await it.followUp({ content: truncate(header + "\n点下方按钮输入你的答复。", MAX_MSG), components: [row] });
    const collector = m.createMessageComponentCollector({ componentType: ComponentType.Button, time: timeoutMs });
    this.promptCancels.set(req.promptId, () => {
      collector.stop("cancel");
      m.edit({ content: truncate(header, MAX_MSG) + "\n↩️ 已由其它方式处理。", components: [] }).catch(() => {});
    });
    collector.on("collect", async (click) => {
      if (click.customId !== btnId || !this.userOk(click.user.id)) return;
      const modalId = "fu_modal_" + req.promptId;
      const modal = new ModalBuilder().setCustomId(modalId).setTitle("回答");
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("answer").setLabel("你的答复").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000)));
      await click.showModal(modal);
      try {
        const submit = await click.awaitModalSubmit({ filter: (i: any) => i.customId === modalId && this.userOk(i.user.id), time: timeoutMs });
        const answer = submit.fields.getTextInputValue("answer") || "";
        await submit.reply({ content: "✅ 已收到回答。", ephemeral: true }).catch(() => {});
        await m.edit({ content: truncate(header, MAX_MSG) + "\n✅ 已回答。", components: [] }).catch(() => {});
        collector.stop("picked");
        settle(answer);
      } catch {
        await m.edit({ content: truncate(header, MAX_MSG) + "\n⏱️ 超时，未收到回答。", components: [] }).catch(() => {});
        collector.stop("timeout");
        settle("");
      }
    });
    collector.on("end", (_c, reason) => {
      if (reason !== "picked" && reason !== "cancel") settle("");
      else if (reason === "cancel") settle("");
    });
  }

  // 长消息分档：≤2000 直接发，≤4096 Embed，>4096 文件附件。
  private async sendLong(it: ChatInputCommandInteraction, content: string, filename?: string): Promise<void> {
    if (!content) content = "(空)";
    if (content.length <= MAX_MSG) { await it.editReply(content); return; }
    if (content.length <= MAX_EMBED) {
      await it.editReply({ embeds: [new EmbedBuilder().setDescription(content).setColor(0x5865F2)] });
      return;
    }
    const buf = Buffer.from(content, "utf-8");
    await it.editReply({
      content: "📄 输出过长（" + content.length + " 字符），已作为文件发送：",
      files: [new AttachmentBuilder(buf, { name: filename || "output.txt" })],
    });
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 20) + "\n\n…（已截断）";
}
