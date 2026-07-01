/**
 * Hooks: event-driven automation compatible with the Claude Code / Codex hooks
 * spec. Config lives in the project's .claude/settings.json under the `hooks`
 * key; each command receives a JSON payload on stdin and signals back via exit
 * code (2 = block) or a control-JSON on stdout. Runs in the main process so it
 * works for every wire protocol (the agent loop has a single shared tool path).
 */
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { spawn } from "child_process";

// One command handler within a matcher group.
export interface HookCommand {
  type: "command";
  command: string;
  timeout?: number; // seconds; default 60
}

// A matcher group: which tools (Pre/PostToolUse) + the commands to run.
export interface HookEntry {
  matcher?: string; // tool-name matcher: exact | "A|B" | regex | "*" (tool events only)
  hooks: HookCommand[];
}

// The full hooks config: event name -> matcher groups.
export type HooksConfig = Record<string, HookEntry[]>;

// All lifecycle events we read/write (full set, Claude/Codex compatible).
export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "SubagentStop",
  "Notification",
  "PreCompact",
] as const;

// Events that carry a tool name and therefore support a matcher.
export const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse"]);

// Normalized outcome handed back to the agent loop.
export interface HookOutcome {
  block: boolean;
  reason: string;
  additionalContext: string;
}

const EMPTY_OUTCOME: HookOutcome = { block: false, reason: "", additionalContext: "" };

function settingsPath(projectDir: string): string {
  return join(projectDir, ".claude", "settings.json");
}

// Does a matcher string match a given tool name? exact | "A|B" | regex | "*".
function matcherHits(matcher: string | undefined, toolName: string): boolean {
  if (!matcher || matcher === "*") return true;
  if (matcher === toolName) return true;
  if (matcher.indexOf("|") !== -1) {
    if (matcher.split("|").some((m) => m.trim() === toolName)) return true;
  }
  // Fall back to regex (Claude/Codex allow JS regex like "mcp__.*").
  try { return new RegExp("^(?:" + matcher + ")$").test(toolName); } catch { return false; }
}

export class HooksManager {
  // Cache keyed by project dir; invalidated on write.
  private cache = new Map<string, HooksConfig>();

  /** Read the `hooks` field from <projectDir>/.claude/settings.json (or {}). */
  async loadConfig(projectDir: string): Promise<HooksConfig> {
    if (!projectDir) return {};
    if (this.cache.has(projectDir)) return this.cache.get(projectDir)!;
    let hooks: HooksConfig = {};
    try {
      const p = settingsPath(projectDir);
      if (existsSync(p)) {
        const raw = await readFile(p, "utf-8");
        const json = JSON.parse(raw);
        if (json && typeof json.hooks === "object" && json.hooks) hooks = json.hooks;
      }
    } catch { /* malformed settings → treat as no hooks */ }
    this.cache.set(projectDir, hooks);
    return hooks;
  }

  /**
   * Merge the hooks field back into settings.json, preserving every other key.
   * Creates .claude/ and the file if missing.
   */
  async writeConfig(projectDir: string, hooks: HooksConfig): Promise<{ ok: boolean; error?: string }> {
    if (!projectDir) return { ok: false, error: "No project" };
    try {
      const dir = join(projectDir, ".claude");
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      const p = settingsPath(projectDir);
      let existing: any = {};
      if (existsSync(p)) {
        try { existing = JSON.parse(await readFile(p, "utf-8")) || {}; } catch { existing = {}; }
      }
      existing.hooks = hooks;
      await writeFile(p, JSON.stringify(existing, null, 2), "utf-8");
      this.cache.set(projectDir, hooks);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  /** Absolute path to the settings file (for "open in editor"). */
  settingsFile(projectDir: string): string {
    return settingsPath(projectDir);
  }

  /**
   * Apply a batch of structured operations from the agent's configure_hooks
   * tool, then persist. Returns a human-readable summary of the resulting
   * config (or an error). Validates event names and that tool events carry a
   * matcher. Non-destructive by default: "add" appends; only "remove"/"clear"
   * delete, and "set" replaces a single event's groups.
   */
  async applyOps(
    projectDir: string,
    ops: Array<{ action: string; event?: string; matcher?: string; command?: string; timeout?: number; index?: number }>
  ): Promise<{ ok: boolean; error?: string; summary?: string }> {
    if (!projectDir) return { ok: false, error: "No project open" };
    if (!Array.isArray(ops) || ops.length === 0) return { ok: false, error: "No operations provided" };

    const config: HooksConfig = JSON.parse(JSON.stringify(await this.loadConfig(projectDir)));

    for (const op of ops) {
      const action = String(op.action || "");
      const event = op.event ? String(op.event) : "";
      if (action !== "clear_all" && HOOK_EVENTS.indexOf(event as any) === -1) {
        return { ok: false, error: `Unknown event "${event}". Valid events: ${HOOK_EVENTS.join(", ")}` };
      }

      if (action === "add") {
        if (!op.command || !String(op.command).trim()) return { ok: false, error: `add on ${event} requires a non-empty command` };
        const entry: HookEntry = { hooks: [{ type: "command", command: String(op.command), ...(op.timeout ? { timeout: Number(op.timeout) } : {}) }] };
        if (TOOL_EVENTS.has(event)) entry.matcher = op.matcher && String(op.matcher).trim() ? String(op.matcher) : "*";
        config[event] = Array.isArray(config[event]) ? [...config[event], entry] : [entry];
      } else if (action === "remove") {
        const groups = Array.isArray(config[event]) ? [...config[event]] : [];
        const idx = Number(op.index);
        if (isNaN(idx) || idx < 0 || idx >= groups.length) return { ok: false, error: `remove on ${event}: index ${op.index} out of range (0..${groups.length - 1})` };
        groups.splice(idx, 1);
        if (groups.length) config[event] = groups; else delete config[event];
      } else if (action === "clear") {
        delete config[event];
      } else if (action === "clear_all") {
        for (const k of Object.keys(config)) delete config[k];
      } else {
        return { ok: false, error: `Unknown action "${action}". Use add | remove | clear | clear_all` };
      }
    }

    const res = await this.writeConfig(projectDir, config);
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, summary: summarize(config) };
  }

  /**
   * Run every command hook registered for `event` (filtered by matcher against
   * payload.tool_name for tool events). Commands run concurrently with their own
   * timeouts; the combined outcome blocks if ANY command requested a block, and
   * concatenates any additionalContext returned by exit-0 control JSON.
   */
  async runHooks(event: string, payload: Record<string, any>, projectDir: string): Promise<HookOutcome> {
    const config = await this.loadConfig(projectDir);
    const groups = config[event];
    if (!Array.isArray(groups) || groups.length === 0) return EMPTY_OUTCOME;

    const toolName: string = typeof payload.tool_name === "string" ? payload.tool_name : "";
    const commands: HookCommand[] = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) continue;
      if (TOOL_EVENTS.has(event) && !matcherHits(g.matcher, toolName)) continue;
      for (const h of g.hooks) {
        if (h && h.type === "command" && typeof h.command === "string" && h.command.trim()) commands.push(h);
      }
    }
    if (commands.length === 0) return EMPTY_OUTCOME;

    const stdin = JSON.stringify(payload);
    const results = await Promise.all(commands.map((c) => this.runOne(c, stdin, projectDir)));

    let block = false;
    let reason = "";
    let additionalContext = "";
    for (const r of results) {
      if (r.block) { block = true; if (r.reason && !reason) reason = r.reason; }
      if (r.additionalContext) additionalContext += (additionalContext ? "\n" : "") + r.additionalContext;
    }
    return { block, reason, additionalContext };
  }

  /** Spawn one command, feed stdin JSON, interpret exit code + stdout control JSON. */
  private runOne(cmd: HookCommand, stdin: string, projectDir: string): Promise<HookOutcome> {
    return new Promise((resolve) => {
      const timeoutMs = Math.max(1, Number(cmd.timeout) || 60) * 1000;
      let stdout = "";
      let stderr = "";
      let settled = false;
      const done = (o: HookOutcome) => { if (!settled) { settled = true; resolve(o); } };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(cmd.command, {
          shell: true,
          cwd: projectDir || process.cwd(),
          env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir || "" },
          windowsHide: true,
        });
      } catch (e: any) {
        return done({ block: false, reason: "", additionalContext: "" });
      }
      const timer = setTimeout(() => { try { child.kill(); } catch {} done(EMPTY_OUTCOME); }, timeoutMs);
      child.stdout?.on("data", (d) => { stdout += d.toString(); });
      child.stderr?.on("data", (d) => { stderr += d.toString(); });
      child.on("error", () => { clearTimeout(timer); done(EMPTY_OUTCOME); });
      child.on("close", (code) => {
        clearTimeout(timer);
        done(interpret(code, stdout, stderr));
      });
      try { child.stdin?.write(stdin); child.stdin?.end(); } catch {}
    });
  }
}

/**
 * Map a finished command's (exitCode, stdout, stderr) to a normalized outcome,
 * following the Claude Code semantics:
 *  - exit 2          → blocking error; stderr is the reason fed back to the model.
 *  - exit 0 + control JSON on stdout → permissionDecision "deny" / decision
 *    "block" / continue:false all block; additionalContext is injected.
 *  - any other exit  → non-blocking error; ignored (logged upstream if needed).
 */
function interpret(code: number | null, stdout: string, stderr: string): HookOutcome {
  if (code === 2) {
    return { block: true, reason: (stderr || "Blocked by hook").trim(), additionalContext: "" };
  }
  if (code === 0) {
    const trimmed = (stdout || "").trim();
    if (trimmed.startsWith("{")) {
      try {
        const j = JSON.parse(trimmed);
        const hso = j.hookSpecificOutput || {};
        const deny = hso.permissionDecision === "deny" || j.decision === "block" || j.continue === false;
        const reason = hso.permissionDecisionReason || j.reason || j.stopReason || "Blocked by hook";
        const ctx = hso.additionalContext || j.additionalContext || "";
        if (deny) return { block: true, reason: String(reason), additionalContext: "" };
        if (ctx) return { block: false, reason: "", additionalContext: String(ctx) };
      } catch { /* not control JSON → treat stdout as plain context */ }
    }
    // SessionStart / UserPromptSubmit use plain stdout as injected context.
    if (trimmed) return { block: false, reason: "", additionalContext: trimmed };
  }
  return EMPTY_OUTCOME;
}

// Single shared instance (mirrors checkpointManager / gitManager singletons).
export const hooksManager = new HooksManager();

// Render a hooks config as a compact, indexed text summary for the agent — so
// after a mutation it sees exactly what's configured and the indices to target.
export function summarize(config: HooksConfig): string {
  const events = Object.keys(config).filter((e) => Array.isArray(config[e]) && config[e].length);
  if (events.length === 0) return "No hooks configured.";
  const lines: string[] = [];
  for (const ev of events) {
    lines.push(ev + ":");
    config[ev].forEach((g, i) => {
      const cmd = g.hooks && g.hooks[0] ? g.hooks[0].command : "";
      const to = g.hooks && g.hooks[0] && g.hooks[0].timeout ? ` (timeout ${g.hooks[0].timeout}s)` : "";
      const m = TOOL_EVENTS.has(ev) ? `[matcher: ${g.matcher || "*"}] ` : "";
      lines.push(`  [${i}] ${m}${cmd}${to}`);
    });
  }
  return lines.join("\n");
}
