import { useState, useRef, useEffect } from "react";
import type { ComponentType, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Info, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

// 统一的设置/面板设计语言。目标:高级、简约,减弱线框感与半成品感。
// 要点:
//  - 用「柔和面」(soft surface) 代替到处的 border 方框 —— 半透明底 + 极细发丝边/无边。
//  - 大段说明文字不再常驻铺满页面,折叠进 <Hint>(问号气泡),需要时再看。
//  - 间距更舒展,标题层级清晰,圆角更大(rounded-xl)。

// ---- 页面外壳:标题 + 可选副标题 + 右侧操作区 ----
export function PageHeader({
  title, subtitle, actions, icon: Icon,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  icon?: ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-foreground tracking-tight flex items-center gap-2">
          {Icon && <Icon size={16} className="text-muted-foreground" />}
          {title}
        </h2>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-xl">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

// ---- 柔和面卡片:替代「border border-border bg-card」方框 ----
// 默认无边、轻微底色 + 悬浮微提亮;interactive 时加 hover。
export function SoftCard({
  children, className, interactive, padded = true, onClick,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  padded?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-xl bg-muted/40 ring-1 ring-border/40 transition-colors",
        padded && "p-4",
        interactive && "hover:bg-muted/70 hover:ring-border/70 cursor-pointer",
        className
      )}
    >
      {children}
    </div>
  );
}

// ---- 小节:大写发丝标题 + 内容,无外框,靠留白分组 ----
export function Section({
  title, action, children, className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2">
          {title && (
            <h3 className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-[0.08em]">{title}</h3>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// ---- 折叠信息气泡:把大段说明收进问号,hover/点击弹出,默认不占版面 ----
export function Hint({ children, className }: { children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) { setPos(null); return; }
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 320) });
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center justify-center w-4 h-4 rounded-full text-muted-foreground/60 hover:text-foreground hover:bg-muted transition-colors align-middle",
          className
        )}
      >
        <Info size={12} />
      </button>
      {open && pos && createPortal(
        <div
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-[200] w-[300px] rounded-xl bg-popover text-popover-foreground p-3 text-[11px] leading-relaxed shadow-xl ring-1 ring-border/60 animate-fade-in"
        >
          {children}
        </div>,
        document.body
      )}
    </>
  );
}

// ---- 设置行:左标题(+可选 hint)、右控件,柔和面包裹 ----
export function SettingRow({
  title, hint, control, children,
}: {
  title: string;
  hint?: ReactNode;
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <SoftCard className="flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-foreground flex items-center gap-1.5">
          {title}
          {hint && <Hint>{hint}</Hint>}
        </div>
        {children && <div className="mt-2">{children}</div>}
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </SoftCard>
  );
}

// ---- 分段控件(替代一排 border 按钮)。选中态=实心黑(bg-foreground)，全局统一。 ----
export function Segmented<T extends string>({
  value, onChange, options, className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ComponentType<{ size?: number }> }[];
  className?: string;
}) {
  return (
    <div className={cn("inline-flex gap-0.5 rounded-lg bg-muted/60 p-0.5", className)}>
      {options.map((opt) => {
        const active = value === opt.value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap",
              active
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {Icon && <Icon size={13} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- 页面级标签页(分区切换),统一替代各页 border-b-2 老式 tab。
// 选中态=实心黑药丸，与 Segmented 一致；字重恒为 medium，避免切换时宽度跳动。右侧可放操作(action)。 ----
export function Tabs<T extends string>({
  value, onChange, tabs, action, className,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { value: T; label: ReactNode; badge?: ReactNode }[];
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="inline-flex gap-0.5 rounded-lg bg-muted/60 p-0.5">
        {tabs.map((tb) => {
          const active = value === tb.value;
          return (
            <button
              key={tb.value}
              onClick={() => onChange(tb.value)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap",
                active ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {tb.label}
              {tb.badge}
            </button>
          );
        })}
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}

// ---- 折叠区(Disclosure):把大段说明/步骤/命令列表收起，默认收起，点击展开。
// 比 Hint 适合更长内容(列表、步骤)。 ----
export function Collapsible({
  title, children, defaultOpen, icon: Icon,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  icon?: ComponentType<{ size?: number; className?: string }>;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-xl bg-muted/30 ring-1 ring-border/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-muted/40 transition-colors"
      >
        {Icon && <Icon size={13} className="text-muted-foreground shrink-0" />}
        <span className="text-[12px] font-medium text-foreground/90 flex-1">{title}</span>
        <ChevronDown size={14} className={cn("text-muted-foreground/60 transition-transform shrink-0", open && "rotate-180")} />
      </button>
      {open && <div className="px-3.5 pb-3.5 pt-0.5 animate-fade-in">{children}</div>}
    </div>
  );
}

// ---- 主操作按钮(实心) ----
export function PrimaryButton({
  children, onClick, disabled, className, title, type,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type || "button"}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap",
        "bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-40",
        className
      )}
    >
      {children}
    </button>
  );
}

// ---- 次级按钮(柔和面,无硬边) ----
export function GhostButton({
  children, onClick, disabled, className, title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg whitespace-nowrap",
        "bg-muted/60 text-foreground/80 hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40",
        className
      )}
    >
      {children}
    </button>
  );
}

// ---- 统一输入框样式类 ----
export const INPUT_CLS =
  "w-full px-3 py-2 text-xs bg-muted/50 rounded-lg ring-1 ring-border/40 focus:ring-2 focus:ring-ring/40 focus:bg-muted/80 outline-none text-foreground placeholder:text-muted-foreground/60 transition-all";

export const INPUT_MONO_CLS = cn(INPUT_CLS, "font-mono");
