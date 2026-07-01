/**
 * 微信官方 iLink 机器人（clawbot）HTTP/JSON 协议类型。
 *
 * 移植自 codex-bridge 的 `platforms/weixin/official/types.ts`，裁剪到「文本 + 图片 +
 * 文件」收发所需。语音（voice/silk）与视频（缩略图依赖 ffmpeg）本版不做，故不含
 * voice_item/video_item 的完整结构。
 */

export interface BaseInfo {
  channel_version?: string;
}

/** 消息条目类型。 */
export const MessageItemType = {
  NONE: 0,
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

/** 上传媒体类型。 */
export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

export const MessageType = {
  NONE: 0,
  USER: 1,
  BOT: 2,
} as const;

export const MessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

/** typing 状态。 */
export const TypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const;

export interface TextItem {
  text?: string;
}

/** CDN 媒体引用（加密下载所需）。 */
export interface CDNMedia {
  encrypt_query_param?: string;
  aes_key?: string;
  encrypt_type?: number;
  full_url?: string;
}

export interface ImageItem {
  media?: CDNMedia;
  thumb_media?: CDNMedia;
  aeskey?: string;
  url?: string;
  mid_size?: number;
}

export interface FileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
}

export interface MessageItem {
  type?: number;
  create_time_ms?: number;
  update_time_ms?: number;
  is_completed?: boolean;
  msg_id?: string;
  text_item?: TextItem;
  image_item?: ImageItem;
  file_item?: FileItem;
}

export interface WeixinMessage {
  seq?: number;
  message_id?: number | string;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  delete_time_ms?: number;
  session_id?: string;
  group_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: MessageItem[];
  context_token?: string;
}

export interface GetUpdatesReq {
  get_updates_buf?: string;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  sync_buf?: string;
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

export interface GetUploadUrlReq {
  filekey?: string;
  media_type?: number;
  to_user_id?: string;
  rawsize?: number;
  rawfilemd5?: string;
  filesize?: number;
  thumb_rawsize?: number;
  thumb_rawfilemd5?: string;
  thumb_filesize?: number;
  no_need_thumb?: boolean;
  aeskey?: string;
}

export interface GetUploadUrlResp {
  upload_param?: string;
  thumb_upload_param?: string;
  upload_full_url?: string;
}

export interface SendMessageReq {
  msg?: WeixinMessage;
}

export interface SendMessageResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

export interface SendTypingReq {
  ilink_user_id?: string;
  typing_ticket?: string;
  status?: number;
}

export interface SendTypingResp {
  ret?: number;
  errmsg?: string;
}

export interface GetConfigReq {
  ilink_user_id?: string;
  context_token?: string;
}

export interface GetConfigResp {
  ret?: number;
  errmsg?: string;
  typing_ticket?: string;
}

export interface WeixinQrCodeResponse {
  qrcode?: string;
  qrcode_img_content?: string;
}

export interface WeixinQrStatusResponse {
  status?: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect' | string;
  redirect_host?: string;
  ilink_bot_id?: string;
  bot_token?: string;
  baseurl?: string;
  ilink_user_id?: string;
}
