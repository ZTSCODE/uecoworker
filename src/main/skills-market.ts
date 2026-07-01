// Skill 市场:聚合多个公开 skill 目录站的 JSON API + 精选 GitHub 仓库,搜索并一键
// 下载 Agent Skill 到 .claude/skills/。
//
// 数据源(全部免费、无需 key):
//  1) claudemarketplaces.com/api/skills —— 海量(2w+ 条),含 repo/path/stars/installs。
//     注意:其 q/page/limit 参数被忽略,一次性返回全量(~11MB),故主进程整体缓存,
//     搜索/分页在本地做。其 path 不一定等于仓库内真实路径(如 anthropics/skills 的
//     frontend-design 实际在 skills/frontend-design),所以安装时再去仓库 trees 定位。
//  2) skillsllm.com/api/skills —— 精选(数十条),含 topics/language/readme。
//  3) 内置精选 GitHub 仓库 —— 离线兜底,API 全挂时仍可用。
//
// 安装:用 GitHub git/trees(匿名 60 次/时)在目标仓库定位 <...>/<name>/SKILL.md,
// 把该 skill 目录下全部文件经 raw.githubusercontent 下载到 .claude/skills/<name>/。
// 装完即可被 skills-manager 扫描/启用(同一套 .claude/skills 约定)。

import { join } from "path";
import { homedir } from "os";
import { mkdir, writeFile, rm, rename } from "fs/promises";
import { existsSync } from "fs";
import * as yaml from "js-yaml";

// 内置精选仓库(离线兜底 + 保证 anthropics 官方始终在列)。
interface SkillRepo { owner: string; repo: string; branch: string; label: string; }
const FALLBACK_REPOS: SkillRepo[] = [
  { owner: "anthropics", repo: "skills", branch: "main", label: "anthropics/skills" },
];

export interface SkillMarketItem {
  id: string;               // 全局唯一(优先 repo:path)
  name: string;             // 安装后的目录名
  description: string;
  author: string;           // 仓库 owner
  repo: string;             // owner/repo
  repoUrl: string;          // 仓库链接
  skillUrl: string;         // skill / 仓库页链接
  source: string;           // 来源站点标签
  stars?: number;
  installs?: number;
  branch?: string;          // 已知则带,否则安装时探测默认分支
}

const UA = { "User-Agent": "UE-Coworker", Accept: "application/vnd.github+json" };

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export class SkillsMarket {
  // 聚合后的全量条目缓存(避免反复拉 11MB 与触发限流)。
  private cache: { at: number; items: SkillMarketItem[] } | null = null;
  private CACHE_MS = 10 * 60 * 1000;
  // 按 id 索引,安装时快速定位。
  private byId = new Map<string, SkillMarketItem>();

  /** 搜索:返回匹配 name/description/author 的条目;query 空时返回按 stars 排序的前 N。 */
  async search(query?: string, limit = 80): Promise<SkillMarketItem[]> {
    const all = await this.loadAll();
    const q = (query || "").trim().toLowerCase();
    let rows = all;
    if (q) {
      rows = all.filter((it) =>
        it.name.toLowerCase().indexOf(q) !== -1 ||
        it.description.toLowerCase().indexOf(q) !== -1 ||
        it.author.toLowerCase().indexOf(q) !== -1);
    }
    // 排序:有搜索时仍按热度(stars→installs)优先,空搜索同理。
    rows = rows.slice().sort((a, b) => (b.stars || 0) - (a.stars || 0) || (b.installs || 0) - (a.installs || 0));
    return rows.slice(0, limit);
  }

  // 拉取并聚合所有源,去重(同 repo+name 视为同一)。
  private async loadAll(): Promise<SkillMarketItem[]> {
    if (this.cache && Date.now() - this.cache.at < this.CACHE_MS) return this.cache.items;

    const merged = new Map<string, SkillMarketItem>(); // key: repo|name(小写)
    const add = (it: SkillMarketItem) => {
      const key = (it.repo + "|" + it.name).toLowerCase();
      const prev = merged.get(key);
      if (!prev) { merged.set(key, it); return; }
      // 合并:补全缺失字段,数值取较大。
      merged.set(key, {
        ...prev,
        description: prev.description || it.description,
        stars: Math.max(prev.stars || 0, it.stars || 0) || undefined,
        installs: Math.max(prev.installs || 0, it.installs || 0) || undefined,
      });
    };

    const sources = await Promise.allSettled([
      this.fromClaudeMarketplaces(),
      this.fromSkillsLLM(),
    ]);
    let any = false;
    for (const s of sources) {
      if (s.status === "fulfilled") { any = true; s.value.forEach(add); }
    }
    // 任一源成功就够;全失败则用内置精选兜底。
    if (!any) {
      try { (await this.fromFallbackRepos()).forEach(add); } catch { /* ignore */ }
    }

    const items = Array.from(merged.values());
    this.cache = { at: Date.now(), items };
    this.byId = new Map(items.map((it) => [it.id, it]));
    return items;
  }

  // 源 1:claudemarketplaces(海量)。
  private async fromClaudeMarketplaces(): Promise<SkillMarketItem[]> {
    const res = await withTimeout(fetch("https://claudemarketplaces.com/api/skills", { headers: { "User-Agent": "UE-Coworker" } }), 25000, "claudemarketplaces timed out");
    if (!res.ok) throw new Error("claudemarketplaces " + res.status);
    const arr = (await res.json()) as any[];
    if (!Array.isArray(arr)) return [];
    const out: SkillMarketItem[] = [];
    for (const x of arr) {
      const repo = String(x?.repo || "");
      const name = String(x?.name || "");
      if (!repo || !name || x?.listingStatus === "hidden") continue;
      const owner = repo.split("/")[0] || "";
      out.push({
        id: String(x.id || repo + ":" + name),
        name, description: String(x.description || ""),
        author: owner, repo,
        repoUrl: "https://github.com/" + repo,
        skillUrl: "https://claudemarketplaces.com/skills/" + (x.repoSlug ? x.repoSlug + "/" + name : name),
        source: "claudemarketplaces",
        stars: typeof x.stars === "number" ? x.stars : undefined,
        installs: typeof x.installs === "number" ? x.installs : undefined,
      });
    }
    return out;
  }

  // 源 2:skillsllm(精选)。
  private async fromSkillsLLM(): Promise<SkillMarketItem[]> {
    const res = await withTimeout(fetch("https://skillsllm.com/api/skills", { headers: { "User-Agent": "UE-Coworker" } }), 20000, "skillsllm timed out");
    if (!res.ok) throw new Error("skillsllm " + res.status);
    const json: any = await res.json();
    const arr: any[] = Array.isArray(json?.skills) ? json.skills : [];
    const out: SkillMarketItem[] = [];
    for (const x of arr) {
      const owner = String(x?.repoOwner || "");
      const repoName = String(x?.repoName || "");
      const name = String(x?.name || x?.slug || "");
      if (!owner || !repoName || !name) continue;
      const repo = owner + "/" + repoName;
      out.push({
        id: String(x.id || repo + ":" + name),
        name, description: String(x.description || ""),
        author: owner, repo,
        repoUrl: String(x.repoUrl || "https://github.com/" + repo),
        skillUrl: String(x.repoUrl || "https://github.com/" + repo),
        source: "skillsllm",
        stars: typeof x.stars === "number" ? x.stars : undefined,
      });
    }
    return out;
  }

  // 兜底:内置精选仓库,用 GitHub trees 列出 SKILL.md。
  private async fromFallbackRepos(): Promise<SkillMarketItem[]> {
    const out: SkillMarketItem[] = [];
    for (const r of FALLBACK_REPOS) {
      const paths = await this.listSkillMdPaths(r.owner, r.repo, r.branch);
      for (const p of paths) {
        const dir = p.slice(0, -"/SKILL.md".length);
        const name = dir.split("/").pop() || dir;
        let description = "";
        try { description = await this.readDescription(r.owner, r.repo, r.branch, p); } catch { /* ignore */ }
        out.push({
          id: r.owner + "/" + r.repo + ":" + dir,
          name, description, author: r.owner, repo: r.owner + "/" + r.repo,
          repoUrl: "https://github.com/" + r.owner + "/" + r.repo,
          skillUrl: "https://github.com/" + r.owner + "/" + r.repo + "/tree/" + r.branch + "/" + dir,
          source: r.label, branch: r.branch,
        });
      }
    }
    return out;
  }

  // ---- GitHub 辅助 ----

  private async defaultBranch(owner: string, repo: string): Promise<string> {
    try {
      const res = await withTimeout(fetch("https://api.github.com/repos/" + owner + "/" + repo, { headers: UA }), 12000, "repo meta timed out");
      if (res.ok) { const j: any = await res.json(); if (j?.default_branch) return String(j.default_branch); }
    } catch { /* ignore */ }
    return "main";
  }

  // 列出仓库内全部 .../SKILL.md 路径。
  private async listSkillMdPaths(owner: string, repo: string, branch: string): Promise<string[]> {
    const url = "https://api.github.com/repos/" + owner + "/" + repo + "/git/trees/" + branch + "?recursive=1";
    const res = await withTimeout(fetch(url, { headers: UA }), 15000, "github tree timed out");
    if (!res.ok) throw new Error("github tree " + res.status);
    const json: any = await res.json();
    const tree: any[] = Array.isArray(json?.tree) ? json.tree : [];
    return tree.filter((n) => n.type === "blob" && typeof n.path === "string" && n.path.endsWith("/SKILL.md"))
      .map((n) => n.path as string);
  }

  private async readDescription(owner: string, repo: string, branch: string, path: string): Promise<string> {
    const raw = await this.rawFile(owner, repo, branch, path);
    const m = /^\s*---\s*\n([\s\S]*?)\n---\s*(\n|$)/.exec(raw);
    if (!m) return "";
    const fm: any = yaml.load(m[1]);
    return fm && typeof fm.description === "string" ? fm.description.trim() : "";
  }

  private async rawFile(owner: string, repo: string, branch: string, path: string): Promise<string> {
    const url = "https://raw.githubusercontent.com/" + owner + "/" + repo + "/" + branch + "/" + encodeURI(path);
    const res = await withTimeout(fetch(url, { headers: { "User-Agent": "UE-Coworker" } }), 15000, "raw fetch timed out");
    if (!res.ok) throw new Error("raw " + res.status + " " + path);
    return res.text();
  }

  /**
   * 安装一个 skill:在其仓库内定位 <...>/<name>/SKILL.md,把该目录全部文件下载到
   * 目标 skills 目录的 <name>/ 下。scope=project 装项目级,否则全局。
   */
  async install(id: string, scope: "project" | "global", projectPath?: string): Promise<{ ok: boolean; dir?: string; error?: string }> {
    let item = this.byId.get(id);
    if (!item) { await this.loadAll(); item = this.byId.get(id); }
    if (!item) return { ok: false, error: "未找到该 skill,请刷新后重试" };

    const [owner, repoName] = item.repo.split("/");
    if (!owner || !repoName) return { ok: false, error: "仓库信息无效:" + item.repo };
    const branch = item.branch || await this.defaultBranch(owner, repoName);

    // 在仓库内按目录名定位真实的 SKILL.md 路径(API 的 path 可能不含 skills/ 前缀)。
    let skillDir: string;
    try {
      const paths = await this.listSkillMdPaths(owner, repoName, branch);
      const wantName = item.name.toLowerCase();
      // 优先「目录名恰为 name」,否则路径里含 name 的第一个。
      const exact = paths.find((p) => {
        const d = p.slice(0, -"/SKILL.md".length);
        return (d.split("/").pop() || "").toLowerCase() === wantName;
      });
      const loose = exact || paths.find((p) => p.toLowerCase().indexOf("/" + wantName + "/") !== -1);
      const chosen = loose || (paths.length === 1 ? paths[0] : undefined);
      if (!chosen) return { ok: false, error: "在仓库中未找到该 skill 的 SKILL.md" };
      skillDir = chosen.slice(0, -"/SKILL.md".length);
    } catch (e: any) {
      return { ok: false, error: "定位 skill 失败:" + (e?.message || e) };
    }

    const root = scope === "project" && projectPath
      ? join(projectPath, ".claude", "skills")
      : join(homedir(), ".claude", "skills");
    const destDir = join(root, item.name);
    // 已存在的处理:有 SKILL.md 视为真已安装,拒绝覆盖;否则(空壳/半成品残骸)清掉重装。
    if (existsSync(destDir)) {
      if (existsSync(join(destDir, "SKILL.md"))) return { ok: false, error: "已存在同名 skill:" + item.name };
      try { await rm(destDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    // 列出该 skill 目录下全部 blob。
    let files: string[];
    try {
      const url = "https://api.github.com/repos/" + owner + "/" + repoName + "/git/trees/" + branch + "?recursive=1";
      const res = await withTimeout(fetch(url, { headers: UA }), 15000, "github tree timed out");
      if (!res.ok) return { ok: false, error: "GitHub 树读取失败(" + res.status + ")" + (res.status === 403 ? "——可能触发匿名限流(60次/时),稍后再试" : "") };
      const json: any = await res.json();
      const tree: any[] = Array.isArray(json?.tree) ? json.tree : [];
      const prefix = skillDir + "/";
      files = tree.filter((n) => n.type === "blob" && typeof n.path === "string" && n.path.startsWith(prefix))
        .map((n) => n.path as string);
    } catch (e: any) {
      return { ok: false, error: "列文件失败:" + (e?.message || e) };
    }
    if (files.length === 0) return { ok: false, error: "该 skill 目录为空" };
    // 完整性前置校验:目标 skill 目录必须含 SKILL.md,否则不是合法 skill。
    if (!files.some((f) => f.slice(skillDir.length + 1).toLowerCase() === "skill.md")) {
      return { ok: false, error: "该目录不含 SKILL.md,不是合法 skill" };
    }

    // 原子安装:先全部下载到临时目录 <name>.<随机>.tmp,成功且校验通过后再 rename 到
    // 正式目录。这样即使下载中途 App 崩溃/断电,正式目录也永远「要么完整、要么不存在」,
    // 杜绝「有 SKILL.md 但缺其他文件」的半成品残骸。
    const tmpDir = join(root, item.name + "." + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + ".tmp");
    try {
      if (!existsSync(root)) await mkdir(root, { recursive: true });
      try { if (existsSync(tmpDir)) await rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      for (const f of files) {
        const rel = f.slice(skillDir.length + 1);
        const outPath = join(tmpDir, rel);
        const lastSlash = Math.max(outPath.lastIndexOf("/"), outPath.lastIndexOf("\\"));
        const dir = lastSlash > 0 ? outPath.slice(0, lastSlash) : tmpDir;
        if (dir && !existsSync(dir)) await mkdir(dir, { recursive: true });
        const content = await this.rawFile(owner, repoName, branch, f);
        await writeFile(outPath, content, "utf-8");
      }
      // 收尾校验:SKILL.md 必须真的落地。
      if (!existsSync(join(tmpDir, "SKILL.md"))) throw new Error("下载不完整:缺少 SKILL.md");
      // 原子提交:rename 临时目录到正式目录。万一此刻已被其它流程占用,清理并报错。
      if (existsSync(destDir)) {
        if (existsSync(join(destDir, "SKILL.md"))) { await rm(tmpDir, { recursive: true, force: true }); return { ok: false, error: "已存在同名 skill:" + item.name }; }
        await rm(destDir, { recursive: true, force: true });
      }
      await rename(tmpDir, destDir);
    } catch (e: any) {
      try { await rm(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      return { ok: false, error: "下载失败:" + (e?.message || e) };
    }
    return { ok: true, dir: destDir };
  }
}

export const skillsMarket = new SkillsMarket();
