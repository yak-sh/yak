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

// A graph holding `seed` and then `more`, with `q` prepared against it: a run
// answers the eids and the VM steps that took. Built when the file loads, since
// a query reads and changes nothing.
let world = (q: string, seed: Bundle[], more: Bundle[]) => {
  let db = new Database(':memory:'), d = driver(db)
  let store = storage(d, vocab)
  store.install()
  let g = graph({ storage: store, vocab, plugins: [archetypes()] })
  g.apply(seed)
  g.apply(more)
  let sql = render(compile(parse(q), vocab, { archetypes: catalog(d) }))
  let stmt = db.prepare(sql.sql)
  return () => {
    let eids = stmt.all(...sql.params).map((r) => String(r.eid)).sort()
    let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 1)
    return { eids, steps }
  }
}

// The world with 10 bundles of a kind added, and with 40.
let growing = (q: string, seed: Bundle[], make: (eid: string) => Bundle) => {
  let more = (n: number) => Array.from({ length: n }, (_, i) => make(`x${i}`))
  return [10, 40].map((n) => world(q, seed, more(n)))
}

// Sessions elsewhere, none of them running outside the graph: every one is
// admitted by the absence test alone.
let sessions = growing('.session.persona.persona.home=home !process', [
  { entity: { eid: 'home' }, project: {} },
  { entity: { eid: 'away' }, project: {} },
  { entity: { eid: 'mine' }, persona: { home: 'home' } },
  { entity: { eid: 'theirs' }, persona: { home: 'away' } },
  { entity: { eid: 'native' }, session: { persona: 'mine' } },
  { entity: { eid: 'outside' }, session: { persona: 'mine' }, process: {} },
], (eid) => ({ entity: { eid }, session: { persona: 'theirs' } }))

// Tasks filed straight under the top project: each is a value the path's far
// end yields, and none is filed under one of them.
let tasks = growing('.task .filed.project.filed.project=top !completed', [
  { entity: { eid: 'top' }, project: {} },
  { entity: { eid: 'sub' }, project: {}, filed: { project: 'top' } },
  { entity: { eid: 'deep' }, task: {}, filed: { project: 'sub' } },
], (eid) => ({ entity: { eid }, task: {}, filed: { project: 'top' } }))

test('a path equality beside an absence test seeks the path', () => {
  let [small, large] = sessions.map((run) => run())
  equal(small.eids, ['native'])
  equal(large.eids, ['native'])
  ok(
    large.steps < small.steps + 30,
    `${small.steps} then ${large.steps} VM steps for four times the sessions`,
  )
})

test('a path with a broad far end beside a dense spine reads each row once', () => {
  let [small, large] = tasks.map((run) => run())
  equal(small.eids, ['deep'])
  equal(large.eids, ['deep'])
  ok(
    large.steps < small.steps * 8,
    `${small.steps} then ${large.steps} VM steps for four times the rows`,
  )
})
