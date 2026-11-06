// A limited read of a shape stops at its page, however many owners match,
// how many archetypes they spread over, or how many newer owners its absences
// screen out.
import { sqlitePath } from './sqlitepath.ts'
import { Database } from './legacy.ts'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { type Bundle, graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { type BindOpts, compile, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { cleanup, equal, ok, test } from '@yaks/testing'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { catalog } from './catalog.ts'

let spreads = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
let names = ['doc', 'cost', 'screened', 'secret', 'other', ...spreads]
let vocab = loadVocab([archetypeDoc, {
  $defs: Object.fromEntries(
    names.map((n) => [n, { component: true, type: 'object' }]),
  ),
}])
let native = Deno.dlopen(sqlitePath, {
  sqlite3_stmt_status: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
  sqlite3_limit: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
})
cleanup(() => native.close())

let rows = (n: number, name: string, comps: (i: number) => object) =>
  Array.from(
    { length: n },
    (_, i) => ({ entity: { eid: `${name}-${i}` }, ...comps(i) }),
  )

// A store holding `bundles`, and a read of `q` that answers its eids and the
// VM instructions its statement took.
let store = (bundles: Bundle[]) => {
  let db = new Database(':memory:'), sql = driver(db)
  // Workerd's SQLite takes five terms in a compound SELECT
  // (SQLITE_LIMIT_COMPOUND_SELECT is 4).
  native.symbols.sqlite3_limit(db.unsafeHandle, 4, 5)
  let s = storage(sql, vocab)
  s.install()
  graph({ storage: s, vocab, plugins: [archetypes()] }).apply(bundles)
  cleanup(() => db.close())
  return (q: string, visibility?: BindOpts['visibility']) => {
    let { sql: text, params } = render(compile(parse(q), vocab, {
      archetypes: catalog(sql),
      visibility,
    }))
    let stmt = db.prepare(text)
    try {
      let eids = stmt.all(...params).map((r) => r.eid)
      return {
        eids,
        vm: native.symbols.sqlite3_stmt_status(stmt.unsafeHandle, 4, 0),
      }
    } finally {
      stmt.finalize()
    }
  }
}

// Owners the screen admits, then newer ones it leaves out, the way an app
// store's description rows sit above its own docs.
let screened = store([
  ...rows(1000, 'shown', () => ({ doc: {}, cost: {} })),
  { entity: { eid: 'mine' }, doc: {}, other: {} },
  { entity: { eid: 'theirs' }, doc: {}, other: {} },
  { entity: { eid: 'hush' }, doc: {}, secret: {} },
  ...rows(3000, 'screened', () => ({ doc: {}, screened: {} })),
])
for (
  let [name, visibility, expected] of [
    ['scoped', { entity: '!secret' }, [
      'shown-999',
      'shown-998',
      'shown-997',
      'shown-996',
      'shown-995',
    ]],
    // Only `theirs` wears an `other` this reader sees.
    ['masked', {
      entity: '!secret',
      components: { other: '.entity.eid=theirs' },
    }, ['mine', 'shown-999', 'shown-998', 'shown-997', 'shown-996']],
  ] as const
) {
  test(`a limited screened read stops at its page (${name})`, () => {
    let { eids, vm } = screened('.doc !screened !other .limit=5', visibility)
    equal(eids, [...expected])
    ok(vm < 20_000, `${vm} instructions`)
  })
}

// Owners of one component spread over more archetypes than a compound holds
// terms, interleaved in time: each archetype's owners lie in the answer's
// order, but no one of them holds the page.
let spread = (n: number) =>
  store([
    ...rows(n, 'spread', (i) => ({
      doc: {},
      [spreads[i % spreads.length]]: {},
    })),
    ...rows(n, 'screened', () => ({ doc: {}, screened: {} })),
  ])

test('a limited read over several archetypes does not grow with the store', () => {
  let read = (n: number) =>
    spread(n)('.doc !screened .limit=5', { entity: '!secret' })
  let small = read(50), large = read(400)
  equal(large.eids, [399, 398, 397, 396, 395].map((i) => `spread-${i}`))
  ok(
    large.vm < small.vm * 1.2,
    `${small.vm} instructions for 50 owners, ${large.vm} for 400`,
  )
})
