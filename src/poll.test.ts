import { describe, expect, it } from 'vitest'
import { pollUntil } from './poll'

describe('pollUntil', () => {
  it('returns immediately when the first result is already terminal', async () => {
    const result = await pollUntil(
      async () => 'done',
      (r) => r === 'done',
      { intervalMs: 10 },
    )
    expect(result).toBe('done')
  })

  it('keeps polling until a terminal result arrives', async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return calls < 3 ? 'running' : 'succeeded'
    }
    const result = await pollUntil(fetcher, (r) => r === 'succeeded', { intervalMs: 5 })
    expect(result).toBe('succeeded')
    expect(calls).toBe(3)
  })

  it('propagates a fetcher rejection immediately, without retrying', async () => {
    let calls = 0
    const fetcher = async () => {
      calls += 1
      throw new Error('boom')
    }
    await expect(pollUntil(fetcher, () => true, { intervalMs: 5 })).rejects.toThrow('boom')
    expect(calls).toBe(1)
  })

  it('aborts while waiting between polls', async () => {
    const controller = new AbortController()
    const fetcher = async () => 'running'
    const promise = pollUntil(fetcher, () => false, { intervalMs: 1000, signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toThrow()
  })

  it('rejects immediately if the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      pollUntil(async () => 'x', () => true, { signal: controller.signal }),
    ).rejects.toThrow()
  })
})
