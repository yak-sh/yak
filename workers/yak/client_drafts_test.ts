// Drive the served module's public drafts door, including its HTTP receipt
// envelope and socket frames. The transport controls acceptance independently
// of optimistic/watch text: neither one is a durable receipt.
import { assert, assertEquals, assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import { parseHTML } from 'linkedom'
import { type Clock, clock, test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { kernel, seed, unique } from './probe.ts'

let k = await kernel()
let slug = unique('draftclient')
await seed(k, [{ slug, apps: ['notes'] }])
let dir = Deno.makeTempDirSync({ prefix: 'tasks-client-drafts-' })
let response = await k.at(`${slug}.yaks.app`, '/notes/api/client.js')
assertEquals(response.status, 200)
Deno.writeTextFileSync(`${dir}/client.js`, await response.text())
let publicClient = await import(`file://${dir}/client.js`)
Deno.removeSync(dir, { recursive: true })

type Call = {
  base: string
  key: string | null
  bundles: Bundle[]
  body: string
}
let json = (value: unknown, status = 200) =>
  new Response(JSON.stringify({ ok: true, aliases: {}, ...value as object }), {
    status,
  })
let deferred = <T>() => Promise.withResolvers<T>()

// Web Storage's synchronous API, shared by replacement loads of one page.
let storage = () => {
  let values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  }
}

let transport = (
  apply: (call: Call) => Response | Promise<Response>,
  me = () => Promise.resolve(json({ person: 'jo' })),
) => {
  let sockets = new Set<Socket>()
  class Socket {
    readyState = 1
    onmessage?: (event: { data: string }) => void
    subscriptions = new Set<string>()
    constructor(_url: unknown) {
      sockets.add(this)
    }
    send(data: string) {
      let frame = JSON.parse(data)
      if (frame.subscribe) {
        this.subscriptions.add(frame.id)
        queueMicrotask(() => this.hear([]))
      } else this.subscriptions.delete(frame.unsubscribe)
    }
    hear(bundles: Bundle[]) {
      for (let id of this.subscriptions) {
        this.onmessage?.({ data: JSON.stringify({ id, bundles }) })
      }
    }
    close() {
      sockets.delete(this)
    }
  }
  let fetcher = stub(globalThis, 'fetch', (input, init) => {
    let url = new URL(String(input))
    if (url.pathname.endsWith('/me')) return me()
    if (url.pathname.endsWith('/query')) return Promise.resolve(json([]))
    assert(url.pathname.endsWith('/apply'), url.href)
    let body = String(init?.body)
    return Promise.resolve(apply({
      base: new URL('.', url).href,
      key: new Headers(init?.headers).get('idempotency-key'),
      body,
      bundles: JSON.parse(body).entities,
    }))
  })
  let socket = stub(
    globalThis,
    'WebSocket',
    function (url: unknown) {
      return new Socket(url)
    },
  )
  return {
    hear: (bundles: Bundle[]) => {
      for (let s of sockets) s.hear(bundles)
    },
    [Symbol.dispose]: () => {
      socket.restore()
      fetcher.restore()
    },
  }
}
let row = (eid: string, text: string, rev: number): Bundle => ({
  entity: { eid },
  draft: { by: 'jo', place: 'compose', text, rev },
})
let settled = async (ready: () => boolean) => {
  for (let i = 0; i < 100 && !ready(); i++) await Promise.resolve()
  assert(ready(), 'transport did not settle')
}

let base = 'https://draft-client.test/notes/api/'
let stores: { outbox: { close: () => void } }[] = []
// Each store keeps a clock of the test's own, which only a test that waits out
// a retry moves.
let store = (url: string, time: Clock = clock()) => {
  let value = publicClient.store(url, { clock: time })
  stores.push(value)
  return value
}
let closeOutboxes = () => {
  for (let s of stores.splice(0)) s.outbox.close()
}

// A closed page has already stashed this text. Constructing its store and
// seeding persistence are fixtures; the case measures recovering another page.
let recovery = await (async () => {
  let calls: Call[] = [], reports: unknown[] = []
  using _wire = transport((call) => {
    calls.push(call)
    return json({ error: { message: 'offline' } }, 503)
  })
  let stash = storage()
  let opts = {
    by: 'jo',
    stash,
    pace: 0,
    report: (e: unknown) => reports.push(e),
  }
  let first = store(base).drafts(opts)
  first.type('compose', 'A precious unsent thought')
  let text = first.text('compose')
  await settled(() => reports.length == 1)
  first.close()
  closeOutboxes()
  return { calls, reports, stash, opts, text }
})()

test('public drafts recover a reload without crossing app or person scopes', async () => {
  let { calls, reports, stash, opts, text } = recovery
  using _wire = transport((call) => {
    calls.push(call)
    return json({ error: { message: 'offline' } }, 503)
  })
  assertEquals(text, 'A precious unsent thought')
  let otherApp = store('https://draft-client.test/other/api/')
    .drafts(opts)
  let otherPerson = store(base).drafts({ ...opts, by: 'al' })
  let reload = store(base).drafts(opts)
  try {
    assertEquals(otherApp.text('compose'), '')
    assertEquals(otherPerson.text('compose'), '')
    assertEquals(reload.text('compose'), 'A precious unsent thought')
    await settled(() => reports.length >= 2)
    assert(calls.every((c) => c.base == base))
    assertEquals(stash.length, 1)
  } finally {
    otherApp.close()
    otherPerson.close()
    reload.close()
    closeOutboxes()
  }
})

let pendingReceipt = await (async () => {
  let calls: Call[] = [], reports: unknown[] = []
  let started = deferred<void>(), accepted = deferred<Response>()
  let time = clock()
  using wire = transport((call) => {
    calls.push(call)
    if (calls.length == 1) {
      return json({ pending: true, bundles: call.bundles }, 202)
    }
    if (calls.length == 2) {
      started.resolve()
      return accepted.promise
    }
    return json({
      bundles: call.bundles.map((b) => ({
        ...b,
        draft: { ...b.draft as object, rev: 2 },
      })),
    })
  })
  let stash = storage()
  let desk = store(base, time).drafts({
    by: 'jo',
    stash,
    pace: 0,
    report: (e: unknown) => reports.push(e),
  })
  let eid = publicClient.draftEid('jo', 'compose')
  try {
    desk.type('compose', 'first')
    await settled(() => reports.length == 1)
    let initialText = desk.text('compose')
    await time.advance(1000)
    await started.promise
    wire.hear([row(eid, 'first', 1)])
    desk.type('compose', 'first, and still typing')
    let saved = stash.length, pendingText = desk.text('compose')
    accepted.resolve(json({ bundles: [row(eid, 'first', 1)] }))
    // The receipt must not swallow what was typed while it was pending.
    await settled(() => calls.length == 3)
    return { initialText, saved, pendingText, calls, reports }
  } finally {
    accepted.resolve(json({ bundles: [row(eid, 'first', 1)] }))
    desk.close()
    closeOutboxes()
  }
})()
test('public drafts retry a pending receipt with one identity and keep typing until acceptance', () => {
  let { initialText, saved, pendingText, calls, reports } = pendingReceipt
  assertEquals(initialText, 'first')
  assertEquals(saved, 1)
  assertEquals(pendingText, 'first, and still typing')
  assert(calls[0].key)
  assertEquals(calls[1].key, calls[0].key)
  assertEquals(calls[1].body, calls[0].body)
  assertEquals(
    (calls[2].bundles[0].draft as { text: string }).text,
    'first, and still typing',
  )
  assert(calls[2].key != calls[0].key)
  assertEquals(reports.length, 1)
})

// A saved draft is the starting point; only spending it and recovering the
// still-pending send belong to the timed behavior.
let pendingSend = await (async () => {
  let calls: Call[] = [], reports: unknown[] = []
  using wire = transport((call) => {
    calls.push(call)
    return json({
      bundles: [
        row(publicClient.draftEid('jo', 'compose'), 'Never lose this send', 1),
      ],
    })
  })
  let stash = storage()
  let opts = {
    by: 'jo',
    stash,
    pace: 0,
    report: (e: unknown) => reports.push(e),
  }
  let time = clock()
  let client = publicClient.store(base, { clock: time })
  let desk = client.drafts(opts)
  let eid = publicClient.draftEid('jo', 'compose')
  desk.type('compose', 'Never lose this send')
  await settled(() => stash.length == 0)
  return {
    calls,
    reports,
    stash,
    opts,
    time,
    client,
    desk,
    eid,
    hear: wire.hear,
  }
})()

test('public drafts preserve a pending send across reload instead of accepting watch text', async () => {
  let { calls, reports, stash, opts, time, client, desk, eid, hear } =
    pendingSend
  using _wire = transport((call) => {
    calls.push(call)
    return json({ pending: true, bundles: call.bundles }, 202)
  })
  try {
    let send = desk.spend('compose', [{
      entity: { eid: 'message' },
      doc: { body: 'Never lose this send' },
    }])
    await Promise.resolve()
    assertEquals(desk.text('compose'), '')
    assertEquals(stash.length, 1)
    hear([row(eid, '', 2)])
    assertEquals(await send, false)
    assertEquals(desk.text('compose'), 'Never lose this send')
    assertEquals(reports.length, 1)
    // The outbox sends it again once its wait is over.
    await time.advance(1000)
    await settled(() => calls.length == 3)
    assert(calls.length >= 2)
    let retries = calls.slice(1)
    assert(retries[0].key)
    assert(
      retries.every((c) =>
        c.key == retries[0].key && c.body == retries[0].body
      ),
    )
    assertEquals(retries[0].bundles.length, 2)
    desk.close()
    let reload = store(base).drafts(opts)
    assertEquals(reload.text('compose'), 'Never lose this send')
    reload.close()
  } finally {
    desk.close()
    client.outbox.close()
    closeOutboxes()
  }
})

test('public drafts wait for identity before binding or spending and isolate recovered text', async () => {
  let identity = deferred<Response>(),
    calls: Call[] = [],
    reports: unknown[] = []
  using _wire = transport((call) => {
    calls.push(call)
    return json({ bundles: call.bundles })
  }, () => identity.promise)
  let stash = storage()
  let opts = { stash, report: (e: unknown) => reports.push(e) }
  let document = parseHTML('<textarea></textarea>').document
  let field = document.querySelector(
    'textarea',
  )! as unknown as HTMLTextAreaElement
  let desk = store(base).drafts(opts)
  let off = desk.bind(field, 'compose')
  try {
    assertEquals(field.readOnly, true)
    assertThrows(() => desk.type('compose', 'unknown writer'))
    let sent = desk.spend('compose', [{
      entity: { eid: 'message' },
      doc: { body: 'not sent anonymously' },
    }])
    assertEquals(calls.length, 0)
    identity.resolve(json({ person: null }))
    assertEquals(await sent, false)
    assertEquals(calls.length, 0)
    assertEquals(stash.length, 0)
  } finally {
    off()
    desk.close()
    closeOutboxes()
  }
})

test('public drafts DOM binding follows another interface and preserves composition until it ends', () => {
  let reports: unknown[] = []
  using wire = transport((call) => json({ bundles: call.bundles }))
  let { document, Event } = parseHTML('<textarea></textarea>')
  let field = document.querySelector(
    'textarea',
  )! as unknown as HTMLTextAreaElement
  let desk = store(base).drafts({
    by: 'jo',
    stash: false,
    report: (e: unknown) => reports.push(e),
  })
  let off = desk.bind(field, 'compose')
  try {
    let eid = publicClient.draftEid('jo', 'compose')
    wire.hear([row(eid, 'second interface', 1)])
    assertEquals(field.value, 'second interface')
    field.dispatchEvent(new Event('compositionstart'))
    field.value = 'second interface, composing'
    wire.hear([row(eid, 'remote update', 2)])
    assertEquals(field.value, 'second interface, composing')
    field.dispatchEvent(new Event('compositionend'))
    assertEquals(desk.text('compose'), 'second interface, composing')
    off()
    field.value = 'unbound'
    field.dispatchEvent(new Event('input'))
    assertEquals(desk.text('compose'), 'second interface, composing')
    assertEquals(reports, [])
  } finally {
    off()
    desk.close()
    closeOutboxes()
  }
})
