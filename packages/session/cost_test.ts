// What a transcript cost: each request weighed where its usage is written, and
// the session's cost summed from its entries through a SQLite store.

import { assertAlmostEquals, assertEquals } from '@std/assert'
import { type Bundle, type Comp, graph, identityEid } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { storage } from '@yaks/sqlite'
import { mem } from '../sqlite/testing.ts'
import { modelDoc } from '@yaks/model'
import { toolsDoc } from '@yaks/tools/vocab'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { sessionDerived } from './status.ts'

let vocab = loadVocab([sessionDoc, toolsDoc, modelDoc])
let PRICED = identityEid('model', ['priced'])
let FREE = identityEid('model', ['unpriced'])

let shop = () => {
  let s = storage(mem(), vocab, { derived: sessionDerived(vocab) })
  s.install()
  let g = graph({ storage: s, vocab, plugins: [sessions()] })
  g.apply([
    { entity: { eid: 'S' }, session: { id: 'one' } },
    { entity: { eid: 'Q' }, session: { id: 'quiet' } },
    {
      entity: { eid: PRICED },
      model: { name: 'priced' },
      price: { input: 2, cached: 0.5, output: 10 },
    },
    { entity: { eid: FREE }, model: { name: 'unpriced' } },
  ])
  return g
}

let n = 0
let asked = (to: string, more: Bundle | object = {}): Bundle => ({
  entity: { eid: `e${++n}` },
  entry: { session: 'S' },
  ask: { to },
  ...more,
})
let usage = {
  input_tokens: 1_000_000,
  cached_tokens: 500_000,
  output_tokens: 100_000,
}
let costOf = (
  g: ReturnType<typeof shop>,
  eid: string,
) => ((g.get([eid]) as Bundle[])[0]?.cost as Comp | undefined)
let session = (g: ReturnType<typeof shop>, eid: string) =>
  (g.get([eid]) as Bundle[])[0].session as Comp

Deno.test('a request is weighed at its model price unless its provider said', () => {
  let g = shop()
  let weighed = asked(PRICED, { usage })
  let told = asked(PRICED, {
    usage,
    cost: { dollars: 0.01, reported: true },
  })
  let unpriced = asked(FREE, { usage })
  let later = asked(PRICED)
  g.apply([weighed, told, unpriced, later])
  // The usage lands after the ask, on its own; a recorded cost stands.
  g.apply([
    { entity: later.entity, usage },
    { entity: told.entity, usage: { output_tokens: 1 } },
  ])
  assertEquals(costOf(g, weighed.entity.eid), {
    dollars: 0.5 * 2 + 0.5 * 0.5 + 0.1 * 10,
    reported: false,
  })
  assertEquals(costOf(g, told.entity.eid), { dollars: 0.01, reported: true })
  assertEquals(costOf(g, unpriced.entity.eid), undefined)
  assertEquals(costOf(g, later.entity.eid)?.dollars, 2.25)
})

Deno.test("a session's cost is its entries' sum, and absent where none cost", () => {
  let g = shop()
  g.apply([
    asked(PRICED, { usage }),
    asked(PRICED, { usage, cost: { dollars: 0.75, reported: true } }),
    asked(FREE, { usage }),
  ])
  assertAlmostEquals(Number(session(g, 'S').cost), 3)
  assertEquals(session(g, 'Q').cost, null)
  let costly = g.read('.session.cost>1') as Bundle[]
  assertEquals(costly.map((b) => b.entity.eid), ['S'])
})
