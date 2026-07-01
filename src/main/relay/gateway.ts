/**
 * Relay 网关 —— 跑在 Electron utilityProcess 里的独立子进程。
 *
 * 职责单一：把 Discord / Telegram 的平台事件翻译成统一协议（protocol.ts）经
 * parentPort 转给主进程 RelayCore；把主进程发回的 prompt/emit 翻译回平台动作。
 * 自己不持有任何业务能力（provider/tool/git），只当"协议翻译 + 网络 IO"。
 *
 * 为什么独立进程：bot 网关的心跳/收包若和主进程的 agent loop 抢同一个 event loop，
 * agent loop 的同步段（token 计数、JSON.parse、图片缩放）会卡住心跳 → Discord 交互
 * 3 秒 ACK 超时 → "应用未响应"。隔离到子进程后，心跳不再被业务阻塞。
 *
 * 通信：Electron utilityProcess 用 process.parentPort（MessagePortMain）收发，
 * 不是 Node 的 process.send。消息类型见 protocol.ts。
 */
import type { ToGateway, FromGateway, RelaySource } from "./protocol";
import type { RelayAdapter, AdapterHost } from "./adapter";
import { DiscordAdapter } from "./discord-adapter";
import { TelegramAdapter } from "./telegram-adapter";
import { WeixinAdapter } from "./weixin-adapter";

// utilityProcess 的父端口。Electron 在子进程里注入 process.parentPort。
const parentPort: any = (process as any).parentPort;

/** 向主进程发一条消息。 */
function post(msg: FromGateway): void {
  try { parentPort?.postMessage(msg); } catch { /* 端口不可用忽略 */ }
}

// 已上线的各平台 adapter。
const adapters = new Map<RelaySource, RelayAdapter>();

// adapter 回调主进程的统一出口：状态变化、用户命令、用户答复都经此上报。
const host: AdapterHost = {
  emit: (msg: FromGateway) => post(msg),
};

function makeAdapter(source: RelaySource): RelayAdapter {
  if (source === "discord") return new DiscordAdapter(host);
  if (source === "weixin") return new WeixinAdapter(host);
  return new TelegramAdapter(host);
}

// 取（或惰性创建）微信 adapter：扫码登录在普通 connect 之外，需要单独拿到实例。
function getWeixinAdapter(): WeixinAdapter {
  let ad = adapters.get("weixin") as WeixinAdapter | undefined;
  if (!ad) { ad = new WeixinAdapter(host); adapters.set("weixin", ad); }
  return ad;
}

// ---- 处理主进程发来的消息 ----
async function handle(msg: ToGateway): Promise<void> {
  switch (msg.type) {
    case "connect": {
      let ad = adapters.get(msg.source);
      if (!ad) { ad = makeAdapter(msg.source); adapters.set(msg.source, ad); }
      await ad.connect(msg.token, msg.config);
      break;
    }
    case "disconnect": {
      const ad = adapters.get(msg.source);
      if (ad) { await ad.disconnect(); adapters.delete(msg.source); }
      break;
    }
    case "prompt": {
      const ad = adapters.get(msg.source);
      ad?.prompt(msg);
      break;
    }
    case "prompt-cancel": {
      // 撤回某张未答的提问卡：遍历 adapter（promptId 全局唯一，命中即撤）。
      for (const ad of adapters.values()) ad.cancelPrompt(msg.promptId);
      break;
    }
    case "emit": {
      const ad = adapters.get(msg.source);
      ad?.emit(msg);
      break;
    }
    case "weixin-login-start": {
      // 扫码登录：拉起微信 adapter 的登录状态机（二维码/状态/凭据经 host.emit 回主进程）。
      await getWeixinAdapter().startLogin();
      break;
    }
    case "weixin-login-cancel": {
      (adapters.get("weixin") as WeixinAdapter | undefined)?.cancelLogin();
      break;
    }
  }
}

if (parentPort) {
  parentPort.on("message", (e: any) => {
    // MessagePortMain 把负载放在 e.data。
    const msg: ToGateway = e?.data ?? e;
    handle(msg).catch((err) => {
      console.error("[relay-gateway] handle error:", err);
    });
  });
  // 起好后告知主进程，连通确认。
  post({ type: "ready" });
}

// 全局兜底：网关子进程里任何漏网的异常/拒绝都不能让整个进程崩掉——否则所有平台一起
// 掉线，用户只能回桌面重新点链接。捕获后只记日志，让 adapter 自己的心跳/重连去自愈。
process.on("uncaughtException", (err) => {
  console.error("[relay-gateway] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[relay-gateway] unhandledRejection:", reason);
});
