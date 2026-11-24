import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { idDoc } from '@yaks/id'
import { parse } from '@yaks/query'
import { compile } from '@yaks/sql'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { catalog } from './catalog.ts'
import { storage } from './mod.ts'
import { stepping } from './testing.ts'

let vocab = loadVocab([
  {
    $defs: {
      entity: { component: true, properties: { eid: { type: 'string' } } },
      app: { component: true, kind: true },
      space: { component: true, kind: true },
      listed: { component: true },
      history: { component: true },
    },
  },
  idDoc,
  archetypeDoc,
])
let { driver, steps } = stepping()
let store = storage(driver, vocab)
store.install()
let g = graph({ storage: store, vocab, plugins: [archetypes()] })
g.apply([
  { entity: { eid: 'later', num: 8 }, space: {} },
  { entity: { eid: 'both', num: 3, prefix: 'A' }, app: {}, space: {} },
  { entity: { eid: 'tie', num: 3, prefix: 'S' }, space: {}, listed: {} },
  { entity: { eid: 'first', num: 1 }, app: {}, listed: {} },
  { entity: { eid: 'grave', num: 2 }, app: {} },
], { trusted: true })
g.apply([{ entity: { eid: 'grave' }, $delete: true }], { trusted: true })
for (let at = 0; at < 4000; at += 500) {
  g.apply(Array.from({ length: 500 }, (_, i) => ({
    entity: { eid: `history-${at + i}` },
    history: {},
  })))
}
driver.query({ t: 'analyze' })

for (
  let [name, filter] of [
    ['kind listing', '(.kind=app|.kind=space)&.fields=entity.eid'],
    ['directory listing', '.space|.app&?space ?app ?trashed ?installed ?doc'],
  ]
) {
  let q = compile(parse(filter), vocab, {
    archetypes: catalog(driver),
    stable: true,
  })
  test(`a complete numbered ${name} reads only its matching archetypes`, () => {
    let before = steps()
    equal(driver.query(q).map((r) => r.eid), ['first', 'both', 'tie', 'later'])
    let cost = steps() - before
    ok(cost < 500, `${cost} VM steps for four directory rows`)
  })
}
