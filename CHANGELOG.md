# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-08-21

定位收窄。不是砍功能省事——是先看了竞争格局和唯一真实用户的用法，再决定这个包该停在哪一层。

判断依据两条：

1. **高层封装是巨头的主战场。** Vercel AI SDK 的 `useChat`、TanStack AI 的 `ChatClient`
   在「一个 hook 出聊天界面」这件事上做得远比这里彻底（provider 抽象、tool calling、
   持久化、可恢复流）。在这条线上竞争没有胜算。
2. **作者自己的生产项目就没用那个封装。** `modelgo-console-web` 三条链路（客服对话、
   模型体验、模型对比）全部用底层原语自己组装：`readSSE` / `streamSSE` /
   `createOpenAIStream` / `patchLastAssistant` / `patchMessageById` /
   `useStreamingController`，**一次都没用 `useAIChat`**。真实项目有自己的消息模型、
   会话管理、错误处理，通用封装装不下。作者都不用的 API，删掉不是损失。

于是本包明确停在「分帧 / 适配 / patch / 取消」这一层，消息模型归应用。

### Removed（breaking）

- `createAIChatStore` 及相关类型（`AIChatState` / `AIChatStore` / `AIChatStoreOptions` /
  `ChatMessage`）——托管消息状态就必须定义消息长什么样，而那正是通用方案最装不下、
  且多模态一来就要整体重写的部分。
- `useAIChat`（`/react` 与 `/vue` 两个绑定都移除）。迁移见 README「快速上手」：
  `createOpenAIStream` + `patchLastAssistant` + `useStreamingController` 三件套自己拼，
  比原封装多约 10 行，换来消息模型完全归你。
- `pollUntil`——异步任务轮询和 SSE 流式接收是两件事，混在一个包里只让定位更模糊。
  它只有 40 行，需要的话复制进项目比留在这里合适。

两个绑定里的 `useStreamingController` **原样保留**：它是绑定层唯一有存在理由的东西——
把 `abortAll()` 接到卸载 / scope dispose 上，这是框架无关核心做不到的。

### Changed

- `description` 与 README 重写：从「渐进式 AI 流式对话工具包」改为明确射程——
  「给**后端在自己手里**的项目做 AI 流式接收」，并**写清不做什么**（provider 抽象 /
  agent / 消息状态托管 / 平台绑定）。README 新增「先判断要不要用它」对照表，直接指出
  什么场景该去用 Vercel AI SDK、TanStack AI 或 eventsource-parser。
  少一个模糊的候选，比多一个抢不到的赛道有用。
- `keywords` 换成真实搜索词（`server-sent-events` / `eventsource` / `abortcontroller` /
  `deepseek`），去掉 `chat`——那个词的搜索结果被巨头占满，挂着没有意义。

### 迁移

只用底层原语的（如 modelgo）：**无需改动**，直接升级。
用过 `useAIChat` 的照 README 拼三件套；用过 `pollUntil` 的把那 40 行复制进项目。

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
