import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

// 通用右键菜单：按对象传入不同 items 即可。视觉沿用项目现有 popover/卡片风格。
// 用 portal 挂到 body，position:fixed 定位到光标处并做视口边界翻转——这样不会
// 被任何祖先容器的 overflow 裁掉（同 TodoRoadmap tooltip 思路）。

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export function ContextMenu({ open, x, y, items, onClose }: {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  var ref = useRef<HTMLDivElement | null>(null);
  // 实际渲染坐标（翻转后）。先按光标定位，挂载后量尺寸再修正越界。
  var [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  useLayoutEffect(function() {
    if (!open) return;
    var el = ref.current;
    if (!el) return;
    var rect = el.getBoundingClientRect();
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var left = x;
    var top = y;
    if (x + rect.width > vw - 4) left = Math.max(4, x - rect.width);
    if (y + rect.height > vh - 4) top = Math.max(4, y - rect.height);
    setPos({ left: left, top: top });
  }, [open, x, y, items.length]);

  useEffect(function() {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && ref.current.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    function onScrollOrResize() { onClose(); }
    // mousedown 捕获阶段：点菜单外/再次右键别处都关闭。
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("contextmenu", onDoc, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return function() {
      document.removeEventListener("mousedown", onDoc, true);
      document.removeEventListener("contextmenu", onDoc, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      className="fixed z-[100] min-w-[180px] max-w-[280px] py-1 rounded-xl border border-border bg-popover shadow-xl shadow-black/20 animate-fade-in"
      onContextMenu={function(e) { e.preventDefault(); }}>
      {items.map(function(it, i) {
        return (
          <div key={i}>
            {it.separatorBefore && <div className="my-1 h-px bg-border/60" />}
            <button
              disabled={it.disabled}
              onClick={function() {
                if (it.disabled) return;
                onClose();
                if (it.onClick) it.onClick();
              }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-1.5 text-[12px] text-left transition-colors",
                it.disabled
                  ? "text-muted-foreground/40 cursor-not-allowed"
                  : it.danger
                    ? "text-destructive hover:bg-destructive/10"
                    : "text-foreground/80 hover:bg-accent/60 hover:text-foreground"
              )}>
              {it.icon && <span className="shrink-0 w-3.5 flex items-center justify-center">{it.icon}</span>}
              <span className="flex-1 truncate">{it.label}</span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body
  );
}

// hook：封装开合 + 坐标 state，调用点只需 onContextMenu={e => openMenu(e, items)}。
export function useContextMenu() {
  var [state, setState] = useState<{ open: boolean; x: number; y: number; items: ContextMenuItem[] }>({
    open: false, x: 0, y: 0, items: [],
  });

  var openMenu = function(e: React.MouseEvent, items: ContextMenuItem[]) {
    e.preventDefault();
    e.stopPropagation();
    setState({ open: true, x: e.clientX, y: e.clientY, items: items });
  };
  var closeMenu = function() { setState(function(s) { return { ...s, open: false }; }); };

  var ContextMenuEl = (
    <ContextMenu open={state.open} x={state.x} y={state.y} items={state.items} onClose={closeMenu} />
  );

  return { openMenu: openMenu, closeMenu: closeMenu, ContextMenuEl: ContextMenuEl };
}
