// A page of absences alone reads its shapes' owners from the archetype index,
// so a store whose newest rows all wear what it excludes is not walked newest
// first to find the few it keeps (bug 766b671e).
import { archetypeDoc, archetypes } from '@yaks/archetype'
import { graph } from '@yaks/graph'
import { DEPTH, insert, renderStable, VARIABLES } from '@yaks/sql'
import { equal, ok, test } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'
import { memberDoc } from '../member/comp.ts'
import { privacy } from '../member/privacy.ts'
import { storage } from './mod.ts'
import { stepping } from './testing.ts'

let KINDS = Array.from({ length: 7 }, (_, k) => `kind${k}`)
let vocab = loadVocab([archetypeDoc, memberDoc, {
  $defs: Object.fromEntries(
    ['item', 'character', 'effect', 'entry', ...KINDS].map((
      c,
    ) => [c, { component: true }]),
  ),
}])
let visibility = {
  entity: privacy({ owners: [], through: [], floors: [] }).seen(
    'item-1',
    'editor',
  ),
}

// 50 kept rows of `shapes` archetypes, the oldest, under 5,000 newer ones
// the page excludes; planned with statistics, as an analyzed store is.
let made = (shapes: number) => {
  let { driver: engine, steps } = stepping()
  // Rendered as a Durable Object's driver renders, its screen written out as
  // a subquery under workerd's cursor limit (@yaks/durable-object sql.ts).
  let driver = {
    ...engine,
    query: (s: Parameters<typeof engine.query>[0]) =>
      engine.query(renderStable(s, VARIABLES, DEPTH)),
  }
  let store = storage(driver, vocab)
  store.install()
  store.raise()
  let g = graph({ storage: store, vocab, plugins: [archetypes()] })
  let rows = (n: number, comp: string) =>
    Array.from({ length: n }, (_, i) => ({
      entity: { eid: `${comp}-${i}` },
      [comp]: {},
      ...Object.fromEntries(
        KINDS.filter((_, k) => comp == 'item' && ((i % shapes) >> k) & 1)
          .map((kind) => [kind, {}]),
      ),
    }))
  g.apply(rows(Math.max(50, shapes), 'item'))
  g.apply([...rows(4000, 'effect'), ...rows(1000, 'entry')])
  engine.query(insert('_privacy', { entity: 60, person: 2 }))
  engine.query({ t: 'analyze' })
  return { driver, steps }
}

for (let shapes of [1, 100]) {
  let { driver, steps } = made(shapes)
  for (let screened of [false, true]) {
    test(`a ${screened ? 'private' : 'plain'} page of absences over ${shapes} shapes seeks them`, () => {
      let cold = storage({ ...driver }, vocab, { schemaReady: () => true })
      let start = steps()
      let found = cold.rows(
        '!character !effect !entry .limit=50',
        screened ? { visibility } : undefined,
      )
      let cost = steps() - start
      equal(found.length, 50)
      ok(cost < 15_000, `${cost} VM steps for 50 of the oldest rows`)
    })
  }
}
