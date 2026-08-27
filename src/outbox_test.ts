// The acked outbox (T-21413): a write is HELD by its sender until the server
// confirms it landed, because the incident it answers was exactly the other
// shape — fire-and-forget frames dying on a restarting socket while the
// optimistic cache kept showing success, silently losing owner edits. The
// slow tier drives the served /ws door: `{apply, id}` must come back as
// `{ack, id}` only after the write is readable, a refusal must settle the
// same id, and a bare array (an older tab) must still apply. The fast tier
// holds the client half: mutate() parks the batch in the outbox, an ack —
// and only an ack — releases it, and draining disarms the redelivery timer
// (the sanitizers fail this file if it leaks).

import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from './testing.ts'
import { type Change } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { readComp, sha } = await import('./db.ts')

// The server serves on import — booted only under the heavy tier, on an
// ephemeral port, exactly as precondition_test.ts does.
let U = ''
if (Deno.env.get('TASKS_SLOW')) {
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  Deno.env.set('PORT', String(port))
  await import('./server.ts')
  U = `127.0.0.1:${port}`
}
let uid = () => crypto.randomUUID()
let alone = { sanitizeOps: false, sanitizeResources: false }

let stored = async (eid: string) => {
  let { db } = await import('./live_db.ts')
  return readComp(db, eid, 'doc')?.body
}

// A joined socket that sends ONE frame — array or object — and returns every
// reply frame until the caller has what it asked for.
let sync = async (frame: unknown, replies = 1) => {
  let socket = new WebSocket(`ws://${U}/ws`)
  let frames: Record<string, unknown>[] = []
  let waiting: (() => void) | undefined
  socket.onmessage = (m) => {
    let got = JSON.parse(String(m.data))
    frames.push(Array.isArray(got) ? { live: got } : got)
    waiting?.()
  }
  let next = () =>
    new Promise<Record<string, unknown>>((ok) => {
      let take = () => {
        if (!frames.length) return
        waiting = undefined
        ok(frames.shift()!)
      }
      waiting = take
      take()
    })
  try {
    await new Promise((ok, no) => {
      socket.onopen = ok
      socket.onerror = () => no(new Error('socket refused'))
    })
    socket.send(JSON.stringify({ since: null }))
    await next() // the reset frame — proof we are in the broadcast set
    socket.send(JSON.stringify(frame))
    let out: Record<string, unknown>[] = []
    while (out.length < replies) out.push(await next())
    return out
  } finally {
    socket.close()
  }
}

slow(
  '/ws {apply, id} answers {ack, id} and the write lands',
  alone,
  async () => {
    let eid = uid()
    let id = uid()
    let [ack] = await sync({
      apply: [{ eid, name: 'doc', comp: { title: 'acked', body: 'ONE' } }],
      id,
    })
    assertEquals(ack.ack, id)
    assertEquals(await stored(eid), 'ONE')
  },
)

slow('/ws refusal of {apply, id} settles the same id', alone, async () => {
  let eid = uid()
  await sync({
    apply: [{ eid, name: 'doc', comp: { title: 'guard', body: 'ONE' } }],
    id: uid(),
  })
  let id = uid()
  let [frame] = await sync({
    apply: [{
      eid,
      name: 'doc',
      comp: { body: 'CLOBBER' },
      was: { body: sha('STALE') },
    }],
    id,
  })
  assertStringIncludes(String(frame.error), 'has moved')
  assertEquals(frame.id, id)
  assertEquals(await stored(eid), 'ONE')
})

slow(
  '/ws bare array (an older tab) still applies, without an ack',
  alone,
  async () => {
    let eid = uid()
    let [echo] = await sync([
      { eid, name: 'doc', comp: { title: 'legacy', body: 'ONE' } },
    ])
    // The first reply is the live echo of the batch itself, never an ack.
    assertEquals(echo.ack, undefined)
    assertEquals(await stored(eid), 'ONE')
  },
)

// ——— the client half, no server: mutate parks, only an ack releases ———

let stubSockets = () => {
  let real = (globalThis as { WebSocket: unknown }).WebSocket
  ;(globalThis as { WebSocket: unknown }).WebSocket = class {
    readyState = 0
    onopen: unknown = null
    onmessage: unknown = null
    onclose: unknown = null
    send() {}
    addEventListener() {}
    close() {}
  }
  return () => {
    ;(globalThis as { WebSocket: unknown }).WebSocket = real
  }
}

Deno.test('mutate holds the write in the outbox until acked', async () => {
  let restore = stubSockets()
  let { mutate, unsent, acked } = await import('./live.ts')
  try {
    let before = unsent().length
    mutate({ eid: uid(), name: 'doc', comp: { title: 'held' } })
    let ids = unsent()
    assertEquals(ids.length, before + 1)
    // Only the ack releases it — and draining disarms the redelivery timer,
    // or the op sanitizer fails this test.
    for (let id of ids) acked(id)
    assertEquals(unsent().length, 0)
  } finally {
    restore()
  }
})

// ——— the backoff (T-21442): a wedged server is probed, never hammered ———

Deno.test('backoff doubles the gap and caps at RESEND_MAX', async () => {
  let { RESEND, RESEND_MAX, backoff } = await import('./live.ts')
  let gaps: number[] = []
  let wait = RESEND
  for (let i = 0; i < 10; i++) gaps.push(wait = backoff(wait))
  // Each gap is double the last until it saturates the cap — never beyond it.
  assertEquals(gaps[0], RESEND * 2)
  for (let i = 1; i < gaps.length; i++) {
    assert(gaps[i] == Math.min(gaps[i - 1] * 2, RESEND_MAX))
    assert(gaps[i] <= RESEND_MAX)
  }
  assertEquals(gaps.at(-1), RESEND_MAX)
})

Deno.test('a wedged server is retried on a widening gap, and an ack halts it', async () => {
  let restore = stubSockets()
  let live = await import('./live.ts')
  // The transport is wedged: record each send's id, and NEVER ack.
  let sends: string[] = []
  let prevRoute = live.useRoute((_frame, id) => {
    if (id) sends.push(id)
  })
  try {
    let t0 = Date.now()
    live.mutate({ eid: uid(), name: 'doc', comp: { title: 'wedged' } })
    let [id] = live.unsent()
    // Drive 80s of a wedged server, ticking every RESEND — the interval the
    // fixed cadence used to fire on (which would re-send ~26 times).
    let ticks = Math.ceil(80_000 / live.RESEND)
    for (let k = 1; k <= ticks; k++) {
      live.redeliverNow(false, t0 + k * live.RESEND)
    }
    let resends = sends.filter((x) => x == id).length - 1 // minus the initial send
    // Backoff (gaps 3,6,12,24,48s) fits ~4 retries in 80s, not ~26.
    assert(resends >= 2, `should still retry a wedged server, got ${resends}`)
    assert(resends <= 8, `backoff must cap redelivery, got ${resends} in 80s`)
    // Once acked, the write is gone — no tick re-sends it, however far ahead.
    live.acked(id)
    sends.length = 0
    live.redeliverNow(false, t0 + 10_000_000)
    assertEquals(sends.filter((x) => x == id).length, 0)
  } finally {
    live.useRoute(prevRoute)
    for (let x of live.unsent()) live.acked(x) // drain → disarm the timer
    restore()
  }
})

Deno.test('an empty mutate ships nothing', async () => {
  let restore = stubSockets()
  let { mutate, unsent } = await import('./live.ts')
  try {
    let before = unsent().length
    mutate()
    assertEquals(unsent().length, before)
  } finally {
    restore()
  }
})

// ——— the durable half (T-21440): the outbox survives a crash/reload ———

// An in-memory double for the IDB outbox store: a real reload throws the map
// away, so the DURABLE copy is what a fresh boot replays. Keyed by delivery id,
// exactly as idb.ts keys the OUTBOX store — so park/unpark/parked mirror the
// browser without an IndexedDB.
type Parked = { changes: Change[]; at: number }
let fakeStore = () => {
  let disk = new Map<string, Parked>()
  return {
    disk,
    park: (id: string, o: Parked) => void disk.set(id, o),
    unpark: (id: string) => void disk.delete(id),
    parked: () =>
      Promise.resolve([...disk].map(([id, o]) => [id, o] as [string, Parked])),
  }
}

Deno.test('deliver parks the write durably; ack unparks it', async () => {
  let restore = stubSockets()
  let live = await import('./live.ts')
  let store = fakeStore()
  let prev = live.useOutboxStore(store)
  try {
    live.mutate({ eid: uid(), name: 'doc', comp: { title: 'durable' } })
    // The parked copy is keyed by the SAME id the in-memory outbox holds.
    let ids = live.unsent()
    assertEquals(store.disk.size, 1)
    assertEquals([...store.disk.keys()], ids)
    // The ack removes both halves together — no orphaned durable entry.
    for (let id of ids) live.acked(id)
    assertEquals(live.unsent().length, 0)
    assertEquals(store.disk.size, 0)
  } finally {
    live.useOutboxStore(prev)
    restore()
  }
})

Deno.test("boot replays a prior life's parked writes", async () => {
  let restore = stubSockets()
  let live = await import('./live.ts')
  let store = fakeStore()
  // A write the last tab parked but a dying socket never saw acked.
  let id = uid()
  store.disk.set(id, {
    changes: [{ eid: uid(), name: 'doc', comp: { title: 'survived' } }],
    at: 0,
  })
  let prev = live.useOutboxStore(store)
  try {
    assertEquals(live.unsent().includes(id), false)
    await live.replayOutbox()
    // The stored write is back in the outbox under its ORIGINAL id, queued for
    // redelivery — nothing was lost across the reload.
    assertEquals(live.unsent().includes(id), true)
  } finally {
    for (let x of live.unsent()) live.acked(x) // drain → disarm the timer
    live.useOutboxStore(prev)
    restore()
  }
})

Deno.test('replay is idempotent across two hydrators', async () => {
  let restore = stubSockets()
  let live = await import('./live.ts')
  let store = fakeStore()
  let id = uid()
  store.disk.set(id, {
    changes: [{ eid: uid(), name: 'doc', comp: { title: 'once' } }],
    at: 0,
  })
  let prev = live.useOutboxStore(store)
  try {
    // Two tabs race to hydrate the same durable outbox. The stable id means the
    // second replay re-adds nothing: exactly ONE queued entry, not a duplicate.
    await live.replayOutbox()
    await live.replayOutbox()
    let here = live.unsent().filter((x) => x == id)
    assertEquals(here.length, 1)
  } finally {
    for (let x of live.unsent()) live.acked(x)
    live.useOutboxStore(prev)
    restore()
  }
})
