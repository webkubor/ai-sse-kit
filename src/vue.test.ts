/**
 * Mirrors `react.test.ts`: only the Vue-specific wiring is tested here (cleanup on
 * scope disposal, and that it works outside a component). The controller's own
 * `begin`/`abort`/`abortAll`/`isActive` contract is covered in `transport.test.ts`
 * against the framework-agnostic core shared with the React binding.
 */
import { effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useStreamingController } from './vue'

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

  it('keyed usage: aborting one key leaves the other in flight until disposal', () => {
    const [controller, scope] = withSetup(() => useStreamingController<number>())
    const a = controller.begin(0)
    const b = controller.begin(1)
    controller.abort(0)
    expect(a.aborted).toBe(true)
    expect(b.aborted).toBe(false)
    scope.stop()
    expect(b.aborted).toBe(true)
  })

  it('works inside a bare effectScope, not just a component — the reason for onScopeDispose', () => {
    // onUnmounted would silently no-op here; this is what makes the composable
    // usable outside components and unit-testable without mounting anything.
    expect(() => withSetup(() => useStreamingController())).not.toThrow()
  })
})
