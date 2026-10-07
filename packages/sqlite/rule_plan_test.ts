// A rule asked about a batch costs the batch, not the tables its match reads.
import { ok, test } from '@yaks/testing'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { type Bundle, match, reads } from '@yaks/graph'
import { render, rule } from '@yaks/sql'
import { storage } from './mod.ts'
import { driver } from './native.ts'
import { overlay } from './overlay.ts'
import { sqlitePath } from './sqlitepath.ts'
import { shop } from './testing.ts'

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
let VM_STEP = 4

test('a rule match starts from the entities the batch wrote', () => {
  let db = new Database(':memory:'), d = driver(db)
  try {
    let s = storage(d, shop)
    s.install()
    let add = (from: number, n: number) =>
      s.tx((tx) =>
        tx.patch(Array.from({ length: n }, (_, i) => ({
          entity: { eid: `p${from + i}` },
          product: { price: 1 },
        })))
      )
    let m = match('.product, +!shelf')
    let batches: Bundle[][] = [
      [{ entity: { eid: 'p7' }, doc: { title: 'Mug' } }],
      [{ entity: { eid: 'p7' }, doc: { title: 'Mug' } }, {
        entity: { eid: 'p8' },
        $delete: true,
      }],
    ]
    add(0, 100)
    for (let n of [100, 5000]) {
      if (n > 100) add(100, n - 100)
      for (let batch of batches) {
        let over = overlay(d, shop, batch, reads(m, shop))
        let sql = render({
          ...rule(m, shop, {}, {
            at: over.at,
            gone: over.gone,
            touched: [...over.ids.values()],
          }),
          with: over.with,
        })
        let stmt = db.prepare(sql.sql)
        try {
          ok(stmt.all(...sql.params).length == 1)
          let steps = status.symbols.sqlite3_stmt_status(
            stmt.unsafeHandle,
            VM_STEP,
            0,
          )
          ok(steps < 300, `${n} products: ${steps} VM steps\n${sql.sql}`)
        } finally {
          stmt.finalize()
        }
      }
    }
  } finally {
    db.close()
  }
})
