# AI Answer Metrics Display Design

Date: 2026-05-09

## Goal

Show per-answer AI execution data in the Web question UI:

- stage name
- elapsed time
- token usage when the upstream model/provider returns official usage

The visible feature is Web-only. The measurement source still lives in the desktop-side question pipeline because Web calls the desktop bridge for retrieval, context building, and model streaming.

The feature applies to both Web chat surfaces:

- the home knowledge-base question UI
- the project/workbench question UI

Those surfaces already share `ChatExperience`, `useQuestionSession`, and `ChatMessage`, so the implementation should add the display once in the shared message path.

## Decisions

1. The desktop side records answer metrics.
2. Metrics are attached to assistant messages and returned through the existing bridge/SSE flow.
3. Web renders metrics with the selected "reference-like, collapsed by default" layout:
   - answer content
   - references
   - answer data summary
   - answer actions
4. The answer data summary is one compact row by default and expands to stage details.
5. Token counts are shown only when official provider usage is available. No local token estimation is shown.
6. The setting is enabled by default and stored in Web `localStorage`.
7. Copying or saving an answer uses only the answer content and references; metrics are not written into copied text or Wiki pages.

## Non-Goals

- No billing or cost estimation.
- No token estimation from characters.
- No real-time stage progress UI during streaming.
- No desktop settings UI change.
- No migration is required for old messages; messages without metrics simply omit the panel.

## Architecture

The data flow remains the existing Web-to-desktop bridge:

1. Web `ChatExperience` sends a stream request.
2. Next route proxies the request to the desktop bridge.
3. Desktop `web-bridge-handler` calls `sendProjectChatMessage`.
4. `sendProjectChatMessage` measures stages while it builds context and streams the model response.
5. On completion, the assistant `DisplayMessage` contains `metrics`.
6. Rust bridge serializes the `done` SSE event with the full assistant message.
7. Web `desktop-question-api` parses the event and `useQuestionSession` stores the returned message.
8. `ChatMessage` renders the answer data panel when the Web setting is enabled.

This preserves a single source of truth: the desktop process knows what work actually happened; Web does not infer internal timings.

## Data Model

Add an optional metrics field to assistant messages on both desktop and Web types.

```ts
export interface AnswerTokenUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export interface AnswerMetricStage {
  id: string
  name: string
  durationMs: number
  tokenUsage?: AnswerTokenUsage
}

export interface AnswerMetrics {
  version: 1
  totalDurationMs: number
  stages: AnswerMetricStage[]
}
```

`metrics` is optional:

```ts
export interface DisplayMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
  conversationId: string
  references?: MessageReference[]
  metrics?: AnswerMetrics
}
```

The same shape should be mirrored through:

- `src/stores/chat-store.ts`
- `src/lib/web-bridge-handler.ts`
- `src-tauri/src/web_bridge.rs`
- `web/src/lib/types.ts`
- Web SSE parser tests and message rendering tests

Stage `id` values are stable internal identifiers. Stage `name` can be display-ready text from the desktop pipeline, but the Web UI may map known IDs to its own Chinese labels so the panel matches the surrounding Web interface.

## Stage Model

Initial stage set:

| Stage ID | Display Name | Notes |
| --- | --- | --- |
| `prepare_request` | Prepare request | Validate input, create/update conversation, persist user message. |
| `build_context` | Build context | Overall context preparation. Can include child work but is displayed as one user-facing stage if substage timings are too noisy. |
| `search_wiki` | Search wiki | Text search for relevant wiki pages. |
| `expand_graph` | Expand related pages | Graph relevance expansion. |
| `read_pages` | Read context pages | File reads and truncation for selected pages. |
| `model_generation` | Model generation | Provider request and response streaming. Official token usage belongs here when available. |

The implementation may omit stages that did not run. Greeting responses, for example, may skip wiki search and graph expansion.

Stages should be non-overlapping for display and fallback math. If detailed stages such as `search_wiki`, `expand_graph`, and `read_pages` are emitted, `build_context` should either be omitted or measured as exclusive coordination time only. Do not emit a parent duration that also includes child durations.

`totalDurationMs` should cover the full answer request from accepted input to assistant completion. If it is missing or invalid on the Web side, the UI can fall back to summing valid stage durations.

## Official Token Usage

Many streaming APIs do not return final usage by default. The implementation should expose official usage only where the provider parser can read it from a real provider response.

Rules:

- If official usage is available, attach it to `model_generation`.
- If only partial official fields are available, show only those fields.
- If official usage is unavailable, omit `tokenUsage`.
- Do not estimate tokens locally.
- Do not show `0 token` unless the provider explicitly reported zero.

Provider support can be incremental. The display must work even when all stages have timing only.

## Web Setting

Add a Web-only personal-center settings surface.

Recommended scope:

- The existing home sidebar `UserCircle` button opens a personal-center sheet or dialog.
- The personal center includes a `Settings` page/section.
- The first setting is `Show AI answer data`.
- Default is `true`.
- Persist to `localStorage`, for example under `llm-wiki-web.preferences.v1`.
- The setting is read by shared chat message rendering, so it applies to home and project/workbench question views.

This avoids changing desktop settings and keeps the feature scoped to Web UI preferences.

## Answer Data UI

Placement:

1. answer markdown
2. references panel, if references exist
3. answer metrics panel, if enabled and metrics exist
4. answer actions

Collapsed summary:

- label: localized Chinese copy for "Answer data"
- stage count
- total duration
- total official tokens if available
- expand/collapse affordance

Expanded details:

- one row per valid stage
- stage name
- formatted duration
- token fields for stages with official usage

Formatting:

- `durationMs < 1000`: show `123 ms`
- `durationMs >= 1000`: show one decimal second, for example `2.6 s`
- token values use locale grouping, for example `1,680`
- summary omits token text entirely when no official token usage exists

The visual style should follow `QuestionReferences`: small text, muted color, low visual weight, rounded 6-8 px, and compact spacing.

## Streaming Behavior

No real-time metrics panel is required during streaming.

During streaming:

- token events continue to update content
- references events continue to update references
- the temporary streaming message has no metrics

On `done`:

- the final assistant message includes `metrics`
- `useQuestionSession` replaces or appends the final message as it does today
- the metrics panel appears with the completed message

Regenerate follows the same behavior: the old assistant message is hidden during regeneration, then replaced with the newly generated message and its metrics.

## Error Handling

Web validation should be defensive:

- no `metrics`: render nothing
- unsupported `metrics.version`: render nothing
- invalid or negative duration: skip that value/stage
- empty stage list: render nothing unless `totalDurationMs` is valid
- invalid token usage fields: omit invalid fields
- malformed bridge payload: avoid throwing during render or SSE parsing

The question flow must not fail because metrics are missing or malformed.

## Test Plan

Desktop/unit:

- `sendProjectChatMessage` records metrics on successful responses.
- Greeting responses skip retrieval stages but still report total/model timing.
- Abort/error paths do not add misleading completed metrics.
- Message-to-bridge serialization includes optional `metrics`.

Rust bridge:

- `BridgeMessage` serializes and deserializes optional `metrics`.
- SSE `done` formatting includes metrics when present and remains compatible when absent.

Web client/session:

- SSE parser accepts `done.message.metrics`.
- `listQuestionMessages` returns messages with optional metrics.
- `useQuestionSession` includes metrics on completed streamed messages.
- Regenerate replaces the old message with new metrics.

Web UI:

- default setting is enabled.
- setting persists to localStorage.
- home and project chat both respect the same setting.
- metrics panel renders collapsed summary.
- expanded panel renders stage names, durations, and official token fields.
- no token text appears when token usage is absent.
- malformed metrics do not crash `ChatMessage`.

## Implementation Notes

- Existing generated text in some Web files appears mojibake in source. The implementation should avoid broad text rewrites and keep copy changes scoped to the new UI.
- Provider usage support should start with the providers whose stream parsers already expose usage or can expose it with a narrow change. It is acceptable for the first implementation to show timing-only metrics until official usage is available from a provider response.
