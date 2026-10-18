// Status decisions that do not need a historical census stay bounded by the turn.
import { equal, ok, test } from '@yaks/testing'
import { Database } from '@db/sqlite'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { compile, insert, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { driver } from '../sqlite/native.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { sessionDoc } from './comp.ts'
import { sessionDerived } from './status.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { effectDoc } from '@yaks/effects'
import { archetypeDoc } from '@yaks/archetype/vocab'
let vocab = loadVocab([
  sessionDoc,
  toolsDoc,
  modelDoc,
  kernelDoc,
  effectDoc,
  archetypeDoc,
  {
    $defs: { hidden: { component: true, type: 'object' } },
  },
], [kernelKeywords])
let counters = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
for (let size of [100, 1000]) {
  for (let scoped of [false, true]) {
    for (let kind of ['inflight', 'async', 'resolved']) {
      let db = new Database(':memory:')
      let d = driver(db)
      let derived = sessionDerived(vocab)
      storage(d, vocab, { derived }).install()
      let write = (name: string, row: Record<string, string | number>) => {
        let q = render(insert(name, row))
        db.exec(q.sql, ...q.params)
      }
      let shape = (id: number, names: string[]) => {
        write('entity', { id, eid: `shape-${id}` })
        write('archetype', { entity: id, tables: JSON.stringify(names.sort()) })
      }
      shape(10, ['entry', 'ask', 'attempt'])
      shape(11, ['entry', 'call', 'tool_progress'])
      shape(12, ['entry', 'tool_progress'])
      shape(13, ['entry', 'result'])
      shape(14, ['entry', 'content', 'output'])
      write('entity', { id: 1, eid: 'owner' })
      write('session', { entity: 1, id: 'owner' })
      let entry = (id: number, seq: number, archetype: number) => {
        write('entity', { id, eid: `entry-${id}`, archetype })
        write('entry', { entity: id, session: 1, seq })
      }
      for (let i = 0; i < size; i++) {
        let id = 100 + i * 4, seq = i * 4 + 1
        entry(id, seq, 10)
        write('ask', { entity: id, through: id })
        write('attempt', { entity: id })
        entry(id + 1, seq + 1, 11)
        write('call', { entity: id + 1, source: id })
        write('tool_progress', { entity: id + 1, call: id + 1 })
        entry(id + 2, seq + 2, 13)
        write('result', { entity: id + 2, call: id + 1 })
        entry(id + 3, seq + 3, 14)
        write('output', { entity: id + 3, source: id })
        write('content', { entity: id + 3, body: 'done' })
      }
      db.exec('ANALYZE')
      let latest = 100 + size * 4, seq = size * 4 + 1
      entry(latest, seq, 10)
      write('ask', { entity: latest, through: latest - 1 })
      write('attempt', {
        entity: latest,
        ...kind == 'inflight' ? { by: 1 } : {},
      })
      if (kind != 'inflight') {
        entry(latest + 1, seq + 1, 11)
        write('call', { entity: latest + 1, source: latest })
        write('tool_progress', { entity: latest + 1, call: latest + 1 })
        if (kind == 'resolved') {
          entry(latest + 2, seq + 2, 13)
          write('result', { entity: latest + 2, call: latest + 1 })
        }
      }
      let q = render(
        compile(parse('.entity.eid=owner .fields=session.status'), vocab, {
          derived,
          ...scoped ? { visibility: { entity: '!hidden' } } : {},
        }),
      )
      let st = db.prepare(q.sql)
      st.all(...q.params)
      test(`${scoped ? 'scoped' : 'plain'} ${kind} status ignores ${size} resolved historical turns`, () => {
        counters.symbols.sqlite3_stmt_status(st.unsafeHandle, 4, 1)
        counters.symbols.sqlite3_stmt_status(st.unsafeHandle, 1, 1)
        let rows = st.all(...q.params)
        let vm = counters.symbols.sqlite3_stmt_status(st.unsafeHandle, 4, 1)
        let scan = counters.symbols.sqlite3_stmt_status(st.unsafeHandle, 1, 1)
        equal(
          rows[0]['session.status'],
          kind == 'inflight' ? 'running' : 'pending',
        )
        equal(scan, 0)
        ok(
          vm < 5000,
          `${vm} VM steps; ${scan} scans at ${size} historical turns`,
        )
      })
    }
  }
}
