import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { equal, ok, test } from '@yaks/testing'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { compile, insert, render } from '@yaks/sql'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { catalog } from './catalog.ts'
import { reclassify } from './archetype.ts'
import { sqlitePath } from './sqlitepath.ts'

let counters = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
let makeVocab = (numbered: boolean) =>
  loadVocab([archetypeDoc, {
    $defs: {
      entity: {
        component: true,
        type: 'object',
        ...numbered ? { properties: { num: { type: 'integer' } } } : {},
      },
      session: { component: true, type: 'object' },
      notified: { component: true, type: 'object' },
      tombstone: { component: true, type: 'object' },
      hidden: { component: true, type: 'object' },
      comment: {
        component: true,
        type: 'object',
        properties: {
          target: { type: 'string', ref: 'entity', index: true },
        },
      },
      created: {
        component: true,
        type: 'object',
        properties: {
          via: { type: 'string', ref: 'entity', index: true },
        },
      },
    },
  }])

// Seed physical SQL rows, rather than graph provenance: created.via is the
// stored reference being measured, not the writer of this test fixture.
for (let numbered of [false, true]) {
  for (let size of [100, 1000]) {
    let vocab = makeVocab(numbered)
    let db = new Database(':memory:'), d = driver(db)
    let s = storage(d, vocab, { number: numbered })
    s.install()
    let ids: string[] = []
    let put = (
      id: number,
      eid: string,
      components: Record<string, Record<string, number | null>>,
    ) => {
      d.query(insert('entity', { id, eid }))
      ids.push(eid)
      for (let [name, props] of Object.entries(components)) {
        d.query(insert(name, { entity: id, ...props }))
      }
    }
    put(1, 'session', { session: {} })
    put(2, 'target', { created: { via: 1 } })
    put(3, 'wanted', { comment: { target: 2 } })
    put(4, 'own-comment', { comment: { target: 2 }, created: { via: 1 } })
    put(5, 'hidden-comment', { comment: { target: 2 }, hidden: {} })
    reclassify(d, ids, numbered)
    db.exec('ANALYZE')
    ids = []
    for (let i = 0; i < size; i++) {
      put(i + 100000, `notified-${i}`, {
        comment: { target: 2 },
        notified: {},
        created: { via: null },
      })
    }
    reclassify(d, ids, numbered)
    catalog(d)({ all: ['comment'] })
    for (let scoped of [false, true]) {
      let q = render(compile(
        parse(
          '.comment .comment.target.created.via.session !created.via.session !notified',
        ),
        vocab,
        {
          archetypes: catalog(d),
          ...scoped ? { visibility: { entity: '!hidden' } } : {},
        },
      ))
      let statement = db.prepare(q.sql)
      statement.all(...q.params)
      test(`${numbered ? 'numbered' : 'unnumbered'} ${scoped ? 'scoped' : 'plain'} pending comments ignore ${size} notified owners`, () => {
        counters.symbols.sqlite3_stmt_status(statement.unsafeHandle, 1, 1)
        counters.symbols.sqlite3_stmt_status(statement.unsafeHandle, 4, 1)
        let rows = statement.all(...q.params)
        let scan = counters.symbols.sqlite3_stmt_status(
          statement.unsafeHandle,
          1,
          1,
        )
        let vm = counters.symbols.sqlite3_stmt_status(
          statement.unsafeHandle,
          4,
          1,
        )
        equal(
          rows.map((row) => row.eid).sort(),
          scoped ? ['wanted'] : ['hidden-comment', 'wanted'],
        )
        equal(scan, 0)
        ok(vm < 2000, `${vm} VM steps; ${scan} fullscan steps`)
      })
    }
  }
}
