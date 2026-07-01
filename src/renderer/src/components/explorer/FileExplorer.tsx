import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../../stores/app-store";
import { cn } from "../../lib/utils";
import {
  ChevronRight, ChevronDown,
  RefreshCw, Eye, FolderSearch, Copy, Pencil, Trash2, Send,
  FilePlus, FolderPlus, Search, X
} from "lucide-react";
import { openFileInPreview } from "../../stores/artifact-store";
import { useContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import { fileIconUrl, folderIconUrl, genericIconUrl } from "../../lib/file-icons";
import { useT } from "../../lib/i18n";

interface FileEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
  loaded: boolean;
  loading: boolean;
}

// 相对项目根的路径（用于复制相对路径 / 发送给 agent 的 @引用）。
function toRelative(projectPath: string | null, fullPath: string): string {
  if (!projectPath) return fullPath;
  var root = projectPath.replace(/[\\/]+$/, "");
  var p = fullPath.replace(/\\/g, "/");
  var r = root.replace(/\\/g, "/");
  if (p.indexOf(r + "/") === 0) return p.slice(r.length + 1);
  if (p === r) return ".";
  return p;
}

async function copyToClipboard(text: string) {
  try { await navigator.clipboard.writeText(text); } catch (e) {}
}

export function FileExplorer() {
  const { projectPath, addOpenFile, requestChatInput } = useAppStore();
  const t = useT();
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  // 行内编辑态：重命名某项，或在某文件夹下新建文件/文件夹。
  const [editing, setEditing] = useState<
    | { kind: "rename"; path: string; initial: string }
    | { kind: "new"; dirPath: string; isDir: boolean }
    | null
  >(null);
  const { openMenu, ContextMenuEl } = useContextMenu();
  // 文件名搜索：非空时对项目做一次有上限的递归遍历，展示扁平匹配列表。
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ path: string; name: string; isDir: boolean }[]>([]);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);

  const loadDirectory = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    const entries = await window.api.readDir(dirPath);
    // Sort: directories first, then files, alphabetically
    entries.sort((a: FileEntry, b: FileEntry) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return entries
      .filter((e: FileEntry) => !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e: FileEntry) => ({
        name: e.name,
        path: dirPath + "/" + e.name,
        isDirectory: e.isDirectory,
        children: [],
        loaded: false,
        loading: false,
      }));
  }, []);

  const refreshRoot = useCallback(() => {
    if (!projectPath) return;
    setLoading(true);
    loadDirectory(projectPath).then((nodes) => {
      setTree(nodes);
      setLoading(false);
    });
  }, [projectPath, loadDirectory]);

  useEffect(() => {
    if (projectPath) refreshRoot();
  }, [projectPath]);

  // 文件名搜索：query 变化后防抖，对项目做有上限的广度优先遍历（跳过隐藏目录/
  // node_modules），收集名字命中关键词的文件与文件夹。上限防止超大仓库卡顿。
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q || !projectPath) { setResults([]); setSearching(false); return; }
    const seq = ++searchSeq.current;
    setSearching(true);
    const handle = setTimeout(async () => {
      const out: { path: string; name: string; isDir: boolean }[] = [];
      const queue: string[] = [projectPath];
      let visited = 0;
      const MAX_VISIT = 4000, MAX_HITS = 300;
      try {
        while (queue.length && visited < MAX_VISIT && out.length < MAX_HITS) {
          if (seq !== searchSeq.current) return; // 已被更新的查询取代
          const dir = queue.shift() as string;
          let entries: FileEntry[] = [];
          try { entries = await window.api.readDir(dir); } catch { entries = []; }
          for (const e of entries) {
            if (e.name.startsWith(".") || e.name === "node_modules") continue;
            visited++;
            const full = dir + "/" + e.name;
            if (e.name.toLowerCase().indexOf(q) !== -1) {
              out.push({ path: full, name: e.name, isDir: e.isDirectory });
              if (out.length >= MAX_HITS) break;
            }
            if (e.isDirectory) queue.push(full);
          }
        }
      } catch { /* ignore */ }
      if (seq === searchSeq.current) { setResults(out); setSearching(false); }
    }, 220);
    return () => clearTimeout(handle);
  }, [query, projectPath]);

  // 重新加载指定文件夹的子节点（重命名/删除/新建后刷新该层）。找到树里对应
  // 节点，若已展开则重新拉取它的 children。整树用克隆触发 re-render。
  const reloadDir = useCallback(async (dirPath: string) => {
    if (!projectPath || dirPath === projectPath) { refreshRoot(); return; }
    // 在树里就地查找并刷新该节点的 children。
    const walk = async (nodes: TreeNode[]): Promise<boolean> => {
      for (const n of nodes) {
        if (n.path === dirPath && n.isDirectory) {
          if (n.loaded) n.children = await loadDirectory(dirPath);
          return true;
        }
        if (n.children.length && await walk(n.children)) return true;
      }
      return false;
    };
    await walk(tree);
    setTree([...tree]);
  }, [projectPath, tree, loadDirectory, refreshRoot]);

  const toggleNode = async (node: TreeNode) => {
    if (!node.isDirectory) {
      addOpenFile(node.path);
      return;
    }

    if (node.loaded) {
      node.children = [];
      node.loaded = false;
      setTree([...tree]);
      return;
    }

    node.loading = true;
    setTree([...tree]);

    try {
      const children = await loadDirectory(node.path);
      node.children = children;
      node.loaded = true;
      node.loading = false;
      setTree([...tree]);
    } catch {
      node.loading = false;
      setTree([...tree]);
    }
  };

  // 确保某文件夹是展开+已加载的（新建子项前用，让新项可见）。
  const ensureExpanded = useCallback(async (node: TreeNode) => {
    if (!node.isDirectory || node.loaded) return;
    node.children = await loadDirectory(node.path);
    node.loaded = true;
    setTree([...tree]);
  }, [tree, loadDirectory]);

  // ===== 文件系统操作（右键菜单触发） =====
  const doRename = async (oldPath: string, newName: string) => {
    setEditing(null);
    const name = (newName || "").trim();
    if (!name) return;
    const parent = oldPath.replace(/[\\/][^\\/]+$/, "");
    const newPath = parent + "/" + name;
    if (newPath === oldPath) return;
    const res = await window.api.renamePath(oldPath, newPath);
    if (res && res.ok) await reloadDir(parent);
  };

  const doCreate = async (dirPath: string, name: string, isDir: boolean) => {
    setEditing(null);
    const n = (name || "").trim();
    if (!n) return;
    const target = dirPath + "/" + n;
    const res = isDir ? await window.api.mkdirPath(target) : await window.api.createFile(target);
    if (res && res.ok) {
      await reloadDir(dirPath);
      if (!isDir) openFileInPreview(target);
    }
  };

  const doDelete = async (node: TreeNode) => {
    // sandbox 下无 window.confirm；直接删（右键属显式操作）。可后续加确认卡片。
    const res = await window.api.deletePath(node.path);
    if (res && res.ok) {
      const parent = node.path.replace(/[\\/][^\\/]+$/, "");
      await reloadDir(parent);
    }
  };

  // 为某节点构造右键菜单项（文件 vs 文件夹不同）。
  const buildMenu = (node: TreeNode): ContextMenuItem[] => {
    const rel = toRelative(projectPath, node.path);
    const common: ContextMenuItem[] = [
      { label: t("在资源管理器中查看", "Reveal in File Explorer"), icon: <FolderSearch size={13} />, onClick: () => window.api.showInFolder(node.path) },
      { label: t("复制路径", "Copy Path"), icon: <Copy size={13} />, onClick: () => copyToClipboard(node.path) },
      { label: t("复制相对路径", "Copy Relative Path"), icon: <Copy size={13} />, onClick: () => copyToClipboard(rel) },
    ];
    if (node.isDirectory) {
      return [
        { label: t("新建文件", "New File"), icon: <FilePlus size={13} />, onClick: async () => { await ensureExpanded(node); setEditing({ kind: "new", dirPath: node.path, isDir: false }); } },
        { label: t("新建文件夹", "New Folder"), icon: <FolderPlus size={13} />, onClick: async () => { await ensureExpanded(node); setEditing({ kind: "new", dirPath: node.path, isDir: true }); } },
        ...common,
        { label: t("重命名", "Rename"), icon: <Pencil size={13} />, separatorBefore: true, onClick: () => setEditing({ kind: "rename", path: node.path, initial: node.name }) },
        { label: t("删除", "Delete"), icon: <Trash2 size={13} />, danger: true, onClick: () => doDelete(node) },
      ];
    }
    return [
      { label: t("预览", "Preview"), icon: <Eye size={13} />, onClick: () => openFileInPreview(node.path) },
      { label: t("发送给 Agent", "Send to Agent"), icon: <Send size={13} />, onClick: () => requestChatInput("@" + rel) },
      ...common,
      { label: t("重命名", "Rename"), icon: <Pencil size={13} />, separatorBefore: true, onClick: () => setEditing({ kind: "rename", path: node.path, initial: node.name }) },
      { label: t("删除", "Delete"), icon: <Trash2 size={13} />, danger: true, onClick: () => doDelete(node) },
    ];
  };

  if (!projectPath) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <p>Open a project to browse files</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[11px] font-semibold text-foreground/50 uppercase tracking-[0.08em] truncate">
          {projectPath.replace(/\\/g, "/").split("/").pop() || "Project"}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setEditing({ kind: "new", dirPath: projectPath, isDir: false })}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-accent/70 text-muted-foreground hover:text-foreground transition-colors"
            title={t("新建文件", "New File")}>
            <FilePlus size={12} />
          </button>
          <button
            onClick={() => setEditing({ kind: "new", dirPath: projectPath, isDir: true })}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-accent/70 text-muted-foreground hover:text-foreground transition-colors"
            title={t("新建文件夹", "New Folder")}>
            <FolderPlus size={12} />
          </button>
          <button
            onClick={refreshRoot}
            className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-accent/70 text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>
      {/* 文件名搜索框 */}
      <div className="px-2 pb-1.5">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/60 ring-1 ring-transparent focus-within:ring-ring/40 focus-within:bg-muted/80 transition-all">
          <Search size={12} className="text-muted-foreground/70 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("按文件名搜索…", "Search by file name…")}
            className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 outline-none min-w-0"
          />
          {query && (
            <button onClick={() => setQuery("")} className="shrink-0 text-muted-foreground hover:text-foreground" title={t("清除", "Clear")}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-1.5 pb-1">
        {query.trim() ? (
          // 搜索结果：扁平列表，点击文件预览、文件夹在资源管理器中打开。
          searching && results.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">{t("搜索中…", "Searching…")}</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">{t("没有匹配的文件。", "No matching files.")}</div>
          ) : (
            <>
              <p className="px-2 py-1 text-[10px] text-muted-foreground/60">{results.length}{results.length >= 300 ? "+" : ""} {t("个匹配", "matches")}</p>
              {results.map((r) => (
                <button
                  key={r.path}
                  onClick={() => { if (r.isDir) (window as any).api?.showInFolder?.(r.path); else openFileInPreview(r.path); }}
                  onContextMenu={(e) => openMenu(e, buildMenu({ name: r.name, path: r.path, isDirectory: r.isDir, children: [], loaded: false, loading: false }))}
                  title={toRelative(projectPath, r.path)}
                  className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-xs hover:bg-[hsl(var(--sidebar-hover))] transition-colors text-left"
                >
                  <img src={r.isDir ? folderIconUrl(r.name, false) : fileIconUrl(r.name)} alt="" draggable={false} className="w-4 h-4 shrink-0" />
                  <span className="truncate text-foreground/80">{r.name}</span>
                  <span className="truncate text-[10px] text-muted-foreground/50 ml-auto pl-2">{toRelative(projectPath, r.path).replace(/\/[^/]*$/, "") || "."}</span>
                </button>
              ))}
            </>
          )
        ) : loading ? (
          <div className="p-3 text-xs text-muted-foreground">Loading...</div>
        ) : (
          <>
            <TreeNodeList nodes={tree} level={0} onToggle={toggleNode}
              onContextMenu={(e, node) => openMenu(e, buildMenu(node))}
              editing={editing}
              onRenameCommit={doRename}
              onNewCommit={doCreate}
              onEditCancel={() => setEditing(null)} />
            {/* 根目录下新建：在树末尾插入临时输入行 */}
            {editing && editing.kind === "new" && editing.dirPath === projectPath && (
              <InlineEditRow level={0} isDir={editing.isDir}
                onCommit={(name) => doCreate(projectPath, name, editing.isDir)}
                onCancel={() => setEditing(null)} />
            )}
          </>
        )}
      </div>
      {ContextMenuEl}
    </div>
  );
}

function TreeNodeList({
  nodes, level, onToggle, onContextMenu, editing, onRenameCommit, onNewCommit, onEditCancel,
}: {
  nodes: TreeNode[];
  level: number;
  onToggle: (node: TreeNode) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  editing: any;
  onRenameCommit: (oldPath: string, name: string) => void;
  onNewCommit: (dirPath: string, name: string, isDir: boolean) => void;
  onEditCancel: () => void;
}) {
  return (
    <>
      {nodes.map((node) => (
        <TreeNodeItem key={node.path} node={node} level={level} onToggle={onToggle}
          onContextMenu={onContextMenu} editing={editing}
          onRenameCommit={onRenameCommit} onNewCommit={onNewCommit} onEditCancel={onEditCancel} />
      ))}
    </>
  );
}

function TreeNodeItem({
  node, level, onToggle, onContextMenu, editing, onRenameCommit, onNewCommit, onEditCancel,
}: {
  node: TreeNode;
  level: number;
  onToggle: (node: TreeNode) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
  editing: any;
  onRenameCommit: (oldPath: string, name: string) => void;
  onNewCommit: (dirPath: string, name: string, isDir: boolean) => void;
  onEditCancel: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  const handleClick = () => {
    if (node.isDirectory) {
      setExpanded(!expanded);
    }
    onToggle(node);
  };

  // Double-click a file → open it in the right-side preview panel.
  const handleDoubleClick = () => {
    if (!node.isDirectory) openFileInPreview(node.path);
  };

  const getIcon = () => {
    const url = node.isDirectory ? folderIconUrl(node.name, expanded) : fileIconUrl(node.name);
    return <img src={url} alt="" draggable={false} className="w-4 h-4 shrink-0" />;
  };

  const isRenaming = editing && editing.kind === "rename" && editing.path === node.path;
  const isNewingHere = editing && editing.kind === "new" && editing.dirPath === node.path;

  return (
    <>
      {isRenaming ? (
        <InlineEditRow level={level} initial={editing.initial} icon={getIcon()}
          onCommit={(name) => onRenameCommit(node.path, name)}
          onCancel={onEditCancel} />
      ) : (
        <button
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onContextMenu={(e) => onContextMenu(e, node)}
          title={node.isDirectory ? node.name : t("双击预览", "Double-click to preview")}
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-xs hover:bg-[hsl(var(--sidebar-hover))] transition-colors text-left"
          style={{ paddingLeft: 6 + level * 14 }}
        >
          <span className="w-4 flex-shrink-0">
            {node.isDirectory ? (
              expanded ? <ChevronDown size={11} className="text-muted-foreground" /> : <ChevronRight size={11} className="text-muted-foreground" />
            ) : (
              <span className="w-3 inline-block" />
            )}
          </span>
          {getIcon()}
          <span className="truncate text-foreground/80">{node.name}</span>
          {node.loading && (
            <span className="text-[9px] text-muted-foreground animate-pulse">...</span>
          )}
        </button>
      )}
      {expanded && node.loaded && (
        <>
          <TreeNodeList nodes={node.children} level={level + 1} onToggle={onToggle}
            onContextMenu={onContextMenu} editing={editing}
            onRenameCommit={onRenameCommit} onNewCommit={onNewCommit} onEditCancel={onEditCancel} />
          {/* 在此文件夹下新建：插入临时输入行 */}
          {isNewingHere && (
            <InlineEditRow level={level + 1} isDir={editing.isDir}
              onCommit={(name) => onNewCommit(node.path, name, editing.isDir)}
              onCancel={onEditCancel} />
          )}
        </>
      )}
    </>
  );
}

// 行内输入行：用于重命名与新建。回车提交，Esc / 失焦取消。
function InlineEditRow({ level, initial, isDir, icon, onCommit, onCancel }: {
  level: number;
  initial?: string;
  isDir?: boolean;
  icon?: React.ReactNode;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(initial || "");
  return (
    <div className="w-full flex items-center gap-1.5 px-2 py-1 text-xs"
      style={{ paddingLeft: 6 + level * 14 }}>
      <span className="w-4 flex-shrink-0" />
      {icon || <img src={genericIconUrl(!!isDir)} alt="" draggable={false} className="w-4 h-4 shrink-0" />}
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onCommit(value); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        onBlur={() => onCommit(value)}
        placeholder={isDir ? t("文件夹名", "Folder name") : t("文件名", "File name")}
        className="flex-1 min-w-0 bg-input/60 border border-ring/50 rounded px-1 py-0.5 text-xs text-foreground outline-none"
      />
    </div>
  );
}
