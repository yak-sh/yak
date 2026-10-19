// A caller's screen admits nearly every entity in the graph, so a vector read
// through it must reach its owner by key. Listing the screen first made each
// semantic read on the box cost seconds once the graph held millions.
import { test } from '@yaks/testing'
import { compile } from '@yaks/sql'
import { parse } from '@yaks/query'
import { semantic } from './compile.ts'
import { assert, assertEquals } from '@std/assert'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { Database } from '@db/sqlite'
import { type Driver, insert, render } from '@yaks/sql'
import { statements } from '@yaks/sqlite'
import { driver } from '../sqlite/native.ts'
import { fields } from './fields.ts'
import { vectorOf } from './near.ts'
import { sweep } from './sweep.ts'
import { embedder, shelf, shop } from './testing.ts'
import { visibleVectors } from './visibility.ts'

// SQLite's own count of the instructions a statement ran, not the rows it
// returned: a screen read whole costs steps however few rows come back.
let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
}).symbols.sqlite3_stmt_status
let native = new Database(':memory:')
let plain = driver(native)
let steps = 0
let counted: Driver = {
  ...plain,
  query: (s) => {
    if (s.t != 'select') return plain.query(s)
    let text = render(s), stmt = native.prepare(text.sql)
    try {
      let rows = stmt.all(...text.params)
      steps += status(stmt.unsafeHandle, 4, 0)
      return rows
    } finally {
      stmt.finalize()
    }
  },
}
let db = shelf(statements(counted))
await sweep(db, fields(shop), embedder)

let caller = visibleVectors(shop, fields(shop), {
  entity: '.entity.eid!=book-3',
})
let anchor = (eid: string) => {
  steps = 0
  let found = vectorOf(db, eid, embedder.model, caller)
  return { found: !!found, steps }
}
let small = anchor('book-1')
let more = 2000
for (let i = 0; i < more; i += 500) {
  plain.query(insert(
    'entity',
    ...Array.from({ length: 500 }, (_, j) => {
      let id = 1000 + i + j
      return { id, eid: `filler-${id}`, num: id }
    }),
  ))
}

test("a caller's anchor costs the same however many entities the graph holds", () => {
  let large = anchor('book-1')
  assertEquals([small.found, large.found], [true, true])
  assert(large.steps - small.steps < more, `${small.steps} -> ${large.steps}`)
  assertEquals(anchor('book-3').found, false)
})

// Entity policy already belongs to the compiler's candidate selection.
let cost = (q: Parameters<typeof render>[0]) => {
  let text = render(q), stmt = native.prepare(text.sql)
  try {
    let rows = stmt.all(...text.params)
    return { rows, steps: status(stmt.unsafeHandle, 4, 0) }
  } finally {
    stmt.finalize()
  }
}
let policyOpts = { visibility: { entity: '.book.price>0' } }
let observedPolicy = {
  before: cost(compile(parse('.entity'), shop, policyOpts)).steps,
  after: 0,
  ids: [] as string[],
}
let policyNear = semantic(db, embedder, {
  rank: (_query, _limit, within) => {
    let got = cost(within!)
    observedPolicy.after = got.steps
    let ids = new Set(got.rows.map((r) => Number(r.id)))
    return [2, 3].filter((owner) => ids.has(owner)).map((owner) => ({
      owner,
      entity: `book-${owner}`,
      similarity: 1 - owner / 10,
    }))
  },
})
observedPolicy.ids = plain.query(
  compile(parse('.entity .near=book-1'), shop, {
    ...policyOpts,
    extend: [policyNear],
  }),
).map((r) => String(r.eid))
test('semantic ranking does not repeat an entity policy already in its screen', () => {
  assertEquals(observedPolicy.ids, ['book-2', 'book-3'])
  assert(
    observedPolicy.after <= observedPolicy.before + 20,
    `${observedPolicy.before} -> ${observedPolicy.after} VM steps`,
  )
})
