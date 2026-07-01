import { useState, useEffect, useMemo } from "react";
import { useAppStore } from "../../stores/app-store";
import { Radio, Wifi, WifiOff, Loader2, Check, AlertCircle, CircleAlert, Info, ListChecks, Command, Circle } from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { PageHeader, Hint, Collapsible, PrimaryButton } from "../ui/settings";

type DiscordStatus = "offline" | "connecting" | "online" | "error";

interface DiscordConfig {
  applicationId: string;
  allowedUserId: string;
  guildId?: string;
  autoConnect?: boolean;
  hasToken: boolean;
  status: DiscordStatus;
  error?: string;
}

// Discord ID 格式：纯数字，17~20 位（Snowflake ID）
function isValidSnowflake(id: string): boolean {
  return /^\d{17,20}$/.test(id.trim());
}

// Discord Bot Token 格式：三段 base64 用点连接
function isValidBotToken(token: string): boolean {
  if (!token.trim()) return false;
  const parts = token.trim().split(".");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

type FieldStatus = "empty" | "valid" | "invalid";

function FieldBadge({ status, validText, invalidText }: { status: FieldStatus; validText: string; invalidText: string }) {
  if (status === "empty") return null;
  if (status === "valid") {
    return <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-500 font-medium"><Check size={10} strokeWidth={3} /> {validText}</span>;
  }
  return <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-500 font-medium"><CircleAlert size={10} /> {invalidText}</span>;
}

export function DiscordSettings() {
  const t = useT();
  const { projectPath } = useAppStore();
  const [cfg, setCfg] = useState<DiscordConfig>({
    applicationId: "", allowedUserId: "", guildId: "", autoConnect: false,
    hasToken: false, status: "offline",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [appIdDraft, setAppIdDraft] = useState("");
  const [userIdDraft, setUserIdDraft] = useState("");
  const [guildIdDraft, setGuildIdDraft] = useState("");
  const [liveStatus, setLiveStatus] = useState<DiscordStatus>("offline");
  const [liveError, setLiveError] = useState("");
  const [botTag, setBotTag] = useState("");
  // 保存反馈
  const [saveResult, setSaveResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const c = await (window.api as any).discordGetConfig();
      setCfg(c);
      setAppIdDraft(c.applicationId || "");
      setUserIdDraft(c.allowedUserId || "");
      setGuildIdDraft(c.guildId || "");
      setLiveStatus(c.status || "offline");
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // 同步项目路径到主进程
  useEffect(() => {
    if (projectPath) {
      (window.api as any).discordSetWorkingDir?.(projectPath);
    }
  }, [projectPath]);

  // 监听状态变化
  useEffect(() => {
    const off = (window.api as any).onDiscordStatusChange?.((data: { status: string; error?: string }) => {
      setLiveStatus(data.status as DiscordStatus);
      setLiveError(data.error || "");
      setConnecting(false);
      if (data.status === "online") {
        (window.api as any).discordStatus?.().then((s: any) => {
          setBotTag(s.botTag || "");
        });
      }
    });
    return () => { if (typeof off === "function") off(); };
  }, []);

  // ---- 验证逻辑 ----
  const tokenStatus: FieldStatus = useMemo(() => {
    if (!tokenDraft.trim() && !cfg.hasToken) return "empty";
    if (!tokenDraft.trim() && cfg.hasToken) return "valid";  // 已保存过
    return isValidBotToken(tokenDraft) ? "valid" : "invalid";
  }, [tokenDraft, cfg.hasToken]);

  const appIdStatus: FieldStatus = useMemo(() => {
    if (!appIdDraft.trim()) return "empty";
    return isValidSnowflake(appIdDraft) ? "valid" : "invalid";
  }, [appIdDraft]);

  const userIdStatus: FieldStatus = useMemo(() => {
    if (!userIdDraft.trim()) return "empty";
    return isValidSnowflake(userIdDraft) ? "valid" : "invalid";
  }, [userIdDraft]);

  const guildIdStatus: FieldStatus = useMemo(() => {
    if (!guildIdDraft.trim()) return "empty"; // 可选字段
    return isValidSnowflake(guildIdDraft) ? "valid" : "invalid";
  }, [guildIdDraft]);

  // 连接前置条件检查
  const connectBlockers = useMemo(() => {
    const issues: string[] = [];
    if (tokenStatus === "empty") issues.push(t("未填写 Bot Token", "Bot Token not entered"));
    if (tokenStatus === "invalid") issues.push(t("Bot Token 格式错误", "Bot Token format invalid"));
    if (appIdStatus === "empty") issues.push(t("未填写 Application ID", "Application ID not entered"));
    if (appIdStatus === "invalid") issues.push(t("Application ID 格式错误", "Application ID format invalid"));
    // 已保存 token 但 draft 里没有新的 → 需要检查 cfg.hasToken
    if (tokenStatus === "empty" && !cfg.hasToken) issues.push(t("未保存 Bot Token", "Bot Token not saved"));
    // 必须先保存才能连接
    if (tokenDraft.trim() || (appIdDraft.trim() !== cfg.applicationId)) {
      issues.push(t("配置有未保存的更改", "Config has unsaved changes"));
    }
    return issues;
  }, [t, tokenStatus, appIdStatus, cfg.hasToken, cfg.applicationId, tokenDraft, appIdDraft]);

  const canConnect = connectBlockers.length === 0 && cfg.hasToken && appIdStatus === "valid";

  // 保存按钮是否有效（至少有要保存的内容，且格式无误）
  const canSave = useMemo(() => {
    if (tokenDraft.trim() && !isValidBotToken(tokenDraft)) return false;
    if (appIdDraft.trim() && !isValidSnowflake(appIdDraft)) return false;
    if (userIdDraft.trim() && !isValidSnowflake(userIdDraft)) return false;
    if (guildIdDraft.trim() && !isValidSnowflake(guildIdDraft)) return false;
    // 至少得有 token（已保存或新输入） + appId
    const hasToken = cfg.hasToken || !!tokenDraft.trim();
    const hasAppId = !!appIdDraft.trim();
    return hasToken && hasAppId;
  }, [tokenDraft, appIdDraft, userIdDraft, guildIdDraft, cfg.hasToken]);

  const saveConfig = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const update: any = {
        applicationId: appIdDraft.trim(),
        allowedUserId: userIdDraft.trim(),
        guildId: guildIdDraft.trim() || undefined,
      };
      if (tokenDraft.trim()) {
        update.token = tokenDraft.trim();
      }
      await (window.api as any).discordSaveConfig(update);
      setTokenDraft("");
      await load();
      setSaveResult({ ok: true, msg: t("配置已保存，现在可以点击「连接」。", "Config saved. You can now click \"Connect\".") });
      // 3 秒后自动清除成功提示
      setTimeout(() => setSaveResult((prev) => prev?.ok ? null : prev), 4000);
    } catch (e: any) {
      setSaveResult({ ok: false, msg: t("保存失败: ", "Save failed: ") + (e?.message || t("未知错误", "Unknown error")) });
    }
    setSaving(false);
  };

  const toggleConnect = async () => {
    if (liveStatus === "online" || liveStatus === "connecting") {
      await (window.api as any).discordDisconnect();
      setLiveStatus("offline");
      setBotTag("");
    } else {
      setConnecting(true);
      setLiveError("");
      const result = await (window.api as any).discordConnect();
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
      case "online": return t("在线", "Online") + (botTag ? " — " + botTag : "");
      case "connecting": return t("连接中…", "Connecting…");
      case "error": return t("错误", "Error");
      default: return t("离线", "Offline");
    }
  };

  if (loading) return <p className="text-xs text-muted-foreground">{t("加载中…", "Loading…")}</p>;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Radio}
        title={t("Discord 远程控制", "Discord Remote Control")}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {t("用 Discord Bot 斜杠命令远程控制", "Control remotely via Discord Bot slash commands")}
            <Hint>
              {t("通过 Discord Bot 的斜杠命令在手机上远程控制 UE Coworker：/ask（Agent 对话）、/file（文件读取）、/git（Git 操作）、/run（终端命令）等。需要先在 Discord Developer Portal 创建 Application 并获取 Bot Token。", "Control UE Coworker from your phone via Discord Bot slash commands: /ask (agent chat), /file (read files), /git (Git operations), /run (terminal commands), and more. First create an Application in the Discord Developer Portal and obtain a Bot Token.")}
              {" "}
              <button onClick={() => (window.api as any).openExternal?.("https://discord.com/developers/applications")} className="text-accent-brand hover:underline">Developer Portal</button>
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

      {/* 连接按钮灰色原因 */}
      {!canConnect && liveStatus !== "online" && connectBlockers.length > 0 && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-500">
          <Info size={12} className="shrink-0 mt-0.5" />
          <span>{t("无法连接: ", "Cannot connect: ")}{connectBlockers.join(t("、", ", "))}</span>
        </div>
      )}

      {liveError && (
        <p className="text-[11px] text-destructive">{liveError}</p>
      )}

      {/* 配置表单 */}
      <div className="space-y-3">
        {/* Bot Token */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-muted-foreground">Bot Token <span className="text-destructive">*</span></label>
            <FieldBadge
              status={tokenStatus}
              validText={cfg.hasToken ? t("已保存", "Saved") : t("格式正确", "Valid format")}
              invalidText={t("格式错误 — 应为三段以 . 分隔的字符串", "Invalid format — should be three segments separated by .")}
            />
          </div>
          <input
            type="password"
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            placeholder={cfg.hasToken ? t("•••••••• (已保存，输入以替换)", "•••••••• (saved, type to replace)") : t("粘贴 Discord Bot Token（如 MTIz...abc.XYZ.def）", "Paste Discord Bot Token (e.g. MTIz...abc.XYZ.def)")}
            className={cn("w-full px-2.5 py-1.5 text-xs bg-muted border rounded focus:outline-none focus:ring-1 text-foreground font-mono",
              tokenStatus === "invalid" ? "border-amber-500/60 focus:ring-amber-500" : "border-border focus:ring-ring"
            )}
          />
        </div>

        {/* Application ID */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-muted-foreground">Application ID <span className="text-destructive">*</span></label>
            <FieldBadge
              status={appIdStatus}
              validText={t("格式正确", "Valid format")}
              invalidText={t("应为 17–20 位纯数字", "Should be 17–20 digits")}
            />
          </div>
          <input
            value={appIdDraft}
            onChange={(e) => setAppIdDraft(e.target.value)}
            placeholder={t("从 Developer Portal → General Information 复制（如 1234567890123456789）", "Copy from Developer Portal → General Information (e.g. 1234567890123456789)")}
            className={cn("w-full px-2.5 py-1.5 text-xs bg-muted border rounded focus:outline-none focus:ring-1 text-foreground font-mono",
              appIdStatus === "invalid" ? "border-amber-500/60 focus:ring-amber-500" : "border-border focus:ring-ring"
            )}
          />
        </div>

        {/* User ID */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-muted-foreground">{t("你的 Discord User ID（白名单）", "Your Discord User ID (whitelist)")}</label>
            <FieldBadge
              status={userIdStatus}
              validText={t("格式正确", "Valid format")}
              invalidText={t("应为 17–20 位纯数字", "Should be 17–20 digits")}
            />
          </div>
          <input
            value={userIdDraft}
            onChange={(e) => setUserIdDraft(e.target.value)}
            placeholder={t("右键你自己的头像 → 复制用户 ID（如 9876543210987654321）", "Right-click your own avatar → Copy User ID (e.g. 9876543210987654321)")}
            className={cn("w-full px-2.5 py-1.5 text-xs bg-muted border rounded focus:outline-none focus:ring-1 text-foreground font-mono",
              userIdStatus === "invalid" ? "border-amber-500/60 focus:ring-amber-500" : "border-border focus:ring-ring"
            )}
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">{t("只有此用户的命令会被响应。不填则所有人可用（不建议）。", "Only this user's commands will be handled. Leave empty to allow everyone (not recommended).")}</p>
        </div>

        {/* Guild ID */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[11px] text-muted-foreground">{t("Guild ID（可选，推荐填写）", "Guild ID (optional, recommended)")}</label>
            <FieldBadge
              status={guildIdStatus}
              validText={t("格式正确", "Valid format")}
              invalidText={t("应为 17–20 位纯数字", "Should be 17–20 digits")}
            />
          </div>
          <input
            value={guildIdDraft}
            onChange={(e) => setGuildIdDraft(e.target.value)}
            placeholder={t("右键你的服务器名 → 复制服务器 ID（如 1122334455667788990）", "Right-click your server name → Copy Server ID (e.g. 1122334455667788990)")}
            className={cn("w-full px-2.5 py-1.5 text-xs bg-muted border rounded focus:outline-none focus:ring-1 text-foreground font-mono",
              guildIdStatus === "invalid" ? "border-amber-500/60 focus:ring-amber-500" : "border-border focus:ring-ring"
            )}
          />
          <p className="text-[10px] text-muted-foreground mt-0.5">{t("填入后斜杠命令即时生效（推荐）；留空则注册全局命令（最多等 1 小时生效）。", "When set, slash commands take effect instantly (recommended); leave empty to register global commands (up to 1 hour to take effect).")}</p>
        </div>

        {/* 保存按钮 + 反馈 */}
        <div className="flex items-center gap-3 flex-wrap">
          <PrimaryButton
            onClick={saveConfig}
            disabled={saving || !canSave}
            title={!canSave ? t("请先正确填写必填字段（标有 * 的）", "Please correctly fill in the required fields (marked with *)") : undefined}>
            {saving ? t("保存中…", "Saving…") : t("保存配置", "Save Config")}
          </PrimaryButton>

          {/* 保存反馈 */}
          {saveResult && (
            <span className={cn("text-[11px] font-medium transition-opacity",
              saveResult.ok ? "text-emerald-500" : "text-destructive"
            )}>
              {saveResult.msg}
            </span>
          )}
        </div>

        {/* 配置完整度一览 */}
        <div className="rounded-xl bg-muted/30 ring-1 ring-border/40 px-3.5 py-2.5">
          <p className="text-[10px] text-muted-foreground mb-1.5 font-medium">{t("配置状态一览", "Config Status Overview")}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            {[
              { label: "Bot Token", ok: cfg.hasToken },
              { label: "Application ID", ok: appIdStatus === "valid" },
              { label: "User ID", ok: userIdStatus === "valid" },
              { label: "Guild ID", ok: guildIdStatus === "valid" || guildIdStatus === "empty" },
            ].map(({ label, ok }) => (
              <span key={label} className={cn("flex items-center gap-1",
                ok ? "text-emerald-500" : "text-muted-foreground")}>
                {ok ? <Check size={10} strokeWidth={3} /> : <Circle size={9} className="text-muted-foreground/50" />}
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 使用说明 */}
      <Collapsible icon={ListChecks} title={t("配置步骤", "Setup Steps")}>
        <ol className="text-[11px] text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>{t("前往 ", "Go to ")}<button onClick={() => (window.api as any).openExternal?.("https://discord.com/developers/applications")}
              className="text-accent-brand hover:underline">Discord Developer Portal</button> → New Application</li>
          <li>{t("复制 ", "Copy the ")}<strong className="text-foreground">Application ID</strong>{t(" 填入上方", " and paste it above")}</li>
          <li>{t("进入 Bot 页面 → Reset Token → 复制 Token 粘贴到上方", "Open the Bot page → Reset Token → copy the Token and paste it above")}</li>
          <li>{t("在下方开启 ", "Enable ")}<strong className="text-foreground">Message Content Intent</strong>{t("（Privileged Gateway Intents）权限", " below (Privileged Gateway Intents)")}</li>
          <li>{t("在 Discord 应用设置中开启开发者模式，右键头像「复制用户 ID」填入上方", "Enable Developer Mode in Discord settings, then right-click your avatar → \"Copy User ID\" and paste it above")}</li>
          <li>{t("如果填了 ", "If you fill in the ")}<strong className="text-foreground">Guild ID</strong>{t("（你的服务器 ID），斜杠命令会即时可用", " (your server ID), slash commands become available instantly")}</li>
          <li>{t("进入 ", "Go to the ")}<strong className="text-foreground">{t("安装（Installation）", "Installation")}</strong>{t(" 页面，复制链接，把 App 添加到自己的服务器", " page, copy the link, and add the App to your own server")}</li>
          <li>{t("点击「保存配置」后会自动连接", "Click \"Save Config\" to connect automatically")}</li>
          <li>{t("在服务器输入栏选择添加的 App，添加后输入 ", "In the server's input bar, select the added App, then type ")}<code className="bg-muted px-1 rounded">/ask</code>{t(" 即可开始", " to get started")}</li>
        </ol>
      </Collapsible>

      {/* 命令列表 */}
      <Collapsible icon={Command} title={t("可用命令", "Available Commands")}>
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          {[
            ["/ask", t("用桌面已选 Provider 提问（回复也出现在桌面会话）", "Ask using the desktop's selected provider (replies also appear in the desktop session)")],
            ["/session new", t("新建 Discord 会话", "Create a new Discord session")],
            ["/session list", t("列出全部会话", "List all sessions")],
            ["/session switch", t("切换到指定会话", "Switch to a specific session")],
            ["/file read", t("读取文件内容", "Read file contents")],
            ["/file list", t("列出目录内容", "List directory contents")],
            ["/git status", t("查看 Git 状态", "Show Git status")],
            ["/git commit", t("提交更改", "Commit changes")],
            ["/git push", t("推送到远程", "Push to remote")],
            ["/git pull", t("从远程拉取", "Pull from remote")],
            ["/run", t("执行终端命令", "Run a terminal command")],
            ["/search", t("搜索项目文件", "Search project files")],
            ["/status", t("查看软件状态", "Show app status")],
            ["/stop", t("中止正在跑的 /ask", "Abort a running /ask")],
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
