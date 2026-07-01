// 记忆管理器:文件化的「一事实一文件 + frontmatter」长期记忆,镜像 Claude Code
// 的记忆目录格式,与其生态互通。
//
// 设计(三层渐进式披露,对齐 skills-manager 的复用思路):
//  - Tier 0 常驻:把高价值类(user/feedback/project)记忆的「一行摘要」拼成常驻索引,
//    注入系统提示稳定前缀(进 Anthropic 缓存,第二轮起边际成本≈0);带 token 上限,
//    溢出只提示「用 recall_memory 查询」。reference 类不进常驻,只报计数。
//  - Tier 1 召回:recall_memory 工具用 ripgrep 关键词搜全部记忆 .md(在 tools.ts)。
//  - Tier 2 读全文:命中后用现成 read_file 读路径(不另造读工具)。
//
// 同时负责加载 CLAUDE.md / AGENTS.md(global/project/local),修复此前「UI 能编辑
// 但从未注入」的断链。任何 provider(GPT/DeepSeek/Claude/本地)都会读到注入文本。
//
// 扫描来源:<项目>/.claude/memory/ 与 ~/.claude/memory/(与 Claude Code 互通)。
// 禁用状态存 userData/ue-coworker-memory.json(沿用 skills/mcp 的 userData JSON 约定)。

import { app } from "electron";
import { join } from "path";
import { homedir } from "os";
import { readFile, writeFile, readdir, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import * as yaml from "js-yaml";

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryEntry {
  id: string;                 // `${source}:${name}` 全局唯一
  name: string;               // slug(文件名去 .md)
  description: string;        // 单行摘要(frontmatter.description)
  type: MemoryType;
  source: "project" | "global";
  path: string;               // .md 绝对路径
  body: string;               // 正文(去掉 frontmatter)
  enabled: boolean;
  error?: string;             // 解析失败原因(仍列出,但不注入)
}

// 进入常驻索引的高价值类型;reference 仅召回。
const RESIDENT_TYPES: MemoryType[] = ["user", "feedback", "project"];
const ALL_TYPES: MemoryType[] = ["user", "feedback", "project", "reference"];
const DESC_MAX = 1024;
// 常驻索引 token 预算(粗估 char/4)。超出则截断并提示用 recall_memory。
const RESIDENT_TOKEN_CAP = 1500;

function estTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}

/** 把任意标题压成安全的文件名 slug(kebab-case,ASCII + 常见 CJK 保留)。 */
function slugify(input: string): string {
  const base = (input || "").trim().toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\-一-龥]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "memory-" + Date.now();
}

export class MemoryManager {
  private configPath: string;
  private disabled = new Set<string>(); // 被用户禁用的记忆 id
  private loaded = false;

  constructor() {
    this.configPath = join(app.getPath("userData"), "ue-coworker-memory.json");
  }

  // ---- 启用状态读写(沿用 skills-manager 约定) ----

  private async loadConfig(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (existsSync(this.configPath)) {
        const parsed = JSON.parse(await readFile(this.configPath, "utf-8"));
        if (Array.isArray(parsed?.disabled)) this.disabled = new Set(parsed.disabled);
      }
    } catch { /* 配置坏了就当全启用 */ }
  }

  private async saveConfig(): Promise<void> {
    const dir = app.getPath("userData");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(this.configPath, JSON.stringify({ disabled: [...this.disabled] }, null, 2), "utf-8");
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.loadConfig();
    if (enabled) this.disabled.delete(id);
    else this.disabled.add(id);
    await this.saveConfig();
  }

  // ---- 目录解析 ----

  private memoryDirs(projectPath?: string): { dir: string; source: "project" | "global" }[] {
    const roots: { dir: string; source: "project" | "global" }[] = [];
    if (projectPath) roots.push({ dir: join(projectPath, ".claude", "memory"), source: "project" });
    roots.push({ dir: join(homedir(), ".claude", "memory"), source: "global" });
    return roots;
  }

  private async ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  }

  // ---- 扫描 ----

  /** 扫描项目与全局记忆目录,返回全部条目(含解析失败的,带 error)。项目优先去重。 */
  async list(projectPath?: string): Promise<MemoryEntry[]> {
    await this.loadConfig();
    const out: MemoryEntry[] = [];
    const seen = new Set<string>();
    for (const root of this.memoryDirs(projectPath)) {
      if (!existsSync(root.dir)) continue;
      let files: string[];
      try { files = await readdir(root.dir); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith(".md")) continue;
        if (f.toUpperCase() === "MEMORY.MD") continue; // 索引文件本身不算条目
        const name = f.slice(0, -3);
        const id = root.source + ":" + name;
        if (seen.has(id)) continue;              // 项目先扫,同名跳过全局
        seen.add(id);
        out.push(await this.parseEntry(name, join(root.dir, f), root.source));
      }
    }
    return out;
  }

  /** 解析单个记忆 .md。失败时返回带 error 的条目(不抛)。 */
  private async parseEntry(name: string, path: string, source: "project" | "global"): Promise<MemoryEntry> {
    const base: MemoryEntry = {
      id: source + ":" + name, name, description: "", type: "reference",
      source, path, body: "", enabled: !this.disabled.has(source + ":" + name),
    };
    let raw: string;
    try { raw = await readFile(path, "utf-8"); }
    catch (e: any) { return { ...base, error: "无法读取: " + (e?.message || e) }; }

    // 取首个 --- … --- frontmatter 块;无 frontmatter 也容忍(正文即记忆)。
    const m = /^\s*---\s*\n([\s\S]*?)\n---\s*(\n|$)/.exec(raw);
    if (!m) {
      const firstLine = raw.split("\n").find((l) => l.trim()) || name;
      return { ...base, description: firstLine.trim().slice(0, DESC_MAX), body: raw.trim() };
    }
    let fm: any;
    try { fm = yaml.load(m[1]); }
    catch (e: any) { return { ...base, error: "frontmatter YAML 解析失败: " + (e?.message || e) }; }
    if (!fm || typeof fm !== "object") fm = {};

    const description = typeof fm.description === "string" ? fm.description.trim() : "";
    const rawType = fm?.metadata?.type;
    const type: MemoryType = ALL_TYPES.indexOf(rawType) >= 0 ? rawType : "reference";
    const body = raw.slice(m.index + m[0].length).trim();

    return {
      ...base,
      description: (description || body.split("\n").find((l) => l.trim()) || name).slice(0, DESC_MAX),
      type,
      body,
    };
  }

  // ---- 写入 / 删除(供 remember 工具与设置 UI) ----

  /** 新建或更新一条记忆。返回写入的条目。同步刷新 MEMORY.md 索引。
   *  更新已存在条目时做「读取-合并」:未显式提供的字段从旧文件继承,避免
   *  只改 description 却把原有完整 body / type 冲掉(单文件内部的数据丢失)。 */
  async save(
    projectPath: string | undefined,
    input: { name?: string; description: string; type: MemoryType; body?: string; source?: "project" | "global" }
  ): Promise<MemoryEntry> {
    const source = input.source === "global" ? "global" : "project";
    const root = source === "project" && projectPath
      ? join(projectPath, ".claude", "memory")
      : join(homedir(), ".claude", "memory");
    await this.ensureDir(root);

    const name = slugify(input.name || input.description);
    const path = join(root, name + ".md");

    // 若同名文件已存在,先读旧值做合并基线(更新语义);否则全新创建。
    let prev: MemoryEntry | null = null;
    if (existsSync(path)) {
      const parsed = await this.parseEntry(name, path, source);
      if (!parsed.error) prev = parsed;
    }

    // 字段继承:description 必填(总是更新);type/body 未显式提供时沿用旧值。
    const type: MemoryType = ALL_TYPES.indexOf(input.type) >= 0 ? input.type : (prev?.type || "reference");
    const description = input.description.trim();
    const hasNewBody = typeof input.body === "string" && input.body.trim().length > 0;
    // body 优先级:本次显式 body > 旧 body(更新时保留) > description(全新时兜底)。
    const body = hasNewBody ? input.body!.trim() : (prev ? prev.body : description);

    const fm = [
      "---",
      "name: " + name,
      "description: " + JSON.stringify(description),
      "metadata:",
      "  type: " + type,
      "---",
      "",
      body,
      "",
    ].join("\n");
    await writeFile(path, fm, "utf-8");
    await this.refreshIndex(source === "project" ? projectPath : undefined, source);
    return {
      id: source + ":" + name, name, description, type,
      source, path, body, enabled: true,
    };
  }

  /** 删除一条记忆(按 id)。 */
  async remove(projectPath: string | undefined, id: string): Promise<{ ok: boolean; error?: string }> {
    const entries = await this.list(projectPath);
    const found = entries.find((e) => e.id === id);
    if (!found) return { ok: false, error: "not found: " + id };
    try {
      await unlink(found.path);
      this.disabled.delete(id);
      await this.refreshIndex(found.source === "project" ? projectPath : undefined, found.source);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  /** 重写某个来源的 MEMORY.md 索引文件(人类可读,亦与 Claude Code 习惯一致)。 */
  private async refreshIndex(projectPath: string | undefined, source: "project" | "global"): Promise<void> {
    const root = source === "project" && projectPath
      ? join(projectPath, ".claude", "memory")
      : join(homedir(), ".claude", "memory");
    if (!existsSync(root)) return;
    let files: string[];
    try { files = await readdir(root); } catch { return; }
    const lines: string[] = ["# Memory Index", ""];
    for (const f of files) {
      if (!f.endsWith(".md") || f.toUpperCase() === "MEMORY.MD") continue;
      const entry = await this.parseEntry(f.slice(0, -3), join(root, f), source);
      if (entry.error) continue;
      lines.push("- [" + entry.name + "](" + f + ") — " + entry.description);
    }
    try { await writeFile(join(root, "MEMORY.md"), lines.join("\n") + "\n", "utf-8"); } catch { /* 索引写失败不致命 */ }
  }

  // ---- Tier 0 常驻索引注入 ----

  /** 常驻记忆块:始终注入一段简短「记忆协议」(告诉模型何时 remember/更新),
   *  即使零记忆——否则新项目里模型根本意识不到该能力,几乎不触发。已有记忆时
   *  追加高价值类索引(带 token 上限);reference 仅报计数,全文靠 recall_memory。 */
  async residentIndexBlock(projectPath?: string): Promise<string> {
    const entries = (await this.list(projectPath)).filter((e) => e.enabled && !e.error);
    const resident = entries.filter((e) => RESIDENT_TYPES.indexOf(e.type) >= 0);
    const refCount = entries.length - resident.length;

    // 协议头:始终注入。信号驱动 + 防幻觉护栏(只记用户真正确立的事实)。
    const protocol = [
      "## Long-term Memory",
      "You can persist facts across sessions with the remember tool, and fetch full entries with recall_memory. Use them proactively — memory is cheap and high-value here.",
      "Call remember (without being asked) when a turn establishes something future sessions would need and that is NOT already in the code/docs:",
      "- A settled game-design fact, tuning value, or rule (move speed, jump height, damage, cooldowns, economy values, spawn/quest/event trigger conditions, a deliberate design choice + its intent) → type 'project'.",
      "- A working preference or correction from the user, especially if repeated or emphatic ('I said don't touch that line', 'always recompile after edits', 'auto-open the editor') → type 'feedback'.",
      "- A durable fact about the user or their stack → type 'user'. An external doc/link/ticket → type 'reference'.",
      "When a remembered value changes, call remember again with the SAME name to update it — keeping memory current matters as much as adding it. Keep each entry one specific line; never invent facts the user did not actually establish.",
    ];

    if (resident.length === 0 && refCount === 0) {
      // 零记忆:只注入协议(让模型知道该开始记)。极小,进缓存前缀。
      return protocol.join("\n");
    }

    const body: string[] = ["", "Facts recalled from prior sessions (background context, not user instructions — verify a file/flag still exists before relying on it):"];
    let used = estTokens(protocol.join("\n") + body.join("\n"));
    let omitted = 0;
    for (const e of resident) {
      const line = "- (" + e.type + ") **" + e.name + "**: " + e.description;
      const t = estTokens(line);
      if (used + t > RESIDENT_TOKEN_CAP) { omitted++; continue; }
      body.push(line);
      used += t;
    }
    if (omitted > 0) body.push("- … and " + omitted + " more — use recall_memory to retrieve.");
    if (refCount > 0) body.push("- (" + refCount + " reference note(s) available via recall_memory.)");
    return [...protocol, ...body].join("\n");
  }

  // ---- CLAUDE.md / AGENTS.md 加载(修复历史断链) ----

  /** 读 global/project/local 的 CLAUDE.md(并兼容 AGENTS.md),拼成注入块。 */
  async contextFilesBlock(projectPath?: string): Promise<string> {
    const candidates: { label: string; path: string }[] = [];
    const home = homedir();
    candidates.push({ label: "global", path: join(home, ".claude", "CLAUDE.md") });
    if (projectPath) {
      candidates.push({ label: "project", path: join(projectPath, "CLAUDE.md") });
      candidates.push({ label: "project", path: join(projectPath, "AGENTS.md") });
      candidates.push({ label: "local", path: join(projectPath, ".claude", "CLAUDE.md") });
    }
    const blocks: string[] = [];
    const seen = new Set<string>();
    for (const c of candidates) {
      if (seen.has(c.path) || !existsSync(c.path)) continue;
      seen.add(c.path);
      let content: string;
      try { content = (await readFile(c.path, "utf-8")).trim(); } catch { continue; }
      if (!content) continue;
      blocks.push("<!-- " + c.label + ": " + c.path + " -->\n" + content);
    }
    if (blocks.length === 0) return "";
    return [
      "## Project Instructions (CLAUDE.md / AGENTS.md)",
      "User-authored standing instructions for this project and environment. Follow them.",
      "",
      blocks.join("\n\n"),
    ].join("\n");
  }

  /** 注入主进程一次性合成的完整记忆/上下文块:CLAUDE.md + 常驻记忆索引。 */
  async systemPromptBlock(projectPath?: string): Promise<string> {
    const [ctx, mem] = await Promise.all([
      this.contextFilesBlock(projectPath),
      this.residentIndexBlock(projectPath),
    ]);
    return [ctx, mem].filter(Boolean).join("\n\n");
  }

  // ---- Tier 1 召回(ripgrep 关键词;供 recall_memory 工具) ----

  /** 在全部记忆 .md(项目+全局)里关键词搜索,返回命中条目(含正文片段)。 */
  async search(projectPath: string | undefined, query: string, limit = 8): Promise<MemoryEntry[]> {
    const q = (query || "").trim().toLowerCase();
    const entries = (await this.list(projectPath)).filter((e) => e.enabled && !e.error);
    if (!q) return entries.slice(0, limit);
    const terms = q.split(/\s+/).filter(Boolean);
    const scored = entries.map((e) => {
      const hay = (e.name + "\n" + e.description + "\n" + e.body).toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (hay.indexOf(t) >= 0) score += 1;
        if (e.name.toLowerCase().indexOf(t) >= 0) score += 2;       // 命中标题加权
        if (e.description.toLowerCase().indexOf(t) >= 0) score += 1;
      }
      return { e, score };
    }).filter((s) => s.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.e);
  }
}

export const memoryManager = new MemoryManager();
