/** Stable tool declarations and append-only provider cache boundaries. */
import type { Item, Request, Tool } from '@yaks/model'
import { input, type ResponseRequest } from '@yaks/openai'

type Part = {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
  cache_control?: { type: 'ephemeral' }
}
type Message = {
  role: string
  content?: Part[]
  tool_call_id?: string
  tool_calls?: {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }[]
}

let compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
let ordered = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(ordered)
    : value != null && typeof value == 'object'
    ? Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => compare(a, b))
        .map(([key, v]) => [key, ordered(v)]),
    )
    : value

/** Object insertion order and tool discovery order are not prompt changes. */
export let tools = (list: Tool[]): Tool[] =>
  [...list].sort((a, b) => compare(a.name, b.name)).map((t) => ({
    name: t.name,
    description: t.description,
    parameters: Object.fromEntries(
      Object.entries(t.parameters).sort(([a], [b]) => compare(a, b))
        .map(([key, value]) => [key, ordered(value)]),
    ),
  }))

// Alibaba's snapshot endpoints are not on its documented explicit-cache list.
let alibaba = new Set([
  'deepseek/deepseek-v3.2',
  'qwen/qwen3-max',
  'qwen/qwen-plus',
  'qwen/qwen3.6-plus',
  'qwen/qwen3-coder-plus',
  'qwen/qwen3-coder-flash',
])
export let alibabaCache = (model: string) => alibaba.has(model.split(':')[0])
export let explicit = (model: string) =>
  model.startsWith('anthropic/') || alibabaCache(model)

let encoded = (bytes: Uint8Array) => {
  let chunks: string[] = []
  for (let at = 0; at < bytes.length; at += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(at, at + 8192)))
  }
  return btoa(chunks.join(''))
}
let text = (value: string): Part[] => [{ type: 'text', text: value }]
let message = (item: Item): Message =>
  item.kind == 'call'
    ? {
      role: 'assistant',
      tool_calls: [{
        id: item.id,
        type: 'function',
        function: { name: item.name, arguments: item.args },
      }],
    }
    : item.kind == 'result'
    ? { role: 'tool', tool_call_id: item.id, content: text(item.output) }
    : item.kind == 'image'
    ? {
      role: 'user',
      content: [
        ...text(item.label),
        {
          type: 'image_url',
          image_url: {
            url: 'data:' + item.mediaType + ';base64,' + encoded(item.bytes),
          },
        },
      ],
    }
    : {
      role: item.kind == 'instruction' ? 'developer' : item.kind,
      content: text(item.text),
    }
let mark = (msg: Message) => {
  let part = msg.content?.at(-1)
  if (part) part.cache_control = { type: 'ephemeral' }
}

/** Request-ending input runs are followed by model output in the transcript.
 * Keep prior ends explicitly: the newest end's 20-block lookback need not
 * reach them. Three rolling ends and the stable instructions fit four slots. */
let boundaries = (items: Item[]) => {
  let first = items.findIndex((i) => i.kind != 'instruction')
  let stable = (first < 0 ? items.length : first) - 1
  let ends = items.flatMap((i, at) =>
    (i.kind == 'user' || i.kind == 'image' || i.kind == 'result') &&
      (!items[at + 1] || items[at + 1].kind == 'assistant' ||
        items[at + 1].kind == 'call' || items[at + 1].kind == 'instruction')
      ? [at]
      : []
  )
  let tail = items.length - 1
  if (tail > stable && !ends.includes(tail)) ends.push(tail)
  return [...stable >= 0 ? [stable] : [], ...ends.slice(-3)]
}
let transcript = (req: Request): Item[] => [
  ...req.instructions
    ? [{ kind: 'instruction' as const, text: req.instructions }]
    : [],
  ...req.items,
]

/** Never regroup earlier messages when later tool results arrive. */
export let messages = (req: Request): Message[] => {
  let items = transcript(req)
  let out = items.map(message)
  if (explicit(req.model)) { for (let at of boundaries(items)) mark(out[at]) }
  return out
}

let record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value == 'object' && !Array.isArray(value)

/** Responses exposes prompt_cache_breakpoint, not per-block cache_control.
 * OpenRouter translates it to Anthropic's default five-minute breakpoint.
 * Text tool outputs use the supported content-array shape from the start. */
export let responseBody = (req: Request, body: ResponseRequest) => {
  let items = transcript(req)
  let cache = explicit(req.model)
  let marked = cache ? new Set(boundaries(items)) : new Set()
  let projected = input(items).map((raw, at) => {
    if (!record(raw) || !cache) return raw
    let item = items[at]
    let content = item.kind == 'result'
      ? [{ type: 'input_text', text: item.output }]
      : item.kind == 'assistant'
      ? [{ type: 'input_text', text: item.text }]
      : raw.content
    if (!Array.isArray(content)) return raw
    let blocks = item.kind == 'image' ? [...content].reverse() : content
    let last = blocks.findLastIndex((p) => record(p) && p.type == 'input_text')
    let parts = blocks.map((p, index) =>
      marked.has(at) && index == last && record(p)
        ? { ...p, prompt_cache_breakpoint: { mode: 'explicit' } }
        : p
    )
    return item.kind == 'result'
      ? { ...raw, output: parts }
      : { ...raw, content: parts }
  })
  let { instructions: _instructions, ...rest } = body
  return {
    ...rest,
    input: projected,
    ...req.conversation ? { session_id: req.conversation } : {},
  }
}

/** Chat tool declarations use the same deterministic ordering as Responses. */
export let chatTools = (req: Request) =>
  tools(req.tools).map((t) => ({ type: 'function', function: t }))
