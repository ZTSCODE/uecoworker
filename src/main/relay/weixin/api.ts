/**
 * 微信官方 iLink 机器人 HTTP API。
 *
 * 移植自 codex-bridge 的 `platforms/weixin/official/api.ts`，剥掉其 i18n / fetchImpl
 * 抽象，固定走 Node 内置 `node:https`（带 DNS 多地址轮换重连），因为本模块只在
 * Electron utilityProcess 网关里运行，不需要可注入的 fetch。
 *
 * 端点（相对 baseUrl）：
 * - GET  ilink/bot/get_bot_qrcode?bot_type=3   取登录二维码
 * - GET  ilink/bot/get_qrcode_status?qrcode=…  轮询扫码状态
 * - POST ilink/bot/getupdates                  长轮询收消息
 * - POST ilink/bot/sendmessage                 发消息
 * - POST ilink/bot/sendtyping                  发"正在输入"
 * - POST ilink/bot/getconfig                   取 typing_ticket 等会话配置
 */
import dns from "node:dns/promises";
import https from "node:https";
import type {
  GetConfigReq,
  GetConfigResp,
  GetUpdatesReq,
  GetUpdatesResp,
  GetUploadUrlReq,
  GetUploadUrlResp,
  SendMessageReq,
  SendMessageResp,
  SendTypingReq,
  SendTypingResp,
  WeixinQrCodeResponse,
  WeixinQrStatusResponse,
} from "./types";

const ILINK_APP_ID = "bot";
const ILINK_APP_CLIENT_VERSION = (2 << 16) | (2 << 8) | 0;
const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const DEFAULT_CONFIG_TIMEOUT_MS = 10_000;
const DEFAULT_CHANNEL_VERSION = "2.2.0";

export interface WeixinApiOptions {
  baseUrl: string;
  token?: string | null;
  timeoutMs?: number;
}

interface RawRequestOptions {
  method: "GET" | "POST";
  endpoint: string;
  body?: string;
  timeoutMs: number;
  authorized?: boolean;
  headers?: Record<string, string>;
  baseUrl: string;
  token?: string | null;
}

function buildBaseInfo() {
  return { channel_version: DEFAULT_CHANNEL_VERSION };
}

export async function getUpdates(params: GetUpdatesReq & WeixinApiOptions): Promise<GetUpdatesResp> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  try {
    return await postJson<GetUpdatesResp>({
      baseUrl: params.baseUrl,
      token: params.token,
      endpoint: "ilink/bot/getupdates",
      payload: { get_updates_buf: params.get_updates_buf ?? "" },
      timeoutMs,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf ?? "" };
    }
    throw error;
  }
}

export async function getUploadUrl(params: GetUploadUrlReq & WeixinApiOptions): Promise<GetUploadUrlResp> {
  return postJson<GetUploadUrlResp>({
    baseUrl: params.baseUrl,
    token: params.token,
    endpoint: "ilink/bot/getuploadurl",
    payload: {
      filekey: params.filekey,
      media_type: params.media_type,
      to_user_id: params.to_user_id,
      rawsize: params.rawsize,
      rawfilemd5: params.rawfilemd5,
      filesize: params.filesize,
      thumb_rawsize: params.thumb_rawsize,
      thumb_rawfilemd5: params.thumb_rawfilemd5,
      thumb_filesize: params.thumb_filesize,
      no_need_thumb: params.no_need_thumb,
      aeskey: params.aeskey,
    },
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
  });
}

export async function sendMessage(params: SendMessageReq & WeixinApiOptions): Promise<SendMessageResp> {
  return postJson<SendMessageResp>({
    baseUrl: params.baseUrl,
    token: params.token,
    endpoint: "ilink/bot/sendmessage",
    payload: { msg: params.msg ?? {} },
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
  });
}

export async function sendTyping(params: SendTypingReq & WeixinApiOptions): Promise<SendTypingResp> {
  return postJson<SendTypingResp>({
    baseUrl: params.baseUrl,
    token: params.token,
    endpoint: "ilink/bot/sendtyping",
    payload: {
      ilink_user_id: params.ilink_user_id,
      typing_ticket: params.typing_ticket,
      status: params.status,
    },
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
  });
}

export async function getConfig(params: GetConfigReq & WeixinApiOptions): Promise<GetConfigResp> {
  return postJson<GetConfigResp>({
    baseUrl: params.baseUrl,
    token: params.token,
    endpoint: "ilink/bot/getconfig",
    payload: {
      ilink_user_id: params.ilink_user_id,
      ...(params.context_token ? { context_token: params.context_token } : {}),
    },
    timeoutMs: params.timeoutMs ?? DEFAULT_CONFIG_TIMEOUT_MS,
  });
}

export async function getBotQr(params: WeixinApiOptions & { botType?: string }): Promise<WeixinQrCodeResponse> {
  const botType = params.botType ?? "3";
  return getJson<WeixinQrCodeResponse>({
    baseUrl: params.baseUrl,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    timeoutMs: params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
    authorized: false,
  });
}

export async function getQrStatus(params: WeixinApiOptions & { qrcode: string }): Promise<WeixinQrStatusResponse> {
  return getJson<WeixinQrStatusResponse>({
    baseUrl: params.baseUrl,
    endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(params.qrcode)}`,
    timeoutMs: params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS,
    authorized: false,
  });
}

async function postJson<T>(params: WeixinApiOptions & {
  endpoint: string;
  payload: Record<string, unknown>;
}): Promise<T> {
  const body = JSON.stringify({ ...params.payload, base_info: buildBaseInfo() });
  return requestJson<T>({
    method: "POST",
    endpoint: params.endpoint,
    body,
    timeoutMs: params.timeoutMs ?? DEFAULT_API_TIMEOUT_MS,
    authorized: true,
    headers: {
      "Content-Type": "application/json",
      "AuthorizationType": "ilink_bot_token",
      "Content-Length": String(Buffer.byteLength(body, "utf8")),
    },
    baseUrl: params.baseUrl,
    token: params.token,
  });
}

async function getJson<T>(params: {
  baseUrl: string;
  token?: string | null;
  endpoint: string;
  timeoutMs: number;
  authorized?: boolean;
}): Promise<T> {
  return requestJson<T>({
    method: "GET",
    endpoint: params.endpoint,
    timeoutMs: params.timeoutMs,
    authorized: params.authorized,
    baseUrl: params.baseUrl,
    token: params.token,
  });
}

async function requestJson<T>(params: RawRequestOptions): Promise<T> {
  const url = new URL(joinUrl(params.baseUrl, params.endpoint));
  // 先用主机名直连（交给系统 DNS + SNI，最稳）；失败后再回退到逐个 IP 直连。
  // 之前固定走「解析出 IP → 连 IP」在部分网络/代理环境下握手会卡到超时。
  const ipAddresses = await resolveHostAddresses(url.hostname);
  const candidates = [url.hostname, ...ipAddresses.filter((a) => a !== url.hostname)];
  const startTime = Date.now();
  const deadline = startTime + params.timeoutMs;
  let lastError: unknown = null;

  for (const address of candidates) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    try {
      const response = await requestOverHttpsAddress({
        url,
        address,
        params,
        timeoutMs: Math.min(20_000, remainingMs),
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `weixin ilink http ${response.status} on ${params.method} ${params.endpoint}: ${response.raw.slice(0, 200)}`,
        );
      }
      return response.raw ? (JSON.parse(response.raw) as T) : ({} as T);
    } catch (error) {
      lastError = error;
      if (!isRetryableNetworkError(error)) break;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error(String(lastError ?? "weixin request failed"));
}

async function resolveHostAddresses(hostname: string): Promise<string[]> {
  try {
    const records = await dns.lookup(hostname, { all: true });
    const addresses = records
      .map((record) => record.address)
      .filter((address) => typeof address === "string" && address.trim());
    const unique = [...new Set(addresses)];
    return unique.length > 0 ? unique : [hostname];
  } catch {
    return [hostname];
  }
}

function requestOverHttpsAddress({
  url,
  address,
  params,
  timeoutMs,
}: {
  url: URL;
  address: string;
  params: RawRequestOptions;
  timeoutMs: number;
}): Promise<{ status: number; raw: string }> {
  const headers = buildHeaders({
    token: params.token ?? null,
    authorized: params.authorized ?? true,
    extraHeaders: { ...(params.headers ?? {}), Host: url.hostname },
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = https.request(
      {
        protocol: "https:",
        hostname: address,
        port: url.port ? Number(url.port) : 443,
        method: params.method,
        path: `${url.pathname}${url.search}`,
        headers,
        servername: url.hostname,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("end", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            status: Number(response.statusCode ?? 0),
            raw: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    const timer = setTimeout(() => {
      if (settled) return;
      const error = new Error(`https request timed out after ${timeoutMs}ms`) as NodeJS.ErrnoException;
      error.code = "ETIMEDOUT";
      request.destroy(error);
    }, timeoutMs);

    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    if (params.body) request.write(params.body);
    request.end();
  });
}

function isRetryableNetworkError(error: unknown): boolean {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  return [
    "ECONNRESET",
    "ECONNREFUSED",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
  ].includes(code);
}

function joinUrl(baseUrl: string, endpoint: string): string {
  const normalizedBase = String(baseUrl).replace(/\/+$/u, "");
  const normalizedEndpoint = String(endpoint).replace(/^\/+/u, "");
  return `${normalizedBase}/${normalizedEndpoint}`;
}

function buildHeaders({
  token,
  authorized,
  extraHeaders,
}: {
  token?: string | null;
  authorized: boolean;
  extraHeaders: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_APP_CLIENT_VERSION),
    "X-WECHAT-UIN": randomWechatUin(),
    ...extraHeaders,
  };
  if (authorized && token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function randomWechatUin(): string {
  const value = Math.floor(Math.random() * 0xffffffff);
  return Buffer.from(String(value), "utf8").toString("base64");
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error && error.name === "AbortError";
}
