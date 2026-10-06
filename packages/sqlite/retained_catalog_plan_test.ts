import { sqlitePath } from './sqlitepath.ts'
import { equal, ok, test } from '@yaks/testing'
import { Database } from '@db/sqlite'
import { graph } from '@yaks/graph'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { loadVocab } from '@yaks/vocab'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { catalog } from './catalog.ts'
import { compile, render } from '@yaks/sql'
import { parse } from '@yaks/query'

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
test('unbounded retained sound catalog reads grow with catalog, never transcript history', () => {
  let db = new Database(':memory:'), d = driver(db)
  try {
    let vocab = loadVocab([archetypeDoc, {
      $defs: {
        sfx: {
          component: true,
          type: 'object',
          properties: { name: { type: 'string' } },
        },
        doc: {
          component: true,
          type: 'object',
          properties: { title: { type: 'string' } },
        },
      },
    }])
    let s = storage(d, vocab)
    s.install()
    let g = graph({ storage: s, vocab, plugins: [archetypes()] })
    g.apply(
      Array.from(
        { length: 20 },
        (_, n) => ({ entity: { eid: `sound-${n}` }, sfx: { name: String(n) } }),
      ),
    )
    d.query({ t: 'pragma', name: 'optimize', value: 0x10002 })
    for (let start = 0; start < 20000; start += 500) {
      s.tx((tx) =>
        tx.patch(
          Array.from(
            { length: 500 },
            (_, n) => ({
              entity: { eid: `old-${start + n}` },
              doc: { title: 'retained' },
            }),
          ),
        )
      )
    }
    let q = render(compile(parse('.sfx'), vocab, { archetypes: catalog(d) }))
    let stmt = db.prepare(q.sql)
    try {
      equal(stmt.all(...q.params).length, 20)
      let steps = status.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0)
      ok(steps < 1000, `${steps} VM steps\n${q.sql}`)
    } finally {
      stmt.finalize()
    }
  } finally {
    db.close()
  }
})
