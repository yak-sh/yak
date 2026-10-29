import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { provenanceDoc } from '@yaks/provenance'
import { kernel, kernelDoc } from './mod.ts'

let vocab = loadVocab([kernelDoc, provenanceDoc])
let seen: string[] = []
let g = graph({
  vocab,
  storage: ram(vocab),
  plugins: [kernel(), {
    name: 'authority',
    authorize: (bundles) => {
      seen.push(...bundles.map((b) => b.$actor?.by).filter(Boolean) as string[])
      return bundles
    },
  }],
})
await g.apply(['owner', 'agent', 'session'].map((eid) => ({
  entity: { eid },
  favorite: {},
})))

test('an explicit decider changes mark attribution and preserves writer authority', async () => {
  await g.apply([{
    entity: { eid: 'decision' },
    decided: { verdict: 'approved' },
    $decider: 'owner',
    $actor: { by: 'agent', via: 'session' },
  }])
  let [row] = await g.get(['decision'])
  assertEquals((row.decided as Comp).by, 'owner')
  assertEquals((row.decided as Comp).via, 'session')
  assertEquals((row.created as Comp).by, 'agent')
  assertEquals(seen, ['agent'])
})
