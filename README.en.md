<p align="right">English | <a href="./README.md">中文</a></p>

# ai-sse-kit

[![npm](https://img.shields.io/npm/v/ai-sse-kit)](https://www.npmjs.com/package/ai-sse-kit)
[![license](https://img.shields.io/github/license/webkubor/ai-sse-kit)](./LICENSE)
[![CI](https://github.com/webkubor/ai-sse-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/webkubor/ai-sse-kit/actions/workflows/ci.yml)

Progressive toolkit for AI streaming: SSE transport, protocol adapters
(OpenAI / Anthropic / custom JSON), and stream-safe message patching. The core is
framework-agnostic; React and Vue each get a thin binding on top.

```bash
npm install ai-sse-kit
```

> **Status: pre-alpha, the API may still change before `1.0`.** Validated by migrating
> a real consumer (`modelgo-console-web`) onto it — replaced 886 lines across 3 local
> files, with typecheck/lint/tests/production build/browser end-to-end all passing.
> Full design doc: [`docs/PROPOSAL.md`](./docs/PROPOSAL.md). Changes: [`CHANGELOG.md`](./CHANGELOG.md).

## Why

Most "AI chat" frontends end up writing the same three things by hand: parsing an SSE
byte stream, managing `AbortController` lifecycles for concurrent/cancelable requests,
and immutably patching a message list as deltas arrive. `ai-sse-kit` extracts these
into a small, framework-agnostic core, with a single opinionated hook/composable on
top for the common case.

## Quick start

### React

```ts
import { useAIChat } from 'ai-sse-kit/react'

const { messages, send, stop, isStreaming } = useAIChat({
  url: '/api/chat',
  protocol: 'openai', // or 'anthropic', or your own parse function
})
```

### Vue

```ts
import { useAIChat } from 'ai-sse-kit/vue'

const { messages, send, stop, isStreaming } = useAIChat({
  url: '/api/chat',
  protocol: 'openai',
})
// messages / isStreaming / error are ComputedRefs — use directly in a template
```

### Custom protocol / your own message-state shape

The top-level hook is just the primitives below wired together. If you need a custom
protocol, or want to manage message state yourself, use the framework-agnostic core
directly (`ai-sse-kit`, no `/react` or `/vue` suffix):

```ts
import { createStreamingController, createOpenAIStream, patchLastAssistant } from 'ai-sse-kit'

const stream = createStreamingController()
for await (const delta of createOpenAIStream({ url, body, signal: stream.begin() })) {
  setMessages((list) => patchLastAssistant(list, (m) => ({ content: m.content + delta })))
}
```

Full architecture (three-layer design, progressive API, package structure) is in
[`docs/PROPOSAL.md`](./docs/PROPOSAL.md).

## API overview

| Export | Entry point | What it does |
|---|---|---|
| `useAIChat` | `ai-sse-kit/react`, `ai-sse-kit/vue` | Top-level hook/composable: default protocol + message state + abort, batteries included |
| `useStreamingController` | `ai-sse-kit/react`, `ai-sse-kit/vue` | Same, with framework lifecycle (auto cleanup on unmount/scope dispose) |
| `createAIChatStore` | `ai-sse-kit` | The framework-agnostic engine behind `useAIChat` — use this to bind your own framework |
| `createStreamingController` | `ai-sse-kit` | Keyed `AbortController` registry, no framework dependency |
| `streamSSE` / `readSSE` | `ai-sse-kit` | SSE fetch + framing, protocol-agnostic |
| `createOpenAIStream` | `ai-sse-kit` | OpenAI `chat.completion.chunk` protocol adapter |
| `createAnthropicStream` | `ai-sse-kit` | Anthropic Messages API streaming protocol adapter |
| `createCustomJSONStream` | `ai-sse-kit` | Configurable custom JSON-over-SSE protocol adapter |
| `patchLastAssistant` / `patchMessageById` | `ai-sse-kit` | Immutable message-list patch helpers |
| `pollUntil` | `ai-sse-kit` | Poll an async job to a terminal state (image/video generation, etc.) |
| `isAbortError` / `extractHTTPError` | `ai-sse-kit` | Abort detection / structured HTTP error extraction |

## License

MIT
