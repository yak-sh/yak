import './sqlitepath.ts'
import { Database } from '@db/sqlite'
import { equal, ok, test } from '@yaks/testing'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { compile, insert, render } from '@yaks/sql'
import { driver } from './native.ts'
import { storage } from './mod.ts'
import { catalog } from './catalog.ts'
import { reclassify } from './archetype.ts'

// A visitor's page: a screen of platform components (`!person !model …`) beside an
// OR with an indexed value test. The engine refuses a statement whose program
// passes 25,000 steps (workerd: SQLITE_NOMEM), and a statement that carries
// the catalog once per screened component grows with both.
let SCREENED = Array.from(
  { length: 12 },
  (_, i) => `screen${'abcdefghijkl'[i]}`,
)
let WEARS = Array.from({ length: 8 }, (_, i) => `wears${'abcdefgh'[i]}`)
let comp = (extra = {}) => ({ component: true, type: 'object', ...extra })
let vocab = loadVocab([archetypeDoc, {
  $defs: {
    entity: comp(),
    a: comp(),
    draft: comp(),
    b: comp({ properties: { p: { type: 'string', index: true } } }),
    ...Object.fromEntries([...SCREENED, ...WEARS].map((c) => [c, comp()])),
  },
}])

let seeded = (archetypes: number) => {
  let db = new Database(':memory:'), d = driver(db)
  storage(d, vocab, {}).install()
  let ids: string[] = []
  let put = (id: number, eid: string, names: string[]) => {
    d.query(insert('entity', { id, eid }))
    ids.push(eid)
    for (let n of names) {
      d.query(insert(n, { entity: id, ...n == 'b' ? { p: 'x' } : {} }))
    }
  }
  put(1, 'plain-a', ['a'])
  put(2, 'valued-b', ['b'])
  put(3, 'screened-b', ['b', SCREENED[3]])
  for (let i = 0; i < archetypes; i++) {
    put(10 + i, `shape-${i}`, WEARS.filter((_, k) => (i + 1) >> k & 1))
  }
  reclassify(d, ids, false)
  return { db, d }
}

let ask = (archetypes: number, line: string) => {
  let { db, d } = seeded(archetypes)
  catalog(d)({ all: ['a'] }) // an earlier statement has read the catalog
  let q = render(compile(parse(line), vocab, {
    archetypes: catalog(d),
    visibility: { entity: '!draft' },
  }))
  return {
    eids: db.prepare(q.sql).all(...q.params).map((r) => String(r.eid)).sort(),
    steps: db.prepare('explain ' + q.sql).all(...q.params).length,
  }
}

let line = (screened: string[]) =>
  `(.a | .b .b.p=x)&${screened.map((c) => `!${c}`).join('&')}`

test('a screen beside an indexed OR selects the unscreened rows', () => {
  equal(ask(8, line(SCREENED)).eids, ['plain-a', 'valued-b'])
})

test('a screened OR statement stays small however many shapes the catalog holds', () => {
  let { steps } = ask(200, line(SCREENED))
  ok(steps < 1500, `${steps} steps`)
})
