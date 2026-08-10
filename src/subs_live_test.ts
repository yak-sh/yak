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
let { aged, maintain } = await import('./server.ts')
let { db } = await import('./db.ts')
let { append, settleGeneration, takeEntry } = await import('./entries.ts')

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
  let hits = await res.json() as { entity: { eid: string } }[]
  return hits.map((r) => r.entity.eid).sort()
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
  let seen = new Map<string, Change[]>()
  let waiting = new Map<string, () => void>()
  socket.onmessage = (m) => {
    let f = JSON.parse(String(m.data)) as Frame
    if (!f || typeof f.sub != 'string') return
    let mine = f.replace ? new Set<string>() : sets.get(f.sub) ?? new Set()
    sets.set(f.sub, mine)
    seen.set(f.sub, [...(f.replace ? [] : seen.get(f.sub) ?? []), ...f.changes])
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
    shadow: (sub: string, q: string) => reply(sub, { sub, q, shadow: true }),
    // What a frame CARRIED, not just which eids it named — the projection is
    // a claim about columns, so a test of it has to read them.
    carried: (sub: string) => seen.get(sub) ?? [],
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
    await walk(`.task.project=&.doc.title~=${tag}`, [
      a.born, // no project — in
      [{ eid: a.eid, name: 'task', comp: { project: home } }], // out
      [{ eid: a.eid, name: 'task', comp: { priority: 1 } }], // untouched — still out
      [{ eid: a.eid, name: 'task', comp: { project: null } }], // in
    ])
  },
)

Deno.test(
  'subscription: presence pred follows a stamped column',
  alone,
  async () => {
    let a = task({})
    let tag = a.eid.slice(0, 8)
    await walk(`.proposed.at!&.doc.title~=${tag}`, [
      a.born, // no proposal — out
      [{ eid: a.eid, name: 'proposed', comp: {} }], // stamped at — in
      [{ eid: a.eid, name: 'task', comp: { priority: 1 } }], // untouched — still in
      [{ eid: a.eid, name: 'proposed', comp: null }], // absent — out
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

// Doc bodies are 44% of what a whole-graph subscription ships, and no board
// or shape view paints one. So a board's frames carry none — and the two
// doors that answer "give me this body" are the `card:` subscription (the
// 2c card/route path) and /body (what a client asks when it holds a doc it
// was shipped no body for). A placeholder that neither could end would be
// permanent, so this walks all three in one sentence.
Deno.test('bodies ride only where a body is read', alone, async () => {
  let a = task({})
  let q = `.doc.title~=${a.eid.slice(0, 8)}`
  let board = `board:${uid()}`
  let card = `card:${a.eid}`
  let client = await subscriber()
  let doc = (sub: string) =>
    client.carried(sub).filter((c) => c.eid == a.eid && c.name == 'doc')
      .map((c) => c.comp!)
  try {
    await post([...a.born, {
      eid: a.eid,
      name: 'doc',
      comp: { body: 'the stored body' },
    }])
    await client.open(board, q)
    await client.open(card, q)
    assertEquals(doc(board).map((c) => 'body' in c), [false])
    assertEquals(doc(card).map((c) => c.body), ['the stored body'])
    // The title still rides on both: it is the shape, not the body.
    assertEquals(doc(board).map((c) => 'title' in c), [true])

    // A body EDIT is likewise the card's news and nothing to the board.
    await post([{ eid: a.eid, name: 'doc', comp: { body: 'a later body' } }])
    await client.settle()
    assertEquals(doc(board).length, 1, 'no second doc change for the board')
    assertEquals(doc(card).map((c) => c.body), [
      'the stored body',
      'a later body',
    ])

    // And the door for a body nobody subscribed: the answer IS a patch.
    let res = await fetch(`http://${U}/body?eids=${a.eid}`)
    assertEquals(await res.json(), {
      changes: [{
        eid: a.eid,
        name: 'doc',
        comp: { eid: a.eid, body: 'a later body' },
      }],
    })
  } finally {
    client.close()
  }
})

// Entry entities do not ride the root snapshot, so a membership-only shadow
// would leave a Session with ids it could never render. Its initial frame is
// the one exception: the ordered partition carries all facets and bodies.
Deno.test('entry shadows carry the lazy partition', alone, async () => {
  let session = uid(), entry = uid()
  let client = await subscriber()
  try {
    await post([{
      eid: session,
      name: 'session',
      comp: { id: `entry-shadow-${session}` },
    }, {
      eid: entry,
      name: 'entry',
      comp: { session },
    }, {
      eid: entry,
      name: 'message',
      comp: { role: 'agent' },
    }, {
      eid: entry,
      name: 'content',
      comp: { body: 'visible from the partition' },
    }])
    let sub = `entries:${session}`
    await client.shadow(sub, `.entry.session=${session}`)
    let carried = client.carried(sub).filter((c) => c.eid == entry)
    assertEquals(
      carried.map((c) => c.name).sort(),
      ['content', 'created', 'entity', 'entry', 'message'],
    )
    assertEquals(
      carried.find((c) => c.name == 'content')?.comp?.body,
      'visible from the partition',
    )
  } finally {
    client.close()
  }
})

Deno.test(
  'entry shadows carry lease and settlement updates',
  alone,
  async () => {
    let session = uid(), runner = uid(), input = uid(), generation = uid()
    let client = await subscriber()
    try {
      await post([{
        eid: session,
        name: 'session',
        comp: { id: `entry-updates-${session}` },
      }, {
        eid: runner,
        name: 'runner',
        comp: { name: `entry-updates-${runner}` },
      }])
      let made = append(
        db,
        session,
        [{
          message: { role: 'user' },
          content: { body: 'begin' },
        }, {
          generation: {
            through: input,
            provider: 'codex',
            model: 'gpt-requested',
          },
        }],
        runner,
        [input, generation],
      )
      maintain(made.changes)
      let sub = `entries:${session}`
      await client.shadow(sub, `.entry.session=${session}`)

      let won = takeEntry(db, generation, runner)!
      maintain(won.changes)
      let done = settleGeneration(
        db,
        won.token,
        { input: 3, cached: 1, output: 2, reasoning: 1 },
        () => new Date('2026-08-10T12:00:00.000Z'),
        'gpt-served',
      )
      maintain(done)
      await client.settle()

      let changes = client.carried(sub).filter((c) => c.eid == generation)
      assertEquals(
        changes.filter((c) => c.name == 'lease').map((c) => c.comp != null),
        [true, false],
      )
      assertEquals(changes.some((c) => c.name == 'delivered'), true)
      assertEquals(changes.some((c) => c.name == 'usage'), true)
      assertEquals(
        changes.some((c) =>
          c.name == 'generation' && c.comp?.serving_model == 'gpt-served'
        ),
        true,
      )
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

// `/query` answers from the INDEX when the filter compiles (sql.ts) and from a
// materialized snapshot when it declines, and a caller must not be able to
// tell which. sql_test.ts holds the two matchers against each other, but it
// sorts before it asserts — a subscription keeps a Set, so order is nothing to
// it. Through this door the answer is a JSON ARRAY, so order is part of it.
//
// LEVER is what forces the snapshot path: sql.ts refuses every time-typed
// column (spans are their own pass), so a `!=` on created.at compiles to
// nothing — while screening nothing either, since no entity was created on
// that day and one carrying no created.at at all still passes a `!=`. Asking
// the same line with and without it therefore asks the two paths the same
// question, over HTTP, with nothing mocked. `backlinks=1` was this lever
// until it stopped costing a snapshot (T-14166).
//
// It is a live-server test because the fast path only exists there: `where()`
// can hand back a statement SQLite refuses to PREPARE, which no pure test of
// the compiler sees. `.entity.num=` did exactly that — the spine joined to
// itself — and reached a caller as a 400 where an answer belonged.
let LEVER = '.created.at!=1999-01-01'
let bothWays = async (q: string) => {
  let one = await fetch(`http://${U}/query?${encodeURIComponent(q)}`)
  let two = await fetch(
    `http://${U}/query?${encodeURIComponent(q)}&${encodeURIComponent(LEVER)}`,
  )
  if (!one.ok) throw new Error(`fast path refused ${q}: ${await one.text()}`)
  if (!two.ok) throw new Error(`slow path refused ${q}: ${await two.text()}`)
  let ids = (hits: { entity: { eid: string } }[]) =>
    hits.map((r) => r.entity.eid)
  return [
    ids(await one.json()),
    ids(await two.json()),
  ]
}

Deno.test(
  'query: index and snapshot answer alike, order included',
  alone,
  async () => {
    let a = task({ status: 'open', priority: 1 })
    let b = task({ status: 'open', priority: 2 })
    await post([...a.born, ...b.born])
    let num = async (eid: string) =>
      ((await (await fetch(
        `http://${U}/query?${
          encodeURIComponent(`.doc.title~=${eid.slice(0, 8)}`)
        }`,
      ))
        .json()) as { entity: { num: number } }[])[0].entity.num
    for (
      let q of [
        '.task.status=open',
        '.task.priority=1',
        '.task.status=open&.task.priority=2',
        '.task.status!=done',
        `.doc.title~=${a.eid.slice(0, 8)}`,
        // the spine, which is the from table rather than a joined one
        `.entity.num=${await num(a.eid)}`,
        // and the shapes that must FALL BACK: a ranking, and a filter that
        // narrows nothing — neither may answer differently for it
        '.order=hot',
        '',
      ]
    ) {
      let [fast, slow] = await bothWays(q)
      assertEquals(fast, slow, `paths disagreed on: ${q || '(empty)'}`)
    }
  },
)

// `id=` is the door a lookup goes through — `task show T-3` and every
// find()/need() in the CLI, which today open with a whole-graph snapshot to
// resolve one name. It must speak all four forms locate() knows, and it must
// agree with the filter path it composes with: `id=` names the candidates,
// any remaining filter line screens them.
let byId = async (ids: string, extra = '') => {
  let res = await fetch(
    `http://${U}/query?${encodeURIComponent(`id=${ids}`)}${extra}`,
  )
  if (!res.ok) throw new Error(`id= refused ${ids}: ${await res.text()}`)
  return (await res.json() as { entity: { eid: string } }[])
    .map((r) => r.entity.eid)
}

Deno.test('query: id= fetches by every form a name takes', alone, async () => {
  let a = task({ status: 'open' })
  let b = task({ status: 'done' })
  await post([
    ...a.born,
    ...b.born,
    { eid: a.eid, name: 'alias', comp: { slug: `probe-${a.eid.slice(0, 8)}` } },
  ])
  let num = async (eid: string) =>
    ((await (await fetch(
      `http://${U}/query?${
        encodeURIComponent(`.doc.title~=${eid.slice(0, 8)}`)
      }`,
    )).json()) as { entity: { num: number } }[])[0].entity.num

  // a uuid, a bare num, the X-123 spelling, and an alias slug
  assertEquals(await byId(a.eid), [a.eid], 'by uuid')
  assertEquals(await byId(String(await num(a.eid))), [a.eid], 'by bare num')
  assertEquals(await byId(`T-${await num(a.eid)}`), [a.eid], 'by T-num')
  assertEquals(
    await byId(`probe-${a.eid.slice(0, 8)}`),
    [a.eid],
    'by alias slug',
  )

  // several at once, oldest first — and a name for nothing is absent, not an
  // error, so asking for one that died still answers about the others
  assertEquals(await byId(`${a.eid},${b.eid}`), [a.eid, b.eid], 'several')
  assertEquals(await byId(`${b.eid},${a.eid}`), [a.eid, b.eid], 'order is num')
  assertEquals(await byId(`${a.eid},no-such-name`), [a.eid], 'unknown absent')
  assertEquals(await byId('no-such-name'), [], 'all unknown')

  // a remaining filter line SCREENS the named set rather than being ignored
  assertEquals(
    await byId(
      `${a.eid},${b.eid}`,
      `&${encodeURIComponent('.task.status=open')}`,
    ),
    [a.eid],
    'filters screen the named set',
  )

  // the layers ride the same set, whichever of them a caller asked for
  assertEquals(
    await byId(`${a.eid},${b.eid}`, '&backlinks=1&deps=1'),
    [a.eid, b.eid],
    'same set with the edge layers on',
  )

  // A dead entity is named and rightly absent — and it is locate() that makes
  // it so, not a guard downstream: the spine row is gone, so the name resolves
  // to nothing and never reaches the fetch. Asserted here because that is the
  // behaviour a caller depends on, whichever half of the door delivers it.
  await post([{ eid: b.eid, name: 'entity', comp: null }])
  assertEquals(await byId(`${a.eid},${b.eid}`), [a.eid], 'tombstone absent')
})

Deno.test(
  'query and subscriptions require an explicit quarantine read',
  alone,
  async () => {
    let a = task({ status: 'open' })
    let q = `.doc.title~=${a.eid.slice(0, 8)}`
    await post(a.born)
    let client = await subscriber()
    let ordinary = `ordinary:${a.eid}`, explicit = `explicit:${a.eid}`
    try {
      await client.open(ordinary, q)
      await client.open(explicit, `${q}&.quarantined!`)
      assertEquals(client.members(ordinary), [a.eid])
      assertEquals(client.members(explicit), [])

      await post([{ eid: a.eid, name: 'quarantined', comp: {} }])
      await client.settle()
      assertEquals(await queried(q), [])
      assertEquals(await queried(`${q}&.quarantined!`), [a.eid])
      assertEquals(client.members(ordinary), [])
      assertEquals(client.members(explicit), [a.eid])
      assertEquals(await byId(a.eid), [])
      assertEquals(await byId(a.eid, '&quarantined=1'), [a.eid])
    } finally {
      client.close()
    }
  },
)

// `deps=1` is the only door outside /snapshot that carries an entity's OWN
// edges — `task show` prints its requires:/referenced by: blocks out of them,
// and could not be narrowed without it. It reads the edge table keyed by the
// hits, where /snapshot returns every edge in the graph; so what it says about
// one entity must be edge for edge what the graph-out door says.
//
// Derived `reads` are the half that would go missing quietly: home is the
// one truth, so snapshot() computes a project→persona edge on its way OUT
// rather than storing it, and a narrow door reading only the `dependency`
// table drops it with nothing to see anywhere.
type Dep = { parent: string; type: string; child: string }
let sentences = (deps: Dep[], eid: string) =>
  deps.filter((d) => d.parent == eid || d.child == eid)
    .map((d) => `${d.parent} ${d.type} ${d.child}`).sort()

let bothEdges = async (eid: string) => {
  let hits = await (await fetch(`http://${U}/query?id=${eid}&deps=1`))
    .json() as { deps: Dep[] }[]
  let snap = await (await fetch(`http://${U}/snapshot`))
    .json() as { deps: Dep[] }
  return [sentences(hits[0].deps, eid), sentences(snap.deps, eid)]
}

Deno.test(
  'query: deps= reports the edges /snapshot reports, derived reads included',
  alone,
  async () => {
    let a = task({ status: 'open' })
    let b = task({ status: 'open' })
    let proj = uid(), common = uid(), spec = uid()
    await post([
      ...a.born,
      ...b.born,
      { eid: proj, name: 'doc', comp: { title: 'probe venture' } },
      { eid: proj, name: 'project', comp: {} },
      { eid: common, name: 'doc', comp: { title: 'probe common' } },
      { eid: common, name: 'persona', comp: { home: proj } },
      { eid: spec, name: 'doc', comp: { title: 'probe specialist' } },
      { eid: spec, name: 'persona', comp: { home: proj } },
      {
        eid: a.eid,
        name: 'dependency',
        comp: { type: 'requires', child: b.eid },
      },
      {
        eid: proj,
        name: 'dependency',
        comp: { type: 'contains', child: common },
      },
    ])
    for (let eid of [a.eid, b.eid, proj, common, spec]) {
      let [door, snap] = await bothEdges(eid)
      assertEquals(door, snap, `deps disagreed about ${eid}`)
    }
    // Stated outright, or the comparison above passes on two empty lists: the
    // stored edge both ways round, and the specialist's derived one — while
    // the common persona rides its `contains` and derives nothing on top.
    assertEquals((await bothEdges(a.eid))[0], [`${a.eid} requires ${b.eid}`])
    assertEquals((await bothEdges(b.eid))[0], [`${a.eid} requires ${b.eid}`])
    assertEquals((await bothEdges(spec))[0], [`${proj} reads ${spec}`])
    assertEquals((await bothEdges(common))[0], [`${proj} contains ${common}`])

    // and a backlink is a backlink whatever made the edge: the derived one
    // names its project the same way the stored one does.
    let backs = async (eid: string) =>
      ((await (await fetch(`http://${U}/query?id=${eid}&backlinks=1`))
        .json()) as { backlinks: { from: string; via: string }[] }[])[0]
        .backlinks.map((b) => b.via).sort()
    assertEquals(await backs(spec), ['reads'])
    assertEquals(await backs(common), ['contains'])
    // the project is pointed at by both personas' home column
    assertEquals(await backs(proj), ['persona.home', 'persona.home'])
  },
)
