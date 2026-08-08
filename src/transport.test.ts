import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStreamingController, extractHTTPError, isAbortError, readSSE, streamSSE } from './transport'
import { jsonErrorResponse, mockFetchOnce, sseResponse } from './test-utils'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readSSE', () => {
  it('parses a single event with a default event field', async () => {
    const res = sseResponse(['data: hello\n\n'])
    const events = []
    for await (const ev of readSSE(res)) events.push(ev)
    expect(events).toEqual([{ event: 'message', data: 'hello', id: undefined }])
  })

  it('joins multiple data: lines with \\n', async () => {
    const res = sseResponse(['data: line1\ndata: line2\n\n'])
    const events = []
    for await (const ev of readSSE(res)) events.push(ev)
    expect(events[0]!.data).toBe('line1\nline2')
  })

  it('respects a custom event field and id field', async () => {
    const res = sseResponse(['event: delta\nid: 42\ndata: hi\n\n'])
    const events = []
    for await (const ev of readSSE(res)) events.push(ev)
    expect(events[0]).toEqual({ event: 'delta', data: 'hi', id: '42' })
  })

  it('ignores comment lines', async () => {
    const res = sseResponse([': heartbeat\ndata: hi\n\n'])
    const events = []
    for await (const ev of readSSE(res)) events.push(ev)
    expect(events).toEqual([{ event: 'message', data: 'hi', id: undefined }])
  })

  it('handles multiple events across chunk boundaries, including a mid-line split', async () => {
    // "data: hel" arrives in one chunk, "lo\n\n" in the next — the line itself is split.
    const res = sseResponse(['data: hel', 'lo\n\n', 'data: second\n\n'])
    const events = []
    for await (const ev of readSSE(res)) events.push(ev)
    expect(events.map((e) => e.data)).toEqual(['hello', 'second'])
  })

  it('flushes a final frame with no trailing blank line', async () => {
    const res = sseResponse(['data: no-trailing-newline'])
    const events = []
    for await (const ev of readSSE(res)) events.push(ev)
    expect(events).toEqual([{ event: 'message', data: 'no-trailing-newline', id: undefined }])
  })

  it('resets event/id back to defaults after each dispatched frame', async () => {
    const res = sseResponse(['event: a\nid: 1\ndata: x\n\ndata: y\n\n'])
    const events = []
    for await (const ev of readSSE(res)) events.push(ev)
    expect(events).toEqual([
      { event: 'a', data: 'x', id: '1' },
      { event: 'message', data: 'y', id: undefined },
    ])
  })
})

describe('streamSSE', () => {
  it('fetches and yields frames from a text/event-stream response', async () => {
    mockFetchOnce(sseResponse(['data: hi\n\n']))
    const events = []
    for await (const ev of streamSSE({ url: '/x', body: {} })) events.push(ev)
    expect(events).toEqual([{ event: 'message', data: 'hi', id: undefined }])
  })

  it('throws a structured error on a non-2xx response', async () => {
    mockFetchOnce(jsonErrorResponse(401, { message: 'no auth' }))
    await expect(async () => {
      for await (const _ of streamSSE({ url: '/x', body: {} })) {
        // draining is enough to trigger the throw
      }
    }).rejects.toThrow('no auth')
  })

  it('throws when the response is 2xx but not event-stream content type', async () => {
    mockFetchOnce(new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await expect(async () => {
      for await (const _ of streamSSE({ url: '/x', body: {} })) {
        // draining is enough to trigger the throw
      }
    }).rejects.toThrow()
  })
})

describe('extractHTTPError', () => {
  it('prefers data.details[0].message', async () => {
    const err = await extractHTTPError(
      jsonErrorResponse(400, { data: { details: [{ message: 'deep' }] }, message: 'shallow' }),
    )
    expect(err.message).toBe('deep')
  })

  it('falls back to the HTTP status when the body is not JSON', async () => {
    const err = await extractHTTPError(new Response('not json', { status: 500 }))
    expect(err.message).toBe('HTTP 500')
  })
})

describe('isAbortError', () => {
  it('recognizes a DOMException AbortError', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true)
  })

  it('rejects other errors', () => {
    expect(isAbortError(new Error('boom'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
  })
})

describe('createStreamingController', () => {
  it('begin() returns a fresh signal and aborts the previous one under the same key', () => {
    const controller = createStreamingController()
    const first = controller.begin()
    expect(first.aborted).toBe(false)
    controller.begin()
    expect(first.aborted).toBe(true)
  })

  it('isActive reflects begin/abort state', () => {
    const controller = createStreamingController()
    expect(controller.isActive()).toBe(false)
    controller.begin()
    expect(controller.isActive()).toBe(true)
    controller.abort()
    expect(controller.isActive()).toBe(false)
  })

  it('keeps independent state per key', () => {
    const controller = createStreamingController<number>()
    const a = controller.begin(1)
    controller.begin(2)
    controller.abort(2)
    expect(a.aborted).toBe(false)
    expect(controller.isActive(1)).toBe(true)
    expect(controller.isActive(2)).toBe(false)
  })

  it('abortAll() aborts every key and clears the registry', () => {
    const controller = createStreamingController<number>()
    const a = controller.begin(1)
    const b = controller.begin(2)
    controller.abortAll()
    expect(a.aborted).toBe(true)
    expect(b.aborted).toBe(true)
    expect(controller.isActive(1)).toBe(false)
    expect(controller.isActive(2)).toBe(false)
  })

  it('abort() on a key with no in-flight request is a silent no-op', () => {
    const controller = createStreamingController()
    expect(() => controller.abort()).not.toThrow()
  })
})
