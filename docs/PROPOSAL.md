# ai-sse-kit 技术方案（草案）

> 目标：把 `modelgo-console-web` 里已经跑通、和具体业务无关的「AI 流式对话」处理逻辑抽成独立 npm 包，
> 供其他 AI 前端项目直接复用。本文档只定方向，不是最终实现，欢迎逐条打回。

## 1. 背景

`modelgo-console-web` 的模型体验模块（单模型页 / 对比页 / 平台助手）里，已经独立沉淀出三个跟具体
业务（埋点、计费、路由）无关的文件，各自解决过一个真实的重复问题：

| 文件 | 解决的问题 | 复用性 |
|---|---|---|
| `src/lib/stream-chat.ts` | SSE 字节流分帧 + OpenAI/自定义协议适配器 | 高，已在注释里明确写"协议无关" |
| `src/hooks/use-streaming-controller.ts` | keyed AbortController 生命周期管理（并发流、卸载自动清理） | 高，纯 React hook，无业务字段 |
| `src/lib/message-patch.ts` | 流式 delta 不可变 patch 进消息数组 | 高，只依赖 `{role}` / `{id}` 两个最小接口 |
| `src/pages/models/experience-run.ts` | 埋点字段映射、统计条拼装、视频任务轮询 | **低**，`trackModelRun`/`buildDialogueMetrics` 强耦合本产品的计费口径和埋点事件名；只有 `pollMediaTask` 的"轮询到终态"形状值得抽，但要去掉对 `getExperienceMessage` 这个具体接口的依赖 |

结论：**前三个文件是包的核心内容，第四个只贡献一个通用小工具（轮询），其余部分留在业务层**，不要为了"凑一个大包"硬拽计费/埋点逻辑进来。

## 2. 架构：三层，不做渲染

上一轮对齐时把方向从「buildPrompt / parseAIResponse / renderAIResult」调整为：

```
transport  →   parse   →   apply
(拉流+abort)  (协议适配)   (patch 进状态)
```

**渲染不进包**——原因是 `renderAIResult` 天然要求知道你用 React/Vue/Svelte，还要求知道你的消息组件长什么样。
这一步框架耦合躲不掉，索性交给消费方；包只交付到"消息状态已经是最新的"这一步。

```
┌─────────────┐     SSEEvent      ┌─────────────┐     delta 字符串    ┌─────────────┐
│  transport   │ ───────────────▶ │    parse     │ ──────────────────▶ │    apply     │
│ streamSSE    │                  │ createXxx    │                      │ patchLast    │
│ + abort 生命周期│                  │ Stream(适配器) │                      │ Assistant/ById│
└─────────────┘                  └─────────────┘                      └─────────────┘
      │                                                                       │
      └── AbortSignal 贯穿始终（fetch signal = controller.begin() 的返回值）────┘
```

### 2.1 transport（对应 `stream-chat.ts` 的 `streamSSE`/`readSSE` + `use-streaming-controller.ts`）

- `streamSSE(opts): AsyncGenerator<SSEEvent>` —— fetch + SSE 分帧一体化入口
- `readSSE(response): AsyncGenerator<SSEEvent>` —— 已有 Response 时单独分帧（同一 URL 可能降级 JSON 的场景）
- `useStreamingController<K>()` —— React hook，`begin/abort/abortAll/isActive`，卸载自动清理
- `isAbortError(err)` —— 统一的"是不是用户主动中断"判定

**需要解耦的点**（当前代码里跟 `modelgo-console-web` 绑定的地方）：
- `extractHTTPError` 里报错文案走 `i18n.t(...)`，包里要去掉这个依赖，改成"返回结构化错误信息，文案由调用方决定怎么显示"
- `credentials: 'include'` 默认值本身没问题，但要在文档里说清楚"这是给同域 cookie 鉴权场景的默认值，跨域/token 鉴权场景请显式传 headers 覆盖"

### 2.2 parse（对应 `stream-chat.ts` 的协议适配器部分）

- `createOpenAIStream(opts): AsyncGenerator<string>` —— OpenAI `chat.completion.chunk` 协议，认 `[DONE]`
- `createAnthropicStream(opts): AsyncGenerator<string>` —— **day-1 新增**，`event: content_block_delta` 取增量、`message_stop` 判结束。理由：ModelGo 控制台 API Keys 页的"标准协议接入"横幅本身就同时列 OpenAI + Anthropic 两个 Base URL，包只覆盖一半协议，自家网关场景就用不满
- `createCustomJSONStream(opts, config): AsyncGenerator<string>` —— 自研协议适配器（typeField/deltaField/doneField/errorField 可配置），对应现在客服接口那套
- 开放扩展点：新协议照抄 `createOpenAIStream` 的形状写一个 `createXxxStream`，不改 `streamSSE`
- **不做**：Vercel AI SDK 数据流协议留到有人真需要再加，day-1 不阻塞

### 2.3 apply（对应 `message-patch.ts`）

- `patchLastAssistant(list, patch, role?)` —— 流式回填的标准场景：改列表最后一条
- `patchMessageById(list, id, patch)` —— 按 id 定位（消息顺序不固定时）
- 两者都是纯函数，不依赖任何 UI 框架，找不到目标时返回原引用（不触发无谓重渲染）

### 2.4 （候选，独立于三层）poll —— 异步任务轮询

从 `pollMediaTask` 抽掉具体接口依赖后的通用版本：

```ts
pollUntil<T>(
  fetcher: () => Promise<T>,
  isTerminal: (result: T) => boolean,
  opts?: { intervalMs?: number, signal?: AbortSignal }
): Promise<T>
```

用于视频/图像生成这类"发起后要轮询任务状态直到终态"的场景，跟 SSE 流式是两种不同的传输方式，
放进同一个包但作为独立入口（不是 transport/parse/apply 三层的一部分）。

## 3. 渐进式 API：顶层封装 + 底层 primitive 两级

这是本次对齐加的一层，之前的方案只有第 2 节的三个 primitive——对建自定义协议的人足够"好理解好组合"，
但对刚装完包的人不算"好上手"：他还得自己把三层串起来才能跑第一个例子。参照 React Query / tRPC 的分层
思路，加一层默认封装，新手只看到它：

```ts
// 顶层：一个 hook 包好默认路径（OpenAI 协议 + patchLastAssistant + abort）
const { messages, send, stop, isStreaming } = useAIChat({
  url: '/api/chat',
  protocol: 'openai',        // 或传 parse 函数自定义
})
```

```ts
// 底层：需要自定义协议 / 自己管消息状态时，拆开三层自己拼（第 2 节的 primitive）
const stream = useStreamingController()
for await (const delta of createOpenAIStream({ url, body, signal: stream.begin() })) {
  setMessages(list => patchLastAssistant(list, m => ({ content: m.content + delta })))
}
```

`useAIChat` 内部就是调用第 2 节的三层 primitive，不是另一套实现——文档结构对应两级：
README 顶部只讲 `useAIChat`（5 行跑起来），底下单开一节「自定义协议 / 自己管状态」才展开 primitive。

## 4. 包结构

单包、无框架强依赖，React 部分用 subpath export 隔离：

```
ai-sse-kit/
├── src/
│   ├── transport.ts      # streamSSE, readSSE, isAbortError（框架无关）
│   ├── react.ts          # useStreamingController + useAIChat（唯二的 React 依赖点）
│   ├── adapters.ts       # createOpenAIStream, createCustomJSONStream
│   ├── apply.ts          # patchLastAssistant, patchMessageById
│   └── poll.ts           # pollUntil
├── package.json
└── README.md
```

`package.json` 的 `exports` 拆两个入口，`react.ts` 单独 subpath，非 React 项目（Vue/裸 JS）不会被迫装 React：

```json
{
  "exports": {
    ".": "./dist/index.js",        // transport + adapters + apply + poll
    "./react": "./dist/react.js"   // useStreamingController + useAIChat，peerDependency react
  }
}
```

参考本仓已有先例 `modelgo-design-tokens`（同样是从产品仓抽出的独立包，MIT、无 scope 前缀、`exports` 字段拆分入口）。

**工具链定案**：包管理用 pnpm（跟本仓其它项目一致，不为单个包换工具链），构建用 tsup
（基于 esbuild，一次出 ESM + CJS + `.d.ts` 三件套，是写 npm 库的标配）。不用 Bun 写/构建——
但包本身用到的 API（`fetch`/`ReadableStream`/`AbortController`）都是 Web 标准，装完在 Bun
项目里直接能跑，不需要专门适配。

## 5. 迁移路径

1. 在 `ai-sse-kit` 里从零写（不是复制粘贴），去掉 i18n 依赖、去掉对 `experience-sessions.ts` 类型的引用，改成包自己定义的最小接口类型
2. 补单测（`stream-chat.ts`/`message-patch.ts`/`use-streaming-controller.ts` 在原仓已有测试，可以照搬用例、换掉耦合部分）
3. `modelgo-console-web` 反向依赖这个包，删掉 `src/lib/stream-chat.ts` / `src/hooks/use-streaming-controller.ts` / `src/lib/message-patch.ts` 三个文件，验证单模型页/对比页/平台助手三处行为不变
4. 第 3 步是验证包设计是否真的够用的关键——如果发现某个接口在真实迁移时不够用，说明设计还需要改，不要在第 1 步就假装已经完美

## 6. 决策记录（原开放问题，已定案）

1. **包名**：最初占位名 `ai-stream-kit` 撞名——npm 上已有同名包，描述"Industrial-grade AI streaming
   SDK with SSE client..."跟本方案功能高度重叠。改用 **`ai-sse-kit`**（已核实 npm 未占用）。备选
   `stream-chat-kit` / `sse-chat-kit` / `ai-chat-kit` 也都可用，但 `ai-sse-kit` 不局限于"chat"场景，
   覆盖 `pollUntil` 更自然。**定案，目录/仓库名已用这个。**
2. **发布到 npm**：定为**公开发布**。目标用户是"外部开发者安装"，公开 npm 是唯一路径；流程参考
   `modelgo-design-tokens` 现成脚本。
3. **`pollUntil`**：放进包，作为独立的次要 export，不进 README 首屏（首屏只讲 `useAIChat`）。不单独
   起包——几行代码的工具单开一个包，多一套版本/CI/README 维护成本不成比例。
4. **仓库位置**：放 GitHub 个人账号 `webkubor`（不是公司 GitLab）——这是通用工具、给外部开发者装，
   不含 ModelGo 私有业务逻辑，跟 `vite-plugin-agent-eyes` 一样的先例。
