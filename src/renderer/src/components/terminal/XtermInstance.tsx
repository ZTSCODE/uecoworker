import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Copy, ClipboardPaste, Send, TextSelect } from "lucide-react";
import { cn } from "../../lib/utils";
import { TERMINAL_THEMES } from "../../lib/terminal-themes";
import { useContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { useAppStore } from "../../stores/app-store";
import { tr } from "../../lib/i18n";
import "@xterm/xterm/css/xterm.css";

/**
 * 单个 xterm 实例：绑定到给定的 PTY 会话（sessionId）。负责建终端、装 fit/webgl
 * 插件、订阅 ptyOnData、把输入写回 ptyWrite、随容器尺寸 ptyResize，卸载时清理。
 *
 * 主视图 TerminalPane 与状态栏悬浮窗都渲染本组件并传同一个 sessionId —— 即同一个
 * PTY，双向同步（一边敲的字另一边也看得到）。同一会话被多个 xterm 同时订阅没问题：
 * 主进程对该 id 的每条数据广播给所有监听者，各 xterm 各自 write。
 */
export function XtermInstance({
  sessionId,
  themeIndex,
  className,
  onExit,
}: {
  sessionId: string;
  themeIndex: number;
  className?: string;
  onExit?: (code: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const { openMenu, ContextMenuEl } = useContextMenu();
  const requestChatInput = useAppStore((s) => s.requestChatInput);
  // requestChatInput 放 ref，供建终端的 effect（仅依赖 sessionId）读最新值而不进依赖。
  const requestChatInputRef = useRef(requestChatInput);
  requestChatInputRef.current = requestChatInput;
  // 主题变化时实时改色，但不重建终端，故用 ref 让 effect 读到最新值而不进依赖。
  const themeRef = useRef(themeIndex);
  themeRef.current = themeIndex;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // 切主题 → 应用到当前实例（不重建）。
  useEffect(() => {
    const theme = TERMINAL_THEMES[themeIndex];
    if (terminalRef.current && theme) terminalRef.current.options.theme = theme.colors;
    // 容器背景色跟随终端主题，消除 fit 间隙造成的黑边。
    if (containerRef.current && theme) containerRef.current.style.backgroundColor = theme.colors.background || '';
  }, [themeIndex]);

  // 建/拆终端：仅随 sessionId 变化重建。
  useEffect(() => {
    if (!containerRef.current || !sessionId) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
      theme: (TERMINAL_THEMES[themeRef.current] || TERMINAL_THEMES[0]).colors,
      allowProposedApi: true,
      allowTransparency: false,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    try {
      term.loadAddon(new WebglAddon());
    } catch {}

    term.open(containerRef.current);
    // 初始背景色同步，消除底部/边缘间隙黑边。
    const initTheme = TERMINAL_THEMES[themeRef.current] || TERMINAL_THEMES[0];
    if (containerRef.current) containerRef.current.style.backgroundColor = initTheme.colors.background || '';
    fitAddon.fit();

    const unsubData = window.api.ptyOnData(sessionId, (data: string) => {
      term.write(data);
    });
    const unsubExit = window.api.ptyOnExit(sessionId, (code: number) => {
      onExitRef.current?.(code);
    });

    term.onData((data) => {
      window.api.ptyWrite(sessionId, data);
    });

    // Ctrl+C 智能化：有选区时复制到剪贴板（拦截，不发 SIGINT）；无选区时放行给 pty
    // 当中断信号。Ctrl+V/Shift+Insert 粘贴。其余按键交回 xterm 默认处理。
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const sel = term.getSelection();
      if (e.ctrlKey && !e.shiftKey && (e.key === "c" || e.key === "C")) {
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {});
          return false; // 已复制，不要再把 ^C 发给 pty
        }
        return true; // 无选区：正常发 SIGINT
      }
      if (e.ctrlKey && !e.shiftKey && (e.key === "v" || e.key === "V")) {
        navigator.clipboard.readText().then((txt) => {
          if (txt) window.api.ptyWrite(sessionId, txt);
        }).catch(() => {});
        return false;
      }
      return true;
    });

    terminalRef.current = term;

    const resizeHandler = () => {
      try {
        fitAddon.fit();
        window.api.ptyResize(sessionId, term.cols, term.rows);
      } catch {}
    };
    const resizeObserver = new ResizeObserver(resizeHandler);
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      unsubData();
      unsubExit();
      term.dispose();
      terminalRef.current = null;
    };
  }, [sessionId]);

  // 右键菜单：复制选中 / 粘贴 / 发送选中给 Agent / 全选。基于当前 xterm 选区动态构建。
  const onContextMenu = (e: React.MouseEvent) => {
    const term = terminalRef.current;
    if (!term) return;
    const sel = term.getSelection();
    const items: ContextMenuItem[] = [];
    items.push({
      label: tr("复制", "Copy"),
      icon: <Copy size={13} />,
      disabled: !sel,
      onClick: () => { if (sel) navigator.clipboard.writeText(sel).catch(() => {}); },
    });
    items.push({
      label: tr("粘贴", "Paste"),
      icon: <ClipboardPaste size={13} />,
      onClick: () => {
        navigator.clipboard.readText().then((txt) => {
          if (txt) window.api.ptyWrite(sessionId, txt);
        }).catch(() => {});
      },
    });
    items.push({
      label: tr("发送选中给 Agent", "Send selection to Agent"),
      icon: <Send size={13} />,
      disabled: !sel,
      separatorBefore: true,
      onClick: () => { if (sel) requestChatInputRef.current(sel); },
    });
    items.push({
      label: tr("全选", "Select all"),
      icon: <TextSelect size={13} />,
      separatorBefore: true,
      onClick: () => { term.selectAll(); },
    });
    openMenu(e, items);
  };

  return (
    <>
      <div ref={containerRef} onContextMenu={onContextMenu} className={cn("overflow-hidden", className)} />
      {ContextMenuEl}
    </>
  );
}
