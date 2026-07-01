# UE Coworker — Agent Loop, Token Assembly & Prompt Cache

The core is `src/main/agent-loop.ts` (`runAgentLoop`), invoked by the `agent:send` IPC. Messages sent to the LLM are assembled in a local array in a fixed order; the renderer's `buildReplayMessages` (ChatView.tsx) pre-rebuilds history into OpenAI-chat shape (with `tool_calls`/`tool_call_id`) before it reaches main.

## System-prompt blocks — order and why

Pushed as SEPARATE `role:"system"` messages, in this exact order:

1. Main system prompt (`buildSystemPrompt`)
2. `skillsBlock` — skills progressive-disclosure layer 1
3. `agentsBlock` — sub-agent roster
4. `memoryBlock` — CLAUDE.md + memory Tier 0 index
5. Image-gen capability hint (if image providers configured)
6. — then conversation history (user/assistant/tool) —
7. SessionStart / UserPromptSubmit hook additionalContext
8. todos roadmap (VOLATILE — placed AFTER history on purpose)

Blocks 1–5 sit BEFORE history so they land in the Anthropic prompt-cache stable prefix ("2nd turn onward marginal cost ≈ 0"). They are byte-stable for a given config. todos (#8) is placed after history because it changes every turn — volatile content must fall after the cache breakpoint as a tail increment.

`buildSystemPrompt` appends an "About this app" self-doc section (byte-stable, no runtime data) plus the working dir and a DAY-precision date.

## Prompt cache strategy (app-specific — critical)

cache_control `{type:"ephemeral"}` breakpoints in `toAnthropicRequest`. Anthropic allows 4; this app sets 3:
1. On the LAST tool definition (tools are most stable)
2. On the merged system block (all system messages combined into one text block)
3. On the SECOND-TO-LAST message — so each turn's new tail becomes the cache increment while the stable prefix keeps being reused. (Not the last message; <2 messages = no breakpoint.)

**Why the date is day-only:** the date string sits inside the cache_control system prompt. A minute/second timestamp would change bytes every turn, byte-breaking the entire cached prefix and forcing full-price recompute of system+history.

**Iron rules to not bust cache:**
- NEVER drop history images (`enforceImageCap` is retired) — rewriting an already-cached history message busts the prefix (measured once ~80k tokens full-price). Images leave only when their old messages leave via `/compact`.
- History image base64 goes through an LRU cache (key = path+mtime+size) for byte-identical replay across turns; cross-turn rebuild uses the same deterministic read→downscale transform.
- Mid-conversation system injections (todos, Pre/PostToolUse hook additionalContext) are inlined as user messages at their original position (Anthropic `seenConv` flag) so they fall AFTER the history breakpoint as tail increments.
- Switching `thinking` only invalidates that turn's messages cache; system+tools prefix is unaffected.

## Tool-call loop

`while (iteration < maxIterations)` (cap 100 as a safety net). Each turn: stream → assistantMsg → push; if no tool_calls, that's the final answer (break). Per tool: emit → execute → push `{role:"tool", tool_call_id, content}`.

Virtual/interactive tools are intercepted BEFORE executeTool (each pushes a tool result and continues): `ask_followup_question`, `enter_plan_mode` (changes mode same turn), `exit_plan_mode`, `update_todos`, `checklist_read/submit`, `task` (sub-agent).

**Loop guards (app-specific):**
- No-progress: same tool signature (`name:args`) 5 times in a row → break.
- Deny-streak: 5 consecutive mode-`deny` (params ignored — model keeps changing the file it tries to write) → stop. User-declines don't count.
- On break, an `agent:error` is emitted so it isn't mistaken for a normal finish.

**task fan-out:** multiple `task` calls in one turn — all read-only → `Promise.all` concurrent; any writable → serial promise chain (write conflicts structurally eliminated). Await/backfill stays in per-call order so pairing isn't scrambled.

## Approval round-trip & abort

`decideToolAction` → allow/ask/deny. `ask` → `requestApproval` (ipc-handlers): a Promise on a one-shot IPC channel `agent:tool-approval-response:<callId>`; sends `agent:tool-approval-request` (desktop card). 5-min timeout → declined; `controller.signal` abort also resolves false (else abort wouldn't work while waiting). Dual channel: remote (Discord/Telegram) approval button card sent simultaneously — whichever answers first wins.

Abort: one `AbortController` per session in `runningLoops` Map (single-flight lock). `agent:stop` → `abort()`. `streamCompletion` registers `onAbort` at REQUEST level so even during TTFB (before headers) it destroys the socket and resolves partial text. `finally` deletes from runningLoops and emits authoritative `agent:run-state {running:false}` — the only reliable trigger to restore send/stop buttons.

## Transport retry

`streamCompletionWithRetry` retries ONLY `err.retryable` (connection failure / 5xx / 429 AND no text streamed yet) with exponential backoff ×3. Never repeats already-shown content. Abort stops immediately. Context-overflow errors are NOT retried at transport layer (they trigger front-end auto-compact instead).

## Token estimation

- `estimateTokens`: lazy `js-tiktoken` `o200k_base`, fallback chars/4.
- Images counted at 1300 tokens/image flat.
- `splitContextTokens`: after provider returns exact `prompt_tokens`, splits it proportionally across system/tools/history for `/context` display.
- usage compatibility: Anthropic `cache_creation/read_input_tokens` vs OpenAI `prompt_tokens_details.cached_tokens`. `lastContextTokens` = this round's input (real window); `turnPromptTokens` = accumulated across tool iterations (billing).
