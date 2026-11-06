import { equal, ok, test } from '@yaks/testing'
import { ModelError, type Request, type TextDelta } from '@yaks/model'
import { conversation, messages } from './mod.ts'

// The stream the API sends for one reply: text, then a tool call.
let reply = (id = 'msg_1') => [
  {
    type: 'message_start',
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [],
      stop_reason: null,
      usage: {
        input_tokens: 4,
        output_tokens: 1,
        cache_read_input_tokens: 90,
        cache_creation_input_tokens: 6,
      },
    },
  },
  {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Let me ' },
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'look.' },
  },
  { type: 'content_block_stop', index: 0 },
  {
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'tool_use', id: 'tu_1', name: 'find', input: {} },
  },
  {
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '{"q":"yak"}' },
  },
  { type: 'content_block_stop', index: 1 },
  {
    type: 'message_delta',
    delta: { stop_reason: 'tool_use' },
    usage: { output_tokens: 12 },
  },
  { type: 'message_stop' },
]

let sse = (events: unknown[]) =>
  new Response(
    events.map((e) =>
      `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`
    ).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  )

// A fake API: each request's URL, headers and body are kept, and answered by
// `answer`.
let api = (answer: (url: string) => Response) => {
  // deno-lint-ignore no-explicit-any
  let sent: { url: string; key: string | null; body: any }[] = []
  let fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let r = new Request(input, init)
    sent.push({
      url: r.url,
      key: r.headers.get('authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return Promise.resolve(answer(r.url))
  }
  return { sent, fetch: fetch as typeof globalThis.fetch }
}

let ask = (over: Partial<Request> = {}): Request => ({
  model: 'claude-sonnet-5-5',
  instructions: 'Be brief.',
  items: [
    { kind: 'instruction', text: 'You work for ada.' },
    { kind: 'user', text: 'Find the yak' },
    { kind: 'call', id: 'tu_0', name: 'find', args: '{"q":"cow"}' },
    { kind: 'call', id: 'tu_9', name: 'find', args: '{"q":"ox"}' },
    { kind: 'result', id: 'tu_0', output: 'none' },
    { kind: 'result', id: 'tu_9', output: 'none' },
    { kind: 'instruction', text: 'Hurry.' },
  ],
  tools: [
    { name: 'zap', description: 'Zap', parameters: { properties: {} } },
    { name: 'find', description: 'Find', parameters: { properties: {} } },
  ],
  ...over,
})

test('a prefix is kept five minutes, or the hour a request asks for', async () => {
  for (
    let [asked, ttl, seconds] of [[undefined, undefined, 300], [
      3600,
      '1h',
      3600,
    ]] as const
  ) {
    let { sent, fetch } = api(() => sse(reply()))
    let before = Date.now()
    let out = await messages({ key: () => 'k', fetch })(
      ask({ cacheRetention: asked }),
    )
    equal(sent[0].body.cache_control, {
      type: 'ephemeral',
      ...ttl ? { ttl } : {},
    })
    let kept = (Date.parse(out.cacheExpiresAt!) - before) / 1000
    ok(kept >= seconds && kept < seconds + 5)
  }
})

test('a request streams text, returns calls, and counts cache reads as input', async () => {
  let { sent, fetch } = api(() => sse(reply()))
  let deltas: TextDelta[] = []
  let order: string[] = []
  let model = messages({ key: () => 'k-1', fetch })
  let out = await model(ask({
    effort: 'low',
    tokens: 500,
    onSubmit: () => Promise.resolve(void order.push('submit')),
    onAck: (mark) => Promise.resolve(void order.push(JSON.stringify(mark))),
    onFirst: () => order.push('first'),
    onText: (d) => deltas.push(d),
  }))
  equal(order, ['submit', '{"anthropic":{"response_id":"msg_1"}}', 'first'])
  equal(deltas, [{ index: 0, text: 'Let me ' }, { index: 0, text: 'look.' }])
  equal(out.items, [
    { kind: 'assistant', text: 'Let me look.' },
    { kind: 'call', id: 'tu_1', name: 'find', args: '{"q":"yak"}' },
  ])
  equal(out.usage, {
    input_tokens: 100,
    output_tokens: 12,
    cached_tokens: 90,
    cache_write_tokens: 6,
  })
  let [{ url, key, body }] = sent
  equal([url, key], ['https://api.anthropic.com/v1/messages', 'Bearer k-1'])
  equal(body.system, 'Be brief.\n\nYou work for ada.')
  equal(body.cache_control, { type: 'ephemeral' })
  equal(body.output_config, { effort: 'low' })
  equal(body.max_tokens, 500)
  equal(body.tools.map((t: { name: string }) => t.name), ['find', 'zap'])
  equal(body.tools[0].input_schema, { type: 'object', properties: {} })
  equal(body.messages, [
    { role: 'user', content: [{ type: 'text', text: 'Find the yak' }] },
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu_0', name: 'find', input: { q: 'cow' } },
        { type: 'tool_use', id: 'tu_9', name: 'find', input: { q: 'ox' } },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu_0', content: 'none' },
        { type: 'tool_result', tool_use_id: 'tu_9', content: 'none' },
        { type: 'text', text: 'Hurry.' },
      ],
    },
  ])
})

test('failures are model errors by kind, and a stop is thrown as a stop', async () => {
  let refused = (status: number, message: string, headers = {}) => () =>
    new Response(
      JSON.stringify({ type: 'error', error: { type: 'x', message } }),
      { status, headers: { 'content-type': 'application/json', ...headers } },
    )
  let cases: [() => Response, string, number?][] = [
    [refused(429, 'slow down', { 'retry-after': '3' }), 'busy', 3000],
    [refused(529, 'overloaded'), 'busy'],
    [refused(401, 'bad key'), 'key'],
    [refused(404, 'no such model'), 'model'],
    [refused(400, 'Your credit balance is too low'), 'credit'],
    [refused(400, 'messages: bad'), 'request'],
  ]
  for (let [answer, code, after] of cases) {
    let e = await messages({ key: () => 'k', fetch: api(answer).fetch })(ask())
      .catch((e) => e)
    ok(e instanceof ModelError, code)
    equal([e.code, e.retry?.after], [code, after])
  }
  let stop = new AbortController()
  stop.abort()
  let e = await messages({
    key: () => 'k',
    fetch: api(() => sse(reply())).fetch,
  })(
    ask({ signal: stop.signal }),
  ).catch((e) => e)
  ok(!(e instanceof ModelError))
})

test('an error event, a stream cut short or a failed connection is busy', async () => {
  let overloaded = { type: 'error', error: { type: 'overloaded_error' } }
  let fetches = [
    api(() => sse(reply().toSpliced(3, 0, overloaded))).fetch,
    api(() => sse(reply().slice(0, 4))).fetch,
    () => Promise.reject(new TypeError('connection reset')),
  ]
  for (let fetch of fetches) {
    let e = await messages({ key: () => 'k', fetch })(ask()).catch((e) => e)
    equal([e.name, e.code], ['ModelError', 'busy'])
  }
})

test('list reads every page the API has', async () => {
  let page = (has_more: boolean, ...ids: string[]) =>
    Response.json({
      data: ids.map((id) => ({ id, display_name: id })),
      has_more,
      last_id: ids.at(-1),
    })
  let { sent, fetch } = api((url) =>
    url.includes('after_id=b') ? page(false, 'c') : page(true, 'a', 'b')
  )
  let listed = await messages({ key: () => 'k', fetch }).list!()
  equal([listed.map((m) => m.name), sent.length], [['a', 'b', 'c'], 2])
})

test('a refusal is a model error, not an empty reply', async () => {
  let events = reply().map((e) =>
    e.type == 'message_delta' ? { ...e, delta: { stop_reason: 'refusal' } } : e
  )
  let e = await messages({
    key: () => 'k',
    fetch: api(() => sse(events)).fetch,
  })(
    ask(),
  ).catch((e) => e)
  equal(e.code, 'refusal')
})

test('info gives the listed window and the list price; an unknown name is undefined', async () => {
  let { sent, fetch } = api((url) =>
    url.endsWith('/claude-sonnet-5-5')
      ? Response.json({
        id: 'claude-sonnet-5-5',
        type: 'model',
        display_name: 'Claude Sonnet 5.5',
        created_at: '2026-10-01T00:00:00Z',
        max_input_tokens: 1_000_000,
      })
      : new Response(JSON.stringify({ error: { message: 'missing' } }), {
        status: 404,
      })
  )
  let model = messages({ key: () => 'k', fetch })
  let info = await model.info!('claude-sonnet-5-5')
  equal(info?.context, 1_000_000)
  equal([info?.price?.input, info?.price?.output], [2, 10])
  await model.info!('claude-sonnet-5-5')
  equal(sent.length, 1)
  equal(await model.info!('claude-nothing'), undefined)
})

test('a questions or media request is refused before anything is sent', async () => {
  let { sent, fetch } = api(() => sse(reply()))
  let model = messages({ key: () => 'k', fetch })
  for (
    let over of [
      { questions: { ok: { type: 'noul', instructions: 'ok?' } } },
      { modalities: ['image'] },
    ] as Partial<Request>[]
  ) {
    equal((await model(ask(over)).catch((e) => e)).name, 'ModelError')
  }
  equal(sent.length, 0)
})

test('a turn’s tool results lead its message, an image shown beside one after them', () => {
  let call = (id: string) => ({
    kind: 'call' as const,
    id,
    name: 't',
    args: '{}',
  })
  let said = conversation(ask({
    items: [
      { kind: 'user', text: 'look' },
      call('a'),
      call('b'),
      { kind: 'result', id: 'a', output: 'shown' },
      {
        kind: 'image',
        bytes: new Uint8Array([1]),
        mediaType: 'image/png',
        label: 'Shown',
      },
      { kind: 'result', id: 'b', output: 'read' },
    ],
  }))
  equal(said[2].content.map((c) => c.type), [
    'tool_result',
    'tool_result',
    'text',
    'image',
  ])
})
