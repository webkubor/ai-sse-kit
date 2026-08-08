# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-08-08

Fixes and additions from a real integration (hym-admin's assistant chat), not
speculative — every change below traces back to a friction point actually hit while
wiring `ai-sse-kit` into a reasoning-model backend with a custom side-channel event.

### Added

- `AdapterOptions.onReasoning` — called for each reasoning/thinking delta on protocols
  that stream it separately from the final answer (OpenAI-compatible
  `delta.reasoning_content`, Anthropic extended-thinking `thinking_delta`). Not yielded
  from the generator, so existing consumers that concatenate every yielded value into
  "the reply" see no change just from upgrading.
- `AdapterOptions.onEvent` — called for each raw SSE frame an adapter doesn't itself
  interpret as content/reasoning/done/error. Covers app-injected side-channel events
  mixed into an otherwise-standard stream (e.g. a one-off `event: card` frame carrying
  structured data alongside normal `chat.completion.chunk` frames). Each protocol's own
  bookkeeping event names are still swallowed as before — this only fires for names
  the protocol doesn't already account for.
- `CustomJSONStreamConfig.reasoningType` / `reasoningField` — same reasoning routing,
  configurable field names, for self-rolled JSON-over-SSE protocols.
- `ChatMessage.reasoning` (optional) — `createAIChatStore`'s `send()` now auto-accumulates
  `onReasoning` deltas into this field on the in-flight assistant message.
- `AIChatStoreOptions.onEvent` — forwarded straight through to the adapter's `onEvent`.

### Changed

- **Breaking (behavioral default):** `streamSSE`/`StreamSSEOptions.credentials` no longer
  defaults to `'include'`. Left unset, `fetch`'s own default (`'same-origin'`) applies.
  Cookie-auth setups that relied on the old default should now pass `credentials: 'include'`
  explicitly. Rationale: most AI backends use `Authorization`-header token auth, and
  `'include'` on a cross-origin request without matching CORS config on the server just
  fails the preflight — the old default was a footgun for the more common case.

### Fixed

- `extractHTTPError` now recognizes the flat `{ error: "message text" }` shape (`error`
  as a bare string), not just `{ error: { message } }`. A lot of minimal backends return
  the former; it was silently falling through to a generic `HTTP {status}` message.

## [0.1.0] - 2026-08-08

First published release. Pre-alpha — the API may still change before `1.0`.

### Added

- Core, framework-agnostic transport: `streamSSE`, `readSSE` — SSE byte-stream framing
  per spec, protocol-blind.
- Protocol adapters: `createOpenAIStream`, `createAnthropicStream`, `createCustomJSONStream`.
- `createStreamingController` — keyed `AbortController` lifecycle registry.
- `patchLastAssistant`, `patchMessageById` — immutable chat-message-list patch helpers.
- `pollUntil` — generic "poll until terminal state" for async job-style results
  (image/video generation, background tasks).
- `createAIChatStore` — the framework-agnostic engine behind `useAIChat`.
- React bindings (`ai-sse-kit/react`): `useAIChat`, `useStreamingController`.
- Vue bindings (`ai-sse-kit/vue`): `useAIChat`, `useStreamingController`.
- Full test suite (55 tests) covering the core, both protocol adapters, and both
  framework bindings.
- CI (GitHub Actions): typecheck + test + build on every push/PR to `main`.

[0.2.0]: https://github.com/webkubor/ai-sse-kit/releases/tag/v0.2.0
[0.1.0]: https://github.com/webkubor/ai-sse-kit/releases/tag/v0.1.0
