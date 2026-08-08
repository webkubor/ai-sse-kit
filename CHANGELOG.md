# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

### Status

Pre-alpha. Not yet published to npm — building and testing locally, package name and
API surface may still change before `0.1.0`.
