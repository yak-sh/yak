// A backlink page is the newest referrers, numbered first, by number, then the
// rest by when they were stored; and for an entity many hold a reference to,
// it costs its page rather than every referrer (@yaks/sql `lower`).
import { equal, ok, test } from '@yaks/testing'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
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
let to = { type: 'string', ref: 'entity' }
let vocab = loadVocab([{
  $defs: {
    entity: {
      component: true,
      properties: { num: { type: 'number', stamped: true } },
    },
    link: { component: true, properties: { to } },
    pin: { component: true, properties: { to, also: to } },
    hidden: { component: true },
    tombstone: { component: true },
  },
}])

// Three targets and N referrers after them: every referrer links to `t`, and
// every third is numbered. Those with no number pin `u`, and so do the
// numbered 3, 6 and 9; 1 to 5 pin `few` as well. The newest numbered is
// hidden, and the one before it deleted.
let N = 16_500
let id = (i: number) => i + 3
let numbered = (i: number) => i % 3 == 0
let referrers = Array.from({ length: N }, (_, n) => n + 1)
let db = new Database(':memory:'), d = driver(db)
storage(d, vocab).install()
d.query(insert(
  'entity',
  ...['t', 'u', 'few'].map((eid, i) => ({
    id: i + 1,
    eid,
  })),
))
for (let i = 0; i < N; i += 500) {
  let page = referrers.slice(i, i + 500)
  d.query(insert(
    'entity',
    ...page.map((i) => ({
      id: id(i),
      eid: `r${i}`,
      num: numbered(i) ? i : null,
    })),
  ))
  d.query(insert('link', ...page.map((i) => ({ entity: id(i), to: 1 }))))
  let pinned = page.filter((i) => !numbered(i) || i <= 9)
  d.query(insert(
    'pin',
    ...pinned.map((i) => ({ entity: id(i), to: 2, also: i <= 5 ? 3 : null })),
  ))
}
d.query(insert('hidden', { entity: id(N) }))
d.query(insert('tombstone', { entity: id(N - 3) }))

let page = (q: string, scoped = true) => {
  let s = render(compile(parse(q), vocab, {
    visibility: scoped ? { entity: '!hidden' } : undefined,
  }))
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
let newest = (holds: (i: number) => boolean, n: number, gone: number[]) => {
  let live = referrers.filter((i) => holds(i) && !gone.includes(i))
  let first = live.filter(numbered).toReversed()
  let rest = live.filter((i) => !numbered(i)).toReversed()
  return [...first, ...rest].slice(0, n).map((i) => `r${i}`)
}
// Each read, and what it should find, is taken once beside the fixture: the
// tests compare them.
let all = page('.refs=t')
let found = [
  page('.refs=t&.limit=13'),
  page('.refs=t&.limit=13', false),
  page('.refs=u&.limit=13'),
]
let wanted = [
  newest(() => true, 13, [N, N - 3]),
  newest(() => true, 13, [N - 3]),
  newest((i) => !numbered(i) || i <= 9, 13, []),
]
let few = page('.refs=few&.limit=13')

test('a backlink page over many referrers is the newest, numbered first', () => {
  equal(found.map((f) => f.eids), wanted)
})

test('a backlink page over few referrers is the newest, numbered first', () => {
  equal(few.eids, ['r3', 'r5', 'r4', 'r2', 'r1'])
})

test('a backlink page over many referrers reads its page, not all of them', () => {
  let { steps } = found[0]
  ok(steps * 2 < all.steps, `${steps} VM steps, ${all.steps} for all`)
})
