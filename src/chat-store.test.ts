import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAIChatStore } from './chat-store'
import { jsonErrorResponse, mockFetchOnce, sseResponse } from './test-utils'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createAIChatStore', () => {
  it('sends a message and streams the assistant reply via the default OpenAI protocol', async () => {
    mockFetchOnce(
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: ' there' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    )
    const store = createAIChatStore(() => ({ url: '/api/chat' }))

    await store.send('hello')

    const state = store.getState()
    expect(state.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'hello'],
      ['assistant', 'Hi there'],
    ])
    expect(state.isStreaming).toBe(false)
    expect(state.error).toBeNull()
  })

  it('notifies subscribers as deltas patch the assistant message in', async () => {
    mockFetchOnce(
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'a' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'b' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    )
    const store = createAIChatStore(() => ({ url: '/api/chat' }))
    const snapshots: string[] = []
    store.subscribe(() => {
      const last = store.getState().messages.at(-1)
      if (last?.role === 'assistant') snapshots.push(last.content)
    })

    await store.send('hi')

    // at least one intermediate patch ('a') before the final ('ab')
    expect(snapshots.at(-1)).toBe('ab')
    expect(snapshots).toContain('a')
  })

  it('supports the anthropic protocol', async () => {
    mockFetchOnce(
      sseResponse([
        `event: content_block_delta\ndata: ${JSON.stringify({ delta: { type: 'text_delta', text: 'yo' } })}\n\n`,
        'event: message_stop\ndata: {}\n\n',
      ]),
    )
    const store = createAIChatStore(() => ({ url: '/api/chat', protocol: 'anthropic' }))

    await store.send('hi')

    expect(store.getState().messages.at(-1)?.content).toBe('yo')
  })

  it('supports a custom protocol function', async () => {
    async function* fakeProtocol() {
      yield 'custom-delta'
    }
    mockFetchOnce(sseResponse(['data: unused\n\n'])) // fakeProtocol below never calls fetch
    const store = createAIChatStore(() => ({ url: '/api/chat', protocol: fakeProtocol }))

    await store.send('hi')

    expect(store.getState().messages.at(-1)?.content).toBe('custom-delta')
  })

  it('sets error state (not a throw) when the request fails, and calls onError', async () => {
    mockFetchOnce(jsonErrorResponse(500, { message: 'server exploded' }))
    const onError = vi.fn()
    const store = createAIChatStore(() => ({ url: '/api/chat', onError }))

    await store.send('hi')

    const state = store.getState()
    expect(state.error?.message).toBe('server exploded')
    expect(onError).toHaveBeenCalledOnce()
    expect(state.isStreaming).toBe(false)
  })

  it('stop() aborts the in-flight stream without setting an error', async () => {
    // A body that never enqueues anything until the fetch signal is aborted — mimics
    // how a real `fetch` tears down the body reader when its AbortSignal fires
    // (rejecting the pending `reader.read()`).
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

    const store = createAIChatStore(() => ({ url: '/api/chat' }))
    const sendPromise = store.send('hi')

    await Promise.resolve()
    await Promise.resolve()
    expect(store.getState().isStreaming).toBe(true)

    store.stop()
    await sendPromise

    expect(store.getState().error).toBeNull()
    expect(store.getState().isStreaming).toBe(false)
  })

  it('accumulates reasoning_content into the assistant message`s `reasoning` field, separate from `content`', async () => {
    mockFetchOnce(
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'answer' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    )
    const store = createAIChatStore(() => ({ url: '/api/chat' }))

    await store.send('hi')

    const last = store.getState().messages.at(-1)
    expect(last?.reasoning).toBe('thinking')
    expect(last?.content).toBe('answer')
  })

  it('forwards side-channel events (e.g. a custom `card` frame) to onEvent', async () => {
    mockFetchOnce(
      sseResponse([
        `event: card\ndata: ${JSON.stringify({ title: 'Ticket prices' })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    )
    const onEvent = vi.fn()
    const store = createAIChatStore(() => ({ url: '/api/chat', onEvent }))

    await store.send('hi')

    expect(onEvent).toHaveBeenCalledOnce()
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({ event: 'card' })
    expect(store.getState().messages.at(-1)?.content).toBe('ok')
  })

  it('reads options fresh on every send (no stale closure)', async () => {
    let url = '/first'
    const store = createAIChatStore(() => ({ url }))

    mockFetchOnce(sseResponse(['data: [DONE]\n\n']))
    url = '/second'
    let capturedUrl: string | undefined
    globalThis.fetch = (async (input: unknown) => {
      capturedUrl = String(input)
      return sseResponse(['data: [DONE]\n\n'])
    }) as typeof fetch

    await store.send('hi')

    expect(capturedUrl).toBe('/second')
  })
})
