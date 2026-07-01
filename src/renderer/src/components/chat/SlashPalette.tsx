import { useLayoutEffect, useRef } from "react";
import { cn } from "../../lib/utils";
import type { SlashCommand } from "../../lib/slash-commands";
import { Sparkles, Check } from "lucide-react";
import { useT, tr, useLangStore } from "../../lib/i18n";

// 推理强度档位（与 ChatView 的 EFFORT_MODES 对应）。value "" = 端点默认。
// label/desc 在渲染时按当前语言取值（见下方 t(...)），不在模块级用 tr() 固化。
export var EFFORT_OPTIONS: { value: string; labelZh: string; labelEn: string; descZh: string; descEn: string }[] = [
  { value: "", labelZh: "默认强度", labelEn: "Default", descZh: "跟随端点默认，不发送 reasoning_effort", descEn: "Follow the endpoint default; don't send reasoning_effort" },
  { value: "minimal", labelZh: "最小", labelEn: "Minimal", descZh: "几乎不额外推理，最快最省", descEn: "Almost no extra reasoning; fastest and cheapest" },
  { value: "low", labelZh: "低", labelEn: "Low", descZh: "少量推理", descEn: "A little reasoning" },
  { value: "medium", labelZh: "中", labelEn: "Medium", descZh: "平衡推理深度与速度", descEn: "Balance reasoning depth and speed" },
  { value: "high", labelZh: "高", labelEn: "High", descZh: "更深入推理，更慢更贵", descEn: "Deeper reasoning; slower and more expensive" },
];

// 斜杠命令面板：悬浮在输入框上方，键盘上下选择、Enter/Tab 补全、Esc 关闭。
// 视觉与底部 composer / ModelPicker 浮层保持一致（圆角卡片 + 阴影 + 强调高亮）。
// effortMenu 非空时，在面板顶部叠加「推理强度」二级面板（覆盖于命令列表之上）。
export function SlashPalette({ items, activeIndex, onHover, onPick, effortMenu }: {
  items: SlashCommand[];
  activeIndex: number;
  onHover: (i: number) => void;
  onPick: (cmd: SlashCommand) => void;
  effortMenu?: {
    current: string;
    activeIndex: number;
    onHover: (i: number) => void;
    onPick: (value: string) => void;
  } | null;
}) {
  var t = useT();
  var lang = useLangStore(function (s) { return s.lang; });
  var listRef = useRef<HTMLDivElement>(null);
  var effortRef = useRef<HTMLDivElement>(null);

  // 选中项滚动进视野（键盘上下移动时）。
  useLayoutEffect(function () {
    var el = listRef.current;
    if (!el) return;
    var active = el.querySelector('[data-active="true"]') as HTMLElement | null;
    if (active) active.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  useLayoutEffect(function () {
    if (!effortMenu) return;
    var el = effortRef.current;
    if (!el) return;
    var active = el.querySelector('[data-active="true"]') as HTMLElement | null;
    if (active) active.scrollIntoView({ block: "nearest" });
  }, [effortMenu && effortMenu.activeIndex]);

  // 二级面板：推理强度选择。覆盖在斜杠命令列表之上（取代列表内容），
  // 顶部沿用同样的标题栏样式，保持视觉连续。
  if (effortMenu) {
    return (
      <div className="mb-2 rounded-2xl border border-border bg-card shadow-xl shadow-black/10 overflow-hidden animate-slide-up">
        <div className="px-3 py-1.5 border-b border-border/60 flex items-center gap-1.5">
          <span className="font-mono text-xs text-accent-brand">/effort</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{t("推理强度", "Reasoning Effort")}</span>
          <span className="ml-auto text-[10px] text-muted-foreground/60">{t("↑↓ 选择 · Enter 确认 · Esc 返回", "↑↓ select · Enter confirm · Esc back")}</span>
        </div>
        <div ref={effortRef} className="max-h-64 overflow-y-auto py-1">
          {EFFORT_OPTIONS.map(function (o, i) {
            var active = i === effortMenu.activeIndex;
            var sel = o.value === effortMenu.current;
            return (
              <button
                key={o.value || "default"}
                data-active={active}
                onMouseEnter={function () { effortMenu.onHover(i); }}
                onMouseDown={function (e) { e.preventDefault(); effortMenu.onPick(o.value); }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
                  active ? "bg-accent/60" : "hover:bg-accent/30"
                )}
              >
                <span className="text-xs font-medium text-foreground shrink-0 w-12">{t(o.labelZh, o.labelEn)}</span>
                <span className="text-[11px] text-muted-foreground truncate flex-1 min-w-0">{t(o.descZh, o.descEn)}</span>
                {sel && <Check size={13} className="text-accent-brand shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className="mb-2 rounded-2xl border border-border bg-card shadow-xl shadow-black/10 overflow-hidden animate-slide-up">
      <div className="px-3 py-1.5 border-b border-border/60 flex items-center gap-1.5">
        <Sparkles size={11} className="text-accent-brand" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{t("斜杠命令", "Slash Commands")}</span>
        <span className="ml-auto text-[10px] text-muted-foreground/60">{t("↑↓ 选择 · Enter 确认 · Esc 关闭", "↑↓ select · Enter confirm · Esc close")}</span>
      </div>
      <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
        {items.map(function (cmd, i) {
          var active = i === activeIndex;
          return (
            <button
              key={cmd.name}
              data-active={active}
              onMouseEnter={function () { onHover(i); }}
              onMouseDown={function (e) { e.preventDefault(); onPick(cmd); }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors group/slash",
                active ? "bg-accent/60" : "hover:bg-accent/30"
              )}
            >
              {/* 去掉独立图标：直接用命令名前的「/」作图标，并复刻原图标的 hover 强调色
                  ——选中(active)或鼠标悬停时「/」转为 accent-brand，其余为弱色。 */}
              <span className="font-mono text-xs shrink-0">
                <span className={cn("transition-colors", active ? "text-accent-brand" : "text-muted-foreground group-hover/slash:text-accent-brand")}>/</span>
                <span className="text-foreground">{cmd.name}</span>
              </span>
              {cmd.hint && <span className="font-mono text-[10px] text-muted-foreground/70 shrink-0">{lang === "en" ? (cmd.hintEn || cmd.hint) : cmd.hint}</span>}
              <span className="text-[11px] text-muted-foreground truncate flex-1 min-w-0 text-right">{lang === "en" ? (cmd.descriptionEn || cmd.description) : cmd.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
