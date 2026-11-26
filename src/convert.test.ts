import { describe, expect, it } from 'vitest'
import {
  anthropicToOpenAI,
  openaiToAnthropic,
  roundTripCheck,
  KNOWN_LOSSY,
  type AnthropicRequestBody,
  type OpenAIRequestBody,
} from './convert'

describe('anthropicToOpenAI', () => {
  it('moves the system prompt out of messages into a leading system message', () => {
    const { body } = anthropicToOpenAI({
      model: 'claude-x',
      system: 'You are terse.',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are terse.' })
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('concatenates a block-form system prompt', () => {
    const { body } = anthropicToOpenAI({
      model: 'claude-x',
      system: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(body.messages[0]?.content).toBe('a\nb')
  })

  it('converts assistant tool_use blocks into tool_calls with stringified arguments', () => {
    const { body } = anthropicToOpenAI({
      model: 'claude-x',
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Shanghai' } }],
        },
      ],
    })
    const msg = body.messages[0]
    expect(msg?.tool_calls).toEqual([
      { id: 'toolu_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Shanghai"}' } },
    ])
  })

  it('converts user tool_result blocks into role:tool messages carrying tool_call_id', () => {
    const { body } = anthropicToOpenAI({
      model: 'claude-x',
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'sunny' }],
        },
      ],
    })
    // A tool-only user turn becomes exactly one `role: 'tool'` message — no
    // leftover empty user turn.
    expect(body.messages).toEqual([
      { role: 'tool', tool_call_id: 'toolu_1', content: 'sunny' },
    ])
  })

  it('keeps a user turn that mixes text and tool_result as two OpenAI messages', () => {
    const { body } = anthropicToOpenAI({
      model: 'claude-x',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'here you go' },
            { type: 'tool_result', tool_use_id: 'toolu_1', content: 'sunny' },
          ],
        },
      ],
    })
    expect(body.messages[0]?.role).toBe('user')
    expect(body.messages[1]).toEqual({ role: 'tool', tool_call_id: 'toolu_1', content: 'sunny' })
  })

  it('converts base64 image blocks into image_url data parts', () => {
    const { body } = anthropicToOpenAI({
      model: 'claude-x',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          ],
        },
      ],
    })
    expect(body.messages[0]?.content).toEqual([
      { type: 'text', text: 'what is this' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
    ])
  })

  it('converts Anthropic tools into OpenAI function tools', () => {
    const { body } = anthropicToOpenAI({
      model: 'claude-x',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'f', description: 'd', input_schema: { type: 'object' } }],
    })
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } } },
    ])
  })

  it('supplies a default max_tokens because Anthropic requires it', () => {
    const { body } = anthropicToOpenAI({
      model: 'claude-x',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(body.max_tokens).toBe(4096)
  })

  it('reports the system-prompt relocation as lossy', () => {
    const { lossy } = anthropicToOpenAI({
      model: 'claude-x',
      system: 'x',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(lossy).toContain(KNOWN_LOSSY.ANTHROPIC_SYSTEM_OUT_OF_MESSAGES)
  })

  it('calls onLossy for each lossy conversion', () => {
    const seen: string[] = []
    anthropicToOpenAI(
      { model: 'm', system: 'x', messages: [{ role: 'user', content: 'hi' }] },
      { onLossy: (r) => seen.push(r) },
    )
    expect(seen).toContain(KNOWN_LOSSY.ANTHROPIC_SYSTEM_OUT_OF_MESSAGES)
  })
})

describe('openaiToAnthropic', () => {
  it('moves a leading system message into the top-level system field', () => {
    const { body } = openaiToAnthropic({
      model: 'gpt-x',
      messages: [
        { role: 'system', content: 'be nice' },
        { role: 'user', content: 'hi' },
      ],
    })
    expect(body.system).toBe('be nice')
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }])
  })

  it('converts assistant tool_calls into tool_use blocks with parsed input', () => {
    const { body } = openaiToAnthropic({
      model: 'gpt-x',
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'f', arguments: '{"a":1}' } },
          ],
        },
      ],
    })
    expect(body.messages[0]?.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'f', input: { a: 1 } },
    ])
  })

  it('keeps malformed tool arguments visible instead of dropping them', () => {
    const { body } = openaiToAnthropic({
      model: 'gpt-x',
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{bad' } }],
        },
      ],
    })
    const blocks = body.messages[0]?.content as Array<{ type: string; input?: unknown }>
    expect(blocks[0]?.input).toEqual({ __raw: '{bad' })
  })

  it('merges consecutive tool messages into one user turn of tool_result blocks', () => {
    const { body } = openaiToAnthropic({
      model: 'gpt-x',
      messages: [
        { role: 'user', content: 'q' },
        { role: 'tool', tool_call_id: 'c1', content: 'r1' },
        { role: 'tool', tool_call_id: 'c2', content: 'r2' },
      ],
    })
    expect(body.messages).toHaveLength(2)
    const blocks = body.messages[1]?.content as Array<{ type: string; tool_use_id: string }>
    expect(blocks).toEqual([
      { type: 'tool_result', tool_use_id: 'c1', content: 'r1' },
      { type: 'tool_result', tool_use_id: 'c2', content: 'r2' },
    ])
  })

  it('converts base64 data-URL image parts into Anthropic image blocks', () => {
    const { body } = openaiToAnthropic({
      model: 'gpt-x',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } }],
        },
      ],
    })
    const blocks = body.messages[0]?.content as Array<{ type: string; source?: { media_type: string; data: string } }>
    expect(blocks[0]?.source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: 'BBBB' })
  })

  it('converts OpenAI function tools into Anthropic tools', () => {
    const { body } = openaiToAnthropic({
      model: 'gpt-x',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'f', description: 'd', parameters: { type: 'object' } } }],
    })
    expect(body.tools).toEqual([{ name: 'f', description: 'd', input_schema: { type: 'object' } }])
  })
})

describe('round trip', () => {
  it('preserves a plain Anthropic conversation', () => {
    const original: AnthropicRequestBody = {
      model: 'claude-x',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
        { role: 'user', content: 'bye' },
      ],
      max_tokens: 100,
    }
    const result = roundTripCheck(original)
    expect(result.body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(result.body.messages[0]?.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.body.messages[1]?.content).toEqual([{ type: 'text', text: 'hi there' }])
  })

  it('preserves a tool-call round trip: tool_use becomes tool_calls and back', () => {
    const original: AnthropicRequestBody = {
      model: 'claude-x',
      messages: [
        { role: 'user', content: 'weather?' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_9', name: 'get_weather', input: { city: 'SH' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_9', content: 'sunny' }],
        },
      ],
      max_tokens: 100,
    }
    const result = roundTripCheck(original)
    const assistant = result.body.messages[1]?.content as Array<{ type: string; id?: string; input?: unknown }>
    expect(assistant[0]?.type).toBe('tool_use')
    expect(assistant[0]?.id).toBe('toolu_9')
    expect(assistant[0]?.input).toEqual({ city: 'SH' })

    const toolTurn = result.body.messages[2]?.content as Array<{ type: string; tool_use_id?: string; content?: string }>
    expect(toolTurn[0]?.type).toBe('tool_result')
    expect(toolTurn[0]?.tool_use_id).toBe('toolu_9')
    expect(toolTurn[0]?.content).toBe('sunny')
  })

  it('round-trips an image block', () => {
    const original: AnthropicRequestBody = {
      model: 'claude-x',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'ZZZZ' } }],
        },
      ],
      max_tokens: 100,
    }
    const result = roundTripCheck(original)
    const blocks = result.body.messages[0]?.content as Array<{ type: string; source?: { data: string } }>
    expect(blocks[0]?.source?.data).toBe('ZZZZ')
  })

  it('reports lossy when the system prompt was present', () => {
    const result = roundTripCheck({
      model: 'claude-x',
      system: 'sys',
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(result.lossy.length).toBeGreaterThan(0)
  })
})

describe('conversion preserves unrelated fields', () => {
  it('keeps model, temperature and stream', () => {
    const openai: OpenAIRequestBody = {
      model: 'gpt-x',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.3,
      stream: true,
    }
    const { body } = openaiToAnthropic(openai)
    expect(body.model).toBe('gpt-x')
    expect(body.temperature).toBe(0.3)
    expect(body.stream).toBe(true)
  })
})
