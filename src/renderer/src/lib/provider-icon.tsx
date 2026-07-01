import {
  siAnthropic, siClaude, siGooglegemini, siDeepseek, siMistralai,
  siOpenrouter, siOllama, siQwen, siAlibabacloud, siBaidu, siMinimax,
  siHuggingface, siPerplexity, siGooglecloud, siX,
  type SimpleIcon,
} from "simple-icons";

// 服务商品牌图标：用开源的 simple-icons（真实 logo，离线、按需 tree-shake）。
// 项目支持任意自配服务商，无法穷举品牌——命中关键词则渲染真实 logo，
// 否则用稳定的彩色首字母圆标兜底。绝不为单一厂商硬编码为必需。

// simple-icons 未收录的少数品牌（OpenAI/Groq/xAI 等出于品牌政策被移除），
// 这里手写最简 logo（path 取自各家公开 logo 轮廓，单色，viewBox 0 0 24 24）。
const MANUAL: Record<string, { path: string; hex: string }> = {
  // OpenAI 花瓣标
  openai: {
    hex: "#000000",
    path: "M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071.006l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071-.006l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z",
  },
  // Groq
  groq: {
    hex: "#F55036",
    path: "M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 4.5a3.5 3.5 0 0 1 3.5 3.5v1.2h-2V10a1.5 1.5 0 1 0-3 0v4a1.5 1.5 0 0 0 1.5 1.5h.5v2H12A3.5 3.5 0 0 1 8.5 14v-4A3.5 3.5 0 0 1 12 6.5z",
  },
  // xAI / Grok（X 形）
  xai: {
    hex: "#000000",
    path: "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  },
};

const SI: Record<string, SimpleIcon> = {
  openai: undefined as any, // handled by MANUAL
  anthropic: siAnthropic,
  claude: siClaude,
  gemini: siGooglegemini,
  deepseek: siDeepseek,
  mistral: siMistralai,
  openrouter: siOpenrouter,
  ollama: siOllama,
  qwen: siQwen,
  alibaba: siAlibabacloud,
  baidu: siBaidu,
  minimax: siMinimax,
  huggingface: siHuggingface,
  perplexity: siPerplexity,
  google: siGooglecloud,
  x: siX,
};

// 关键词 → 品牌 key。匹配 provider 名或 model 名（小写、去空白后包含判断）。
// 顺序重要：更具体的写在前（如 claude 在 anthropic 之外单列，gemini 在 google 之前）。
const BRAND_RULES: Array<{ keys: string[]; brand: string }> = [
  { keys: ["openai", "gpt", "o1", "o3", "o4", "chatgpt"], brand: "openai" },
  { keys: ["claude"], brand: "claude" },
  { keys: ["anthropic"], brand: "anthropic" },
  { keys: ["gemini"], brand: "gemini" },
  { keys: ["deepseek"], brand: "deepseek" },
  { keys: ["mistral", "mixtral", "codestral"], brand: "mistral" },
  { keys: ["openrouter"], brand: "openrouter" },
  { keys: ["ollama", "lmstudio", "lm studio"], brand: "ollama" },
  { keys: ["groq"], brand: "groq" },
  { keys: ["grok", "xai", "x.ai"], brand: "xai" },
  { keys: ["qwen", "通义", "千问", "dashscope", "tongyi"], brand: "qwen" },
  { keys: ["alibaba", "阿里", "bailian", "百炼"], brand: "alibaba" },
  { keys: ["kimi", "moonshot", "月之暗面"], brand: "moonshot" },
  { keys: ["zhipu", "glm", "智谱", "bigmodel", "chatglm"], brand: "zhipu" },
  { keys: ["wenxin", "ernie", "文心", "qianfan", "千帆"], brand: "baidu" },
  { keys: ["baidu", "百度"], brand: "baidu" },
  { keys: ["minimax", "abab"], brand: "minimax" },
  { keys: ["yi-", "零一", "lingyi", "01.ai", "01ai"], brand: "yi" },
  { keys: ["huggingface", "hugging face"], brand: "huggingface" },
  { keys: ["perplexity", "pplx", "sonar"], brand: "perplexity" },
  { keys: ["google", "palm", "bison"], brand: "google" },
];

// 无内置 logo 的品牌（kimi/zhipu/yi 等）：用品牌色 + 首字母，比纯 hash 兜底更贴合。
const BRAND_FALLBACK: Record<string, { hex: string; label: string }> = {
  moonshot: { hex: "#16191E", label: "K" }, // Kimi
  zhipu: { hex: "#3859FF", label: "智" },
  yi: { hex: "#003425", label: "Yi" },
};

export interface BrandInfo { brand: string; hex: string; path?: string; }

/** 解析品牌：返回命中的品牌信息，未命中返回 null。 */
export function providerBrand(s: string): BrandInfo | null {
  if (!s) return null;
  const low = s.toLowerCase().replace(/\s+/g, " ").trim();
  for (const rule of BRAND_RULES) {
    if (rule.keys.some((k) => low.includes(k))) {
      const manual = MANUAL[rule.brand];
      if (manual) return { brand: rule.brand, hex: manual.hex, path: manual.path };
      const icon = SI[rule.brand];
      if (icon) return { brand: rule.brand, hex: "#" + icon.hex, path: icon.path };
      const fb = BRAND_FALLBACK[rule.brand];
      if (fb) return { brand: rule.brand, hex: fb.hex };
      return { brand: rule.brand, hex: "#888888" };
    }
  }
  return null;
}

/** 模型名简化：取首段（到第一个分隔符或数字为止）。deepseek-v4-pro→deepseek、opus-4-2025→opus。 */
export function shortModelName(model: string | undefined | null): string {
  if (!model) return "Agent";
  const seg = String(model).split("/").pop() || String(model); // 去掉 openai/ 这类前缀
  const first = seg.split(/[-_./\s]|(?=\d)/)[0];
  return first || seg || "Agent";
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * 头像旁显示的名字：优先用模型名首段；模型名为空时退回服务商名（首段），
 * 都没有才回 "Agent"。首字母大写。保证「头像是 DeepSeek，名字也叫 Deepseek」不再错位。
 */
export function displayModelName(model?: string | null, providerName?: string | null): string {
  if (model && String(model).trim()) return capitalize(shortModelName(model));
  if (providerName && String(providerName).trim()) return capitalize(shortModelName(providerName));
  return "Agent";
}

// 稳定调色板（未命中品牌时按字符串 hash 取色，保证同名同色）。
const PALETTE = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f43f5e", "#f97316",
  "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
];
function hashColor(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
function firstLetter(s: string): string {
  const t = (s || "").trim();
  return t ? t[0].toUpperCase() : "?";
}

/**
 * 服务商/模型图标。name 与 model 任一传入即可（model 优先用于品牌识别，
 * 因为模型名通常更能反映厂商，如 deepseek-chat / claude-3）。
 */
export function ProviderIcon({ name, model, size = 24, className }: {
  name?: string; model?: string; size?: number; className?: string;
}) {
  const probe = (model || "") + " " + (name || "");
  const brand = providerBrand(probe);
  const dim = size;
  const radius = Math.round(dim * 0.28);

  if (brand && brand.path) {
    // 真实品牌 logo：白色 logo 置于品牌色圆角底。
    return (
      <span
        className={className}
        style={{
          width: dim, height: dim, borderRadius: radius, background: brand.hex,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <svg width={dim * 0.62} height={dim * 0.62} viewBox="0 0 24 24" fill="#ffffff" aria-hidden>
          <path d={brand.path} />
        </svg>
      </span>
    );
  }

  // 兜底：品牌专属字母（如 Kimi=K）或服务商名首字母，彩色圆角底。
  const fb = brand ? BRAND_FALLBACK[brand.brand] : null;
  const label = fb ? fb.label : firstLetter(name || model || "");
  const bg = fb ? fb.hex : hashColor(name || model || "?");
  return (
    <span
      className={className}
      style={{
        width: dim, height: dim, borderRadius: radius, background: bg,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        color: "#ffffff", fontWeight: 600, fontSize: dim * 0.46, flexShrink: 0,
        lineHeight: 1, fontFamily: "system-ui, sans-serif",
      }}
    >
      {label}
    </span>
  );
}

/** 余额颜色分级：>30 绿、15–30 黄、<15 红。 */
export function balanceColor(n: number): string {
  if (n > 30) return "#22c55e";
  if (n >= 15) return "#eab308";
  return "#ef4444";
}
