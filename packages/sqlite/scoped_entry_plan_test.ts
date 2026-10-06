// A bounded window must drive from its finite identities, not re-sort every
// old entry belonging to the same session.
import { ok, test } from '@yaks/testing'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { loadVocab } from '@yaks/vocab'
import { compile, insert, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { sqlitePath } from './sqlitepath.ts'
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
test('finite entry window identities do not sort their unbounded session', () => {
  let db = new Database(':memory:'), d = driver(db)
  try {
    let v = loadVocab({
      $defs: {
        entry: {
          component: true,
          type: 'object',
          index: [['session', 'seq']],
          properties: {
            session: { type: 'string', ref: 'entity' },
            seq: { type: 'integer' },
          },
        },
        created: {
          component: true,
          type: 'object',
          properties: { at: { type: 'string', index: true } },
        },
      },
    })
    storage(d, v).install()
    d.query(insert('entity', { id: 1, eid: 'session' }))
    for (let n = 2; n < 20002; n++) {
      d.query(insert('entity', { id: n, eid: `e${n}` }))
      d.query(insert('entry', { entity: n, session: 1, seq: n }))
      d.query(insert('created', { entity: n, at: `${n}` }))
    }
    let q = render(
      compile(
        parse(
          '.entry.session=session&?created&.order=-created.at&.limit=2&.entity.eid=e2,e3,e4',
        ),
        v,
      ),
    )
    let s = db.prepare(q.sql)
    try {
      ok(s.all(...q.params).length == 2)
      let steps = status.symbols.sqlite3_stmt_status(s.unsafeHandle, 4, 0)
      ok(steps < 500, `${steps} VM steps\n${q.sql}`)
    } finally {
      s.finalize()
    }
  } finally {
    db.close()
  }
})
