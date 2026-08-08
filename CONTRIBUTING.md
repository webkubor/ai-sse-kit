# Contributing

Thanks for taking a look. This project is pre-alpha — the API surface may still
change before `0.1.0`, so please open an issue to discuss anything beyond a small
fix before sending a PR.

## Setup

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Guidelines

- **Keep the core framework-agnostic.** `src/transport.ts`, `adapters.ts`, `apply.ts`,
  `poll.ts`, and `chat-store.ts` must not import React or Vue. Only `react.ts` and
  `vue.ts` may.
- **Don't duplicate logic between `react.ts` and `vue.ts`.** Both are thin bindings
  over `chat-store.ts` / `createStreamingController`. If a fix belongs in the shared
  logic, put it in the core and let both bindings inherit it — see `docs/PROPOSAL.md`
  §3.1 for why this split exists.
- **New protocol adapter?** Copy the shape of `createOpenAIStream` or
  `createAnthropicStream` in `adapters.ts`; don't add options to `streamSSE` itself.
- Add tests alongside the file you change (`*.test.ts`). `chat-store.test.ts` and
  `transport.test.ts` cover the framework-agnostic logic without needing
  `@testing-library/react` or Vue's `effectScope` — prefer testing there over the
  `react.test.ts` / `vue.test.ts` wiring tests when the change isn't binding-specific.

## Commit messages

No strict convention enforced yet beyond being descriptive. Reference the issue
number if there is one.
