/**
 * Anthropic ⇄ OpenAI message-body conversion.
 *
 * Why this file exists: the stream adapters in `adapters.ts` handle the *wire*
 * side of each protocol (SSE framing, event names, delta shapes). This file
 * handles the *body* side — the request/response JSON you hand to an upstream
 * endpoint. Before it existed, a gateway that wanted to speak to both vendors
 * had to hand-write the mapping in its own codebase every time; the mapping
 * is fiddly (tool_use/tool_result pairing, image blocks, system prompt
 * placement) and easy to get subtly wrong.
 *
 * Scope — deliberately narrow, mirroring the package's stated boundaries:
 *   - Converts **message bodies** (request direction) and **content blocks**
 *     (response direction). It does not convert SSE frames — `adapters.ts`
 *     already does that.
 *   - Does not do provider abstraction, model selection, or routing.
 *   - Does not own message state; you keep your own message model.
 *
 * Both directions are lossless for the common cases and **explicitly lossy**
 * where the two protocols genuinely differ — every such case is listed in
 * `KNOWN_LOSSY` below and reported through `lossy` so callers can decide.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Anthropic content block (subset covering text, image, tool_use, tool_result). */
export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content?: string | AnthropicContentBlock[]; is_error?: boolean }

/** Anthropic message. `content` is a plain string in requests, blocks in responses. */
export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

/** OpenAI chat message. `content` is a string or a list of content parts. */
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAIContentPart[] | null
  /** Present on assistant messages that request tool calls. */
  tool_calls?: OpenAIToolCall[]
  /** Present on tool-result messages; links back to `tool_calls[].id`. */
  tool_call_id?: string
}

export interface OpenAIContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** Anthropic request body (the parts we care about). */
export interface AnthropicRequestBody {
  model: string
  messages: AnthropicMessage[]
  system?: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'string' } }>
  max_tokens?: number
  temperature?: number
  stream?: boolean
  tools?: AnthropicTool[]
  [k: string]: unknown
}

export interface AnthropicTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
}

/** OpenAI chat-completions request body (the parts we care about). */
export interface OpenAIRequestBody {
  model: string
  messages: OpenAIMessage[]
  max_tokens?: number
  temperature?: number
  stream?: boolean
  tools?: Array<{ type: 'function'; function: { name: string; description?: string; parameters: Record<string, unknown> } }>
  [k: string]: unknown
}

// ---------------------------------------------------------------------------
// Loss reporting
// ---------------------------------------------------------------------------

/**
 * Conversions that cannot be expressed in the target protocol. Each entry names
 * the source feature that had no faithful equivalent.
 */
export const KNOWN_LOSSY = {
  /** Anthropic puts the system prompt outside `messages`; OpenAI puts it in. */
  ANTHROPIC_SYSTEM_OUT_OF_MESSAGES: 'anthropic-system-out-of-messages',
  /** Anthropic `thinking` blocks have no OpenAI equivalent. */
  ANTHROPIC_THINKING_BLOCK: 'anthropic-thinking-block',
  /** OpenAI `tool` role messages have no single-block Anthropic equivalent. */
  OPENAI_TOOL_ROLE_MESSAGE: 'openai-tool-role-message',
  /** Anthropic allows multiple tool_results in one user turn; OpenAI needs one message each. */
  ANTHROPIC_MULTIPLE_TOOL_RESULTS: 'anthropic-multiple-tool-results',
  /** OpenAI image_url `detail` has no Anthropic counterpart. */
  OPENAI_IMAGE_DETAIL: 'openai-image-detail',
  /** Anthropic server-side `cache_control` has no OpenAI equivalent. */
  ANTHROPIC_CACHE_CONTROL: 'anthropic-cache-control',
} as const

export type LossyReason = (typeof KNOWN_LOSSY)[keyof typeof KNOWN_LOSSY]

/** Optional sink for lossy-conversion notices. */
export interface ConversionOptions {
  /** Called once per lossy conversion. Prefer collecting over throwing. */
  onLossy?: (reason: LossyReason, detail?: string) => void
  /**
   * Anthropic requires `max_tokens`. When converting Anthropic→OpenAI and the
   * source has no `max_tokens`, this supplies one. Defaults to 4096.
   */
  defaultMaxTokens?: number
  /**
   * How to turn a tool's JSON-schema input into an OpenAI function tool.
   * Defaults to a straight `input_schema` → `parameters` copy.
   */
  toolSchema?: 'input_schema' | 'parameters'
}

// ---------------------------------------------------------------------------
// Anthropic → OpenAI
// ---------------------------------------------------------------------------

function textOf(content: string | AnthropicContentBlock[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((b): b is Extract<AnthropicContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

/**
 * Converts an Anthropic request body into an OpenAI chat-completions body.
 *
 * Mapping decisions:
 *   - `system` (outside messages) → a leading `system` message.
 *   - assistant `tool_use` blocks → `tool_calls` on the assistant message, with
 *     `input` serialized to a JSON string (OpenAI wants a string).
 *   - user `tool_result` blocks → separate `role: 'tool'` messages, one per
 *     result, each carrying `tool_call_id`.
 *   - image blocks → `image_url` parts with a `data:` URL.
 */
export function anthropicToOpenAI(
  body: AnthropicRequestBody,
  options: ConversionOptions = {},
): { body: OpenAIRequestBody; lossy: LossyReason[] } {
  const lossy: LossyReason[] = []
  const note = (r: LossyReason, detail?: string) => {
    lossy.push(r)
    options.onLossy?.(r, detail)
  }

  const messages: OpenAIMessage[] = []

  // System prompt: Anthropic keeps it out of `messages`.
  if (body.system != null) {
    const sysText =
      typeof body.system === 'string'
        ? body.system
        : body.system.map((b) => b.text).join('\n')
    if (sysText) {
      messages.push({ role: 'system', content: sysText })
      note(KNOWN_LOSSY.ANTHROPIC_SYSTEM_OUT_OF_MESSAGES)
    }
    if (Array.isArray(body.system) && body.system.some((b) => b.cache_control)) {
      note(KNOWN_LOSSY.ANTHROPIC_CACHE_CONTROL)
    }
  }

  for (const msg of body.messages) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content })
      continue
    }

    const parts: OpenAIContentPart[] = []
    const toolCalls: OpenAIToolCall[] = []
    const toolResults: Array<Extract<AnthropicContentBlock, { type: 'tool_result' }>> = []

    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          parts.push({ type: 'text', text: block.text })
          break
        case 'image':
          parts.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`,
            },
          })
          break
        case 'tool_use':
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}),
            },
          })
          break
        case 'tool_result':
          toolResults.push(block)
          break
        default:
          // Unknown block types (e.g. `thinking`) have no OpenAI equivalent.
          note(KNOWN_LOSSY.ANTHROPIC_THINKING_BLOCK, JSON.stringify(block).slice(0, 120))
      }
    }

    if (msg.role === 'assistant') {
      const out: OpenAIMessage = { role: 'assistant', content: parts.length ? parts : null }
      if (toolCalls.length) out.tool_calls = toolCalls
      messages.push(out)
      // A tool_result in an assistant turn is not legal in Anthropic, but if it
      // shows up, surface it rather than silently dropping it.
      if (toolResults.length) {
        note(KNOWN_LOSSY.OPENAI_TOOL_ROLE_MESSAGE, 'tool_result in assistant turn')
        for (const r of toolResults) {
          messages.push({
            role: 'tool',
            tool_call_id: r.tool_use_id,
            content: textOf(r.content ?? ''),
          })
        }
      }
    } else {
      // user turn
      // A user turn that carries only tool_result blocks maps to OpenAI's
      // `role: 'tool'` messages alone — emitting an extra empty user message
      // alongside them would change the conversation shape on a round trip.
      if (parts.length) {
        messages.push({ role: 'user', content: parts })
      }
      if (toolResults.length) {
        if (toolResults.length > 1) note(KNOWN_LOSSY.ANTHROPIC_MULTIPLE_TOOL_RESULTS)
        for (const r of toolResults) {
          messages.push({
            role: 'tool',
            tool_call_id: r.tool_use_id,
            content: textOf(r.content ?? ''),
          })
        }
      }
    }
  }

  const out: OpenAIRequestBody = {
    model: body.model,
    messages,
  }
  if (body.max_tokens != null) out.max_tokens = body.max_tokens
  else out.max_tokens = options.defaultMaxTokens ?? 4096
  if (body.temperature != null) out.temperature = body.temperature
  if (body.stream != null) out.stream = body.stream

  if (body.tools?.length) {
    out.tools = body.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        parameters: t.input_schema as Record<string, unknown>,
      },
    }))
  }

  return { body: out, lossy }
}

// ---------------------------------------------------------------------------
// OpenAI → Anthropic
// ---------------------------------------------------------------------------

/**
 * Converts an OpenAI chat-completions request body into an Anthropic Messages body.
 *
 * Mapping decisions:
 *   - a leading `system` message → Anthropic's top-level `system` field.
 *   - assistant `tool_calls` → `tool_use` blocks in the assistant's content.
 *   - `role: 'tool'` messages → `tool_result` blocks, merged back into a
 *     single user turn when they are consecutive (Anthropic expects the
 *     results of one assistant turn's tool calls to sit in the next user turn).
 *   - `image_url` parts with a `data:` URL → Anthropic base64 image blocks.
 *   - `image_url` parts with an http(s) URL cannot be expressed — Anthropic
 *     only accepts base64 or `url` source types. Those are reported as lossy
 *     and dropped, since Anthropic does accept a `url` source type.
 */
export function openaiToAnthropic(
  body: OpenAIRequestBody,
  options: ConversionOptions = {},
): { body: AnthropicRequestBody; lossy: LossyReason[] } {
  const lossy: LossyReason[] = []
  const note = (r: LossyReason, detail?: string) => {
    lossy.push(r)
    options.onLossy?.(r, detail)
  }

  const messages: AnthropicMessage[] = []
  let system: string | undefined

  const source = body.messages
  let i = 0
  while (i < source.length) {
    const msg = source[i]
    if (!msg) break

    if (msg.role === 'system') {
      const text = typeof msg.content === 'string' ? msg.content : textOfOpenAI(msg.content)
      system = system ? `${system}\n${text}` : text
      note(KNOWN_LOSSY.ANTHROPIC_SYSTEM_OUT_OF_MESSAGES)
      i++
      continue
    }

    if (msg.role === 'tool') {
      // Merge consecutive tool messages into one user turn of tool_result blocks.
      const blocks: AnthropicContentBlock[] = []
      while (i < source.length) {
        const t = source[i]
        if (!t || t.role !== 'tool') break
        blocks.push({
          type: 'tool_result',
          tool_use_id: t.tool_call_id ?? '',
          content: typeof t.content === 'string' ? t.content : textOfOpenAI(t.content),
        })
        i++
      }
      messages.push({ role: 'user', content: blocks })
      continue
    }

    if (msg.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = []
      const text = typeof msg.content === 'string' ? msg.content : textOfOpenAI(msg.content)
      if (text) blocks.push({ type: 'text', text })
      for (const tc of msg.tool_calls ?? []) {
        let input: unknown = {}
        try {
          input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
        } catch {
          // Arguments weren't valid JSON — pass through as a string so the
          // caller can see the malformed payload rather than losing it.
          input = { __raw: tc.function.arguments }
        }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
      }
      messages.push({ role: 'assistant', content: blocks.length ? blocks : '' })
      i++
      continue
    }

    // user
    const blocks: AnthropicContentBlock[] = []
    if (typeof msg.content === 'string') {
      if (msg.content) blocks.push({ type: 'text', text: msg.content })
    } else {
      for (const part of msg.content ?? []) {
        if (part.type === 'text') {
          if (part.text) blocks.push({ type: 'text', text: part.text })
        } else if (part.type === 'image_url') {
          const url = part.image_url?.url ?? ''
          const m = /^data:([^;]+);base64,(.*)$/.exec(url)
          if (m?.[1] && m[2]) {
            blocks.push({
              type: 'image',
              source: { type: 'base64', media_type: m[1], data: m[2] },
            })
          } else if (url.startsWith('http://') || url.startsWith('https://')) {
            // Anthropic does support a `url` source type, but its media_type
            // requirement differs; report it rather than guessing.
            note(KNOWN_LOSSY.OPENAI_IMAGE_DETAIL, url.slice(0, 120))
          }
        }
      }
    }
    messages.push({ role: 'user', content: blocks.length ? blocks : '' })
    i++
  }

  const out: AnthropicRequestBody = {
    model: body.model,
    messages,
  }
  if (system != null) out.system = system
  if (body.max_tokens != null) out.max_tokens = body.max_tokens
  else out.max_tokens = options.defaultMaxTokens ?? 4096
  if (body.temperature != null) out.temperature = body.temperature
  if (body.stream != null) out.stream = body.stream

  if (body.tools?.length) {
    out.tools = body.tools.map((t) => ({
      name: t.function.name,
      ...(t.function.description ? { description: t.function.description } : {}),
      input_schema: t.function.parameters as Record<string, unknown>,
    }))
  }

  return { body: out, lossy }
}

function textOfOpenAI(content: OpenAIContentPart[] | null | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content
    .filter((p): p is OpenAIContentPart & { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

// ---------------------------------------------------------------------------
// Round-trip helper
// ---------------------------------------------------------------------------

/**
 * Converts Anthropic → OpenAI → Anthropic and reports what did not survive.
 *
 * Useful as a self-check at the boundary of a gateway ("did my conversion
 * lose anything?") rather than as a production path.
 */
export function roundTripCheck(
  anthropicBody: AnthropicRequestBody,
  options: ConversionOptions = {},
): { ok: boolean; lossy: LossyReason[]; body: AnthropicRequestBody } {
  const toOpenAI = anthropicToOpenAI(anthropicBody, options)
  const back = openaiToAnthropic(toOpenAI.body, options)
  return {
    ok: back.lossy.length === 0 && toOpenAI.lossy.length === 0,
    lossy: [...toOpenAI.lossy, ...back.lossy],
    body: back.body,
  }
}
