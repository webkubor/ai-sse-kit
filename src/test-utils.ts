/** Shared test helpers: build fake `Response`/`fetch` for SSE tests without a real server. */

/** A `Response` whose body streams the given chunks (simulating network chunking). */
export function sseResponse(chunks: string[], init?: { status?: number; contentType?: string }): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(stream, {
    status: init?.status ?? 200,
    headers: { 'Content-Type': init?.contentType ?? 'text/event-stream' },
  })
}

export function jsonErrorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Installs a `fetch` mock for one test that returns `response` regardless of input. */
export function mockFetchOnce(response: Response): void {
  globalThis.fetch = (async () => response) as typeof fetch
}
