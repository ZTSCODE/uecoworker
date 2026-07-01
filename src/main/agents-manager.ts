// 子 Agent(subagent)管理器:扫描 `.claude/agents/` 加载 agent 定义,供主 agent 经
// task 工具派发。设计对齐 Claude Code subagents 生态:
//
//  - 每个 agent 是一个 `.md` 文件(YAML frontmatter + Markdown 正文)。
//    frontmatter:name(派发标识)、description(决定主 agent 何时派发)、
//    tools(可选工具白名单,省略=继承父级全部内置工具)、model(可选,只能从父供应商
//    自己的 models[] 里选,不在列表则回落父模型)、mode(可选 read-only|write;省略时
//    按 tools 是否含写工具自动推断)。正文 = 子 agent 的系统提示。
//  - 扫描来源:<项目>/.claude/agents/ 与 ~/.claude/agents/(与 Claude Code 生态互通)。
//  - 启用状态存 userData/ue-coworker-agents.json(沿用 skills/mcp 的 userData JSON 约定)。
//  - 自带内置兜底 agent(general-purpose 通用可写、code-explorer 只读调查),无 .md
//    时也能用——保证 task 工具永远有可派发对象。
//
// 缓存前缀铁律:task 工具的 JSON schema 必须字节恒定(见 tools.ts STATIC task 定义)。
// 可派发的 agent 名单不进 schema enum,而是像 skills 一样作为独立 system 块(roster)
// 注入对话历史之前的稳定前缀——启停 agent 只改这个块,绝不触碰工具定义缓存断点。

import { app } from "electron";
import { join } from "path";
import { homedir } from "os";
import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { existsSync } from "fs";
import * as yaml from "js-yaml";

export type AgentMode = "read-only" | "write";

export interface AgentInfo {
  id: string;                       // `${source}:${name}` 全局唯一
  name: string;
  description: string;
  source: "project" | "global" | "builtin";
  filePath: string;                 // .md 绝对路径(内置为空)
  enabled: boolean;
  tools?: string[];                 // 工具白名单(省略=继承父级全部内置工具)
  model?: string;                   // 期望模型(运行时在父供应商 models[] 内校验,否则回落)
  mode: AgentMode;                  // read-only | write
  prompt: string;                   // 子 agent 系统提示(.md 正文)
  builtin?: boolean;                // 内置兜底 agent
  error?: string;                   // 解析/校验失败原因(仍列出,但不可派发)
}

const DESC_MAX = 1024;

// 内置兜底 agent:无 .md 时也保证 task 有可派发对象。general-purpose 可写(承接
// 一般委派任务),code-explorer 只读(调查/检索)。两者都继承父级全部内置工具
// (tools 省略),由 mode 决定写工具是否放行。
const BUILTIN_AGENTS: Omit<AgentInfo, "enabled">[] = [
  {
    id: "builtin:general-purpose",
    name: "general-purpose",
    source: "builtin",
    filePath: "",
    builtin: true,
    mode: "write",
    description:
      "General-purpose agent that carries a self-contained subtask end to end (investigate, edit, run commands) in its own isolated context and returns only a summary of what it did. Fits work the lead agent can fully hand off and continue from a summary alone — not work where the lead agent will then need the exact code/details itself (in that case the lead agent should do it directly; delegating only adds a re-read round-trip).",
    prompt:
      "You are a focused sub-agent delegated a specific task by the lead agent. Carry it out end to end using your tools, staying strictly within the scope you were given. Investigate before you act, make changes that fit the existing code, and verify your work. When done, reply with a concise summary of what you did, which files you touched, and anything the lead agent needs to know to continue. Do not ask the user questions — use your best judgment and report back.",
  },
  {
    id: "builtin:code-explorer",
    name: "code-explorer",
    source: "builtin",
    filePath: "",
    builtin: true,
    mode: "read-only",
    description:
      "Read-only investigation agent that explores the codebase in its own isolated context and returns a findings summary (relevant files, how things connect, a direct answer). Fits investigation large enough that reading it all in the main thread would bloat the context — the lead agent gets the conclusion without spending its own context on the raw reads. Skip it when the lead agent will need the full, exact code afterward (the report is a summary, so it would just have to re-read).",
    prompt:
      "You are a read-only investigation sub-agent. Explore the codebase with read/search/glob tools to answer the question or gather the context you were asked for. You CANNOT modify anything — do not attempt writes or commands that change state. When done, reply with a precise, well-organized findings report: the concrete files and line references that matter, how the relevant pieces connect, and a direct answer to what the lead agent asked. The lead agent only receives this report (not your raw tool output), so make it self-sufficient.",
  },
];

// 推断 mode:显式 frontmatter 优先;否则看工具白名单是否含写工具。无白名单(继承
// 全部)默认按可写处理(general 委派语义)。
const WRITE_TOOLS = new Set(["write_file", "edit_file", "multi_edit", "apply_diff", "run_command", "monitor", "generate_image", "configure_hooks", "remember"]);

export class AgentsManager {
  private configPath: string;
  private disabled = new Set<string>();
  private loaded = false;

  constructor() {
    this.configPath = join(app.getPath("userData"), "ue-coworker-agents.json");
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

  // ---- 扫描 ----

  /** 内置 + 项目/全局 .md agent,返回全部(含解析失败的,带 error)。内置永远在前。 */
  async list(projectPath?: string): Promise<AgentInfo[]> {
    await this.loadConfig();
    const out: AgentInfo[] = [];
    const seen = new Set<string>();   // 已占用的 name(项目 > 全局 > 内置)
    const seenId = new Set<string>();

    const roots: { dir: string; source: "project" | "global" }[] = [];
    if (projectPath) roots.push({ dir: join(projectPath, ".claude", "agents"), source: "project" });
    roots.push({ dir: join(homedir(), ".claude", "agents"), source: "global" });

    for (const root of roots) {
      if (!existsSync(root.dir)) continue;
      let entries: any[];
      try { entries = await readdir(root.dir, { withFileTypes: true }); } catch { continue; }
      for (const ent of entries) {
        if (!ent.isFile() || !/\.md$/i.test(ent.name)) continue;
        const baseName = ent.name.replace(/\.md$/i, "");
        const filePath = join(root.dir, ent.name);
        const info = await this.parseAgent(baseName, filePath, root.source);
        if (seenId.has(info.id)) continue;
        // 同名:项目先扫,覆盖全局/内置同名。
        if (seen.has(info.name) && !info.error) continue;
        seenId.add(info.id);
        if (!info.error) seen.add(info.name);
        out.push(info);
      }
    }

    // 内置兜底:仅当用户没有用同名 .md 覆盖时加入。
    for (const b of BUILTIN_AGENTS) {
      if (seen.has(b.name)) continue;
      out.push({ ...b, enabled: !this.disabled.has(b.id) });
    }
    return out;
  }

  /** 解析单个 agent .md。失败时返回带 error 的 AgentInfo(不抛)。 */
  private async parseAgent(
    baseName: string, filePath: string, source: "project" | "global"
  ): Promise<AgentInfo> {
    const id = source + ":" + baseName;
    const base: AgentInfo = {
      id, name: baseName, description: "", source, filePath,
      enabled: !this.disabled.has(id), mode: "write", prompt: "",
    };
    let raw: string;
    try { raw = await readFile(filePath, "utf-8"); }
    catch (e: any) { return { ...base, error: "无法读取 .md: " + (e?.message || e) }; }

    const m = /^\s*---\s*\n([\s\S]*?)\n---\s*(\n|$)/.exec(raw);
    if (!m) return { ...base, error: "缺少 YAML frontmatter(--- 包裹的头部)" };

    let fm: any;
    try { fm = yaml.load(m[1]); }
    catch (e: any) { return { ...base, error: "frontmatter YAML 解析失败: " + (e?.message || e) }; }
    if (!fm || typeof fm !== "object") return { ...base, error: "frontmatter 不是有效对象" };

    const description = typeof fm.description === "string" ? fm.description.trim() : "";
    if (!description) return { ...base, error: "frontmatter 缺少必填字段 description" };

    // tools 白名单(数组或逗号分隔字符串);省略=继承父级全部内置工具。
    let tools: string[] | undefined;
    if (Array.isArray(fm.tools)) tools = fm.tools.map((t: any) => String(t).trim()).filter(Boolean);
    else if (typeof fm.tools === "string") tools = fm.tools.split(",").map((t: string) => t.trim()).filter(Boolean);

    // mode:显式 read-only|write 优先;否则按工具白名单是否含写工具推断。
    let mode: AgentMode;
    const fmMode = typeof fm.mode === "string" ? fm.mode.trim().toLowerCase() : "";
    if (fmMode === "read-only" || fmMode === "readonly" || fmMode === "read") mode = "read-only";
    else if (fmMode === "write") mode = "write";
    else if (tools) mode = tools.some((t) => WRITE_TOOLS.has(t)) ? "write" : "read-only";
    else mode = "write"; // 继承全部工具时默认可写

    // name 应等于文件名;不等时以文件名为准,记 warning 但仍可用。
    const fmName = typeof fm.name === "string" && fm.name.trim() ? fm.name.trim() : "";

    return {
      id, name: baseName, source, filePath,
      description: description.slice(0, DESC_MAX),
      enabled: !this.disabled.has(id),
      tools,
      model: typeof fm.model === "string" && fm.model.trim() ? fm.model.trim() : undefined,
      mode,
      prompt: raw.slice(m[0].length).trim(),
      error: fmName && fmName !== baseName ? "name(" + fmName + ") 与文件名(" + baseName + ")不一致,已以文件名为准" : undefined,
    };
  }

  /** 已启用且无致命 error 的 agent(可被 task 派发)。供运行期解析 subagent_type。 */
  async usableAgents(projectPath?: string): Promise<AgentInfo[]> {
    const all = await this.list(projectPath);
    return all.filter((a) => a.enabled && a.description &&
      (!a.error || a.error.indexOf("已以文件名为准") === 0));
  }

  /**
   * 可派发 agent 名单的 system 注入块(roster)。放在对话历史之前的稳定前缀里——
   * 内容只随「启用了哪些 agent」变化,对同一启用集合字节恒定,与 skillsBlock 同款。
   * task 工具 schema 本身保持静态(见 tools.ts),agent 名只在这里枚举。
   * 无可用 agent 返回空串。
   */
  async systemPromptBlock(projectPath?: string): Promise<string> {
    const usable = await this.usableAgents(projectPath);
    if (usable.length === 0) return "";
    const lines = usable.map((a) =>
      "- **" + a.name + "** (" + a.mode + "): " + a.description);
    return [
      "## Available sub-agents (task tool)",
      "You CAN delegate a self-contained subtask to a specialized sub-agent with the `task` tool. A sub-agent runs with your provider, works in its OWN isolated context, and returns ONLY a final summary — you never see its raw tool output.",
      "When delegating helps: the subtask would otherwise pour a large amount of intermediate content into THIS conversation (e.g. reading many files or a whole module just to extract a conclusion). The sub-agent absorbs that in its own context and hands you back just the result, keeping your context lean.",
      "When to just do it yourself instead: the work is small, OR you will need the exact code/details afterward to keep going. The report is only a summary, so in that case delegating just forces you to re-read what the sub-agent already saw — slower, not faster. Editing a few known files is usually faster done directly.",
      "Mechanics: pass `subagent_type` set to EXACTLY one of the names below, plus a complete, standalone `prompt` (the sub-agent does NOT see this conversation — include all context it needs). A sub-agent cannot spawn further sub-agents. Every tool it uses still passes the same permission gate as you. If you issue several read-only tasks in one turn they run in parallel; any batch containing a writing task runs one at a time.",
      ...lines,
    ].join("\n");
  }
}

export const agentsManager = new AgentsManager();
