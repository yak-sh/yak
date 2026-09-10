import { assert, assertEquals, assertThrows } from '@std/assert'
import { type Bundle, token } from '@yaks/graph'
import { Bounced as LeaseBounced } from '@yaks/session'
import { apply, Bounced, fleetGraphOf, human, readComp, Stale } from '../db.ts'
import { bareDb } from '../testdb.ts'
import type { Change } from '../types.ts'
import { sha } from '../sha.ts'
import { sync } from './fleet_preconditions.ts'
import type { Sql } from './sql.ts'

let [
  p,
  t,
  s,
  other,
  newWorker,
  stopRequest,
  generation,
  attention,
  board,
  blob,
  loose,
  comment,
  redaction,
  memory,
  entry,
] = Array.from({ length: 15 }, () => crypto.randomUUID())

let rows = (db: Sql, table: string) =>
  db.prepare(`select * from ${table}`).all()
let seed = (db: Sql) =>
  apply(db, [
    { eid: p, name: 'project', comp: {} },
    {
      eid: t,
      name: 'task',
      comp: {},
    },
    {
      eid: t,
      name: 'filed',
      comp: { project: p },
    },
    {
      eid: t,
      name: 'doc',
      comp: { title: 'Work', body: 'held text' },
    },
    {
      eid: s,
      name: 'session',
      comp: { id: 'holder' },
    },
    {
      eid: other,
      name: 'session',
      comp: { id: 'loser' },
    },
  ])

// Fixed live-door goldens. The handle and apply now share this same engine.
let write = (db: Sql, changes: Change[], target?: string, actor?: string) =>
  apply(
    db,
    changes,
    undefined,
    actor,
    undefined,
    target ? { target } : undefined,
    true,
  )

Deno.test(`fleet guards: lease collision rolls back body and audits outside outer tx`, () => {
  let db = bareDb()
  seed(db)
  write(db, [{
    eid: t,
    name: 'claim',
    comp: { session: s },
  }])
  let time = readComp(db, t, 'claim')
    ?.claimed_at
  let err = assertThrows(
    () =>
      write(db, [
        {
          eid: t,
          name: 'doc',
          comp: { body: 'rolled back' },
        },
        {
          eid: t,
          name: 'claim',
          comp: { session: other },
        },
      ]),
    Bounced,
    `${human(db, t)} already claimed by holder`,
  )
  assert(err instanceof LeaseBounced)
  assertEquals([err.target, err.loser, err.holder], [
    t,
    other,
    s,
  ])
  assertEquals(
    readComp(db, t, 'doc')?.body,
    'held text',
  )
  assertEquals(rows(db, 'conflict').length, 1)
  let conflict = sync(fleetGraphOf(db).read('.conflict!'))[0]
    .conflict as Record<string, unknown>
  assertEquals([conflict.target, conflict.loser, conflict.holder], [
    t,
    other,
    s,
  ])
  write(db, [{
    eid: t,
    name: 'claim',
    comp: { session: s },
  }])
  assertEquals(
    readComp(db, t, 'claim')?.claimed_at,
    time,
  )
  assertEquals(rows(db, 'conflict').length, 1)
  // One batch may explicitly release and hand the lease over.
  write(db, [
    {
      eid: t,
      name: 'claim',
      comp: null,
    },
    {
      eid: t,
      name: 'claim',
      comp: { session: other },
    },
  ])
  assertEquals(
    readComp(db, t, 'claim')?.session,
    other,
  )
})

Deno.test(`fleet guards: a loser born in a refused batch leaves no phantom session`, () => {
  let db = bareDb()
  seed(db)
  write(db, [{
    eid: t,
    name: 'claim',
    comp: { session: s },
  }])
  assertThrows(() =>
    write(db, [
      {
        eid: newWorker,
        name: 'session',
        comp: { id: 'new worker' },
      },
      {
        eid: t,
        name: 'claim',
        comp: { session: newWorker },
      },
    ]), Bounced)
  assertEquals(
    readComp(db, newWorker, 'session'),
    undefined,
  )
  let conflict = sync(fleetGraphOf(db).read('.conflict!'))[0]
    .conflict as Record<string, unknown>
  assertEquals(conflict.loser, null)
  assertEquals(
    db.prepare('select 1 from entity where eid = ?').get(
      newWorker,
    ),
    undefined,
  )
})

Deno.test(`fleet guards: named readiness sees approval before claim, never after`, () => {
  let db = bareDb()
  seed(db)
  write(db, [{
    eid: t,
    name: 'proposed',
    comp: {},
  }])
  assertThrows(
    () =>
      write(db, [
        {
          eid: t,
          name: 'claim',
          comp: { session: s },
        },
        {
          eid: t,
          name: 'decided',
          comp: { verdict: 'approved' },
        },
      ], t),
    Error,
    'proposed but not decided',
  )
  assertEquals(
    readComp(db, t, 'decided'),
    undefined,
  )
  write(db, [
    {
      eid: t,
      name: 'decided',
      comp: { verdict: 'approved' },
    },
    {
      eid: t,
      name: 'claim',
      comp: { session: s },
    },
  ], t)
  // A same-holder replay remains idempotent despite now deriving wip.
  write(db, [{
    eid: t,
    name: 'claim',
    comp: { session: s },
  }], t)
  assertEquals(
    readComp(db, t, 'claim')?.session,
    s,
  )
})

Deno.test(`fleet guards: ordered alias members, duplicates, release and rollback`, () => {
  let db = bareDb()
  seed(db)
  write(db, [{
    eid: t,
    name: 'alias',
    comp: { slug: 'main', slugs: 'one\ttwo\nthree' },
  }])
  assertThrows(
    () =>
      write(db, [{
        eid: p,
        name: 'alias',
        comp: { slug: 'two' },
      }]),
    Error,
    'alias two already names',
  )
  assertThrows(
    () =>
      write(db, [{
        eid: t,
        name: 'alias',
        comp: { slugs: 'main' },
      }]),
    Error,
    'alias main is listed twice',
  )
  assertThrows(
    () =>
      write(db, [
        {
          eid: t,
          name: 'alias',
          comp: { slugs: 'fresh' },
        },
        {
          eid: p,
          name: 'alias',
          comp: { slug: 'fresh' },
        },
      ]),
    Error,
    'alias fresh already names',
  )
  assertEquals(
    readComp(db, p, 'alias'),
    undefined,
  )
  assertEquals(
    readComp(db, t, 'alias')?.slug,
    'main',
  )
  write(db, [
    {
      eid: t,
      name: 'alias',
      comp: null,
    },
    {
      eid: p,
      name: 'alias',
      comp: { slug: 'main' },
    },
  ])
  assertEquals(
    readComp(db, p, 'alias')?.slug,
    'main',
  )
})

Deno.test(`fleet guards: deleting an alias owner releases primary and members in batch order`, () => {
  let db = bareDb()
  seed(db)
  write(db, [
    { eid: t, name: 'alias', comp: { slug: 'main', slugs: 'member' } },
    { eid: comment, name: 'comment', comp: { target: t } },
    { eid: comment, name: 'alias', comp: { slug: 'casualty' } },
  ])
  write(db, [
    { eid: t, name: 'entity', comp: null },
    {
      eid: p,
      name: 'alias',
      comp: { slug: 'main', slugs: 'member casualty' },
    },
  ])
  assertEquals(readComp(db, t, 'alias'), undefined)
  assertEquals(readComp(db, comment, 'alias'), undefined)
  assertEquals(readComp(db, p, 'alias')?.slugs, 'member casualty')
})

Deno.test(`fleet guards: stop requires managed active, pending graph work or advanceable input`, () => {
  let db = bareDb()
  seed(db)
  let stop = () =>
    write(db, [{
      eid: stopRequest,
      name: 'stop_request',
      comp: { target: s },
    }])
  assertThrows(stop, Error, 'stop_request refused')
  db.prepare(
    "update session set origin = 'managed', status = 'running' where id = 'holder'",
  ).run()
  stop()
  db.prepare("update session set status = 'completed' where id = 'holder'")
    .run()
  assertThrows(stop, Error, 'stop_request refused')
  // Native generation remains pending even with a terminal legacy summary.
  apply(db, [
    {
      eid: generation,
      name: 'entry',
      comp: { session: s },
    },
    {
      eid: generation,
      name: 'generation',
      comp: { provider: 'fake', model: 'fake', through: generation },
    },
  ])
  stop()
  write(db, [{
    eid: generation,
    name: 'delivered',
    comp: {},
  }])
  assertThrows(stop, Error, 'stop_request refused')
  // Delivered generation + later attention is advanceable, not pending.
  apply(db, [
    {
      eid: attention,
      name: 'entry',
      comp: { session: s },
    },
    {
      eid: attention,
      name: 'attention',
      comp: {},
    },
  ])
  stop()
  // A same-batch origin change is visible to the gate.
  assertThrows(
    () =>
      write(db, [
        {
          eid: s,
          name: 'session',
          comp: { origin: 'external' },
        },
        {
          eid: stopRequest,
          name: 'stop_request',
          comp: { target: s },
        },
      ]),
    Error,
    'stop_request refused',
  )
  assertEquals(
    readComp(db, s, 'session')?.origin,
    'managed',
  )
})

Deno.test(`fleet guards: surrounding refusal policy stays atomic`, () => {
  let db = bareDb()
  seed(db)
  let cases: [Change[], string][] = [
    [
      [{
        eid: board,
        name: 'board',
        comp: { query: '.notAComp=1' },
      }],
      'board query refused',
    ],
    [
      [{
        eid: blob,
        name: 'blob',
        comp: { bytes: 1 },
      }],
      'blob eid must be its SHA-256',
    ],
    [
      [{
        eid: loose,
        name: 'content',
        comp: { body: loose },
      }],
      'needs entry in its batch',
    ],
  ]
  apply(db, [
    {
      eid: comment,
      name: 'doc',
      comp: { body: 'original comment' },
    },
    {
      eid: comment,
      name: 'comment',
      comp: { target: t },
    },

    { eid: memory, name: 'memory', comp: {} },
    { eid: memory, name: 'proposed', comp: {} },
    {
      eid: entry,
      name: 'entry',
      comp: { session: s },
    },
    {
      eid: entry,
      name: 'content',
      comp: { body: 'immutable' },
    },
  ])
  write(db, [{
    eid: redaction,
    name: 'redaction',
    comp: { target: t, column: 'body', hash: sha('forgotten') },
  }])
  cases.push(
    [[{
      eid: comment,
      name: 'doc',
      comp: { body: 'displaced' },
    }, {
      eid: comment,
      name: 'comment',
      comp: { target: t },
    }], 'already a comment'],
    [[{
      eid: redaction,
      name: 'entity',
      comp: null,
    }], 'permanent redaction audit'],
    [[{
      eid: memory,
      name: 'decided',
      comp: {},
    }], 'is a proposed memory'],
    [
      [{
        eid: entry,
        name: 'content',
        comp: { body: 'changed' },
      }],
      'is immutable',
    ],
  )
  for (let [changes, message] of cases) {
    assertThrows(
      () =>
        write(db, [{
          eid: t,
          name: 'doc',
          comp: { body: 'must roll back' },
        }, ...changes]),
      Error,
      message,
    )
    assertEquals(
      readComp(db, t, 'doc')?.body,
      'held text',
    )
  }
  assertEquals(
    readComp(db, comment, 'doc')?.body,
    'original comment',
  )
  assertEquals(rows(db, 'conflict'), [])
})

Deno.test(`fleet guards: typed refs see final kinds; missing identities and kind drops refuse`, () => {
  let db = bareDb()
  seed(db)
  let missing = crypto.randomUUID()
  assertThrows(
    () => write(db, [{ eid: t, name: 'claim', comp: { session: p } }]),
    Error,
    'no such session',
  )
  assertEquals(readComp(db, t, 'claim'), undefined)
  assertThrows(
    () => write(db, [{ eid: t, name: 'comment', comp: { target: missing } }]),
    Error,
    'no such entity',
  )
  assertEquals(
    db.prepare('select 1 from entity where eid = ?').get(missing),
    undefined,
  )
  // The target identity is known; its required kind can be added LATER.
  write(db, [
    { eid: t, name: 'claim', comp: { session: p } },
    { eid: p, name: 'session', comp: { id: 'later session kind' } },
  ])
  assertThrows(
    () => write(db, [{ eid: p, name: 'session', comp: null }]),
    Error,
    'no such session',
  )
  assert(readComp(db, p, 'session'))
  write(db, [
    { eid: p, name: 'session', comp: null },
    { eid: t, name: 'claim', comp: null },
  ])
  assertEquals(readComp(db, p, 'session'), undefined)
  assertThrows(
    () =>
      write(db, [
        { eid: other, name: 'entity', comp: null },
        { eid: t, name: 'claim', comp: { session: other } },
      ]),
    Error,
    'tombstoned',
  )
  assert(readComp(db, other, 'session'))
  write(db, [{ eid: other, name: 'entity', comp: null }])
  assertThrows(
    () => write(db, [{ eid: t, name: 'claim', comp: { session: other } }]),
    Error,
    'tombstoned',
  )
})

Deno.test(`fleet guards: a new spawn is refused for an undecided proposal, unless decided in its batch`, () => {
  let db = bareDb()
  seed(db)
  write(db, [{ eid: t, name: 'proposed', comp: {} }])
  let spawn: Change = {
    eid: newWorker,
    name: 'session',
    comp: { id: 'request', requested_task: t },
  }
  assertThrows(() => write(db, [spawn]), Error, 'proposed but not decided')
  assertEquals(readComp(db, newWorker, 'session'), undefined)
  write(db, [spawn, {
    eid: t,
    name: 'decided',
    comp: { verdict: 'approved' },
  }])
  assertEquals(readComp(db, newWorker, 'session')?.requested_task, t)
})

Deno.test(`fleet guards: only the resolved person can accept a proposed memory`, () => {
  let db = bareDb()
  seed(db)
  let person = crypto.randomUUID()
  apply(db, [
    { eid: person, name: 'person', comp: {} },
    { eid: memory, name: 'memory', comp: {} },
    { eid: memory, name: 'proposed', comp: {} },
  ])
  let decide: Change = {
    eid: memory,
    name: 'decided',
    comp: { verdict: 'approved' },
  }
  assertThrows(
    () => write(db, [decide], undefined, p),
    Error,
    'is a proposed memory',
  )
  write(db, [decide], undefined, person)
  assertEquals(readComp(db, memory, 'decided')?.verdict, 'approved')
})

Deno.test(`fleet guards: rollback never audits a phantom target or inside an outer transaction`, () => {
  let db = bareDb()
  seed(db)
  let target = crypto.randomUUID()
  assertThrows(() =>
    write(db, [
      { eid: target, name: 'doc', comp: { title: 'gone' } },
      { eid: target, name: 'claim', comp: { session: s } },
      { eid: target, name: 'claim', comp: { session: other } },
    ]), Bounced)
  assertEquals(
    db.prepare('select 1 from entity where eid = ?').get(target),
    undefined,
  )
  assertEquals(rows(db, 'conflict').length, 0)
  assertThrows(() =>
    db.transaction(() =>
      write(db, [
        { eid: t, name: 'claim', comp: { session: s } },
        { eid: t, name: 'claim', comp: { session: other } },
      ])
    ), Bounced)
  // Inner applies must not publish an audit before their owner's rollback.
  assertEquals(rows(db, 'conflict').length, 0)
})

Deno.test('handle $was translates core Stale to human value/hash fields and FOUND semantics', () => {
  let db = bareDb()
  seed(db)
  let g = fleetGraphOf(db)
  let batch: Bundle[] = [
    {
      entity: { eid: t },
      doc: { body: 'one' },
      $was: { doc: { body: token('held text') } },
    },
    {
      entity: { eid: t },
      doc: { body: 'two' },
      $was: { doc: { body: token('held text') } },
    },
  ]
  sync(g.apply(batch))
  let err = assertThrows(
    () => sync(g.apply(batch)),
    Stale,
    `doc.body on ${human(db, t)} has moved`,
  )
  assertEquals([err.eid, err.comp, err.col, err.value], [
    t,
    'doc',
    'body',
    'two',
  ])
  assert(
    err.message.includes(`was: ${sha('two')}\n--- current doc.body ---\ntwo`),
  )
  assertEquals(
    readComp(db, t, 'doc')?.body,
    'two',
  )
})

Deno.test('fleet guards: only distinct document patches certify independence', () => {
  let db = bareDb()
  seed(db)
  let g = fleetGraphOf(db)
  let factory = g.plugins.find((p) => p.name == 'fleet/preconditions')!
    .beforeWrite!
  let a: Bundle = { entity: { eid: t }, doc: { title: 'next' } }
  let b: Bundle = { entity: { eid: p }, doc: { title: 'project' } }
  assertEquals(factory([a, b]).independent, true)
  for (
    let batch of [
      [a, a],
      [a, { ...b, doc: null }],
      [a, { ...b, tombstone: {} }],
      [a, { ...b, claim: { session: s } }],
      [a, { entity: b.entity, blob: { bytes: new Uint8Array() } }],
    ]
  ) assertEquals(factory(batch).independent, false)
  // No-op settling, FOUND guards and journal/effect output survive batching.
  let out = sync(g.apply([
    { ...a, doc: { title: 'Work' } }, // no-op
    { ...b, $was: { doc: { title: null } } },
  ]))
  assert(!out.some((b) => b.entity.eid == t && b.updated))
  assertEquals(readComp(db, p, 'doc')?.title, 'project')
  assertThrows(() =>
    sync(g.apply([
      a,
      { ...b, doc: { title: 'refused' }, $was: { doc: { title: null } } },
    ])), Stale)
  assertEquals(readComp(db, t, 'doc')?.title, 'Work')
  assertEquals(readComp(db, p, 'doc')?.title, 'project')
})
