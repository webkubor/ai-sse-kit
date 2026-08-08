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

  it('routes delta.reasoning_content to onReasoning instead of yielding it', async () => {
    mockFetchOnce(
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking...' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'answer' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    )
    const reasoning: string[] = []
    const deltas: string[] = []
    for await (const d of createOpenAIStream({ url: '/x', body: {}, onReasoning: (t) => reasoning.push(t) })) {
      deltas.push(d)
    }
    expect(reasoning).toEqual(['thinking...'])
    expect(deltas).toEqual(['answer'])
  })

  it('routes a non-"message" event (an app-injected side-channel frame) to onEvent', async () => {
    mockFetchOnce(
      sseResponse([
        `event: card\ndata: ${JSON.stringify({ title: 'Ticket prices' })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`,
        'data: [DONE]\n\n',
      ]),
    )
    const events: Array<{ event: string; data: string }> = []
    const deltas: string[] = []
    for await (const d of createOpenAIStream({ url: '/x', body: {}, onEvent: (ev) => events.push(ev) })) {
      deltas.push(d)
    }
    expect(events).toEqual([{ event: 'card', data: JSON.stringify({ title: 'Ticket prices' }), id: undefined }])
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

  it('routes thinking_delta to onReasoning instead of yielding it', async () => {
    mockFetchOnce(
      sseResponse([
        `event: content_block_delta\ndata: ${JSON.stringify({ delta: { type: 'thinking_delta', thinking: 'hmm' } })}\n\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({ delta: { type: 'text_delta', text: 'answer' } })}\n\n`,
        'event: message_stop\ndata: {}\n\n',
      ]),
    )
    const reasoning: string[] = []
    const deltas: string[] = []
    for await (const d of createAnthropicStream({ url: '/x', body: {}, onReasoning: (t) => reasoning.push(t) })) {
      deltas.push(d)
    }
    expect(reasoning).toEqual(['hmm'])
    expect(deltas).toEqual(['answer'])
  })

  it('routes an unrecognized event name to onEvent, but still swallows known bookkeeping events', async () => {
    mockFetchOnce(
      sseResponse([
        'event: ping\ndata: {}\n\n',
        `event: custom_tool_call\ndata: ${JSON.stringify({ name: 'lookup' })}\n\n`,
        'event: message_stop\ndata: {}\n\n',
      ]),
    )
    const events: Array<{ event: string }> = []
    for await (const _ of createAnthropicStream({ url: '/x', body: {}, onEvent: (ev) => events.push(ev) })) {
      // draining is enough
    }
    expect(events.map((e) => e.event)).toEqual(['custom_tool_call'])
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

  it('routes a configured reasoning type to onReasoning instead of yielding it', async () => {
    mockFetchOnce(
      sseResponse([
        `data: ${JSON.stringify({ type: 'reasoning', content: 'thinking...' })}\n\n`,
        `data: ${JSON.stringify({ type: 'delta', content: 'answer' })}\n\n`,
        `data: ${JSON.stringify({ type: 'done' })}\n\n`,
      ]),
    )
    const reasoning: string[] = []
    const deltas: string[] = []
    for await (const d of createCustomJSONStream(
      { url: '/x', body: {}, onReasoning: (t) => reasoning.push(t) },
      { reasoningType: 'reasoning', reasoningField: 'content' },
    )) {
      deltas.push(d)
    }
    expect(reasoning).toEqual(['thinking...'])
    expect(deltas).toEqual(['answer'])
  })

  it('routes a non-"message" event to onEvent', async () => {
    mockFetchOnce(
      sseResponse([
        `event: card\ndata: ${JSON.stringify({ title: 'x' })}\n\n`,
        `data: ${JSON.stringify({ type: 'delta', content: 'a' })}\n\n`,
        `data: ${JSON.stringify({ type: 'done' })}\n\n`,
      ]),
    )
    const events: Array<{ event: string }> = []
    for await (const _ of createCustomJSONStream({ url: '/x', body: {}, onEvent: (ev) => events.push(ev) })) {
      // draining is enough
    }
    expect(events.map((e) => e.event)).toEqual(['card'])
  })
})
