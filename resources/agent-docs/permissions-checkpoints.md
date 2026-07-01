# UE Coworker — Permissions & Checkpoints

## Permissions — permissions-manager.ts

Config `{ mode, tools[] }`, stored at `userData/ue-coworker-permissions.json`. `ToolPermission = { tool, allowed, scope?, auto? }`:
- `allowed` = tool enabled.
- `auto` = an enabled mutating tool SKIPS per-call approval in `default` mode.

Defaults: all tools `allowed:true` but NONE have `auto` → out of the box, every mutating tool prompts in default mode.

**`decideToolAction` order** (session `modeOverride` beats global mode):
1. `bypassPermissions` → always allow.
2. tool disabled (`!isToolAllowed`) → default: ask, else: deny.
3. read-only tool → enabled = allow.
4. `plan` → mutating always deny (read-only mode).
5. `acceptEdits` → mutating always allow.
6. `default` → `auto` true ? allow : ask.

**Tool name mapping** (`mapToolName`, PascalCase virtual names): `write_file→Write`; `edit_file/multi_edit/apply_diff→Edit`; `run_command/monitor→Bash`; `list_files/search_files/glob_files/capture_window→Read`. MCP tools (`<serverId>__<tool>`) all map to virtual `"Mcp"` (one switch governs all MCP). MCP tools are ALWAYS treated as mutating (unknown effect → confirm each time in default).

**Why a tool always prompts:** mode is `default`, tool is mutating, no `auto`. Fix: switch to acceptEdits/bypassPermissions, or set `auto` on that tool. Another common root cause: the approval card is off-screen / window hidden.

**Why a tool is always denied:**
- `plan` mode → any mutating tool always denied.
- tool `allowed:false` and mode ≠ default.
- MCP tool: always-mutating, so default → always ask, plan → always deny.
- Approval timeout: 5 min no response = treated as declined.

Deny-streak counting: only mode-`deny` increments the circuit breaker; user-declines don't (avoids false "model spinning" judgement).

## Checkpoints ("undo the agent") — checkpoint-manager.ts

A SHADOW git repo at `userData/checkpoints/<projectHash>` (projectHash = sha256(projectPath)[:16]). Never touches the user's own repo. Uses `git --git-dir=<shadow> --work-tree=<project>` to treat the project dir as the work tree.

- `ensureShadow`: first-time `git init` + config (`core.autocrlf=false`), writes an excludes file (`node_modules/ dist/ out/ build/ .next/ .cache/ .git/ *.log` ...).
- `snapshot`: `add -A` → `commit --allow-empty` (a rollback point even with no changes — needed especially first time) → returns the commit.
- Triggered AFTER a write tool (`write_file/edit_file/multi_edit/apply_diff` with `file_path`) succeeds; emits `agent:checkpoint`. Sub-agents same, with `[agentName]` prefix. Shadow-git unavailable → silently skipped.
- `restore`: `checkout -f <commit> -- .` + `reset --hard <commit>` + `clean -fd` (removes files added after that point, protected by excludes).
- `diff(projectPath, commit)` previews what a rollback would change. IPC: `checkpoint:list/restore/diff`.
