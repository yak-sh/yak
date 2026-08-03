// A subscription's member set is maintained INCREMENTALLY: per committed batch
// maintain() re-tests only the eids that batch touched, and streams the
// transition. /query answers the same sentence the other way — it re-evaluates
// the whole graph from scratch. Both parse through query.ts, so agreement
// between them says nothing about the parser and everything about the
// incremental half: a transition maintain() forgets shows up here as a member
// set that has drifted from the truth.
//
// That drift is invisible today, because every client still SCANS its own
// complete cache and only shadow-tracks the set beside it. It stops being
// invisible the moment a board reads `subMembers` instead of scanning — then a
// forgotten transition is a task that silently will not leave a column. So the
// matrix below walks one subscription per predicate class through the four
// transitions (add, update, remove, dead) and re-checks the whole set against
// the oracle after every single write.
//
// The barrier is the protocol, not a sleep: frames on ONE socket are ordered,
// so a fresh subscribe's reply necessarily follows every maintain frame the
// writes before it enqueued.

import { assertEquals } from '@std/assert'

// The server reads its port from the environment, so claim an ephemeral one and
// give the seat back before it boots (precondition_test.ts does the same — a
// fixed port collides with whatever else runs on a shared box).
let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
let port = (seat.addr as Deno.NetAddr).port
seat.close()
Deno.env.set('PORT', String(port))
Deno.env.set('DB_PATH', ':memory:')
let { aged } = await import('./server.ts')

let U = `127.0.0.1:${port}`
let uid = () => crypto.randomUUID()
let alone = { sanitizeOps: false, sanitizeResources: false }

type Comp = Record<string, unknown> | null
type Change = { eid: string; name: string; comp: Comp }
type Frame = {
  sub: string
  changes: Change[]
  drop?: string[]
  replace?: boolean
}

let post = async (changes: Change[]) => {
  let res = await fetch(`http://${U}/apply`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(changes),
  })
  let text = await res.text()
  if (!res.ok) throw new Error(`apply refused: ${text}`)
}

// The oracle: the same filter line evaluated over the whole graph, through a
// door that shares no state with the subscription registry.
let queried = async (q: string): Promise<string[]> => {
  let res = await fetch(`http://${U}/query?${encodeURIComponent(q)}`)
  if (!res.ok) throw new Error(`query refused: ${await res.text()}`)
  let hits = await res.json() as { eid: string }[]
  return hits.map((r) => r.eid).sort()
}

// A subscribing socket that folds frames into member sets exactly as the wire
// says to: a replace frame supersedes the set, a maintenance frame adds every
// eid it carries changes for, and removes every eid in `drop` plus every death
// riding as an entity-null. Written out here rather than imported from live.ts
// so the contract under test is stated independently of the client that reads
// it.
let subscriber = async () => {
  let socket = new WebSocket(`ws://${U}/ws`)
  let sets = new Map<string, Set<string>>()
  let waiting = new Map<string, () => void>()
  socket.onmessage = (m) => {
    let f = JSON.parse(String(m.data)) as Frame
    if (!f || typeof f.sub != 'string') return
    let mine = f.replace ? new Set<string>() : sets.get(f.sub) ?? new Set()
    sets.set(f.sub, mine)
    for (let c of f.changes ?? []) {
      if (c.name == 'entity' && c.comp == null) mine.delete(c.eid)
      else mine.add(c.eid)
    }
    for (let eid of f.drop ?? []) mine.delete(eid)
    waiting.get(f.sub)?.()
  }
  await new Promise((ok, no) => {
    socket.onopen = ok
    socket.onerror = () => no(new Error('socket refused'))
  })
  let reply = (sub: string, frame: unknown) => {
    let seen = new Promise<void>((ok) => waiting.set(sub, ok))
    socket.send(JSON.stringify(frame))
    return seen.finally(() => waiting.delete(sub))
  }
  let n = 0
  return {
    open: (sub: string, q: string) => reply(sub, { sub, q }),
    // Every enqueued maintain frame is already on the wire ahead of this
    // subscribe's reply, so awaiting the reply awaits them all. The query must
    // PARSE (a bad one is caught server-side and never answered) and match
    // nothing, so the barrier costs one empty frame.
    settle: () => {
      let sub = `barrier:${++n}`
      return reply(sub, { sub, q: '.doc.title~=__barrier_matches_nothing__' })
    },
    members: (sub: string) => [...(sets.get(sub) ?? [])].sort(),
    close: () => socket.close(),
  }
}

// One predicate class, walked through its transitions. `writes` is a list of
// batches; after EACH the subscription's maintained set must equal the oracle's
// re-evaluation — a drift that heals on the next write still fails here.
let walk = async (q: string, writes: Change[][]) => {
  let client = await subscriber()
  let sub = `probe:${uid()}`
  try {
    await client.open(sub, q)
    assertEquals(client.members(sub), await queried(q), `initial set: ${q}`)
    for (let [i, batch] of writes.entries()) {
      await post(batch)
      await client.settle()
      assertEquals(client.members(sub), await queried(q), `${q} — write ${i}`)
    }
  } finally {
    client.close()
  }
}

// A task carrying whatever the case needs, born OUTSIDE the query under test so
// the first write is a genuine add rather than a member present from the start.
let task = (comp: Record<string, unknown>) => {
  let eid = uid()
  return {
    eid,
    born: [
      { eid, name: 'doc', comp: { title: `probe ${eid.slice(0, 8)}` } },
      { eid, name: 'task', comp: { status: 'done', priority: 3, ...comp } },
    ] as Change[],
  }
}

Deno.test(
  'subscription: equality pred through add/update/remove/dead',
  alone,
  async () => {
    let a = task({})
    let q = `.task.status=open&.doc.title~=${a.eid.slice(0, 8)}`
    await walk(q, [
      a.born, // exists, does not match
      [{ eid: a.eid, name: 'task', comp: { status: 'open' } }], // add
      [{ eid: a.eid, name: 'task', comp: { priority: 0 } }], // update, still in
      [{ eid: a.eid, name: 'task', comp: { status: 'done' } }], // remove
      [{ eid: a.eid, name: 'task', comp: { status: 'open' } }], // add again
      [{ eid: a.eid, name: 'entity', comp: null }], // dead
    ])
  },
)

Deno.test(
  'subscription: list pred keeps a member moving within the list',
  alone,
  async () => {
    let a = task({})
    let q = `.task.status=open,wip&.doc.title~=${a.eid.slice(0, 8)}`
    await walk(q, [
      a.born,
      [{ eid: a.eid, name: 'task', comp: { status: 'open' } }], // add
      [{ eid: a.eid, name: 'task', comp: { status: 'wip' } }], // still in
      [{ eid: a.eid, name: 'task', comp: { status: 'done' } }], // out
    ])
  },
)

Deno.test('subscription: range and comparison preds', alone, async () => {
  let a = task({})
  let tag = a.eid.slice(0, 8)
  await walk(`.task.priority=0..1&.doc.title~=${tag}`, [
    a.born,
    [{ eid: a.eid, name: 'task', comp: { priority: 1 } }], // in
    [{ eid: a.eid, name: 'task', comp: { priority: 2 } }], // out
    [{ eid: a.eid, name: 'task', comp: { priority: 0 } }], // in
  ])
  await walk(`.task.priority<=1&.doc.title~=${tag}`, [
    [{ eid: a.eid, name: 'task', comp: { priority: 3 } }], // out
    [{ eid: a.eid, name: 'task', comp: { priority: 1 } }], // in
  ])
})

Deno.test('subscription: negation and contains preds', alone, async () => {
  let a = task({})
  let tag = a.eid.slice(0, 8)
  await walk(`.task.status!=done&.doc.title~=${tag}`, [
    a.born, // done — out
    [{ eid: a.eid, name: 'task', comp: { status: 'open' } }], // in
    [{ eid: a.eid, name: 'task', comp: { status: 'done' } }], // out
  ])
  await walk(`.doc.title~=${tag}`, [
    [{ eid: a.eid, name: 'doc', comp: { title: 'renamed away' } }], // out
    [{ eid: a.eid, name: 'doc', comp: { title: `back ${tag}` } }], // in
  ])
})

// `.prop=` with an empty value means ABSENT, so clearing a column is an ADD and
// setting one is a REMOVE — the transition table run backwards, and the one
// class where a patch that omits the column must leave membership alone.
Deno.test(
  'subscription: absence pred adds on clear, removes on set',
  alone,
  async () => {
    let home = uid()
    let a = task({})
    let tag = a.eid.slice(0, 8)
    await post([{ eid: home, name: 'doc', comp: { title: 'probe home' } }])
    await post([{ eid: home, name: 'project', comp: {} }])
    await walk(`.task.project_eid=&.doc.title~=${tag}`, [
      a.born, // no project — in
      [{ eid: a.eid, name: 'task', comp: { project_eid: home } }], // out
      [{ eid: a.eid, name: 'task', comp: { priority: 1 } }], // untouched — still out
      [{ eid: a.eid, name: 'task', comp: { project_eid: null } }], // in
    ])
  },
)

// A component deleted whole is not a column cleared: the row is gone, so every
// pred over it must stop matching — including a `!=` that a missing column
// might otherwise be read as satisfying.
Deno.test(
  'subscription: deleting the component drops the member',
  alone,
  async () => {
    let a = task({})
    let tag = a.eid.slice(0, 8)
    await walk(`.task.status!=done&.doc.title~=${tag}`, [
      a.born,
      [{ eid: a.eid, name: 'task', comp: { status: 'open' } }], // in
      [{ eid: a.eid, name: 'task', comp: null }], // component gone
    ])
  },
)

// Two subscriptions on ONE socket must not share a member set: the same write
// lands in whichever of them it belongs to, and the frames are keyed by sub id.
Deno.test(
  'subscription: two subs on one socket stay separate',
  alone,
  async () => {
    let a = task({})
    let b = task({})
    let tag = `${a.eid.slice(0, 8)}`
    let client = await subscriber()
    try {
      await post([...a.born, ...b.born])
      let open = `.task.status=open&.doc.title~=probe`
      let mine = `.doc.title~=${tag}`
      await client.open('open', open)
      await client.open('mine', mine)
      await post([{ eid: a.eid, name: 'task', comp: { status: 'open' } }])
      await client.settle()
      assertEquals(client.members('open'), await queried(open))
      assertEquals(client.members('mine'), await queried(mine))
      assertEquals(client.members('mine'), [a.eid])
    } finally {
      client.close()
    }
  },
)

// Every case above moves membership by WRITING. A moving time window moves it
// by doing nothing at all: the window advances, the row's timestamp does not,
// and the row falls out the far side with no batch for maintain() to react to.
// So these hand the sweep a later clock instead of waiting a minute for the
// real one, and prove the drop came from the CLOCK — the oracle, asked at the
// true present, still returns the member.
Deno.test(
  'sweep: a member ages out of a moving window with no write',
  alone,
  async () => {
    let a = task({})
    let tag = a.eid.slice(0, 8)
    let q = `.doc.title~=${tag}&.created.at>=1-minute-ago`
    let client = await subscriber()
    try {
      await post(a.born)
      await client.open('moving', q)
      assertEquals(client.members('moving'), [a.eid])

      // The present is unchanged, so nothing has aged: the sweep is a no-op.
      aged()
      await client.settle()
      assertEquals(client.members('moving'), [a.eid])

      // Two minutes on, the window has left the row behind.
      aged(Date.now() + 120_000)
      await client.settle()
      assertEquals(client.members('moving'), [])
      assertEquals(await queried(q), [a.eid], 'still a hit at the true present')
    } finally {
      client.close()
    }
  },
)

// The other direction: a set that no time phrase governs is settled by
// maintain() alone, and no clock the sweep is handed — however absurd — may
// disturb it. (That the sweep also SKIPS such a sub is a cost property, not a
// visible one; this holds whether it skips or re-tests.)
Deno.test(
  'sweep: leaves a subscription with no moving window alone',
  alone,
  async () => {
    let a = task({})
    let tag = a.eid.slice(0, 8)
    let client = await subscriber()
    try {
      await post(a.born)
      await client.open('still', `.doc.title~=${tag}`)
      assertEquals(client.members('still'), [a.eid])
      aged(Date.now() + 400 * 86_400_000) // a year on
      await client.settle()
      assertEquals(client.members('still'), [a.eid])
    } finally {
      client.close()
    }
  },
)
