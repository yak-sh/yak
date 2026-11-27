// A rule asked of a batch costs what the batch touches, whatever the file
// holds. Each rule here runs over the same batch on a file of ten products and
// on one of three hundred, and must take the same number of SQLite steps on
// both: a statement that copies an overlaid table, or walks one, takes more on
// the larger file. Steps are counted by SQLite (`sqlite3_stmt_status`), since
// a wall clock only says how loaded the machine is.
import './sqlitepath.ts'
import { Database } from './legacy.ts'
import { match, reads } from '@yaks/graph'
import type { Bundle } from '@yaks/graph'
import { type Driver, render, type Row, type Stmt } from '@yaks/sql'
import { equal, test } from '@yaks/testing'
import { storage } from './mod.ts'
import { driver } from './native.ts'
import { bindings } from './rules.ts'
import { shop } from './testing.ts'
import { sqlitePath } from './sqlitepath.ts'

let counters = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
let VM_STEP = 4

// A file of `size` products, each with a title and a body, all made by p0.
let file = (size: number) => {
  let db = new Database(':memory:'), d = driver(db)
  let s = storage(d, shop)
  s.install()
  s.raise()
  s.tx((tx) =>
    tx.patch(Array.from({ length: size }, (_, i) => ({
      entity: { eid: `p${i}` },
      doc: { title: `t${i}`, body: 'b' },
      product: { price: i, maker: 'p0' },
    })))
  )
  return { db, d }
}

// The bindings `rule` finds over `batch`, and the steps its statements took.
let cost = (size: number, rule: string, batch: Bundle[]) => {
  let { db, d } = file(size)
  let steps = 0
  let counted: Driver = {
    ...d,
    query: (s: Stmt): Row[] => {
      let text = render(s)
      if (!text.sql.includes('__touched')) return d.query(s)
      let stmt = db.prepare(text.sql)
      try {
        let rows = stmt.all(...text.params) as Row[]
        steps += counters.symbols.sqlite3_stmt_status(
          stmt.unsafeHandle,
          VM_STEP,
          0,
        )
        return rows
      } finally {
        stmt.finalize()
      }
    },
  }
  let m = match(rule)
  let found = bindings(counted, shop, [m], batch, [...new Set(reads(m, shop))])
  return { found: found[0].map((b) => b.entities), steps }
}

let cases: [string, Bundle[], (string | null)[][]][] = [
  // a fresh entity, its doc read twice: a title, and a body it lacks
  ['$d .doc.title=wf, !doc.body', [
    { entity: { eid: 'new' }, doc: { title: 'wf' } },
  ], [['new']]],
  // a patch to a committed row, and a gate
  ['.product.price>5, +!shelf', [
    { entity: { eid: 'p7' }, product: { price: 99 } },
  ], [['p7']]],
  // two patterns anchored together, joined by a reference
  ['$p .product; .review, review.product=$p', [
    { entity: { eid: 'r1' }, review: { stars: 3, product: 'p5' } },
  ], [['p5', 'r1']]],
]

test('a rule asked of a batch costs the batch, whatever the file holds', () => {
  for (let [rule, batch, expected] of cases) {
    let small = cost(10, rule, batch), large = cost(300, rule, batch)
    equal([rule, small.found], [rule, expected])
    equal([rule, large.found], [rule, expected])
    equal([rule, large.steps], [rule, small.steps])
  }
})
