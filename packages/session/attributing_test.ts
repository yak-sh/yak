// Whose a mark is, when the write naming somebody came through a door.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Comp, graph } from '@yaks/graph'
import { kernel, kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { sessionDoc } from './comp.ts'
import { sessions } from './plugin.ts'
import { standIn } from './who.ts'

let vocab = loadVocab([kernelDoc, provenanceDoc, sessionDoc])
let g = graph({
  vocab,
  storage: ram(vocab),
  plugins: [kernel(), sessions()],
})
await g.apply(
  [
    ...['owner', 'agent', 'persona'].map((eid) => ({
      entity: { eid },
      favorite: {},
    })),
    { entity: { eid: 'run' }, session: {} },
  ],
  { trusted: true },
)
// Who a decision naming the owner is by, written as `$actor`.
let decidedBy = async (eid: string, $actor: { by: string; via?: string }) => {
  await g.apply([{
    entity: { eid },
    decided: { verdict: 'approved' },
    $decider: 'owner',
    $actor,
  }])
  return ((await g.get([eid]))[0].decided as Comp).by
}

test("a decider named through a door's session is dropped, and one named through the graph's own run is kept", async () => {
  let hosted = await standIn(g, 'tunnel', 'a conversation', 'persona')
  assertEquals(await decidedBy('through', hosted as { by: string }), 'persona')
  assertEquals(await decidedBy('own', { by: 'agent', via: 'run' }), 'owner')
})

test('a session that stood at a door before it was said to learns it on the next request', async () => {
  let { via } = await standIn(g, 'tunnel', 'an older one', 'persona')
  await g.apply([{ entity: { eid: via! }, session: { door: null } }], {
    trusted: true,
  })
  let again = await standIn(g, 'tunnel', 'an older one', 'persona')
  assertEquals(await decidedBy('healed', again as { by: string }), 'persona')
})
