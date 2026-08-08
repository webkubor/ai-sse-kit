# ai-sse-kit

Progressive toolkit for AI streaming in the browser: SSE transport, protocol adapters
(OpenAI / Anthropic / custom JSON), and stream-safe message patching.

> **Status: pre-alpha / design stage.** This repo currently holds the technical design
> only — no implementation yet. See [`docs/PROPOSAL.md`](./docs/PROPOSAL.md) for the
> full plan and rationale. Star/watch if you want to follow along; issues and design
> feedback are welcome before the first line of code lands.

## Why

Most "AI chat" frontends end up writing the same three things by hand: parsing an SSE
byte stream, managing `AbortController` lifecycles for concurrent/cancelable requests,
and immutably patching a message list as deltas arrive. `ai-sse-kit` extracts these into
a small, framework-agnostic core, with a single opinionated hook on top for the common
case.

## Planned API shape

```ts
// Top level — the 80% case, one hook
const { messages, send, stop, isStreaming } = useAIChat({
  url: '/api/chat',
  protocol: 'openai', // or 'anthropic', or a custom parse function
})
```

```ts
// Primitives — when you need a custom protocol or your own state shape
const stream = useStreamingController()
for await (const delta of createOpenAIStream({ url, body, signal: stream.begin() })) {
  setMessages((list) => patchLastAssistant(list, (m) => ({ content: m.content + delta })))
}
```

Full architecture (transport → parse → apply, package structure, migration path) is in
[`docs/PROPOSAL.md`](./docs/PROPOSAL.md).

## License

MIT
