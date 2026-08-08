import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAnthropicStream, createCustomJSONStream, createOpenAIStream } from './adapters'
import { mockFetchOnce, sseResponse } from './test-utils'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createOpenAIStream', () => {
  it('yields delta.content and stops at [DONE]', async () => {
    mockFetchOnce(
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    )
    const deltas: string[] = []
    for await (const d of createOpenAIStream({ url: '/x', body: {} })) deltas.push(d)
    expect(deltas).toEqual(['Hel', 'lo'])
  })

  it('throws on an in-stream error chunk', async () => {
    mockFetchOnce(sseResponse([`data: ${JSON.stringify({ error: { message: 'rate limited' } })}\n\n`]))
    await expect(async () => {
      for await (const _ of createOpenAIStream({ url: '/x', body: {} })) {
        // draining is enough
      }
    }).rejects.toThrow('rate limited')
  })

  it('skips non-JSON frames (e.g. leaked heartbeat comments)', async () => {
    mockFetchOnce(
      sseResponse([
        'data: not-json\n\n',
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`,
      ]),
    )
    const deltas: string[] = []
    for await (const d of createOpenAIStream({ url: '/x', body: {} })) deltas.push(d)
    expect(deltas).toEqual(['ok'])
  })
})

describe('createAnthropicStream', () => {
  it('yields text_delta content and stops at message_stop', async () => {
    mockFetchOnce(
      sseResponse([
        `event: content_block_delta\ndata: ${JSON.stringify({ delta: { type: 'text_delta', text: 'Hi' } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ delta: { type: 'text_delta', text: '!' } })}\n\n`,
        'event: message_stop\ndata: {}\n\n',
      ]),
    )
    const deltas: string[] = []
    for await (const d of createAnthropicStream({ url: '/x', body: {} })) deltas.push(d)
    expect(deltas).toEqual(['Hi', '!'])
  })

  it('ignores bookkeeping events (ping, message_start)', async () => {
    mockFetchOnce(
      sseResponse([
        'event: ping\ndata: {}\n\n',
        `event: message_start\ndata: ${JSON.stringify({ message: {} })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ delta: { type: 'text_delta', text: 'x' } })}\n\n`,
        'event: message_stop\ndata: {}\n\n',
      ]),
    )
    const deltas: string[] = []
    for await (const d of createAnthropicStream({ url: '/x', body: {} })) deltas.push(d)
    expect(deltas).toEqual(['x'])
  })

  it('throws on an error event', async () => {
    mockFetchOnce(
      sseResponse([`event: error\ndata: ${JSON.stringify({ error: { message: 'overloaded' } })}\n\n`]),
    )
    await expect(async () => {
      for await (const _ of createAnthropicStream({ url: '/x', body: {} })) {
        // draining is enough
      }
    }).rejects.toThrow('overloaded')
  })
})

describe('createCustomJSONStream', () => {
  it('uses default field names', async () => {
    mockFetchOnce(
      sseResponse([
        `data: ${JSON.stringify({ type: 'delta', content: 'a' })}\n\n`,
        `data: ${JSON.stringify({ type: 'delta', content: 'b' })}\n\n`,
        `data: ${JSON.stringify({ type: 'done' })}\n\n`,
      ]),
    )
    const deltas: string[] = []
    for await (const d of createCustomJSONStream({ url: '/x', body: {} })) deltas.push(d)
    expect(deltas).toEqual(['a', 'b'])
  })

  it('honors a custom field mapping', async () => {
    mockFetchOnce(
      sseResponse([
        `data: ${JSON.stringify({ kind: 'chunk', text: 'x' })}\n\n`,
        `data: ${JSON.stringify({ kind: 'finished' })}\n\n`,
      ]),
    )
    const deltas: string[] = []
    for await (const d of createCustomJSONStream(
      { url: '/x', body: {} },
      { typeField: 'kind', deltaField: 'text', deltaType: 'chunk', doneType: 'finished', errorType: 'fail' },
    )) {
      deltas.push(d)
    }
    expect(deltas).toEqual(['x'])
  })

  it('throws using the configured error field', async () => {
    mockFetchOnce(sseResponse([`data: ${JSON.stringify({ type: 'error', message: 'broke' })}\n\n`]))
    await expect(async () => {
      for await (const _ of createCustomJSONStream({ url: '/x', body: {} })) {
        // draining is enough
      }
    }).rejects.toThrow('broke')
  })
})
