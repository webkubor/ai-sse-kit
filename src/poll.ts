/**
 * Generic "poll until terminal state" — for async job-style results (image/video
 * generation, background tasks) that don't stream, just report a status you have to
 * re-check. This is a different transport shape than SSE, kept as its own entry
 * point rather than folded into transport/parse/apply.
 *
 * Design choice: a `fetcher` rejection propagates immediately rather than being
 * swallowed and retried. Silently retrying forever on a permanently broken endpoint
 * would surprise a generic caller; if you want "ignore transient errors and keep
 * polling", wrap `fetcher` yourself with that policy.
 */
export async function pollUntil<T>(
  fetcher: () => Promise<T>,
  isTerminal: (result: T) => boolean,
  opts?: { intervalMs?: number; signal?: AbortSignal },
): Promise<T> {
  const intervalMs = opts?.intervalMs ?? 3000
  const signal = opts?.signal

  for (;;) {
    signal?.throwIfAborted()
    const result = await fetcher()
    if (isTerminal(result)) return result
    await wait(intervalMs, signal)
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}
