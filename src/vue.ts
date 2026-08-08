/**
 * Vue bindings — thin wiring on top of the same framework-agnostic core the React
 * bindings use (`createStreamingController` / `createAIChatStore`). See `./react`
 * for the mirror-image version; the actual send/stream/patch/abort logic lives in
 * `chat-store.ts` exactly once, not duplicated per framework.
 *
 * Uses `onScopeDispose` rather than `onUnmounted`: the latter only fires inside a
 * real component's setup(), which makes composables from a library annoying to
 * unit-test and unusable outside components. `onScopeDispose` fires on component
 * unmount too (components run their setup inside an effect scope) but also works
 * inside a bare `effectScope()`, which is what most Vue composable libraries
 * (VueUse included) rely on for exactly this reason.
 */
import { computed, onScopeDispose, shallowRef, type ComputedRef } from 'vue'
import { createAIChatStore, type AIChatStoreOptions, type ChatMessage } from './chat-store'
import { createStreamingController, type StreamingController } from './transport'

export type { StreamingController } from './transport'
export type { AIChatStoreOptions, ChatMessage } from './chat-store'

/**
 * Vue composable wrapping `createStreamingController` (see its docs for the
 * `begin`/`abort`/`abortAll`/`isActive` contract). Adds `abortAll()` on scope
 * disposal so call sites don't need their own cleanup.
 */
export function useStreamingController<K extends string | number = string>(): StreamingController<K> {
  const controller = createStreamingController<K>()
  onScopeDispose(() => controller.abortAll())
  return controller
}

export interface UseAIChatResult {
  messages: ComputedRef<ChatMessage[]>
  isStreaming: ComputedRef<boolean>
  error: ComputedRef<Error | null>
  /** Appends a user message, streams the assistant's reply, patches it in as it arrives. */
  send: (input: string) => Promise<void>
  /** Aborts the in-flight reply, if any. */
  stop: () => void
}

/**
 * The 80% case: one composable, default protocol, default message-state handling.
 *
 * ```ts
 * const { messages, send, stop, isStreaming } = useAIChat({ url: '/api/chat' })
 * ```
 *
 * `opts` can also be a getter (`() => ({ url: props.url, ... })`) if any field needs
 * to track a reactive source; a plain object is read once at creation, matching how
 * most Vue composables treat their options argument.
 */
export function useAIChat(opts: AIChatStoreOptions | (() => AIChatStoreOptions)): UseAIChatResult {
  const getOptions = typeof opts === 'function' ? opts : () => opts

  const store = createAIChatStore(getOptions)
  const state = shallowRef(store.getState())
  const unsubscribe = store.subscribe(() => {
    state.value = store.getState()
  })

  onScopeDispose(() => {
    unsubscribe()
    store.stop()
  })

  return {
    messages: computed(() => state.value.messages),
    isStreaming: computed(() => state.value.isStreaming),
    error: computed(() => state.value.error),
    send: store.send,
    stop: store.stop,
  }
}
