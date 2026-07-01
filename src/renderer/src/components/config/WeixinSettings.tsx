import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { MessageCircle, Wifi, WifiOff, Loader2, AlertCircle, RefreshCw, LogOut, ListChecks, Command } from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { PageHeader, Hint, Collapsible } from "../ui/settings";

type RelayStatus = "offline" | "connecting" | "online" | "error";

interface WeixinConfig {
  allowedUserId: string;
  accountId?: string;
  baseUrl?: string;
  userId?: string;
  hasToken: boolean;
  status: RelayStatus;
  error?: string;
  botTag?: string;
}

// 扫码登录状态机的状态文案。
type QrPhase = "idle" | "wait" | "scaned" | "confirmed" | "expired" | "error";

export function WeixinSettings() {
  const t = useT();
  const [cfg, setCfg] = useState<WeixinConfig>({ allowedUserId: "", hasToken: false, status: "offline" });
  const [loading, setLoading] = useState(true);
  const [liveStatus, setLiveStatus] = useState<RelayStatus>("offline");
  const [liveError, setLiveError] = useState("");
  const [botTag, setBotTag] = useState("");

  // 扫码登录态
  const [loggingIn, setLoggingIn] = useState(false);
  const [qrPhase, setQrPhase] = useState<QrPhase>("idle");
  const [qrDataUrl, setQrDataUrl] = useState("");      // 渲染出的二维码图（<img src>）
  const [qrError, setQrError] = useState("");
  const loggingInRef = useRef(false);

  const load = async () => {
    setLoading(true);
    try {
      const c = await (window.api as any).relayGetConfig("weixin");
      setCfg(c);
      setLiveStatus(c.status || "offline");
      setBotTag(c.botTag || c.accountId || "");
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // 状态变化（只取 weixin 来源）。
  useEffect(() => {
    const off = (window.api as any).onRelayStatusChange?.((data: { source: string; status: string; error?: string; botTag?: string }) => {
      if (data.source !== "weixin") return;
      setLiveStatus(data.status as RelayStatus);
      setLiveError(data.error || "");
      if (data.botTag) setBotTag(data.botTag);
      if (data.status === "online") {
        // 登录并上线后收起二维码。
        setLoggingIn(false);
        loggingInRef.current = false;
        setQrPhase("confirmed");
      }
      if (data.status === "offline") setBotTag("");
    });
    return () => { if (typeof off === "function") off(); };
  }, []);

  // 扫码二维码 / 状态推送。
  useEffect(() => {
    const off = (window.api as any).onRelayWeixinQr?.(async (data: { qrcode: string; qrcodeImageContent?: string; status: string; error?: string }) => {
      setQrPhase((data.status as QrPhase) || "wait");
      if (data.error) setQrError(data.error);
      // 二维码内容取自 qrcodeImageContent：
      //  - data:image/... → 服务端已给图，直接用；
      //  - http(s)://...   → 这是真正的微信登录 URL，用它生成二维码（扫码后能跳转登录）；
      //  - 都没有时才退而用 qrcode 字符串（内部 token，扫出来只是一串字符，无法登录，仅兜底）。
      const content = data.qrcodeImageContent || "";
      if (content.startsWith("data:image/")) {
        setQrDataUrl(content);
      } else {
        const encodeTarget = /^https?:\/\//.test(content) ? content : data.qrcode;
        if (encodeTarget) {
          try {
            const url = await QRCode.toDataURL(encodeTarget, { width: 240, margin: 1 });
            setQrDataUrl(url);
          } catch {
            setQrDataUrl("");
          }
        }
      }
      if (data.status === "confirmed") {
        setQrDataUrl("");
      }
    });
    return () => { if (typeof off === "function") off(); };
  }, []);

  const startLogin = async () => {
    setLoggingIn(true);
    loggingInRef.current = true;
    setQrPhase("wait");
    setQrError("");
    setQrDataUrl("");
    setLiveError("");
    try {
      await (window.api as any).relayWeixinLogin();
    } catch (e: any) {
      setQrError(e?.message || t("发起登录失败", "Failed to start login"));
      setQrPhase("error");
      setLoggingIn(false);
      loggingInRef.current = false;
    }
  };

  const cancelLogin = async () => {
    try { await (window.api as any).relayWeixinCancelLogin(); } catch {}
    setLoggingIn(false);
    loggingInRef.current = false;
    setQrPhase("idle");
    setQrDataUrl("");
  };

  // 退出登录：断开并清除凭据（保存空 token 等价于清除）。
  const logout = async () => {
    try {
      await (window.api as any).relayDisconnect("weixin");
      await (window.api as any).relaySaveConfig("weixin", { token: "", accountId: "" });
    } catch {}
    await load();
    setLiveStatus("offline");
    setBotTag("");
    setQrPhase("idle");
  };

  const toggleConnect = async () => {
    if (liveStatus === "online" || liveStatus === "connecting") {
      await (window.api as any).relayDisconnect("weixin");
      setLiveStatus("offline");
      setBotTag("");
    } else {
      setLiveError("");
      const result = await (window.api as any).relayConnect("weixin");
      if (!result.ok) {
        setLiveError(result.error || t("连接失败", "Connection failed"));
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

  const qrPhaseText = () => {
    switch (qrPhase) {
      case "wait": return t("请用微信扫描二维码", "Scan the QR code with WeChat");
      case "scaned": return t("已扫描，请在手机上确认", "Scanned — please confirm on your phone");
      case "confirmed": return t("登录成功！", "Login successful!");
      case "expired": return t("二维码已过期，正在刷新…", "QR code expired, refreshing…");
      case "error": return qrError || t("登录出错", "Login error");
      default: return "";
    }
  };

  if (loading) return <p className="text-xs text-muted-foreground">{t("加载中…", "Loading…")}</p>;

  const loggedIn = cfg.hasToken && !!cfg.accountId;

  return (
    <div className="space-y-5">
      <PageHeader
        icon={MessageCircle}
        title={t("微信远程控制", "WeChat Remote Control")}
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            {t("扫码登录后，对话里直接发消息提问", "Scan to log in, then just message in chat")}
            <Hint>
              {t("功能支持有限。通过微信官方机器人在手机上远程控制 UE Coworker。扫码登录后，在与机器人的对话里直接发消息即可提问。支持文本与图片/文件互传。", "Limited functionality. Control UE Coworker from your phone via the official WeChat bot. After scanning to log in, just send a message in the chat to ask. Supports text and image/file transfer.")}
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
        {loggedIn && (
          <button
            onClick={toggleConnect}
            className={cn("px-3.5 py-1.5 text-[11px] rounded-lg font-medium transition-colors whitespace-nowrap",
              liveStatus === "online"
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "bg-foreground text-background hover:opacity-90")}>
            {liveStatus === "online" ? t("断开", "Disconnect") : t("连接", "Connect")}
          </button>
        )}
      </div>

      {liveError && <p className="text-[11px] text-destructive">{liveError}</p>}

      {/* 登录区：未登录 → 扫码；已登录 → 显示账号 + 退出登录 */}
      {!loggedIn ? (
        <div className="rounded-xl ring-1 ring-border/40 bg-muted/30 p-4 space-y-3">
          <h3 className="text-xs font-medium text-foreground">{t("扫码登录", "Scan to log in")}</h3>
          {!loggingIn ? (
            <button onClick={startLogin}
              className="px-3.5 py-1.5 text-[11px] bg-foreground text-background rounded-lg font-medium hover:opacity-90 transition-opacity">
              {t("开始扫码登录", "Start QR login")}
            </button>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div className="w-[240px] h-[240px] flex items-center justify-center bg-white rounded-xl ring-1 ring-border/40 overflow-hidden">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="WeChat login QR" className="w-full h-full object-contain" />
                ) : (
                  <Loader2 size={28} className="animate-spin text-muted-foreground" />
                )}
              </div>
              <p className={cn("text-[11px] font-medium",
                qrPhase === "error" ? "text-destructive" : qrPhase === "scaned" || qrPhase === "confirmed" ? "text-emerald-500" : "text-foreground")}>
                {qrPhaseText()}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={startLogin} disabled={qrPhase === "scaned"}
                  className={cn("inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-lg bg-muted/60 hover:bg-muted transition-colors",
                    qrPhase === "scaned" && "opacity-40 cursor-not-allowed")}>
                  <RefreshCw size={11} /> {t("刷新二维码", "Refresh QR")}
                </button>
                <button onClick={cancelLogin}
                  className="px-2.5 py-1.5 text-[11px] rounded-lg bg-muted/60 hover:bg-muted transition-colors text-muted-foreground">
                  {t("取消", "Cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl ring-1 ring-border/40 bg-muted/30 p-4 space-y-2">
          <h3 className="text-xs font-medium text-foreground">{t("已登录账号", "Logged-in account")}</h3>
          <p className="text-[11px] text-muted-foreground font-mono break-all">{cfg.accountId}</p>
          <button onClick={logout}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-lg text-destructive hover:bg-destructive/10 transition-colors">
            <LogOut size={11} /> {t("退出登录（需重新扫码）", "Log out (re-scan required)")}
          </button>
        </div>
      )}

      {/* 使用说明 */}
      <Collapsible icon={ListChecks} title={t("使用步骤", "Setup Steps")}>
        <ol className="text-[11px] text-muted-foreground space-y-1.5 list-decimal list-inside">
          <li>{t("点「开始扫码登录」，用手机微信扫描出现的二维码", "Click \"Start QR login\" and scan the QR code with WeChat on your phone")}</li>
          <li>{t("在手机上确认登录", "Confirm the login on your phone")}</li>
          <li>{t("登录成功后会自动上线（状态变为「在线」）", "After login it goes online automatically (status becomes \"Online\")")}</li>
          <li>{t("在微信里与该机器人对话，直接发消息即可提问", "Chat with the bot in WeChat — just send a message to ask")}</li>
        </ol>
      </Collapsible>

      {/* 命令列表 */}
      <Collapsible icon={Command} title={t("可用命令", "Available Commands")}>
        <p className="text-[10px] text-muted-foreground mb-2">{t("微信不支持斜杠补全与按钮，命令以「发文本 + 回数字选择」方式工作。也可直接发消息提问、发图片/文件给 AI。", "WeChat has no slash autocomplete or buttons; commands work via \"send text + reply with a number\". You can also just send a message to ask, or send images/files to the AI.")}</p>
        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          {[
            [t("（直接发消息/图片/文件）", "(send a message/image/file)"), t("提问；发图片即让 AI 看图", "Ask; send an image to let the AI see it")],
            ["/help", t("显示命令菜单（回数字执行）", "Show command menu (reply with a number)")],
            ["/mode", t("列出权限模式，回数字切换", "List permission modes, reply a number to switch")],
            ["/provider", t("列出供应商/模型，回数字切换", "List providers/models, reply a number to switch")],
            ["/clear", t("新建空白会话", "New blank conversation")],
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
