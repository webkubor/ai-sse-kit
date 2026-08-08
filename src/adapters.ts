/**
 * Protocol adapters — sit on top of `streamSSE`, translate vendor-specific SSE
 * payloads into plain text deltas. Adding a new protocol means adding a new
 * `createXxxStream`, not touching `streamSSE`.
 */
import { streamSSE, type SSEEvent, type StreamSSEOptions } from './transport'

export interface AdapterOptions extends Omit<StreamSSEOptions, 'body'> {
  body: unknown
  /**
   * Called for each reasoning/thinking delta, on protocols that stream it separately
   * from the final answer (OpenAI-compatible `delta.reasoning_content`, Anthropic
   * extended-thinking `thinking_delta`). Not yielded from the generator itself —
   * the generator only ever yields final-answer text, so existing consumers that
   * concatenate every yielded value into "the reply" don't suddenly get reasoning
   * text mixed in just by upgrading.
   */
  onReasoning?: (text: string) => void
  /**
   * Called for each raw SSE frame the adapter doesn't itself interpret as content,
   * reasoning, done, or error. Covers app-injected side-channel events mixed into an
   * otherwise-standard stream — e.g. your backend adds a one-off `event: card` frame
   * with structured data alongside normal `chat.completion.chunk` frames so the UI can
   * render it without waiting for the model to describe it in prose. The adapter still
   * ignores its own protocol's bookkeeping frames (OpenAI has none beyond `message`;
   * Anthropic's `ping`/`message_start`/`content_block_start`/`content_block_stop`/
   * `message_delta` are swallowed as before) — this only fires for names neither the
   * protocol nor this option list already accounts for.
   */
  onEvent?: (event: SSEEvent) => void
}

/**
 * OpenAI `chat.completion.chunk` protocol.
 * End signal: `data: [DONE]`. Delta: `choices[0].delta.content`.
 * Reasoning models (deepseek-r1/v4 and similar OpenAI-compatible backends) additionally
 * stream `choices[0].delta.reasoning_content` — routed to `opts.onReasoning`, not yielded.
 * In-stream error: `chunk.error.message`.
 */
export async function* createOpenAIStream(opts: AdapterOptions): AsyncGenerator<string, void, unknown> {
  for await (const ev of streamSSE(opts)) {
    if (ev.event !== 'message') {
      opts.onEvent?.(ev)
      continue
    }
    if (ev.data === '[DONE]') return
    try {
      const chunk = JSON.parse(ev.data) as {
        choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>
        error?: { message?: string }
      }
      if (chunk.error?.message) throw new Error(chunk.error.message)
      const reasoning = chunk.choices?.[0]?.delta?.reasoning_content
      if (reasoning) opts.onReasoning?.(reasoning)
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) yield delta
    } catch (e) {
      if (e instanceof SyntaxError) continue // non-JSON frame (e.g. a heartbeat comment leaking through)
      throw e
    }
  }
}

/** Anthropic protocol bookkeeping events that carry no reply text — silently swallowed. */
const ANTHROPIC_BOOKKEEPING_EVENTS = new Set([
  'ping',
  'message_start',
  'content_block_start',
  'content_block_stop',
  'message_delta',
])

/**
 * Anthropic Messages API streaming protocol.
 * Delta:      `event: content_block_delta` with `data.delta.type === 'text_delta'`.
 * Reasoning:  same event, `data.delta.type === 'thinking_delta'` (extended thinking) —
 *             routed to `opts.onReasoning`, not yielded.
 * End:        `event: message_stop`.
 * Error:      `event: error` — `data.error.message`.
 * `message_start`, `content_block_start/stop`, `message_delta`, `ping` are protocol
 * bookkeeping and are ignored here; any OTHER event name (e.g. one your own backend
 * mixes into the stream) goes to `opts.onEvent` instead of being silently dropped.
 */
export async function* createAnthropicStream(opts: AdapterOptions): AsyncGenerator<string, void, unknown> {
  for await (const ev of streamSSE(opts)) {
    if (ev.event === 'message_stop') return
    if (ev.event === 'error') {
      const parsed = JSON.parse(ev.data) as { error?: { message?: string } }
      throw new Error(parsed.error?.message ?? 'Anthropic stream error')
    }
    if (ev.event !== 'content_block_delta') {
      if (!ANTHROPIC_BOOKKEEPING_EVENTS.has(ev.event)) opts.onEvent?.(ev)
      continue
    }
    const chunk = JSON.parse(ev.data) as { delta?: { type?: string; text?: string; thinking?: string } }
    if (chunk.delta?.type === 'text_delta' && chunk.delta.text) yield chunk.delta.text
    else if (chunk.delta?.type === 'thinking_delta' && chunk.delta.thinking) opts.onReasoning?.(chunk.delta.thinking)
  }
}

export interface CustomJSONStreamConfig {
  /** Field in each JSON frame that carries the frame's semantic type. */
  typeField: string
  /** Field that holds the delta text, on frames whose type equals `deltaType`. */
  deltaField: string
  /** Type value that marks a frame as a text delta. */
  deltaType: string
  /** Type value that marks the stream as finished. */
  doneType: string
  /** Type value that marks an error frame. */
  errorType: string
  /** Field holding the error message, on frames whose type equals `errorType`. */
  errorField?: string
  /**
   * Type value that marks a frame as a reasoning/thinking delta (routed to
   * `opts.onReasoning`, not yielded). Left unset by default — most homegrown
   * protocols don't distinguish reasoning from content; set both this and
   * `reasoningField` if yours does.
   */
  reasoningType?: string
  /** Field that holds the reasoning delta text, on frames whose type equals `reasoningType`. */
  reasoningField?: string
}

const DEFAULT_CUSTOM_CONFIG: CustomJSONStreamConfig = {
  typeField: 'type',
  deltaField: 'content',
  deltaType: 'delta',
  doneType: 'done',
  errorType: 'error',
  errorField: 'message',
}

/**
 * Adapter for self-rolled JSON-over-SSE protocols: every frame is `{type, ...}`,
 * with `type` distinguishing delta / done / error frames. Field names are
 * configurable since every homegrown backend names them slightly differently.
 *
 * If your protocol is richer than "one delta field, one done flag, one error field"
 * (e.g. multiple delta kinds, tool calls), write a dedicated `createXxxStream` against
 * `streamSSE` directly instead of stretching this adapter with more options.
 */
export async function* createCustomJSONStream(
  opts: AdapterOptions,
  config: Partial<CustomJSONStreamConfig> = {},
): AsyncGenerator<string, void, unknown> {
  const cfg = { ...DEFAULT_CUSTOM_CONFIG, ...config }
  for await (const ev of streamSSE(opts)) {
    if (ev.event !== 'message') {
      opts.onEvent?.(ev)
      continue
    }
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(ev.data) as Record<string, unknown>
    } catch {
      continue // non-JSON frame (heartbeats etc.)
    }
    const type = frame[cfg.typeField]
    if (type === cfg.doneType) return
    if (type === cfg.errorType) {
      const msg = cfg.errorField ? frame[cfg.errorField] : undefined
      throw new Error(typeof msg === 'string' ? msg : 'stream error')
    }
    if (cfg.reasoningType && type === cfg.reasoningType) {
      const reasoning = cfg.reasoningField ? frame[cfg.reasoningField] : undefined
      if (typeof reasoning === 'string' && reasoning) opts.onReasoning?.(reasoning)
      continue
    }
    if (type === cfg.deltaType) {
      const delta = frame[cfg.deltaField]
      if (typeof delta === 'string' && delta) yield delta
    }
  }
}
