// A reference path's equality is read from its far end and drives the
// statement through the root reference's index, whatever is beside it.
import { equal, ok, test } from '@yaks/testing'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { loadVocab } from '@yaks/vocab'
import { compile, render } from '@yaks/sql'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { type Bundle, graph } from '@yaks/graph'
import { parse } from '@yaks/query'
import { catalog } from './catalog.ts'
import { storage } from './mod.ts'
import { driver } from './native.ts'
import { sqlitePath } from './sqlitepath.ts'

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})

let ref = (to: string) => ({ type: 'string', ref: to })
let vocab = loadVocab([archetypeDoc, {
  $defs: {
    entity: { component: true, type: 'object' },
    project: { component: true, type: 'object' },
    process: { component: true, type: 'object' },
    task: { component: true, type: 'object' },
    completed: { component: true, type: 'object' },
    persona: {
      component: true,
      type: 'object',
      properties: { home: ref('project') },
    },
    session: {
      component: true,
      type: 'object',
      properties: { persona: ref('persona') },
    },
    filed: {
      component: true,
      type: 'object',
      properties: { project: ref('entity') },
    },
  },
}])

// A graph holding `seed`, then `grow(n)` for each size, asked `q` each time:
// the eids it answers and the VM steps that took.
let asked = (
  q: string,
  seed: Bundle[],
  grow: (from: number, n: number) => Bundle[],
  sizes: number[],
) => {
  let db = new Database(':memory:'), d = driver(db)
  try {
    let store = storage(d, vocab)
    store.install()
    let g = graph({ storage: store, vocab, plugins: [archetypes()] })
    g.apply(seed)
    let at = 0
    return sizes.map((n) => {
      for (; at < n; at += 500) g.apply(grow(at, Math.min(500, n - at)))
      let sql = render(compile(parse(q), vocab, { archetypes: catalog(d) }))
      let stmt = db.prepare(sql.sql)
      try {
        let eids = stmt.all(...sql.params).map((r) => String(r.eid)).sort()
        let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
        return { eids, steps }
      } finally {
        stmt.finalize()
      }
    })
  } finally {
    db.close()
  }
}

let many = (from: number, n: number, make: (eid: string) => Bundle) =>
  Array.from({ length: n }, (_, i) => make(`x${from + i}`))

test('a path equality beside an absence test seeks the path', () => {
  let seed = [
    { entity: { eid: 'home' }, project: {} },
    { entity: { eid: 'away' }, project: {} },
    { entity: { eid: 'mine' }, persona: { home: 'home' } },
    { entity: { eid: 'theirs' }, persona: { home: 'away' } },
    { entity: { eid: 'native' }, session: { persona: 'mine' } },
    { entity: { eid: 'outside' }, session: { persona: 'mine' }, process: {} },
  ]
  // Sessions elsewhere, none of them running outside the graph: every one is
  // admitted by the absence test alone.
  let elsewhere = (from: number, n: number) =>
    many(
      from,
      n,
      (eid) => ({ entity: { eid }, session: { persona: 'theirs' } }),
    )
  let [{ eids, steps }] = asked(
    '.session.persona.persona.home=home !process',
    seed,
    elsewhere,
    [1000],
  )
  equal(eids, ['native'])
  ok(steps < 300, `${steps} VM steps`)
})

test('a path with a broad far end beside a dense spine reads each row once', () => {
  let seed = [
    { entity: { eid: 'top' }, project: {} },
    { entity: { eid: 'sub' }, project: {}, filed: { project: 'top' } },
    { entity: { eid: 'deep' }, task: {}, filed: { project: 'sub' } },
  ]
  // Tasks filed straight under the top project: each is a value the path's
  // far end yields, and none is filed under one of them.
  let broad = (from: number, n: number) =>
    many(from, n, (eid) => ({
      entity: { eid },
      task: {},
      filed: { project: 'top' },
    }))
  let [small, large] = asked(
    '.task .filed.project.filed.project=top !completed',
    seed,
    broad,
    [100, 800],
  )
  equal(small.eids, ['deep'])
  equal(large.eids, ['deep'])
  ok(
    large.steps < small.steps * 16,
    `${small.steps} then ${large.steps} VM steps for eight times the rows`,
  )
})
