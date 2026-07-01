import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// 全局 tooltip：劫持所有原生 title，统一用项目 notetip 样式渲染（与 TodoRoadmap
// 详情框一致）。这样无需改动散落在各处的 title= 属性。
//
// 工作方式：
//  - 捕获阶段监听 mouseover，找到最近的带 [title] 的元素；
//  - 把元素的 title 临时移到 data-cw-tip，避免浏览器再弹系统默认提示
//    （mouseleave / 隐藏时还原回 title，保证无障碍与可复制语义不丢）；
//  - 悬停 320ms 后用 position:fixed 浮层显示，定位到元素下方居中，
//    并做视口边界翻转，避免被裁切或溢出。
//
// 故意不用 transform 做居中动画（沿用 animate-fade-opacity 思路）：用 left 直接
// 定位，淡入只动 opacity，避免出现瞬间左右跳动。

const ATTR = "data-cw-tip"; // 暂存被劫持的 title 文本
const DELAY = 320; // hover 多久才弹（ms）
const GAP = 6; // 浮层与目标元素的间距

interface TipState {
  text: string;
  x: number; // 目标元素水平中心（视口坐标）
  top: number; // 浮层顶边（视口坐标），below=true 时用
  bottom: number; // 目标元素顶边，翻转到上方时用
}

export function GlobalTooltip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const [above, setAbove] = useState(false); // 是否翻转到目标上方
  const timerRef = useRef<number | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const tipElRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function clearTimer() {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    // 还原某元素被劫持的 title，使其语义/无障碍不丢。
    function restore(el: HTMLElement | null) {
      if (el && el.hasAttribute(ATTR)) {
        el.setAttribute("title", el.getAttribute(ATTR) || "");
        el.removeAttribute(ATTR);
      }
    }

    function hide() {
      clearTimer();
      restore(targetRef.current);
      targetRef.current = null;
      setTip(null);
    }

    // 找到事件路径上最近的、带有效 title 的元素。
    function findTitled(start: EventTarget | null): HTMLElement | null {
      let el = start as HTMLElement | null;
      while (el && el !== document.body) {
        if (el.nodeType === 1) {
          const t = el.getAttribute && el.getAttribute("title");
          if (t && t.trim()) return el;
        }
        el = el.parentElement;
      }
      return null;
    }

    function onOver(e: MouseEvent) {
      const el = findTitled(e.target);
      if (!el) return;
      if (el === targetRef.current) return; // 还在同一目标上
      // 切换到新目标：先还原旧的、清掉旧计时。
      restore(targetRef.current);
      clearTimer();

      const text = (el.getAttribute("title") || "").trim();
      if (!text) return;
      // 立即劫持 title，阻止系统默认气泡（即便还没到 DELAY）。
      el.setAttribute(ATTR, text);
      el.removeAttribute("title");
      targetRef.current = el;

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        if (targetRef.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        setTip({
          text: text,
          x: r.left + r.width / 2,
          top: r.bottom + GAP,
          bottom: r.top - GAP,
        });
      }, DELAY);
    }

    function onOut(e: MouseEvent) {
      // 只有真正离开当前目标（移到其外部）才隐藏。
      const cur = targetRef.current;
      if (!cur) return;
      const to = e.relatedTarget as Node | null;
      if (to && cur.contains(to)) return;
      hide();
    }

    // 任何滚动/按下/失焦都立刻收起，避免浮层悬在错误位置。
    function onScrollOrDown() { hide(); }

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("mousedown", onScrollOrDown, true);
    window.addEventListener("scroll", onScrollOrDown, true);
    window.addEventListener("blur", onScrollOrDown);

    return () => {
      clearTimer();
      restore(targetRef.current);
      targetRef.current = null;
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("mousedown", onScrollOrDown, true);
      window.removeEventListener("scroll", onScrollOrDown, true);
      window.removeEventListener("blur", onScrollOrDown);
    };
  }, []);

  // 挂载后量浮层尺寸：超出视口底部就翻到上方；左右夹住不越界。
  useEffect(() => {
    setAbove(false);
    if (!tip) return;
    const el = tipElRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (tip.top + r.height > window.innerHeight - 4) setAbove(true);
  }, [tip]);

  if (!tip) return null;

  // 水平夹取：让浮层中心尽量在 tip.x，但整体不越出视口。
  const half = 140; // max-w 的一半（280/2），用于估边界
  const left = Math.min(Math.max(tip.x, half + 4), window.innerWidth - half - 4);

  return createPortal(
    <div
      ref={tipElRef}
      style={{
        left: left,
        top: above ? undefined : tip.top,
        bottom: above ? window.innerHeight - tip.bottom : undefined,
        transform: "translateX(-50%)",
      }}
      className="fixed z-[200] px-2.5 py-1.5 rounded-lg bg-popover border border-border shadow-lg text-[11px] leading-relaxed text-foreground whitespace-pre-line w-max max-w-[280px] pointer-events-none animate-fade-opacity">
      {tip.text}
    </div>,
    document.body
  );
}
