/**
 * 入站媒体下载解密（图片/文件）。移植自 codex-bridge 的 media/media_download.ts，
 * 裁掉语音（silk 转码）与视频，只处理 IMAGE/FILE，落到临时文件返回路径。
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { downloadAndDecryptBuffer, downloadPlainCdnBuffer } from "./pic_decrypt";
import { getExtensionFromMime, getMimeFromFilename } from "./mime";
import { MessageItemType, type MessageItem } from "../types";

const WEIXIN_MEDIA_MAX_BYTES = 100 * 1024 * 1024;   // 入站硬上限 100MB

export interface InboundMedia {
  kind: "image" | "file";
  filePath: string;
  fileName?: string;
  mime?: string;
}

// 把解密后的 buffer 写到系统临时目录，返回绝对路径。
async function saveTempMedia(buf: Buffer, ext: string, originalName?: string): Promise<string> {
  if (buf.length > WEIXIN_MEDIA_MAX_BYTES) {
    throw new Error(`weixin inbound media too large: ${buf.length} bytes (max ${WEIXIN_MEDIA_MAX_BYTES})`);
  }
  const dir = path.join(os.tmpdir(), "cw-weixin-inbound");
  await fs.mkdir(dir, { recursive: true });
  const safeName = originalName ? sanitize(originalName) : `weixin-${randomUUID()}${ext}`;
  const filePath = path.join(dir, `${randomUUID()}-${safeName}`);
  await fs.writeFile(filePath, buf);
  return filePath;
}

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || "file";
}

/** 下载并解密一条入站消息条目（图片/文件）。非图片/文件返回 null。 */
export async function downloadInboundMedia(
  item: MessageItem,
  deps: { cdnBaseUrl: string; label: string },
): Promise<InboundMedia | null> {
  if (item.type === MessageItemType.IMAGE) {
    const img = item.image_item;
    if (!img?.media?.encrypt_query_param && !img?.media?.full_url) return null;
    // aeskey 优先用 item 上的 hex（转 base64），否则用 media.aes_key。
    const aesKeyBase64 = img.aeskey
      ? Buffer.from(img.aeskey, "hex").toString("base64")
      : img.media?.aes_key;
    const buf = aesKeyBase64
      ? await downloadAndDecryptBuffer(
          img.media?.encrypt_query_param ?? "",
          aesKeyBase64,
          deps.cdnBaseUrl,
          `${deps.label} image`,
          img.media?.full_url,
        )
      : await downloadPlainCdnBuffer(
          img.media?.encrypt_query_param ?? "",
          deps.cdnBaseUrl,
          `${deps.label} image-plain`,
          img.media?.full_url,
        );
    const filePath = await saveTempMedia(buf, ".jpg");
    return { kind: "image", filePath, mime: "image/jpeg" };
  }

  if (item.type === MessageItemType.FILE) {
    const fileItem = item.file_item;
    if ((!fileItem?.media?.encrypt_query_param && !fileItem?.media?.full_url) || !fileItem?.media?.aes_key) {
      return null;
    }
    const buf = await downloadAndDecryptBuffer(
      fileItem.media.encrypt_query_param ?? "",
      fileItem.media.aes_key,
      deps.cdnBaseUrl,
      `${deps.label} file`,
      fileItem.media.full_url,
    );
    const fileName = fileItem.file_name || `weixin-file${getExtensionFromMime(getMimeFromFilename(fileItem.file_name ?? ""))}`;
    const mime = getMimeFromFilename(fileName);
    const filePath = await saveTempMedia(buf, path.extname(fileName) || ".bin", fileName);
    return { kind: "file", filePath, fileName, mime };
  }

  return null;
}
