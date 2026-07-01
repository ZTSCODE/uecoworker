/**
 * Relay 协议 —— 网关子进程(utilityProcess)与主进程 RelayCore 之间的统一契约。
 *
 * 设计目标：进程无关。阶段一网关跑在主进程内时这套类型直接当函数参数用；
 * 阶段二网关搬进 utilityProcess 后，同一套消息经 parentPort 序列化收发，业务零改动。
 *
 * Discord / Telegram 两个平台都翻译到这套中立结构：
 * - 网关只做"平台事件 ↔ 协议消息"的翻译，不持有任何业务能力（tool/git/provider）。
 * - 主进程 RelayCore 持有全部业务，处理完把结果/提问经协议发回网关。
 *
 * 消息分三类：
 * - command：用户发起的命令（网关 → 核心）
 * - prompt/answer：核心向用户提问、用户作答（核心 ↔ 网关，需要往返）
 * - emit：核心向用户的只读推送（核心 → 网关，命令结果 / 进度 / 错误）
 * 外加控制类：connect/disconnect/status/ready（主 ↔ 网关生命周期）。
 */

export type RelaySource = "discord" | "telegram" | "weixin";

// ---- 控制：生命周期 ----

/** 主 → 网关：用某平台的 token + 配置上线一个 bot。 */
export interface RelayConnect {
  type: "connect";
  source: RelaySource;
  token: string;
  /** 平台相关配置（Discord: applicationId/guildId/allowedUserId；Telegram: allowedUserId）。 */
  config: Record<string, any>;
}

/** 主 → 网关：下线某平台的 bot。 */
export interface RelayDisconnect {
  type: "disconnect";
  source: RelaySource;
}

/** 网关 → 主：某平台连接状态变化。 */
export interface RelayStatus {
  type: "status";
  source: RelaySource;
  status: "offline" | "connecting" | "online" | "error";
  error?: string;
  /** bot 自报名（Discord: user.tag；Telegram: username），仅 online 时有。 */
  botTag?: string;
}

/** 网关 → 主：子进程已起好、parentPort 通了（echo 阶段也用它确认连通）。 */
export interface RelayReady {
  type: "ready";
}

// ---- 微信扫码登录：与 Discord/Telegram 的「给 token 即连」不同，微信需先扫码换取凭据 ----

/**
 * 主 → 网关：开始微信 clawbot 扫码登录。网关拉起登录状态机，期间经 RelayWeixinQr
 * 把二维码 / 扫码状态推回主进程；用户在微信确认后，网关用拿到的凭据自动上线长轮询，
 * 并经 RelayWeixinLoggedIn 把凭据回传主进程持久化。
 */
export interface RelayWeixinLoginStart {
  type: "weixin-login-start";
}

/** 主 → 网关：取消正在进行的微信扫码登录。 */
export interface RelayWeixinLoginCancel {
  type: "weixin-login-cancel";
}

/** 网关 → 主：扫码登录过程中的二维码 / 状态推送，供桌面 UI 渲染二维码与提示。 */
export interface RelayWeixinQr {
  type: "weixin-qr";
  /** 二维码内容串（可由 UI 自行渲染成二维码图）。 */
  qrcode: string;
  /** 服务端返回的二维码图片内容（通常是可直接展示的 data/base64 或 url），可能为空。 */
  qrcodeImageContent?: string;
  /** 扫码状态：wait / scaned / scaned_but_redirect / confirmed / expired / error。 */
  status: string;
  /** error 时的原因。 */
  error?: string;
}

/** 网关 → 主：微信登录成功，回传凭据供主进程持久化（token 入 SecretsManager，其余入 config）。 */
export interface RelayWeixinLoggedIn {
  type: "weixin-logged-in";
  accountId: string;
  token: string;
  baseUrl: string;
  userId: string;
}

// ---- command：用户发起的命令（网关 → 核心）----

export interface RelayCommand {
  type: "command";
  source: RelaySource;
  /** 回复地址：Discord channelId / Telegram chatId。核心据此把结果发回原处。 */
  channelId: string;
  /** 发起者 id（白名单校验已在网关侧完成，这里仅作记录/二次校验）。 */
  userId: string;
  /** 关联 id：核心处理完用它把结果（RelayEmit.replyTo）发回，网关据此 editReply。 */
  replyTo: string;
  kind: "ask" | "session" | "tool" | "provider" | "mode" | "project" | "ui";
  /** ask：自然语言提问/指令。 */
  prompt?: string;
  /** session：new / list / switch。provider：list / switch。project：list/listDir/open/create。ui：chat/game/agent/compact。 */
  op?: "new" | "list" | "switch" | "listDrives" | "listDir" | "open" | "create" | "recent" | "chat" | "game" | "agent" | "compact";
  /** session.new 的名称 / session.switch 的目标（名称或序号 / __stop__）。 */
  arg?: string;
  /** tool：file/git/run/search/status 等不需要 AI 的命令名。 */
  tool?: string;
  /** tool 的参数。 */
  args?: Record<string, any>;
  /** mode：权限模式 default/acceptEdits/bypassPermissions/plan。 */
  mode?: string;
  /** ask 附带的本地图片绝对路径（手机发来的图，供 AI vision 看）。 */
  images?: string[];
}

// ---- prompt / answer：核心向用户提问，用户作答（核心 ↔ 网关）----

/**
 * 核心 → 网关：向发起命令的频道提问，等用户答复。
 * - options 非空 → 平台出按钮（Discord Button / Telegram inline keyboard）。
 * - options 为空 → 自由文本（Discord Modal / Telegram forceReply）。
 * - plan 非空 → 计划审批，question 前附计划全文。
 */
export interface RelayPrompt {
  type: "prompt";
  source: RelaySource;
  channelId: string;
  /** 提问 id：网关收齐答复后用它经 RelayAnswer 回传。 */
  promptId: string;
  question: string;
  options?: string[];
  plan?: string;
  /** 是否允许自由文本作答。问题卡=true（可打字）；计划/受限卡=false（仅按钮，打字不作答）。 */
  allowText?: boolean;
  timeoutMs?: number;
}

/** 网关 → 核心：用户对某次 prompt 的答复（空串 = 超时/取消/中止）。 */
export interface RelayAnswer {
  type: "answer";
  promptId: string;
  answer: string;
}

/** 核心 → 网关：撤回一张尚未作答的 prompt（已由其它通道/超时/abort 解决）。 */
export interface RelayPromptCancel {
  type: "prompt-cancel";
  promptId: string;
}

// ---- emit：核心向用户的只读推送（核心 → 网关）----

/**
 * 核心 → 网关：只读推送。
 * - result：某条 command 的最终结果（replyTo 对应 RelayCommand.replyTo），网关 editReply。
 * - progress：中途进度（如 todos 更新），网关追加一条消息。
 * - error：错误。
 * - typing：正在处理提示（Discord 维持 defer / Telegram sendChatAction）。
 */
export interface RelayEmit {
  type: "emit";
  source: RelaySource;
  channelId: string;
  /** 对应 RelayCommand.replyTo；progress/typing 可空（独立推送）。 */
  replyTo?: string;
  kind: "result" | "progress" | "error" | "typing" | "menu" | "image" | "document" | "board";
  text?: string;
  /** 超长内容作为文件附件发送时的文件名。 */
  filename?: string;
  /** kind:"menu" —— 结构化菜单（项目切换/目录导航等），网关渲染成按钮。 */
  menu?: { title: string; items: { label: string; value: string }[] };
  /** kind:"image"/"document" —— 要发给用户的本地文件绝对路径（图片/文件互传）。 */
  filePath?: string;
  /** kind:"board" —— 置顶状态栏（当前项目/模型/权限模式），网关维护一条置顶消息。 */
  board?: { project?: string; model?: string; mode?: string };
}

// ---- 联合类型 ----

/** 主 → 网关 的所有消息。 */
export type ToGateway = RelayConnect | RelayDisconnect | RelayPrompt | RelayPromptCancel | RelayEmit | RelayWeixinLoginStart | RelayWeixinLoginCancel;

/** 网关 → 主 的所有消息。 */
export type FromGateway = RelayReady | RelayStatus | RelayCommand | RelayAnswer | RelayWeixinQr | RelayWeixinLoggedIn;
