# AGENTS.md — AI 助手工作守则

## 这是什么

ai-sse-kit —— 框架无关的 AI 流式接收工具包：SSE 分帧、协议适配（OpenAI / Anthropic / 自定义）、
消息不可变 patch、取消生命周期。定位是「后端在自己手里」的项目自己组装流式接口，
不替你做_provider 路由、不碰计费。

## 关键文件

- `src/`：源码（分帧器 / patch 语义 / 适配器都在这里，入口见 package.json `exports`）。
- `test/` 与 `npm run test`：行为契约测试 —— patch 语义的边界用例都在测试里，改 patch 实现前先读测试。
- `docs/`：协议适配说明。
- `README.md` / `README.en.md`：双语 README，两边必须同步改。

## 常用命令

```bash
pnpm build        # 构建
pnpm test         # 契约测试
pnpm typecheck    # 类型检查（发布前必过）
```

## 约定

- **消息 patch 不可变**是本包的核心承诺，任何改动不得引入原地修改。
- 协议适配只做「传输层」，不掺业务语义；新增协议先在 docs 里写清楚边界。
- 版本与 CHANGELOG 走既有发布流程，不手改历史。
