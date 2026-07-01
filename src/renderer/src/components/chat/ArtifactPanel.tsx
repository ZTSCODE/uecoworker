import { useState, useEffect, useRef, useCallback } from "react";
import { useArtifactStore, type Artifact } from "../../stores/artifact-store";
import { useAppStore } from "../../stores/app-store";
import { cn } from "../../lib/utils";
import { tr, useT } from "../../lib/i18n";
import {
  FileCode, FileText, Globe, Eye, Code, X, ChevronRight,
  Maximize2, Minimize2, ExternalLink, Copy, Check, TextSelect, Send, FolderSearch
} from "lucide-react";
import { Markdown } from "./Markdown";
import { CodeView } from "../editor/CodeView";
import { useContextMenu, type ContextMenuItem } from "../ui/ContextMenu";

// 相对项目根路径（用于 @引用）。
function toRelative(projectPath: string | null, fullPath: string): string {
  if (!projectPath || !fullPath) return fullPath;
  var r = projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
  var p = fullPath.replace(/\\/g, "/");
  if (p.indexOf(r + "/") === 0) return p.slice(r.length + 1);
  return p;
}

// 由选中文本在全文中的位置近似算出「起始行-结束行」（IDE 经典轻量引用）。
function lineRangeOf(content: string, selected: string): { start: number; end: number } | null {
  if (!selected) return null;
  var idx = content.indexOf(selected);
  if (idx === -1) return null;
  var before = content.slice(0, idx);
  var start = before.split("\n").length;          // 1-based
  var end = start + selected.split("\n").length - 1;
  return { start: start, end: end };
}

var RESIZE_CURSORS: Record<string, string> = {
  l: "ew-resize", r: "ew-resize", t: "ns-resize", b: "ns-resize",
  lt: "nw-resize", lb: "sw-resize", rt: "ne-resize", rb: "se-resize",
};

export function ArtifactPanel() {
  var t = useT();
  var { artifacts, activeArtifactId, setActive, removeArtifact, updateContent, togglePanel, showPanel } = useArtifactStore();
  var [viewMode, setViewMode] = useState<"preview" | "code">("preview");
  var [fullscreen, setFullscreen] = useState(false);
  var [editing, setEditing] = useState(false);
  var [draft, setDraft] = useState("");
  var panelRef = useRef<HTMLDivElement>(null);
  var draftRef = useRef("");
  var active = artifacts.find(function(a) { return a.id === activeArtifactId; });

  // 悬浮窗尺寸（可拖拽边缘调整）。
  var [pw, setPw] = useState(400);
  var [ph, setPh] = useState(500);
  // 悬浮窗位置（可拖拽标题栏移动）。null 表示使用默认位置（右侧居中）。
  var [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  var onDragStart = useCallback(function(e: React.MouseEvent) {
    // 忽略来自按钮/交互元素的事件，避免拖拽与点击冲突。
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    var rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    // 把宽高取成原始值，避免在闭包里引用 rect 时 TS 丢失收窄（DOMRect | undefined）。
    var rectWidth = rect.width;
    var rectHeight = rect.height;
    var offsetX = e.clientX - rect.left;
    var offsetY = e.clientY - rect.top;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "move";
    var onMove = function(ev: MouseEvent) {
      var newX = Math.max(0, Math.min(window.innerWidth - rectWidth, ev.clientX - offsetX));
      var newY = Math.max(0, Math.min(window.innerHeight - rectHeight, ev.clientY - offsetY));
      setPanelPos({ x: Math.round(newX), y: Math.round(newY) });
    };
    var onUp = function() {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);
  // 窗口缩放时，自动把面板修正回视口内，避免被隐藏。
  useEffect(function() {
    if (!panelPos) return;
    function onResize() {
      setPanelPos(function(pos) {
        if (!pos) return pos;
        var el = panelRef.current;
        var w = el ? el.offsetWidth : pw;
        var h = el ? el.offsetHeight : ph;
        var nx = Math.max(0, Math.min(window.innerWidth - w, pos.x));
        var ny = Math.max(0, Math.min(window.innerHeight - h, pos.y));
        if (nx === pos.x && ny === pos.y) return pos;
        return { x: nx, y: ny };
      });
    }
    window.addEventListener("resize", onResize);
    return function() { window.removeEventListener("resize", onResize); };
  }, [panelPos, pw, ph]);
  var onResizeStart = useCallback(function(edge: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    var startX = e.clientX;
    var startY = e.clientY;
    var rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    var startW = rect.width;
    var startH = rect.height;
    // 把面板固定到当前绝对位置（left/top），后续 resize 几何统一在 left/top 锚点系下
    // 计算——避免默认右锚定（right:12 + translateY）与左锚定混用导致方向算反。
    var startLeft = rect.left;
    var startTop = rect.top;
    setPanelPos({ x: Math.round(startLeft), y: Math.round(startTop) });
    var minW = 280, maxW = 800;
    var minH = 250, maxH = window.innerHeight - 80;
    document.body.style.userSelect = "none";
    document.body.style.cursor = RESIZE_CURSORS[edge] || "default";
    var onMove = function(ev: MouseEvent) {
      var dx = ev.clientX - startX;
      var dy = ev.clientY - startY;
      var newW = startW, newH = startH, newLeft = startLeft, newTop = startTop;
      // 左边：右边缘固定，向左拉宽（宽度增、左边随之左移）。
      if (edge.indexOf("l") !== -1) {
        newW = Math.max(minW, Math.min(maxW, startW - dx));
        newLeft = startLeft + (startW - newW);
      }
      // 右边：左边缘固定，向右拉宽。
      if (edge.indexOf("r") !== -1) {
        newW = Math.max(minW, Math.min(maxW, startW + dx));
      }
      // 上边：下边缘固定，向上拉高。
      if (edge.indexOf("t") !== -1) {
        newH = Math.max(minH, Math.min(maxH, startH - dy));
        newTop = startTop + (startH - newH);
      }
      // 下边：上边缘固定，向下拉高。
      if (edge.indexOf("b") !== -1) {
        newH = Math.max(minH, Math.min(maxH, startH + dy));
      }
      setPw(Math.round(newW));
      setPh(Math.round(newH));
      setPanelPos({ x: Math.round(newLeft), y: Math.round(newTop) });
    };
    var onUp = function() {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  // diff 视图与无真实磁盘路径的 artifact 不可编辑。
  var canEdit = !!active && active.language !== "diff" && !active.filePath.endsWith(" diff");

  // 把当前草稿写回 store 并落盘（仅在有改动时）。
  function commitDraft() {
    if (!active) return;
    var next = draftRef.current;
    if (next !== active.content) {
      updateContent(active.id, next);
      try { window.api.writeFile(active.filePath, next); } catch (e) {}
    }
  }

  function enterEdit() {
    if (!active || !canEdit) return;
    setDraft(active.content);
    draftRef.current = active.content;
    setViewMode("code");
    setEditing(true);
  }

  function onDraftChange(v: string) {
    draftRef.current = v;
    setDraft(v);
  }

  // 切换 artifact 时退出编辑态（避免把旧草稿写进新文件）。
  useEffect(function() { setEditing(false); }, [activeArtifactId]);

  // 点击预览面板以外的任意位置 → 保存并退出编辑（全屏时整屏即面板，用 ⌘S 保存）。
  useEffect(function() {
    if (!editing) return;
    function onDown(e: MouseEvent) {
      var el = panelRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        commitDraft();
        setEditing(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return function() { document.removeEventListener("mousedown", onDown); };
  }, [editing, active, updateContent]);

  if (!showPanel || artifacts.length === 0) return null;

  function selectTab(id: string) {
    if (editing) commitDraft();
    setActive(id); // activeArtifactId 变化的 effect 会清掉编辑态
  }
  function closeTab(id: string) {
    if (editing && id === activeArtifactId) commitDraft();
    removeArtifact(id);
  }
  function toggleView() {
    if (editing) { commitDraft(); setEditing(false); }
    setViewMode(viewMode === "preview" ? "code" : "preview");
  }
  function onPanelKeyDown(e: React.KeyboardEvent) {
    if (editing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      commitDraft();
    }
  }

  var editProps = { editing: editing, draft: draft, canEdit: canEdit, onEnterEdit: enterEdit, onDraftChange: onDraftChange };

  // 非全屏时的定位样式：如果有拖拽位置则用 left/top，否则用默认右侧居中。
  var panelStyle = fullscreen ? undefined : {
    width: pw, height: ph,
    ...(panelPos
      ? { left: panelPos.x, top: panelPos.y }
      : { right: 12, top: "50%", transform: "translateY(-50%)" }),
  };

  return (
    <div ref={panelRef} onKeyDown={onPanelKeyDown} className={cn(
      "flex flex-col animate-slide-in-right overflow-hidden titlebar-no-drag",
      fullscreen
        ? "fixed inset-0 z-50 bg-card"
        : "fixed z-50 bg-card border border-border rounded-2xl shadow-xl shadow-black/15"
    )} style={panelStyle}>
      {/* 拖拽调整大小手柄（非全屏时） */}
      {!fullscreen && (
        <>
          <div className="absolute left-0 top-3 bottom-3 w-1.5 cursor-ew-resize z-10" onMouseDown={function(e) { onResizeStart("l", e); }}>
            <div className="h-full w-full rounded-full opacity-0 hover:opacity-100 bg-accent-brand/30 transition-opacity" />
          </div>
          <div className="absolute right-0 top-3 bottom-3 w-1.5 cursor-ew-resize z-10" onMouseDown={function(e) { onResizeStart("r", e); }}>
            <div className="h-full w-full rounded-full opacity-0 hover:opacity-100 bg-accent-brand/30 transition-opacity" />
          </div>
          <div className="absolute top-0 left-3 right-3 h-1.5 cursor-ns-resize z-10" onMouseDown={function(e) { onResizeStart("t", e); }}>
            <div className="w-full h-full rounded-full opacity-0 hover:opacity-100 bg-accent-brand/30 transition-opacity" />
          </div>
          <div className="absolute bottom-0 left-3 right-3 h-1.5 cursor-ns-resize z-10" onMouseDown={function(e) { onResizeStart("b", e); }}>
            <div className="w-full h-full rounded-full opacity-0 hover:opacity-100 bg-accent-brand/30 transition-opacity" />
          </div>
          <div className="absolute left-0 top-0 w-3 h-3 cursor-nw-resize z-10" onMouseDown={function(e) { onResizeStart("lt", e); }} />
          <div className="absolute right-0 top-0 w-3 h-3 cursor-ne-resize z-10" onMouseDown={function(e) { onResizeStart("rt", e); }} />
          <div className="absolute left-0 bottom-0 w-3 h-3 cursor-sw-resize z-10" onMouseDown={function(e) { onResizeStart("lb", e); }} />
          <div className="absolute right-0 bottom-0 w-3 h-3 cursor-se-resize z-10" onMouseDown={function(e) { onResizeStart("rb", e); }} />
        </>
      )}
      {/* Header：标签滚动区 + 右侧固定操作区（按钮不再被标签挤走） */}
      <div className="flex items-stretch border-b border-border/50 bg-card/80 rounded-t-2xl cursor-move" onMouseDown={fullscreen ? undefined : onDragStart}>
        <div className="flex items-stretch overflow-x-auto cw-no-scrollbar flex-1 min-w-0">
          {artifacts.map(function(art) {
            var isActive = art.id === activeArtifactId;
            return (
              <div
                key={art.id}
                onClick={function() { selectTab(art.id); }}
                role="button"
                title={art.fileName}
                className={cn(
                  "group/tab flex items-center gap-1.5 pl-3 pr-2 py-2 text-xs border-r border-border transition-colors whitespace-nowrap cursor-pointer max-w-[180px]",
                  isActive ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )}>
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  art.action === "created" ? "bg-green-500" : "bg-yellow-500"
                )} />
                <span className="font-mono text-[11px] truncate">{art.fileName}</span>
                <button
                  onClick={function(e) { e.stopPropagation(); closeTab(art.id); }}
                  className={cn(
                    "ml-0.5 w-4 h-4 flex items-center justify-center rounded shrink-0 hover:bg-destructive/20 hover:text-destructive transition-opacity",
                    isActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover/tab:opacity-100"
                  )}
                  title={t("关闭此预览", "Close this preview")}>
                  <X size={11} />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-0.5 px-1.5 shrink-0 border-l border-border bg-card">
          <button onClick={toggleView}
            className={cn("p-1.5 rounded hover:bg-accent transition-colors",
              viewMode === "code" ? "text-foreground bg-accent/60" : "text-muted-foreground hover:text-foreground")}
            title={viewMode === "preview" ? t("查看代码", "View code") : t("预览", "Preview")}>
            {viewMode === "preview" ? <Code size={13} /> : <Eye size={13} />}
          </button>
          <button onClick={function() { setFullscreen(!fullscreen); }}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title={fullscreen ? t("退出全屏", "Exit fullscreen") : t("全屏", "Fullscreen")}>
            {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button onClick={function() { if (editing) { commitDraft(); setEditing(false); } togglePanel(); }}
            className="p-1.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title={t("关闭面板", "Close panel")}>
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {active ? (
          <div className="h-full flex flex-col">
            {/* File info bar */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-muted/80 text-[10px] text-muted-foreground">
              <span className="uppercase tracking-wider font-medium">{active.language}</span>
              <span className="text-border">|</span>
              <span className="font-mono truncate">{active.filePath}</span>
              <span className="flex-1" />
              {editing ? (
                <span className="flex items-center gap-1 text-accent-brand font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-brand animate-pulse" />
                  {t("编辑中 · 点击外部或 ⌘S 保存", "Editing · click outside or ⌘S to save")}
                </span>
              ) : (
                <span className={active.action === "created" ? "text-green-500" : "text-yellow-500"}>
                  {active.action}
                </span>
              )}
            </div>

            {/* Preview / Code */}
            <div className="flex-1 overflow-y-auto">
              {viewMode === "preview" ? (
                <ArtifactPreview artifact={active} edit={editProps} />
              ) : (
                <ArtifactCode artifact={active} edit={editProps} />
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            Select a file to preview
          </div>
        )}
      </div>
    </div>
  );
}

interface EditProps {
  editing: boolean;
  draft: string;
  canEdit: boolean;
  onEnterEdit: () => void;
  onDraftChange: (v: string) => void;
}

function ArtifactPreview({ artifact, edit }: { artifact: Artifact; edit: EditProps }) {
  var iframeRef = useRef<HTMLIFrameElement>(null);

  // HTML preview
  if (artifact.language === "html") {
    // iframe 是独立文档，不继承父页面 CSS。注入统一的滚动条样式。
    var scrollbarCSS = "<style>::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:rgba(128,128,128,.3);border-radius:3px}::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,.5)}</style>";
    var injectedContent = artifact.content.replace(/(<head[^>]*>)/i, "$1" + scrollbarCSS);
    // 如果 HTML 没有 <head> 标签，直接在最前面插入
    if (injectedContent === artifact.content) injectedContent = scrollbarCSS + artifact.content;
    return (
      <div className="h-full flex flex-col">
        <iframe
          ref={iframeRef}
          srcDoc={injectedContent}
          className="flex-1 w-full border-0 bg-white"
          sandbox="allow-scripts"
          title={artifact.fileName}
        />
      </div>
    );
  }

  // Markdown preview
  if (artifact.language === "markdown") {
    return (
      <div className="p-4">
        <Markdown>{artifact.content}</Markdown>
      </div>
    );
  }

  // SVG preview
  if (artifact.language === "xml" && artifact.fileName.endsWith(".svg")) {
    return (
      <div className="h-full flex items-center justify-center p-4 bg-white">
        <div dangerouslySetInnerHTML={{ __html: artifact.content }}
          className="max-w-full max-h-full" />
      </div>
    );
  }

  // Image preview（png/jpg/gif/webp 等二进制图片）
  if (artifact.language === "image") {
    return <ImagePreview filePath={artifact.filePath} fileName={artifact.fileName} />;
  }

  // Default: code preview with syntax coloring (双击可进入编辑)
  return <ArtifactCode artifact={artifact} edit={edit} />;
}

/** 图片预览组件：从主进程读 dataUrl，棋盘格背景（透明图可见），居中缩放显示。 */
function ImagePreview({ filePath, fileName }: { filePath: string; fileName: string }) {
  var [dataUrl, setDataUrl] = useState<string | null>(null);
  var [error, setError] = useState<string | null>(null);
  var [zoom, setZoom] = useState(1);

  useEffect(function() {
    setDataUrl(null);
    setError(null);
    setZoom(1);
    if (!filePath) return;
    (window as any).api?.readChatImage?.(filePath).then(function(res: any) {
      if (res && res.ok && res.dataUrl) {
        setDataUrl(res.dataUrl);
      } else {
        setError(res?.error || tr("无法读取图片", "Unable to read image"));
      }
    }).catch(function() { setError(tr("读取失败", "Read failed")); });
  }, [filePath]);

  var onWheel = useCallback(function(e: React.WheelEvent) {
    e.preventDefault();
    setZoom(function(z) { return Math.max(0.1, Math.min(10, z + (e.deltaY > 0 ? -0.1 : 0.1))); });
  }, []);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
        {tr("加载中…", "Loading…")}
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-auto flex items-center justify-center p-4"
      style={{ background: "repeating-conic-gradient(var(--color-muted) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px" }}
      onWheel={onWheel}
    >
      <img
        src={dataUrl}
        alt={fileName}
        draggable={false}
        className="max-w-full max-h-full object-contain select-none"
        style={{ transform: "scale(" + zoom + ")", transformOrigin: "center", transition: "transform 0.1s ease-out" }}
      />
    </div>
  );
}

function ArtifactCode({ artifact, edit }: { artifact: Artifact; edit: EditProps }) {
  var projectPath = useAppStore(function(s) { return s.projectPath; });
  var requestChatInput = useAppStore(function(s) { return s.requestChatInput; });
  var codeMenu = useContextMenu();

  var rel = toRelative(projectPath, artifact.filePath);

  var onMenu = function(e: React.MouseEvent) {
    var container = e.currentTarget as HTMLElement;
    var sel = (window.getSelection && window.getSelection()?.toString()) || "";
    sel = sel.trim();
    var items: ContextMenuItem[] = [];
    if (sel) {
      var range = lineRangeOf(artifact.content, sel);
      var ref = range ? "@" + rel + ":" + range.start + "-" + range.end : "@" + rel;
      items.push({ label: tr("复制选中", "Copy selection"), icon: <Copy size={13} />, onClick: function() { try { navigator.clipboard.writeText(sel); } catch (err) {} } });
      items.push({ label: tr("发送选中给 Agent", "Send selection to Agent") + (range ? tr("（" + range.start + "-" + range.end + " 行）", " (lines " + range.start + "-" + range.end + ")") : ""), icon: <Send size={13} />, onClick: function() { requestChatInput(ref); } });
    } else {
      items.push({ label: tr("全选", "Select all"), icon: <TextSelect size={13} />, onClick: function() { selectAllIn(container); } });
      items.push({ label: tr("复制全部", "Copy all"), icon: <Copy size={13} />, onClick: function() { try { navigator.clipboard.writeText(artifact.content); } catch (err) {} } });
    }
    items.push({ label: tr("发送整个文件给 Agent", "Send entire file to Agent"), icon: <Send size={13} />, separatorBefore: true, onClick: function() { requestChatInput("@" + rel); } });
    items.push({ label: tr("在资源管理器中查看", "Reveal in file explorer"), icon: <FolderSearch size={13} />, onClick: function() { window.api.showInFolder(artifact.filePath); } });
    codeMenu.openMenu(e, items);
  };

  // CodeMirror is virtualized → large files stay smooth (unlike the old
  // react-syntax-highlighter path that rendered every token as a DOM node).
  // 非编辑态下双击代码 → 进入编辑（相当于轻量 editor）。
  return (
    <div className="h-full"
      onContextMenu={onMenu}
      onDoubleClick={!edit.editing && edit.canEdit ? edit.onEnterEdit : undefined}
      title={!edit.editing && edit.canEdit ? tr("双击编辑", "Double-click to edit") : undefined}>
      <CodeView
        value={edit.editing ? edit.draft : artifact.content}
        language={artifact.language || "text"}
        editable={edit.editing}
        onChange={edit.editing ? edit.onDraftChange : undefined}
      />
      {codeMenu.ContextMenuEl}
    </div>
  );
}

// 选中容器内全部文本（无选区时的「全选」）。
function selectAllIn(el: HTMLElement) {
  var sel = window.getSelection();
  if (!sel) return;
  var range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}
