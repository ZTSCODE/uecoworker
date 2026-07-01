import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { app } from "electron";
import { existsSync } from "fs";

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

export interface ToolPermission {
  tool: string;
  allowed: boolean;
  scope?: string;
  // When true, an enabled mutating tool is auto-approved in `default` mode
  // (no per-call prompt). Mirrors Roo-Code's alwaysAllowWrite/Execute. `allowed`
  // = whether the tool is enabled at all; `auto` = whether it skips the prompt.
  auto?: boolean;
}

export interface PermissionsConfig {
  mode: PermissionMode;
  tools: ToolPermission[];
}

const DEFAULT_CONFIG: PermissionsConfig = {
  mode: "default",
  tools: [
    { tool: "Read", allowed: true },
    { tool: "Write", allowed: true },
    { tool: "Edit", allowed: true },
    { tool: "Bash", allowed: true },
    { tool: "WebSearch", allowed: true },
    { tool: "WebFetch", allowed: true },
    { tool: "GenerateImage", allowed: true },
    { tool: "TodoWrite", allowed: true },
    { tool: "AskUserQuestion", allowed: true },
    { tool: "Hooks", allowed: true },
    { tool: "Mcp", allowed: true },
    { tool: "Task", allowed: true },
  ],
};

export class PermissionsManager {
  private configPath: string;
  private config: PermissionsConfig = DEFAULT_CONFIG;

  constructor() {
    this.configPath = join(app.getPath("userData"), "ue-coworker-permissions.json");
    this.load();
  }

  private async load(): Promise<void> {
    try {
      if (existsSync(this.configPath)) {
        const raw = await readFile(this.configPath, "utf-8");
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch {}
  }

  private async save(): Promise<void> {
    await writeFile(this.configPath, JSON.stringify(this.config, null, 2));
  }

  getConfig(): PermissionsConfig {
    return { ...this.config };
  }

  async setMode(mode: PermissionMode): Promise<void> {
    this.config.mode = mode;
    await this.save();
  }

  async setToolPermission(tool: string, allowed: boolean): Promise<void> {
    const existing = this.config.tools.find(function(t) { return t.tool === tool; });
    if (existing) {
      existing.allowed = allowed;
    } else {
      this.config.tools.push({ tool, allowed });
    }
    await this.save();
  }

  /** Toggle auto-approval (skip prompt) for an enabled tool. */
  async setToolAuto(tool: string, auto: boolean): Promise<void> {
    const existing = this.config.tools.find(function(t) { return t.tool === tool; });
    if (existing) {
      existing.auto = auto;
      if (auto) existing.allowed = true; // auto-approving implies enabled
    } else {
      this.config.tools.push({ tool, allowed: true, auto });
    }
    await this.save();
  }

  isToolAllowed(tool: string): boolean {
    if (this.config.mode === "bypassPermissions") return true;
    const perm = this.config.tools.find(function(t) { return t.tool === tool; });
    return perm ? perm.allowed : false;
  }

  isToolAuto(tool: string): boolean {
    const perm = this.config.tools.find(function(t) { return t.tool === tool; });
    return perm ? !!perm.auto : false;
  }

  getMode(): PermissionMode {
    return this.config.mode;
  }
}

/** agent-loop tool ids (snake_case) -> permission tool names (PascalCase). */
const TOOL_NAME_MAP: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit_file: "Edit",
  multi_edit: "Edit",
  apply_diff: "Edit",
  list_files: "Read",
  run_command: "Bash",
  monitor: "Bash",
  search_files: "Read",
  glob_files: "Read",
  web_search: "WebSearch",
  web_fetch: "WebFetch",
  generate_image: "GenerateImage",
  capture_window: "Read",
  configure_hooks: "Hooks",
  task: "Task",
};

/** Tools that mutate the filesystem / system and warrant explicit approval. */
const MUTATING_TOOLS = new Set(["write_file", "edit_file", "multi_edit", "apply_diff", "run_command", "monitor", "generate_image", "configure_hooks"]);

// MCP 工具名形如 "<serverId>__<tool>"（含双下划线分隔）。统一映射到虚拟权限
// 名 "Mcp"，这样用户可在权限设置里整体开关，并在 default 模式下逐次确认。
export function isMcpTool(agentToolId: string): boolean {
  return typeof agentToolId === "string" && agentToolId.indexOf("__") !== -1
    && !TOOL_NAME_MAP[agentToolId];
}

export function mapToolName(agentToolId: string): string {
  if (TOOL_NAME_MAP[agentToolId]) return TOOL_NAME_MAP[agentToolId];
  if (isMcpTool(agentToolId)) return "Mcp";
  return agentToolId;
}

export function isMutatingTool(agentToolId: string): boolean {
  // MCP 工具效果未知，按需确认（视作 mutating，default 模式下逐次询问）。
  if (isMcpTool(agentToolId)) return true;
  return MUTATING_TOOLS.has(agentToolId);
}

/**
 * Decide how a tool call should be handled given the current mode.
 * Returns one of: "allow" (run it), "deny" (refuse), "ask" (prompt user).
 */
export function decideToolAction(
  pm: PermissionsManager,
  agentToolId: string,
  modeOverride?: PermissionMode
): "allow" | "deny" | "ask" {
  // Session-level mode (passed per request) takes precedence over the global
  // config mode. Falls back to the persisted global mode when not provided.
  const mode = modeOverride || pm.getMode();
  const permTool = mapToolName(agentToolId);
  const mutating = isMutatingTool(agentToolId);

  if (mode === "bypassPermissions") return "allow";
  // Tool explicitly disabled in config.
  if (!pm.isToolAllowed(permTool)) return mode === "default" ? "ask" : "deny";
  if (!mutating) return "allow"; // read-only tools always allowed when enabled
  if (mode === "plan") return "deny"; // plan mode = read-only, no mutations
  if (mode === "acceptEdits") return "allow"; // auto-approve edits
  // default mode: mutating tools prompt, unless the user marked this tool
  // "always allow" (auto) — then run it without a prompt.
  if (pm.isToolAuto(permTool)) return "allow";
  return "ask";
}
