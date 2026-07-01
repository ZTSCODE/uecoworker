import { create } from "zustand";

/**
 * Single source of truth for AI provider configuration.
 *
 * The app is provider-agnostic: any OpenAI-compatible endpoint works (official
 * APIs, third-party relays/中转站, or local models). Nothing is hardcoded as
 * required — the user supplies name / baseUrl / models / headers freely.
 *
 * API keys are NOT persisted in localStorage. Only non-secret metadata lives
 * here; the key is stored encrypted in the main process (see SecretsManager)
 * and referenced by `provider.id`.
 */
/** Wire protocol the provider speaks. Default "openai" (OpenAI-compatible
 *  /chat/completions). "anthropic" uses the native /v1/messages endpoint.
 *  "responses" uses OpenAI's /v1/responses endpoint (native image-in-tool-output
 *  support; only some providers/relays implement it). */
export type ProviderProtocol = "openai" | "anthropic" | "responses";

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  headers: Record<string, string>;
  /** Wire protocol; undefined = "openai" (backward-compatible with existing providers). */
  protocol?: ProviderProtocol;
  /** Whether this model accepts image input (vision). undefined/true = supported
   *  (most modern models are); set false for text-only models so the agent uses
   *  browser_snapshot instead of screenshots and tool-produced images are dropped. */
  vision?: boolean;
  /** Whether a key has been stored for this provider (mirrored from main). */
  hasKey?: boolean;
  /** 用户自定义余额查询脚本（JS 对象字面量文本）。
   *  格式: ({ request: { url, method, headers }, extractor: fn(response) => { remaining, unit } })
   *  主进程 vm 沙盒执行；url 中 {{baseUrl}} 会被替换为 provider.baseUrl。 */
  balanceScript?: string;
  /** 标记该供应商为「图片生成」端点：可被 agent 的 generate_image 工具调用，
   *  在对话里直接选中它发消息也会直接出图（把输入当 prompt）。普通聊天供应商为 false/undefined。 */
  imageGen?: boolean;
  /** 图片生成端点形态：images=POST /v1/images/generations；chat=POST /v1/chat/completions
   *  （聊天补全式出图，从返回消息里抽图）；raw=直接 POST baseUrl 原样（不补 /v1/后缀，
   *  给会自动补全路径的中转站）。undefined 视作 "images"。 */
  imageEndpoint?: "images" | "chat" | "raw";
  /** 自定义余额查询的独立令牌（部分供应商的余额接口与模型 key 不同）。留空则沿用模型 apiKey。 */
  balanceToken?: string;
  /** 自定义余额查询的独立接口地址（与模型 baseUrl 不同时填）。留空则沿用模型 baseUrl；
   *  脚本里 {{baseUrl}} 会替换为此值（有则用它，无则用 provider.baseUrl）。 */
  balanceBaseUrl?: string;
}

/** A provider with its decrypted key resolved — only built at send time. */
export interface ResolvedProvider extends Provider {
  apiKey: string;
}

const STORAGE_KEY = "ue-coworker-providers";
const SELECTED_KEY = "ue-coworker-selected-provider";

/** Optional quick-fill templates. Empty keys; user may edit or delete freely. */
export const PROVIDER_TEMPLATES: Omit<Provider, "id">[] = [
  { name: "OpenAI", baseUrl: "https://api.openai.com", models: ["gpt-4o", "gpt-4o-mini"], headers: {} },
  { name: "Anthropic", baseUrl: "https://api.anthropic.com", models: ["claude-sonnet-4-6", "claude-opus-4-8"], headers: {}, protocol: "anthropic" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com", models: ["deepseek-chat", "deepseek-reasoner"], headers: {} },
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api", models: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"], headers: {} },
  { name: "本地 (Ollama / LM Studio)", baseUrl: "http://localhost:11434", models: ["llama3.1"], headers: {} },
];

/** Cached balance for a provider (best-effort; absent if probe failed).
 *  `usedToday` is derived by subtraction: today's first observed balance minus
 *  the current one (so we never have to ask the provider for usage). */
export interface ProviderBalance { remaining: number; unit: string; fetchedAt: number; usedToday?: number; }

interface ProviderState {
  providers: Provider[];
  selectedProviderId: string;
  selectedModel: string;
  /** Per-provider balance cache, keyed by provider id. */
  balances: Record<string, ProviderBalance>;
  setSelectedProviderId: (id: string) => void;
  setSelectedModel: (model: string) => void;
  addProvider: (p: Omit<Provider, "id">) => string;
  updateProvider: (id: string, patch: Partial<Provider>) => void;
  removeProvider: (id: string) => void;
  /** Persist a key for a provider (encrypted, main process). */
  setKey: (id: string, key: string) => Promise<void>;
  /** Build a send-ready provider with its decrypted key. */
  resolve: (id: string) => Promise<ResolvedProvider | null>;
  /** Refresh hasKey flags from main process. */
  refreshKeyFlags: () => Promise<void>;
  /** Probe one provider's balance (best-effort; silent on failure). */
  refreshBalance: (id: string) => Promise<void>;
  /** Probe balances for all providers that have a key. */
  refreshAllBalances: () => Promise<void>;
}

function loadProviders(): Provider[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Strip any legacy apiKey field that may have been stored before encryption.
    return parsed.map((p: any) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      models: Array.isArray(p.models) ? p.models : [],
      headers: p.headers || {},
      protocol: p.protocol === "anthropic" ? "anthropic" : p.protocol === "responses" ? "responses" : undefined,
      vision: p.vision === false ? false : undefined,
      balanceScript: p.balanceScript || undefined,
      balanceToken: p.balanceToken || undefined,
      balanceBaseUrl: p.balanceBaseUrl || undefined,
      imageGen: !!p.imageGen,
      imageEndpoint: p.imageEndpoint === "chat" ? "chat" : p.imageEndpoint === "raw" ? "raw" : (p.imageGen ? "images" : undefined),
    }));
  } catch {
    return [];
  }
}

function persist(providers: Provider[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(providers));
}

let idCounter = 0;
function genId(): string {
  return "prov-" + Date.now() + "-" + (++idCounter);
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: loadProviders(),
  selectedProviderId: localStorage.getItem(SELECTED_KEY) || "",
  selectedModel: "",
  balances: {},

  setSelectedProviderId: (id) => {
    localStorage.setItem(SELECTED_KEY, id);
    const prov = get().providers.find((p) => p.id === id);
    set({ selectedProviderId: id, selectedModel: prov?.models[0] || "" });
  },

  setSelectedModel: (model) => set({ selectedModel: model }),

  addProvider: (p) => {
    const id = genId();
    const provider: Provider = { id, ...p };
    set((s) => {
      const providers = [...s.providers, provider];
      persist(providers);
      return { providers };
    });
    return id;
  },

  updateProvider: (id, patch) => set((s) => {
    const providers = s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p));
    persist(providers);
    return { providers };
  }),

  removeProvider: (id) => {
    window.api.deleteSecret?.(id);
    set((s) => {
      const providers = s.providers.filter((p) => p.id !== id);
      persist(providers);
      const selectedProviderId = s.selectedProviderId === id ? (providers[0]?.id || "") : s.selectedProviderId;
      return { providers, selectedProviderId };
    });
  },

  setKey: async (id, key) => {
    await window.api.setSecret?.(id, key);
    set((s) => ({
      providers: s.providers.map((p) => (p.id === id ? { ...p, hasKey: !!key } : p)),
    }));
  },

  resolve: async (id) => {
    const prov = get().providers.find((p) => p.id === id);
    if (!prov) return null;
    const apiKey = (await window.api.getSecret?.(id)) || "";
    return { ...prov, apiKey };
  },

  refreshKeyFlags: async () => {
    const providers = get().providers;
    const flags = await Promise.all(
      providers.map((p) => window.api.hasSecret?.(p.id) ?? Promise.resolve(false))
    );
    set({
      providers: providers.map((p, i) => ({ ...p, hasKey: !!flags[i] })),
    });
  },

  refreshBalance: async (id) => {
    const prov = get().providers.find((p) => p.id === id);
    if (!prov || !prov.baseUrl) return;
    const apiKey = (await window.api.getSecret?.(id)) || "";
    // 余额查询令牌优先用独立配置 balanceToken，留空则沿用模型 apiKey；两者都无则放弃。
    const balanceKey = (prov.balanceToken && prov.balanceToken.trim()) || apiKey;
    if (!balanceKey) return;
    // 余额查询地址优先用独立配置 balanceBaseUrl，留空则沿用模型 baseUrl。
    const balanceBase = (prov.balanceBaseUrl && prov.balanceBaseUrl.trim()) || prov.baseUrl;
    try {
      const res = await window.api.getProviderBalance?.({ baseUrl: balanceBase, apiKey: balanceKey, headers: prov.headers, balanceScript: prov.balanceScript });
      // 余额小于 -100 或大于 999 视为查询失败（脏数据），不更新显示、不记录历史。
      if (res && res.ok && typeof res.remaining === "number" && res.remaining >= -100 && res.remaining <= 999) {
        const remaining = res.remaining;
        // 今日已用 = 今天首次观测到的余额 − 当前余额（纯减法，不问供应商）。
        // 基线按 provider + 当天日期存 localStorage，跨天自动重置。
        const today = new Date().toISOString().slice(0, 10);
        const baseKey = "ue-coworker-bal-baseline-" + id;
        let baseline: { date: string; value: number } | null = null;
        try { baseline = JSON.parse(localStorage.getItem(baseKey) || "null"); } catch {}
        if (!baseline || baseline.date !== today || remaining > baseline.value) {
          // 新的一天，或余额回升（充值）→ 重置基线为当前值。
          baseline = { date: today, value: remaining };
          localStorage.setItem(baseKey, JSON.stringify(baseline));
        }
        const usedToday = Math.max(0, baseline.value - remaining);
        set((s) => ({
          balances: {
            ...s.balances,
            [id]: { remaining, unit: res.unit || "USD", fetchedAt: Date.now(), usedToday },
          },
        }));
        // 记一条余额快照到持久化（main 侧去抖）。供 Analytics 画余额历史曲线。
        try { (window.api as any).recordBalance?.({ providerId: id, remaining, unit: res.unit || "USD", ts: Date.now() }); } catch {}
      }
    } catch { /* silent — balance is best-effort */ }
  },

  refreshAllBalances: async () => {
    const providers = get().providers;
    await Promise.all(providers.map((p) => get().refreshBalance(p.id)));
  },
}));

// 启动时填一次 hasKey 标记，使 listImageProviders() 等过滤即便用户从不打开供应商
// 设置面板也能正确。否则首开软件用生图模型必报「未配置 provider」，点一下设置再回来才行。
if (typeof window !== "undefined") {
  // 延到下一 tick，确保 window.api 已就绪。
  setTimeout(() => { useProviderStore.getState().refreshKeyFlags(); }, 0);
}
