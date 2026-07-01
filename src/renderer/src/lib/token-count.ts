// Token 估算工具——给 /context 面板和将来的 token 用量面板共用。
//
// 背景（已调研）：Anthropic 不发布本地 tokenizer，所有本地计数都是近似；
// UE Coworker 又是多 provider（不绑某一家），无法用单一厂商的精确分词器。
// 行业通用做法（cc-switch / vibe-meter 等）是用 OpenAI 的 BPE 分词器做近似，
// 误差可接受。这里用 js-tiktoken 的 o200k_base（GPT-4o/最新模型编码，对现代
// 模型最接近），封装成同步的 estimateTokens()。
//
// 精确值仍以 API 响应里的 usage 为准（agent-loop 已采集真实 usage）；本模块
// 仅用于"发送前"的占用预估（实时面板，不可能每次都联网 count）。所有展示处
// 都应标注"估算"。

import { getEncoding, type Tiktoken } from "js-tiktoken";

let enc: Tiktoken | null = null;
function encoder(): Tiktoken | null {
  if (enc) return enc;
  try {
    enc = getEncoding("o200k_base");
  } catch {
    enc = null; // 极端情况下加载失败：退回字符近似（见下）。
  }
  return enc;
}

// 估算一段文本的 token 数。优先 BPE 分词；失败则退回 字符数/4 的通用近似。
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const e = encoder();
  if (e) {
    try { return e.encode(text).length; } catch { /* 落到字符近似 */ }
  }
  return Math.ceil(text.length / 4);
}

// 估算多段文本的总 token（便于按类别累加）。
export function estimateTokensMany(parts: Array<string | undefined | null>): number {
  let n = 0;
  for (const p of parts) if (p) n += estimateTokens(p);
  return n;
}

// 紧凑显示：1234 → "1.2k"、999 → "999"。面板/标签用。
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(n < 10000 ? 1 : 0) + "k";
}
