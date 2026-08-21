<p align="right"><a href="./README.en.md">English</a> | 中文</p>

# ai-sse-kit

[![npm](https://img.shields.io/npm/v/ai-sse-kit)](https://www.npmjs.com/package/ai-sse-kit)
[![license](https://img.shields.io/github/license/webkubor/ai-sse-kit)](./LICENSE)
[![CI](https://github.com/webkubor/ai-sse-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/webkubor/ai-sse-kit/actions/workflows/ci.yml)

**给「后端在自己手里」的项目做 AI 流式接收。** SSE 分帧、协议适配、消息不可变 patch、
取消生命周期——四件事，框架无关，React / Vue 各一个薄绑定。

**不做** provider 抽象、不做 agent / tool calling、不做消息状态托管、不绑部署平台。

```bash
npm install ai-sse-kit
```

## 先判断要不要用它

这个包只覆盖「**你的后端已经在吐 SSE，前端要把它变成界面**」这一段。

| 你的情况 | 用什么 |
|---|---|
| 前端直连 OpenAI / Anthropic / DeepSeek 等厂商 | [Vercel AI SDK](https://ai-sdk.dev)（provider 抽象、AI Gateway 都是现成的） |
| 要 agent 循环、tool calling、RAG 编排 | Vercel AI SDK / [TanStack AI](https://tanstack.com/ai) / LangChain.js |
| 想要一个 `useChat` 直接出聊天界面 | Vercel AI SDK 的 `useChat` |
| **后端是自己的网关**，只需要前端可靠地收流、拼消息、能取消 | **这个包** |
| 只想要一个 SSE 解析器，别的都不要 | [eventsource-parser](https://github.com/rexxars/eventsource-parser) |

差别在于：**你的后端已经决定了协议和鉴权**，前端不需要再套一层 provider 抽象——套了反而
要为自家网关写 custom provider。这个包假设那一层归你，只把 fetch → 分帧 → patch → 取消
这段重复劳动收走。

> **状态：pre-alpha，API 仍可能在 `1.0` 前调整。** 在
> [`modelgo-console-web`](https://github.com/webkubor) 生产使用中——客服对话、模型体验、
> 模型对比三条链路，替换掉原有 3 个本地文件共 886 行。
> 变更记录见 [`CHANGELOG.md`](./CHANGELOG.md)。

## 快速上手

典型用法是拿原语自己组装——**你保留自己的消息模型**：

```ts
import { createOpenAIStream, patchLastAssistant, isAbortError } from 'ai-sse-kit'
import { useStreamingController } from 'ai-sse-kit/react' // Vue 用 'ai-sse-kit/vue'

const stream = useStreamingController() // 卸载时自动 abortAll

async function send(input: string) {
  try {
    for await (const delta of createOpenAIStream({
      url: '/api/chat',
      body: { messages: [...history, { role: 'user', content: input }] },
      signal: stream.begin(), // 再次调用会先中断上一次
    })) {
      setMessages((list) => patchLastAssistant(list, (m) => ({ content: m.content + delta })))
    }
  } catch (err) {
    if (!isAbortError(err)) showError(err) // 点了停止不算错误
  }
}
```

列表里每行独立流式（比如多模型对比），用 keyed 控制器：

```ts
const stream = useStreamingController<number>()
stream.begin(rowIndex)   // 只中断这一行的上一次请求
stream.abort(rowIndex)   // 停某一行
stream.abortAll()        // 全停
```

### 推理内容 / 自定义旁路事件

推理模型（deepseek-v4、Anthropic 扩展思考）把「思考过程」和「最终回答」分开吐；后端有时
还会往标准协议流里混一帧自定义事件（比如查好的结构化数据，不想等模型转述）。两者都不污染
主 delta 流，走独立回调：

```ts
for await (const delta of createOpenAIStream({
  url, body, signal,
  onReasoning: (text) => setThinking((t) => t + text), // reasoning_content，不算进正文
  onEvent: (ev) => {                                    // 非 'message' 帧，比如 event: card
    if (ev.event === 'card') renderCard(JSON.parse(ev.data))
  },
})) {
  setReply((r) => r + delta) // 只有最终回答到这里
}
```

### 自定义协议

后端是自己拍的 JSON-over-SSE？配字段名就行，不用写适配器：

```ts
import { createCustomJSONStream } from 'ai-sse-kit'

for await (const delta of createCustomJSONStream(
  { url, body, signal },
  { typeField: 'kind', deltaField: 'text', deltaType: 'chunk', doneType: 'eof', errorType: 'err' },
)) { ... }
```

再复杂（多种 delta、工具调用）就直接基于 `streamSSE` 写自己的 `createXxxStream`——
适配器就是个 `AsyncGenerator`，没有框架可继承。

## API

| 导出 | 入口 | 作用 |
|---|---|---|
| `streamSSE` | `ai-sse-kit` | fetch + 分帧一步到位（最常用入口） |
| `readSSE` | `ai-sse-kit` | 只分帧，response 自己 fetch（同一 URL 有时返 JSON 时用） |
| `createOpenAIStream` | `ai-sse-kit` | OpenAI `chat.completion.chunk` 协议 |
| `createAnthropicStream` | `ai-sse-kit` | Anthropic Messages API 流式协议 |
| `createCustomJSONStream` | `ai-sse-kit` | 自定义 JSON-over-SSE，字段名可配 |
| `createStreamingController` | `ai-sse-kit` | keyed `AbortController` 注册表，无框架依赖 |
| `useStreamingController` | `ai-sse-kit/react`、`/vue` | 同上 + 卸载 / scope dispose 自动清理 |
| `patchLastAssistant` / `patchMessageById` | `ai-sse-kit` | 消息列表不可变 patch |
| `isAbortError` / `extractHTTPError` | `ai-sse-kit` | 取消判定 / HTTP 错误信息提取 |

## 设计取舍

- **不用 ky/axios 包一层**：它们读完整个 body 才返回，直接废掉流式。流式只能 `fetch` +
  手动读 `Response.body`。
- **`credentials` 默认不设**：多数 AI 后端用 `Authorization` 头，强行 `'include'` 会让跨域
  预检直接失败。cookie 鉴权的显式传 `'include'`。
- **控制器不管「是否正在流式」这个 UI 状态**：不同应用形状差太多（一个布尔 / 每行一个 /
  和非流式路径共用 loading），固定一种反而没法用。它只管 `AbortController` 生命周期。
- **没有 `useAIChat`**：消息模型（消息长什么样、历史怎么存、错误怎么冒泡）恰恰是通用 hook
  最装不下的部分，也是巨头做得远比这里彻底的部分。本包停在下一层：分帧、patch、取消。

## License

MIT
