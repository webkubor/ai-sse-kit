import { describe, expect, it } from 'vitest'
import { patchLastAssistant, patchMessageById } from './apply'

interface Msg {
  id: string
  role: string
  content: string
}

describe('patchLastAssistant', () => {
  it('merges a partial patch into the last message when it matches the role', () => {
    const list: Msg[] = [
      { id: '1', role: 'user', content: 'hi' },
      { id: '2', role: 'assistant', content: 'he' },
    ]
    const next = patchLastAssistant(list, { content: 'hello' })
    expect(next[1]!.content).toBe('hello')
    expect(next).not.toBe(list) // new array
    expect(list[1]!.content).toBe('he') // original untouched
  })

  it('accepts a function patch computed from the current value', () => {
    const list: Msg[] = [{ id: '1', role: 'assistant', content: 'he' }]
    const next = patchLastAssistant(list, (m) => ({ content: m.content + 'llo' }))
    expect(next[0]!.content).toBe('hello')
  })

  it('returns the same reference when the last message is not the target role', () => {
    const list: Msg[] = [{ id: '1', role: 'user', content: 'hi' }]
    const next = patchLastAssistant(list, { content: 'x' })
    expect(next).toBe(list)
  })

  it('returns the same reference on an empty list', () => {
    const list: Msg[] = []
    expect(patchLastAssistant(list, { content: 'x' })).toBe(list)
  })

  it('respects a custom role', () => {
    const list: Msg[] = [{ id: '1', role: 'system', content: 'a' }]
    const next = patchLastAssistant(list, { content: 'b' }, 'system')
    expect(next[0]!.content).toBe('b')
  })
})

describe('patchMessageById', () => {
  it('patches the message with the matching id', () => {
    const list: Msg[] = [
      { id: '1', role: 'user', content: 'a' },
      { id: '2', role: 'assistant', content: 'b' },
    ]
    const next = patchMessageById(list, '1', { content: 'z' })
    expect(next[0]!.content).toBe('z')
    expect(next[1]).toBe(list[1]!) // untouched item keeps identity
  })

  it('returns the same reference when no message matches', () => {
    const list: Msg[] = [{ id: '1', role: 'user', content: 'a' }]
    expect(patchMessageById(list, 'missing', { content: 'z' })).toBe(list)
  })
})
