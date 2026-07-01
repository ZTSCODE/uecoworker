// 检查点（快照回滚）——对标 Cline checkpoints：用一个「影子 git 仓库」记录工作区
// 状态，每次 agent 写文件后提交一次；用户可一键回滚到任意检查点。
//
// 关键设计（与 Cline 一致）：
//  - 影子 .git 放在 userData/checkpoints/<projectHash>，绝不污染用户自己的仓库。
//  - 用 `git --git-dir=<shadow> --work-tree=<project>` 把项目目录当工作区。
//  - 提交前临时屏蔽嵌套 .git（避免被当 submodule）；用 core.excludesFile 排除
//    node_modules/dist 等大目录。
//  - 回滚 = `checkout -f <commit> -- .` + 清理新增文件。

import { execFile } from "child_process";
import { app } from "electron";
import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { createHash } from "crypto";

export interface Checkpoint {
  id: string;        // commit hash
  message: string;   // 关联的操作描述（如 "edit_file src/x.ts"）
  timestamp: number;
  sessionId?: string;
}

function sh(args: string[], cwd: string, extraEnv?: Record<string, string>): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile("git", args, {
      cwd,
      timeout: 30000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, ...(extraEnv || {}) },
    }, (err: any, stdout, stderr) => {
      if (err) resolve({ ok: false, stdout: String(stdout || ""), stderr: String(stderr || err.message || "") });
      else resolve({ ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

export class CheckpointManager {
  // 项目路径 → 影子仓库目录。
  private shadowDirFor(projectPath: string): string {
    const hash = createHash("sha256").update(projectPath).digest("hex").slice(0, 16);
    return join(app.getPath("userData"), "checkpoints", hash);
  }

  // 在影子仓库上执行 git（指定 git-dir 与 work-tree）。
  private git(projectPath: string, shadowGit: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return sh(["--git-dir=" + shadowGit, "--work-tree=" + projectPath, ...args], projectPath);
  }

  // 确保影子仓库存在并初始化（含 excludes 文件）。返回 .git 目录路径。
  private async ensureShadow(projectPath: string): Promise<string | null> {
    if (!projectPath || !existsSync(projectPath)) return null;
    const base = this.shadowDirFor(projectPath);
    const shadowGit = join(base, ".git");
    if (!existsSync(base)) await mkdir(base, { recursive: true });

    if (!existsSync(shadowGit)) {
      const init = await this.git(projectPath, shadowGit, ["init"]);
      if (!init.ok) return null;
      // 基本身份（提交需要），仅作用于该影子仓库。
      await this.git(projectPath, shadowGit, ["config", "user.name", "ue-coworker"]);
      await this.git(projectPath, shadowGit, ["config", "user.email", "checkpoints@ue-coworker.local"]);
      await this.git(projectPath, shadowGit, ["config", "core.autocrlf", "false"]);
      // 排除大目录/常见忽略项。
      const excludes = join(base, "excludes");
      await writeFile(excludes, [
        "node_modules/", "dist/", "out/", "build/", ".next/", ".cache/",
        ".git/", "*.log", ".DS_Store", "coverage/", ".turbo/",
      ].join("\n"), "utf-8");
      await this.git(projectPath, shadowGit, ["config", "core.excludesFile", excludes]);
    }
    return shadowGit;
  }

  // 创建一个检查点：暂存全部工作区并提交。返回 commit。无改动时复用 HEAD。
  async snapshot(projectPath: string, message: string, sessionId?: string): Promise<Checkpoint | null> {
    const shadowGit = await this.ensureShadow(projectPath);
    if (!shadowGit) return null;

    await this.git(projectPath, shadowGit, ["add", "-A"]);
    // allow-empty：即使无改动也产生一个可回滚的点（首次快照尤其需要）。
    const commit = await this.git(projectPath, shadowGit, ["commit", "--allow-empty", "-m", message || "checkpoint"]);
    if (!commit.ok) return null;
    const head = await this.git(projectPath, shadowGit, ["rev-parse", "HEAD"]);
    if (!head.ok) return null;
    return { id: head.stdout.trim(), message: message || "checkpoint", timestamp: Date.now(), sessionId };
  }

  // 列出检查点（最近在前）。
  async list(projectPath: string, limit = 100): Promise<Checkpoint[]> {
    const base = this.shadowDirFor(projectPath);
    const shadowGit = join(base, ".git");
    if (!existsSync(shadowGit)) return [];
    const SEP = "\x1f";
    const r = await this.git(projectPath, shadowGit, ["log", "-n", String(limit), "--pretty=format:%H" + SEP + "%ct" + SEP + "%s"]);
    if (!r.ok || !r.stdout) return [];
    return r.stdout.split("\n").filter(Boolean).map((line) => {
      const p = line.split(SEP);
      return { id: p[0], timestamp: Number(p[1]) * 1000, message: p[2] || "checkpoint" } as Checkpoint;
    });
  }

  // 回滚工作区到指定检查点：强制还原所有跟踪文件，并删除该点之后新增的文件。
  async restore(projectPath: string, commit: string): Promise<{ ok: boolean; error?: string }> {
    const base = this.shadowDirFor(projectPath);
    const shadowGit = join(base, ".git");
    if (!existsSync(shadowGit)) return { ok: false, error: "没有检查点历史" };
    // 还原跟踪文件到该提交的内容。
    const co = await this.git(projectPath, shadowGit, ["checkout", "-f", commit, "--", "."]);
    if (!co.ok) return { ok: false, error: co.stderr };
    // 删除该提交里不存在、但当前工作区有的「已跟踪在更晚提交」的文件：用 read-tree+清理。
    // 简化稳健做法：把索引重置到该提交，再 clean 掉未跟踪文件（受 excludes 保护）。
    await this.git(projectPath, shadowGit, ["reset", "--hard", commit]);
    await this.git(projectPath, shadowGit, ["clean", "-fd"]);
    return { ok: true };
  }

  // 当前工作区相对某检查点的 diff（用于 UI 预览将回滚什么）。
  async diff(projectPath: string, commit: string): Promise<string> {
    const base = this.shadowDirFor(projectPath);
    const shadowGit = join(base, ".git");
    if (!existsSync(shadowGit)) return "";
    const r = await this.git(projectPath, shadowGit, ["diff", commit, "--"]);
    return r.stdout || "";
  }
}

export const checkpointManager = new CheckpointManager();
