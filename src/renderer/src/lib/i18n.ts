import { create } from "zustand";

// 仅界面语言（UI）切换；不影响发往模型的内部提示词/工具协议等内部内容。
export type Lang = "zh" | "en";

function loadLang(): Lang {
  const v = localStorage.getItem("ue-coworker-ui-lang");
  return v === "en" || v === "zh" ? v : "zh";
}

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useLangStore = create<LangState>((set) => ({
  lang: loadLang(),
  setLang: (l) => {
    localStorage.setItem("ue-coworker-ui-lang", l);
    set({ lang: l });
  },
}));

// 非响应式取值：用于组件外（事件回调、title 字符串拼接等）。语言切换后这些会在下次
// 读取时生效——绝大多数是 title/通知类一次性文案，无需即时重渲染。
export function tr(zh: string, en: string): string {
  return useLangStore.getState().lang === "en" ? en : zh;
}

// 响应式 hook：组件里 `const t = useT()` 后用 `t("中文","English")`。
// 语言切换时订阅 lang 的组件会重渲染，文案随之更新。
export function useT(): (zh: string, en: string) => string {
  const lang = useLangStore((s) => s.lang);
  return (zh: string, en: string) => (lang === "en" ? en : zh);
}
