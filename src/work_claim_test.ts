// The guarded worker take: unlike raw graph mutation, claim_work resolves,
// optionally approves, validates readiness, and claims under one writer lock.
// These cases hold the named mutation to the readiness boundary — approval is
// not part of it (M-31946) — and prove a refusal rolls back session
// reification and approval with it.
import { assert, assertEquals, assertMatch, assertThrows } from '@std/assert'
import { link } from './edge.ts'
import type { Sql } from './store/sql.ts'
import type { WorkClaimMutation } from './mutation.ts'
import { type Change, uuid } from './types.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply, human, mutate } = await import('./db.ts')
let { addSource, clearSources } = await import('./source.ts')
let { bareDb } = await import('./testdb.ts')

let task = (
  eid: string,
  project: string,
  extra: Change[] = [],
): Change[] => [
  { eid, name: 'doc', comp: { title: eid.slice(0, 8), body: '' } },
  { eid, name: 'task', comp: { project } },
  ...extra,
]

let world = () => {
  let db = bareDb()
  let project = uuid()
  apply(db, [
    { eid: project, name: 'doc', comp: { title: 'Graph', body: '' } },
    { eid: project, name: 'project', comp: {} },
  ])
  return { db, project }
}

let take = (
  db: Sql,
  target: string,
  session: string,
  mode: 'ready' | 'approve' = 'ready',
) =>
  mutate(
    db,
    {
      mutation: 'claim_work',
      target,
      session,
      mode,
      cwd: '/work',
    } satisfies WorkClaimMutation,
  )

let cell = (
  db: Sql,
  sql: string,
  ...args: (string | number | null)[]
) => db.prepare(sql).get(...args) as Record<string, unknown> | undefined

let sessionEid = (db: Sql, sid: string) =>
  cell(
    db,
    `select owner.eid as eid from session
     join entity owner on owner.id = session.entity where session.id = ?`,
    sid,
  )?.eid as string | undefined

let holder = (db: Sql, target: string) =>
  cell(
    db,
    `select owner.eid as eid from claim
     join entity owner on owner.id = claim.session
     where claim.entity = (select id from entity where eid = ?)`,
    target,
  )?.eid as string | undefined

// Approval is not a claim gate: a decided task, a descendant of one, and a
// lone task nobody decided are all equally takeable.
Deno.test('claim_work takes filed work, decided or not', () => {
  let { db, project } = world()
  let decided = uuid(), root = uuid(), child = uuid(), lone = uuid()
  apply(db, [
    ...task(decided, project, [{ eid: decided, name: 'decided', comp: {} }]),
    ...task(root, project, [{ eid: root, name: 'decided', comp: {} }]),
    ...task(child, project),
    ...task(lone, project),
    ...link(root, 'requires', child),
  ])
  take(db, decided, 'decided-worker')
  take(db, child, 'descendant-worker')
  take(db, lone, 'lone-worker')
  assertEquals(holder(db, decided), sessionEid(db, 'decided-worker'))
  assertEquals(holder(db, child), sessionEid(db, 'descendant-worker'))
  assertEquals(holder(db, lone), sessionEid(db, 'lone-worker'))
})

Deno.test('claim_work approve and claim is atomic and never reverses decline', () => {
  let { db, project } = world()
  let pending = uuid(), declined = uuid(), blocked = uuid()
  apply(db, [
    ...task(pending, project, [{ eid: pending, name: 'proposed', comp: {} }]),
    ...task(declined, project, [
      { eid: declined, name: 'proposed', comp: {} },
      {
        eid: declined,
        name: 'decided',
        comp: { verdict: 'declined' },
      },
    ]),
    ...task(blocked, project, [
      { eid: blocked, name: 'proposed', comp: {} },
      { eid: blocked, name: 'blocked', comp: { on: 'owner choice' } },
    ]),
  ])
  take(db, pending, 'builder', 'approve')
  assert(holder(db, pending))
  assert(cell(
    db,
    'select 1 from decided where entity = (select id from entity where eid = ?)',
    pending,
  ))

  assertThrows(
    () => take(db, declined, 'declined-builder', 'approve'),
    Error,
    `${human(db, declined)} was declined`,
  )
  assertEquals(
    cell(
      db,
      'select verdict from decided where entity = (select id from entity where eid = ?)',
      declined,
    )?.verdict,
    'declined',
  )
  assertEquals(sessionEid(db, 'declined-builder'), undefined)

  assertThrows(
    () => take(db, blocked, 'blocked-builder', 'approve'),
    Error,
    `${human(db, blocked)} is externally blocked: owner choice`,
  )
  assertEquals(sessionEid(db, 'blocked-builder'), undefined)
  assertEquals(
    cell(
      db,
      'select 1 from decided where entity = (select id from entity where eid = ?)',
      blocked,
    ),
    undefined,
  )
})

Deno.test('claim_work refuses every non-build state and rolls back identity', () => {
  let { db, project } = world()
  let cases: [string, Change[], string][] = [
    [
      'pending',
      [{ eid: '', name: 'proposed', comp: {} }],
      'proposed but not decided',
    ],
    ['completed', [{ eid: '', name: 'completed', comp: {} }], 'is completed'],
    ['cancelled', [{ eid: '', name: 'cancelled', comp: {} }], 'is cancelled'],
    [
      'quarantined',
      [{ eid: '', name: 'quarantined', comp: {} }],
      'is quarantined',
    ],
  ]
  for (let [sid, extras, message] of cases) {
    let eid = uuid()
    apply(db, task(eid, project, extras.map((c) => ({ ...c, eid }))))
    assertThrows(() => take(db, eid, sid), Error, message)
    assertEquals(sessionEid(db, sid), undefined)
    assertEquals(holder(db, eid), undefined)
  }
})

Deno.test('claim_work gates unresolved and hidden dependencies', () => {
  let { db, project } = world()
  let open = uuid(), hidden = uuid(), a = uuid(), b = uuid()
  apply(db, [
    ...task(open, project),
    ...task(hidden, project, [{ eid: hidden, name: 'quarantined', comp: {} }]),
    ...task(a, project, [{ eid: a, name: 'decided', comp: {} }]),
    ...task(b, project, [{ eid: b, name: 'decided', comp: {} }]),
    ...link(a, 'requires', open),
    ...link(b, 'requires', hidden),
  ])
  assertThrows(
    () => take(db, a, 'open-blocked'),
    Error,
    `${human(db, a)} requires unresolved ${human(db, open)}`,
  )
  let hiddenId = human(db, hidden)
  let e = assertThrows(() => take(db, b, 'hidden-blocked')) as Error
  assertMatch(e.message, /requires something hidden and unresolved/)
  assertEquals(e.message.includes(hiddenId), false)
})

Deno.test('claim_work replay is a no-op; collision audits one winner', () => {
  let { db, project } = world()
  let target = uuid()
  apply(db, task(target, project, [{ eid: target, name: 'decided', comp: {} }]))
  let first = take(db, target, 'winner')
  let journal = Number(cell(db, 'select count(*) as n from journal_tx')?.n)
  assert(first.length > 0)
  assertEquals(take(db, target, 'winner'), [])
  assertEquals(take(db, target, human(db, sessionEid(db, 'winner')!)), [])
  assertEquals(
    Number(cell(db, 'select count(*) as n from journal_tx')?.n),
    journal,
  )
  assertEquals(
    Number(
      cell(
        db,
        `select count(*) as n from edge g join worked w on w.entity = g.entity
         where g."to" = (select id from entity where eid = ?)`,
        target,
      )?.n,
    ),
    1,
  )
  assertThrows(
    () => take(db, target, 'loser'),
    Error,
    `${human(db, target)} already claimed by winner`,
  )
  assertEquals(sessionEid(db, 'loser'), undefined)
  assertEquals(Number(cell(db, 'select count(*) as n from conflict')?.n), 1)
})

Deno.test('claim_work refuses non-session and ambiguous graph addresses without a trace', () => {
  let { db, project } = world()
  let target = uuid(), wrongTask = uuid(), design = uuid(), comment = uuid()
  let aliasA = uuid(), aliasB = uuid()
  apply(db, [
    ...task(target, project, [{ eid: target, name: 'decided', comp: {} }]),
    ...task(wrongTask, project),
    { eid: design, name: 'doc', comp: { title: 'A design', body: '' } },
    { eid: design, name: 'design', comp: {} },
    { eid: comment, name: 'doc', comp: { title: 'A comment', body: '' } },
    { eid: comment, name: 'comment', comp: { target } },
    { eid: aliasA, name: 'alias', comp: { slug: 'alias-a' } },
    { eid: aliasB, name: 'alias', comp: { slug: 'alias-b' } },
  ])
  db.prepare('update alias set slugs = ? where slug in (?, ?)')
    .run('ambiguous-worker', 'alias-a', 'alias-b')
  let journal = Number(cell(db, 'select count(*) as n from journal_tx')?.n)
  for (let wrong of [wrongTask, design, comment]) {
    let id = human(db, wrong)
    assertThrows(() => take(db, target, id), Error, `${id} is not a session`)
  }
  assertThrows(
    () => take(db, target, 'ambiguous-worker'),
    Error,
    'ambiguous-worker is an ambiguous alias',
  )
  assertEquals(Number(cell(db, 'select count(*) as n from session')?.n), 0)
  assertEquals(Number(cell(db, 'select count(*) as n from claim')?.n), 0)
  assertEquals(
    Number(cell(db, 'select count(*) as n from journal_tx')?.n),
    journal,
  )
})

Deno.test('claim_work mints an unknown stable uuid and resumes an exact session', () => {
  let { db, project } = world()
  let target = uuid(), sid = uuid()
  apply(db, task(target, project, [{ eid: target, name: 'decided', comp: {} }]))
  take(db, target, sid)
  let session = sessionEid(db, sid)!
  assertEquals(holder(db, target), session)
  let journal = Number(cell(db, 'select count(*) as n from journal_tx')?.n)
  assertEquals(take(db, target, sid), [])
  assertEquals(take(db, target, human(db, session)), [])
  assertEquals(
    Number(cell(db, 'select count(*) as n from journal_tx')?.n),
    journal,
  )
})

Deno.test('claim_work atomically graduates a source Session at its existing identity', () => {
  let { db, project } = world()
  let target = uuid(), failed = uuid(), wrongTarget = uuid()
  let sourceEid = uuid(), wrongEid = uuid()
  let sid = 'source-session', wrongSid = 'source-task'
  apply(db, [
    ...task(target, project, [{ eid: target, name: 'decided', comp: {} }]),
    ...task(failed, project, [{ eid: failed, name: 'proposed', comp: {} }]),
    ...task(wrongTarget, project, [
      { eid: wrongTarget, name: 'decided', comp: {} },
    ]),
  ])
  let off = addSource({
    resolve: (id) => {
      if (id == sid || id == sourceEid) {
        return [
          {
            eid: sourceEid,
            name: 'session',
            comp: { id: sid, provider: 'claude', origin: 'native' },
          },
          {
            eid: sourceEid,
            name: 'doc',
            comp: { title: 'Source session' },
          },
        ]
      }
      if (id == wrongSid || id == wrongEid) {
        return [{ eid: wrongEid, name: 'task', comp: {} }]
      }
    },
  })
  try {
    let journal = Number(cell(db, 'select count(*) as n from journal_tx')?.n)
    assertThrows(
      () => take(db, failed, sid),
      Error,
      'proposed but not decided',
    )
    assertEquals(sessionEid(db, sid), undefined)
    assertEquals(
      cell(db, 'select 1 from entity where eid = ?', sourceEid),
      undefined,
    )
    assertEquals(
      Number(cell(db, 'select count(*) as n from journal_tx')?.n),
      journal,
    )
    assertThrows(
      () => take(db, wrongTarget, wrongSid),
      Error,
      `${wrongEid.slice(0, 8)} is not a session`,
    )
    assertEquals(
      cell(db, 'select 1 from entity where eid = ?', wrongEid),
      undefined,
    )

    let landed = take(db, target, sid)
    assertEquals(
      landed.some((change) =>
        change.name == 'spawn' && change.comp?.provider != null
      ),
      false,
    )
    assertEquals(sessionEid(db, sid), sourceEid)
    assertEquals(holder(db, target), sourceEid)
    let identity = cell(
      db,
      `select entity.num, session.id from session
       join entity on entity.id = session.entity where entity.eid = ?`,
      sourceEid,
    ) as { num: number; id: string }
    assertEquals(identity.id, sid)
    assertEquals(typeof identity.num, 'number')
    assertEquals(
      cell(
        db,
        `select title from doc_value
         where entity = (select id from entity where eid = ?)`,
        sourceEid,
      )?.title,
      'Source session',
    )
    assertEquals(
      cell(
        db,
        `select provider from spawn
         where entity = (select id from entity where eid = ?)`,
        sourceEid,
      ),
      { provider: null },
    )
    journal = Number(cell(db, 'select count(*) as n from journal_tx')?.n)
    assertEquals(take(db, target, sid), [])
    assertEquals(take(db, target, human(db, sourceEid)), [])
    assertEquals(
      cell(db, 'select num from entity where eid = ?', sourceEid)?.num,
      identity.num,
    )
    assertEquals(
      Number(cell(db, 'select count(*) as n from journal_tx')?.n),
      journal,
    )
  } finally {
    off()
    clearSources()
  }
})

Deno.test('claim_work refuses a resolved non-task target before reifying a session', () => {
  let { db, project } = world()
  let comment = uuid()
  apply(db, [
    { eid: comment, name: 'doc', comp: { title: 'A comment', body: '' } },
    { eid: comment, name: 'comment', comp: { target: project } },
  ])
  let journal = Number(cell(db, 'select count(*) as n from journal_tx')?.n)
  let id = human(db, comment)
  assertThrows(() => take(db, id, 'wrong-target'), Error, `${id} is not a task`)
  assertEquals(sessionEid(db, 'wrong-target'), undefined)
  assertEquals(
    Number(cell(db, 'select count(*) as n from journal_tx')?.n),
    journal,
  )
})

Deno.test('raw claim mutation remains an administrative force door', () => {
  let { db, project } = world()
  let target = uuid(), session = uuid()
  apply(db, [
    ...task(target, project),
    { eid: session, name: 'session', comp: { id: 'admin' } },
    { eid: target, name: 'claim', comp: { session } },
  ])
  assertEquals(holder(db, target), session)
})

Deno.test('claim_work rejects malformed requests before writing', () => {
  let { db } = world()
  assertThrows(
    () =>
      mutate(db, {
        mutation: 'claim_work',
        target: '',
        session: 'worker',
        mode: 'ready',
      }),
    Error,
    'needs a target',
  )
  assertThrows(
    () =>
      mutate(db, {
        mutation: 'claim_work',
        target: 'T-1',
        session: 'worker',
        mode: 'ready',
        entities: [{ comps: { project: {} } }],
      } as unknown as WorkClaimMutation),
    Error,
    'claim_work unknown field: entities',
  )
  // `recursive` selected how far approval inherited; the claim no longer asks
  // about approval at all, so the field is gone rather than ignored.
  for (let key of ['changes', 'constructor', '__proto__', 'recursive']) {
    let request = JSON.parse(
      `{"mutation":"claim_work","target":"T-1","session":"worker",` +
        `"mode":"ready","${key}":{"eid":"smuggled"}}`,
    ) as WorkClaimMutation
    assertThrows(
      () => mutate(db, request),
      Error,
      `claim_work unknown field: ${key}`,
    )
  }
  for (let field of ['target', 'session']) {
    let request = {
      mutation: 'claim_work',
      target: 'T-1',
      session: 'worker',
      mode: 'ready',
      [field]: { eid: 'smuggled' },
    } as unknown as WorkClaimMutation
    assertThrows(() => mutate(db, request), Error, `needs a ${field}`)
  }
  assertThrows(
    () =>
      mutate(db, {
        mutation: 'claim_work',
        target: 'T-1',
        session: 'worker',
        mode: 'ready',
        cwd: '  ',
      }),
    Error,
    'cwd must not be empty',
  )
  assertEquals(Number(cell(db, 'select count(*) as n from project')?.n), 1)
})
