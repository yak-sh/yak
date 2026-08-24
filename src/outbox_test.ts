// The acked outbox (T-21413): a write is HELD by its sender until the server
// confirms it landed, because the incident it answers was exactly the other
// shape — fire-and-forget frames dying on a restarting socket while the
// optimistic cache kept showing success, silently losing owner edits. The
// slow tier drives the REAL /ws door: `{apply, id}` must come back as
// `{ack, id}` only after the write is readable, a refusal must settle the
// same id, and a bare array (an older tab) must still apply. The fast tier
// holds the client half: mutate() parks the batch in the outbox, an ack —
// and only an ack — releases it, and draining disarms the redelivery timer
// (the sanitizers fail this file if it leaks).

import { assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')
let { sha } = await import('./db.ts')

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
  let res = await fetch(`http://${U}/snapshot`)
  let out = await res.json() as {
    changes: {
      eid: string
      name: string
      comp: Record<string, unknown> | null
    }[]
  }
  return out.changes.find((c) => c.eid == eid && c.name == 'doc')?.comp?.body
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
