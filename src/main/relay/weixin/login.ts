/**
 * 微信官方 clawbot 扫码登录状态机。移植自 codex-bridge 的 login.ts，剥掉 i18n 与
 * accountStore 持久化（持久化交由上层 RelayCore 处理）。
 *
 * 流程：
 *  1. get_bot_qrcode 取二维码（qrcode 串 + qrcode_img_content 可渲染成图）。
 *  2. 轮询 get_qrcode_status：
 *     - wait / scaned：继续等。
 *     - scaned_but_redirect：服务端要求换 base_url，更新后继续。
 *     - expired：二维码过期，自动重新取一张并回调。
 *     - confirmed：拿到 { account_id, token, base_url, user_id }，返回。
 *  onQrCode / onStatus 回调用于把二维码与状态实时推给桌面 UI。
 */
import { getBotQr, getQrStatus } from "./api";
import type { WeixinQrCodeResponse, WeixinQrStatusResponse } from "./types";

export const DEFAULT_ILINK_BOT_TYPE = "3";
export const FIXED_QR_BASE_URL = "https://ilinkai.weixin.qq.com";

export interface WeixinLoginCredentials {
  accountId: string;
  token: string;
  baseUrl: string;
  userId: string;
}

interface WeixinLoginOptions {
  botType?: string;
  timeoutSeconds?: number;
  /** 外部中止：返回 true 时登录循环退出（用户取消 / disconnect）。 */
  shouldAbort?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  onQrCode?: (params: { qrcode: string; qrcodeImageContent: string; raw: WeixinQrCodeResponse }) => void | Promise<void>;
  onStatus?: (params: { status: string; qrcode: string; raw: WeixinQrStatusResponse }) => void | Promise<void>;
}

export async function weixinQrLogin(options: WeixinLoginOptions = {}): Promise<WeixinLoginCredentials | null> {
  const {
    botType = DEFAULT_ILINK_BOT_TYPE,
    timeoutSeconds = 480,
    shouldAbort = () => false,
    sleep = defaultSleep,
    onQrCode,
    onStatus,
  } = options;

  let qrResponse = await getBotQr({ baseUrl: FIXED_QR_BASE_URL, botType });
  let qrcode = String(qrResponse.qrcode ?? "");
  if (!qrcode) return null;

  if (onQrCode) {
    await onQrCode({
      qrcode,
      qrcodeImageContent: String(qrResponse.qrcode_img_content ?? ""),
      raw: qrResponse,
    });
  }

  const deadline = Date.now() + timeoutSeconds * 1000;
  let currentBaseUrl = FIXED_QR_BASE_URL;
  let lastStatus: string | null = null;

  while (Date.now() < deadline) {
    if (shouldAbort()) return null;

    let statusResponse: WeixinQrStatusResponse;
    try {
      statusResponse = await getQrStatus({ baseUrl: currentBaseUrl, qrcode });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        await sleep(1000);
        continue;
      }
      throw error;
    }

    const status = String(statusResponse.status ?? "wait");
    if (status !== lastStatus) {
      lastStatus = status;
      if (onStatus) await onStatus({ status, qrcode, raw: statusResponse });
    }

    if (status === "scaned_but_redirect") {
      const redirectHost = String(statusResponse.redirect_host ?? "").trim();
      if (redirectHost) currentBaseUrl = `https://${redirectHost}`;
      await sleep(1000);
      continue;
    }

    if (status === "expired") {
      qrResponse = await getBotQr({ baseUrl: FIXED_QR_BASE_URL, botType });
      qrcode = String(qrResponse.qrcode ?? "");
      currentBaseUrl = FIXED_QR_BASE_URL;
      if (onQrCode) {
        await onQrCode({
          qrcode,
          qrcodeImageContent: String(qrResponse.qrcode_img_content ?? ""),
          raw: qrResponse,
        });
      }
      await sleep(1000);
      continue;
    }

    if (status === "confirmed") {
      const credentials: WeixinLoginCredentials = {
        accountId: String(statusResponse.ilink_bot_id ?? ""),
        token: String(statusResponse.bot_token ?? ""),
        baseUrl: String(statusResponse.baseurl ?? FIXED_QR_BASE_URL),
        userId: String(statusResponse.ilink_user_id ?? ""),
      };
      if (!credentials.accountId || !credentials.token) return null;
      return credentials;
    }

    await sleep(1000);
  }

  return null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
