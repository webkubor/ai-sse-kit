<p align="right">English | <a href="./README.md">中文</a></p>

# ai-sse-kit

Progressive toolkit for AI streaming: SSE transport, protocol adapters
(OpenAI / Anthropic / custom JSON), and stream-safe message patching. The core is
framework-agnostic; React and Vue each get a thin binding on top.

> **Status: pre-alpha, not yet published to npm.** Core implementation (transport /
> adapters / apply / poll / chat-store) and both the React and Vue bindings are done,
> with 55 passing tests. The API may still change before a `0.1.0` release.
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

## License

MIT
