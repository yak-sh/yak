/**
 * @yaks/anthropic implements @yaks/model's {@link Model} over Anthropic's
 * Messages API, through the official SDK. Every request streams: output text
 * reaches `onText` as it is written, `signal` stops the request, and tool
 * calls come back as `call` items for the caller to run.
 *
 * ```ts
 * import { messages } from '@yaks/anthropic'
 *
 * let model = messages({ key: () => 'the key, from the vault' })
 * // let reply = await model({
 * //   model: 'claude-sonnet-5-5',
 * //   items: [{ kind: 'user', text: 'Hello' }],
 * //   tools: [],
 * // })
 * ```
 *
 * The API keeps nothing between requests, so every request carries the whole
 * conversation, and automatic prompt caching (`cache_control` on the request)
 * reads the prefix the last request wrote. Thinking blocks are not carried
 * back: the API answers a history without them, and the reasoning is private.
 *
 * @module
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  acknowledged,
  type Item,
  type Listed,
  listPrice,
  type Model,
  ModelError,
  type Request,
  submitted,
  type Tool,
  type Usage,
} from '@yaks/model'
import { anthropicDoc } from './vocab.ts'
import { mark } from './mark.ts'
import { READS } from './reads.ts'

export { anthropicDoc, mark, READS }

export type Options = {
  /** Obtain an Anthropic API key at the moment of the call. */
  key: () => string | Promise<string>
  fetch?: typeof fetch
  /** The API's root, `https://api.anthropic.com` by default. */
  base?: string
}

type Param = Anthropic.MessageParam
type Block = Exclude<Param['content'], string>[number]

// A reply's ceiling where the request names none: streamed, so no timeout.
let TOKENS = 64_000
let EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/** Instructions open the system prompt; one met later in the conversation is
 * said as text in the turn it falls in, which every model accepts. */
export let system = (req: Request): string | undefined => {
  let lead = req.items.findIndex((i) => i.kind != 'instruction')
  let said = req.items.slice(0, lead < 0 ? undefined : lead)
    .map((i) => (i as { text: string }).text)
  let text = [req.instructions, ...said].filter(Boolean).join('\n\n')
  return text || undefined
}

let blocks = (i: Item): ['user' | 'assistant', Block[]] | undefined => {
  switch (i.kind) {
    case 'user':
    case 'instruction':
      return i.text ? ['user', [{ type: 'text', text: i.text }]] : undefined
    case 'assistant':
      return i.text
        ? ['assistant', [{ type: 'text', text: i.text }]]
        : undefined
    // Named first, so Claude knows which file it is looking at.
    case 'image':
    case 'document': {
      let source = { type: 'base64', data: base64(i.bytes) }
      return ['user', [
        ...i.label ? [{ type: 'text' as const, text: i.label }] : [],
        i.kind == 'image'
          ? {
            type: 'image',
            source: {
              ...source,
              media_type: i.mediaType as 'image/png',
            } as Anthropic.Base64ImageSource,
          }
          : {
            type: 'document',
            source: {
              ...source,
              media_type: i.mediaType as 'application/pdf',
            } as Anthropic.Base64PDFSource,
          },
      ]]
    }
    case 'call':
      return ['assistant', [{
        type: 'tool_use',
        id: i.id,
        name: i.name,
        input: parsed(i.args),
      }]]
    case 'result':
      return ['user', [{
        type: 'tool_result',
        tool_use_id: i.id,
        content: i.output,
      }]]
  }
}

/** The conversation as messages: consecutive blocks of one role share a
 * message, so a turn's tool results answer together. */
export let conversation = (req: Request): Param[] => {
  let lead = req.items.findIndex((i) => i.kind != 'instruction')
  let out: Param[] = []
  for (let i of lead < 0 ? [] : req.items.slice(lead)) {
    let b = blocks(i)
    if (!b) continue
    let [role, content] = b
    let last = out.at(-1)
    if (last?.role == role) (last.content as Block[]).push(...content)
    else out.push({ role, content })
  }
  return out
}

/** Tools in name order, so the cached prefix is the same each request. */
export let tools = (list: Tool[]): Anthropic.Tool[] =>
  [...list].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object',
        ...t.parameters,
      } as Anthropic.Tool.InputSchema,
    }))

/** Anthropic counts cache reads and writes beside `input_tokens`; here they
 * are parts of it. */
export let usage = (u: Anthropic.Usage): Usage => {
  let read = u.cache_read_input_tokens ?? 0
  let wrote = u.cache_creation_input_tokens ?? 0
  let hour = u.cache_creation?.ephemeral_1h_input_tokens
  return {
    input_tokens: (u.input_tokens ?? 0) + read + wrote,
    output_tokens: u.output_tokens,
    cached_tokens: read,
    cache_write_tokens: wrote,
    ...hour ? { cache_write_1h_tokens: hour } : {},
  }
}

/** A reply's items in the order the model wrote them. */
export let items = (content: Anthropic.ContentBlock[]): Item[] =>
  content.flatMap((b): Item[] =>
    b.type == 'text'
      ? b.text ? [{ kind: 'assistant', text: b.text }] : []
      : b.type == 'tool_use'
      ? [{
        kind: 'call',
        id: b.id,
        name: b.name,
        args: JSON.stringify(b.input ?? {}),
      }]
      : []
  )

/**
 * What the API refused with, said the way a model's failure is said here: a
 * rate limit or an overloaded or failing server is `busy` and may pass, a
 * spent credit balance is `limit`, a refused key is `key`, an unknown model is
 * `model`, and a request it would not take is `request`. A stop the caller
 * asked for is thrown on as it came.
 */
export let failure = (e: unknown): unknown => {
  if (e instanceof Anthropic.APIUserAbortError) return e
  if (e instanceof Anthropic.APIConnectionError) {
    return new ModelError('busy', e.message, {})
  }
  if (!(e instanceof Anthropic.APIError)) return e
  let response = { body: JSON.stringify(e.error ?? null) }
  let wait = Number(e.headers?.get('retry-after'))
  let retry = Number.isFinite(wait) && wait > 0 ? { after: wait * 1000 } : {}
  let said = e.message
  return e instanceof Anthropic.RateLimitError ||
      e instanceof Anthropic.InternalServerError
    ? new ModelError('busy', said, retry, response)
    : e instanceof Anthropic.AuthenticationError ||
        e instanceof Anthropic.PermissionDeniedError
    ? new ModelError('key', said, undefined, response)
    : e instanceof Anthropic.NotFoundError
    ? new ModelError('model', said, undefined, response)
    : /credit balance/i.test(said)
    ? new ModelError('limit', said, undefined, response)
    : new ModelError('request', said, undefined, response)
}

/** A model as the API lists it, at the price @yaks/model's list has for its
 * name: the API says no price. */
export let listed = (m: Anthropic.ModelInfo): Listed => {
  let price = listPrice(m.id)
  return {
    name: m.id,
    label: m.display_name,
    ...m.max_input_tokens ? { context: m.max_input_tokens } : {},
    modalities: ['text'],
    ...price ? { price } : {},
  }
}

/** A model over the Messages API. Its `info` gives the context window the
 * API lists and the price @yaks/model's list has for the name. */
export let messages = (options: Options): Model => {
  let client = async () =>
    new Anthropic({
      apiKey: await options.key(),
      // Named, so a host's ANTHROPIC_BASE_URL never redirects the key.
      baseURL: options.base ?? 'https://api.anthropic.com',
      fetch: options.fetch,
      // The caller retries: a retry here could buy one request twice.
      maxRetries: 0,
    })
  let known = new Map<string, Promise<Listed | undefined>>()
  let info = (name: string) => {
    let held = known.get(name) ?? client().then(async (c) => {
      return listed(await c.models.retrieve(name))
    }).catch((e) => {
      known.delete(name)
      let f = failure(e)
      if (f instanceof ModelError && f.code == 'model') return undefined
      throw f
    })
    known.set(name, held)
    return held
  }

  let model: Model = async (req) => {
    if (req.questions) {
      throw new ModelError('questions', 'Claude answers no typed questions')
    }
    if (req.modalities?.some((m) => m != 'text')) {
      throw new ModelError('modalities', 'Claude writes text only')
    }
    let c = await client()
    let effort = req.effort && EFFORTS.includes(req.effort)
      ? req.effort as Anthropic.OutputConfig['effort']
      : undefined
    let body: Anthropic.MessageStreamParams = {
      model: req.model,
      max_tokens: req.tokens ?? TOKENS,
      cache_control: { type: 'ephemeral' },
      system: system(req),
      messages: conversation(req),
      ...req.tools.length ? { tools: tools(req.tools) } : {},
      ...effort ? { output_config: { effort } } : {},
    }
    await submitted(req)
    let message: Anthropic.Message
    try {
      let stream = c.messages.stream(body, { signal: req.signal })
      // A text block's place among the reply's assistant items.
      let ordinal = new Map<number, number>()
      for await (let event of stream) {
        if (event.type == 'message_start') {
          await acknowledged(req, {
            anthropic: { response_id: event.message.id },
          })
        } else if (
          event.type == 'content_block_start' &&
          event.content_block.type == 'text'
        ) {
          ordinal.set(event.index, ordinal.size)
        } else if (
          event.type == 'content_block_delta' &&
          event.delta.type == 'text_delta' && event.delta.text
        ) {
          req.onText?.({
            index: ordinal.get(event.index) ?? 0,
            text: event.delta.text,
          })
        }
      }
      message = await stream.finalMessage()
    } catch (e) {
      throw failure(e)
    }
    if (message.stop_reason == 'refusal') {
      throw new ModelError(
        'refusal',
        message.stop_details?.explanation ?? 'Claude declined this request',
      )
    }
    return {
      id: message.id,
      model: message.model,
      items: items(message.content),
      usage: usage(message.usage),
    }
  }
  return Object.assign(model, {
    info,
    list: async () => {
      let c = await client()
      let out: Listed[] = []
      for await (let m of c.models.list()) out.push(listed(m))
      return out
    },
    vocab: anthropicDoc,
    mark,
    anchor: () => undefined,
  })
}

let parsed = (args: string): unknown => {
  try {
    let v = JSON.parse(args || '{}')
    return v && typeof v == 'object' ? v : {}
  } catch {
    return {}
  }
}

let base64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}
