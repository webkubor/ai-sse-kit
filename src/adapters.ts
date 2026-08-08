/**
 * Protocol adapters — sit on top of `streamSSE`, translate vendor-specific SSE
 * payloads into plain text deltas. Adding a new protocol means adding a new
 * `createXxxStream`, not touching `streamSSE`.
 */
import { streamSSE, type StreamSSEOptions } from './transport'

export interface AdapterOptions extends Omit<StreamSSEOptions, 'body'> {
  body: unknown
}

/**
 * OpenAI `chat.completion.chunk` protocol.
 * End signal: `data: [DONE]`. Delta: `choices[0].delta.content`.
 * In-stream error: `chunk.error.message`.
 */
export async function* createOpenAIStream(opts: AdapterOptions): AsyncGenerator<string, void, unknown> {
  for await (const ev of streamSSE(opts)) {
    if (ev.event !== 'message') continue
    if (ev.data === '[DONE]') return
    try {
      const chunk = JSON.parse(ev.data) as {
        choices?: Array<{ delta?: { content?: string } }>
        error?: { message?: string }
      }
      if (chunk.error?.message) throw new Error(chunk.error.message)
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) yield delta
    } catch (e) {
      if (e instanceof SyntaxError) continue // non-JSON frame (e.g. a heartbeat comment leaking through)
      throw e
    }
  }
}

/**
 * Anthropic Messages API streaming protocol.
 * Delta:  `event: content_block_delta` with `data.delta.type === 'text_delta'`.
 * End:    `event: message_stop`.
 * Error:  `event: error` — `data.error.message`.
 * Everything else (`message_start`, `content_block_start/stop`, `message_delta`,
 * `ping`) is protocol bookkeeping and is ignored here.
 */
export async function* createAnthropicStream(opts: AdapterOptions): AsyncGenerator<string, void, unknown> {
  for await (const ev of streamSSE(opts)) {
    if (ev.event === 'message_stop') return
    if (ev.event === 'error') {
      const parsed = JSON.parse(ev.data) as { error?: { message?: string } }
      throw new Error(parsed.error?.message ?? 'Anthropic stream error')
    }
    if (ev.event !== 'content_block_delta') continue
    const chunk = JSON.parse(ev.data) as { delta?: { type?: string; text?: string } }
    if (chunk.delta?.type === 'text_delta' && chunk.delta.text) yield chunk.delta.text
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
    if (ev.event !== 'message') continue
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
    if (type === cfg.deltaType) {
      const delta = frame[cfg.deltaField]
      if (typeof delta === 'string' && delta) yield delta
    }
  }
}
