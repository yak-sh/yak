/// <reference lib="deno.ns" />
// A resending door answers a reset by taking a fresh stub and sending again,
// only while that is safe; anything else it throws through untouched.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { doorOf, IDEMPOTENCY, resending, stubOf } from './door.ts'
import { backoff } from './resets.ts'
import { type Answer, namespace } from './testing.ts'

// Every door here records the pauses between a call's sends and the failures
// it reports, never sleeps.
let door = (answers: Answer[]) => {
  let ns = namespace(answers)
  let paused: number[] = []
  let reported: string[] = []
  let store = resending(doorOf((req) => stubOf(ns, 'jeff').fetch(req)), {
    report: (e, path) => reported.push(`${path} ${(e as Error).message}`),
    wait: (ms) => Promise.resolve(void paused.push(ms)),
  })
  let bodies = () => ns.sent.map((s) => s.body)
  return { store, ns, paused, reported, bodies }
}

let gone = () =>
  new Error(
    'Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.',
  )
let flagged = () => Object.assign(new Error('reset'), { retryable: true })
let dropped = () => new Error('Network connection lost.')
let storageTimeout = () =>
  new Error(
    'Durable Object storage operation exceeded timeout which caused object to be reset.',
  )
let said = (message: string) =>
  Response.json({ error: 'Error', message }, { status: 500 })
let post = { method: 'POST', body: '[1]' }

// A body that sends some bytes, then fails in `error`.
let broken = (error: Error) => {
  let sent = false
  return new Response(
    new ReadableStream({
      pull(c) {
        if (sent) c.error(error)
        else {
          sent = true
          c.enqueue(new TextEncoder().encode('{"partial":'))
        }
      },
    }),
  )
}
// A 200 a restart cuts off.
let cut = () =>
  broken(Error('Durable Object reset because a newer deploy reached it: b'))

test('a reset POST, thrown or answered, is sent again with its body intact', async () => {
  for (let reset of [gone(), storageTimeout(), dropped()]) {
    for (let answer of [reset, said(reset.message)]) {
      let d = door([answer, 'ok'])
      assertEquals(await (await d.store('/apply', post)).text(), 'ok')
      assertEquals(d.bodies(), ['[1]', '[1]'])
    }
  }
})

test('a GET is sent again once per pause at most; other errors throw', async () => {
  let d = door([flagged(), gone(), 'ok'])
  assertEquals(await (await d.store('/query')).text(), 'ok')
  assertEquals([d.ns.sent.length, d.paused], [3, backoff.pauses.slice(0, 2)])
  let sends = backoff.pauses.length + 1
  let evicting = door([...Array.from({ length: sends }, gone), 'retried'])
  await assertRejects(() => evicting.store('/query'))
  assertEquals(evicting.ns.sent.length, sends)
  let other = door([new Error('boot failed')])
  await assertRejects(() => other.store('/query'), Error, 'boot')
  assertEquals(other.ns.sent.length, 1)
})

test('another 500 is the answer, not a reset', async () => {
  let d = door([said('boot failed'), 'retried'])
  let no = await d.store('/query')
  assertEquals([no.status, (await no.json()).message], [500, 'boot failed'])
  assertEquals(d.ns.sent.length, 1)
})

test('a streamed init or a Request with a body is not sent again', async () => {
  for (let request of [false, true]) {
    let init = { method: 'POST', body: new Blob(['body']).stream() }
    let d = door([flagged(), 'retried'])
    await assertRejects(() =>
      d.store('/apply', request ? new Request('http://x/apply', init) : init)
    )
    assertEquals(d.bodies(), ['body'])
  }
})

test('a read whose body fails opaquely is sent again; a write is not', async () => {
  let opaque = () => broken(new Error('internal error; reference = abc123'))
  let read = door([opaque(), Response.json(['kept'])])
  assertEquals(await read.store.consume('/query', (r) => r.json()), ['kept'])
  assertEquals(read.paused, backoff.pauses.slice(0, 1))
  let write = door([opaque(), 'retried'])
  await assertRejects(() =>
    write.store.consume('/apply', (r) => r.json(), post)
  )
  assertEquals(write.ns.sent.length, 1)
})

test('a write is sent again under one key, kept when the caller names it', async () => {
  let keys = (d: ReturnType<typeof door>) =>
    d.ns.sent.map((s) => s.headers.get(IDEMPOTENCY))
  let d = door([broken(flagged()), Response.json({ saved: true })])
  assertEquals(await d.store.consume('/apply', (r) => r.json(), post), {
    saved: true,
  })
  assertEquals([d.bodies(), new Set(keys(d)).size], [['[1]', '[1]'], 1])
  let named = door([flagged(), 'ok'])
  await named.store('/apply', post, { [IDEMPOTENCY]: 'mine' })
  assertEquals(keys(named), ['mine', 'mine'])
})

test('a refusal for memory or a kill is reported, and memory is never asked again', async () => {
  let d = door([said('out of memory: SQLITE_NOMEM'), 'retried'])
  await assertRejects(() => d.store.consume('/query?q=.doc', (r) => r.json()))
  let killed = door([
    new Error('Durable Object exceeded its CPU time limit and was reset.'),
  ])
  await assertRejects(() => killed.store('/apply', post))
  assertEquals([d.ns.sent.length, d.reported, killed.reported], [
    1,
    ['/query?q=.doc out of memory: SQLITE_NOMEM'],
    ['/apply Durable Object exceeded its CPU time limit and was reset.'],
  ])
})

test('an answer a restart cuts off is sent again, read or handed on', async () => {
  for (let init of [{}, post]) {
    let d = door([
      cut(),
      new Response('kept', { status: 201, headers: { 'x-said': 'yes' } }),
    ])
    let r = await d.store('/query', init)
    assertEquals(
      [r.status, r.headers.get('x-said'), await r.text(), d.ns.sent.length],
      [201, 'yes', 'kept', 2],
    )
  }
  let empty = door([new Response(null, { status: 204 })])
  assertEquals((await empty.store('/storage')).status, 204)
})

test('a stream, or a call that cannot be sent again, is handed on as it comes', async () => {
  let pour = () =>
    new Response(cut().body, {
      headers: { 'content-type': 'application/x-ndjson' },
    })
  for (
    let [answer, init, options] of [
      [pour(), { method: 'POST', body: new Blob(['[]']).stream() }, {}],
      [cut(), {}, { replayable: false }],
      [pour(), {}, {}],
    ] as [Response, RequestInit, { replayable?: boolean }][]
  ) {
    let d = door([answer])
    let r = await d.store('/query', init, {}, options)
    await assertRejects(() => r.text(), Error, 'newer deploy')
    assertEquals(d.ns.sent.length, 1)
  }
})
