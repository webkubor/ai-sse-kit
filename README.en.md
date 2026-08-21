<p align="right">English | <a href="./README.md">中文</a></p>

# ai-sse-kit

[![npm](https://img.shields.io/npm/v/ai-sse-kit)](https://www.npmjs.com/package/ai-sse-kit)
[![license](https://img.shields.io/github/license/webkubor/ai-sse-kit)](./LICENSE)
[![CI](https://github.com/webkubor/ai-sse-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/webkubor/ai-sse-kit/actions/workflows/ci.yml)

**AI streaming primitives for apps that own their own backend.** SSE framing, protocol
adapters, immutable message patching, cancellation lifecycle — four things, framework-agnostic,
with a thin React and Vue binding each.

**No** provider abstraction, no agent/tool-calling layer, no message-state ownership, no
platform lock-in.

```bash
npm install ai-sse-kit
```

## Is this the right package for you?

It covers exactly one segment: **your backend already streams SSE, and the frontend has to
turn that into UI.**

| Your situation | Use |
|---|---|
| Frontend talks directly to OpenAI / Anthropic / DeepSeek | [Vercel AI SDK](https://ai-sdk.dev) — provider abstraction and AI Gateway come for free |
| You need agent loops, tool calling, RAG orchestration | Vercel AI SDK / [TanStack AI](https://tanstack.com/ai) / LangChain.js |
| You want one `useChat` that renders a whole chat UI | Vercel AI SDK's `useChat` |
| **Your backend is your own gateway**; the frontend just needs to receive the stream reliably, patch messages, and cancel | **this package** |
| You only want an SSE parser, nothing else | [eventsource-parser](https://github.com/rexxars/eventsource-parser) |

The distinction: **your backend already decided the protocol and the auth**, so the frontend
doesn't need another provider abstraction on top — adding one would mean writing a custom
provider for your own gateway. This package assumes that layer is yours, and only takes away
the repetitive fetch → frame → patch → cancel work.

> **Status: pre-alpha, API may still shift before `1.0`.** In production use in
> [`modelgo-console-web`](https://github.com/webkubor) across three flows — support chat,
> model playground, model comparison — replacing 886 lines across 3 local files.
> See [`CHANGELOG.md`](./CHANGELOG.md).

## Quick start

The typical shape is assembling the primitives yourself — **you keep your own message model**:

```ts
import { createOpenAIStream, patchLastAssistant, isAbortError } from 'ai-sse-kit'
import { useStreamingController } from 'ai-sse-kit/react' // or 'ai-sse-kit/vue'

const stream = useStreamingController() // abortAll() on unmount

async function send(input: string) {
  try {
    for await (const delta of createOpenAIStream({
      url: '/api/chat',
      body: { messages: [...history, { role: 'user', content: input }] },
      signal: stream.begin(), // calling again aborts the previous request first
    })) {
      setMessages((list) => patchLastAssistant(list, (m) => ({ content: m.content + delta })))
    }
  } catch (err) {
    if (!isAbortError(err)) showError(err) // hitting stop isn't an error
  }
}
```

For a list where each row streams independently (e.g. comparing models side by side), use a
keyed controller:

```ts
const stream = useStreamingController<number>()
stream.begin(rowIndex)   // aborts only this row's previous request
stream.abort(rowIndex)   // stop one row
stream.abortAll()        // stop everything
```

### Reasoning content / side-channel events

Reasoning models (deepseek-v4, Anthropic extended thinking) stream "thinking" separately from
the final answer; backends sometimes also mix a custom frame into an otherwise-standard stream
(e.g. structured data already fetched, so the UI doesn't wait for the model to describe it).
Neither pollutes the main delta stream — both go to their own callback:

```ts
for await (const delta of createOpenAIStream({
  url, body, signal,
  onReasoning: (text) => setThinking((t) => t + text), // reasoning_content, not part of the reply
  onEvent: (ev) => {                                    // non-'message' frames, e.g. event: card
    if (ev.event === 'card') renderCard(JSON.parse(ev.data))
  },
})) {
  setReply((r) => r + delta) // only the final answer arrives here
}
```

### Custom protocols

Rolled your own JSON-over-SSE? Configure the field names instead of writing an adapter:

```ts
import { createCustomJSONStream } from 'ai-sse-kit'

for await (const delta of createCustomJSONStream(
  { url, body, signal },
  { typeField: 'kind', deltaField: 'text', deltaType: 'chunk', doneType: 'eof', errorType: 'err' },
)) { ... }
```

Anything richer (multiple delta kinds, tool calls) — write your own `createXxxStream` on top of
`streamSSE`. An adapter is just an `AsyncGenerator`; there's no framework to inherit from.

## API

| Export | Entry | Purpose |
|---|---|---|
| `streamSSE` | `ai-sse-kit` | fetch + frame in one call (the common entry point) |
| `readSSE` | `ai-sse-kit` | framing only, you fetch the response (for URLs that sometimes return JSON) |
| `createOpenAIStream` | `ai-sse-kit` | OpenAI `chat.completion.chunk` protocol |
| `createAnthropicStream` | `ai-sse-kit` | Anthropic Messages API streaming protocol |
| `createCustomJSONStream` | `ai-sse-kit` | custom JSON-over-SSE, configurable field names |
| `createStreamingController` | `ai-sse-kit` | keyed `AbortController` registry, no framework |
| `useStreamingController` | `ai-sse-kit/react`, `/vue` | same + automatic cleanup on unmount / scope dispose |
| `patchLastAssistant` / `patchMessageById` | `ai-sse-kit` | immutable message-list patching |
| `isAbortError` / `extractHTTPError` | `ai-sse-kit` | cancellation check / HTTP error extraction |

## Design decisions

- **No ky/axios wrapper**: they read the entire body before returning, which defeats streaming.
  Streaming needs raw `fetch` plus a manual `Response.body` reader.
- **`credentials` unset by default**: most AI backends use `Authorization` headers; forcing
  `'include'` fails the CORS preflight unless the backend opted in. Pass `'include'` explicitly
  for cookie auth.
- **The controller doesn't own "is streaming" UI state**: apps shape that too differently (one
  boolean / one per row / shared with a non-streaming path), so baking in one shape makes it
  unusable for the rest. It owns only the `AbortController` lifecycle.
- **No `useAIChat`**: the message model (what a message is, how history is kept, how errors
  surface) is precisely where a generic hook stops fitting real apps — and precisely what the
  big frameworks already do far more thoroughly. This package stays one layer below: framing,
  patching, cancellation.

## License

MIT
