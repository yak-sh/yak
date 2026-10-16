// Drive the served module's public drafts door, including its HTTP receipt
// envelope and socket frames. The transport controls acceptance independently
// of optimistic/watch text: neither one is a durable receipt.
import { assert, assertEquals, assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import { parseHTML } from 'linkedom'
import { test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { kernel, seed, unique } from './probe.ts'

let k = await kernel()
let slug = unique('draftclient')
await seed(k, [{ slug, apps: ['notes'] }])
let dir = Deno.makeTempDirSync({ prefix: 'tasks-client-drafts-' })
for (let file of ['client.js', '_draft.js']) {
  let response = await k.at(`${slug}.yaks.app`, `/notes/api/${file}`)
  assertEquals(response.status, 200)
  Deno.writeTextFileSync(`${dir}/${file}`, await response.text())
}
let publicClient = await import(`file://${dir}/client.js`)
Deno.removeSync(dir, { recursive: true })

type Call = {
  base: string
  key: string | null
  bundles: Bundle[]
  body: string
}
let json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status })
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
// These tests control acceptance, not backoff time. Keep retry boundaries
// asynchronous without making a pending receipt test spend wall-clock seconds.
let nativeTimeout = globalThis.setTimeout
let retryTimers = () =>
  stub(
    globalThis,
    'setTimeout',
    ((fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      if (ms != 250) return nativeTimeout(fn, ms, ...args)
      queueMicrotask(() => (fn as (...args: unknown[]) => void)(...args))
      return 0
    }) as typeof setTimeout,
  )

let settled = async (ready: () => boolean) => {
  for (let i = 0; i < 100 && !ready(); i++) await Promise.resolve()
  assert(ready(), 'transport did not settle')
}

let base = 'https://draft-client.test/notes/api/'

test('public drafts recover a reload without crossing app or person scopes', async () => {
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
  let first = publicClient.store(base).drafts(opts)
  first.type('compose', 'A precious unsent thought')
  assertEquals(first.text('compose'), 'A precious unsent thought')
  first.close()
  let otherApp = publicClient.store('https://draft-client.test/other/api/')
    .drafts(opts)
  let otherPerson = publicClient.store(base).drafts({ ...opts, by: 'al' })
  let reload = publicClient.store(base).drafts(opts)
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
  }
})

test('public drafts retry a pending receipt with one identity and keep typing until acceptance', async () => {
  let calls: Call[] = [], reports: unknown[] = []
  let started = deferred<void>(), accepted = deferred<Response>()
  using _timers = retryTimers()
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
  let desk = publicClient.store(base).drafts({
    by: 'jo',
    stash,
    pace: 0,
    report: (e: unknown) => reports.push(e),
  })
  let eid = publicClient.draftEid('jo', 'compose')
  try {
    desk.type('compose', 'first')
    await started.promise
    wire.hear([row(eid, 'first', 1)])
    desk.type('compose', 'first, and still typing')
    assertEquals(stash.length, 1)
    assertEquals(desk.text('compose'), 'first, and still typing')
    assert(calls[0].key)
    assertEquals(calls[1].key, calls[0].key)
    assertEquals(calls[1].body, calls[0].body)
    accepted.resolve(json({ bundles: [row(eid, 'first', 1)] }))
    // The receipt must not swallow what was typed while it was pending.
    await settled(() => calls.length == 3)
    assertEquals(
      (calls[2].bundles[0].draft as { text: string }).text,
      'first, and still typing',
    )
    assert(calls[2].key != calls[0].key)
    assertEquals(reports, [])
  } finally {
    accepted.resolve(json({ bundles: [row(eid, 'first', 1)] }))
    desk.close()
  }
})

test('public drafts preserve a pending send across reload instead of accepting watch text', async () => {
  let calls: Call[] = [], reports: unknown[] = []
  let saved = deferred<Response>()
  using _timers = retryTimers()
  using wire = transport((call) => {
    calls.push(call)
    // Saving the draft succeeds. Sending it remains pending at every retry.
    if (calls.length == 1) return saved.promise
    return json({ pending: true, bundles: call.bundles }, 202)
  })
  let stash = storage()
  let opts = {
    by: 'jo',
    stash,
    pace: 0,
    report: (e: unknown) => reports.push(e),
  }
  let desk = publicClient.store(base).drafts(opts)
  let eid = publicClient.draftEid('jo', 'compose')
  try {
    desk.type('compose', 'Never lose this send')
    saved.resolve(json({ bundles: [row(eid, 'Never lose this send', 1)] }))
    await settled(() => stash.length == 0)
    let send = desk.spend('compose', [{
      entity: { eid: 'message' },
      doc: { body: 'Never lose this send' },
    }])
    await Promise.resolve()
    assertEquals(desk.text('compose'), '')
    assertEquals(stash.length, 1)
    wire.hear([row(eid, '', 2)])
    assertEquals(await send, false)
    assertEquals(desk.text('compose'), 'Never lose this send')
    assertEquals(reports.length, 1)
    assertEquals(calls.length, 7)
    let retries = calls.slice(1)
    assert(retries[0].key)
    assert(
      retries.every((c) =>
        c.key == retries[0].key && c.body == retries[0].body
      ),
    )
    assertEquals(retries[0].bundles.length, 2)
    desk.close()
    let reload = publicClient.store(base).drafts(opts)
    assertEquals(reload.text('compose'), 'Never lose this send')
    reload.close()
  } finally {
    desk.close()
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
  let desk = publicClient.store(base).drafts(opts)
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
  }
})

test('public drafts DOM binding follows another interface and preserves composition until it ends', () => {
  let reports: unknown[] = []
  using wire = transport((call) => json({ bundles: call.bundles }))
  let { document, Event } = parseHTML('<textarea></textarea>')
  let field = document.querySelector(
    'textarea',
  )! as unknown as HTMLTextAreaElement
  let desk = publicClient.store(base).drafts({
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
  }
})
