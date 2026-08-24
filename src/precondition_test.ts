// A precondition rides OUTSIDE `comp`: `Change.was` is a sibling field on the
// change, because `admitted` refuses alien keys inside one. So it reaches the
// rule in apply() only because every hop between a client and the db SPREADS
// the change instead of rebuilding it — and nothing else declares that they
// must. A precondition dropped in transit fails OPEN: the write lands
// unguarded while the caller believes it was protected, which is the lost
// update the guard exists to stop, now wearing a safety label.
//
// So these drive the REAL doors rather than calling apply() in process. A hop
// rewritten as `{eid, name, comp}` — the shape a refactor reaches for — fails
// here instead of quietly retiring the guard. Each door is checked twice: the
// guarded write must REFUSE, and the same write without `was` must SUCCEED.
// Without that control the suite passes just as happily when `was` is dropped
// everywhere as when it is honoured.

import { assertEquals, assertStringIncludes } from '@std/assert'
import { normalizeChanges } from './props.ts'
import { derefChanges } from './client.ts'
import { slow } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')
let { sha } = await import('./db.ts')

// The server serves on import — the one heavy boot here, reached only over HTTP.
// Every test is slow(), so the fast run (which ignores them all) must not pay
// that boot, nor claim a socket a parallel worker would collide on. Boot it
// only under the heavy tier: claim an ephemeral port and give the seat back
// before the server takes it — a fixed port collides on a shared box.
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

let post = async (changes: unknown[]) => {
  let res = await fetch(`http://${U}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  })
  return { status: res.status, text: await res.text() }
}

// What is stored right now, read through a door of its own, so "the write did
// not land" rests on the graph rather than on the response under test.
let snap = async () => {
  let res = await fetch(`http://${U}/snapshot`)
  let out = await res.json() as {
    changes: {
      eid: string
      name: string
      comp: Record<string, unknown> | null
    }[]
  }
  return out.changes
}

let stored = async (eid: string) =>
  (await snap()).find((c) => c.eid == eid && c.name == 'doc')?.comp?.body

// The server-minted number behind the human id — what the refusal must
// speak, read through the same door rather than parsed out of the message.
let num = async (eid: string) =>
  (await snap()).find((c) => c.eid == eid && c.name == 'entity')?.comp?.num

// A doc holding a value the caller never read: it read ONE, someone else
// wrote TWO, so ONE's hash is stale and a guard naming it must refuse.
let stale = async () => {
  let eid = uid()
  await post([{ eid, name: 'doc', comp: { title: 'guard', body: 'ONE' } }])
  await post([{ eid, name: 'doc', comp: { body: 'TWO' } }])
  return { eid, was: { body: sha('ONE') } }
}

slow('POST /apply carries a precondition to the rule', alone, async () => {
  let { eid, was } = await stale()
  let refused = await post([{
    eid,
    name: 'doc',
    comp: { body: 'CLOBBER' },
    was,
  }])
  assertEquals(refused.status, 400)
  assertStringIncludes(refused.text, 'has moved since you read it')
  assertEquals(await stored(eid), 'TWO')
})

// Every door TAKES human ids, so the refusal must SPEAK them: its reader is
// an agent mid-collision, about to merge and retry, and the one thing it may
// want first is to open the entity it collided on. A uuid it never typed is
// unpasteable in every other door. The uuid is right to carry (Stale.eid);
// only the message is agent-facing. `stale()` mints a doc-only entity, so
// its spoken id is D-<num> (T-10277).
slow('a refusal speaks the human id, not the eid', alone, async () => {
  let { eid, was } = await stale()
  let refused = await post([{
    eid,
    name: 'doc',
    comp: { body: 'CLOBBER' },
    was,
  }])
  assertStringIncludes(refused.text, `doc.body on D-${await num(eid)} has`)
  // The whole point: no uuid anywhere in what the agent reads.
  assertEquals(refused.text.includes(eid), false)
})

slow(
  'POST /apply without a precondition still writes',
  alone,
  async () => {
    let { eid } = await stale()
    let ok = await post([{ eid, name: 'doc', comp: { body: 'CLOBBER' } }])
    assertEquals(ok.status, 200)
    assertEquals(await stored(eid), 'CLOBBER')
  },
)

// The socket is the browser's write path, and it hands its parsed frame to
// apply() the way /apply hands it the parsed body. A client JOINS before it
// writes — that handshake is what puts it in the broadcast set, so without it
// a committed batch comes back to nobody and the success case cannot be told
// from a dropped one.
let sync = async (changes: unknown[]) => {
  let socket = new WebSocket(`ws://${U}/ws`)
  let frames: Record<string, unknown>[] = []
  let waiting: (() => void) | undefined
  socket.onmessage = (m) => {
    let frame = JSON.parse(String(m.data))
    frames.push(Array.isArray(frame) ? { live: frame } : frame)
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
    socket.send(JSON.stringify(changes))
    return await next()
  } finally {
    socket.close()
  }
}

slow('/ws carries a precondition to the rule', alone, async () => {
  let { eid, was } = await stale()
  let frame = await sync([{ eid, name: 'doc', comp: { body: 'CLOBBER' }, was }])
  assertStringIncludes(String(frame.error), 'has moved since you read it')
  assertEquals(await stored(eid), 'TWO')
})

slow('/ws without a precondition still writes', alone, async () => {
  let { eid } = await stale()
  let frame = await sync([{ eid, name: 'doc', comp: { body: 'CLOBBER' } }])
  assertEquals(frame.error, undefined)
  assertEquals(await stored(eid), 'CLOBBER')
})

// A refused batch comes back with a SCOPED re-sync of just the eids it touched
// (server.ts correct()), never the whole-graph snapshot the reject once carried
// (M-21143). The correction re-asserts the authoritative doc, so the client
// applying it undoes its optimistic CLOBBER back to the stored TWO.
slow(
  '/ws refusal returns a scoped correction, not a snapshot',
  alone,
  async () => {
    let { eid, was } = await stale()
    let frame = await sync([{
      eid,
      name: 'doc',
      comp: { body: 'CLOBBER' },
      was,
    }])
    assertStringIncludes(String(frame.error), 'has moved')
    assertEquals(frame.snapshot, undefined)
    let changes = frame.changes as {
      eid: string
      name: string
      comp: Record<string, unknown> | null
    }[]
    let doc = changes.find((c) => c.eid == eid && c.name == 'doc')
    assertEquals(doc?.comp?.body, 'TWO')
  },
)

// The in-process hops, named one by one so a failure says WHICH rebuilt the
// change rather than only that the doors stopped refusing.
slow('normalizeChanges keeps a precondition', () => {
  let was = { body: sha('ONE') }
  let [out] = normalizeChanges([{
    eid: uid(),
    name: 'doc',
    comp: { body: 'x' },
    was,
  }])
  assertEquals(out.was, was)
})

slow('normalizeChanges keeps a precondition on a comp delete', () => {
  let was = { body: sha('ONE') }
  let [out] = normalizeChanges([{ eid: uid(), name: 'doc', comp: null, was }])
  assertEquals(out.was, was)
})

// derefChanges rebuilds every change to resolve human ids, which makes it the
// hop most likely to be rewritten field by field. No door sends a guarded
// change through it today; this keeps that survivable by construction rather
// than by nobody having tried it yet.
slow('derefChanges keeps a precondition', () => {
  let was = { body: sha('ONE') }
  let [out] = derefChanges([], [{
    eid: uid(),
    name: 'doc',
    comp: { body: 'x' },
    was,
  }])
  assertEquals(out.was, was)
})
