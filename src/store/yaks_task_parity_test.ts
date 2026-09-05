// Fleet parity for @yaks/task (T-33511, goal V-33493): the fleet's work domain,
// expressed as the PACKAGE's vocabulary document instead of the fleet manifest,
// must be the same domain — same storage, same routing, same status.
//
// Three claims, each executable below.
//
//   SCHEMA    Every component @yaks/task ships, loaded through its own document
//             plus the fleet's extra columns, emits DDL byte-identical to what
//             the fleet emits for that table today.
//   ROUTING   The bare spellings a board actually says route to the same
//             (comp, prop) through both vocabularies.
//   STATUS    The package's derived-status rule, given the fleet's ladder,
//             compiles to the same SQL as src/sql_derived.ts — and a board query
//             answered through it agrees with the APP's own evaluator over a
//             graph seeded by the app's own apply().
//
// The fleet's extras are applied HERE, not in the package: `assignee`, `domain`,
// a project `color`, the stamped `via`/`since` audit columns, and the id
// prefixes are the fleet's own vocabulary, and @yaks/task ships a to-do list
// rather than the fleet's. The claim is that the package's document is the same
// domain underneath, not that the fleet has no columns of its own.
//
// The fleet ladder is the package's default plus one rung: a held `claim` reads
// `wip`, and declares `settled: false` because somebody working on a task has
// not finished it. That rung is the only fleet-specific thing about the status.

import { assert, assertEquals, assertThrows } from '@std/assert'
import { loadVocab, type PropSchema, type VocabDoc } from '@yaks/vocab'
import { schema, storage } from '@yaks/sqlite'
import type { Bundle, Driver } from '@yaks/sqlite'
import { matcher, Unsupported } from '@yaks/match'
import { edgeDoc, edgeKeywords, link as edgeLink } from '@yaks/edge'
import {
  compute,
  derived as taskDerived,
  type Mark,
  MARKS,
  taskDoc,
} from '@yaks/task'

import { fleetVocab } from '../vocab/fleet_vocab.ts'
import { link } from '../edge.ts'

Deno.env.set('DB_PATH', ':memory:')
let { apply } = await import('../db.ts')
let { bareDb } = await import('../testdb.ts')
let { uuid } = await import('../types.ts')
let { parseQuery } = await import('../query.ts')
let { where } = await import('../sql.ts')
let { run } = await import('../relation.ts')
let { derived: fleetDerived } = await import('../sql_derived.ts')

let NOW = Date.parse('2026-08-20T15:00:00.000Z')
let FLEET = fleetVocab()

// The fleet's ladder: the package's two marks, plus the lease rung.
let LADDER: Mark[] = [...MARKS, {
  status: 'wip',
  comp: 'claim',
  settled: false,
}]

// ---- the package's document, wearing the fleet's own extra columns ---------

let ref = (kind: string, death: string): PropSchema => ({
  type: 'string',
  ref: kind,
  death,
})
let time = (): PropSchema => ({ type: 'string', format: 'date-time' })

// A deep-enough copy to add columns to without touching the package's export.
let doc: VocabDoc = JSON.parse(JSON.stringify(taskDoc))
let defs = doc.$defs!
let add = (comp: string, props: Record<string, PropSchema>) => {
  defs[comp].properties = { ...defs[comp].properties, ...props }
}

add('task', {
  assignee: ref('entity', 'detach'),
  domain: { type: 'string' },
})
add('project', { color: { type: 'string' } })
add('completed', { via: { ...ref('entity', 'keep'), stamped: true } })
add('cancelled', { via: { ...ref('entity', 'keep'), stamped: true } })
add('blocked', { since: { ...time(), stamped: true } })

// The spine, so the loaded vocabulary has an identity table like the fleet's.
let spine: VocabDoc = {
  $defs: {
    entity: {
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
  },
}

let MINE = loadVocab([edgeDoc, doc, spine], [edgeKeywords])

// ---- SCHEMA: the same tables, statement for statement ----------------------

// One component's `create table` statement out of a whole schema.
let tableOf = (stmts: string[], comp: string): string | undefined =>
  stmts.find((s) => s.startsWith(`create table if not exists "${comp}" (`))

let SHIPPED = [
  'task',
  'project',
  'board',
  'completed',
  'cancelled',
  'blocked',
  'requires',
  'contains',
]

Deno.test('parity: every component @yaks/task ships emits the fleet DDL', () => {
  let mine = schema(MINE)
  let fleet = schema(FLEET)
  for (let comp of SHIPPED) {
    let a = tableOf(mine, comp)
    let b = tableOf(fleet, comp)
    assert(a, `@yaks/task emits a table for ${comp}`)
    assert(b, `the fleet emits a table for ${comp}`)
    assertEquals(a, b, comp)
  }
})

// ---- ROUTING: the bare spellings a board says ------------------------------

Deno.test('parity: the work spellings route the same through both', () => {
  for (
    let p of [
      'status',
      'priority',
      'project',
      'assignee',
      'domain',
      'query',
      'color',
    ]
  ) {
    assertEquals(MINE.route(p), FLEET.route(p), `.${p}`)
  }
})

Deno.test('parity: status is computed and unwritable on both sides', () => {
  for (let v of [MINE, FLEET]) {
    let status = v.column('task', 'status')!
    assertEquals(status.persist, false)
    assert(!v.comp('task')!.writable.includes('status'))
  }
  // The members agree as a SET; the package orders them most-decisive-first
  // (the ladder), the fleet orders them by lifecycle. Neither order is read.
  assertEquals(
    [...MINE.column('task', 'status')!.values!].sort(),
    ['cancelled', 'done', 'open'].sort(),
  )
  assertEquals(
    [...FLEET.column('task', 'status')!.values!].sort(),
    ['cancelled', 'done', 'open', 'wip'].sort(),
  )
})

Deno.test('parity: a task is filed under a project and never onto a board', () => {
  assertEquals(MINE.column('task', 'project')!.ref, 'project')
  assertEquals(MINE.column('task', 'project')!.death, 'detach')
  // Membership is never stored: no column of `task` points at a board, on
  // either side. (The fleet DOES reference boards elsewhere — `fold.board` is
  // one viewer's collapse state for a board's view, and `card.target` is what a
  // card shows. Neither says a task is ON a board, which is the thing that must
  // not exist.)
  for (let v of [MINE, FLEET]) {
    for (let prop of v.columns('task')) {
      assert(
        v.column('task', prop)!.ref != 'board',
        `task.${prop} references a board — membership must never be stored`,
      )
    }
  }
  // and in the package's own vocabulary, nothing at all does
  for (let [comp, prop] of MINE.refCols()) {
    assert(
      MINE.column(comp, prop)!.ref != 'board',
      `${comp}.${prop} references a board`,
    )
  }
})

// ---- STATUS: the same SQL, from one rule -----------------------------------

Deno.test('parity: the package derives the fleet status expression exactly', () => {
  let mine = taskDerived(LADDER)['task.status']
  let fleet = fleetDerived['task.status']
  let owner = '"task"."entity"'
  assertEquals(mine.expr(owner), fleet.expr(owner))
  assertEquals(mine.tag, fleet.tag)
  assertEquals([...mine.values!].sort(), [...fleet.values!].sort())
})

// ---- STATUS: and the answer over a graph the app itself seeded -------------

let db = bareDb()
let P = uuid(), S = uuid()
let T1 = uuid(), T2 = uuid(), T3 = uuid(), T4 = uuid()

// T1 open, T2 wip (claimed), T3 done, T4 cancelled — every rung of the ladder.
apply(db, [
  { eid: S, name: 'session', comp: { id: 'task-parity' } },
  { eid: P, name: 'doc', comp: { title: 'Task Parity Project' } },
  { eid: P, name: 'project', comp: {} },
  { eid: T1, name: 'doc', comp: { title: 'alpha widget' } },
  { eid: T1, name: 'task', comp: { priority: 1, domain: 'Eng', project: P } },
  { eid: T2, name: 'doc', comp: { title: 'beta widget' } },
  { eid: T2, name: 'task', comp: { priority: 2, domain: 'Ops', project: P } },
  { eid: T2, name: 'claim', comp: { session: S } },
  { eid: T3, name: 'doc', comp: { title: 'gamma' } },
  { eid: T3, name: 'task', comp: { priority: 0, domain: 'Eng' } },
  {
    eid: T3,
    name: 'completed',
    comp: { at: '2026-08-02T00:00:00.000Z', by: null },
  },
  { eid: T4, name: 'doc', comp: { title: 'delta' } },
  { eid: T4, name: 'task', comp: { priority: 3, domain: 'Ops' } },
  {
    eid: T4,
    name: 'cancelled',
    comp: { at: '2026-08-03T00:00:00.000Z', by: null, reason: 'superseded' },
  },
  ...link(T2, 'requires', T1),
  ...link(T3, 'requires', T2),
])

let driver: Driver = {
  query: (sql, params) => db.prepare(sql).all(...params),
  exec: (sql) => db.exec(sql),
}
// The fleet vocabulary (the app's own tables), read with the PACKAGE's derived
// status. `updated.at` is unrelated fleet glue and rides along unchanged.
let store = storage(driver, FLEET, {
  derived: { ...taskDerived(LADDER), 'updated.at': fleetDerived['updated.at'] },
  now: NOW,
})

let mine = (q: string): string[] =>
  store.rows(q).map((r) => r.eid as string).filter((e) => e != null).sort()

// One entity gathered whole, the way a synced client would hold it.
let whole = (eid: string): Bundle =>
  store.read(`.eid=${eid}`)[0] ?? { entity: { eid } }

let app = (q: string): string[] | null => {
  let rel = where(parseQuery(q), NOW)
  return rel ? run<{ eid: string }>(db, rel).map((r) => r.eid).sort() : null
}

let agree = (q: string) => {
  let r = app(q)
  assert(r != null, `app declined (not a compiled case): ${q}`)
  assertEquals(mine(q), r, `disagreed on: ${q}`)
}

Deno.test('parity: board queries agree with the app over the seeded graph', () => {
  for (
    let q of [
      '.status=open',
      '.status=wip',
      '.status=done',
      '.status=cancelled',
      '.status=open,wip',
      '.status!=done',
      '.status=done,cancelled',
      // status beside the ordinary columns, the way a board actually reads
      '.status=open&.domain=Eng',
      '.status=open&.priority<2',
      '.status=open&.task.project=' + P,
      '.kind=task&.status!=cancelled',
    ]
  ) agree(q)
})

Deno.test('parity: the agreement is not vacuous', () => {
  assertEquals(mine('.status=open'), [T1])
  assertEquals(mine('.status=wip'), [T2])
  assertEquals(mine('.status=done'), [T3])
  assertEquals(mine('.status=cancelled'), [T4])
})

Deno.test('gap: the in-memory reader has the rule but no hook to take it', () => {
  // @yaks/task supplies the status rule for BOTH evaluators from one list.
  // @yaks/sql takes its half through the `derived` hook (proved above);
  // @yaks/match has no computed-column hook yet (T-33611), so it declines a
  // status filter rather than answering it almost-right. This pins the gap from
  // the package's side: the rule is ready and correct, and the reader is what
  // is missing.
  let read = compute(LADDER)['task.status']
  let bundle = (comps: Record<string, unknown>) => ({
    entity: { eid: 'x' },
    ...comps,
  })
  assertEquals(read(bundle({ task: {} })), 'open')
  assertEquals(read(bundle({ task: {}, claim: {} })), 'wip')
  assertEquals(read(bundle({ task: {}, completed: {} })), 'done')
  assertEquals(read(bundle({ task: {}, cancelled: {} })), 'cancelled')
  // and it agrees with the database, task for task, over the seeded graph
  for (let status of ['open', 'wip', 'done', 'cancelled']) {
    let inSql = mine(`.status=${status}`)
    let inRam = [T1, T2, T3, T4]
      .map((eid) => ({ eid, b: whole(eid) }))
      .filter(({ b }) => read(b) == status)
      .map(({ eid }) => eid)
      .sort()
    assertEquals(inRam, inSql, status)
  }
  // the decline itself stays pinned in yaks_match_parity_test.ts
  assertThrows(() => matcher('.status=open', FLEET, { now: NOW }), Unsupported)
})

Deno.test('parity: the package states the fleet edge sentences', () => {
  // @yaks/edge's link() and the fleet's own link() derive the same edge entity,
  // so `requires` said through the package is the sentence the fleet stored.
  let said = edgeLink(T2, 'requires', T1)
  let fleet = link(T2, 'requires', T1)
  assertEquals(said.entity.eid, fleet[0].eid)
})
