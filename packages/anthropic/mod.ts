/**
 * @yaks/anthropic implements @yaks/model's {@link Model} over Anthropic's
 * Messages API, spoken over fetch. Every request streams: output text
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

import {
  acknowledged,
  began,
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
import { HOSTED, web } from './web.ts'
import {
  type ApiUsage,
  type Block,
  built,
  type Citation,
  type Content,
  events,
  failure,
  type Message,
  type ModelInfo,
  type Page,
  type Param,
  send,
  type ToolParam,
} from './wire.ts'

export { anthropicDoc, failure, mark, READS }

export type Options = {
  /** Obtain an Anthropic API key at the moment of the call. */
  key: () => string | Promise<string>
  fetch?: typeof fetch
  /** The API's root, `https://api.anthropic.com` by default. */
  base?: string
  /** Offer the API's own web search and page fetch. */
  web?: boolean
}

// A reply's ceiling where the request names none: streamed, so no timeout.
let TOKENS = 64_000
let EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/** Where the conversation begins: at its first item that is no instruction.
 * Every instruction before it opens the system prompt, whatever follows, so a
 * checkpoint's summary stays where the last request sent it and the cached
 * prefix holds. */
let leadOf = (req: Request) => {
  let lead = req.items.findIndex((i) => i.kind != 'instruction')
  return lead < 0 ? req.items.length : lead
}

/** The turn a conversation opens with where it opens with none of the
 * person's (a checkpoint that summarized every line, then its replies), since
 * the API takes a conversation only from a user message. It is the same each
 * request, so the next request's prefix is this one's. */
export let OPENER = 'Continue from the instructions above.'

/** Instructions open the system prompt; one met later in the conversation is
 * said as text in the turn it falls in, which every model accepts. */
export let system = (req: Request): string | undefined => {
  let said = req.items.slice(0, leadOf(req))
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
      let source = { type: 'base64' as const, data: base64(i.bytes) }
      return ['user', [
        ...i.label ? [{ type: 'text' as const, text: i.label }] : [],
        i.kind == 'image'
          ? { type: 'image', source: { ...source, media_type: i.mediaType } }
          : {
            type: 'document',
            ...i.filename ? { title: i.filename } : {},
            source: i.mediaType == 'text/plain'
              ? {
                type: 'text',
                media_type: 'text/plain',
                data: new TextDecoder().decode(i.bytes),
              }
              : { ...source, media_type: i.mediaType },
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
 * message, so a turn's tool results answer together. The API takes a
 * message's tool results before anything else in it, so a result placed after
 * an image shown beside an earlier one joins the results ahead of it. */
export let conversation = (req: Request): Param[] => {
  let out: Param[] = []
  for (let i of req.items.slice(leadOf(req))) {
    let b = blocks(i)
    if (!b) continue
    let [role, content] = b
    let last = out.at(-1)
    if (last?.role != role) out.push({ role, content })
    else if (i.kind != 'result') last.content.push(...content)
    else {
      let at = last.content.findIndex((c) => c.type != 'tool_result')
      last.content.splice(at < 0 ? last.content.length : at, 0, ...content)
    }
  }
  if (out[0]?.role != 'user') {
    out.unshift({ role: 'user', content: [{ type: 'text', text: OPENER }] })
  }
  return out
}

/** Whether a request keeps its cached prefix the hour Anthropic offers
 * beside its default five minutes, at a dearer write. */
let hour = (req: Request) => (req.cacheRetention ?? 0) >= 3600

/** Tools in name order, so the cached prefix is the same each request. */
export let tools = (list: Tool[]): ToolParam[] =>
  [...list].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: { type: 'object', ...t.parameters },
    }))

/** Anthropic counts cache reads and writes beside `input_tokens`; here they
 * are parts of it. */
export let usage = (u: ApiUsage): Usage => {
  let read = u.cache_read_input_tokens ?? 0
  let wrote = u.cache_creation_input_tokens ?? 0
  let hour = u.cache_creation?.ephemeral_1h_input_tokens
  let searched = u.server_tool_use?.web_search_requests
  return {
    input_tokens: (u.input_tokens ?? 0) + read + wrote,
    output_tokens: u.output_tokens,
    cached_tokens: read,
    cache_write_tokens: wrote,
    ...hour ? { cache_write_1h_tokens: hour } : {},
    ...searched ? { web_searches: searched } : {},
  }
}

let page = (url?: string) => {
  try {
    let u = new URL(url ?? '')
    return u.protocol == 'https:' || u.protocol == 'http:' ? u : undefined
  } catch {
    return undefined
  }
}

/** A link to each page cited that the text has not linked yet. */
let sources = (cited: Citation[] = [], linked: Set<string>) =>
  cited.map((c) => {
    let url = page(c.url)
    if (!url || linked.has(url.href)) return ''
    linked.add(url.href)
    let title = (c.title || url.hostname).replace(/[\[\]\\\r\n]/g, ' ')
    return ` [${title}](<${url.href.replaceAll('>', '%3E')}>)`
  }).join('')

/** A reply's items in the order the model wrote them. Text runs on across the
 * blocks its citations split it into and the searches and fetches the API ran
 * within it, and each web page it cites is linked after the text citing it.
 * A call's arguments are its input, or the text of an input cut short. */
export let items = (content: Content[]): Item[] => {
  let out: Item[] = []
  let linked = new Set<string>()
  let ran = false
  for (let b of content) {
    if (b.type == 'tool_use') {
      out.push({
        kind: 'call',
        id: b.id!,
        name: b.name!,
        args: b.json ?? JSON.stringify(b.input ?? {}),
      })
    } else if (b.type == 'text') {
      let last = out.at(-1)
      if (last?.kind != 'assistant') linked = new Set()
      let text = (b.text ?? '') + sources(b.citations, linked)
      if (!text) continue
      if (last?.kind == 'assistant') last.text += (ran ? '\n\n' : '') + text
      else out.push({ kind: 'assistant', text })
    }
    ran = b.type != 'text'
  }
  return out
}

/** A model as the API lists it, at the price @yaks/model's list has for its
 * name: the API says no price. */
export let listed = (m: ModelInfo): Listed => {
  let price = listPrice(m.id)
  return {
    name: m.id,
    label: m.display_name,
    ...m.max_input_tokens ? { context: m.max_input_tokens } : {},
    ...m.max_tokens ? { output: m.max_tokens } : {},
    modalities: ['text'],
    ...price ? { price } : {},
  }
}

let ended = () =>
  new ModelError('busy', 'the stream ended before its message did', {})

/** The message a reply's stream builds, told as it is written: its first
 * event acknowledges the request, any block (text, thinking or a tool call)
 * is the reply's output beginning, and text reaches `onText` at its place
 * among the reply's assistant items. A stream that ends before its message
 * does was dropped. */
let read = async (req: Request, response: Response): Promise<Message> => {
  if (!response.body) throw ended()
  let message: Message | undefined
  // Text runs on until a tool call, as the reply's items say it.
  let ordinal = new Map<number, number>()
  let said = -1
  let prose = false
  for await (let e of events(response.body)) {
    if (e.type == 'message_start') {
      message = { ...e.message!, content: [...e.message!.content] }
      await acknowledged(req, { anthropic: { response_id: message.id } })
      continue
    }
    if (!message) continue
    if (e.type == 'message_stop') return message
    message = built(message, e)
    if (e.type == 'content_block_start') {
      began(req)
      let type = e.content_block?.type
      if (type == 'text') {
        if (!prose) said++
        ordinal.set(e.index!, said)
        prose = true
      }
      if (type == 'tool_use') prose = false
    }
    let text = e.delta?.type == 'text_delta' ? e.delta.text : undefined
    if (text) req.onText?.({ index: ordinal.get(e.index!) ?? 0, text })
  }
  throw ended()
}

/** A model over the Messages API. Its `info` gives the context window the
 * API lists and the price @yaks/model's list has for the name. Nothing is
 * retried here: the caller retries, since a retry here could buy one request
 * twice. */
export let messages = (options: Options): Model => {
  let get = async <T>(path: string): Promise<T> =>
    (await send(options, await options.key(), path)).json()
  let known = new Map<string, Promise<Listed | undefined>>()
  let info = (name: string) => {
    let held = known.get(name) ??
      get<ModelInfo>(`/v1/models/${encodeURIComponent(name)}`).then(listed)
        .catch((e) => {
          known.delete(name)
          if (e instanceof ModelError && e.code == 'model') return undefined
          throw e
        })
    known.set(name, held)
    return held
  }
  let list = async () => {
    let out: Listed[] = []
    let after: string | null | undefined
    do {
      let page = await get<Page<ModelInfo>>(
        `/v1/models${after ? `?after_id=${encodeURIComponent(after)}` : ''}`,
      )
      out.push(...page.data.map(listed))
      after = page.has_more ? page.last_id : undefined
    } while (after)
    return out
  }

  let model: Model = async (req) => {
    if (req.questions) {
      throw new ModelError('questions', 'Claude answers no typed questions')
    }
    if (req.modalities?.some((m) => m != 'text')) {
      throw new ModelError('modalities', 'Claude writes text only')
    }
    let key = await options.key()
    let effort = req.effort && EFFORTS.includes(req.effort)
      ? req.effort
      : undefined
    let offered = [
      ...tools(req.tools),
      ...options.web ? web(req.model) : [],
    ]
    let body = {
      model: req.model,
      max_tokens: req.tokens ?? TOKENS,
      cache_control: { type: 'ephemeral', ...hour(req) ? { ttl: '1h' } : {} },
      system: system(req),
      messages: conversation(req),
      ...offered.length ? { tools: offered } : {},
      ...effort ? { output_config: { effort } } : {},
      stream: true,
    }
    let started = Date.now()
    await submitted(req)
    let message = await send(options, key, '/v1/messages', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: req.signal,
    }).then((r) => read(req, r)).catch((e) => {
      // A stop the caller asked for is thrown on as it came.
      req.signal?.throwIfAborted()
      throw e
    })
    if (message.stop_reason == 'refusal') {
      throw new ModelError(
        'refusal',
        message.stop_details?.explanation ?? 'Claude declined this request',
      )
    }
    // Only a reply stopped at its output limit leaves a call's input unended.
    let cut = message.stop_reason == 'max_tokens'
    if (!cut && message.content.some((b) => b.json != null)) {
      throw new ModelError('malformed_stream', 'a tool call input is not JSON')
    }
    return {
      id: message.id,
      model: message.model,
      items: items(message.content),
      ...cut ? { cut } : {},
      usage: usage(message.usage),
      cacheExpiresAt: new Date(started + (hour(req) ? 3600 : 300) * 1000)
        .toISOString(),
    }
  }
  return Object.assign(model, {
    reads: READS,
    info,
    list,
    vocab: anthropicDoc,
    mark,
    anchor: () => undefined,
    ...options.web ? { hosted: HOSTED } : {},
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
