// The dispatch candidate commit seam against a real database: one atomic
// precondition refusal is durable telemetry, spends no slot, and the following
// candidate still lands through the central effects driver.
import { assertEquals, assertMatch } from '@std/assert'

Deno.env.set('DB_PATH', ':memory:')
let { apply, eager } = await import('./db.ts')
let { db } = await import('./live_db.ts')
let { commitEffects } = await import('./effects.ts')
let { candidateRefusal, commitCandidates } = await import('./dispatch.ts')
let { rowsFor } = await import('./graph_query.ts')
let { idOf } = await import('./client.ts')
let { sha } = await import('./sha.ts')
let { record } = await import('./telemetry.ts')

Deno.test('a refused candidate is addressed durably and the next one commits', () => {
  let bad = crypto.randomUUID(), good = crypto.randomUUID()
  let badSession = crypto.randomUUID(), goodSession = crypto.randomUUID()
  apply(db, [
    { eid: bad, name: 'doc', comp: { title: 'bad', body: 'CURRENT' } },
    { eid: bad, name: 'task', comp: { priority: 0 } },
    { eid: good, name: 'doc', comp: { title: 'good' } },
    { eid: good, name: 'task', comp: { priority: 1 } },
  ])
  let [badRow, goodRow] = rowsFor(db, [bad, good])
  let spawned = commitCandidates(
    [
      {
        target: badRow,
        spends: true,
        error: new Error('no task-shaped launch plan'),
      },
      {
        target: badRow,
        spends: true,
        changes: [
          {
            eid: bad,
            name: 'doc',
            comp: { body: 'STALE' },
            was: { body: sha('OLD') },
          },
          {
            eid: badSession,
            name: 'session',
            comp: { id: crypto.randomUUID(), requested_task: bad },
          },
        ],
      },
      {
        target: goodRow,
        spends: true,
        changes: [{
          eid: goodSession,
          name: 'session',
          comp: { id: crypto.randomUUID(), requested_task: good },
        }],
      },
    ],
    1,
    (changes) => {
      commitEffects((trace) => apply(db, changes, trace), () => {})
    },
    (target, error) => candidateRefusal(db, target, error),
  )

  assertEquals(spawned, 1)
  assertEquals(eager(db, badSession).session, undefined)
  assertEquals(eager(db, goodSession).session?.requested_task, good)
  let logged = db.prepare(
    `select source, name, error, detail from tool_call
     where name = 'dispatch candidate' order by rowid`,
  ).all() as Record<string, string>[]
  assertEquals(logged.length, 2)
  assertEquals([logged[0].source, logged[0].name, logged[0].detail], [
    'srv',
    'dispatch candidate',
    idOf(badRow),
  ])
  assertMatch(logged[0].error, /launch plan/i)
  assertMatch(logged[1].error, /precondition|doc\.body/i)
})

Deno.test('a post-commit cast failure charges its slot exactly once', () => {
  let first = crypto.randomUUID(), second = crypto.randomUUID()
  let firstSession = crypto.randomUUID(), secondSession = crypto.randomUUID()
  apply(db, [
    { eid: first, name: 'doc', comp: { title: 'first' } },
    { eid: first, name: 'task', comp: { priority: 0 } },
    { eid: second, name: 'doc', comp: { title: 'second' } },
    { eid: second, name: 'task', comp: { priority: 1 } },
  ])
  let [firstRow, secondRow] = rowsFor(db, [first, second])
  let spawned = commitCandidates(
    [
      {
        target: firstRow,
        spends: true,
        changes: [{
          eid: firstSession,
          name: 'session',
          comp: { id: crypto.randomUUID(), requested_task: first },
        }],
      },
      {
        target: secondRow,
        spends: true,
        changes: [{
          eid: secondSession,
          name: 'session',
          comp: { id: crypto.randomUUID(), requested_task: second },
        }],
      },
    ],
    1,
    (changes) => {
      commitEffects(
        (trace) => apply(db, changes, trace),
        () => {
          throw new Error('socket broadcast failed')
        },
        (comp, error) =>
          record(db, {
            source: 'http',
            name: `effect:${comp}`,
            ok: false,
            error: String(error),
          }),
      )
    },
    (target, error) => candidateRefusal(db, target, error),
  )

  assertEquals(spawned, 1)
  assertEquals(eager(db, firstSession).session?.requested_task, first)
  assertEquals(eager(db, secondSession).session, undefined)
  let cast = db.prepare(
    `select name, error from tool_call where name = 'effect:cast'
     order by rowid desc limit 1`,
  ).get() as { name: string; error: string } | undefined
  assertEquals(cast?.name, 'effect:cast')
  assertMatch(cast?.error ?? '', /socket broadcast failed/)
  assertEquals(
    Number(
      (db.prepare(
        `select count(*) as n from tool_call
         where name = 'dispatch candidate' and detail = ?`,
      ).get(idOf(firstRow)) as { n: number }).n,
    ),
    0,
  )
})
