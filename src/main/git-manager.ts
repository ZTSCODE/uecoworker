// Git 版本控制后端：直接调用系统 git CLI（复用已安装的 git，不引原生依赖）。
// 提供 VS Code「源代码管理」面板所需的操作：status / diff / stage / unstage /
// commit / branch / checkout / log / discard / push / pull。
//
// 所有命令在指定 cwd（项目根）执行；用 execFile 传参数组避免 shell 注入。
//
// GitHub 鉴权：若用户经 OAuth 登录（github-auth.ts），push/PR 自动用其 token——
// 通过 `git -c http.extraheader=...` 注入 Authorization，不改 remote URL、不落盘、
// 不依赖 gh CLI。未登录则回退到系统 git 凭据助手/gh（保持原行为）。

import { execFile } from "child_process";
import { existsSync } from "fs";
import { Buffer } from "buffer";

// 取 GitHub OAuth token 的回调（由 index.ts 注入，避免 git-manager 直接依赖
// github-auth 造成循环）。返回空串表示未登录。
let githubTokenProvider: (() => Promise<string>) | null = null;
export function setGithubTokenProvider(fn: () => Promise<string>): void {
  githubTokenProvider = fn;
}

// 把 OAuth token 转成 git 可用的 http.extraheader 参数（Basic auth，x-access-token）。
// GitHub 接受 `Authorization: Basic base64("x-access-token:" + token)`。
async function githubAuthConfigArgs(remoteUrl: string): Promise<string[]> {
  if (!githubTokenProvider) return [];
  // 仅对 github.com 远程注入，避免把 token 发给其它主机。
  if (remoteUrl && !/github\.com/i.test(remoteUrl)) return [];
  const token = await githubTokenProvider();
  if (!token) return [];
  const basic = Buffer.from("x-access-token:" + token).toString("base64");
  return ["-c", "http.extraheader=Authorization: Basic " + basic];
}

export interface GitFileChange {
  path: string;          // 相对仓库根的路径（posix 分隔）
  index: string;         // 暂存区状态字符（porcelain XY 的 X）
  working: string;       // 工作区状态字符（porcelain XY 的 Y）
  staged: boolean;       // 是否有已暂存改动
  unstaged: boolean;     // 是否有未暂存改动
  untracked: boolean;
  display: string;       // 单字符摘要：M/A/D/R/U/?（给 UI 配色用）
}

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  ahead: number;
  behind: number;
  changes: GitFileChange[];
  error?: string;
}

// 在 cwd 执行一条 git 子命令；resolve 出 { ok, stdout, stderr, code }。
function git(cwd: string, args: string[], timeout = 20000): Promise<{ ok: boolean; stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err: any, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, stdout: String(stdout || ""), stderr: String(stderr || err.message || ""), code: err.code || 1 });
      } else {
        resolve({ ok: true, stdout: String(stdout || ""), stderr: String(stderr || ""), code: 0 });
      }
    });
  });
}

export class GitManager {
  // 是否是 git 仓库（.git 存在 + git 命令确认）。
  async isRepo(cwd: string): Promise<boolean> {
    if (!cwd) return false;
    const r = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return r.ok && r.stdout.trim() === "true";
  }

  // 完整状态：分支、ahead/behind、变更列表（porcelain v1 + 分支头）。
  async status(cwd: string): Promise<GitStatus> {
    const empty: GitStatus = { isRepo: false, branch: "", ahead: 0, behind: 0, changes: [] };
    if (!cwd) return empty;

    // 直接跑 status，据其结果判断是否仓库 —— 省掉前置 rev-parse 那次子进程
    // （GitPanel 可见时每 4s 轮询，合 2 进程为 1 能省一半 git spawn）。
    // 非仓库时 git 报 "not a git repository"，据此回退为 isRepo:false。
    const r = await git(cwd, ["status", "--porcelain=v1", "--branch", "-z"]);
    if (!r.ok) {
      if (/not a git repository/i.test(r.stderr)) return empty;
      // 其它错误：确是仓库但 status 失败（如锁冲突），保留 isRepo:true 并带错误。
      return { ...empty, isRepo: true, error: r.stderr };
    }

    // -z 用 NUL 分隔记录；首条是 "## branch...ahead/behind" 头。
    const records = r.stdout.split("\0").filter((s) => s.length > 0);
    let branch = "";
    let ahead = 0, behind = 0;
    const changes: GitFileChange[] = [];

    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (rec.startsWith("## ")) {
        const head = rec.slice(3);
        // 空仓库（尚无提交）："No commits yet on <branch>" / "Initial commit on <branch>"。
        const noCommit = /^(?:No commits yet|Initial commit) on (.+)$/.exec(head);
        if (noCommit) {
          branch = noCommit[1].trim();
        } else {
          // 形如 "main...origin/main [ahead 1, behind 2]" 或 "main"
          const bMatch = /^([^.\s]+)/.exec(head);
          branch = bMatch ? bMatch[1] : head;
        }
        const aM = /ahead (\d+)/.exec(head); if (aM) ahead = Number(aM[1]);
        const bM = /behind (\d+)/.exec(head); if (bM) behind = Number(bM[1]);
        continue;
      }
      // "XY <path>"；重命名 "R  old -> new" 在 -z 下 old 是下一条记录。
      const x = rec[0];
      const y = rec[1];
      let path = rec.slice(3);
      if (x === "R" || x === "C") {
        // 下一条记录是原路径（-z），跳过它。
        i++; // 消费原路径记录
      }
      const untracked = x === "?" && y === "?";
      const display = untracked ? "?" : (y !== " " && y !== "?" ? y : x);
      changes.push({
        path,
        index: x,
        working: y,
        staged: x !== " " && x !== "?",
        unstaged: y !== " " && y !== "?",
        untracked,
        display,
      });
    }

    return { isRepo: true, branch, ahead, behind, changes };
  }

  // 单个文件的 diff。staged=true 看暂存区（--cached）；未跟踪文件返回整文件加号视图。
  async diff(cwd: string, filePath: string, staged: boolean): Promise<string> {
    if (staged) {
      const r = await git(cwd, ["diff", "--cached", "--", filePath]);
      return r.stdout || r.stderr || "";
    }
    // 未跟踪文件无 diff：用 --no-index 对比 /dev/null 得到全增内容。
    const tracked = await git(cwd, ["ls-files", "--error-unmatch", "--", filePath]);
    if (!tracked.ok) {
      const full = await git(cwd, ["diff", "--no-index", "--", devNull(), filePath]);
      return full.stdout || "";
    }
    const r = await git(cwd, ["diff", "--", filePath]);
    return r.stdout || r.stderr || "";
  }

  async stage(cwd: string, paths: string[]): Promise<{ ok: boolean; error?: string }> {
    const r = await git(cwd, ["add", "--", ...paths]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr };
  }

  async stageAll(cwd: string): Promise<{ ok: boolean; error?: string }> {
    const r = await git(cwd, ["add", "-A"]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr };
  }

  async unstage(cwd: string, paths: string[]): Promise<{ ok: boolean; error?: string }> {
    const r = await git(cwd, ["reset", "-q", "HEAD", "--", ...paths]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr };
  }

  // 丢弃工作区改动。未跟踪文件用 clean 删除；已跟踪用 checkout 还原。
  async discard(cwd: string, paths: string[]): Promise<{ ok: boolean; error?: string }> {
    for (const p of paths) {
      const tracked = await git(cwd, ["ls-files", "--error-unmatch", "--", p]);
      if (tracked.ok) {
        const r = await git(cwd, ["checkout", "--", p]);
        if (!r.ok) return { ok: false, error: r.stderr };
      } else {
        const r = await git(cwd, ["clean", "-fd", "--", p]);
        if (!r.ok) return { ok: false, error: r.stderr };
      }
    }
    return { ok: true };
  }

  // 提交（仅提交已暂存内容）。空消息或无暂存内容时报错。
  async commit(cwd: string, message: string): Promise<{ ok: boolean; error?: string; hash?: string }> {
    if (!message || !message.trim()) return { ok: false, error: "提交信息不能为空" };
    const r = await git(cwd, ["commit", "-m", message]);
    if (!r.ok) return { ok: false, error: r.stderr || r.stdout };
    const h = await git(cwd, ["rev-parse", "--short", "HEAD"]);
    return { ok: true, hash: h.stdout.trim() };
  }

  // 最近 N 条提交（hash / 作者 / 相对时间 / 标题 / 所在分支·tag）。
  // %D = ref 名称（HEAD -> main, origin/main, tag: v1 等），让历史看得出分支。
  async log(cwd: string, limit = 50): Promise<Array<{ hash: string; author: string; date: string; subject: string; refs?: string }>> {
    if (!(await this.isRepo(cwd))) return [];
    const SEP = "\x1f";
    const r = await git(cwd, ["log", "-n", String(limit), "--all", "--date-order",
      "--pretty=format:%h" + SEP + "%an" + SEP + "%ar" + SEP + "%s" + SEP + "%D"]);
    if (!r.ok || !r.stdout) return [];
    return r.stdout.split("\n").filter(Boolean).map((line) => {
      const parts = line.split(SEP);
      return { hash: parts[0] || "", author: parts[1] || "", date: parts[2] || "", subject: parts[3] || "", refs: parts[4] || "" };
    });
  }

  // 把单个文件还原到某提交的版本（右键「将文件还原到此版本」）。改动落到工作区，
  // 不自动提交——用户可在源代码管理里查看/再提交。
  async restoreFile(cwd: string, commit: string, file: string): Promise<{ ok: boolean; error?: string }> {
    const r = await git(cwd, ["checkout", commit, "--", file]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr || r.stdout };
  }

  // 单个文件的提交历史（右键「查看文件历史」）。
  async fileHistory(cwd: string, file: string, limit = 50): Promise<Array<{ hash: string; author: string; date: string; subject: string }>> {
    const SEP = "\x1f";
    const r = await git(cwd, ["log", "-n", String(limit), "--pretty=format:%h" + SEP + "%an" + SEP + "%ar" + SEP + "%s", "--", file]);
    if (!r.ok || !r.stdout) return [];
    return r.stdout.split("\n").filter(Boolean).map((line) => {
      const parts = line.split(SEP);
      return { hash: parts[0] || "", author: parts[1] || "", date: parts[2] || "", subject: parts[3] || "" };
    });
  }

  // 分支列表 + 当前分支。
  async branches(cwd: string): Promise<{ current: string; all: string[] }> {
    const cur = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const r = await git(cwd, ["branch", "--format=%(refname:short)"]);
    const all = r.ok ? r.stdout.split("\n").map((s) => s.trim()).filter(Boolean) : [];
    return { current: cur.stdout.trim(), all };
  }

  async checkout(cwd: string, branch: string): Promise<{ ok: boolean; error?: string }> {
    const r = await git(cwd, ["checkout", branch]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr };
  }

  async createBranch(cwd: string, name: string): Promise<{ ok: boolean; error?: string }> {
    const r = await git(cwd, ["checkout", "-b", name]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr };
  }

  async push(cwd: string): Promise<{ ok: boolean; error?: string }> {
    // 已登录 GitHub 时注入 OAuth token 鉴权（http.extraheader），免去系统凭据配置。
    const remote = await git(cwd, ["remote", "get-url", "origin"]);
    const auth = await githubAuthConfigArgs(remote.stdout.trim());
    // 先直接 push；若因当前分支无 upstream 失败，则自动 -u origin <branch>（首次推送）。
    let r = await git(cwd, [...auth, "push"], 60000);
    if (!r.ok && /no upstream|set-upstream|has no upstream/i.test(r.stderr + r.stdout)) {
      const cur = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const branch = cur.stdout.trim();
      if (branch) r = await git(cwd, [...auth, "push", "-u", "origin", branch], 60000);
    }
    if (!r.ok && /'origin' does not appear|No configured push destination|does not appear to be a git repo/i.test(r.stderr + r.stdout)) {
      return { ok: false, error: "没有配置远程仓库 origin。先添加远程：git remote add origin <url>" };
    }
    return r.ok ? { ok: true } : { ok: false, error: r.stderr || r.stdout };
  }

  async pull(cwd: string): Promise<{ ok: boolean; error?: string }> {
    const remote = await git(cwd, ["remote", "get-url", "origin"]);
    const auth = await githubAuthConfigArgs(remote.stdout.trim());
    const r = await git(cwd, [...auth, "pull", "--ff-only"], 60000);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr || r.stdout };
  }

  // git init（在非仓库目录里初始化）。
  async init(cwd: string): Promise<{ ok: boolean; error?: string }> {
    if (!cwd || !existsSync(cwd)) return { ok: false, error: "目录不存在" };
    const r = await git(cwd, ["init"]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr };
  }

  // ---- 提交级操作（提交历史右键菜单用）----

  // revert：生成一个撤销该提交的新提交（不改写历史，安全）。
  async revert(cwd: string, commit: string): Promise<{ ok: boolean; error?: string }> {
    const r = await git(cwd, ["revert", "--no-edit", commit]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr || r.stdout };
  }

  // cherry-pick：把某提交应用到当前分支。
  async cherryPick(cwd: string, commit: string): Promise<{ ok: boolean; error?: string }> {
    const r = await git(cwd, ["cherry-pick", commit]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr || r.stdout };
  }

  // reset：把当前分支移动到某提交。mode = soft（保留改动于暂存区）/ mixed（保留改动于工作区）/ hard（丢弃）。
  async reset(cwd: string, commit: string, mode: "soft" | "mixed" | "hard"): Promise<{ ok: boolean; error?: string }> {
    const flag = mode === "soft" ? "--soft" : mode === "hard" ? "--hard" : "--mixed";
    const r = await git(cwd, ["reset", flag, commit]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr || r.stdout };
  }

  // 基于某提交创建并切换到新分支。
  async createBranchAt(cwd: string, name: string, commit: string): Promise<{ ok: boolean; error?: string }> {
    const r = await git(cwd, ["checkout", "-b", name, commit]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr };
  }

  // 检出某提交（分离头指针），用于查看历史状态。
  async checkoutCommit(cwd: string, commit: string): Promise<{ ok: boolean; error?: string }> {
    const r = await git(cwd, ["checkout", commit]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr };
  }

  // 某提交相对其父的 diff（右键「查看改动」）。
  async commitDiff(cwd: string, commit: string): Promise<string> {
    const r = await git(cwd, ["show", commit, "--patch", "--format=%H%n%an <%ae>%n%ad%n%n%s%n%n%b"]);
    return r.stdout || r.stderr || "";
  }

  // ---- Pull Request（复用 GitHub 官方 gh CLI）----

  // gh 是否可用 + 是否已登录。未装/未登录给可操作提示。
  async ghStatus(cwd: string): Promise<{ installed: boolean; authed: boolean; message?: string }> {
    const ver = await ghCmd(cwd, ["--version"], 8000);
    if (!ver.ok && /ENOENT|not found|不是内部或外部命令/i.test(ver.stderr)) {
      return { installed: false, authed: false, message: "未安装 GitHub CLI（gh）。安装：https://cli.github.com/" };
    }
    if (!ver.ok) return { installed: false, authed: false, message: ver.stderr || "gh 不可用" };
    const auth = await ghCmd(cwd, ["auth", "status"], 12000);
    if (!auth.ok) return { installed: true, authed: false, message: "GitHub CLI 未登录。运行：gh auth login" };
    return { installed: true, authed: true };
  }

  // 创建 PR。优先用 OAuth token 走 GitHub REST API（无需 gh CLI）；未登录则回退
  // gh CLI（保持原行为）。base 可空（用仓库默认分支）。返回 PR url。
  async createPullRequest(cwd: string, opts: { title: string; body?: string; base?: string; draft?: boolean }): Promise<{ ok: boolean; url?: string; error?: string }> {
    const remote = await git(cwd, ["remote", "get-url", "origin"]);
    const remoteUrl = remote.stdout.trim();
    const token = githubTokenProvider ? await githubTokenProvider() : "";

    // 已登录 + GitHub 远程：走 REST API，全程不需要 gh。
    if (token && /github\.com/i.test(remoteUrl)) {
      const slug = parseGithubSlug(remoteUrl);
      if (!slug) return { ok: false, error: "无法解析 GitHub 仓库地址：" + remoteUrl };
      // 先推送当前分支（PR 需要远程已有该分支）。
      const pushed = await this.push(cwd);
      if (!pushed.ok) return { ok: false, error: "推送当前分支失败：" + (pushed.error || "") };
      const cur = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const head = cur.stdout.trim();
      // base 缺省：查仓库默认分支。
      let base = opts.base;
      if (!base) {
        const repoInfo = await githubApi(token, "GET", "/repos/" + slug, null);
        base = (repoInfo && repoInfo.default_branch) || "main";
      }
      const pr = await githubApi(token, "POST", "/repos/" + slug + "/pulls", {
        title: opts.title || "Update",
        body: opts.body || "",
        head,
        base,
        draft: !!opts.draft,
      });
      if (pr && pr.html_url) return { ok: true, url: pr.html_url };
      // 已存在 PR：GitHub 返回 422，尝试取出已有 PR 链接。
      const msg = pr && pr.errors && pr.errors[0] && pr.errors[0].message;
      if (pr && /already exist/i.test(JSON.stringify(pr.errors || pr.message || ""))) {
        const list = await githubApi(token, "GET", "/repos/" + slug + "/pulls?head=" + encodeURIComponent(slug.split("/")[0] + ":" + head), null);
        const url = Array.isArray(list) && list[0] && list[0].html_url;
        return { ok: true, url: url || undefined, error: url ? undefined : "该分支已存在 PR" };
      }
      return { ok: false, error: msg || (pr && pr.message) || "创建 PR 失败" };
    }

    // 未登录：回退 gh CLI。
    const st = await this.ghStatus(cwd);
    if (!st.installed || !st.authed) return { ok: false, error: st.message };
    // 确保当前分支已推送（gh pr create 需要远程分支）。
    const pushed = await this.push(cwd);
    if (!pushed.ok) return { ok: false, error: "推送当前分支失败：" + (pushed.error || "") };
    const args = ["pr", "create", "--title", opts.title || "Update", "--body", opts.body || ""];
    if (opts.base) { args.push("--base", opts.base); }
    if (opts.draft) { args.push("--draft"); }
    const r = await ghCmd(cwd, args, 60000);
    if (!r.ok) {
      // 已存在 PR 时 gh 会报错；退一步用 --web 打开。
      if (/already exists/i.test(r.stderr)) {
        await ghCmd(cwd, ["pr", "view", "--web"], 15000);
        return { ok: true, url: undefined, error: "该分支已存在 PR，已在浏览器打开。" };
      }
      return { ok: false, error: r.stderr || r.stdout };
    }
    // gh 在 stdout 输出 PR url。
    const url = (r.stdout.match(/https?:\/\/\S+/) || [])[0];
    return { ok: true, url };
  }

  // 在浏览器打开当前分支的 PR（已存在则查看，否则打开新建页）。
  async openPullRequest(cwd: string): Promise<{ ok: boolean; error?: string }> {
    const st = await this.ghStatus(cwd);
    if (!st.installed || !st.authed) return { ok: false, error: st.message };
    let r = await ghCmd(cwd, ["pr", "view", "--web"], 15000);
    if (!r.ok) r = await ghCmd(cwd, ["pr", "create", "--web"], 15000);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr || r.stdout };
  }

  // 远程信息（UI 判断是否显示 PR 按钮：有 origin 才显示）。
  async remoteInfo(cwd: string): Promise<{ hasOrigin: boolean; url: string }> {
    const r = await git(cwd, ["remote", "get-url", "origin"]);
    return { hasOrigin: r.ok && !!r.stdout.trim(), url: r.stdout.trim() };
  }

  // 添加/更新 origin 远程（UI 在没有远程时引导填写）。已存在则 set-url。
  async setRemote(cwd: string, url: string): Promise<{ ok: boolean; error?: string }> {
    if (!url || !url.trim()) return { ok: false, error: "URL 为空" };
    const has = await git(cwd, ["remote", "get-url", "origin"]);
    const r = has.ok
      ? await git(cwd, ["remote", "set-url", "origin", url.trim()])
      : await git(cwd, ["remote", "add", "origin", url.trim()]);
    return r.ok ? { ok: true } : { ok: false, error: r.stderr };
  }
}

// gh CLI 调用（与 git() 同形态，单独函数因命令名不同）。
function ghCmd(cwd: string, args: string[], timeout = 20000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("gh", args, { cwd, timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err: any, stdout, stderr) => {
      if (err) resolve({ ok: false, stdout: String(stdout || ""), stderr: String(stderr || err.message || "") });
      else resolve({ ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

// git diff --no-index 的 /dev/null 等价物（跨平台）。
function devNull(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

// 从 origin URL 解析 "owner/repo"（支持 https 和 ssh 形态，去掉 .git 后缀）。
function parseGithubSlug(url: string): string | null {
  if (!url) return null;
  // https://github.com/owner/repo(.git)  或  git@github.com:owner/repo(.git)
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:\/)?$/i);
  if (!m) return null;
  return m[1] + "/" + m[2];
}

// 调 GitHub REST API（api.github.com）。token 用 Bearer。body 为 null 表示无请求体。
function githubApi(token: string, method: string, path: string, body: any): Promise<any> {
  const payload = body == null ? "" : JSON.stringify(body);
  return new Promise((resolve) => {
    const { request: httpsReq } = require("https");
    const req = httpsReq(
      {
        host: "api.github.com",
        path,
        method,
        headers: {
          Authorization: "Bearer " + token,
          Accept: "application/vnd.github+json",
          "User-Agent": "UE Coworker",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res: any) => {
        let data = "";
        res.on("data", (c: any) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data || "{}")); }
          catch { resolve({ message: data.slice(0, 200) }); }
        });
      }
    );
    req.on("error", (e: any) => resolve({ message: String(e && e.message || e) }));
    if (payload) req.write(payload);
    req.end();
  });
}

export const gitManager = new GitManager();
