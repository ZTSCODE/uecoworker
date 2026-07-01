# UE Coworker — Providers & Protocol Adaptation

A "Provider" is a model endpoint you configure (each has its own API key + balance). The protocol is chosen by `provider.protocol`. All streaming is hand-written SSE over Node `https.request` (not fetch); every protocol resolves to ONE unified OpenAI-shape `ChatMessage` so the main loop stays protocol-agnostic.

## Three protocols

| protocol | endpoint | auth |
|---|---|---|
| `"anthropic"` | `POST <root>/v1/messages` | `x-api-key` + `anthropic-version` |
| `"responses"` | `POST <root>/v1/responses` | Bearer |
| default (OpenAI-compatible) | `POST <root>/v1/chat/completions` | Bearer |

baseUrl auto-appends `/v1`. `provider.headers` overrides custom headers. Image/raw endpoints are orthogonal (image generation uses the standard `/v1/images/generations`).

## Request-body differences (this is the app-specific part)

| dimension | Anthropic | Responses | OpenAI-compat |
|---|---|---|---|
| system | top-level `system: [{type:text, cache_control}]`; mid-conversation system inlined as user | `instructions` string; mid-conv system inlined as user input_text | kept as `role:"system"` in place |
| assistant tool_calls | `tool_use` content block | `{type:"function_call", call_id, name, arguments}` each | native `tool_calls` |
| tool result | user message `tool_result` block | `{type:"function_call_output", call_id, output}` | native `role:"tool"` |
| tool returns image | image block SIBLING to tool_result (NOT nested — relay proxies strip nested images) | output array `input_image` | NOT supported — stripped + text placeholder |
| user image | image_url dataURL → image block | `input_image` | native image_url |
| thinking | thinking block prepended to content (signature verbatim) | ignored | stripped; assistant+tool_calls gets `reasoning_content:""` to satisfy DeepSeek |
| max_tokens | `anthropicMaxTokens(model)` inferred by model name | none | none |
| thinking param | `anthropicThinkingConfig` (adaptive vs budget by model) | `reasoning:{effort}` | `reasoning_effort` |
| usage request | SSE built-in | SSE built-in | `stream_options:{include_usage:true}` |
| adjacent same-role | merged (Anthropic requires alternation) + tool_result reordered first | no | no |

**Anthropic thinking config** (by model name): budget models (3.7/4.0/4.1/opus-4.5/haiku-4.5...) send `{type:"enabled", budget_tokens}` (budget MUST be < max_tokens, clamped [1024,32000]); adaptive models (opus 4.6+/sonnet 4.6/unknown default) send `{type:"adaptive", display:"summarized"}`. Sending the wrong shape → 400.

**Anthropic multi-image reorder:** when multiple tools return images, the interleaved `[tr_A,img_A,tr_B,img_B]` is stably reordered to `[tr_A,tr_B,img_A,img_B]` (Anthropic requires tool_result blocks first in a user message).

## SSE parsing per protocol (in streamCompletion)

- **Anthropic** typed events: `message_start`→usage; `content_block_start`→tool_use/thinking/redacted_thinking; `content_block_delta`→text_delta / input_json_delta (tool args) / thinking_delta / signature_delta (accumulated verbatim, never parsed); `message_delta`→output_tokens+stop_reason. End: synthesizes OpenAI-style `prompt_tokens = input + cacheCreate + cacheRead`.
- **Responses** typed events: `response.output_text.delta`; `response.output_item.added`→function_call (tracks output_index); `response.function_call_arguments.delta`→accumulate by output_index; `response.completed`→usage.
- **OpenAI-compat**: `choices[0].delta` — `delta.content`, `delta.reasoning_content`/`delta.reasoning` (DeepSeek thinking), `delta.tool_calls[]` accumulated by index. usage in final frame.

tool_calls accumulate in `toolAcc: Record<number, ToolCall>` by index/output_index; arguments string is concatenated incrementally.

## Common failure causes (app-specific, not generic HTTP)

- **Wrong thinking shape** → 400. The model/protocol mismatch (e.g. budget shape sent to an adaptive-only model) is the usual cause.
- **Empty stream** (200 but no content and no tool_calls) → explicitly raised as an error; check transport-logs `raw`. Often a low-quality relay/proxy that drops the body, or the model emitting literal `<tool_call>` text instead of structured calls (relay quality issue, not a code bug — switching to a correct API fixes it).
- **Context overflow** identified by very broad CN/EN keyword match on the error body (`isContextOverflowError`) → tagged `context_overflow`, triggers front-end auto-compact, NOT transport retry.
- **Nested tool-result images getting dropped** → Anthropic path deliberately puts images as siblings; if a proxy still strips them, that's the proxy.
- **413 / body too large** → check transport-logs `bodyBytes`; usually too many/too-large images in history.
- Balance not showing → custom balance script must substitute `{{apiKey}}`/`{{baseUrl}}`; provider-store filters balances outside -100~999 as dirty data.
