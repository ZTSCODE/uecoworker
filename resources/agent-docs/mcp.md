# UE Coworker — MCP Servers

`src/main/mcp-manager.ts` + `src/main/node-runtime.ts`. Config file: `userData/ue-coworker-mcp.json`.

## Config structure (McpServerConfig)

- `id` — unique; ALSO used as the tool-name prefix.
- `enabled`
- stdio: `command`, `args`, `env`, `cwd`
- remote: `url`, `headers`
- `type` — `"stdio" | "http" | "sse" | "streamable-http"`, optional. If omitted: has `url` → http, else stdio.

`loadConfig` accepts BOTH `{ servers: [...] }` (native) and `{ mcpServers: {...} }` (Claude Desktop / Cline / Cursor generic — object key = id, default enabled).

## Transport (buildTransport)

- stdio: env merged in 3 layers — `getDefaultEnvironment()` (SDK safe whitelist) → `process.env` (full main env) → `cfg.env` (user keys, highest). Then `augmentPath(env)` prepends the bundled-node dir to PATH, and `resolveCommand(cfg.command)` maps `node`/`npm`/`npx` to the bundled absolute path. `stderr:"pipe"`.
- remote: `new URL(cfg.url)`; `headers` wrapped as `{requestInit:{headers}}`. `type==="sse"` → SSE transport; http/streamable-http → Streamable transport.

## Tool prefix routing

- Prefix = `sanitizeName(serverId) + "__"` (separator `__`). Charset `[a-zA-Z0-9_-]`, total ≤ 64 (OpenAI/Anthropic limit). Over-length keeps the TAIL (more distinctive). Name collisions resolved by replacing the last 5 chars with a 4-hex FNV-1a hash of the original (collisions → API 400 "Tool names must be unique").
- `listOpenAITools()` exports only `status==="connected"` servers' tools, with `\n(MCP server: <id>)` appended to each description. Re-read every turn, so runtime tool changes apply next turn.
- `callTool(qualifiedName, args, onImages)` finds the runtime owning that qualified name, calls the ORIGINAL tool name, 60s timeout. Result flattened: text joined, image blocks kept as placeholder text + full base64 passed via `onImages` (MCP screenshots fed back to vision model), `isError` prefixed.

## Bundled Node runtime (node-runtime.ts)

The app ships a Node distribution (node+npm+npx) so users need NOT install Node.js to run npx/node-type MCP servers.
- `nodeDir()`: packaged → `process.resourcesPath/node`; dev → `resources/node`. Dev without it → returns null, falls back to system PATH.
- `resolveCommand`: only bare `node`/`npm`/`npx`. Windows: `node.exe` at root, `npm.cmd`/`npx.cmd`; unix: `bin/`.
- `augmentPath`: prepends bundled dir to PATH (case-insensitive key lookup for Windows `Path`/`PATH`), so a server that re-spawns node also hits the bundled one. Applied in MCP transport, terminal (pty-manager), and run_command (tools.ts).

## Lifecycle

- `connectServer`: disconnect-first (reconnect) → build transport+Client → `client.connect` with 20s timeout (prevents initialize hang) → register ToolListChanged handler (hot-reload new toolsets) → refreshTools. On failure: `status="error"` + `rt.error`, does NOT throw.
- `refreshTools`: listTools 15s timeout; first-failure tolerated as empty, runtime-refresh failure keeps old snapshot (no flicker).
- `connectAll`: only connects `enabled && (command || url)`, in parallel; one failure `.catch` doesn't affect others. Fired at startup (non-blocking).
- Registry one-click install: `install.enabled = !requiresInput` — a server with REQUIRED keys is installed DISABLED, forcing the user to fill env/headers first. (UI "Edit" on an installed server lets you fill keys after install.)

## Why a server won't connect (real clues)

1. **Missing env key** → server process fails to start or initialize → 20s connect timeout or transport onerror → status `error`. Registry-installed servers with unfilled `requiresInput` are `enabled=false` and never connect.
2. **npx dependency** → first `npx -y <pkg>` needs network to fetch; without bundled node AND no system Node.js, `resolveCommand` returns `npx` as-is → spawn ENOENT.
3. **command wrong** → `connectAll` filters `(command || url)`; a config with both empty is silently skipped (neither error nor connect).
4. **Tool name collision/over-length** → connected but API 400; usually auto-resolved, but check if `serverId` is too long.
5. **Server emits no tools / slow** → listTools 15s timeout; appears as "connected but no tools".
6. **Calling a non-connected server** → `callTool` returns `"MCP server '...' is not connected."` (not an exception).
