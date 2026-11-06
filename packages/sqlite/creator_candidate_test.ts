// A person's few players are found without reading everyone else's: a shape's
// archetype candidates hold every player, so the creator's index, gated by
// the player table's density, still drives them.
import { equal, ok, test } from '@yaks/testing'
import { archetypeDoc } from '@yaks/archetype/vocab'
import { loadVocab } from '@yaks/vocab'
import { parse } from '@yaks/query'
import { compile } from '@yaks/sql'
import { storage } from './mod.ts'
import { catalog } from './catalog.ts'
import { stepping } from './testing.ts'

let vocab = loadVocab([archetypeDoc, {
  $defs: {
    hidden: { component: true, type: 'object' },
    player: { component: true, type: 'object' },
    draft: { component: true, type: 'object' },
    created: {
      component: true,
      type: 'object',
      properties: { by: { type: 'string', ref: 'entity', index: true } },
    },
  },
}])

let { driver, steps } = stepping()
let s = storage(driver, vocab)
s.install()
s.tx((tx) =>
  tx.patch([
    { entity: { eid: 'person' } },
    { entity: { eid: 'other' } },
    { entity: { eid: 'hero' }, player: {}, created: { by: 'person' } },
    { entity: { eid: 'ally' }, player: {}, created: { by: 'person' } },
    ...Array.from({ length: 500 }, (_, i) => ({
      entity: { eid: `stranger-${i}` },
      player: {},
      created: { by: 'other' },
    })),
  ])
)
// A store's other reads hold its archetype catalog, as a live one's do.
s.rows('!hidden !draft')
let players = compile(parse('.player .created.by=person !hidden'), vocab, {
  archetypes: catalog(driver),
  visibility: { entity: '!draft' },
})
driver.query(players)

test("a creator's players cost the same however many others' there are", () => {
  let before = steps()
  let rows = driver.query(players)
  let cost = steps() - before
  equal(rows.map((r) => r.eid).sort(), ['ally', 'hero'])
  ok(cost < 3000, `${cost} VM steps beside 500 others' players`)
})
