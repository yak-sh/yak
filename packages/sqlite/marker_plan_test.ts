// A sparse marker must not start from a shared author on every historical row.
import { ok, test } from '@yaks/testing'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { loadVocab } from '@yaks/vocab'
import { compile, insert, render } from '@yaks/sql'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { parse } from '@yaks/query'
import { catalog } from './catalog.ts'
import { storage } from './mod.ts'
import { driver } from './native.ts'
import { sqlitePath } from './sqlitepath.ts'

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
test('indexed disjunction arms seek referents despite shared history', () => {
  let db = new Database(':memory:'), d = driver(db)
  try {
    let vocab = loadVocab([archetypeDoc, {
      $defs: {
        entity: { component: true, type: 'object' },
        player: { component: true, type: 'object' },
        person: { component: true, type: 'object' },
        created: {
          index: [['by']],
          component: true,
          type: 'object',
          properties: {
            by: { type: 'string', ref: 'person', index: true },
          },
        },
      },
    }])
    let store = storage(d, vocab)
    store.install()
    d.query(insert('entity', { id: 1, eid: 'author' }))
    d.query(insert('person', { entity: 1 }))
    let add = (start: number, n: number) => {
      for (let i = start; i < start + n; i += 500) {
        let ids = Array.from(
          { length: Math.min(500, start + n - i) },
          (_, j) => i + j,
        )
        store.tx((tx) =>
          tx.patch(ids.map((id) => ({
            entity: { eid: `e${id}` },
            created: { by: 'e3' },
          })))
        )
      }
    }
    d.query(insert('entity', { id: 2, eid: 'e2' }, { id: 3, eid: 'e3' }))
    d.query(insert('created', { entity: 2, by: 1 }, { entity: 3, by: 1 }))
    d.query(insert('player', { entity: 2 }, { entity: 3 }))
    let g = graph({ storage: store, vocab, plugins: [archetypes()] })
    g.apply([{ entity: { eid: 'e2' }, player: {} }, {
      entity: { eid: 'e3' },
      player: {},
    }])
    d.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
    add(1000, 100)
    let sql = render(
      compile(parse('.created.by=author|.created.by=e2'), vocab, {
        archetypes: catalog(d),
      }),
    )
    for (let n of [100, 20_000]) {
      if (n > 100) add(1100, n - 100)
      let stmt = db.prepare(sql.sql)
      try {
        ok(stmt.all(...sql.params).length >= 2)
        let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
        ok(steps < 300, `${n} history rows: ${steps} VM steps\n${sql.sql}`)
      } finally {
        stmt.finalize()
      }
    }
  } finally {
    db.close()
  }
})
