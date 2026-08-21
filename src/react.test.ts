/**
 * These only test the React-specific wiring (stable instance across renders, cleanup
 * on unmount) — the controller's own `begin`/`abort`/`abortAll`/`isActive` contract is
 * covered against the framework-agnostic core in `transport.test.ts`, which both
 * `react.ts` and `vue.ts` share.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStreamingController } from './react'

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

  it('keyed usage: aborting one key leaves the other in flight', () => {
    const { result, unmount } = renderHook(() => useStreamingController<number>())
    let a!: AbortSignal
    let b!: AbortSignal
    act(() => {
      a = result.current.begin(0)
      b = result.current.begin(1)
      result.current.abort(0)
    })
    expect(a.aborted).toBe(true)
    expect(b.aborted).toBe(false)
    // unmount must still catch the one left running — that's the whole point of the binding
    unmount()
    expect(b.aborted).toBe(true)
  })
})
