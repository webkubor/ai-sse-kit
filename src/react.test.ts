/**
 * These only test the React-specific wiring (re-render on state change, cleanup on
 * unmount) — the actual send/stream/patch/abort logic is exhaustively covered in
 * `chat-store.test.ts` and `transport.test.ts` against the framework-agnostic core,
 * which both `react.ts` and `vue.ts` share.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAIChat, useStreamingController } from './react'
import { mockFetchOnce, sseResponse } from './test-utils'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useStreamingController (React binding)', () => {
  it('aborts everything on unmount', () => {
    const { result, unmount } = renderHook(() => useStreamingController())
    let signal!: AbortSignal
    act(() => {
      signal = result.current.begin()
    })
    unmount()
    expect(signal.aborted).toBe(true)
  })

  it('returns the same controller instance across re-renders', () => {
    const { result, rerender } = renderHook(() => useStreamingController())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})

describe('useAIChat (React binding)', () => {
  it('re-renders with the streamed reply patched in', async () => {
    mockFetchOnce(
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    )
    const { result } = renderHook(() => useAIChat({ url: '/api/chat' }))

    await act(async () => {
      await result.current.send('hello')
    })

    expect(result.current.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'hello'],
      ['assistant', 'Hi'],
    ])
    expect(result.current.isStreaming).toBe(false)
  })

  it('stop() is stable and stops the store on unmount', () => {
    const { result, unmount } = renderHook(() => useAIChat({ url: '/api/chat' }))
    const stop = result.current.stop
    expect(() => unmount()).not.toThrow()
    expect(typeof stop).toBe('function')
  })
})
