// A page of entities none of which has a number is newest by id, and reads
// its page: an edge or an effect is never numbered (@yaks/id's
// `numbers.except`), so sorting by the number read every match to order them
// by the same NULL.
import { equal, ok, test } from '@yaks/testing'
import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { compile, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { census } from './population.ts'
import { sqlitePath } from './sqlitepath.ts'

let status = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: {
    parameters: ['pointer', 'i32', 'i32'],
    result: 'i32',
  },
}).symbols.sqlite3_stmt_status
let vocab = loadVocab([archetypeDoc, {
  $defs: {
    entity: {
      component: true,
      properties: { num: { type: 'number', stamped: true } },
    },
    link: {
      component: true,
      properties: { to: { type: 'string', ref: 'entity' } },
    },
    note: { component: true },
  },
}])

// `n` is a note, numbered; `m` a note made with a link, so unnumbered, as are
// the N links to `t` after it.
let N = 3000
let db = new Database(':memory:'), d = driver(db)
let store = storage(d, vocab, {
  number: { except: ['link'] },
  counts: 'eager',
})
store.install()
let g = graph({ storage: store, vocab, plugins: [archetypes()] })
await g.apply([
  { entity: { eid: 't' }, note: {} },
  { entity: { eid: 'n' }, note: {} },
  { entity: { eid: 'm' }, note: {}, link: { to: 'n' } },
  ...Array.from({ length: N }, (_, i) => ({
    entity: { eid: `l${i}` },
    link: { to: 't' },
  })),
])
let eids = (q: string) => store.rows(q).map((r) => r.eid)
let read = (q: string) => {
  let s = render(compile(parse(q), vocab, { census: census(d) }))
  let stmt = db.prepare(s.sql)
  try {
    stmt.all(...s.params)
    return status(stmt.unsafeHandle, 4, 0)
  } finally {
    stmt.finalize()
  }
}
let newest = Array.from({ length: 5 }, (_, i) => `l${N - 1 - i}`)
// Read twice, the page's statement is kept (@yaks/sql's `compile`).
let page = [eids('.link.to=t&.limit=5'), eids('.link.to=t&.limit=5')]
let steps = { page: read('.link.to=t&.limit=5'), all: read('.link.to=t') }

// Then the numbered note links to `t` too, a shape `m` already has: a number
// again orders the page.
await g.apply([{ entity: { eid: 'n' }, link: { to: 't' } }])
let numbered = eids('.link.to=t&.limit=5')

test('a page of entities with no number is the newest by id', () => {
  equal(page, [newest, newest])
})

test('a page of entities with no number reads its page, not every match', () => {
  ok(steps.page * 20 < steps.all, `${steps.page} VM steps, ${steps.all} all`)
})

test('an entity with a number among them comes first', () => {
  equal(numbered, ['n', ...newest.slice(0, 4)])
})
