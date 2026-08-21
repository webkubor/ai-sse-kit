/**
 * Vue binding — mirror image of `./react`: the same framework-agnostic core, with
 * cancellation tied to Vue's scope lifecycle instead of React's. Deliberately has no
 * `useAIChat`; see the note in `./react` for why message-model ownership stays with
 * your app.
 *
 * Uses `onScopeDispose` rather than `onUnmounted`: the latter only fires inside a
 * real component's setup(), which makes composables from a library annoying to
 * unit-test and unusable outside components. `onScopeDispose` fires on component
 * unmount too (components run their setup inside an effect scope) but also works
 * inside a bare `effectScope()`, which is what most Vue composable libraries
 * (VueUse included) rely on for exactly this reason.
 */
import { onScopeDispose } from 'vue'
import { createStreamingController, type StreamingController } from './transport'

export type { StreamingController } from './transport'

/**
 * Vue composable wrapping `createStreamingController` (see its docs for the
 * `begin`/`abort`/`abortAll`/`isActive` contract). Adds `abortAll()` on scope
 * disposal so call sites don't need their own cleanup.
 *
 * ```ts
 * const stream = useStreamingController()
 * for await (const ev of streamSSE({ url, body, signal: stream.begin() })) { ... }
 * ```
 */
export function useStreamingController<K extends string | number = string>(): StreamingController<K> {
  const controller = createStreamingController<K>()
  onScopeDispose(() => controller.abortAll())
  return controller
}
