// Mandatory text hits drive a shape-filtered read, including an empty search.
// Walking its archetype owners first read 111,606 rows in Mossvale to find none.
import '../sqlite/sqlitepath.ts'
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { parse } from '@yaks/query'
import { compile, DEPTH, renderStable, VARIABLES } from '@yaks/sql'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { memberDoc } from '../member/comp.ts'
import { privacy } from '../member/privacy.ts'
import { catalog } from '../sqlite/catalog.ts'
import { storage } from '../sqlite/mod.ts'
import { stepping } from '../sqlite/testing.ts'
import { adopt, fields, search } from './mod.ts'

let vocab = loadVocab([archetypeDoc, memberDoc, {
  $defs: {
    entity: { component: true },
    note: {
      component: true,
      properties: { text: { type: 'string', search: true } },
    },
    extra: {
      component: true,
      properties: { text: { type: 'string', search: true } },
    },
    entry: { component: true },
    draft: { component: true },
    other: { component: true },
    quarantined: { component: true, found: false },
  },
}])
let text = fields(vocab)
let visibility = {
  entity: privacy({ owners: [], through: [], floors: [] }).seen(
    'reader',
    'editor',
  ),
}
let world = (n: number) => {
  let { driver: engine, steps } = stepping()
  let db = {
    ...engine,
    query: (s: Parameters<typeof engine.query>[0]) =>
      engine.query(renderStable(s, VARIABLES, DEPTH, engine.stored?.v)),
  }
  let store = storage(db, vocab)
  store.install()
  let g = graph({ storage: store, vocab, plugins: [archetypes()] })
  let note = (eid: string, more = {}) => ({
    entity: { eid },
    note: { text: 'wyrmling' },
    extra: { text: 'hatched' },
    entry: {},
    ...more,
  })
  g.apply([
    { entity: { eid: 'stranger' } },
    note('kept'),
    note('drafted', { draft: {} }),
    note('hidden', { _privacy: { person: 'stranger' } }),
    note('quarantined', { quarantined: {} }),
    note('other', { other: {} }),
    ...Array.from({ length: n }, (_, i) => ({
      entity: { eid: `entry${i}` },
      note: { text: 'dragon' },
      entry: {},
    })),
  ], { trusted: true })
  adopt(db, text)
  db.query({ t: 'analyze' })
  let extend = [search(text, db)]
  return (q: string) => {
    let stmt = compile(parse(q), vocab, {
      archetypes: catalog(db),
      visibility,
      extend,
    })
    return () => {
      let start = steps()
      let rows = db.query(stmt)
      return { eids: rows.map((r) => r.eid).sort(), steps: steps() - start }
    }
  }
}
let small = world(32), large = world(512)
for (let shape of ['!draft !other', '.entry !draft !other']) {
  for (
    let words of ['missing', 'wyrmling missing', 'wyrmling', 'wyrmling hatched']
  ) {
    let query = `${words} ${shape}`
    let readSmall = small(query), readLarge = large(query)
    test(`text beside a shape seeks its hits: ${words} ${shape}`, () => {
      let a = readSmall(), b = readLarge()
      let expected = words.includes('missing') ? [] : ['kept']
      equal(a.eids, expected)
      equal(b.eids, expected)
      ok(
        b.steps < a.steps + 500,
        `${a.steps} then ${b.steps} VM steps for 16 times the owners`,
      )
    })
  }
}
