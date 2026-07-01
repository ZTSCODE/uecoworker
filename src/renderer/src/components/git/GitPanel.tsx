import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "../../stores/app-store";
import { cn } from "../../lib/utils";
import {
  GitBranch, Check, RefreshCw, Plus, Minus, RotateCcw, ChevronDown, ChevronRight,
  ArrowUp, ArrowDown, GitCommit, History, Loader2, AlertTriangle, GitFork,
  GitPullRequest, Undo2, Copy, Tag, Eye, GitMerge, FileClock, X, Github,
} from "lucide-react";
import { fileIconUrl } from "../../lib/file-icons";
import { openArtifactDiff, openFileInPreview } from "../../stores/artifact-store";
import { useContextMenu, type ContextMenuItem } from "../ui/ContextMenu";
import type { GitStatus, GitFileChange, GitLogEntry } from "../../../../preload/index.d";
import { useT } from "../../lib/i18n";

// 解析 %D 装饰串（"HEAD -> main, origin/main, tag: v1"）成可显示的 chips。
function parseRefs(refs: string | undefined): { label: string; kind: "head" | "branch" | "remote" | "tag" }[] {
  if (!refs) return [];
  return refs.split(",").map(function (r) { return r.trim(); }).filter(Boolean).map(function (r) {
    if (r.indexOf("tag:") === 0) return { label: r.slice(4).trim(), kind: "tag" as const };
    if (r.indexOf("HEAD ->") === 0) return { label: r.slice(7).trim(), kind: "head" as const };
    if (r === "HEAD") return { label: "HEAD", kind: "head" as const };
    if (r.indexOf("/") !== -1) return { label: r, kind: "remote" as const };
    return { label: r, kind: "branch" as const };
  });
}
function refChipClass(kind: string): string {
  if (kind === "head") return "bg-accent-brand/15 text-accent-brand";
  if (kind === "tag") return "bg-yellow-500/15 text-yellow-600 dark:text-yellow-500";
  if (kind === "remote") return "bg-muted text-muted-foreground";
  return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-500";
}

// 源代码管理面板（对标 VS Code Source Control）：分支头 + 提交框 + 暂存/变更分组 +
// 历史。后端走系统 git CLI。点击文件在右侧预览面板显示 diff。

// porcelain 状态字符 → 颜色（与 VS Code 配色一致）。
function changeColor(c: GitFileChange): string {
  if (c.untracked) return "text-green-500";
  switch (c.display) {
    case "M": return "text-yellow-500";
    case "A": return "text-green-500";
    case "D": return "text-red-400";
    case "R": return "text-blue-400";
    case "C": return "text-blue-400";
    case "U": return "text-orange-500"; // 冲突
    default: return "text-muted-foreground";
  }
}
function changeLabel(c: GitFileChange): string {
  if (c.untracked) return "U";
  return c.display || "M";
}

export function GitPanel() {
  var t = useT();
  var projectPath = useAppStore(function (s) { return s.projectPath; });
  var api = (window as any).api;

  var [status, setStatus] = useState<GitStatus | null>(null);
  var [loading, setLoading] = useState(true);
  var [message, setMessage] = useState("");
  var [committing, setCommitting] = useState(false);
  var [busy, setBusy] = useState(false);
  var [error, setError] = useState<string | null>(null);
  var [notice, setNotice] = useState<string | null>(null);
  var [showHistory, setShowHistory] = useState(false);
  var [history, setHistory] = useState<GitLogEntry[]>([]);
  var [showBranches, setShowBranches] = useState(false);
  var [branches, setBranches] = useState<{ current: string; all: string[] }>({ current: "", all: [] });
  // 新建分支内联输入（Electron 渲染进程禁用 window.prompt，必须用应用内输入）。
  var [creatingBranch, setCreatingBranch] = useState(false);
  var [newBranchName, setNewBranchName] = useState("");
  // 基于某提交建分支时记住基点（空=基于 HEAD）。
  var [branchBaseCommit, setBranchBaseCommit] = useState<string>("");
  var [stagedOpen, setStagedOpen] = useState(true);
  var [changesOpen, setChangesOpen] = useState(true);
  var [hasRemote, setHasRemote] = useState(false);
  var [showPR, setShowPR] = useState(false);
  var [prBusy, setPrBusy] = useState(false);
  // 「浏览项目文件」分区：对任意已跟踪文件操作（即使当前无改动）。
  var [showBrowse, setShowBrowse] = useState(false);
  var [allFiles, setAllFiles] = useState<string[]>([]);
  var [browseQuery, setBrowseQuery] = useState("");
  var pollRef = useRef<any>(null);
  var historyMenu = useContextMenu();
  var fileMenu = useContextMenu();
  // 文件历史还原弹窗：{ file, entries } 或 null。
  var [fileHist, setFileHist] = useState<{ file: string; entries: GitLogEntry[] } | null>(null);
  var [restoringFile, setRestoringFile] = useState<string | null>(null);

  var flash = function (msg: string) { setNotice(msg); setTimeout(function () { setNotice(null); }, 3500); };
  var fail = function (msg: string) { setError(msg); setTimeout(function () { setError(null); }, 6000); };

  var refresh = useCallback(async function () {
    if (!projectPath) { setStatus(null); setLoading(false); return; }
    try {
      var st: GitStatus = await api.gitStatus(projectPath);
      setStatus(st);
      if (st.isRepo) {
        try { var ri = await api.gitRemoteInfo(projectPath); setHasRemote(!!(ri && ri.hasOrigin)); } catch (e) {}
      }
    } catch (e) { setStatus(null); }
    setLoading(false);
  }, [projectPath, api]);

  useEffect(function () { setLoading(true); refresh(); }, [refresh]);
  // 文件改动后状态会变；轻量轮询保持同步（面板可见时）。
  useEffect(function () {
    pollRef.current = setInterval(refresh, 4000);
    return function () { clearInterval(pollRef.current); };
  }, [refresh]);

  var loadHistory = useCallback(async function () {
    if (!projectPath) return;
    try { setHistory(await api.gitLog(projectPath, 50)); } catch (e) {}
  }, [projectPath, api]);

  var loadBranches = useCallback(async function () {
    if (!projectPath) return;
    try { setBranches(await api.gitBranches(projectPath)); } catch (e) {}
  }, [projectPath, api]);

  useEffect(function () { if (showHistory) loadHistory(); }, [showHistory, loadHistory, status?.changes.length]);
  useEffect(function () { if (showBranches) loadBranches(); }, [showBranches, loadBranches]);

  var staged = (status?.changes || []).filter(function (c) { return c.staged; });
  var unstaged = (status?.changes || []).filter(function (c) { return c.unstaged || c.untracked; });

  var openDiff = useCallback(function (c: GitFileChange) {
    if (!projectPath) return;
    api.gitDiff(projectPath, c.path, c.staged && !c.unstaged).then(function (diff: string) {
      openArtifactDiff(c.path, diff || t("(无差异)", "(no diff)"));
    });
  }, [projectPath, api]);

  var doStage = async function (paths: string[]) { setBusy(true); var r = await api.gitStage(projectPath, paths); if (!r.ok) fail(r.error || t("暂存失败", "Stage failed")); setBusy(false); refresh(); };
  var doUnstage = async function (paths: string[]) { setBusy(true); var r = await api.gitUnstage(projectPath, paths); if (!r.ok) fail(r.error || t("取消暂存失败", "Unstage failed")); setBusy(false); refresh(); };
  var doStageAll = async function () { setBusy(true); var r = await api.gitStageAll(projectPath); if (!r.ok) fail(r.error || t("暂存失败", "Stage failed")); setBusy(false); refresh(); };
  var doDiscard = async function (paths: string[]) { setBusy(true); var r = await api.gitDiscard(projectPath, paths); if (!r.ok) fail(r.error || t("丢弃失败", "Discard failed")); setBusy(false); refresh(); };

  var doCommit = async function () {
    if (!message.trim()) return;
    setCommitting(true);
    // 没有已暂存内容但有变更 → 自动全部暂存后提交（VS Code 行为）。
    if (staged.length === 0 && unstaged.length > 0) { await api.gitStageAll(projectPath); }
    var r = await api.gitCommit(projectPath, message.trim());
    setCommitting(false);
    if (r.ok) { setMessage(""); flash(t("已提交 ", "Committed ") + (r.hash || "")); refresh(); if (showHistory) loadHistory(); }
    else fail(r.error || t("提交失败", "Commit failed"));
  };

  var doInit = async function () { setBusy(true); var r = await api.gitInit(projectPath); if (!r.ok) fail(r.error || t("git init 失败", "git init failed")); setBusy(false); refresh(); };
  var doPush = async function () { setBusy(true); var r = await api.gitPush(projectPath); setBusy(false); if (r.ok) flash(t("已推送", "Pushed")); else fail(r.error || t("推送失败", "Push failed")); refresh(); };
  var doPull = async function () { setBusy(true); var r = await api.gitPull(projectPath); setBusy(false); if (r.ok) flash(t("已拉取", "Pulled")); else fail(r.error || t("拉取失败", "Pull failed")); refresh(); };
  var doCheckout = async function (b: string) { setShowBranches(false); setBusy(true); var r = await api.gitCheckout(projectPath, b); setBusy(false); if (!r.ok) fail(r.error || t("切换分支失败", "Checkout failed")); refresh(); };
  var doCreateBranch = async function () {
    var name = newBranchName.trim();
    if (!name) return;
    setBusy(true);
    var r = branchBaseCommit
      ? await api.gitCreateBranchAt(projectPath, name, branchBaseCommit)
      : await api.gitCreateBranch(projectPath, name);
    setBusy(false);
    if (!r.ok) { fail(r.error || t("创建分支失败", "Create branch failed")); return; }
    flash(t("已创建并切换到 ", "Created and switched to ") + name + (branchBaseCommit ? t("（基于 ", " (from ") + branchBaseCommit.slice(0, 7) + t("）", ")") : ""));
    setNewBranchName(""); setCreatingBranch(false); setBranchBaseCommit(""); setShowBranches(false); refresh(); loadBranches();
  };
  // 从历史菜单触发「基于此提交新建分支」：打开顶部分支输入并记住基点。
  var startBranchFrom = function (commit: string) {
    setBranchBaseCommit(commit); setShowBranches(true); setCreatingBranch(true); setNewBranchName("");
  };

  // —— 提交级操作（历史右键）——
  var copyText = function (t: string) { try { navigator.clipboard.writeText(t); } catch (e) {} };
  var afterCommitOp = function (label: string, r: { ok: boolean; error?: string }) {
    if (r.ok) flash(label + t(" 成功", " succeeded")); else fail(r.error || (label + t(" 失败", " failed")));
    refresh(); loadHistory(); loadBranches();
  };
  var doRevert = async function (h: GitLogEntry) { setBusy(true); var r = await api.gitRevert(projectPath, h.hash); setBusy(false); afterCommitOp("revert", r); };
  var doCherryPick = async function (h: GitLogEntry) { setBusy(true); var r = await api.gitCherryPick(projectPath, h.hash); setBusy(false); afterCommitOp("cherry-pick", r); };
  var doReset = async function (h: GitLogEntry, mode: "soft" | "mixed" | "hard") { setBusy(true); var r = await api.gitReset(projectPath, h.hash, mode); setBusy(false); afterCommitOp("reset --" + mode, r); };
  var doCheckoutCommit = async function (h: GitLogEntry) { setBusy(true); var r = await api.gitCheckoutCommit(projectPath, h.hash); setBusy(false); afterCommitOp(t("检出提交", "Checkout commit"), r); };
  var openCommitDiff = async function (h: GitLogEntry) {
    try { var diff = await api.gitCommitDiff(projectPath, h.hash); openArtifactDiff(h.hash + " " + h.subject, diff || t("(无差异)", "(no diff)")); } catch (e) {}
  };

  // —— Pull Request ——
  var doOpenPR = async function () {
    setPrBusy(true);
    var r = await api.gitOpenPR(projectPath);
    setPrBusy(false);
    if (!r.ok) fail(r.error || t("打开 PR 失败", "Failed to open PR"));
  };

  // 打开「文件历史还原」弹窗：列出该文件的提交，选一个把文件还原到那个版本。
  var openFileHistory = async function (file: string) {
    try {
      var entries: GitLogEntry[] = await api.gitFileHistory(projectPath, file, 50);
      setFileHist({ file: file, entries: entries || [] });
    } catch (e) { fail(t("读取文件历史失败", "Failed to read file history")); }
  };
  var doRestoreFile = async function (file: string, commit: string) {
    setRestoringFile(commit);
    var r = await api.gitRestoreFile(projectPath, commit, file);
    setRestoringFile(null);
    if (r.ok) { flash(t("已将 ", "Restored ") + (file.split("/").pop() || file) + t(" 还原到 ", " to ") + commit.slice(0, 7)); setFileHist(null); refresh(); }
    else fail(r.error || t("还原失败", "Restore failed"));
  };

  // 加载项目内所有文件（用于「浏览项目文件」分区，对任意文件操作）。
  var loadAllFiles = useCallback(async function () {
    if (!projectPath) return;
    try { var list: string[] = await api.listProjectFiles(projectPath, 5000); setAllFiles(Array.isArray(list) ? list : []); }
    catch (e) {}
  }, [projectPath, api]);
  useEffect(function () { if (showBrowse && allFiles.length === 0) loadAllFiles(); }, [showBrowse, loadAllFiles, allFiles.length]);

  // 任意（已提交/干净）文件的右键菜单：查看历史还原、看与 HEAD 的 diff、在预览打开。
  var buildAnyFileMenu = function (path: string): ContextMenuItem[] {
    return [
      { label: t("将文件还原到某个版本…", "Restore File to a Version…"), icon: <FileClock size={13} />, onClick: function () { openFileHistory(path); } },
      { label: t("查看与 HEAD 的差异", "View Diff with HEAD"), icon: <Eye size={13} />, onClick: function () {
        api.gitDiff(projectPath, path, false).then(function (d: string) { openArtifactDiff(path, d || t("(与 HEAD 无差异)", "(no diff with HEAD)")); });
      } },
      { label: t("在预览中打开", "Open in Preview"), icon: <Eye size={13} />, separatorBefore: true, onClick: function () {
        var abs = (projectPath || "").replace(/[\\/]+$/, "") + "/" + path;
        openFileInPreview(abs);
      } },
    ];
  };

  // 提交历史右键菜单。
  var buildHistoryMenu = function (h: GitLogEntry): ContextMenuItem[] {
    return [
      { label: t("查看改动", "View Changes"), icon: <Eye size={13} />, onClick: function () { openCommitDiff(h); } },
      { label: t("撤销此提交 (revert)", "Revert This Commit"), icon: <Undo2 size={13} />, separatorBefore: true, onClick: function () { doRevert(h); } },
      { label: t("拣选到当前分支 (cherry-pick)", "Cherry-pick to Current Branch"), icon: <GitMerge size={13} />, onClick: function () { doCherryPick(h); } },
      { label: t("基于此提交新建分支", "New Branch from This Commit"), icon: <GitFork size={13} />, onClick: function () { startBranchFrom(h.hash); } },
      { label: t("检出此提交", "Checkout This Commit"), icon: <GitCommit size={13} />, onClick: function () { doCheckoutCommit(h); } },
      { label: t("软重置到此处（保留改动于暂存区）", "Soft Reset Here (keep changes staged)"), icon: <RotateCcw size={13} />, separatorBefore: true, onClick: function () { doReset(h, "soft"); } },
      { label: t("混合重置到此处（保留改动于工作区）", "Mixed Reset Here (keep changes in working tree)"), icon: <RotateCcw size={13} />, onClick: function () { doReset(h, "mixed"); } },
      { label: t("硬重置到此处（丢弃之后改动）", "Hard Reset Here (discard later changes)"), icon: <AlertTriangle size={13} />, danger: true, onClick: function () { doReset(h, "hard"); } },
      { label: t("复制提交哈希", "Copy Commit Hash"), icon: <Copy size={13} />, separatorBefore: true, onClick: function () { copyText(h.hash); } },
      { label: t("复制提交信息", "Copy Commit Message"), icon: <Copy size={13} />, onClick: function () { copyText(h.subject); } },
    ];
  };

  // 变更文件右键菜单：在普通的预览/暂存之外，加「还原到上一次提交」与文件历史还原。
  var buildFileMenu = function (c: GitFileChange): ContextMenuItem[] {
    var items: ContextMenuItem[] = [
      { label: t("查看 diff", "View Diff"), icon: <Eye size={13} />, onClick: function () { openDiff(c); } },
    ];
    if (c.staged) items.push({ label: t("取消暂存", "Unstage"), icon: <Minus size={13} />, onClick: function () { doUnstage([c.path]); } });
    else items.push({ label: t("暂存", "Stage"), icon: <Plus size={13} />, onClick: function () { doStage([c.path]); } });
    if (!c.untracked) {
      items.push({ label: t("丢弃更改（还原到 HEAD）", "Discard Changes (restore to HEAD)"), icon: <RotateCcw size={13} />, danger: true, separatorBefore: true, onClick: function () { doDiscard([c.path]); } });
      items.push({ label: t("将文件还原到某个版本…", "Restore File to a Version…"), icon: <FileClock size={13} />, onClick: function () { openFileHistory(c.path); } });
    }
    return items;
  };

  if (!projectPath) {
    return <div className="h-full flex items-center justify-center text-muted-foreground text-xs px-4 text-center">{t("打开一个项目以使用版本控制", "Open a project to use version control")}</div>;
  }
  if (loading) {
    return <div className="h-full flex items-center justify-center text-muted-foreground text-xs"><Loader2 size={14} className="animate-spin mr-2" />{t("加载中…", "Loading…")}</div>;
  }
  if (status && !status.isRepo) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <GitBranch size={28} className="text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">{t("当前目录不是 Git 仓库。", "This directory is not a Git repository.")}</p>
        <button onClick={doInit} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity disabled:opacity-50">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <GitBranch size={13} />} {t("初始化仓库", "Initialize Repository")}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 头部：分支 + 同步 + 刷新 */}
      <div className="shrink-0 px-2 py-2 border-b border-border/50 space-y-2">
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <button onClick={function () { setShowBranches(function (v) { if (v) { setCreatingBranch(false); setNewBranchName(""); } return !v; }); }}
              className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-accent text-xs text-foreground transition-colors">
              <GitBranch size={13} className="text-accent-brand shrink-0" />
              <span className="font-medium truncate">{status?.branch || "—"}</span>
              {!!(status && status.ahead) && <span className="flex items-center text-[10px] text-muted-foreground"><ArrowUp size={9} />{status.ahead}</span>}
              {!!(status && status.behind) && <span className="flex items-center text-[10px] text-muted-foreground"><ArrowDown size={9} />{status.behind}</span>}
              <ChevronDown size={11} className={cn("text-muted-foreground ml-auto transition-transform", showBranches && "rotate-180")} />
            </button>
            {showBranches && (
              <div className="absolute left-0 top-full mt-1 w-full min-w-[180px] max-h-64 overflow-y-auto rounded-lg border border-border bg-popover shadow-xl z-30 py-1 animate-fade-in">
                {branches.all.length === 0 ? (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground">{t("无其它分支", "No other branches")}</div>
                ) : branches.all.map(function (b) {
                  return (
                    <button key={b} onClick={function () { doCheckout(b); }}
                      className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-accent/60 transition-colors",
                        b === branches.current ? "text-foreground font-medium" : "text-muted-foreground")}>
                      <GitBranch size={11} className="shrink-0" />
                      <span className="truncate flex-1">{b}</span>
                      {b === branches.current && <Check size={11} className="shrink-0" />}
                    </button>
                  );
                })}
                <div className="border-t border-border/60 mt-1 pt-1">
                  {creatingBranch ? (
                    <div className="flex items-center gap-1.5 px-2 py-1">
                      <GitFork size={11} className="text-muted-foreground shrink-0" />
                      <input
                        autoFocus
                        value={newBranchName}
                        onChange={function (e) { setNewBranchName((e.target as HTMLInputElement).value); }}
                        onKeyDown={function (e) {
                          if (e.key === "Enter") { e.preventDefault(); doCreateBranch(); }
                          if (e.key === "Escape") { e.preventDefault(); setCreatingBranch(false); setNewBranchName(""); }
                        }}
                        placeholder={t("新分支名，回车确认", "New branch name, Enter to confirm")}
                        className="flex-1 min-w-0 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none" />
                      <button onClick={doCreateBranch} disabled={busy || !newBranchName.trim()} title={t("创建", "Create")}
                        className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground disabled:opacity-40">
                        {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                      </button>
                    </div>
                  ) : (
                    <button onClick={function () { setCreatingBranch(true); setNewBranchName(""); }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-accent/60 text-foreground transition-colors">
                      <GitFork size={11} /> {t("新建分支…", "New Branch…")}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
          <button onClick={doPull} disabled={busy} title={t("拉取 (pull --ff-only)", "Pull (pull --ff-only)")}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"><ArrowDown size={13} /></button>
          <button onClick={doPush} disabled={busy} title={t("推送 (push)", "Push (push)")}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"><ArrowUp size={13} /></button>
          <button onClick={function () { setShowPR(true); }} disabled={prBusy}
            title={hasRemote ? "Pull Request" : t("Pull Request（需先配置远程仓库）", "Pull Request (configure a remote first)")}
            className={cn("p-1.5 rounded-md hover:bg-accent transition-colors disabled:opacity-50",
              hasRemote ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground/50 hover:text-foreground")}>
            {prBusy ? <Loader2 size={13} className="animate-spin" /> : <GitPullRequest size={13} />}
          </button>
          <button onClick={function () { refresh(); }} disabled={busy} title={t("刷新", "Refresh")}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          </button>
        </div>

        {/* 提交信息框 + 提交按钮 */}
        <div className="space-y-1.5">
          <textarea value={message}
            onChange={function (e) { setMessage((e.target as HTMLTextAreaElement).value); }}
            onKeyDown={function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doCommit(); } }}
            placeholder={t("提交信息（Ctrl+Enter 提交）", "Commit message (Ctrl+Enter to commit)")}
            rows={2}
            className="w-full px-2.5 py-1.5 text-xs bg-muted border border-border rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-ring text-foreground placeholder:text-muted-foreground" />
          <button onClick={doCommit} disabled={committing || !message.trim() || (staged.length === 0 && unstaged.length === 0)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-foreground text-background font-medium hover:opacity-90 transition-opacity disabled:opacity-40">
            {committing ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {t("提交", "Commit")}{staged.length > 0 ? " (" + staged.length + ")" : (unstaged.length > 0 ? t(" 全部", " All") : "")}
          </button>
        </div>

        {(error || notice) && (
          <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded text-[11px]",
            error ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-500")}>
            {error ? <AlertTriangle size={11} /> : <Check size={11} />}
            <span className="truncate">{error || notice}</span>
          </div>
        )}
      </div>

      {/* 文件分组 */}
      <div className="flex-1 overflow-y-auto py-1">
        {staged.length === 0 && unstaged.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t("没有改动，工作区干净 ✓", "No changes, working tree clean ✓")}</div>
        )}

        {staged.length > 0 && (
          <FileGroup
            title={t("暂存的更改", "Staged Changes")} count={staged.length} open={stagedOpen} onToggle={function () { setStagedOpen(!stagedOpen); }}
            actions={[{ icon: <Minus size={12} />, title: t("全部取消暂存", "Unstage All"), onClick: function () { doUnstage(staged.map(function (c) { return c.path; })); } }]}
            files={staged} kind="staged" onOpenDiff={openDiff}
            onPrimary={function (c) { doUnstage([c.path]); }}
            onDiscard={null}
            onContext={function (e, c) { fileMenu.openMenu(e, buildFileMenu(c)); }}
          />
        )}
        {unstaged.length > 0 && (
          <FileGroup
            title={t("更改", "Changes")} count={unstaged.length} open={changesOpen} onToggle={function () { setChangesOpen(!changesOpen); }}
            actions={[
              { icon: <RotateCcw size={12} />, title: t("丢弃全部更改", "Discard All Changes"), onClick: function () { doDiscard(unstaged.map(function (c) { return c.path; })); }, danger: true },
              { icon: <Plus size={12} />, title: t("暂存全部更改", "Stage All Changes"), onClick: doStageAll },
            ]}
            files={unstaged} kind="unstaged" onOpenDiff={openDiff}
            onPrimary={function (c) { doStage([c.path]); }}
            onDiscard={function (c) { doDiscard([c.path]); }}
            onContext={function (e, c) { fileMenu.openMenu(e, buildFileMenu(c)); }}
          />
        )}
      </div>

      {/* 浏览项目文件：对任意已跟踪文件操作（即使当前无改动）。 */}
      <div className="shrink-0 border-t border-border">
        <button onClick={function () { setShowBrowse(function (v) { return !v; }); }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--sidebar-hover))] transition-colors">
          <FileClock size={12} />
          <span className="font-medium">{t("浏览项目文件", "Browse Project Files")}</span>
          <ChevronDown size={12} className={cn("ml-auto transition-transform", showBrowse && "rotate-180")} />
        </button>
        {showBrowse && (
          <div className="border-t border-border/60">
            <div className="px-2 py-1.5">
              <input value={browseQuery} onChange={function (e) { setBrowseQuery((e.target as HTMLInputElement).value); }}
                placeholder={t("筛选文件名…右键文件可还原/看历史", "Filter file names… right-click to restore / view history")}
                className="w-full px-2 py-1 text-[11px] bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring text-foreground placeholder:text-muted-foreground" />
            </div>
            <div className="max-h-56 overflow-y-auto pb-1">
              {(function () {
                var q = browseQuery.trim().toLowerCase();
                var list = q ? allFiles.filter(function (p) { return p.toLowerCase().indexOf(q) !== -1; }) : allFiles;
                if (allFiles.length === 0) return <div className="px-3 py-2 text-[11px] text-muted-foreground">{t("加载中…", "Loading…")}</div>;
                if (list.length === 0) return <div className="px-3 py-2 text-[11px] text-muted-foreground">{t("无匹配文件", "No matching files")}</div>;
                return list.slice(0, 300).map(function (p) {
                  var name = p.split("/").pop() || p;
                  var dir = p.indexOf("/") !== -1 ? p.slice(0, p.lastIndexOf("/")) : "";
                  return (
                    <div key={p}
                      onClick={function () { var abs = (projectPath || "").replace(/[\\/]+$/, "") + "/" + p; openFileInPreview(abs); }}
                      onContextMenu={function (e) { fileMenu.openMenu(e, buildAnyFileMenu(p)); }}
                      className="flex items-center gap-1.5 pl-4 pr-2 py-1 hover:bg-[hsl(var(--sidebar-hover))] transition-colors cursor-pointer">
                      <img src={fileIconUrl(name)} alt="" draggable={false} className="w-3.5 h-3.5 shrink-0" />
                      <span className="text-xs text-foreground/90 truncate">{name}</span>
                      {dir && <span className="text-[10px] text-muted-foreground/50 truncate min-w-0">{dir}</span>}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>

      {/* 历史 */}
      <div className="shrink-0 border-t border-border">
        <button onClick={function () { setShowHistory(function (v) { return !v; }); }}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--sidebar-hover))] transition-colors">
          <History size={12} />
          <span className="font-medium">{t("提交历史", "Commit History")}</span>
          <ChevronDown size={12} className={cn("ml-auto transition-transform", showHistory && "rotate-180")} />
        </button>
        {showHistory && (
          <div className="max-h-56 overflow-y-auto border-t border-border/60">
            {history.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-muted-foreground">{t("暂无提交。", "No commits yet.")}</div>
            ) : history.map(function (h) {
              var chips = parseRefs(h.refs);
              return (
                <div key={h.hash}
                  onClick={function () { openCommitDiff(h); }}
                  onContextMenu={function (e) { historyMenu.openMenu(e, buildHistoryMenu(h)); }}
                  className="flex items-start gap-2 px-3 py-1.5 hover:bg-[hsl(var(--sidebar-hover))] transition-colors cursor-pointer">
                  <GitCommit size={11} className="text-accent-brand mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 flex-wrap">
                      {chips.map(function (c, ci) {
                        return (
                          <span key={ci} className={cn("inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-medium leading-none shrink-0", refChipClass(c.kind))}>
                            {c.kind === "tag" ? <Tag size={8} /> : <GitBranch size={8} />}{c.label}
                          </span>
                        );
                      })}
                      <span className="text-[11px] text-foreground truncate min-w-0">{h.subject}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground/70 flex items-center gap-1.5">
                      <span className="font-mono">{h.hash}</span>
                      <span className="truncate">{h.author}</span>
                      <span className="opacity-60">· {h.date}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {historyMenu.ContextMenuEl}
      {fileMenu.ContextMenuEl}
      {showPR && (
        <PRDialog
          projectPath={projectPath}
          branch={status?.branch || ""}
          hasRemote={hasRemote}
          defaultTitle={history[0]?.subject || status?.branch || ""}
          onRemoteAdded={function () { refresh(); }}
          onClose={function () { setShowPR(false); }}
          onOpenWeb={function () { setShowPR(false); doOpenPR(); }}
          onDone={function (msg) { setShowPR(false); flash(msg); }}
          onFail={function (msg) { fail(msg); }}
        />
      )}
      {fileHist && (
        <FileHistoryDialog
          file={fileHist.file}
          entries={fileHist.entries}
          restoringId={restoringFile}
          onRestore={function (commit) { doRestoreFile(fileHist!.file, commit); }}
          onViewDiff={function (commit) { openCommitDiff({ hash: commit } as GitLogEntry); }}
          onClose={function () { setFileHist(null); }}
        />
      )}
    </div>
  );
}

// PR 弹窗：填标题/描述/base/草稿，用 gh pr create 创建；或直接「在浏览器打开」。
// 没有远程仓库时先引导添加 origin。
function PRDialog({ projectPath, branch, hasRemote, defaultTitle, onRemoteAdded, onClose, onOpenWeb, onDone, onFail }: {
  projectPath: string | null; branch: string; hasRemote: boolean; defaultTitle: string;
  onRemoteAdded: () => void;
  onClose: () => void; onOpenWeb: () => void; onDone: (msg: string) => void; onFail: (msg: string) => void;
}) {
  var t = useT();
  var api = (window as any).api;
  var [title, setTitle] = useState(defaultTitle);
  var [body, setBody] = useState("");
  var [base, setBase] = useState("");
  var [draft, setDraft] = useState(false);
  var [busy, setBusy] = useState(false);
  var [gh, setGh] = useState<{ installed: boolean; authed: boolean; message?: string } | null>(null);
  // 没远程时的 origin URL 输入。
  var [remoteUrl, setRemoteUrl] = useState("");
  var [remoteAdded, setRemoteAdded] = useState(hasRemote);
  // GitHub OAuth 登录态 + Device Flow 进行中的用户码。
  var [ghAuth, setGhAuth] = useState<{ authed: boolean; login: string } | null>(null);
  var [deviceCode, setDeviceCode] = useState<{ userCode: string; verificationUri: string } | null>(null);
  var [loginErr, setLoginErr] = useState<string>("");

  // 查 GitHub OAuth 登录态（与 gh CLI 独立；优先用它）。
  useEffect(function () {
    api.githubStatus().then(function (s: any) { setGhAuth(s); });
  }, []);

  // 监听后台登录轮询结果。
  useEffect(function () {
    var off = api.onGithubLoginResult(function (res: any) {
      setDeviceCode(null);
      if (res && res.ok) { setGhAuth({ authed: true, login: res.login || "" }); setLoginErr(""); }
      else setLoginErr((res && res.error) || t("登录失败", "Login failed"));
    });
    return function () { if (off) off(); };
  }, []);

  // 启动 Device Flow：拿到用户码后自动打开浏览器到验证页。
  var startGithubLogin = async function () {
    setLoginErr("");
    var r = await api.githubStartLogin();
    if (r && r.ok) {
      setDeviceCode({ userCode: r.userCode, verificationUri: r.verificationUri });
      try { api.openExternal(r.verificationUri); } catch (e) {}
    } else {
      setLoginErr((r && r.error) || t("无法启动登录", "Cannot start login"));
    }
  };

  useEffect(function () {
    if (!projectPath || !remoteAdded) return;
    api.gitGhStatus(projectPath).then(function (s: any) { setGh(s); });
  }, [projectPath, remoteAdded]);

  var addRemote = async function () {
    if (!remoteUrl.trim()) return;
    setBusy(true);
    var r = await api.gitSetRemote(projectPath, remoteUrl.trim());
    setBusy(false);
    if (r.ok) { setRemoteAdded(true); onRemoteAdded(); } else onFail(r.error || t("添加远程失败", "Failed to add remote"));
  };

  var submit = async function () {
    if (!title.trim()) return;
    setBusy(true);
    var r = await api.gitCreatePR(projectPath, { title: title.trim(), body: body, base: base.trim() || undefined, draft: draft });
    setBusy(false);
    if (r.ok) { onDone(r.url ? t("已创建 PR：", "PR created: ") + r.url : (r.error || t("已创建 PR", "PR created"))); if (r.url) { try { (window as any).api?.openExternal?.(r.url); } catch (e) {} } }
    else onFail(r.error || t("创建 PR 失败", "Failed to create PR"));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onMouseDown={onClose}>
      <div className="w-[460px] max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl p-5 space-y-3 animate-slide-up"
        onMouseDown={function (e) { e.stopPropagation(); }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><GitPullRequest size={15} className="text-accent-brand" /> {t("创建 Pull Request", "Create Pull Request")}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground"><X size={15} /></button>
        </div>

        {!remoteAdded ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-500 text-xs">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{t("这个仓库还没有配置远程（origin）。先填入远程仓库地址才能发起 PR。", "This repository has no remote (origin) configured. Add a remote URL to open a PR.")}</span>
            </div>
            <input value={remoteUrl} onChange={function (e) { setRemoteUrl((e.target as HTMLInputElement).value); }}
              onKeyDown={function (e) { if (e.key === "Enter") { e.preventDefault(); addRemote(); } }}
              placeholder={t("https://github.com/用户名/仓库.git", "https://github.com/user/repo.git")}
              className="w-full px-2.5 py-1.5 text-xs bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring text-foreground font-mono" />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40">{t("取消", "Cancel")}</button>
              <button onClick={addRemote} disabled={busy || !remoteUrl.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-foreground text-background font-medium hover:opacity-90 disabled:opacity-40">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {t("添加远程", "Add Remote")}
              </button>
            </div>
          </div>
        ) : (ghAuth && !ghAuth.authed) && gh && (!gh.installed || !gh.authed) ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-accent/40 text-foreground text-xs">
              <GitPullRequest size={13} className="mt-0.5 shrink-0 text-accent-brand" />
              <span>{t("用 GitHub 账号登录即可发起 PR——无需安装任何命令行工具。", "Sign in with your GitHub account to open PRs — no command-line tools needed.")}</span>
            </div>
            {deviceCode ? (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">
                  {t("已在浏览器打开 GitHub 授权页。请在页面输入下面的验证码：", "Opened GitHub's authorization page in your browser. Enter this code there:")}
                </p>
                <div className="flex items-center justify-center gap-2 py-2">
                  <span className="font-mono text-lg tracking-[0.3em] font-semibold text-foreground select-all">{deviceCode.userCode}</span>
                  <button onClick={function () { try { navigator.clipboard.writeText(deviceCode!.userCode); } catch (e) {} }}
                    className="p-1 rounded hover:bg-accent text-muted-foreground" title={t("复制", "Copy")}><Copy size={13} /></button>
                </div>
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 size={12} className="animate-spin" /> {t("等待授权完成…", "Waiting for authorization…")}
                </div>
                <div className="flex justify-center">
                  <button onClick={function () { api.githubCancelLogin(); setDeviceCode(null); }}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline">{t("取消", "Cancel")}</button>
                </div>
              </div>
            ) : (
              <>
                {loginErr && <div className="text-[11px] text-destructive">{loginErr}</div>}
                <p className="text-[11px] text-muted-foreground">
                  {t("点下面的按钮，会打开浏览器让你授权自己的 GitHub 账号；授权后回到这里即可创建 PR。", "Click below to open your browser and authorize your own GitHub account; return here to create the PR.")}
                </p>
                <div className="flex justify-end gap-2">
                  <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40">{t("取消", "Cancel")}</button>
                  <button onClick={onOpenWeb} className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40">{t("仅在浏览器创建", "Browser only")}</button>
                  <button onClick={startGithubLogin} className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-foreground text-background font-medium hover:opacity-90">
                    <Github size={13} /> {t("用 GitHub 登录", "Sign in with GitHub")}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="text-[11px] text-muted-foreground">{t("从分支 ", "From branch ")}<span className="font-mono text-foreground">{branch || "—"}</span>{t(" 发起。base 留空则用仓库默认分支。", ". Leave base empty to use the repo's default branch.")}</div>
            <input value={title} onChange={function (e) { setTitle((e.target as HTMLInputElement).value); }}
              placeholder={t("PR 标题", "PR title")} className="w-full px-2.5 py-1.5 text-xs bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring text-foreground" />
            <textarea value={body} onChange={function (e) { setBody((e.target as HTMLTextAreaElement).value); }}
              placeholder={t("描述（可选）", "Description (optional)")} rows={4} className="w-full px-2.5 py-1.5 text-xs bg-muted border border-border rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-ring text-foreground" />
            <div className="flex items-center gap-2">
              <input value={base} onChange={function (e) { setBase((e.target as HTMLInputElement).value); }}
                placeholder={t("base 分支（可选，如 main）", "base branch (optional, e.g. main)")} className="flex-1 px-2.5 py-1.5 text-xs bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-ring text-foreground" />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                <input type="checkbox" checked={draft} onChange={function (e) { setDraft((e.target as HTMLInputElement).checked); }} /> {t("草稿", "Draft")}
              </label>
            </div>
            <div className="flex justify-between items-center pt-1">
              <button onClick={onOpenWeb} className="text-[11px] text-muted-foreground hover:text-foreground">{t("改用浏览器创建 →", "Create in browser →")}</button>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent/40">{t("取消", "Cancel")}</button>
                <button onClick={submit} disabled={busy || !title.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-foreground text-background font-medium hover:opacity-90 disabled:opacity-40">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <GitPullRequest size={13} />} {t("创建 PR", "Create PR")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 文件历史还原弹窗：列出该文件的提交，选一个把文件还原到那个版本。
function FileHistoryDialog({ file, entries, restoringId, onRestore, onViewDiff, onClose }: {
  file: string; entries: GitLogEntry[]; restoringId: string | null;
  onRestore: (commit: string) => void; onViewDiff: (commit: string) => void; onClose: () => void;
}) {
  var t = useT();
  var name = file.split("/").pop() || file;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onMouseDown={onClose}>
      <div className="w-[480px] max-h-[80vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl p-5 space-y-3 animate-slide-up"
        onMouseDown={function (e) { e.stopPropagation(); }}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><FileClock size={15} className="text-accent-brand" /> {t("还原文件到某版本", "Restore File to a Version")}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent text-muted-foreground"><X size={15} /></button>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <img src={fileIconUrl(name)} alt="" className="w-3.5 h-3.5" /><span className="font-mono text-foreground">{file}</span>
        </div>
        {entries.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4 text-center">{t("该文件没有提交历史。", "This file has no commit history.")}</div>
        ) : (
          <div className="space-y-1 max-h-[50vh] overflow-y-auto">
            {entries.map(function (h) {
              return (
                <div key={h.hash} className="group/fh flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-accent/40 transition-colors">
                  <GitCommit size={11} className="text-accent-brand shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-foreground truncate">{h.subject}</div>
                    <div className="text-[10px] text-muted-foreground/70"><span className="font-mono">{h.hash}</span> · {h.author} · {h.date}</div>
                  </div>
                  <button onClick={function () { onViewDiff(h.hash); }} title={t("查看该提交改动", "View this commit's changes")}
                    className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground opacity-0 group-hover/fh:opacity-100"><Eye size={12} /></button>
                  <button onClick={function () { onRestore(h.hash); }} disabled={restoringId === h.hash} title={t("把文件还原到此版本", "Restore file to this version")}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50 shrink-0">
                    {restoringId === h.hash ? <Loader2 size={10} className="animate-spin" /> : <Undo2 size={10} />} {t("还原", "Restore")}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">{t("还原只改工作区，不自动提交——可在源代码管理里检查后再提交。", "Restore only changes the working tree; it doesn't commit — review in Source Control before committing.")}</p>
      </div>
    </div>
  );
}

// 单个文件分组（暂存/未暂存）。每行：状态字母 + 图标 + 文件名 + 路径 + 悬浮操作。
function FileGroup({ title, count, open, onToggle, actions, files, kind, onOpenDiff, onPrimary, onDiscard, onContext }: {
  title: string; count: number; open: boolean; onToggle: () => void;
  actions: { icon: React.ReactNode; title: string; onClick: () => void; danger?: boolean }[];
  files: GitFileChange[]; kind: "staged" | "unstaged";
  onOpenDiff: (c: GitFileChange) => void;
  onPrimary: (c: GitFileChange) => void;
  onDiscard: ((c: GitFileChange) => void) | null;
  onContext: (e: React.MouseEvent, c: GitFileChange) => void;
}) {
  var t = useT();
  return (
    <div className="mb-0.5">
      <div className="group/hdr flex items-center gap-1 px-2 py-1 text-[11px] uppercase tracking-wider text-muted-foreground hover:bg-[hsl(var(--sidebar-hover))]">
        <button onClick={onToggle} className="flex items-center gap-1 flex-1 min-w-0">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          <span className="font-semibold truncate">{title}</span>
          <span className="text-muted-foreground/50">{count}</span>
        </button>
        <div className="flex items-center gap-0.5 opacity-0 group-hover/hdr:opacity-100 transition-opacity">
          {actions.map(function (a, i) {
            return (
              <button key={i} onClick={a.onClick} title={a.title}
                className={cn("p-1 rounded hover:bg-accent transition-colors", a.danger ? "text-muted-foreground hover:text-destructive" : "text-muted-foreground hover:text-foreground")}>
                {a.icon}
              </button>
            );
          })}
        </div>
      </div>
      {open && files.map(function (c) {
        var name = c.path.split("/").pop() || c.path;
        var dir = c.path.indexOf("/") !== -1 ? c.path.slice(0, c.path.lastIndexOf("/")) : "";
        return (
          <div key={c.path}
            className="group/row flex items-center gap-1.5 pl-5 pr-2 py-1 hover:bg-[hsl(var(--sidebar-hover))] transition-colors cursor-pointer"
            onClick={function () { onOpenDiff(c); }}
            onContextMenu={function (e) { onContext(e, c); }}>
            <img src={fileIconUrl(name)} alt="" draggable={false} className="w-3.5 h-3.5 shrink-0" />
            <span className="text-xs text-foreground/90 truncate">{name}</span>
            {dir && <span className="text-[10px] text-muted-foreground/50 truncate min-w-0">{dir}</span>}
            <div className="ml-auto flex items-center gap-0.5 shrink-0">
              <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                {onDiscard && (
                  <button onClick={function (e) { e.stopPropagation(); onDiscard(c); }} title={t("丢弃更改", "Discard Changes")}
                    className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-destructive"><RotateCcw size={12} /></button>
                )}
                <button onClick={function (e) { e.stopPropagation(); onPrimary(c); }}
                  title={kind === "staged" ? t("取消暂存", "Unstage") : t("暂存更改", "Stage Changes")}
                  className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground">
                  {kind === "staged" ? <Minus size={12} /> : <Plus size={12} />}
                </button>
              </div>
              <span className={cn("w-3.5 text-center text-[11px] font-bold font-mono", changeColor(c))}>{changeLabel(c)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
