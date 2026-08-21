/**
 * React binding — the one thing the framework-agnostic core can't do by itself:
 * tie `abortAll()` to component unmount. Everything else lives in `./transport`.
 *
 * There is deliberately no `useAIChat` here. Owning a message model (what a message
 * looks like, how history is kept, how errors surface) is exactly where a generic
 * hook stops fitting real apps — and it's the part Vercel AI SDK's `useChat` and
 * TanStack AI's `ChatClient` already do far more thoroughly. This package stays on
 * the layer below: framing, patching, cancellation. You keep your own message model.
 */
import { useEffect, useRef } from 'react'
import { createStreamingController, type StreamingController } from './transport'

export type { StreamingController } from './transport'

/**
 * React hook wrapping `createStreamingController` (see its docs for the `begin`/
 * `abort`/`abortAll`/`isActive` contract). Adds one thing React needs that the
 * framework-agnostic version can't do on its own: `abortAll()` automatically on
 * unmount, so call sites don't need their own cleanup effect.
 *
 * ```tsx
 * const stream = useStreamingController()
 * // one in-flight request:
 * for await (const ev of streamSSE({ url, body, signal: stream.begin() })) { ... }
 * // or keyed, for a list where each row streams independently:
 * const stream = useStreamingController<number>()
 * stream.begin(rowIndex) / stream.abort(rowIndex)
 * ```
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
