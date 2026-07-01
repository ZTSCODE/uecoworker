# UE Coworker — Remote Control (Discord / Telegram / WeChat relay)

`src/main/relay/`. Lets you drive the agent from a chat platform.

## Architecture — gateway in a utilityProcess

`RelayCore` (main-process hub) forks `relay-gateway.js` via `utilityProcess.fork` (stdio:"pipe"), communicating over `process.parentPort` (MessagePortMain, NOT Node `process.send`). The gateway only translates platform events ↔ a neutral protocol; it holds NO business logic (provider/tool/git).

**Why "application not responding" was fixed:** if the bot's heartbeat/packet handling shared the main event loop with the agent loop, the agent loop's synchronous segments (token counting, JSON.parse, image downscale) would block the heartbeat → Discord's 3-second ACK timeout → "not responding". Isolating to a utilityProcess means the heartbeat is never blocked by business work. The Discord adapter also `deferReply()`s within 3s, then `editReply`s when async work returns.

**Self-healing:** if the gateway child exits unexpectedly (not a deliberate shutdown), platforms that were online/connecting are recorded and auto-reconnected after 2s — no need to return to the desktop and re-click connect. `uncaughtException`/`unhandledRejection` in the gateway only log, never crash (one exception doesn't drop all platforms).

## Neutral protocol — protocol.ts

Three message classes:
- **command** (gateway→core): `kind: ask|session|tool|provider|mode|project|ui`; carries `channelId` (reply address), `userId`, `replyTo`, payload.
- **prompt/answer** (core↔gateway round-trip): `RelayPrompt` has `promptId`, `options` (non-empty → buttons), `plan` (non-empty → plan-approval), `allowText`, `timeoutMs`. `RelayAnswer` replies by `promptId`; empty string = timeout/cancel/abort.
- **emit** (core→gateway, read-only push): `kind: result|progress|error|typing|menu|image|document|board`.

## prompt round-trip & followup dual-channel

`askPrompt` generates `promptId`, stores the resolver in `pendingPrompts`, sends `type:"prompt"`. The gateway's `answer` finds the resolver by `promptId`. `cancelPrompt` withdraws an unanswered card and feeds the resolver an empty string. Gateway exit feeds all pending prompts empty strings (prevents permanent hang).

Dual channel (desktop card + remote card), in ipc-handlers:
- approval: `agent:tool-approval-request` (desktop) + `askPrompt` (remote button card "✅approve/❌deny", `allowText:false`) simultaneously; whichever answers first wins, the other is withdrawn.
- followup: `agent:followup-request` (desktop) + `askPrompt` (remote, first question only). The desktop `webContents.send` bytes are unchanged — with no relay, behavior is identical to before.
- abort also triggers finish (resolve false / empty), so `/stop` and disconnects truly terminate a stuck turn.

## Tokens & config

- Tokens via SecretsManager (encrypted): `__discord_bot_token__` (reuses the old discord-bot-manager key for smooth migration), `__telegram_bot_token__`, `__weixin_bot_token__`.
- Config (NO token): `userData/ue-coworker-relay.json` — per-platform allowedUserId, applicationId, guildId, accountId, etc.
- Connect prerequisites: Discord needs token + applicationId; WeChat needs token + accountId (QR-login credential).

## Discord specifics — discord-adapter.ts

- Slash commands: `/ask /session /file /git /run /search /status /stop /provider`, registered via `REST.put` (guild if guildId else global). Only `GatewayIntentBits.Guilds` (slash commands need no privileged intent; MessageContent would fail login).
- Every interaction `deferReply()`s first to grab the 3s ACK, stores interaction in `pendingReplies[replyTo]`, emits `command`.
- Options → buttons (`customId:"fu_"+i`) + a component collector.
- Free text → button → Modal (two-step, because Discord can't pop a Modal directly on a message): "✍️ click to answer" button → `showModal` (Paragraph) → `awaitModalSubmit`.
- followup reuses the activeAsk interaction (NOT `channels.fetch+send`, which fails in User-Install mode); interaction token valid 15 min.

## Telegram specifics — telegram-adapter.ts

- Smoother (no 3s ACK, no privileged intent). Commands via `setMyCommands`.
- **Direct text (not starting with `/`) = /ask.** No `/ask` needed.
- Options → inline keyboard (callback_data `"fu:"+promptId+":"+i`). Free text → `force_reply:true` (registers `awaitingText[chatId]=promptId`) — skips Discord's two-step.
- Multi-step (slash commands that need args): `showMenu` / `askParam` (forceReply) / `pendingInput` awaits the next text as the arg.
- callback_data 64-byte limit: long values stored in a map with `#n` placeholders (`shortVal`/`resolveVal`).
- **Progress debounce flush (key diagnostic):** tool calls/todos accumulate into one message, debounce window 1.5s. Telegram editMessageText is rate-limited ~1/sec; without debounce → 429 swallows updates → "no live progress visible".
- Heartbeat: `getMe` every 30s; on failure, reconnect after 5s.
- markdown→HTML subset (`<b><i><u><s><code><pre><a>`); failure falls back to plain text. Emoji state machine: 👀received → ✍️processing → 👍done/💔failed.
