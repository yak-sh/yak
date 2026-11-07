// A `~=` test of a property that keeps a substring index (`contains: true`)
// reads the few rows its index finds for a rare needle, not every value, and
// answers what reading every value would.
import '../sqlite/sqlitepath.ts'
import { Database } from '@yaks/sqlite/testing'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { col, compile, type Driver, eq, insert, render, val } from '@yaks/sql'
import { parse } from '@yaks/query'
import { driver } from '../sqlite/native.ts'
import { storage } from '../sqlite/mod.ts'
import { sqlitePath } from '../sqlite/sqlitepath.ts'
import {
  adopt,
  CUT,
  FEW_TEXTS,
  grams,
  heal,
  pieces,
  search,
  SPAN,
} from './mod.ts'

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

// A store of one short note and one long one, three pieces past what the
// substring index holds: a wyvern in the first piece, a griffin across the
// end of the first CUT, a cockatrice across where the first piece ends, and a
// manticore in the last. And what a test of a needle reads of its texts.
let long = () => {
  let db = driver(new Database(':memory:'))
  let store = storage(db, vocab)
  store.install()
  store.raise()
  db.query(insert('entity', { id: 1, eid: 'short' }, { id: 2, eid: 'long' }))
  let dots = (n: number) => '.'.repeat(n)
  let text = `${dots(CUT - 3)}griffin${dots(CUT - 2 * SPAN)} a wyvern ` +
    `${dots(2 * SPAN - 23)}cockatrice${dots(CUT)} a manticore`
  db.query(insert('note', { entity: 1, text: 'a hydra' }, { entity: 2, text }))
  adopt(db, fields)
  let ext = search(fields, db)
  let reads = (needle: string) => {
    ext.begin?.({} as never, { kind: 'and', clauses: [] })
    let { owners } = ext.contains!('note', 'text', needle)!
    return db.query(owners).map((r) => Number(Object.values(r)[0])).sort()
  }
  return { db, reads }
}

// Every piece owed, made a window at a time: how many windows it took.
let made = (db: Driver) => {
  let n = 0
  while (pieces(db, fields)) n++
  return n
}

let tailed = long()

test('a long text is read whole until its pieces are made, then only what they hold', () => {
  let { db, reads } = tailed
  equal(reads('basilisk'), [2])
  equal(made(db), 3)
  equal(made(db), 0)
  equal(
    ['basilisk', 'hydra', 'wyvern', 'griffin', 'cockatrice', 'manticore']
      .map(reads),
    [[], [1], [2], [2], [2], [2]],
  )
})

test('a tail index that drifted is emptied, its texts owed again', () => {
  let { db, reads } = tailed
  made(db)
  db.query({ t: 'delete', from: 'note_trigram_piece' })
  equal(heal(db, fields), ['note_trigram_tail'])
  equal([reads('basilisk'), made(db), reads('basilisk')], [[2], 3, []])
})

test('a long text that changes is owed its pieces again, and one that goes takes them', () => {
  let { db, reads } = long()
  made(db)
  let write = (text: string) =>
    db.query({
      t: 'update',
      table: 'note',
      set: { text: val(text) },
      where: eq(col('entity'), val(2)),
    })
  write(`${'.'.repeat(CUT)} a basilisk`)
  equal([reads('wyvern'), reads('chimera')], [[2], [2]])
  equal(made(db), 1)
  equal([reads('wyvern'), reads('basilisk'), reads('chimera')], [[], [2], []])
  write('a chimera')
  equal([reads('basilisk'), reads('chimera')], [[], [2]])
  db.query({ t: 'delete', from: 'note', where: eq(col('entity'), val(2)) })
  equal([reads('chimera'), made(db)], [[], 0])
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
