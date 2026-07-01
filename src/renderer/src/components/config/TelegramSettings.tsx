import { useState, useEffect, useMemo } from "react";
import { Send, Wifi, WifiOff, Loader2, Check, AlertCircle, CircleAlert, Info, ListChecks, Command } from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { PageHeader, Hint, Collapsible, PrimaryButton } from "../ui/settings";

type RelayStatus = "offline" | "connecting" | "online" | "error";

interface TelegramConfig {
  allowedUserId: string;
  autoConnect?: boolean;
  hasToken: boolean;
  status: RelayStatus;
  error?: string;
  botTag?: string;
}

// Telegram Bot Token 形如 123456789:ABCdef...（数字:字母数字串）。
function isValidBotToken(token: string): boolean {
  return /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(token.trim());
}
// Telegram 用户 ID 为纯数字。
function isValidUserId(id: string): boolean {
  return /^\d{4,}$/.test(id.trim());
}

type FieldStatus = "empty" | "valid" | "invalid";

function FieldBadge({ status, validText, invalidText }: { status: FieldStatus; validText: string; invalidText: string }) {
  if (status === "empty") return null;
  if (status === "valid") {
    return <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-500 font-medium"><Check size={10} strokeWidth={3} /> {validText}</span>;
  }
  return <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-500 font-medium"><CircleAlert size={10} /> {invalidText}</span>;
}

export function TelegramSettings() {
  const t = useT();
  const [cfg, setCfg] = useState<TelegramConfig>({ allowedUserId: "", autoConnect: false, hasToken: false, status: "offline" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [userIdDraft, setUserIdDraft] = useState("");
  const [liveStatus, setLiveStatus] = useState<RelayStatus>("offline");
  const [liveError, setLiveError] = useState("");
  const [botTag, setBotTag] = useState("");
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const c = await (window.api as any).relayGetConfig("telegram");
      setCfg(c);
      setUserIdDraft(c.allowedUserId || "");
      setLiveStatus(c.status || "offline");
      setBotTag(c.botTag || "");
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // 监听状态变化（只取 telegram 来源）。
  useEffect(() => {
    const off = (window.api as any).onRelayStatusChange?.((data: { source: string; status: string; error?: string; botTag?: string }) => {
      if (data.source !== "telegram") return;
      setLiveStatus(data.status as RelayStatus);
      setLiveError(data.error || "");
      setConnecting(false);
      if (data.botTag) setBotTag(data.botTag);
      if (data.status === "offline") setBotTag("");
    });
    return () => { if (typeof off === "function") off(); };
  }, []);

  const tokenStatus: FieldStatus = useMemo(() => {
    if (!tokenDraft.trim() && !cfg.hasToken) return "empty";
    if (!tokenDraft.trim() && cfg.hasToken) return "valid";
    return isValidBotToken(tokenDraft) ? "valid" : "invalid";
  }, [tokenDraft, cfg.hasToken]);

  const userIdStatus: FieldStatus = useMemo(() => {
    if (!userIdDraft.trim()) return "empty";
    return isValidUserId(userIdDraft) ? "valid" : "invalid";
  }, [userIdDraft]);

  const connectBlockers = useMemo(() => {
    const issues: string[] = [];
    if (tokenStatus === "empty") issues.push(t("未填写 Bot Token", "Bot Token not entered"));
    if (tokenStatus === "invalid") issues.push(t("Bot Token 格式错误", "Bot Token format invalid"));
    if (tokenStatus === "empty" && !cfg.hasToken) issues.push(t("未保存 Bot Token", "Bot Token not saved"));
    if (tokenDraft.trim()) issues.push(t("配置有未保存的更改", "Config has unsaved changes"));
    return issues;
  }, [t, tokenStatus, cfg.hasToken, tokenDraft]);

  const canConnect = connectBlockers.length === 0 && cfg.hasToken;

  const canSave = useMemo(() => {
    if (tokenDraft.trim() && !isValidBotToken(tokenDraft)) return false;
    if (userIdDraft.trim() && !isValidUserId(userIdDraft)) return false;
    return cfg.hasToken || !!tokenDraft.trim();
  }, [tokenDraft, userIdDraft, cfg.hasToken]);

  const saveConfig = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const update: any = { allowedUserId: userIdDraft.trim() };
      if (tokenDraft.trim()) update.token = tokenDraft.trim();
      await (window.api as any).relaySaveConfig("telegram", update);
      setTokenDraft("");
      await load();
      setSaveResult({ ok: true, msg: t("配置已保存，现在可以点击「连接」。", "Config saved. You can now click \"Connect\".") });
      setTimeout(() => setSaveResult((prev) => prev?.ok ? null : prev), 4000);
    } catch (e: any) {
      setSaveResult({ ok: false, msg: t("保存失败: ", "Save failed: ") + (e?.message || t("未知错误", "Unknown error")) });
    }
    setSaving(false);
  };

  const toggleConnect = async () => {
    if (liveStatus === "online" || liveStatus === "connecting") {
      await (window.api as any).relayDisconnect("telegram");
      setLiveStatus("offline");
      setBotTag("");
    } else {
      setConnecting(true);
      setLiveError("");
      const result = await (window.api as any).relayConnect("telegram");
      if (!result.ok) {
        setLiveError(result.error || t("连接失败", "Connection failed"));
        setConnecting(false);
        setLiveStatus("error");
      }
    }
  };

  const statusIcon = () => {
    switch (liveStatus) {
      case "online": return <Wifi size={14} className="text-emerald-500" />;
      case "connecting": return <Loader2 size={14} className="animate-spin text-amber-500" />;
      case "error": return <AlertCircle size={14} className="text-destructive" />;
      default: return <WifiOff size={14} className="text-muted-foreground" />;
    }
  };

  const statusText = () => {
    switch (liveStatus) {
      case "online": return t("在线", "Online") + (botTag ? " — @" + botTag : "");
      case "connecting": return t("连接中…", "Connecting…");
      case "error": return t("错误", "Error");
      default: return t("离线", "Offline");
    }
  };

  if (loading) return <p className="text-xs text-muted-foreground">{t("加载中…", "Loading…")}</p>;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Send}
        title={t("Telegram 远程控制", "Telegram Remote Control")}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {t("手机上远程控制，私聊直接发消息提问", "Control from your phone — just message in a private chat")}
            <Hint>
              {t("通过 Telegram Bot 远程控制 UE Coworker，功能最全、体验最好。私聊里直接发消息即可提问，无需命令前缀；/file、/git、/run 等仍用斜杠命令。先在浏览器搜索 telegram botfather，发送 /newbot 创建 Bot 拿到 Token。", "Control UE Coworker via a Telegram Bot — the most full-featured option. In a private chat, just send a message to ask, no prefix needed; /file, /git, /run etc. still use slash commands. Search your browser for telegram botfather, send /newbot to create a bot and get a Token.")}
            </Hint>
          </span>
        }
      />

      {/* 状态栏 */}
      <div className={cn("rounded-xl ring-1 px-4 py-3 flex items-center justify-between transition-colors",
        liveStatus === "online" ? "ring-emerald-500/30 bg-emerald-500/5"
        : liveStatus === "error" ? "ring-destructive/30 bg-destructive/5"
        : "ring-border/40 bg-muted/30")}>
        <div className="flex items-center gap-2">
          {statusIcon()}
          <span className="text-xs font-medium text-foreground">{statusText()}</span>
        </div>
        <button
          onClick={toggleConnect}
          disabled={connecting || (liveStatus !== "online" && !canConnect)}
          title={!canConnect && liveStatus !== "online" ? t("无法连接: ", "Cannot connect: ") + connectBlockers.join(t("、", ", ")) : undefined}
          className={cn("px-3.5 py-1.5 text-[11px] rounded-lg font-medium transition-colors whitespace-nowrap",
            liveStatus === "online"
              ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
              : "bg-foreground text-background hover:opacity-90",
            (connecting || (liveStatus !== "online" && !canConnect)) && "opacity-40 cursor-not-allowed"
          )}>
          {liveStatus === "online" ? t("断开", "Disconnect") : connecting ? t("连接中…", "Connecting…") : t("连接", "Connect")}
        </button>
      </div>

      {!canConnect && liveStatus !== "online" && connectBlockers.length > 0 && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-500">
          <Info size={12} className="shrink-0 mt-0.5" />
          <span>{t("无法连接: ", "Cannot connect: ")}{connectBlockers.join(t("、", ", "))}</span>
        </div>
      )}

      {liveError && <p className="text-[11px] text-destructive">{liveError}</p>}

      {/* 配置表单 */}
      <div className="space-y-3">
        {/* Bot Token */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-muted-foreground">Bot Token <span className="text-destructive">*</span></label>
            <FieldBadge status={tokenStatus}
              validText={cfg.hasToken ? t("已保存", "Saved") : t("格式正确", "Valid format")}
              invalidText={t("格式错误 — 应为 数字:字母串", "Invalid format — should be digits:letters")} />
          </div>
          <input type="password" value={tokenDraft} onChange={(e) => setTokenDraft(e.target.value)}
            placeholder={cfg.hasToken ? t("•••••••• (已保存，输入以替换)", "•••••••• (saved, type to replace)") : t("粘贴 BotFather 给的 Token（如 123456:ABC-DEF...）", "Paste the Token from BotFather (e.g. 123456:ABC-DEF...)")}
            className={cn("w-full px-3 py-2 text-xs bg-muted/50 rounded-lg ring-1 focus:ring-2 outline-none text-foreground font-mono transition-all",
              tokenStatus === "invalid" ? "ring-amber-500/50 focus:ring-amber-500/50" : "ring-border/40 focus:ring-ring/40")} />
        </div>

        {/* User ID */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-muted-foreground">{t("你的 Telegram User ID（白名单）", "Your Telegram User ID (whitelist)")}</label>
            <FieldBadge status={userIdStatus} validText={t("格式正确", "Valid format")} invalidText={t("应为纯数字", "Should be digits")} />
          </div>
          <input value={userIdDraft} onChange={(e) => setUserIdDraft(e.target.value)}
            placeholder={t("向 @userinfobot 发消息获取你的数字 ID", "Message @userinfobot to get your numeric ID")}
            className={cn("w-full px-3 py-2 text-xs bg-muted/50 rounded-lg ring-1 focus:ring-2 outline-none text-foreground font-mono transition-all",
              userIdStatus === "invalid" ? "ring-amber-500/50 focus:ring-amber-500/50" : "ring-border/40 focus:ring-ring/40")} />
          <p className="text-[10px] text-muted-foreground mt-1">{t("只有此用户的消息会被响应。不填则所有人可用（不建议）。", "Only this user's messages will be handled. Leave empty to allow everyone (not recommended).")}</p>
        </div>

        {/* 保存按钮 + 反馈 */}
        <div className="flex items-center gap-3 flex-wrap">
          <PrimaryButton onClick={saveConfig} disabled={saving || !canSave}
            title={!canSave ? t("请先正确填写 Bot Token", "Please enter a valid Bot Token first") : undefined}>
            {saving ? t("保存中…", "Saving…") : t("保存配置", "Save Config")}
          </PrimaryButton>
          {saveResult && (
            <span className={cn("text-[11px] font-medium", saveResult.ok ? "text-emerald-500" : "text-destructive")}>{saveResult.msg}</span>
          )}
        </div>
      </div>

      {/* 使用说明 */}
      <Collapsible icon={ListChecks} title={t("配置步骤", "Setup Steps")}>
        <ol className="text-[11px] text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>{t("在浏览器搜索 ", "Search in your browser for ")}<strong className="text-foreground">telegram botfather</strong>{t("，打开结果进入 Telegram，给它发送 /newbot 按提示创建 Bot", ", open the result into Telegram, send it /newbot and follow the prompts to create a bot")}</li>
          <li>{t("复制它给你的 ", "Copy the ")}<strong className="text-foreground">Token</strong>{t(" 粘贴到上方", " it gives you and paste it above")}</li>
          <li>{t("在浏览器搜索 ", "Search in your browser for ")}<strong className="text-foreground">telegram userinfobot</strong>{t("，进入后给它发条消息拿到你的数字 User ID，填入上方", ", open it, send it a message to get your numeric User ID, and paste it above")}</li>
          <li>{t("点「保存配置」后点「连接」", "Click \"Save Config\", then \"Connect\"")}</li>
          <li>{t("在 Telegram 里搜索你刚创建的 Bot 的 username，点开并开启聊天", "In Telegram, search for the username of the bot you just created, open it and start the chat")}</li>
          <li>{t("在该私聊里直接发消息即可开始", "Send a message in that private chat to get started")}</li>
        </ol>
      </Collapsible>

      {/* 命令列表 */}
      <Collapsible icon={Command} title={t("可用命令", "Available Commands")}>
        <p className="text-[10px] text-muted-foreground mb-2">{t("输入框打 / 自动补全命令；命令无需接内容，点菜单按钮或按提示回复即可。也可直接发图片/文件给 AI。", "Type / for autocomplete; commands take no trailing args — tap menu buttons or reply as prompted. You can also send images/files directly to the AI.")}</p>
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          {[
            [t("（直接发消息/图片）", "(send a message/image)"), t("提问；发图片即让 AI 看图", "Ask; send an image to let the AI see it")],
            ["/project", t("切换/新建项目（最近或逐级选目录）", "Switch/create project (recent or pick dir)")],
            ["/mode", t("查看/切换权限模式", "View/switch permission mode")],
            ["/provider", t("列出/切换供应商与模型", "List/switch providers & models")],
            ["/plan", t("切到计划模式（只读）", "Switch to plan mode (read-only)")],
            ["/session", t("会话 新建/列表/切换", "Sessions: new/list/switch")],
            ["/clear", t("新建空白对话", "New blank conversation")],
            ["/file", t("读取/列出文件", "Read/list files")],
            ["/git", t("Git 操作（菜单）", "Git operations (menu)")],
            ["/run", t("执行终端命令", "Run a terminal command")],
            ["/search", t("搜索项目文件", "Search project files")],
            ["/init /explain /fix /test /review /commit", t("常用提示词", "Common prompt commands")],
            ["/status", t("查看软件状态", "Show app status")],
            ["/stop", t("中止正在跑的请求", "Abort a running request")],
          ].map(([cmd, desc]) => (
            <div key={cmd} className="flex items-start gap-1.5">
              <code className="text-[10px] bg-muted px-1 rounded text-foreground shrink-0">{cmd}</code>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </Collapsible>
    </div>
  );
}
