/**
 * 构造并发送微信图片/文件媒体消息。移植自 codex-bridge 的 send.ts，裁到 image/file。
 * 直接调 api 层 sendMessage（发原始 msg），因为 transport.sendMessage 只发文本。
 */
import crypto from "node:crypto";
import { sendMessage as sendMessageApi } from "../api";
import type { WeixinApiOptions } from "../api";
import type { MessageItem } from "../types";
import { MessageItemType, MessageState, MessageType } from "../types";
import type { UploadedFileInfo } from "./upload";

export class WeixinSendResponseError extends Error {
  code: number;
  label: string;
  constructor(label: string, code: number) {
    super(`${label}: ${code}`);
    this.name = "WeixinSendResponseError";
    this.code = code;
    this.label = label;
  }
}

export function isWeixinSendResponseError(error: unknown): error is WeixinSendResponseError {
  return error instanceof WeixinSendResponseError;
}

function generateClientId(): string {
  return `ue-coworker-weixin-${crypto.randomUUID()}`;
}

function assertSuccessfulSendResponse(result: unknown, label: string): void {
  const ret = Number((result as Record<string, unknown> | null)?.ret ?? 0);
  const errcode = Number((result as Record<string, unknown> | null)?.errcode ?? 0);
  const code = errcode || ret;
  if (code === 0) return;
  throw new WeixinSendResponseError(label, code);
}

// 发「可选的文字 + 一个媒体条目」。文字与媒体各作为独立消息发出（与官方客户端一致）。
async function sendMediaItems(params: {
  to: string;
  text: string;
  mediaItem: MessageItem;
  opts: WeixinApiOptions & { contextToken?: string | null };
}): Promise<{ messageId: string }> {
  const items: MessageItem[] = [];
  if (params.text) items.push({ type: MessageItemType.TEXT, text_item: { text: params.text } });
  items.push(params.mediaItem);

  let lastClientId = "";
  for (const item of items) {
    lastClientId = generateClientId();
    const result = await sendMessageApi({
      baseUrl: params.opts.baseUrl,
      token: params.opts.token,
      timeoutMs: params.opts.timeoutMs,
      msg: {
        from_user_id: "",
        to_user_id: params.to,
        client_id: lastClientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: [item],
        context_token: params.opts.contextToken ?? undefined,
      },
    });
    assertSuccessfulSendResponse(result, "sendMediaItems");
  }
  return { messageId: lastClientId };
}

export async function sendImageMessageWeixin(params: {
  to: string;
  text: string;
  uploaded: UploadedFileInfo;
  opts: WeixinApiOptions & { contextToken?: string | null };
}): Promise<{ messageId: string }> {
  return sendMediaItems({
    to: params.to,
    text: params.text,
    opts: params.opts,
    mediaItem: {
      type: MessageItemType.IMAGE,
      image_item: {
        media: {
          encrypt_query_param: params.uploaded.downloadEncryptedQueryParam,
          aes_key: encodeWeixinMediaAesKey(params.uploaded.aeskey),
          encrypt_type: 1,
        },
        mid_size: params.uploaded.fileSizeCiphertext,
      },
    },
  });
}

export async function sendFileMessageWeixin(params: {
  to: string;
  text: string;
  fileName: string;
  uploaded: UploadedFileInfo;
  opts: WeixinApiOptions & { contextToken?: string | null };
}): Promise<{ messageId: string }> {
  return sendMediaItems({
    to: params.to,
    text: params.text,
    opts: params.opts,
    mediaItem: {
      type: MessageItemType.FILE,
      file_item: {
        media: {
          encrypt_query_param: params.uploaded.downloadEncryptedQueryParam,
          aes_key: encodeWeixinMediaAesKey(params.uploaded.aeskey),
          encrypt_type: 1,
        },
        file_name: params.fileName,
        md5: params.uploaded.fileMd5,
        len: String(params.uploaded.fileSize),
      },
    },
  });
}

function encodeWeixinMediaAesKey(aesKeyHex: string): string {
  // 官方 iLink 客户端在传输时把 hex 串本身再 base64，微信客户端才能正确解密上传的媒体。
  return Buffer.from(aesKeyHex).toString("base64");
}
