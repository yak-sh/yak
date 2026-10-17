import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { type Bundle, graph } from '@yaks/graph'
import { parse } from '@yaks/query'
import { compile, render } from '@yaks/sql'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { modelDoc } from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from '../session/comp.ts'
import { sessionDerived } from '../session/status.ts'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { sqlitePath } from './sqlitepath.ts'

let counters = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})

// Each lookup has a complete local turn and a thousand unrelated progress
// records. Resolved progress still counts as history; denied progress does not.
for (let typed of [false, true]) {
  let vocab = loadVocab([
    sessionDoc,
    toolsDoc,
    modelDoc,
    kernelDoc,
    ...typed ? [archetypeDoc] : [],
    { $defs: { hidden: { component: true, type: 'object' } } },
  ], [kernelKeywords])
  let db = new Database(':memory:'), d = driver(db)
  let derived = sessionDerived(vocab)
  let s = storage(d, vocab, { derived })
  s.install()
  let g = graph({ storage: s, vocab })
  let rows: Bundle[] = [
    { entity: { eid: 'model' }, model: {} },
    { entity: { eid: 'tool' }, tool: {} },
    { entity: { eid: 'other' }, session: {} },
  ]
  for (let state of ['empty', 'pending', 'completed', 'hidden']) {
    let e = (n: number, comps: Record<string, unknown>): Bundle => ({
      entity: { eid: `${state}-${n}` },
      entry: { session: state, seq: n },
      ...comps,
    })
    rows.push(
      { entity: { eid: state }, session: {} },
      e(1, { content: { body: 'input' }, using: { model: 'model' } }),
      e(2, { ask: { to: 'model', through: `${state}-1` }, attempt: {} }),
    )
    if (state != 'empty') {
      rows.push(
        e(3, { call: { to: 'tool', source: `${state}-2` }, tool_async: {} }),
        e(4, {
          tool_progress: { call: `${state}-3` },
          output: { source: `${state}-3` },
          ...state == 'hidden' ? { hidden: {} } : {},
        }),
        e(5, { ask: { to: 'model', through: `${state}-4` }, attempt: {} }),
      )
      if (state == 'completed') {
        rows.push(e(6, { result: { call: `${state}-3` } }))
      }
    }
  }
  rows.push(...Array.from({ length: 1000 }, (_, n): Bundle => ({
    entity: { eid: `unrelated-${n}` },
    entry: { session: 'other', seq: n + 1 },
    tool_progress: { call: 'tool' },
  })))
  g.apply(rows, { trusted: true })
  for (let scoped of [false, true]) {
    for (
      let [state, expected] of [
        ['empty', 'settled'],
        ['pending', 'running'],
        ['completed', 'pending'],
        ['hidden', scoped ? 'settled' : 'running'],
      ]
    ) {
      let q = render(compile(
        parse(`.entity.eid=${state} .fields=session.status`),
        vocab,
        {
          derived,
          ...scoped ? { visibility: { entity: '!hidden' } } : {},
        },
      ))
      let stmt = db.prepare(q.sql)
      test(`${typed ? 'typed' : 'untyped'} ${scoped ? 'scoped' : 'plain'} ${state} status ignores unrelated progress`, () => {
        let row = stmt.get(...q.params)!
        equal(row['session.status'], expected)
        let scan = counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 1, 1)
        let vm = counters.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 1)
        ok(scan < 100, `${scan} fullscan steps; ${vm} VM steps`)
        ok(vm < 15000, `${vm} VM steps; ${scan} fullscan steps`)
      })
    }
  }
}
