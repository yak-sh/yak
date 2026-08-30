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

import { assertEquals, assertStringIncludes } from '@std/assert'
import { slow } from './testing.ts'

Deno.env.set('DB_PATH', ':memory:')
let { db } = await import('./live_db.ts')
let { append, settleGeneration, takeEntry } = await import('./entries.ts')

// The server serves on import — the one heavy boot in this file. Every test
// here is slow(), so the fast run (which ignores them all) must not pay that
// boot, nor claim a socket a parallel worker would collide on. Bind the server
// and its port only under the heavy tier: claim an ephemeral port and give the
// seat back before the server takes it — a fixed port collides on a shared box.
let U = ''
let aged!: typeof import('./server.ts').aged
let broadcastObservation!: typeof import('./server.ts').broadcastObservation
let maintain!: typeof import('./server.ts').maintain
let retiredDataDoors!: typeof import('./server.ts').retiredDataDoors
if (Deno.env.get('TASKS_SLOW')) {
  let seat = Deno.listen({ hostname: '127.0.0.1', port: 0 })
  let port = (seat.addr as Deno.NetAddr).port
  seat.close()
  Deno.env.set('PORT', String(port))
  ;({ aged, broadcastObservation, maintain, retiredDataDoors } = await import(
    './server.ts'
  ))
  U = `127.0.0.1:${port}`
}
let uid = () => crypto.randomUUID()
let alone = { sanitizeOps: false, sanitizeResources: false }

type Comp = Record<string, unknown> | null
type Change = { eid: string; name: string; comp: Comp }
type Frame = {
  sub?: string
  changes?: Change[]
  drop?: string[]
  replace?: boolean
  observe?: {
    session: string
    generation: string
    kind: string
    text?: string
  }
  cursor?: number
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

slow(
  'API doors enforce methods instead of serving the SPA',
  alone,
  async () => {
    for (
      let [path, method, allow] of [
        ['/query', 'POST', 'GET'],
        ['/apply', 'GET', 'POST'],
      ]
    ) {
      let res = await fetch(`http://${U}${path}`, { method })
      assertEquals(res.status, 405, `${method} ${path}`)
      assertEquals(res.headers.get('allow'), allow, `${method} ${path} allow`)
      assertEquals(
        res.headers.get('content-type')?.includes('text/html'),
        false,
      )
    }
  },
)

slow(
  'retired graph-data doors are 404s for every method, never SPA routes',
  alone,
  async () => {
    for (let path of retiredDataDoors) {
      for (let method of ['GET', 'POST', 'HEAD']) {
        let res = await fetch(`http://${U}${path}`, { method })
        assertEquals(res.status, 404, `${method} ${path}`)
        assertEquals(
          res.headers.get('content-type')?.includes('text/html'),
          false,
        )
      }
    }
  },
)

slow(
  'text /query decorates rows with rank but /apply cannot persist it',
  alone,
  async () => {
    let eid = uid(), word = `xylophone-${eid.slice(0, 8)}`
    await post([{ eid, name: 'doc', comp: { title: word, body: 'music' } }])
    let found = await fetch(`http://${U}/query?${encodeURIComponent(word)}`)
    assertEquals(found.status, 200)
    let [hit] = await found.json() as {
      entity: { eid: string }
      doc: { title: string }
      rank: { open: string; title_hit: string }
    }[]
    assertEquals(hit.entity.eid, eid)
    assertEquals(hit.doc.title, word)
    assertEquals(hit.rank.open, eid)
    assertEquals(hit.rank.title_hit.includes('\x01'), true)

    await post([{ eid, name: 'rank', comp: { open: 'forged' } }])
    let plain = await (await fetch(`http://${U}/query?id=${eid}`))
      .json() as Record<string, unknown>[]
    assertEquals(plain[0].rank, undefined)
  },
)

slow(
  'query projects canonical Session nulls over stale aliases',
  alone,
  async () => {
    let eid = uid()
    await post([{
      eid,
      name: 'session',
      comp: { id: uid(), cwd: '/canonical' },
    }])
    db.prepare(
      "update session set cwd = '/stale' where entity = (select id from entity where eid = ?)",
    ).run(eid)
    db.prepare(
      'update worktree set cwd = null where entity = (select id from entity where eid = ?)',
    ).run(eid)
    try {
      let res = await fetch(`http://${U}/query?id=${eid}`)
      if (!res.ok) throw new Error(`query refused: ${await res.text()}`)
      let [hit] = await res.json() as {
        session: { cwd: string | null }
      }[]
      assertEquals(hit.session.cwd, null)
    } finally {
      await post([{ eid, name: 'entity', comp: null }])
    }
  },
)

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
  let projected = new Map<string, Record<string, Record<string, unknown>>>()
  let frames = new Map<string, number>()
  let observations: NonNullable<Frame['observe']>[] = []
  let waiting = new Map<string, () => void>()
  socket.onmessage = (m) => {
    let f = JSON.parse(String(m.data)) as Frame
    if (f.observe) {
      observations.push(f.observe)
      return
    }
    if (!f || typeof f.sub != 'string') return
    frames.set(f.sub, (frames.get(f.sub) ?? 0) + 1)
    let mine = f.replace ? new Set<string>() : sets.get(f.sub) ?? new Set()
    sets.set(f.sub, mine)
    seen.set(f.sub, [
      ...(f.replace ? [] : seen.get(f.sub) ?? []),
      ...(f.changes ?? []),
    ])
    for (let c of f.changes ?? []) {
      if (c.name == 'entity' && c.comp == null) mine.delete(c.eid)
      else mine.add(c.eid)
    }
    for (let eid of f.drop ?? []) mine.delete(eid)
    let values = f.replace ? {} : { ...(projected.get(f.sub) ?? {}) }
    for (let c of f.changes ?? []) {
      if (c.name != 'materialized') continue
      let row = { ...values[c.eid] }
      c.comp == null ? delete row[c.name] : row[c.name] = c.comp
      Object.keys(row).length ? values[c.eid] = row : delete values[c.eid]
    }
    projected.set(f.sub, values)
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
    result: (sub: string) => projected.get(sub) ?? {},
    frames: (sub: string) => frames.get(sub) ?? 0,
    // Every enqueued maintain frame is already on the wire ahead of this
    // subscribe's reply, so awaiting the reply awaits them all. The query must
    // PARSE (a bad one is caught server-side and never answered) and match
    // nothing, so the barrier costs one empty frame.
    settle: () => {
      let sub = `barrier:${++n}`
      return reply(sub, { sub, q: '.doc.title~=__barrier_matches_nothing__' })
    },
    members: (sub: string) => [...(sets.get(sub) ?? [])].sort(),
    observations: () => [...observations],
    close: () => socket.close(),
  }
}

slow(
  'materialized component agrees across HTTP and WS and invalidates by dependency',
  alone,
  async () => {
    let project = uid(), persona = uid(), tier = uid(), loose = uid()
    await post([
      { eid: project, name: 'doc', comp: { title: 'Project' } },
      { eid: project, name: 'project', comp: {} },
      { eid: persona, name: 'doc', comp: { title: 'Operator' } },
      { eid: persona, name: 'persona', comp: { home: project } },
      { eid: tier, name: 'doc', comp: { title: 'Rule', body: 'first body' } },
      { eid: tier, name: 'memory', comp: { scope: project } },
      { eid: loose, name: 'doc', comp: { title: 'Loose' } },
      { eid: loose, name: 'memory', comp: { scope: project } },
      {
        eid: persona,
        name: 'dependency',
        comp: { type: 'contains', child: tier },
      },
    ])
    let q = `id=${persona}&.materialized!`
    let http = async () => {
      let wire = q.split('&').map(encodeURIComponent).join('&')
      let res = await fetch(`http://${U}/query?${wire}`)
      assertEquals(res.status, 200)
      let [hit] = await res.json() as {
        materialized: { text: string; scoped: string[] }
      }[]
      return hit.materialized
    }
    let client = await subscriber()
    let sub = `persona:${persona}`
    try {
      let unknown = await fetch(
        `http://${U}/query?id=${persona}&${
          encodeURIComponent('.derive=persona')
        }`,
      )
      assertEquals(unknown.status, 400)
      assertStringIncludes(await unknown.text(), 'unknown prop')

      await client.open(sub, q)
      assertEquals(client.result(sub)[persona].materialized, await http())

      let before = client.frames(sub)
      await post([{
        eid: uid(),
        name: 'doc',
        comp: { title: 'unrelated' },
      }])
      await client.settle()
      assertEquals(client.frames(sub), before)

      await post([{
        eid: tier,
        name: 'doc',
        comp: { body: 'second body' },
      }])
      await client.settle()
      let after = client.result(sub)[persona].materialized as {
        text: string
        scoped: string[]
      }
      assertStringIncludes(after.text, 'second body')
      assertEquals(after, await http())
      assertEquals(new Set(after.scoped), new Set([tier, loose]))
    } finally {
      client.close()
    }
  },
)

slow(
  'Session observations reach only partition watchers and write no graph',
  alone,
  async () => {
    let session = uid(), generation = uid()
    let watching = await subscriber(), elsewhere = await subscriber()
    try {
      await watching.open(`entries:${session}`, `.entry.session=${session}`)
      await elsewhere.open('entries:elsewhere', `.entry.session=${uid()}`)
      let before = db.prepare('select count(*) n from journal').get() as {
        n: number
      }
      assertEquals(
        broadcastObservation({
          session,
          generation,
          kind: 'model',
          text: 'x'.repeat(3000),
        }),
        1,
      )
      // A reply on each socket is an ordering barrier after the transient send.
      await watching.settle()
      await elsewhere.settle()
      assertEquals(watching.observations(), [{
        session,
        generation,
        kind: 'model',
        text: 'x'.repeat(2048),
      }])
      assertEquals(elsewhere.observations(), [])
      assertEquals(
        db.prepare('select count(*) n from journal').get(),
        before,
      )
      assertEquals(
        JSON.stringify(watching.observations()).includes('cursor'),
        false,
      )
    } finally {
      watching.close()
      elsewhere.close()
    }
  },
)

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
  let eid = uid(), session = uid()
  let { status = 'done', ...stored } = comp
  return {
    eid,
    session,
    born: [
      { eid, name: 'doc', comp: { title: `probe ${eid.slice(0, 8)}` } },
      { eid, name: 'task', comp: { priority: 3, ...stored } },
      { eid: session, name: 'session', comp: { id: `sub-${session}` } },
      ...(status == 'done'
        ? [{ eid, name: 'completed', comp: {} }]
        : status == 'cancelled'
        ? [{ eid, name: 'cancelled', comp: {} }]
        : status == 'wip'
        ? [{ eid, name: 'claim', comp: { session } }]
        : []),
    ] as Change[],
  }
}

slow(
  'subscription: equality pred through add/update/remove/dead',
  alone,
  async () => {
    let a = task({})
    let q = `.task.status=open&.doc.title~=${a.eid.slice(0, 8)}`
    await walk(q, [
      a.born, // exists, does not match
      [{ eid: a.eid, name: 'completed', comp: null }], // add
      [{ eid: a.eid, name: 'task', comp: { priority: 0 } }], // update, still in
      [{ eid: a.eid, name: 'completed', comp: {} }], // remove
      [{ eid: a.eid, name: 'completed', comp: null }], // add again
      [{ eid: a.eid, name: 'entity', comp: null }], // dead
    ])
  },
)

slow(
  'subscription: list pred keeps a member moving within the list',
  alone,
  async () => {
    let a = task({})
    let q = `.task.status=open,wip&.doc.title~=${a.eid.slice(0, 8)}`
    await walk(q, [
      a.born,
      [{ eid: a.eid, name: 'completed', comp: null }], // add
      [{ eid: a.eid, name: 'claim', comp: { session: a.session } }], // still in
      [{ eid: a.eid, name: 'completed', comp: {} }], // out
    ])
  },
)

slow(
  'subscription: a one-hop path follows far-side edits and death',
  alone,
  async () => {
    let source = uid(), assignee = uid(), mark = `path-${uid().slice(0, 8)}`
    let q = `.task.assignee.doc.title~=${mark}&.doc.title~=${
      source.slice(0, 8)
    }`
    await walk(q, [
      [
        { eid: assignee, name: 'doc', comp: { title: 'elsewhere' } },
        { eid: assignee, name: 'person', comp: {} },
        {
          eid: source,
          name: 'doc',
          comp: { title: `source ${source.slice(0, 8)}` },
        },
        {
          eid: source,
          name: 'task',
          comp: { priority: 1, assignee },
        },
      ],
      [{ eid: assignee, name: 'doc', comp: { title: mark } }], // add
      [{ eid: assignee, name: 'doc', comp: { title: 'elsewhere' } }], // drop
      [{ eid: assignee, name: 'doc', comp: { title: mark } }], // add
      [{ eid: assignee, name: 'entity', comp: null }], // detach + drop
    ])
  },
)

slow(
  'subscription: an N-hop path follows leaf edits and an intermediate retarget',
  alone,
  async () => {
    let source = uid(), target = uid(), left = uid(), right = uid()
    let mark = `path-${uid().slice(0, 8)}`
    let q = `.comment.target.task.project.doc.title~=${mark}&.doc.title~=${
      source.slice(0, 8)
    }`
    await walk(q, [
      [
        { eid: left, name: 'doc', comp: { title: 'left' } },
        { eid: left, name: 'project', comp: {} },
        { eid: right, name: 'doc', comp: { title: 'right' } },
        { eid: right, name: 'project', comp: {} },
        { eid: target, name: 'doc', comp: { title: 'target' } },
        {
          eid: target,
          name: 'task',
          comp: { priority: 1, project: left },
        },
        {
          eid: source,
          name: 'doc',
          comp: { title: `source ${source.slice(0, 8)}` },
        },
        { eid: source, name: 'comment', comp: { target } },
      ],
      [{ eid: left, name: 'doc', comp: { title: mark } }], // add from leaf
      [{ eid: target, name: 'task', comp: { project: right } }], // retarget + drop
      [{ eid: right, name: 'doc', comp: { title: mark } }], // add from new leaf
      [{ eid: target, name: 'task', comp: { project: null } }], // clear + drop
      [{ eid: target, name: 'task', comp: { project: right } }], // restore + add
      [{ eid: right, name: 'entity', comp: null }], // detach + drop
    ])
  },
)

slow('subscription: range and comparison preds', alone, async () => {
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

slow('subscription: negation and contains preds', alone, async () => {
  let a = task({})
  let tag = a.eid.slice(0, 8)
  await walk(`.task.status!=done&.doc.title~=${tag}`, [
    a.born, // done — out
    [{ eid: a.eid, name: 'completed', comp: null }], // in
    [{ eid: a.eid, name: 'completed', comp: {} }], // out
  ])
  await walk(`.doc.title~=${tag}`, [
    [{ eid: a.eid, name: 'doc', comp: { title: 'renamed away' } }], // out
    [{ eid: a.eid, name: 'doc', comp: { title: `back ${tag}` } }], // in
  ])
})

// `.prop=` with an empty value means ABSENT, so clearing a column is an ADD and
// setting one is a REMOVE — the transition table run backwards, and the one
// class where a patch that omits the column must leave membership alone.
slow(
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

slow(
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
slow(
  'subscription: deleting the component drops the member',
  alone,
  async () => {
    let a = task({})
    let tag = a.eid.slice(0, 8)
    await walk(`.task.status!=done&.doc.title~=${tag}`, [
      a.born,
      [{ eid: a.eid, name: 'completed', comp: null }], // in
      [{ eid: a.eid, name: 'task', comp: null }], // component gone
    ])
  },
)

// Two subscriptions on ONE socket must not share a member set: the same write
// lands in whichever of them it belongs to, and the frames are keyed by sub id.
slow(
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
      await post([{ eid: a.eid, name: 'completed', comp: null }])
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
// doors that answer "give me this body" are the `card:` subscription and an
// addressed doc.body projection (what a client asks when it holds a doc it
// was shipped no body for). A placeholder that neither could end would be
// permanent, so this walks all three in one sentence.
slow('bodies ride only where a body is read', alone, async () => {
  let a = task({})
  let q = `.doc.title~=${a.eid.slice(0, 8)}`
  let board = `board:${uid()}`
  let card = `card:${a.eid}`
  let client = await subscriber()
  let part = (sub: string, name: string) =>
    client.carried(sub).filter((c) => c.eid == a.eid && c.name == name)
      .map((c) => c.comp!)
  try {
    await post([
      ...a.born,
      { eid: a.eid, name: 'doc', comp: { body: 'the stored body' } },
      { eid: a.eid, name: 'accept', comp: { body: 'the acceptance body' } },
    ])
    await client.open(board, q)
    await client.open(card, q)
    assertEquals(part(board, 'doc').map((c) => 'body' in c), [false])
    assertEquals(part(board, 'accept'), [{ eid: a.eid }])
    assertEquals(part(card, 'doc').map((c) => c.body), ['the stored body'])
    assertEquals(part(card, 'accept').map((c) => c.body), [
      'the acceptance body',
    ])
    // The title still rides on both: it is the shape, not the body.
    assertEquals(part(board, 'doc').map((c) => 'title' in c), [true])

    // A body EDIT is likewise the card's news and nothing to the board.
    await post([{ eid: a.eid, name: 'doc', comp: { body: 'a later body' } }])
    await client.settle()
    assertEquals(
      part(board, 'doc').length,
      1,
      'no second doc change for the board',
    )
    assertEquals(part(card, 'doc').map((c) => c.body), [
      'the stored body',
      'a later body',
    ])

    // And the transient form for a body nobody kept: an addressed projection,
    // through the same subscription protocol and patch shape.
    let want = `want:${a.eid}`
    await client.open(want, `id=${a.eid}&.fields=doc.body`)
    assertEquals(part(want, 'doc').map((c) => c.body), ['a later body'])
    let accept = `accept:${a.eid}`
    await client.open(accept, `id=${a.eid}&.fields=accept.body`)
    assertEquals(part(accept, 'accept').map((c) => c.body), [
      'the acceptance body',
    ])
  } finally {
    client.close()
  }
})

slow(
  'a projected derived status wakes on lifecycle changes',
  alone,
  async () => {
    let a = task({ status: 'open' })
    let sub = `status:${a.eid}`
    let client = await subscriber()
    let statuses = () =>
      client.carried(sub).filter((c) => c.eid == a.eid && c.name == 'task')
        .map((c) => c.comp?.status).filter(Boolean)
    try {
      await post(a.born)
      await client.open(sub, `id=${a.eid}&.fields=task.status`)
      assertEquals(statuses(), ['open'])
      await post([{ eid: a.eid, name: 'completed', comp: {} }])
      await client.settle()
      assertEquals(statuses(), ['open', 'done'])
    } finally {
      client.close()
    }
  },
)

// The Session /logs door is RETIRED (T-16798): every reader now reads the graph
// entry partition, and the file-backed `/sessions/:eid/logs` route is gone —
// absent, not deprecated (T-16825 acceptance). An extensionless path is a SPA
// ROUTE now (server.ts serves index.html), so the old door answers with the app
// shell, never a JSON log payload. If a reader ever reintroduced the route this
// would parse JSON instead of finding the app title, and fail here.
slow(
  'the retired /logs door serves the SPA, not a log payload',
  alone,
  async () => {
    let session = uid()
    await post([{
      eid: session,
      name: 'session',
      comp: { id: `logs-gone-${session}` },
    }])
    let res = await fetch(`http://${U}/sessions/${session}/logs`)
    assertEquals(res.status, 200)
    let body = await res.text()
    // The app shell, not a log door: the SPA title is present…
    assertStringIncludes(body, '<title>Tasks</title>')
    // …and the response is not a JSON array of log rows.
    let parsed: unknown = undefined
    try {
      parsed = JSON.parse(body)
    } catch { /* html body is not JSON — the point */ }
    assertEquals(Array.isArray(parsed), false)
  },
)

// Entry entities do not ride the root snapshot, so a membership-only shadow
// would leave a Session with ids it could never render. Its initial frame is
// the one exception: the ordered partition carries all facets and bodies.
slow('entry shadows carry the lazy partition', alone, async () => {
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
    // The root /query REACHES the partition when the query names it —
    // the whole point of T-16847; the empty root of old was the bug that made
    // graph_query answer `.entry.session=X` with [] over hundreds of entries.
    let root = await fetch(
      `http://${U}/query?${encodeURIComponent(`.entry.session=${session}`)}`,
    )
    assertEquals(root.ok, true)
    let hits = await root.json() as { entry?: { session: string } }[]
    assertEquals(hits.map((h) => h.entry?.session), [session])
  } finally {
    client.close()
  }
})

slow(
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
slow(
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
slow(
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

slow(
  'query: index and snapshot answer alike, order included',
  alone,
  async () => {
    let a = task({ priority: 1 })
    let b = task({ priority: 2 })
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
        // the shape that must FALL BACK: a ranking narrows nothing, so it
        // selects EVERY entity and may not answer differently for it
        '.order=hot',
      ]
    ) {
      let [fast, slow] = await bothWays(q)
      assertEquals(fast, slow, `paths disagreed on: ${q || '(empty)'}`)
    }
    // The empty query is the one shape bothWays cannot probe. It selects
    // NOTHING (the never-pred, 4b42e1c) — the opposite of a ranking, which
    // selects everything — and its emptiness is a property of the whole
    // STRING, not a pred in it. Appending the LEVER doesn't force that same
    // question down the snapshot path; it makes a DIFFERENT, non-empty query
    // (`.created.at!=…` alone, which matches everything). So pin the ruling
    // directly: the index door — the only door the empty query ever reaches,
    // since evalGraph answers it whole and never falls back — returns the
    // empty set.
    let empty = await fetch(`http://${U}/query?`)
    if (!empty.ok) throw new Error(`empty query refused: ${await empty.text()}`)
    assertEquals(await empty.json(), [], 'empty query selects nothing')
  },
)

slow('query: work lanes refuse quarantine reveal filters', alone, async () => {
  for (let lane of ['evaluate', 'build']) {
    for (let filter of ['.quarantined!', '.task.project.quarantined!']) {
      let res = await fetch(
        `http://${U}/query?work=${lane}&${encodeURIComponent(filter)}`,
      )
      assertEquals(res.status, 400)
      assertStringIncludes(
        await res.text(),
        'work filters never reveal quarantined entities',
      )
    }
  }
})

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

slow('query: id= fetches by every form a name takes', alone, async () => {
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

slow(
  'query and subscriptions require an explicit quarantine read',
  alone,
  async () => {
    let a = task({})
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

// `deps=1` is the door that carries an entity's OWN edges — `task show` prints
// its requires:/referenced by: blocks out of them. It reads the edge table
// keyed by the hits, and must report the stored edges AND the derived ones.
//
// Derived `reads` are the half that would go missing quietly: home is the
// one truth, so snapshot() computes a project→persona edge on its way out
// rather than storing it, and a narrow door reading only the `dependency`
// table would drop it — deps=1 has to surface it the same way.
type Dep = { parent: string; type: string; child: string }
let sentences = (deps: Dep[], eid: string) =>
  deps.filter((d) => d.parent == eid || d.child == eid)
    .map((d) => `${d.parent} ${d.type} ${d.child}`).sort()

let edgesOf = async (eid: string) => {
  let hits = await (await fetch(`http://${U}/query?id=${eid}&deps=1`))
    .json() as { deps: Dep[] }[]
  return sentences(hits[0].deps, eid)
}

slow(
  'query: deps= reports stored and derived edges',
  alone,
  async () => {
    let a = task({})
    let b = task({})
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
    // The stored edge both ways round, and the specialist's derived one — while
    // the common persona rides its `contains` and derives nothing on top.
    assertEquals(await edgesOf(a.eid), [`${a.eid} requires ${b.eid}`])
    assertEquals(await edgesOf(b.eid), [`${a.eid} requires ${b.eid}`])
    assertEquals(await edgesOf(spec), [`${proj} reads ${spec}`])
    assertEquals(await edgesOf(common), [`${proj} contains ${common}`])

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

// A ROUTE sub names one entity by id in its own name (`route:<eid>`) — the
// fullscreen root a partial-cache client reaches by direct URL, which no
// defining set holds and the query grammar can't name. It must load the entity
// WHOLE (bodies included, unlike a board's spine), update it live, add it if it
// is minted after the subscribe, and drop it on death.
slow(
  'a route sub loads one entity whole, updates it live, dies with it',
  alone,
  async () => {
    let eid = uid()
    await post([
      {
        eid,
        name: 'doc',
        comp: { title: 'route target', body: 'the whole body' },
      },
      { eid, name: 'task', comp: { priority: 1 } },
    ])
    let s = await subscriber()
    try {
      await s.open(`route:${eid}`, '')
      assertEquals(s.members(`route:${eid}`), [eid])
      // Bodied: the initial frame carries the doc body, not just the spine.
      let names = s.carried(`route:${eid}`).map((c) => c.name).sort()
      assertEquals(names.includes('doc'), true)
      assertEquals(names.includes('task'), true)
      let doc = s.carried(`route:${eid}`).find((c) => c.name == 'doc')
      assertEquals((doc!.comp as { body?: string }).body, 'the whole body')

      // A live update streams a standing-match frame (details), even though the
      // sub is not a query.
      await post([{ eid, name: 'completed', comp: {} }])
      await s.settle()
      let completed = s.carried(`route:${eid}`).find((c) =>
        c.name == 'completed'
      )
      assertEquals(completed?.eid, eid)

      // Death drops it from the set.
      await post([{ eid, name: 'entity', comp: null }])
      await s.settle()
      assertEquals(s.members(`route:${eid}`), [])
    } finally {
      s.close()
    }
  },
)

// A route sub opened BEFORE its target exists starts empty and ADDs the entity
// when it is minted — the direct-URL race where navigation resolves the id
// before the row is in the cache.
slow(
  'a route sub adds its target when it is minted after subscribe',
  alone,
  async () => {
    let eid = uid()
    let s = await subscriber()
    try {
      await s.open(`route:${eid}`, '')
      assertEquals(s.members(`route:${eid}`), [])
      await post([{ eid, name: 'doc', comp: { title: 'born late', body: '' } }])
      await s.settle()
      assertEquals(s.members(`route:${eid}`), [eid])
    } finally {
      s.close()
      await post([{ eid, name: 'entity', comp: null }])
    }
  },
)
