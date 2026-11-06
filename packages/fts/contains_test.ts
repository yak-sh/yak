// A `~=` test of a property that keeps a substring index (`contains: true`)
// reads the few rows its index finds for a rare needle, not every value, and
// answers what reading every value would.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { col, compile, eq, insert, render, val } from '@yaks/sql'
import { parse } from '@yaks/query'
import { driver } from '../sqlite/native.ts'
import { storage } from '../sqlite/mod.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import { adopt, CUT, FEW_TEXTS, grams, search } from './mod.ts'

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
}).symbols.sqlite3_stmt_status
let vocab = loadVocab([{
  $defs: {
    entity: {
      component: true,
      properties: { num: { type: 'number', stamped: true } },
    },
    note: {
      component: true,
      properties: { text: { type: 'string', contains: true } },
    },
    tombstone: { component: true },
  },
}])

// N notes, each about a dragon, every third numbered. Notes 7 and 2,000 are
// about a wyrmling too, and a tenth of them about a hoard.
let N = 3_000
let text = (i: number) =>
  `Dragon ${i}${i == 7 || i == 2_000 ? ' and a Wyrmling' : ''}${
    i % 10 ? '' : ' on its hoard'
  }`
let db = new Database(':memory:'), d = driver(db)
let store = storage(d, vocab)
store.install()
store.raise()
let ids = Array.from({ length: N }, (_, n) => n + 1)
d.query(insert(
  'entity',
  ...ids.map((i) => ({ id: i, eid: `n${i}`, num: i % 3 ? null : i })),
))
d.query(insert('note', ...ids.map((i) => ({ entity: i, text: text(i) }))))
let fields = grams(vocab)
adopt(d, fields)
d.query({ t: 'analyze' })

let read = (q: string, filling = false) => {
  let ext = search(fields, d, {
    pending: () => filling ? {} as never : undefined,
  })
  let s = render(compile(parse(q), vocab, { extend: [ext] }))
  let stmt = db.prepare(s.sql)
  try {
    let rows = stmt.all(...s.params) as { eid: string }[]
    return {
      eids: rows.map((r) => r.eid),
      steps: status(stmt.unsafeHandle, 4, 0),
    }
  } finally {
    stmt.finalize()
  }
}

test('a rare needle reads the rows its index finds', () => {
  let { eids, steps } = read('.note.text~=wyrmling .limit=5')
  equal(eids, ['n2000', 'n7'])
  ok(steps < 2_000, `${steps} VM instructions`)
})

test('a needle no row holds reads none of them', () => {
  let { eids, steps } = read('.note.text~=basilisk .limit=5')
  equal(eids, [])
  ok(steps < 500, `${steps} VM instructions`)
})

test('what the index finds is still tested', () => {
  // Each holds "ago" and "on " but not "agon on".
  equal(read('.note.text~="agon on" .limit=5').eids, [])
  equal(read('.note.text~="its hoard" .limit=3').eids, [
    'n3000',
    'n2970',
    'n2940',
  ])
})

test('a common needle, a short one, and an index still filling answer as a read of every value does', () => {
  ok(N / 10 < FEW_TEXTS)
  for (let q of ['dragon', 'Dr', 'hoard', 'wyrmling']) {
    let all = read(`.note.text~=${q} .limit=4`, true).eids
    equal(read(`.note.text~=${q} .limit=4`).eids, all, q)
  }
})

test('the index follows writes', () => {
  d.query({
    t: 'update',
    table: 'note',
    set: { text: val('a basilisk') },
    where: eq(col('entity'), val(7)),
  })
  equal(read('.note.text~=basilisk').eids, ['n7'])
  equal(read('.note.text~=wyrmling').eids, ['n2000'])
})

test('a needle past the text an index holds is still found', () => {
  d.query(insert('entity', { id: N + 1, eid: 'long' }))
  d.query(
    insert('note', { entity: N + 1, text: `${'.'.repeat(CUT)} a wyvern` }),
  )
  equal(read('.note.text~=wyvern').eids, ['long'])
  equal(read('.note.text~=basilisk').eids, ['n7'])
})

test('a file not holding the index yet reads every value', () => {
  let bare = new Database(':memory:'), b = driver(bare)
  let store = storage(b, vocab)
  store.install()
  store.raise()
  b.query(insert('entity', { id: 1, eid: 'n1' }))
  b.query(insert('note', { entity: 1, text: 'a wyrmling' }))
  let ext = search(fields, b)
  equal(
    b.query(compile(parse('.note.text~=wyrmling'), vocab, { extend: [ext] }))
      .map((r) => r.eid),
    ['n1'],
  )
})
