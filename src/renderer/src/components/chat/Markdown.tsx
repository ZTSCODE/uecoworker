import { useState, useEffect, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { ChevronRight, Info, TriangleAlert, Lightbulb, OctagonAlert, CircleCheck } from "lucide-react";
import { Mermaid } from "./Mermaid";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Check } from "lucide-react";
import { cn } from "../../lib/utils";
import { useAppStore } from "../../stores/app-store";
import { openFileInPreview } from "../../stores/artifact-store";
import { fileIconUrl, folderIconUrl } from "../../lib/file-icons";
import { useT } from "../../lib/i18n";

// 判断一段内联文本是否「像」项目文件路径：含路径分隔符，或带常见文件扩展名。
// 末尾允许 :行 或 :行-行（我们自己的 @path:start-end 约定 / 常见 file:line 提法）。
var FILE_EXT_RE = /\.(tsx?|jsx?|mjs|cjs|json|jsonc|md|mdx|css|scss|less|html?|vue|svelte|py|rb|go|rs|java|kt|c|cc|cpp|h|hpp|cs|php|swift|sh|bash|zsh|yml|yaml|toml|ini|env|xml|svg|sql|graphql|gql|prisma|dockerfile|lock|txt|csv)$/i;
function parsePathLike(raw: string): { path: string; line?: number; isDir: boolean } | null {
  var s = (raw || "").trim();
  if (!s || s.length > 240 || /\s/.test(s)) return null; // 路径不含空白
  // 去掉行号后缀 :12 或 :12-20。
  var line: number | undefined;
  var m = /^(.*?):(\d+)(?:-\d+)?$/.exec(s);
  if (m) { s = m[1]; line = Number(m[2]); }
  // 去掉前导 @（我们的引用语法）。
  s = s.replace(/^@/, "");
  if (!s) return null;
  // 末尾带分隔符 → 明确是目录。
  var trailingSlash = /[\\/]$/.test(s);
  var hasSep = s.indexOf("/") !== -1 || s.indexOf("\\") !== -1;
  var base = s.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  var hasExt = FILE_EXT_RE.test(base) || /^(dockerfile|makefile|\.[a-z]+)$/i.test(base);
  if (!hasSep && !hasExt) return null;
  // 判定文件 vs 目录：以分隔符结尾，或（含分隔符但末段无扩展名）→ 目录。
  var isDir = trailingSlash || (!hasExt);
  return { path: s.replace(/[\\/]+$/, ""), line: line, isDir: isDir };
}

function resolveAgainstProject(projectPath: string | null, fp: string): string {
  if (!fp) return fp;
  var isAbs = /^([a-zA-Z]:[\\/]|[\\/])/.test(fp);
  if (isAbs || !projectPath) return fp;
  return projectPath.replace(/[\\/]+$/, "") + "/" + fp.replace(/^[\\/]+/, "");
}

/**
 * Shared markdown renderer with syntax-highlighted fenced code blocks and a
 * per-block copy button. Used by chat bubbles and artifact previews so the
 * highlight config lives in one place. Inline `code` stays plain.
 */
function MarkdownBase({ children, className }: { children: string; className?: string }) {
  var t = useT();
  var projectPath = useAppStore(function(s) { return s.projectPath; });
  return (
    <div style={{ fontSize: "var(--chat-font-size)" }} className={cn(
      // Use `prose` (not prose-sm) so the base font-size comes from the inline
      // var above and the chat font-size setting actually scales AI messages.
      "prose dark:prose-invert max-w-none break-words",
      "prose-p:text-[1em] prose-li:text-[1em] prose-headings:text-foreground",
      // Let our CodeBlock own the code styling — strip prose's <pre> background,
      // padding and inline-code backtick quotes so nothing double-renders.
      "prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0",
      "prose-code:before:content-none prose-code:after:content-none",
      "prose-headings:font-semibold prose-p:leading-relaxed",
      className
    )}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // rehype-raw 让 AI 输出里的原生 HTML（尤其 <details>/<summary> 折叠块）生效。
        // react-markdown 用 React.createElement 构建节点，不会执行 <script>，
        // 事件属性（onerror 等）也会被 React 丢弃，对 AI 文本来说风险可控。
        rehypePlugins={[rehypeRaw]}
        components={{
          // 折叠块：玩家状态、区域背景这类「要看才点开」的内容放这里。
          // summary 不单独覆盖——让它以原生 "summary" 标签传进 Details，由 Details 拆出做标题。
          details: Details,
          code(props: any) {
            var { inline, className: cls, children: kids } = props;
            var match = /language-(\w+)/.exec(cls || "");
            var text = String(kids ?? "").replace(/\n$/, "");
            // Inline code, or a single-line snippet with no language → plain.
            if (inline || (!match && text.indexOf("\n") === -1)) {
              // 像项目文件/路径 → 可点击。文件：右侧预览；文件夹/路径：打开系统资源浏览器。
              // 前面带相应图标（文件→文件类型图标，路径→文件夹图标），黑字灰底块。
              var pl = parsePathLike(text);
              if (pl) {
                var abs = resolveAgainstProject(projectPath, pl.path);
                var base = pl.path.split(/[\\/]/).pop() || pl.path;
                var iconUrl = pl.isDir ? folderIconUrl(base, false) : fileIconUrl(base);
                var onClick = pl.isDir
                  ? function() { (window as any).api?.showInFolder?.(abs); }
                  : function() { openFileInPreview(abs); };
                return (
                  <code
                    onClick={onClick}
                    title={(pl.isDir ? t("在资源管理器中打开 ", "Open in File Explorer ") : t("预览 ", "Preview ")) + pl.path}
                    className="not-prose inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-foreground/90 text-[0.85em] font-mono align-baseline cursor-pointer hover:bg-muted/70 transition-colors">
                    <img src={iconUrl} alt="" draggable={false} className="w-3.5 h-3.5 shrink-0 inline-block" />
                    {kids}
                  </code>
                );
              }
              return (
                <code className="px-1 py-0.5 rounded bg-muted text-foreground/90 text-[0.85em] font-mono">
                  {kids}
                </code>
              );
            }
            var lang = match ? match[1] : "text";
            // ```mermaid → 渲染成图表（流式半截时组件内部会优雅回退）。
            if (lang === "mermaid") return <Mermaid code={text} />;
            return <CodeBlock language={lang} value={text} />;
          },
          // react-markdown wraps code in <pre>; we render our own container.
          pre(props: any) { return <>{props.children}</>; },
          // Links must open in the OS browser, never navigate the app window.
          a(props: any) {
            var href = props.href || "";
            return (
              <a href={href} onClick={function(e: any) {
                e.preventDefault();
                if (href) (window as any).api?.openExternal?.(href);
              }} className="text-accent-brand underline underline-offset-2 cursor-pointer">
                {props.children}
              </a>
            );
          },
          // GitHub 风格告警块：> [!NOTE] / [!TIP] / [!WARNING] / [!DANGER|CAUTION] / [!IMPORTANT]
          // 首行匹配标记 → 渲染成带图标的彩色提示框；否则退回普通引用块。
          blockquote(props: any) { return <Callout>{props.children}</Callout>; },
          // 图片：远程 URL / data URI 经主进程下载成 dataUrl 再显示（绕过渲染层 CSP，
          // 否则模型把生成图以远程 URL 写进正文时会"裂开"）。失败回落成可点链接。
          img(props: any) { return <MdImage src={props.src} alt={props.alt} />; },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

// memo 边界：markdown 解析 + Prism 高亮是重操作。只在 children（markdown 全文）或
// className 变化时重渲染 —— 流式时正在生成的那条消息每个 chunk content 都在变，字符串
// 不同 → 比较返回 false → 照常逐字重渲染（绝不会「不刷新」）；已固定的历史消息字符串
// 不变 → 跳过重复解析+高亮，切断「流式后半段重复高亮全部历史代码块」的卡顿链。
export const Markdown = memo(MarkdownBase, function(prev, next) {
  return prev.children === next.children && prev.className === next.className;
});

/**
 * 正文内联图片。远程 http(s) / data URI 经主进程 readChatImage 下载成 dataUrl 显示
 * （绕过渲染层 CSP）。加载中显示占位；失败回落成可点击链接，至少能打开原图。
 */
function MdImage({ src, alt }: { src?: string; alt?: string }) {
  var s = String(src || "");
  var [url, setUrl] = useState<string>(s.indexOf("data:image/") === 0 ? s : "");
  var [failed, setFailed] = useState(false);
  useEffect(function() {
    if (!s || s.indexOf("data:image/") === 0) return;   // data URI 已直接用
    var alive = true;
    var api = (window as any).api;
    if (!api || !api.readChatImage) { setFailed(true); return; }
    api.readChatImage(s).then(function(res: any) {
      if (!alive) return;
      if (res && res.ok && res.dataUrl) setUrl(res.dataUrl); else setFailed(true);
    }).catch(function() { if (alive) setFailed(true); });
    return function() { alive = false; };
  }, [s]);
  if (url) {
    return <img src={url} alt={alt || ""} className="rounded-lg max-w-full my-2" />;
  }
  if (failed) {
    return (
      <a href={s} onClick={function(e: any) { e.preventDefault(); if (s) (window as any).api?.openExternal?.(s); }}
        className="text-accent-brand underline underline-offset-2 cursor-pointer">
        {alt || s}
      </a>
    );
  }
  return <span className="text-muted-foreground/60 text-xs">加载图片…</span>;
}

/**
 * 折叠块。AI 在正文里用 <details><summary>标题</summary>…内容…</details>，
 * 默认收起，只露出 summary 标题；点击标题展开/收起。
 * 用于 RPG 玩家状态、区域背景这类「要看才点开」的辅助信息。
 * 带 open 属性则初始展开。
 */
function Details(props: any) {
  var t = useT();
  // react-markdown 把 open="" 等同 open；HTML 里出现该属性即视为初始展开。
  var [open, setOpen] = useState(props.open !== undefined && props.open !== false);
  // 从子节点里拆出 <summary> 作为标题，其余作为可折叠正文。
  // rehype-raw 下 summary 以原生标签传入（type === "summary"）；中间可能夹杂空白文本节点。
  var kids = ([] as any[]).concat(props.children);
  var summary: any = null;
  var body: any[] = [];
  for (var i = 0; i < kids.length; i++) {
    var ch = kids[i];
    if (!summary && ch && typeof ch === "object" && ch.type === "summary") summary = ch;
    else body.push(ch);
  }
  var title = summary ? summary.props.children : t("详情", "Details");
  return (
    <div className="not-prose my-2 rounded-lg border border-border overflow-hidden bg-muted/30">
      <button
        type="button"
        onClick={function() { setOpen(function(v) { return !v; }); }}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-left text-[0.9em] font-medium text-foreground/80 hover:bg-muted/60 transition-colors select-none">
        <ChevronRight
          size={14}
          className={cn("shrink-0 transition-transform", open && "rotate-90")} />
        <span className="min-w-0 break-words">{title}</span>
      </button>
      {open && (
        <div className="px-3 py-2 border-t border-border text-[0.95em] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          {body}
        </div>
      )}
    </div>
  );
}

// 告警块类型 → 标题 / 图标 / 配色（左边框 + 标题色 + 浅底）。label 在 Callout 内按语言翻译。
var CALLOUT_KINDS: Record<string, { label: string; Icon: any; cls: string; head: string }> = {
  NOTE:      { label: "NOTE",  Icon: Info,         cls: "border-l-blue-500 bg-blue-500/5",     head: "text-blue-500" },
  TIP:       { label: "TIP",  Icon: Lightbulb,    cls: "border-l-emerald-500 bg-emerald-500/5", head: "text-emerald-500" },
  IMPORTANT: { label: "IMPORTANT",  Icon: CircleCheck,  cls: "border-l-violet-500 bg-violet-500/5",  head: "text-violet-500" },
  WARNING:   { label: "WARNING",  Icon: TriangleAlert, cls: "border-l-amber-500 bg-amber-500/5",    head: "text-amber-500" },
  CAUTION:   { label: "CAUTION",  Icon: OctagonAlert, cls: "border-l-red-500 bg-red-500/5",        head: "text-red-500" },
};
var CALLOUT_ALIAS: Record<string, string> = { DANGER: "CAUTION", ERROR: "CAUTION", WARN: "WARNING", INFO: "NOTE" };

// 从 blockquote 第一段里找出首个文本节点，剥出开头的 [!TYPE] 标记。
// remark-gfm 不内置 callout，所以标记会作为普通文本留在第一段开头，需要我们手动解析。
function extractCallout(children: any): { kind: string | null; nodes: any[] } {
  var nodes = ([] as any[]).concat(children).filter(function(n) {
    // 去掉 react-markdown 在块之间塞的纯空白文本节点。
    return !(typeof n === "string" && n.trim() === "");
  });
  if (!nodes.length) return { kind: null, nodes: nodes };
  var first = nodes[0];
  // 首段通常是 <p>{children}</p>；标记藏在它的第一个子节点（字符串）里。
  if (first && typeof first === "object" && first.props) {
    var inner = ([] as any[]).concat(first.props.children);
    var head = inner[0];
    if (typeof head === "string") {
      var m = /^\s*\[!(\w+)\]\s*\n?/.exec(head);
      if (m) {
        var key = m[1].toUpperCase();
        var kind = CALLOUT_KINDS[key] ? key : (CALLOUT_ALIAS[key] || null);
        if (kind) {
          // 把标记从首段里删掉，其余内容（含可能的标题文字）保留。
          var rest = inner.slice();
          rest[0] = head.slice(m[0].length);
          if (rest[0] === "") rest = rest.slice(1);
          var FirstTag = first.type;
          var newFirst = rest.length ? <FirstTag key="cf" {...first.props} children={rest} /> : null;
          var tail = nodes.slice(1);
          return { kind: kind, nodes: (newFirst ? [newFirst] : []).concat(tail) };
        }
      }
    }
  }
  return { kind: null, nodes: nodes };
}

/**
 * GitHub 风格告警块。> [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]。
 * 命中标记 → 带图标的彩色提示框；没命中 → 普通引用块样式。
 * coding 里标注意/警告，RPG 里做系统提示 / 战斗警报都很自然。
 */
function Callout({ children }: { children: any }) {
  var t = useT();
  var parsed = extractCallout(children);
  if (!parsed.kind) {
    return (
      <blockquote className="border-l-2 border-border pl-3 my-2 text-foreground/75 italic [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        {children}
      </blockquote>
    );
  }
  var spec = CALLOUT_KINDS[parsed.kind];
  var Icon = spec.Icon;
  // 告警标题按语言显示（kind 为大写英文键）。
  var labelMap: Record<string, string> = {
    NOTE: t("说明", "Note"),
    TIP: t("提示", "Tip"),
    IMPORTANT: t("重要", "Important"),
    WARNING: t("警告", "Warning"),
    CAUTION: t("危险", "Caution"),
  };
  var label = labelMap[parsed.kind] || spec.label;
  return (
    <div className={cn("not-prose my-2 rounded-r-lg border-l-4 pl-3 pr-3 py-2", spec.cls)}>
      <div className={cn("flex items-center gap-1.5 font-semibold text-[0.9em] mb-1", spec.head)}>
        <Icon size={15} className="shrink-0" />
        <span>{label}</span>
      </div>
      <div className="text-[0.95em] text-foreground/90 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        {parsed.nodes}
      </div>
    </div>
  );
}

function CodeBlockBase({ language, value }: { language: string; value: string }) {
  var t = useT();
  var [copied, setCopied] = useState(false);
  var copy = async function() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(function() { setCopied(false); }, 2000); } catch (e) {}
  };
  // ```diff → 按行上红/绿底色，便于看增删。其余语言走 Prism 高亮。
  var isDiff = language === "diff";
  return (
    <div className="relative my-2 rounded-lg overflow-hidden border border-border group/code not-prose">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#21252b] border-b border-black/30">
        <span className="text-[10px] font-mono uppercase tracking-wider text-white/40">{language}</span>
        <button onClick={copy}
          className="flex items-center gap-1 text-[10px] text-white/50 hover:text-white transition-colors">
          {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
          <span>{copied ? t("已复制", "Copied") : t("复制", "Copy")}</span>
        </button>
      </div>
      {isDiff ? (
        <DiffBlock value={value} />
      ) : (
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          customStyle={{ margin: 0, borderRadius: 0, fontSize: "12.5px", padding: "12px", boxShadow: "none" }}
          codeTagProps={{ style: { fontFamily: '"JetBrains Mono", Consolas, monospace', textShadow: "none" } }}
          wrapLongLines
        >
          {value}
        </SyntaxHighlighter>
      )}
    </div>
  );
}

// memo 边界：Prism 语法高亮是 markdown 里最贵的一步。language/value 不变就跳过重渲染
// （copied 状态变化走内部 useState，不受 memo 影响）。流式时正在生成的代码块 value
// 在变 → 照常重渲染；前文已定型的代码块 value 不变 → 不再每 chunk 重新高亮。
export const CodeBlock = memo(CodeBlockBase, function(prev, next) {
  return prev.language === next.language && prev.value === next.value;
});
// 统一 diff 块：左右两栏并排对比（左=删除/旧，右=新增/新）。
// 导出给工具气泡复用（apply_diff 的 diff 字符串、multi_edit 的合成 diff）。
// 解析：连续的 - 行与 + 行成组按下标配对（左 i ↔ 右 i），多出的一侧另一侧留空；
// 上下文行两栏都显示；@@ / +++ / --- 作为整宽分隔头。
type DiffRow =
  | { kind: "hunk"; text: string }
  | { kind: "pair"; left: string | null; right: string | null };

function parseDiffRows(value: string): DiffRow[] {
  var lines = value.split("\n");
  var rows: DiffRow[] = [];
  var dels: string[] = [];
  var adds: string[] = [];
  function flush() {
    var n = Math.max(dels.length, adds.length);
    for (var i = 0; i < n; i++) {
      rows.push({ kind: "pair", left: i < dels.length ? dels[i] : null, right: i < adds.length ? adds[i] : null });
    }
    dels = []; adds = [];
  }
  for (var li = 0; li < lines.length; li++) {
    var ln = lines[li];
    var isFileHead = ln.indexOf("+++") === 0 || ln.indexOf("---") === 0;
    if (isFileHead || ln.indexOf("@@") === 0) {
      flush();
      rows.push({ kind: "hunk", text: ln });
    } else if (ln.charAt(0) === "-") {
      dels.push(ln.slice(1));
    } else if (ln.charAt(0) === "+") {
      adds.push(ln.slice(1));
    } else {
      flush();
      var ctx = ln.charAt(0) === " " ? ln.slice(1) : ln;
      rows.push({ kind: "pair", left: ctx, right: ctx });
    }
  }
  flush();
  return rows;
}

export function DiffBlock({ value }: { value: string }) {
  var rows = parseDiffRows(value);
  var cell = "px-2 whitespace-pre-wrap break-words min-w-0";
  return (
    <div className="bg-[#282c34] overflow-x-auto text-[12.5px] leading-[1.5]" style={{ fontFamily: '"JetBrains Mono", Consolas, monospace' }}>
      {rows.map(function(r, i) {
        if (r.kind === "hunk") {
          var isFile = r.text.indexOf("+++") === 0 || r.text.indexOf("---") === 0;
          return <div key={i} className={cn("px-2 whitespace-pre-wrap break-words", isFile ? "text-white/40" : "text-cyan-300/80 bg-cyan-500/5")}>{r.text || " "}</div>;
        }
        var isCtx = r.left === r.right;
        var leftCls = r.left == null ? "bg-white/[0.02]" : isCtx ? "text-white/55" : "text-red-200 bg-red-500/15";
        var rightCls = r.right == null ? "bg-white/[0.02]" : isCtx ? "text-white/55" : "text-emerald-200 bg-emerald-500/15";
        var sign = function(s: string | null, plus: boolean) {
          if (s == null || isCtx) return <span className="select-none opacity-30 mr-1.5"> </span>;
          return <span className="select-none opacity-50 mr-1.5">{plus ? "+" : "-"}</span>;
        };
        return (
          <div key={i} className="grid grid-cols-2 border-t border-white/[0.04] first:border-t-0">
            <div className={cn(cell, "border-r border-white/10", leftCls)}>{sign(r.left, false)}{r.left == null ? "" : (r.left || " ")}</div>
            <div className={cn(cell, rightCls)}>{sign(r.right, true)}{r.right == null ? "" : (r.right || " ")}</div>
          </div>
        );
      })}
    </div>
  );
}
