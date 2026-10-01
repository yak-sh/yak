/** Requests capture wire prefixes; replies exercise the adapter's public door. */
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import type { Item, Request } from '@yaks/model'
import { responses } from './mod.ts'

let stream = (events: unknown[]) =>
  new Response(
    events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') +
      'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  )
let done = () =>
  stream([{
    type: 'response.completed',
    response: {
      id: 'r1',
      model: 'anthropic/claude-sonnet-4',
      status: 'completed',
    },
  }])
let declared = (reverse = false) => {
  let list = [
    {
      name: 'alpha',
      description: 'Find',
      parameters: reverse
        ? {
          required: ['q'],
          properties: { q: { type: 'string' } },
          type: 'object',
        }
        : {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q'],
        },
    },
    { name: 'zeta', description: 'Read', parameters: { type: 'object' } },
  ]
  return reverse ? list.reverse() : list
}
type Part = {
  type: string
  text?: string
  image_url?: string
  prompt_cache_breakpoint?: unknown
  cache_control?: unknown
}
type Input = {
  role?: string
  type?: string
  content?: Part[]
  output?: string | Part[]
}
let blocks = (items: Input[]) =>
  items.flatMap((i) => i.content ?? (Array.isArray(i.output) ? i.output : []))
let strip = (items: Input[]) =>
  JSON.parse(
    JSON.stringify(items, (key, value) =>
      key == 'prompt_cache_breakpoint' || key == 'cache_control'
        ? undefined
        : value),
  )

test('Anthropic Responses retains prior cache boundary beyond 20 new blocks', async () => {
  let seen: {
    input: Input[]
    tools: unknown
    instructions?: string
    session_id?: string
  }[] = []
  let model = responses({
    key: () => 'fake',
    fetch: (url, init) => {
      assertEquals(url, 'https://openrouter.ai/api/v1/responses')
      seen.push(JSON.parse(String(init?.body)))
      return Promise.resolve(done())
    },
  })
  let items: Item[] = [
    { kind: 'instruction', text: 'Stable context' },
    { kind: 'user', text: 'First question' },
  ]
  let req: Request = {
    model: 'anthropic/claude-sonnet-4',
    instructions: 'Project instructions',
    conversation: 'conversation-1',
    items,
    tools: declared(),
  }
  await model(req)
  let old = seen[0].input
  assertEquals(old.slice(0, 2).map((i) => i.role), ['developer', 'developer'])
  assertEquals(old[0].content?.[0].text, req.instructions)
  assertEquals(seen[0].instructions, undefined)
  assertEquals(seen[0].session_id, 'conversation-1')
  assertEquals(blocks(old).filter((p) => p.prompt_cache_breakpoint).length, 2)
  assert(old[2].content?.[0].prompt_cache_breakpoint)
  let calls: Item[] = Array.from({ length: 25 }, (_, at) => ({
    kind: 'call',
    id: 'c' + at,
    name: 'alpha',
    args: '{}',
  }))
  let results: Item[] = Array.from({ length: 25 }, (_, at) => ({
    kind: 'result',
    id: 'c' + at,
    output: 'Result ' + at,
  }))
  let growth: Item[] = Array.from({ length: 25 }, (_, at) => ({
    kind: 'user',
    text: 'New block ' + at,
  }))
  await model({
    ...req,
    tools: declared(true),
    items: [
      ...items,
      { kind: 'assistant', text: 'Looking up' },
      ...calls,
      ...results,
      ...growth,
    ],
  })
  let next = seen[1].input
  assertEquals(seen[1].tools, seen[0].tools)
  assertEquals(strip(next.slice(0, old.length)), strip(old))
  assert(next[2].content?.[0].prompt_cache_breakpoint)
  assert(next.at(-1)?.content?.[0].prompt_cache_breakpoint)
  assertEquals(blocks(next).filter((p) => p.prompt_cache_breakpoint).length, 3)
  let previous = next.length
  await model({
    ...req,
    items: [
      ...items,
      { kind: 'assistant', text: 'Looking up' },
      ...calls,
      ...results,
      ...growth,
      { kind: 'assistant', text: 'Answer' },
      { kind: 'user', text: 'Continue' },
    ],
  })
  assertEquals(strip(seen[2].input.slice(0, previous)), strip(next))
  assertEquals(
    blocks(seen[2].input).filter((p) => p.prompt_cache_breakpoint).length,
    4,
  )
})

test('implicit-cache upstreams keep append-only input and deterministic tools without directives', async () => {
  for (
    let vendor of [
      'openai/gpt-4.1',
      'google/gemini-2.5-pro',
      'deepseek/deepseek-chat',
      'x-ai/grok-4',
      'moonshotai/kimi-k2',
      'z-ai/glm-4.5',
      'qwen/qwen3.5-plus-02-15',
    ]
  ) {
    let seen: { input: Input[]; tools: unknown; session_id?: string }[] = []
    let model = responses({
      key: () => 'fake',
      fetch: (_url, init) => {
        seen.push(JSON.parse(String(init?.body)))
        return Promise.resolve(done())
      },
    })
    let items: Item[] = [{ kind: 'user', text: 'Hello' }]
    await model({
      model: vendor,
      instructions: 'Stable',
      items,
      tools: declared(),
    })
    await model({
      model: vendor,
      instructions: 'Stable',
      conversation: 'same',
      items: [...items, { kind: 'assistant', text: 'Hello' }, {
        kind: 'user',
        text: 'Next',
      }],
      tools: declared(true),
    })
    assertEquals(seen[0].session_id, undefined)
    assertEquals(seen[1].session_id, 'same')
    assertEquals(seen[1].input.slice(0, seen[0].input.length), seen[0].input)
    assertEquals(seen[0].tools, seen[1].tools)
    assert(!JSON.stringify(seen).includes('prompt_cache_breakpoint'))
    assert(!JSON.stringify(seen).includes('cache_control'))
  }
})

test('Alibaba chat streams calls, text and reported usage with explicit caching and session affinity', async () => {
  let seen: { messages: Input[]; tools: unknown; session_id: string }[] = []
  let model = responses({
    key: () => 'fake',
    fetch: (url, init) => {
      assertEquals(url, 'https://openrouter.ai/api/v1/chat/completions')
      assertEquals(new Headers(init?.headers).get('x-session-id'), 'session-1')
      seen.push(JSON.parse(String(init?.body)))
      return Promise.resolve(stream([
        {
          id: 'c1',
          model: 'qwen/qwen3-max',
          choices: [{ delta: { content: 'Checking' } }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'tool-1',
                function: { name: 'alpha', arguments: '{"q":' },
              }],
            },
          }],
        },
        {
          choices: [{
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"x"}' } }],
            },
          }],
        },
        {
          usage: {
            prompt_tokens: 120,
            completion_tokens: 10,
            total_tokens: 130,
            prompt_tokens_details: {
              cached_tokens: 100,
              cache_write_tokens: 20,
            },
            cost: 0.001,
          },
        },
      ]))
    },
  })
  let deltas: string[] = []
  let req: Request = {
    model: 'qwen/qwen3-max',
    instructions: 'Stable',
    conversation: 'session-1',
    items: [{ kind: 'user', text: 'Find x' }],
    tools: declared(),
    onText: (d) => deltas.push(d.text),
  }
  let reply = await model(req)
  assertEquals(deltas, ['Checking'])
  assertEquals(reply.items, [
    { kind: 'assistant', text: 'Checking' },
    { kind: 'call', id: 'tool-1', name: 'alpha', args: '{"q":"x"}' },
  ])
  assertEquals(reply.usage, {
    input_tokens: 120,
    output_tokens: 10,
    total_tokens: 130,
    cached_tokens: 100,
  })
  assertEquals(reply.cost, 0.001)
  assertEquals(seen[0].session_id, 'session-1')
  assertEquals(
    blocks(seen[0].messages).filter((p) => p.cache_control).length,
    2,
  )
  await model({
    ...req,
    tools: declared(true),
    items: [...req.items, ...reply.items, {
      kind: 'result',
      id: 'tool-1',
      output: 'Found',
    }],
  })
  assertEquals(
    strip(seen[1].messages.slice(0, seen[0].messages.length)),
    strip(seen[0].messages),
  )
  assertEquals(seen[1].tools, seen[0].tools)
})

test('Anthropic vision caches after the image and preserves the whole image prefix', async () => {
  let seen: { input: Input[] }[] = []
  let model = responses({
    key: () => 'fake',
    fetch: (_url, init) => {
      seen.push(JSON.parse(String(init?.body)))
      return Promise.resolve(done())
    },
  })
  let item: Item = {
    kind: 'image',
    label: 'Screenshot',
    mediaType: 'image/png',
    bytes: new Uint8Array([1, 2, 3]),
  }
  let req: Request = {
    model: 'anthropic/claude-sonnet-4',
    items: [item],
    tools: [],
  }
  await model(req)
  let content = seen[0].input[0].content!
  assertEquals(content[0], {
    type: 'input_image',
    image_url: 'data:image/png;base64,AQID',
  })
  assertEquals(content[1], {
    type: 'input_text',
    text: 'Screenshot',
    prompt_cache_breakpoint: { mode: 'explicit' },
  })
  await model({
    ...req,
    items: [item, { kind: 'assistant', text: 'Seen' }, {
      kind: 'user',
      text: 'Next',
    }],
  })
  assertEquals(seen[1].input[0], seen[0].input[0])
})

test('Alibaba absent usage stays unknown and zero cache reads stay zero', async () => {
  let reported: unknown
  let model = responses({
    key: () => 'fake',
    fetch: () =>
      Promise.resolve(stream([
        { id: 'zero', choices: [{ delta: { content: 'Hello' } }] },
        ...reported ? [{ usage: reported }] : [],
      ])),
  })
  let req: Request = { model: 'qwen/qwen3-max', items: [], tools: [] }
  assertEquals((await model(req)).usage, undefined)
  reported = {
    prompt_tokens: 10,
    prompt_tokens_details: { cached_tokens: 0 },
  }
  assertEquals((await model(req)).usage, { input_tokens: 10, cached_tokens: 0 })
})
