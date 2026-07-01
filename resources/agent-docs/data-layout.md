# UE Coworker — Data Layout & Files

All app data lives under Electron `userData`:
- Windows: `%APPDATA%\ue-coworker` (`C:\Users\<name>\AppData\Roaming\ue-coworker`)
- macOS: `~/Library/Application Support/ue-coworker`
- Linux: `~/.config/ue-coworker`

Config/state files use the project-level `<project>/.claude/...` and global `~/.claude/...` scan roots (interoperable with the Claude Code ecosystem). Project scope overrides global on id collision.

## Config / state files (all under userData)

| File | Holds | Read it to diagnose |
|---|---|---|
| `ue-coworker-permissions.json` | `{ mode, tools[] }` — permission mode + per-tool `allowed`/`auto` | a tool that always prompts or is always denied |
| `ue-coworker-secrets.json` | encrypted API keys / bot tokens (`enc:`/`raw:` prefixes) | token/key problems — DO NOT print values |
| `ue-coworker-mcp.json` | `{ servers: [...] }` MCP server command/args/env | MCP server won't connect |
| `ue-coworker-relay.json` | Discord/Telegram/WeChat config (NO token): allowedUserId, applicationId, guildId, accountId | remote control not connecting |
| `ue-coworker-agents.json` | `{ disabled: [...] }` sub-agent enable-state (default all enabled) | a sub-agent not dispatchable |
| `ue-coworker-skills.json` | `{ disabled: [...] }` skills enable-state | a skill not taking effect |
| `ue-coworker-memory.json` | `{ disabled: [...] }` memory enable-state | a memory not injected |
| `ue-coworker-sessions.json` | session list/metadata | — |
| `balance-history.jsonl` | `{providerId,remaining,unit,ts}` snapshots (5-min debounced) | provider balance curve |
| `chats/<encodedProject>/<sessionId>.jsonl` | per-session: line 1 = meta (permissionMode/usageTotals), rest = one message per line | chat history / a specific session |
| `checkpoints/<projectHash>/` | shadow-git repo (projectHash = sha256(projectPath)[:16]) | rollback history ("undo the agent") |
| `transport-logs/transport-*.jsonl` | the real bytes sent to the LLM + usage pairing | bad/empty model response, cache hits, 413 size |
| `chat-images/` | generated/pasted images on disk | — |

`chats/` subdir encoding: project path `[\\/:]` → `-`, other illegal chars → `_`.

## transport-logs — how to turn on, what it records

Off by default (zero overhead). Three ways to enable (runtime > env/const):
- Runtime toggle via Settings (IPC `transport-log:setEnabled`) — **no restart needed**
- Env var `CW_TRANSPORT_LOG=1`
- `FORCE_ON` constant (source edit)

Filename: `<session title>-<sessionId first 6>-<date>.jsonl`. Records per request: protocol/model/url/headers/body/bodyBytes; per response: status/usage/error/raw (paired by request `ts`). Headers redacted (Authorization/x-api-key/token → first4…last4); base64 images folded to `[image <mime> <N> bytes b64]`.

Use it to verify: system-prompt assembly, message history structure, prompt-cache hits (`cache_read_input_tokens`), empty responses (check `raw`/`note`), 413 body size (`bodyBytes`).

## secrets — encryption at rest

Electron `safeStorage` (Windows DPAPI / macOS Keychain / Linux libsecret). Renderer never holds plaintext — references a secret by `id`; key material stays in main process.

Value prefixes in `ue-coworker-secrets.json`:
- `enc:` + base64 — encrypted (safeStorage available)
- `raw:` + plaintext — fallback when OS encryption unavailable (flagged)
- no prefix — legacy, returned as-is

Diagnosis: a `raw:` value means safeStorage was unavailable on that machine (no keychain/DPAPI). An `enc:` value that decrypts to empty usually means the machine/user profile changed so DPAPI can't decrypt it.

Known secret ids: `__discord_bot_token__`, `__telegram_bot_token__`, `__weixin_bot_token__`, `__github_oauth_token__`, `__websearch_<kind>__`.
