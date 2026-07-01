/**
 * relay-tools —— 远程命令里不需要 AI 的工具执行（file/git/run/search/status）。
 *
 * 从旧 discord-bot-manager 的各 handler 抽出，与平台无关：网关把 /file /git 等翻译成
 * RelayCommand(kind:"tool")，RelayCore.bridge.runTool 调到这里执行，返回纯文本结果，
 * 再经 emit 发回对应平台频道（Discord editReply / Telegram editMessageText）。
 *
 * 输出格式与旧实现保持一致，保证迁移后远程端观感不变。
 */
import { executeTool, TOOL_DEFINITIONS } from "../tools";
import { gitManager } from "../git-manager";
import { mcpManager } from "../mcp-manager";

export interface RelayToolResult { ok: boolean; text?: string; error?: string; filename?: string }

/**
 * 执行一个远程工具命令。
 * @param tool 形如 "run" | "search" | "status" | "file.read" | "file.list" | "git.status" ...
 * @param args 网关打平后的参数
 * @param cwd 当前项目根（需要 cwd 的命令为空时返回提示）
 * @param askBusy 供 status 命令显示是否有 ask 正在跑
 */
export async function runRelayTool(
  tool: string,
  args: Record<string, any>,
  cwd: string,
  askBusy: boolean,
): Promise<RelayToolResult> {
  const needsCwd = tool !== "status";
  if (needsCwd && !cwd) {
    return { ok: false, error: "⚠️ UE Coworker 尚未打开任何项目，请先在桌面端打开一个项目。" };
  }

  try {
    if (tool === "status") return { ok: true, text: statusText(cwd, askBusy) };

    if (tool === "run") {
      const out = await executeTool("run_command", { command: args.command, timeout: args.timeout ?? 30000 }, cwd);
      return { ok: true, text: "```\n" + out + "\n```", filename: "output.txt" };
    }

    if (tool === "search") {
      const out = await executeTool("search_files", { pattern: args.query, dir_path: args.path || ".", file_pattern: args.pattern || undefined }, cwd);
      return { ok: true, text: out, filename: "search-results.txt" };
    }

    if (tool === "file.read") {
      const out = await executeTool("read_file", { file_path: args.path, offset: args.offset, limit: args.limit }, cwd);
      return { ok: true, text: out, filename: String(args.path || "file").split(/[\\/]/).pop() || "file" };
    }
    if (tool === "file.list") {
      const out = await executeTool("list_files", { dir_path: args.path || "." }, cwd);
      return { ok: true, text: out };
    }

    if (tool.startsWith("git.")) return await runGit(tool.slice(4), args, cwd);

    return { ok: false, error: "未知命令: " + tool };
  } catch (err: any) {
    return { ok: false, error: "❌ 命令执行出错: " + (err?.message || String(err)) };
  }
}

async function runGit(sub: string, args: Record<string, any>, cwd: string): Promise<RelayToolResult> {
  switch (sub) {
    case "status": {
      const s = await gitManager.status(cwd);
      if (s.error) return { ok: false, error: "❌ " + s.error };
      if (!s.isRepo) return { ok: true, text: "ℹ️ 当前项目不是 Git 仓库。" };
      const staged = s.changes.filter((c) => c.staged);
      const modified = s.changes.filter((c) => c.unstaged && !c.untracked);
      const untracked = s.changes.filter((c) => c.untracked);
      const lines = [
        "📋 **Git 状态** — `" + (s.branch || "unknown") + "`"
          + (s.ahead || s.behind ? "  (↑" + s.ahead + " ↓" + s.behind + ")" : ""),
        "",
        ...staged.map((f) => "🟢 已暂存: `" + f.path + "`"),
        ...modified.map((f) => "🟡 已修改: `" + f.path + "`"),
        ...untracked.map((f) => "⚪ 未跟踪: `" + f.path + "`"),
      ];
      if (s.changes.length === 0) lines.push("✨ 工作目录干净");
      return { ok: true, text: lines.join("\n") };
    }
    case "log": {
      const logs = await gitManager.log(cwd, args.count || 10);
      const text = Array.isArray(logs) && logs.length > 0
        ? logs.map((l) => "`" + (l.hash || "").slice(0, 7) + "` " + (l.subject || "") + " — " + (l.author || "") + " " + (l.date || "")).join("\n")
        : "暂无提交记录。";
      return { ok: true, text };
    }
    case "commit": {
      const r = await gitManager.commit(cwd, args.message);
      return r.ok
        ? { ok: true, text: "✅ 提交成功: `" + (r.hash || "").slice(0, 7) + "` " + args.message }
        : { ok: false, error: r.error || "提交失败" };
    }
    case "push": {
      const r = await gitManager.push(cwd);
      return r.ok ? { ok: true, text: "✅ 推送成功" } : { ok: false, error: r.error || "推送失败" };
    }
    case "pull": {
      const r = await gitManager.pull(cwd);
      return r.ok ? { ok: true, text: "✅ 拉取成功" } : { ok: false, error: r.error || "拉取失败" };
    }
    case "branches": {
      const b = await gitManager.branches(cwd);
      const all = Array.isArray(b.all) ? b.all : [];
      return { ok: true, text: all.map((n) => (n === b.current ? "▶ " : "  ") + "`" + n + "`").join("\n") || "暂无分支。" };
    }
    case "checkout": {
      const r = await gitManager.checkout(cwd, args.branch);
      return r.ok ? { ok: true, text: "✅ 已切换到分支: `" + args.branch + "`" } : { ok: false, error: r.error || "切换失败" };
    }
    default:
      return { ok: false, error: "未知 git 子命令: " + sub };
  }
}

function statusText(cwd: string, askBusy: boolean): string {
  const mcp = mcpManager.statusSummary();
  const online = mcp.filter((s: any) => s.status === "connected").length;
  return [
    "📊 **UE Coworker 状态**",
    "📁 项目路径: `" + (cwd || "（未打开项目）") + "`",
    "🤖 /ask: " + (askBusy ? "🟢 处理中" : "💤 空闲"),
    "🔌 MCP: " + online + "/" + mcp.length + " 已连接",
    "🛠️ 工具数: " + TOOL_DEFINITIONS.length,
  ].join("\n");
}
