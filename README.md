<p align="right"><a href="./README.en.md">English</a> | 中文</p>

# ai-sse-kit

[![license](https://img.shields.io/github/license/webkubor/ai-sse-kit)](./LICENSE)
[![CI](https://github.com/webkubor/ai-sse-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/webkubor/ai-sse-kit/actions/workflows/ci.yml)

渐进式的 AI 流式对话工具包：SSE 传输、协议适配器（OpenAI / Anthropic / 自定义 JSON）、
流式消息不可变 patch。核心框架无关，React / Vue 各自提供薄绑定。

> **状态：pre-alpha，尚未发布到 npm。** 已完成核心实现（transport / adapters / apply /
> poll / chat-store）与 React、Vue 两套绑定，55 例单测全绿；发布前 API 仍可能调整。
> 完整技术方案见 [`docs/PROPOSAL.md`](./docs/PROPOSAL.md)，版本变更见 [`CHANGELOG.md`](./CHANGELOG.md)。

## 为什么

大多数"AI 聊天"前端都要手写同一套东西：解析 SSE 字节流、管理并发/可取消请求的
`AbortController` 生命周期、把 delta 不可变地 patch 进消息列表。`ai-sse-kit` 把这些
抽成一个小巧的框架无关核心，上面配一个默认封装的 hook/composable 覆盖常见场景。

## 快速上手

### React

```ts
import { useAIChat } from 'ai-sse-kit/react'

const { messages, send, stop, isStreaming } = useAIChat({
  url: '/api/chat',
  protocol: 'openai', // 或 'anthropic'，或传自己的 parse 函数
})
```

### Vue

```ts
import { useAIChat } from 'ai-sse-kit/vue'

const { messages, send, stop, isStreaming } = useAIChat({
  url: '/api/chat',
  protocol: 'openai',
})
// messages / isStreaming / error 是 ComputedRef，模板里直接 {{ messages }} 用
```

### 自定义协议 / 自己管消息状态

顶层 hook 只是把下面几个 primitive 拼起来——需要自定义协议、或者消息状态想自己管，
直接用框架无关的核心（`ai-sse-kit`，不带 `/react` `/vue` 后缀）：

```ts
import { createStreamingController, createOpenAIStream } from 'ai-sse-kit'
import { patchLastAssistant } from 'ai-sse-kit'

const stream = createStreamingController()
for await (const delta of createOpenAIStream({ url, body, signal: stream.begin() })) {
  setMessages((list) => patchLastAssistant(list, (m) => ({ content: m.content + delta })))
}
```

完整架构（三层设计、渐进式 API、包结构）见 [`docs/PROPOSAL.md`](./docs/PROPOSAL.md)。

## API 一览

| 导出 | 入口 | 作用 |
|---|---|---|
| `useAIChat` | `ai-sse-kit/react`、`ai-sse-kit/vue` | 顶层 hook/composable：默认协议+消息状态+abort 一次包好 |
| `useStreamingController` | `ai-sse-kit/react`、`ai-sse-kit/vue` | 同名，framework 生命周期版（卸载/scope dispose 自动清理） |
| `createAIChatStore` | `ai-sse-kit` | `useAIChat` 背后的框架无关引擎，自己接框架时用这个 |
| `createStreamingController` | `ai-sse-kit` | keyed `AbortController` 注册表，无框架依赖版 |
| `streamSSE` / `readSSE` | `ai-sse-kit` | SSE 拉流 + 分帧，协议无关 |
| `createOpenAIStream` | `ai-sse-kit` | OpenAI `chat.completion.chunk` 协议适配器 |
| `createAnthropicStream` | `ai-sse-kit` | Anthropic Messages API 流式协议适配器 |
| `createCustomJSONStream` | `ai-sse-kit` | 自定义 JSON-over-SSE 协议适配器（字段名可配置） |
| `patchLastAssistant` / `patchMessageById` | `ai-sse-kit` | 消息列表不可变 patch 工具 |
| `pollUntil` | `ai-sse-kit` | 异步任务轮询到终态（图片/视频生成等非流式场景） |
| `isAbortError` / `extractHTTPError` | `ai-sse-kit` | 错误判定 / HTTP 错误信息提取 |

## License

MIT
