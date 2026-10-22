// Status decisions that do not need a historical census stay bounded by the turn.
import { equal, ok, test } from '@yaks/testing'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { compile, insert, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { driver } from '../sqlite/native.ts'
import { sessionDoc } from './comp.ts'
import { sessionDerived } from './status.ts'
import { toolsDoc } from '@yaks/tools/vocab'
import { modelDoc } from '@yaks/model'
import { fileDoc } from '@yaks/file/vocab'
import { kernelDoc, kernelKeywords } from '@yaks/kernel'
import { effectDoc } from '@yaks/effects'
import { archetypeDoc } from '@yaks/archetype/vocab'
let vocab = loadVocab([
  sessionDoc,
  toolsDoc,
  modelDoc,
  fileDoc,
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
    for (
      let kind of ['inflight', 'waiting', 'async', 'resolved', 'settled']
    ) {
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
      shape(11, ['entry', 'call', 'tool_async'])
      shape(12, ['entry', 'content', 'tool_progress'])
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
        write('tool_async', { entity: id + 1 })
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
        write('tool_async', { entity: latest + 1 })
        if (kind == 'resolved' || kind == 'settled') {
          entry(latest + 2, seq + 2, 13)
          write('result', { entity: latest + 2, call: latest + 1 })
        }
        if (kind == 'async') {
          entry(latest + 2, seq + 2, 12)
          write('tool_progress', { entity: latest + 2, call: latest + 1 })
          write('content', { entity: latest + 2, body: 'Pending' })
        }
      }
      if (kind == 'settled') {
        entry(latest + 3, seq + 3, 10)
        write('ask', { entity: latest + 3, through: latest + 2 })
        write('attempt', { entity: latest + 3 })
        entry(latest + 4, seq + 4, 14)
        write('output', { entity: latest + 4, source: latest + 3 })
        write('content', { entity: latest + 4, body: 'done' })
      }
      if (kind == 'settled') {
        write('entity', { id: 5, eid: 'other' })
        write('session', { entity: 5, id: 'other' })
        write('entity', { id: 6, eid: 'other-file' })
        shape(15, ['entry', 'stop', 'hidden'])
        shape(16, ['entry', 'notice', 'content', 'lines', 'hidden'])
        for (let i = 0; i < size; i++) {
          let id = 100_000 + i
          write('entity', {
            id,
            eid: `control-${i}`,
            archetype: i % 2 ? 15 : 16,
          })
          write('entry', { entity: id, session: 5, seq: i + 1 })
          write('hidden', { entity: id })
          if (i % 2) write('stop', { entity: id })
          else {
            write('notice', { entity: id })
            write('content', {
              entity: id,
              body: '[Request interrupted by user]',
            })
            write('lines', { entity: id, file: 6, start: i + 1 })
          }
        }
      }
      let q = render(
        compile(
          parse(
            kind == 'settled'
              ? '.entity.eid=owner .session.status=stopped,failed .fields=entity.eid'
              : '.entity.eid=owner .fields=session.status',
          ),
          vocab,
          {
            derived,
            ...scoped ? { visibility: { entity: '!hidden' } } : {},
          },
        ),
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
          kind == 'settled' ? rows : rows[0]['session.status'],
          // A background call runs alone until its Pending or its result.
          kind == 'settled'
            ? []
            : ['inflight', 'waiting'].includes(kind)
            ? 'running'
            : 'pending',
        )
        ok(scan <= (kind == 'settled' ? 1 : 0), `${scan} full-scan steps`)
        ok(
          vm < 5000,
          `${vm} VM steps; ${scan} scans at ${size} historical turns`,
        )
      })
    }
  }
}
