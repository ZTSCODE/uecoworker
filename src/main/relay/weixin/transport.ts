/**
 * 微信官方 iLink 收发 transport：把 api.ts 的零散函数收敛成一个绑定了 baseUrl/token 的
 * 对象，供 adapter 调用。移植自 codex-bridge 的 transport.ts，裁剪到文本收发 + 登录所需。
 */
import {
  getBotQr,
  getConfig,
  getQrStatus,
  getUpdates,
  sendMessage,
  sendTyping,
} from "./api";
import type {
  GetConfigResp,
  GetUpdatesResp,
  SendMessageResp,
  SendTypingResp,
  WeixinQrCodeResponse,
  WeixinQrStatusResponse,
} from "./types";

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;

export interface WeixinTransport {
  baseUrl: string;
  token: string | null;
  getUpdates(params?: { syncCursor?: string; timeoutMs?: number }): Promise<GetUpdatesResp>;
  sendMessage(params: {
    toUserId: string;
    text: string;
    contextToken?: string | null;
    clientId: string;
    timeoutMs?: number;
  }): Promise<SendMessageResp>;
  sendTyping(params: { toUserId: string; typingTicket: string; status: number }): Promise<SendTypingResp>;
  getConfig(params: { userId: string; contextToken?: string | null }): Promise<GetConfigResp>;
  getBotQr(params?: { botType?: string }): Promise<WeixinQrCodeResponse>;
  getQrStatus(params: { qrcode: string; baseUrlOverride?: string | null }): Promise<WeixinQrStatusResponse>;
}

export function createWeixinTransport({
  baseUrl,
  token = null,
}: {
  baseUrl: string;
  token?: string | null;
}): WeixinTransport {
  const normalizedBaseUrl = String(baseUrl).replace(/\/+$/u, "");
  return {
    baseUrl: normalizedBaseUrl,
    token,
    async getUpdates({ syncCursor = "", timeoutMs = DEFAULT_LONG_POLL_TIMEOUT_MS } = {}) {
      return getUpdates({ baseUrl: normalizedBaseUrl, token, timeoutMs, get_updates_buf: syncCursor });
    },
    async sendMessage({ toUserId, text, contextToken = null, clientId, timeoutMs }) {
      return sendMessage({
        baseUrl: normalizedBaseUrl,
        token,
        timeoutMs,
        msg: {
          from_user_id: "",
          to_user_id: toUserId,
          client_id: clientId,
          message_type: 2,
          message_state: 2,
          item_list: text ? [{ type: 1, text_item: { text } }] : [],
          ...(contextToken ? { context_token: contextToken } : {}),
        },
      });
    },
    async sendTyping({ toUserId, typingTicket, status }) {
      return sendTyping({
        baseUrl: normalizedBaseUrl,
        token,
        ilink_user_id: toUserId,
        typing_ticket: typingTicket,
        status,
      });
    },
    async getConfig({ userId, contextToken = null }) {
      return getConfig({
        baseUrl: normalizedBaseUrl,
        token,
        ilink_user_id: userId,
        ...(contextToken ? { context_token: contextToken } : {}),
      });
    },
    async getBotQr({ botType = "3" } = {}) {
      return getBotQr({ baseUrl: normalizedBaseUrl, botType });
    },
    async getQrStatus({ qrcode, baseUrlOverride = null }) {
      return getQrStatus({
        baseUrl: baseUrlOverride ? String(baseUrlOverride).replace(/\/+$/u, "") : normalizedBaseUrl,
        qrcode,
      });
    },
  };
}
