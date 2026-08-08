/**
 * SSE transport — protocol-agnostic byte-stream framing.
 *
 * Two layers of responsibility:
 *   - `streamSSE` / `readSSE` here: frame raw SSE bytes per the spec (event:/data:/id:
 *     fields), yield structured events. Knows nothing about `[DONE]`, OpenAI, or any
 *     other AI vendor convention — works for any standard SSE source.
 *   - Protocol adapters (see `adapters.ts`): translate `{event, data}` into vendor
 *     semantics (what counts as a delta, what counts as done).
 *
 * Why not a wrapped HTTP client (ky/axios/etc.): those read the whole response body
 * before returning, which defeats streaming. Streaming needs raw `fetch` + a manual
 * `Response.body` reader.
 */

/** One SSE event (one frame, delimited by a blank line). */
export interface SSEEvent {
  /** Value of the `event:` field; defaults to `'message'` per the SSE spec. */
  event: string
  /** Accumulated value of `data:` field(s); multiple `data:` lines join with `\n`. */
  data: string
  /** Value of the `id:` field (used for reconnect via Last-Event-ID); rarely needed. */
  id?: string
}

export interface StreamSSEOptions {
  url: string
  body: unknown
  /** Full request headers (auth, CSRF, tracing, ...) — the caller owns all of it. */
  headers?: Record<string, string>
  /** Abort signal, wired straight into `fetch`; call `controller.abort()` to cancel. */
  signal?: AbortSignal
  /** `fetch` credentials mode. Default `'include'` — override for cross-origin/token auth. */
  credentials?: RequestCredentials
}

/**
 * Parses an HTTP error response, trying a handful of common envelope shapes to
 * extract a readable message. Returns a structured `Error`; the caller decides how
 * to present it (this layer carries no i18n/copy dependency).
 */
export async function extractHTTPError(response: Response): Promise<Error> {
  let message = `HTTP ${response.status}`
  try {
    const body = (await response.json()) as {
      message?: string
      msg?: string
      error?: { message?: string }
      data?: { details?: Array<{ message?: string }> }
    }
    message =
      body.data?.details?.[0]?.message ?? body.message ?? body.msg ?? body.error?.message ?? message
  } catch {
    // Non-JSON body: keep the HTTP status text.
  }
  return new Error(message)
}

/**
 * Frames an already-fetched `Response` into `SSEEvent`s.
 *
 * Does not fetch — lets the caller inspect `Content-Type` first and decide whether to
 * read as SSE or fall back to JSON (some endpoints return either from the same URL).
 * Caller is responsible for checking `response.ok` / content type before calling this.
 */
export async function* readSSE(response: Response): AsyncGenerator<SSEEvent, void, unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('This environment has no readable stream body (Response.body).')

  const decoder = new TextDecoder()
  let buffer = ''

  // Per spec, frames are separated by a blank line; a frame can span multiple field lines.
  let event = 'message'
  let dataLines: string[] = []
  let id: string | undefined

  function* dispatch(): Generator<SSEEvent> {
    if (dataLines.length > 0) yield { event, data: dataLines.join('\n'), id }
    event = 'message'
    dataLines = []
    id = undefined
  }

  /** Processes one line; returns true when a blank line signals "dispatch now". */
  function processLine(line: string): boolean {
    if (line.trim() === '') return true
    if (line.startsWith(':')) return false // comment line (e.g. `: heartbeat`)

    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1) // spec: strip one leading space

    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
    else if (field === 'id') id = value
    // `retry:` affects reconnect timing; only meaningful to native EventSource, ignored here.
    return false
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? '' // last line may be incomplete (chunk boundary), hold it

    for (const line of lines) {
      if (processLine(line)) yield* dispatch()
    }
  }
  // Stream closed: flush whatever is left in `buffer`, then dispatch any pending frame.
  if (buffer.trim() !== '') {
    if (processLine(buffer)) yield* dispatch()
  }
  yield* dispatch()
}

/**
 * Fetch + frame in one call — the most common entry point.
 *
 * If you need to branch on response type after fetching (e.g. same URL sometimes
 * returns JSON instead of SSE), fetch yourself and call `readSSE` directly instead.
 *
 * ```ts
 * for await (const ev of streamSSE({ url, body, signal, headers })) {
 *   if (ev.event === 'message') { ... }
 * }
 * ```
 */
export async function* streamSSE(opts: StreamSSEOptions): AsyncGenerator<SSEEvent, void, unknown> {
  const { url, body, headers, signal, credentials = 'include' } = opts

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers },
    credentials,
    signal,
    body: JSON.stringify(body),
  })

  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.ok || !contentType.includes('text/event-stream')) {
    throw await extractHTTPError(response)
  }
  yield* readSSE(response)
}

/**
 * Whether `err` represents a deliberate cancellation (user hit stop / navigated away)
 * rather than a real failure. Cancellation is the normal path for a stop button —
 * catching it should return quietly, not render an error state.
 */
export function isAbortError(err: unknown): boolean {
  return (err as { name?: string } | null | undefined)?.name === 'AbortError'
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyed AbortController lifecycle — framework-agnostic core.
//
// The React and Vue bindings (`./react`, `./vue`) each wrap this in ~3 lines to add
// their own unmount cleanup; the actual registry logic lives here once so it can't
// drift between the two.
// ─────────────────────────────────────────────────────────────────────────────

export interface StreamingController<K> {
  /** Starts a new request under `key`: aborts any previous one under that key first. */
  begin: (key?: K) => AbortSignal
  /** Aborts the in-flight request under `key`, if any (silent no-op otherwise). */
  abort: (key?: K) => void
  /** Aborts every in-flight request (e.g. switching conversations, unmounting). */
  abortAll: () => void
  /** Whether `key` currently has an unaborted in-flight request. */
  isActive: (key?: K) => boolean
}

const SINGLE = Symbol('single')

/**
 * A keyed `AbortController` registry: `begin(key)` aborts whatever was previously
 * running under that key before handing back a fresh signal, so "same key, new
 * request" always means at most one in-flight request per key.
 *
 * ```ts
 * const stream = createStreamingController()          // single in-flight request
 * const signal = stream.begin()                        // aborts any previous one
 * stream.abort()                                        // e.g. a "stop" button
 *
 * const stream = createStreamingController<number>()   // multiple concurrent requests
 * const signal = stream.begin(idx)
 * stream.abort(idx) / stream.abortAll()
 * ```
 *
 * Doesn't know about "is streaming" UI state on purpose — different apps shape that
 * differently (one boolean, a flag per list item, reused loading state from a
 * non-streaming path too); baking in one shape would make this unusable for the
 * others. It only owns the `AbortController` lifecycle.
 */
export function createStreamingController<K extends string | number = string>(): StreamingController<K> {
  const controllers = new Map<K | typeof SINGLE, AbortController>()

  const abort = (key?: K): void => {
    const k = key ?? SINGLE
    controllers.get(k)?.abort()
    controllers.delete(k)
  }

  const abortAll = (): void => {
    controllers.forEach((c) => c.abort())
    controllers.clear()
  }

  const begin = (key?: K): AbortSignal => {
    const k = key ?? SINGLE
    controllers.get(k)?.abort() // only one in-flight request per key at a time
    const controller = new AbortController()
    controllers.set(k, controller)
    return controller.signal
  }

  const isActive = (key?: K): boolean => {
    const controller = controllers.get(key ?? SINGLE)
    return !!controller && !controller.signal.aborted
  }

  return { begin, abort, abortAll, isActive }
}
