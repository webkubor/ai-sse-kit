/**
 * Framework-agnostic engine behind `useAIChat` — same store powers both the React
 * and Vue bindings, so the send/stream/patch/abort logic exists exactly once instead
 * of being reimplemented per framework and drifting apart over time.
 *
 * `getState()` + `subscribe(listener)` is deliberately the same shape React's
 * `useSyncExternalStore` expects; a Vue binding just re-reads `getState()` inside
 * its own `subscribe` callback and writes the result into a `ref`.
 */
import { createAnthropicStream, createOpenAIStream, type AdapterOptions } from './adapters'
import { patchLastAssistant } from './apply'
import { createStreamingController, isAbortError } from './transport'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type ParseFn = (opts: AdapterOptions) => AsyncGenerator<string, void, unknown>

export interface AIChatStoreOptions {
  url: string
  /** `'openai'` (default) or `'anthropic'`, or your own adapter for a custom protocol. */
  protocol?: 'openai' | 'anthropic' | ParseFn
  headers?: Record<string, string>
  credentials?: RequestCredentials
  initialMessages?: ChatMessage[]
  /** Builds the request body from the full message history. Default: `{ messages }`. */
  buildBody?: (messages: ChatMessage[]) => unknown
  onError?: (err: Error) => void
}

export interface AIChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  error: Error | null
}

export interface AIChatStore {
  getState: () => AIChatState
  /** Registers `listener`, called after every state change; returns an unsubscribe fn. */
  subscribe: (listener: () => void) => () => void
  send: (input: string) => Promise<void>
  stop: () => void
}

function resolveParse(protocol: AIChatStoreOptions['protocol']): ParseFn {
  if (typeof protocol === 'function') return protocol
  if (protocol === 'anthropic') return createAnthropicStream
  return createOpenAIStream
}

/**
 * Creates one chat "session" — one message list, one in-flight-request slot.
 *
 * Takes `getOptions` rather than a static options object so a long-lived store
 * always sees the latest `url`/`headers`/`protocol`/etc. on each `send()`, even
 * though the store itself is created once (this is what lets the React/Vue
 * bindings create the store a single time per component instance without going
 * stale when props change — they pass `() => latestOptsRef.current`).
 */
export function createAIChatStore(getOptions: () => AIChatStoreOptions): AIChatStore {
  let state: AIChatState = {
    messages: getOptions().initialMessages ?? [],
    isStreaming: false,
    error: null,
  }
  const listeners = new Set<() => void>()
  const controller = createStreamingController()

  function setState(patch: Partial<AIChatState>): void {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  async function send(input: string): Promise<void> {
    const opts = getOptions()
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: input }
    const assistantMessage: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '' }
    const history = [...state.messages, userMessage]
    setState({ messages: [...history, assistantMessage], error: null, isStreaming: true })

    const signal = controller.begin()
    const parse = resolveParse(opts.protocol)
    const body = opts.buildBody ? opts.buildBody(history) : { messages: history }

    try {
      for await (const delta of parse({
        url: opts.url,
        body,
        headers: opts.headers,
        credentials: opts.credentials,
        signal,
      })) {
        setState({ messages: patchLastAssistant(state.messages, (m) => ({ content: m.content + delta })) })
      }
    } catch (err) {
      if (!isAbortError(err)) {
        const error = err instanceof Error ? err : new Error(String(err))
        setState({ error })
        opts.onError?.(error)
      }
    } finally {
      setState({ isStreaming: false })
    }
  }

  function stop(): void {
    controller.abort()
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    send,
    stop,
  }
}
