// Agent Skills 管理器:扫描 `.claude/skills/` 加载 skill,按官方渐进式披露注入。
//
// 设计对齐 Anthropic Agent Skills(anthropics/skills):
//  - 每个 skill 是一个目录,内含 SKILL.md(YAML frontmatter + Markdown 正文)。
//  - frontmatter 必填 name(应等于目录名)、description(单行,决定何时触发);
//    可选 license / allowed-tools / metadata。
//  - 渐进式披露:启动只把 name+description+SKILL.md 绝对路径注入系统提示;模型
//    判断相关时用现成的 read_file 读绝对路径拿全文(第二层),不另造工具。
//
// 扫描来源:<项目>/.claude/skills/ 与 ~/.claude/skills/(与 Claude Code 生态互通)。
// 启用状态存 userData/ue-coworker-skills.json(沿用 mcp-manager 的 userData JSON 约定)。

import { app } from "electron";
import { join, relative, isAbsolute } from "path";
import { homedir } from "os";
import { readFile, writeFile, readdir, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import * as yaml from "js-yaml";

export interface SkillInfo {
  id: string;                       // `${source}:${relId}` 全局唯一（relId 含分类前缀）
  name: string;
  description: string;
  source: "project" | "global";
  category?: string;                // 分类目录名（分类结构下有；扁平结构无）
  dir: string;                      // skill 目录绝对路径
  skillMdPath: string;              // SKILL.md 绝对路径(注入给模型,供 read_file)
  enabled: boolean;
  license?: string;
  allowedTools?: string[];
  error?: string;                   // 解析/校验失败原因(仍列出,但不注入)
}

const DESC_MAX = 1024;

export class SkillsManager {
  private configPath: string;
  private disabled = new Set<string>(); // 被用户禁用的 skill id
  private loaded = false;

  constructor() {
    this.configPath = join(app.getPath("userData"), "ue-coworker-skills.json");
  }

  // ---- 启用状态读写 ----

  private async loadConfig(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (existsSync(this.configPath)) {
        const raw = await readFile(this.configPath, "utf-8");
        const parsed = JSON.parse(raw);
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

  /**
   * 删除一个 skill 的本地文件(整个目录)。安全起见只允许删 list() 扫出来的、且确实
   * 位于 .claude/skills 下的目录,避免传入越权路径误删。删后清掉其禁用态记录。
   */
  async remove(id: string, projectPath?: string): Promise<{ ok: boolean; error?: string }> {
    const skills = await this.list(projectPath);
    const target = skills.find((s) => s.id === id);
    if (!target) return { ok: false, error: "未找到该 skill:" + id };
    // 双保险:必须落在某个 .claude/skills 根目录内。
    const roots = [
      projectPath ? join(projectPath, ".claude", "skills") : "",
      join(homedir(), ".claude", "skills"),
    ].filter(Boolean);
    const inRoot = roots.some((r) => {
      const rel = relative(r, target.dir);
      return rel && !rel.startsWith("..") && !isAbsolute(rel);
    });
    if (!inRoot) return { ok: false, error: "路径越界,拒绝删除:" + target.dir };
    try {
      await rm(target.dir, { recursive: true, force: true });
    } catch (e: any) {
      return { ok: false, error: "删除失败:" + (e?.message || e) };
    }
    // 清掉禁用态记录(否则下次同名重装会沿用旧的 disabled 状态)。
    if (this.disabled.has(id)) { this.disabled.delete(id); await this.saveConfig(); }
    return { ok: true };
  }

  // ---- 扫描 ----

  /** 扫描项目与全局 skills 目录,返回全部 skill(含解析失败的,带 error)。 */
  async list(projectPath?: string): Promise<SkillInfo[]> {
    await this.loadConfig();
    const roots: { dir: string; source: "project" | "global" }[] = [];
    if (projectPath) roots.push({ dir: join(projectPath, ".claude", "skills"), source: "project" });
    roots.push({ dir: join(homedir(), ".claude", "skills"), source: "global" });

    const out: SkillInfo[] = [];
    const seen = new Set<string>();
    for (const root of roots) {
      if (!existsSync(root.dir)) continue;
      let entries: any[];
      try { entries = await readdir(root.dir, { withFileTypes: true }); } catch { continue; }
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const dir = join(root.dir, ent.name);
        if (existsSync(join(dir, "SKILL.md"))) {
          // 扁平结构：<root>/<skill>/SKILL.md（官方约定）。
          await this.collectSkill(out, seen, ent.name, ent.name, dir, root.source, undefined);
        } else {
          // 分类结构：<root>/<分类>/<skill>/SKILL.md。再扫一层子目录。
          let subs: any[];
          try { subs = await readdir(dir, { withFileTypes: true }); } catch { continue; }
          for (const sub of subs) {
            if (!sub.isDirectory()) continue;
            const skillDir = join(dir, sub.name);
            if (!existsSync(join(skillDir, "SKILL.md"))) continue;
            // id 带上分类前缀避免不同分类下同名 skill 撞 id；显示名仍用 skill 目录名。
            await this.collectSkill(out, seen, ent.name + "/" + sub.name, sub.name, skillDir, root.source, ent.name);
          }
        }
      }
    }
    return out;
  }

  /** 解析并收集一个 skill 到 out（去重）。relId=用于 id 的相对标识（可能含分类前缀），
   *  dirName=显示用的 skill 目录名，category=分类目录名（扁平结构为 undefined）。 */
  private async collectSkill(
    out: SkillInfo[], seen: Set<string>, relId: string, dirName: string,
    skillDir: string, source: "project" | "global", category?: string
  ): Promise<void> {
    const info = await this.parseSkill(relId, dirName, skillDir, join(skillDir, "SKILL.md"), source, category);
    if (seen.has(info.id)) return; // 项目优先：同 id 已存在则跳过全局同名。
    seen.add(info.id);
    out.push(info);
  }

  /** 解析单个 SKILL.md。失败时返回带 error 的 SkillInfo(不抛)。
   *  relId=用于 id 的相对标识(分类结构下含"分类/skill")，dirName=显示用 skill 目录名。 */
  private async parseSkill(
    relId: string, dirName: string, dir: string, skillMdPath: string, source: "project" | "global", category?: string
  ): Promise<SkillInfo> {
    const fullId = source + ":" + relId;
    const base: SkillInfo = {
      id: fullId, name: dirName, description: "",
      source, category, dir, skillMdPath, enabled: !this.disabled.has(fullId),
    };
    let raw: string;
    try { raw = await readFile(skillMdPath, "utf-8"); }
    catch (e: any) { return { ...base, error: "无法读取 SKILL.md: " + (e?.message || e) }; }

    // 取首个 --- … --- frontmatter 块。
    const m = /^\s*---\s*\n([\s\S]*?)\n---\s*(\n|$)/.exec(raw);
    if (!m) return { ...base, error: "缺少 YAML frontmatter(--- 包裹的头部)" };

    let fm: any;
    let lenientError = "";
    try { fm = yaml.load(m[1]); }
    catch (e: any) {
      // 严格 YAML 失败：很多第三方 skill 库的 description 是未加引号的多行纯量，里头含
      // "xxx: yyy"(冒号+空格)会被 YAML 误当成新映射键而报 bad indentation。回退到手动
      // 提取 name/description——能正确处理这种含冒号的多行折叠值。
      fm = this.lenientFrontmatter(m[1]);
      lenientError = "frontmatter YAML 不规范，已用容错方式解析(建议给 description 加引号): " + ((e?.message || e) + "").split("\n")[0];
    }
    if (!fm || typeof fm !== "object") return { ...base, error: "frontmatter 不是有效对象" };

    const name = typeof fm.name === "string" && fm.name.trim() ? fm.name.trim() : "";
    const description = typeof fm.description === "string" ? fm.description.trim() : "";
    if (!description) return { ...base, error: lenientError || "frontmatter 缺少必填字段 description" };

    // name 应等于目录名;不等时以目录名为准(官方约定),记 warning 但仍可用。
    const id = fullId;
    const allowedTools = Array.isArray(fm["allowed-tools"])
      ? fm["allowed-tools"].map((t: any) => String(t))
      : (typeof fm["allowed-tools"] === "string" ? [fm["allowed-tools"]] : undefined);

    // 容错解析成功时不当作致命错误(skill 仍可用)；name 与目录名不一致也只是 warning。
    let warn: string | undefined;
    if (name && name !== dirName) warn = "name(" + name + ") 与目录名(" + dirName + ")不一致,已以目录名为准";
    else if (lenientError) warn = "已以目录名为准: " + lenientError; // 前缀对齐 systemPromptBlock 的 warning 判定

    return {
      id, name: dirName, source, category, dir, skillMdPath,
      description: description.slice(0, DESC_MAX),
      enabled: !this.disabled.has(id),
      license: typeof fm.license === "string" ? fm.license : undefined,
      allowedTools,
      error: warn,
    };
  }

  /** 容错提取 frontmatter 的 name / description（YAML 严格解析失败时的兜底）。
   *  按 "key: value" 起头、后续更深缩进行视为该值的续行(YAML 折叠语义，换行→空格)，
   *  正确处理 description 里含 "xxx: yyy" 冒号的多行纯量。仅抽取顶层标量键。 */
  private lenientFrontmatter(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    const lines = text.replace(/\r/g, "").split("\n");
    let curKey = "";
    let curVal: string[] = [];
    const flush = () => {
      if (curKey) {
        let v = curVal.join(" ").trim();
        // 去掉包裹引号。
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        out[curKey] = v;
      }
      curKey = ""; curVal = [];
    };
    for (const line of lines) {
      // 顶层键(无前导空格)且形如 key: ...
      const top = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
      if (top && !/^\s/.test(line)) {
        flush();
        curKey = top[1];
        curVal = top[2] ? [top[2]] : [];
      } else if (curKey && /^\s+\S/.test(line)) {
        // 更深缩进的续行 → 当前值的折叠续行。
        curVal.push(line.trim());
      } else if (!line.trim()) {
        // 空行：折叠值里空行表示段落分隔，保留为空格即可（简单处理：忽略）。
      } else {
        // 其它(如 metadata: 下的子键)不是我们要的顶层标量，结束当前值。
        flush();
      }
    }
    flush();
    return out;
  }

  // ---- 注入 ----

  /** 已启用且无致命 error 的 skill 拼成系统提示注入块;无可用 skill 返回空串。
   *  渐进式披露：扁平 skill 给「name + 完整 description + 路径」；分类下的 skill 太多时
   *  按分类归组——分类给一句话摘要(读 category.md)，组内每个 skill 只列「name + 路径」，
   *  省常驻 token。无论哪种，模型相关时都 read_file 读 SKILL.md 全文再行动。 */
  async systemPromptBlock(projectPath?: string): Promise<string> {
    const skills = await this.list(projectPath);
    // name/description 不一致只是 warning(error 文本以"已以目录名为准"开头),仍可注入。
    const usable = skills.filter((s) => s.enabled && s.description &&
      (!s.error || s.error.indexOf("已以目录名为准") === 0));
    if (usable.length === 0) return "";

    const flat = usable.filter((s) => !s.category);
    const categorized = usable.filter((s) => s.category);

    const lines: string[] = [];
    // 扁平 skill：完整 description（判断力最好，数量通常少）。
    for (const s of flat) {
      lines.push("- **" + s.name + "** (" + s.source + "): " + s.description + " — `" + s.skillMdPath + "`");
    }
    // 分类 skill：按分类分组，组首一行分类摘要，组内 skill 仅 name + 路径。
    const byCat = new Map<string, SkillInfo[]>();
    for (const s of categorized) {
      const key = s.source + "/" + s.category;
      if (!byCat.has(key)) byCat.set(key, []);
      byCat.get(key)!.push(s);
    }
    for (const [, group] of byCat) {
      const first = group[0];
      const catSummary = await this.readCategorySummary(first);
      lines.push("");
      lines.push("### " + (first.category || "") + (catSummary ? " — " + catSummary : ""));
      for (const s of group) {
        lines.push("- **" + s.name + "** — `" + s.skillMdPath + "`");
      }
    }

    return [
      "## Available Skills",
      "The following skills are available. When one is relevant to the current task, FIRST use read_file to read its SKILL.md path below for full instructions, then act on them. Skills are grouped by category; use the category summary plus the skill name to judge relevance, then read the skill's SKILL.md for details.",
      ...lines,
    ].join("\n");
  }

  /** 读分类目录下 category.md 的首段作为分类摘要（一句话，截断）。无则返回空串。
   *  分类目录 = skill 目录的父目录。 */
  private async readCategorySummary(s: SkillInfo): Promise<string> {
    try {
      const catDir = join(s.dir, "..");
      const p = join(catDir, "category.md");
      if (!existsSync(p)) return "";
      const raw = await readFile(p, "utf-8");
      // 跳过 markdown 标题行，取首个非空正文段落，压成一行、截断。
      const body = raw.replace(/^#.*$/gm, "").replace(/\r/g, "").trim();
      const firstPara = body.split(/\n\s*\n/)[0] || "";
      const oneLine = firstPara.replace(/\s+/g, " ").trim();
      return oneLine.slice(0, 200);
    } catch { return ""; }
  }
}

export const skillsManager = new SkillsManager();
