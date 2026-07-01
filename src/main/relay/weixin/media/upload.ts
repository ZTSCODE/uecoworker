/**
 * 加密上传本地文件到微信 CDN（图片/文件）。移植自 codex-bridge 的 cdn/upload.ts，
 * 裁掉视频缩略图与 ffmpeg probe —— 图片/文件都不需要缩略图（no_need_thumb）。
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { getUploadUrl } from "../api";
import type { WeixinApiOptions } from "../api";
import { UploadMediaType } from "../types";
import { aesEcbPaddedSize } from "./aes_ecb";
import { uploadBufferToCdn } from "./cdn_upload";

export type UploadedFileInfo = {
  filekey: string;
  downloadEncryptedQueryParam: string;
  // AES-128 key 以 32 字符 hex 串保存；下行发媒体消息时微信要求把该 hex 串本身再
  // base64（对齐 openclaw-weixin / 官方 iLink 客户端），不是原始 16 字节 base64。
  aeskey: string;
  fileSize: number;
  fileSizeCiphertext: number;
  fileMd5: string;
};

async function uploadMediaToCdn(params: {
  filePath: string;
  toUserId: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
  mediaType: (typeof UploadMediaType)[keyof typeof UploadMediaType];
  label: string;
}): Promise<UploadedFileInfo> {
  const plaintext = await fs.readFile(params.filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash("md5").update(plaintext).digest("hex");
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString("hex");
  const aeskey = crypto.randomBytes(16);

  const uploadUrlResp = await getUploadUrl({
    baseUrl: params.opts.baseUrl,
    token: params.opts.token,
    timeoutMs: params.opts.timeoutMs,
    filekey,
    media_type: params.mediaType,
    to_user_id: params.toUserId,
    rawsize,
    rawfilemd5,
    filesize,
    no_need_thumb: true,
    aeskey: aeskey.toString("hex"),
  });

  const { downloadParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadFullUrl: uploadUrlResp.upload_full_url || undefined,
    uploadParam: uploadUrlResp.upload_param ?? undefined,
    filekey,
    cdnBaseUrl: params.cdnBaseUrl,
    aeskey,
    label: `${params.label}[filekey=${filekey}]`,
  });

  return {
    filekey,
    downloadEncryptedQueryParam: downloadParam,
    aeskey: aeskey.toString("hex"),
    fileSize: rawsize,
    fileSizeCiphertext: filesize,
    fileMd5: rawfilemd5,
  };
}

/** 作为图片上传（手机端会内联显示为图片）。 */
export async function uploadImageToWeixin(params: {
  filePath: string;
  toUserId: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({ ...params, mediaType: UploadMediaType.IMAGE, label: "uploadImageToWeixin" });
}

/** 作为文件附件上传（手机端显示为可下载文件，保留原画质/原格式）。 */
export async function uploadFileAttachmentToWeixin(params: {
  filePath: string;
  toUserId: string;
  opts: WeixinApiOptions;
  cdnBaseUrl: string;
}): Promise<UploadedFileInfo> {
  return uploadMediaToCdn({ ...params, mediaType: UploadMediaType.FILE, label: "uploadFileAttachmentToWeixin" });
}
