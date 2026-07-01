import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import mermaid from "mermaid";
import { Maximize2, X } from "lucide-react";
import { useAppStore } from "../../stores/app-store";
import { useT } from "../../lib/i18n";

// 全局自增 id，避免 React 严格模式重复渲染时 mermaid 临时节点 id 撞车。
var renderSeq = 0;

// 模块级渲染缓存：键 = 主题 + 图表源码，值 = 已渲染的 SVG 字符串。
// 关键作用：组件因父级重渲染（如右键弹菜单）而重新挂载时，能【同步】拿到上次的 SVG，
// 初始即有图、完全不闪代码；流式过程中相同源码也复用，不重复渲染。
var svgCache = new Map<string, string>();
function cacheKey(theme: string, code: string): string { return theme + "\n" + code; }

/**
 * Mermaid 图表块。拦截 ```mermaid 代码块，渲染成 SVG。
 * - 跟随应用主题切换 dark/default 配色。
 * - securityLevel:"strict" → mermaid 会清洗标签文本，防 SVG 注入。
 * - 流式输出阶段图表往往是半截的，parse 会抛错；此时【保留上一次成功渲染的图】，
 *   不回退成代码、也不清空，避免「代码 ↔ 图表」反复闪动。只有从未成功渲染过时，
 *   才显示「正在绘制图表…」+ 原始代码占位。
 * - 渲染异步完成，对 code 变化做短去抖（debounce），流式逐字符更新不会每帧都重绘。
 * - 点击图表可放大查看（lightbox，内部可滚动平移），解决内容多看不清的问题。
 */
export function Mermaid({ code }: { code: string }) {
  var t = useT();
  var theme = useAppStore(function(s) { return s.theme; });
  // 初始即尝试命中缓存：父级重渲染导致的重新挂载能同步拿到上次 SVG，杜绝「闪回代码」。
  var cachedInit = svgCache.get(cacheKey(theme, code)) || "";
  var [svg, setSvg] = useState(cachedInit);
  // 是否「至少成功渲染过一次」（命中缓存也算）。一旦为 true，后续 parse 失败也保留上一张图。
  var [hasRendered, setHasRendered] = useState(!!cachedInit);
  var [zoom, setZoom] = useState(false);

  useEffect(function() {
    var cancelled = false;
    // 命中缓存：直接用，无需重渲染，也不闪。
    var hit = svgCache.get(cacheKey(theme, code));
    if (hit) { setSvg(hit); setHasRendered(true); return function() {}; }
    // 短去抖：流式逐字符更新时，等输入稳定 120ms 再尝试渲染，避免每个 chunk 都重绘。
    var timer = setTimeout(function() {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: theme === "dark" ? "dark" : "default",
        fontFamily: "inherit",
      });
      var id = "mmd-" + (++renderSeq);
      (async function() {
        try {
          // 先校验；半截 / 非法图表会抛错，进入 catch。
          await mermaid.parse(code);
          var out = await mermaid.render(id, code);
          if (!cancelled) {
            svgCache.set(cacheKey(theme, code), out.svg);
            setSvg(out.svg); setHasRendered(true);
          }
        } catch (e) {
          // 渲染失败：保留上一张成功的图（hasRendered=true 时不动 svg），
          // 不回退代码、不闪动。仅当从未渲染成功时，由下方占位分支显示代码。
        }
      })();
    }, 120);
    return function() { cancelled = true; clearTimeout(timer); };
  }, [code, theme]);

  // 还没有任何成功渲染过 → 占位（流式刚开始的半截图表会停在这里，直到第一次成功）。
  if (!hasRendered || !svg) {
    return (
      <div className="not-prose my-2 rounded-lg border border-border bg-muted/30 overflow-hidden">
        <div className="px-3 py-1.5 text-[11px] text-foreground/50 border-b border-border">{t("正在绘制图表…", "Rendering diagram…")}</div>
        <pre className="m-0 px-3 py-2 text-[12px] font-mono text-foreground/60 whitespace-pre-wrap break-words">{code}</pre>
      </div>
    );
  }

  return (
    <>
      <InlineDiagram svg={svg} onZoom={function() { setZoom(true); }} />
      {zoom && <MermaidLightbox svg={svg} onClose={function() { setZoom(false); }} />}
    </>
  );
}

/**
 * 聊天界面里内联的图表：鼠标在图内滚轮=缩放图表（以光标为中心），图外滚轮=聊天正常滚动。
 * - 缩放：滚轮（0.4x~6x）。缩放后可按住拖拽平移。双击复位。
 * - 用原生非被动 wheel 监听 + preventDefault，保证图内滚轮不会冒泡去滚动聊天列表。
 * - 容器固定视口（max-h）+ overflow-hidden，缩放只在框内变化，绝不撑高消息、不产生第二滚动条。
 */
function InlineDiagram({ svg, onZoom }: { svg: string; onZoom: () => void }) {
  var t = useT();
  var [scale, setScale] = useState(1);
  var [tx, setTx] = useState(0);
  var [ty, setTy] = useState(0);
  var [dragging, setDragging] = useState(false);
  var boxRef = useRef<HTMLDivElement>(null);
  var drag = useRef<{ on: boolean; sx: number; sy: number; ox: number; oy: number }>({ on: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  // 用 ref 镜像当前 transform，供原生 wheel 回调读取最新值（回调只绑定一次）。
  var view = useRef({ scale: 1, tx: 0, ty: 0 });
  view.current = { scale: scale, tx: tx, ty: ty };

  // 原生非被动 wheel：图内缩放并阻止默认（不滚动聊天）；以光标为锚点。
  useEffect(function() {
    var el = boxRef.current;
    if (!el) return function() {};
    var node = el; // 非空局部，供闭包安全引用（TS 不在嵌套闭包里收窄 ref 变量）。
    var onWheel = function(e: WheelEvent) {
      e.preventDefault();
      e.stopPropagation();
      var rect = node.getBoundingClientRect();
      var cx = e.clientX - rect.left;
      var cy = e.clientY - rect.top;
      var v = view.current;
      var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      var next = Math.min(6, Math.max(0.4, v.scale * factor));
      var applied = next / v.scale;
      setTx(cx - (cx - v.tx) * applied);
      setTy(cy - (cy - v.ty) * applied);
      setScale(next);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return function() { node.removeEventListener("wheel", onWheel); };
  }, []);

  function reset() { setScale(1); setTx(0); setTy(0); }
  function onPointerDown(e: any) {
    var v = view.current;
    // 只要已偏离原始状态（缩放过或平移过）就允许拖拽——无论是放大还是缩小。
    // 原来只判 scale>1，导致向下滚（缩小到 ≤1）后无法拖动。
    if (v.scale === 1 && v.tx === 0 && v.ty === 0) return; // 原始状态不拦截，方便选中/正常交互
    drag.current = { on: true, sx: e.clientX, sy: e.clientY, ox: v.tx, oy: v.ty };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: any) {
    if (!drag.current.on) return;
    setTx(drag.current.ox + (e.clientX - drag.current.sx));
    setTy(drag.current.oy + (e.clientY - drag.current.sy));
  }
  function onPointerUp() { drag.current.on = false; setDragging(false); }

  var zoomed = scale !== 1 || tx !== 0 || ty !== 0;
  return (
    <div className="not-prose group relative my-2 rounded-lg border border-border bg-muted/20 overflow-hidden">
      <div
        ref={boxRef}
        onDoubleClick={reset}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="max-h-[420px] overflow-hidden"
        style={{ cursor: dragging ? "grabbing" : (zoomed ? "grab" : "default") }}
        title={t("滚轮缩放 · 拖拽平移 · 双击复位", "Scroll to zoom · drag to pan · double-click to reset")}
      >
        <div
          style={{ transform: "translate(" + tx + "px," + ty + "px) scale(" + scale + ")", transformOrigin: "0 0" }}
          className="flex justify-center p-3 [&_svg]:max-w-full [&_svg]:h-auto select-none"
          // mermaid 在 strict 模式下已清洗输出；此处注入的是受信的 SVG 字符串。
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      {/* 缩放后显示百分比 + 复位（仅在已缩放时出现，平时不打扰）。 */}
      {zoomed && (
        <button onClick={reset}
          title={t("复位", "Reset")}
          className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-md bg-background/70 backdrop-blur border border-border text-[10px] tabular-nums text-foreground/70 hover:text-foreground transition-colors">
          {Math.round(scale * 100)}% · {t("复位", "Reset")}
        </button>
      )}
      {/* 放大按钮：hover 时浮现，进入全屏 lightbox。 */}
      <button
        onClick={onZoom}
        title={t("全屏查看", "View Fullscreen")}
        className="absolute top-1.5 right-1.5 w-7 h-7 flex items-center justify-center rounded-md bg-background/70 backdrop-blur border border-border text-foreground/70 opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground hover:bg-background/90"
      >
        <Maximize2 size={14} />
      </button>
    </div>
  );
}

/**
 * 图表放大查看：全屏遮罩 + 居中大图。
 * - 滚轮：以鼠标位置为中心缩放（放大/缩小）。
 * - 拖拽：平移图表。
 * - 双击：复位缩放与位置。点击遮罩空白 / Esc / 关闭按钮退出。
 */
function MermaidLightbox({ svg, onClose }: { svg: string; onClose: () => void }) {
  var t = useT();
  // scale=缩放倍数；tx/ty=平移量（像素，transform-origin 取左上角 0 0）。
  var [scale, setScale] = useState(1);
  var [tx, setTx] = useState(0);
  var [ty, setTy] = useState(0);
  var drag = useRef<{ on: boolean; sx: number; sy: number; ox: number; oy: number }>({ on: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  var [dragging, setDragging] = useState(false);

  useEffect(function() {
    var onKey = function(e: KeyboardEvent) { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return function() { window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  function reset() { setScale(1); setTx(0); setTy(0); }

  // 滚轮缩放：以光标所在点为锚（缩放前后该点在屏幕上的位置不变）。
  // transform-origin = 0 0 时：tx' = cx - (cx - tx) * factor。
  function onWheel(e: any) {
    e.preventDefault();
    var rect = e.currentTarget.getBoundingClientRect();
    var cx = e.clientX - rect.left;
    var cy = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    var next = Math.min(8, Math.max(0.2, scale * factor));
    var applied = next / scale; // 实际生效的比例（受 min/max 夹取影响）
    setTx(cx - (cx - tx) * applied);
    setTy(cy - (cy - ty) * applied);
    setScale(next);
  }

  function onPointerDown(e: any) {
    drag.current = { on: true, sx: e.clientX, sy: e.clientY, ox: tx, oy: ty };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: any) {
    if (!drag.current.on) return;
    setTx(drag.current.ox + (e.clientX - drag.current.sx));
    setTy(drag.current.oy + (e.clientY - drag.current.sy));
  }
  function onPointerUp() { drag.current.on = false; setDragging(false); }

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] bg-black/80 animate-fade-in"
    >
      {/* 交互层：占满遮罩，捕获滚轮/拖拽。点击空白处（未拖动）冒泡到外层关闭。 */}
      <div
        onClick={function(e: any) { e.stopPropagation(); }}
        onWheel={onWheel}
        onDoubleClick={reset}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="absolute inset-0 overflow-hidden flex items-center justify-center"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
      >
        <div
          style={{ transform: "translate(" + tx + "px," + ty + "px) scale(" + scale + ")", transformOrigin: "0 0" }}
          className="[&_svg]:h-auto [&_svg]:max-w-none select-none"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      {/* 工具条：缩放比例 + 复位。 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 backdrop-blur text-white text-xs" onClick={function(e: any) { e.stopPropagation(); }}>
        <span className="tabular-nums">{Math.round(scale * 100)}%</span>
        <button onClick={reset} className="px-2 py-0.5 rounded hover:bg-white/15 transition-colors">{t("复位", "Reset")}</button>
        <span className="text-white/50">{t("滚轮缩放 · 拖拽平移 · 双击复位", "Scroll to zoom · drag to pan · double-click to reset")}</span>
      </div>
      <button
        onClick={function(e: any) { e.stopPropagation(); onClose(); }}
        title={t("关闭 (Esc)", "Close (Esc)")}
        className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
      >
        <X size={18} />
      </button>
    </div>,
    document.body
  );
}
