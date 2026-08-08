/**
 * React bindings — thin wiring on top of the framework-agnostic core
 * (`createStreamingController` / `createAIChatStore`). All the actual logic lives
 * there; this file only adds React's lifecycle (re-render on state change, cleanup
 * on unmount). See `./vue` for the same wiring against Vue's reactivity instead.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { createAIChatStore, type AIChatStoreOptions, type ChatMessage } from './chat-store'
import { createStreamingController, type StreamingController } from './transport'

export type { StreamingController } from './transport'
export type { AIChatStoreOptions, ChatMessage } from './chat-store'

/**
 * React hook wrapping `createStreamingController` (see its docs for the `begin`/
 * `abort`/`abortAll`/`isActive` contract). Adds one thing React needs that the
 * framework-agnostic version can't do on its own: `abortAll()` automatically on
 * unmount, so call sites don't need their own cleanup effect.
 */
export function useStreamingController<K extends string | number = string>(): StreamingController<K> {
  const ref = useRef<StreamingController<K> | null>(null)
  if (!ref.current) ref.current = createStreamingController<K>()

  useEffect(() => {
    const controller = ref.current!
    return () => controller.abortAll()
  }, [])

  return ref.current
}

export interface UseAIChatResult {
  messages: ChatMessage[]
  /** Appends a user message, streams the assistant's reply, patches it in as it arrives. */
  send: (input: string) => Promise<void>
  /** Aborts the in-flight reply, if any. */
  stop: () => void
  isStreaming: boolean
  error: Error | null
}

/**
 * The 80% case: one hook, default protocol, default message-state handling.
 *
 * ```ts
 * const { messages, send, stop, isStreaming } = useAIChat({ url: '/api/chat' })
 * ```
 *
 * This is a thin binding over `createAIChatStore` — see `chat-store.ts` for the
 * actual send/stream/patch/abort logic, or import the primitives directly
 * (`createOpenAIStream`, `patchLastAssistant`, ...) for a custom protocol or your
 * own message-state shape.
 */
export function useAIChat(opts: AIChatStoreOptions): UseAIChatResult {
  // React re-invokes this function every render, so `opts` as given can't be
  // captured once at store-creation time — it would go stale the moment a prop
  // changes. Keep a ref updated every render instead, and have the store read
  // through it on each `send()` call.
  const optsRef = useRef(opts)
  optsRef.current = opts

  const store = useMemo(() => createAIChatStore(() => optsRef.current), [])
  const state = useSyncExternalStore(store.subscribe, store.getState)

  useEffect(() => () => store.stop(), [store])

  return { ...state, send: store.send, stop: store.stop }
}
