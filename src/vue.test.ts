/**
 * Mirrors `react.test.ts`: only the Vue-specific wiring is tested here (reactive
 * state updates, cleanup on scope disposal). The actual logic lives in
 * `chat-store.test.ts` / `transport.test.ts` against the framework-agnostic core
 * shared with the React binding.
 */
import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAIChat, useStreamingController } from './vue'
import { mockFetchOnce, sseResponse } from './test-utils'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Runs `composable()` inside a disposable effect scope, without mounting a component. */
function withSetup<T>(composable: () => T): [T, { stop: () => void }] {
  const scope = effectScope()
  let result!: T
  scope.run(() => {
    result = composable()
  })
  return [result, scope]
}

describe('useStreamingController (Vue binding)', () => {
  it('aborts everything when the effect scope is disposed', () => {
    const [controller, scope] = withSetup(() => useStreamingController())
    const signal = controller.begin()
    scope.stop()
    expect(signal.aborted).toBe(true)
  })
})

describe('useAIChat (Vue binding)', () => {
  it('updates reactive state with the streamed reply patched in', async () => {
    mockFetchOnce(
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    )
    const [chat] = withSetup(() => useAIChat({ url: '/api/chat' }))

    await chat.send('hello')

    expect(chat.messages.value.map((m) => [m.role, m.content])).toEqual([
      ['user', 'hello'],
      ['assistant', 'Hi'],
    ])
    expect(chat.isStreaming.value).toBe(false)
  })

  it('stop() while still mounted aborts without setting an error', async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
      },
    })
    globalThis.fetch = (async (_url: unknown, init: { signal?: AbortSignal }) => {
      init.signal?.addEventListener('abort', () => {
        streamController.error(new DOMException('Aborted', 'AbortError'))
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }) as typeof fetch

    const [chat] = withSetup(() => useAIChat({ url: '/api/chat' }))
    const sendPromise = chat.send('hi')
    await Promise.resolve()
    await Promise.resolve()
    expect(chat.isStreaming.value).toBe(true)

    chat.stop() // e.g. a "stop" button click, scope is still alive
    await sendPromise

    expect(chat.error.value).toBeNull()
    expect(chat.isStreaming.value).toBe(false)
  })

  it('disposing the scope does not throw, even mid-stream', async () => {
    const stream = new ReadableStream<Uint8Array>({ start() {} }) // never enqueues
    globalThis.fetch = (async () =>
      new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })) as typeof fetch

    const [chat, scope] = withSetup(() => useAIChat({ url: '/api/chat' }))
    void chat.send('hi')
    await Promise.resolve()

    // Once disposed, this composable's reactive refs stop tracking the store — the
    // same as any Vue composable's refs after its component unmounts. Disposal
    // itself must not throw; it does not promise the refs settle to a final value.
    expect(() => scope.stop()).not.toThrow()
  })
})
