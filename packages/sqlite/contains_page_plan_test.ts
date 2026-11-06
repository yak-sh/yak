// A page of a substring test is the newest matches, numbered first, by number,
// then the rest by when they were stored; and it costs its page rather than a
// test of every holder's text (@yaks/sql `halved`).
import { equal, ok, test } from '@yaks/testing'
import './sqlitepath.ts'
import { Database } from './legacy.ts'
import { loadVocab } from '@yaks/vocab'
import { compile, insert, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { sqlitePath } from './sqlitepath.ts'

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
    note: { component: true, properties: { text: { type: 'string' } } },
    hidden: { component: true },
    tombstone: { component: true },
  },
}])

// N notes among ten times as many entities, every third numbered, each about
// a dragon. The first five are about a wyrm too, the numbered 6 about one on
// sale at 50% off, and 7 about one at 500. The newest numbered is hidden, and
// the one before it deleted.
let N = 2_000
let numbered = (i: number) => i % 3 == 0
let id = (i: number) => i * 10
let notes = Array.from({ length: N }, (_, n) => n + 1)
let text = (i: number) =>
  `Dragon ${i}${i <= 5 ? ' and a wyrm' : ''}${
    i == 6 ? ' at 50% off' : i == 7 ? ' at 500' : ''
  }`
let db = new Database(':memory:'), d = driver(db)
let store = storage(d, vocab)
store.install()
store.raise()
for (let i = 0; i < N; i += 500) {
  let page = notes.slice(i, i + 500)
  d.query(insert(
    'entity',
    ...page.flatMap((i) =>
      Array.from({ length: 10 }, (_, k) => ({
        id: id(i) - k,
        eid: k ? `e${id(i) - k}` : `n${i}`,
        num: !k && numbered(i) ? i : null,
      }))
    ),
  ))
  d.query(insert(
    'note',
    ...page.map((i) => ({ entity: id(i), text: text(i) })),
  ))
}
d.query(insert('hidden', { entity: id(N) }))
d.query(insert('tombstone', { entity: id(N - 3) }))
// Planned with statistics, as a store that has analyzed its tables is.
d.query({ t: 'analyze' })

let page = (q: string) => {
  let s = render(
    compile(parse(q), vocab, { visibility: { entity: '!hidden' } }),
  )
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
// What a page of `n` holds, from the fixture's own description.
let newest = (holds: (i: number) => boolean, n: number) => {
  let live = notes.filter((i) => holds(i) && i != N && i != N - 3)
  return [
    ...live.filter(numbered).toReversed(),
    ...live.filter((i) => !numbered(i)).toReversed(),
  ].slice(0, n).map((i) => `n${i}`)
}

test('a page of a substring every note holds stops at the page', () => {
  let { eids, steps } = page('.note.text~=dragon .limit=5')
  equal(eids, newest(() => true, 5))
  ok(steps < 2_000, `${steps} VM instructions`)
})

test('a page of a substring a few notes hold takes both halves in order', () => {
  equal(page('.note.text~=WYRM .limit=4').eids, newest((i) => i <= 5, 4))
  equal(page('.note.text~=wyrm .limit=9').eids, newest((i) => i <= 5, 9))
})

test('a substring holding a wildcard matches it literally', () => {
  equal(page('.note.text~="50%" .limit=5').eids, ['n6'])
  equal(page('.note.text~="5_0" .limit=5').eids, [])
})
