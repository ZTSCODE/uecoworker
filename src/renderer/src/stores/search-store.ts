import { create } from "zustand";

/**
 * 网络搜索后端配置（可选，多选）。默认免 key，走主进程的 SearXNG/DDG。
 * 用户可启用一个或多个搜索 API 作为更稳定的兜底——agent 搜索时按顺序逐个尝试，
 * 一个失败自动试下一个，全部失败再回落免 key。哪个上次成功，下次优先（自适应排序，
 * 排序记忆在主进程）。每个后端的 key 是 secret，加密存于主进程
 * （id "__websearch_<kind>__"，复用 SecretsManager），这里只存非密的启用集合。
 */
export type SearchKind = "tavily" | "brave" | "serper";

// 每个后端 key 在 SecretsManager 里的固定 id。
export function searchSecretId(kind: SearchKind): string {
  return "__websearch_" + kind + "__";
}

const ENABLED_KEY = "ue-coworker-search-enabled";

// hint 为中文、hintEn 为英文；消费方（SearchSettings）按当前界面语言择一显示。
export const SEARCH_BACKENDS: Array<{ kind: SearchKind; label: string; hint: string; hintEn: string }> = [
  { kind: "tavily", label: "Tavily", hint: "api.tavily.com，每月有免费额度，专为 LLM 设计", hintEn: "api.tavily.com — monthly free quota, built for LLMs" },
  { kind: "brave", label: "Brave Search", hint: "api.search.brave.com，免费层每月 2000 次", hintEn: "api.search.brave.com — free tier of 2,000 queries/month" },
  { kind: "serper", label: "Serper (Google)", hint: "google.serper.dev，免费 2500 次起", hintEn: "google.serper.dev — free tier starting at 2,500 queries" },
];

const ALL_KINDS: SearchKind[] = SEARCH_BACKENDS.map((b) => b.kind);

interface SearchState {
  // 已启用的后端集合（多选）。
  enabled: Record<SearchKind, boolean>;
  // 每个后端是否已保存 key。
  hasKey: Record<SearchKind, boolean>;

  toggleEnabled: (kind: SearchKind, on: boolean) => void;
  /** 保存/清除某后端的 key（空串=清除，并自动取消启用）。 */
  setKey: (kind: SearchKind, key: string) => Promise<void>;
  /** 从主进程刷新所有后端的 hasKey 标志。 */
  refreshKeyFlags: () => Promise<void>;
  /** 实际生效的后端列表（启用且有 key）；传给 agent。 */
  enabledKinds: () => SearchKind[];
}

function emptyBool(): Record<SearchKind, boolean> {
  return { tavily: false, brave: false, serper: false };
}

function loadEnabled(): Record<SearchKind, boolean> {
  const out = emptyBool();
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        for (const k of arr) if (ALL_KINDS.indexOf(k) !== -1) out[k as SearchKind] = true;
      }
    }
  } catch { /* ignore corrupt value */ }
  return out;
}

function saveEnabled(enabled: Record<SearchKind, boolean>): void {
  const arr = ALL_KINDS.filter((k) => enabled[k]);
  localStorage.setItem(ENABLED_KEY, JSON.stringify(arr));
}

export const useSearchStore = create<SearchState>((set, get) => ({
  enabled: loadEnabled(),
  hasKey: emptyBool(),

  toggleEnabled: (kind, on) => {
    set((s) => {
      const enabled = { ...s.enabled, [kind]: on };
      saveEnabled(enabled);
      return { enabled };
    });
  },

  setKey: async (kind, key) => {
    if (key) {
      await window.api.setSecret?.(searchSecretId(kind), key);
      set((s) => ({ hasKey: { ...s.hasKey, [kind]: true } }));
    } else {
      await window.api.deleteSecret?.(searchSecretId(kind));
      // Clearing the key also disables the backend (it can't be used without one).
      set((s) => {
        const enabled = { ...s.enabled, [kind]: false };
        saveEnabled(enabled);
        return { hasKey: { ...s.hasKey, [kind]: false }, enabled };
      });
    }
  },

  refreshKeyFlags: async () => {
    const next = emptyBool();
    for (const k of ALL_KINDS) {
      try {
        const has = await (window.api.hasSecret?.(searchSecretId(k)) ?? Promise.resolve(false));
        next[k] = !!has;
      } catch { /* ignore */ }
    }
    set({ hasKey: next });
  },

  enabledKinds: () => {
    const { enabled, hasKey } = get();
    // Only backends that are both enabled AND have a saved key are usable.
    return ALL_KINDS.filter((k) => enabled[k] && hasKey[k]);
  },
}));

// Populate hasKey flags once at startup so enabledKinds() is correct even if the
// user never opens the search settings panel this session.
if (typeof window !== "undefined") {
  // Defer to next tick so window.api is ready.
  setTimeout(() => { useSearchStore.getState().refreshKeyFlags(); }, 0);
}
