# UE Coworker — Skills, Sub-agents, Memory & CLAUDE.md

All three are progressively disclosed: a layer-1 summary injected into the system-prompt stable prefix; full content read on demand via `read_file`. Scan roots: project `<project>/.claude/...` + global `~/.claude/...`, project wins on collision. Enable-state files all use `{ disabled: [...] }` (default all enabled), except MCP.

## Skills — skills-manager.ts

`systemPromptBlock` injects only `enabled && description && no fatal error`. Two shapes:
- Flat skill (`<root>/<skill>/SKILL.md`): full `name + description + absolute SKILL.md path`.
- Categorized (`<root>/<category>/<skill>/SKILL.md`): grouped; group header = one-line `category.md` summary; each entry just `name + path` (saves resident tokens).

Block header tells the model: read the SKILL.md via `read_file` FIRST, then act (layer 2 = read SKILL.md, layer 3 = files it references). No new tool created.

SKILL.md = YAML frontmatter (`name` should match dir name, `description` single-line decides triggering, optional `license`/`allowed-tools`) + body. Strict YAML failure (third-party skills often have `xxx: yyy` colons) falls back to lenient parsing, downgraded to a warning (prefixed "已以目录名为准"), still usable.

**Why a skill doesn't take effect:**
1. Missing frontmatter / description (fatal error) → filtered out.
2. Disabled (`ue-coworker-skills.json`).
3. name ≠ dir name → warning only, still injected (dir name wins).
4. Nested deeper than two levels → not scanned.
5. Same id overridden by project scope.
6. Model didn't read the full text — layer 1 is only a summary; a vague description won't trigger a `read_file`.

## Sub-agents — agents-manager.ts

Each agent is a `.md` FILE (not a dir, unlike skills). roots: project `.claude/agents` + global `~/.claude/agents`. Frontmatter: `name`/`description` (required), `tools` (optional whitelist), `model` (optional), `mode` (`read-only|write`, inferred from whether `tools` includes write tools if omitted). Body = sub-agent system prompt.

The task tool's JSON schema is BYTE-STABLE — agent names are NOT in the schema enum; the dispatchable roster is enumerated only in the `agentsBlock` system block, so enabling/disabling an agent changes only that block, never the tool-definition cache breakpoint.

**task dispatch:** intercepted by the main loop (not executeTool). All read-only tasks in a turn → concurrent; any writable → serial. Each task passes the `Task` permission gate; results backfilled in order.

`runSubAgentLoop`: own messages, own system prompt (the .md body), subset of tools (NEVER includes `task` — one level only; read-only agents also strip WRITE tools), own token budget (cap 60), same permission gate + checkpoints + Pre/PostToolUse hooks. Returns a fixed structured report (Conclusion/Files/Evidence/Confidence).

- `model` must be within the parent provider's `models[]`, else silently falls back to the parent model (NEVER crosses providers).
- Unknown `subagent_type` falls back to `general-purpose` then `defs[0]` (no error).
- Built-in fallback agents `general-purpose` (writable) + `code-explorer` (read-only) exist even with no .md.
- Read-only sub-agent failure auto-retries once; writable never retries.

## Memory + CLAUDE.md — memory-manager.ts

**Three tiers:** Tier 0 resident index (injected) → Tier 1 `recall_memory` (keyword search) → Tier 2 `read_file` full text.

Each memory is a `.md` (`<root>/.claude/memory/<slug>.md`) with frontmatter `name`/`description`/`metadata.type` (`user|feedback|project|reference`) + body. `MEMORY.md` is the index file itself, not an entry.

Tier 0 `residentIndexBlock`:
- Protocol header ALWAYS injected (even zero memories) — else the model wouldn't know the capability exists. Explains when to `remember` and the "update by same-name remember" rule.
- Only `user/feedback/project` are resident (RESIDENT_TYPES); `reference` only reports a count.
- Token cap 1500 (`len/4`); overflow truncated with "… N more — use recall_memory".

**CLAUDE.md / AGENTS.md** (contextFilesBlock), in order: global `~/.claude/CLAUDE.md`, project `<project>/CLAUDE.md`, project `<project>/AGENTS.md` (same level as CLAUDE.md), local `<project>/.claude/CLAUDE.md`. Deduped by path. Any provider (GPT/DeepSeek/Claude/local) reads them.

`save` uses read-merge semantics — updating an existing entry inherits `type`/`body` not explicitly provided (so changing only the description doesn't wipe the body). After save, rewrites `MEMORY.md` (human-readable index; index write failure non-fatal).

**Why a memory isn't injected:**
1. Fatal error (frontmatter YAML failed to parse) → filtered.
2. Disabled (`ue-coworker-memory.json`).
3. type is `reference` (or invalid type coerced to reference) → not resident, only via `recall_memory`.
4. Over the 1500-token budget — overflow only in "… N more".
5. The protocol header is always injected, so an entirely empty memoryBlock usually means `systemPromptBlock` threw and was swallowed to `""` — check the `try/catch` in ipc-handlers.
6. CLAUDE.md/AGENTS.md blank after trim → skipped.
