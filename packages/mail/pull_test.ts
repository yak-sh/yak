import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertThrows } from '@std/assert'
import { type Bundle, type Comp, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type Vocab, type VocabDoc } from '@yaks/vocab'
import { docDoc, docs } from '@yaks/doc'
import { hookDoc, hookEid } from '@yaks/hook'
import { edgeDoc, edgeEid, edgeKeywords } from '@yaks/edge'
import { mailDoc } from './comp.ts'
import { mailbox } from './plugin.ts'
import {
  type Down,
  type Edge,
  edge,
  type EdgeMessage,
  type EdgeRequest,
  LATE,
  messageIdOf,
  pull,
  received,
  Unavailable,
} from './pull.ts'
import { service } from './service.ts'

let domain = 'books.example'
let ana = 'p-ana'

let extra: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    person: {
      component: true,
      type: 'object',
      kind: true,
      properties: { name: { type: 'string' } },
    },
    about: { component: true, type: 'object', edge: 'about', properties: {} },
  },
}

// The club vocabulary, with or without the hook vocabulary: one for each.
let vocabs = new Map<boolean, Vocab>()
let clubVocab = (hooks: boolean) => {
  let got = vocabs.get(hooks) ?? loadVocab(
    [docDoc, mailDoc, edgeDoc, extra, ...(hooks ? [hookDoc] : [])],
    [edgeKeywords],
  )
  vocabs.set(hooks, got)
  return got
}

// A graph that knows Ana, with or without the hook vocabulary.
let club = async (hooks = true) => {
  let vocab = clubVocab(hooks)
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [docs(), mailbox({ domain })],
  })
  await g.apply([{
    entity: { eid: ana },
    person: { name: 'Ana' },
    email: { address: `ana@${domain}` },
  }])
  return g
}

// An edge over fixtures. `forget` makes it hand back what was acknowledged,
// the way it would after a crash between recording and acknowledging.
let stub = (
  messages: EdgeMessage[],
  requests: EdgeRequest[] | null = [],
  { forget = false, broken = false } = {},
) => {
  let acked: string[] = []
  let fresh = <T extends { id: string }>(xs: T[]) =>
    forget ? xs : xs.filter((x) => !acked.includes(x.id))
  let at: Edge = {
    messages: () =>
      broken
        ? Promise.reject(new Error('down'))
        : Promise.resolve(fresh(messages)),
    notified: (ids) => (acked.push(...ids), Promise.resolve()),
    requests: () => Promise.resolve(requests && fresh(requests)),
    processed: (ids) => (acked.push(...ids), Promise.resolve()),
  }
  return { at, acked }
}

let letter = (n: number, to = `ana@${domain}`): EdgeMessage => ({
  id: `msg:178986153020${n}:<m${n}@far.example>`,
  from: 'bounces@relay.example',
  from_header: 'Bo <bo@far.example>',
  to,
  subject: `hello ${n}`,
  text: 'soup?',
  verified: true,
  received_at: '2026-09-23T12:00:00.000Z',
})

let hit = (n: number): EdgeRequest => ({
  id: `r${n}`,
  source: 'posthog',
  method: 'POST',
  path: '/hook/ana/posthog',
  body: '{"type":"issue"}',
  sig_ok: 1,
})

let mails = async (g: Awaited<ReturnType<typeof club>>) =>
  (await g.read('.mail')).map((b: Bundle) => b.mail as Comp)

test('messageIdOf: the Message-ID inside the edge key', () => {
  assertEquals(messageIdOf('msg:1789:<a1@x.example>'), 'a1@x.example')
  assertEquals(messageIdOf('a1@x.example'), 'a1@x.example')
})

test('received: the edge fields become the headers arrive reads', () => {
  let [m, arrival] = received({
    ...letter(1),
    in_reply_to: '<a0@x.example>',
    reply_to: 'Ana <ana@far.example>',
  })
  assertEquals(
    ['from', 'subject', 'message-id', 'in-reply-to', 'reply-to'].map(
      m.headers.get,
    ),
    [
      'Bo <bo@far.example>',
      'hello 1',
      'm1@far.example',
      '<a0@x.example>',
      'Ana <ana@far.example>',
    ],
  )
  assertEquals(arrival, {
    at: '2026-09-23T12:00:00.000Z',
    text: 'soup?',
    verified: true,
  })
})

test('pull: letters are recorded, routed and acknowledged', async () => {
  let g = await club()
  let { at, acked } = stub([letter(1), letter(2, 'nobody@far.example')])
  assertEquals(await pull({ graph: g, domain }, at), {
    messages: 2,
    requests: 0,
  })
  assertEquals(acked, [letter(1).id, letter(2).id])
  let [one, two] = await mails(g)
  assertEquals(
    [one.message_id, one.from, one.target, one.verified],
    ['m1@far.example', 'bo@far.example', ana, true],
  )
  assertEquals(two.target, undefined)
})

test('pull: a letter handed back after a crash is recorded once', async () => {
  let g = await club()
  let { at, acked } = stub([letter(1)], [hit(1)], { forget: true })
  await pull({ graph: g, domain }, at)
  await pull({ graph: g, domain }, at)
  assertEquals((await mails(g)).length, 1)
  assertEquals((await g.read('.hook')).length, 1)
  assertEquals(acked, [letter(1).id, 'r1', letter(1).id, 'r1'])
})

test('pull: a request becomes a hook about the mailbox it names', async () => {
  let g = await club()
  let { at } = stub([], [hit(1)])
  assertEquals(await pull({ graph: g, domain }, at), {
    messages: 0,
    requests: 1,
  })
  let eid = hookEid({ id: 'r1', source: 'posthog' })
  let [hook] = await g.read(`.hook`)
  assertEquals(hook.entity.eid, eid)
  assertEquals(
    [(hook.hook as Comp).event, (hook.hook as Comp).verified],
    ['issue', true],
  )
  assertEquals((await g.read('.about')).map((b) => b.entity.eid), [
    edgeEid(eid, 'about', ana),
  ])
})

test('pull: each tray fails alone, and a graph without hook leaves requests', async () => {
  let g = await club()
  let { at } = stub([letter(1)], [hit(1)], { broken: true })
  assertEquals(await pull({ graph: g, domain }, at), {
    messages: 0,
    requests: 1,
  })
  let bare = await club(false)
  let other = stub([letter(1)], [hit(1)])
  assertEquals(await pull({ graph: bare, domain }, other.at), {
    messages: 1,
    requests: 0,
  })
  assertEquals(other.acked, [letter(1).id])
})

let emptyRecovery = await club()
test('pull: an unavailable empty edge retries without reporting a delayed letter', async () => {
  let up = stub([])
  let out: Edge = {
    ...up.at,
    messages: () => Promise.reject(new Unavailable('timeout')),
    requests: () => Promise.reject(new Unavailable('timeout')),
  }
  let told: unknown[] = []
  let logged: unknown[] = []
  let down: Down = new Map()
  let at = (t: number, from: Edge, keep = true) =>
    pull({
      graph: emptyRecovery,
      domain,
      now: () => t,
      report: (e) => told.push(e),
      log: (e) => logged.push(e),
      ...(keep ? { down } : {}),
    }, from)
  await at(0, out)
  await at(LATE, out)
  await at(LATE + 1, out)
  assertEquals([told.length, logged.length, down.size], [0, 2, 2])
  await at(LATE + 2, up.at)
  assertEquals([told.length, logged.length, down.size], [0, 4, 0])
  await at(LATE + 3, out, false)
  assertEquals(told.length, 2)
})

let delayedRecovery = await club()
test('pull: a delayed letter reports its outage cause once across an ack retry', async () => {
  let now = Date.parse(letter(1).received_at!)
  let down: Down = new Map()
  let told: { error: Error; tags: Record<string, string> | undefined }[] = []
  let cause = new Unavailable('edge down', {
    cause: new DOMException('timeout', 'TimeoutError'),
  })
  let at = {
    graph: delayedRecovery,
    domain,
    now: () => now,
    down,
    log: () => {},
    report: (error: unknown, context?: { tags?: Record<string, string> }) =>
      told.push({ error: error as Error, tags: context?.tags }),
  }
  let up = stub([letter(1)])
  await pull(at, { ...up.at, messages: () => Promise.reject(cause) })
  now += LATE + 1
  let first = await pull(at, {
    ...up.at,
    notified: () => Promise.reject(new Unavailable('ack down')),
  })
  await pull(at, up.at)
  assertEquals([
    first.messages,
    (await mails(delayedRecovery)).length,
    up.acked,
  ], [
    0,
    1,
    [letter(1).id],
  ])
  assertEquals(told.length, 1)
  assertEquals(told[0].error.cause, cause)
  assertEquals(told[0].tags?.letter, messageIdOf(letter(1).id))
  assertEquals(down.size, 0)
})

let unexpectedRecovery = await club()
test('pull: an unexpected listing failure reports immediately even when retrying', async () => {
  let error = new SyntaxError('invalid edge response')
  let told: Error[] = []
  await pull({
    graph: unexpectedRecovery,
    down: new Map(),
    report: (e) => told.push(e as Error),
  }, {
    ...stub([]).at,
    messages: () => Promise.reject(error),
  })
  assertEquals(told.length, 1)
  assertEquals(told[0].cause, error)
})

let recording = await (async () => {
  let g = await club()
  let up = stub([letter(1), letter(2)])
  let failed = false
  let apply: Graph['apply'] = (bundles, options) => {
    if (!failed) {
      failed = true
      throw new Error('store unavailable')
    }
    return g.apply(bundles, options)
  }
  let told: unknown[] = []
  let at = {
    graph: { ...g, apply },
    domain,
    now: () => Date.parse(letter(1).received_at!),
    report: (e: unknown) => told.push(e),
  }
  await pull(at, up.at)
  return { g, up, told, at }
})()
test('pull: a failed record stays unacknowledged while other letters arrive', () => {
  assertEquals(recording.up.acked, [letter(2).id])
  assertEquals(recording.told.length, 1)
})
test('pull: the next pass records and acknowledges a letter whose write failed', async () => {
  await pull(recording.at, recording.up.at)
  assertEquals((await mails(recording.g)).length, 2)
  assertEquals(recording.up.acked, [letter(2).id, letter(1).id])
})

test('edge: the HTTP API, a missing tray, and acknowledgements in bites', async () => {
  let asked: string[] = []
  let at = edge({ url: 'https://inbox.example/', token: 't' }, (url, init) => {
    asked.push(`${init.method} ${url} ${init.body ?? ''}`.trim())
    return Promise.resolve(
      url.includes('/requests?')
        ? new Response('nope', { status: 404 })
        : new Response(url.includes('/messages?') ? '[]' : ''),
    )
  })
  assertEquals(await at.messages(), [])
  assertEquals(await at.requests(), null)
  assertEquals(asked[0].endsWith('&sort=ts'), true)
  await at.notified(Array.from({ length: 51 }, (_, i) => `m${i}`))
  assertEquals(asked.map((a) => a.slice(0, 50)), [
    'GET https://inbox.example/messages?unnotified=1&.d',
    'GET https://inbox.example/requests?unprocessed=1&l',
    'POST https://inbox.example/messages/notified {"ids',
    'POST https://inbox.example/messages/notified {"ids',
  ])
})

let waiting = (_url: string, init: RequestInit): Promise<Response> =>
  new Promise((_resolve, reject) => {
    let signal = init.signal!
    let stop = () => reject(signal.reason)
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
  })

let streaming = (_url: string, init: RequestInit): Promise<Response> =>
  Promise.resolve(
    new Response(
      new ReadableStream({
        start: (body) => {
          let signal = init.signal!
          let stop = () => body.error(signal.reason)
          signal.addEventListener('abort', stop, { once: true })
          if (signal.aborted) stop()
        },
      }),
    ),
  )

test('edge: a response that never finishes times out', async () => {
  let at = edge(
    { url: 'https://inbox.example', token: 't' },
    streaming,
    undefined,
    1,
  )
  let error = await assertRejects(
    () => at.messages(),
    Unavailable,
    'response interrupted',
  )
  assertEquals((error.cause as DOMException).name, 'TimeoutError')
})

for (
  let [status, kind] of [
    [408, Unavailable],
    [429, Unavailable],
    [503, Unavailable],
    [401, Error],
    [404, Error],
  ] as const
) {
  test(`edge: HTTP ${status} keeps its failure kind`, async () => {
    let at = edge(
      { url: 'https://inbox.example', token: 't' },
      () => Promise.resolve(new Response('refused', { status })),
    )
    let error = await assertRejects(() => at.messages(), kind)
    assertEquals(error instanceof Unavailable, kind == Unavailable)
  })
}

test('edge: a missing acknowledgement endpoint is a failure', async () => {
  let at = edge(
    { url: 'https://inbox.example', token: 't' },
    () => Promise.resolve(new Response('', { status: 404 })),
  )
  await assertRejects(() => at.notified(['m1']), Error, '404')
})

test('edge: invalid URL and header configuration remain unexpected failures', async () => {
  assertThrows(() => edge({ url: 'invalid', token: 't' }), TypeError)
  let at = edge({ url: 'https://inbox.example', token: 'invalid\ntoken' })
  let error = await assertRejects(() => at.messages(), TypeError)
  assertEquals(error instanceof Unavailable, false)
})

for (let body of ['', 'null', '{}', '[{}]']) {
  test(`edge: a malformed listing ${JSON.stringify(body)} is a failure`, async () => {
    let at = edge(
      { url: 'https://inbox.example', token: 't' },
      () => Promise.resolve(new Response(body)),
    )
    await assertRejects(() => at.messages(), Error, 'expected items with ids')
    await assertRejects(() => at.requests(), Error, 'expected items with ids')
  })
}

test('edge: stopping its service ends an in-flight request quietly', async () => {
  let stop = new AbortController()
  let at = edge(
    { url: 'https://inbox.example', token: 't' },
    waiting,
    stop.signal,
    1000,
  )
  let messages = at.messages()
  stop.abort()
  assertEquals(await messages, [])
})

let pulled = (stop?: AbortController) => {
  let messages = 0
  let go = (url: string): Promise<Response> => {
    if (url.includes('/messages?')) {
      messages++
      return Promise.resolve(
        new Response(JSON.stringify([letter(1)]), {
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    if (url.endsWith('/messages/notified')) stop?.abort()
    return Promise.resolve(
      new Response('', { status: url.includes('/requests?') ? 404 : 200 }),
    )
  }
  return { go, messages: () => messages }
}

let ended = await club()
test('service: an already-ended signal is one complete pull', async () => {
  // Each tray asked once, the last of them before the service answers.
  let asked: string[] = []
  let go = (url: string) => {
    asked.push(new URL(url).pathname)
    return Promise.resolve(new Response('[]'))
  }
  await service(
    { graph: ended },
    { domain, pull: { url: 'https://inbox.example', token: 't' } },
    AbortSignal.abort(),
    (pull, stop) => edge(pull, go, stop),
  )
  assertEquals(asked, ['/messages', '/requests'])
})

test('service: a timed-out pull is tried again', async () => {
  let g = await club()
  let stop = new AbortController()
  let at = pulled(stop)
  let calls = 0
  let go = (url: string) => {
    if (url.includes('/messages?') && calls++ == 0) {
      return Promise.reject(new DOMException('timeout', 'TimeoutError'))
    }
    return at.go(url)
  }
  let options = {
    domain,
    pull: { url: 'https://inbox.example', token: 't', every: 0 },
  }
  let told: unknown[] = []
  await service(
    { graph: g, report: (e) => told.push(e), log: () => {} },
    options,
    stop.signal,
    (pull, signal) => edge(pull, go, signal, 1),
  )
  assertEquals(calls, 2)
  assertEquals((await mails(g)).length, 1)
  assertEquals(told.filter((e) => String(e).includes('could not take')), [])
})

test('service: stopping ends an in-flight pull', async () => {
  let stop = new AbortController()
  let began = Promise.withResolvers<void>()
  let go = (url: string, init: RequestInit) => {
    began.resolve()
    return waiting(url, init)
  }
  let options = {
    domain,
    pull: { url: 'https://inbox.example', token: 't' },
  }
  let running = service(
    { graph: await club() },
    options,
    stop.signal,
    (pull, signal) => edge(pull, go, signal, 1000),
  )
  await began.promise
  stop.abort()
  await running
})

test('service: a config naming no pull has nothing to take', async () => {
  assertEquals(await service({ graph: await club() }, { domain }), undefined)
})

test('service: a live signal with no pull holds the duty until shutdown', async () => {
  let stop = new AbortController()
  let ended = false
  let running = service({ graph: await club() }, { domain }, stop.signal)
    .then(() => ended = true)
  await Promise.resolve()
  assertEquals(ended, false)
  stop.abort()
  await running
  assertEquals(ended, true)
})

test('pull: a letter that waited at the edge is reported, taking it anyway', async () => {
  let g = await club()
  let { at, acked } = stub([letter(1)])
  let told: unknown[] = []
  let now = () => Date.parse(letter(1).received_at!) + LATE + 1
  await pull({ graph: g, domain, now, report: (e) => told.push(e) }, at)
  assertEquals(acked, [letter(1).id])
  assertEquals(told.length, 1)
  await pull({
    graph: g,
    domain,
    now: () => letter(1).ts ?? 0,
    report: (e) => told.push(e),
  }, at)
  assertEquals(told.length, 1)
})
