// A call a step writes runs as the writer of the change it matched, inside
// the write or after it commits, exactly as the same call through a door.
import { equal, test } from '@yaks/testing'
import { type Actor, type Bundle, graph, who } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { docDoc } from '@yaks/doc/vocab'
import { executionComputed, runner, toolEid, toolsDoc } from '@yaks/tools'
import { loadVocab } from '@yaks/vocab'
import { workflowDoc, workflows } from './mod.ts'

let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  workflowDoc,
  docDoc,
  edgeDoc,
  toolsDoc,
  {
    $defs: {
      order: { component: true, properties: { when: { type: 'string' } } },
      contains: { component: true, edge: true },
    },
  },
], [edgeKeywords])
let ada = { by: 'ada', via: 'session' }
let echo = { to: toolEid('echo'), args: {} }

// One workflow per `when`, each calling `echo` for the orders that say it.
let world = async () => {
  let g = graph({
    vocab,
    storage: ram(vocab, { computed: executionComputed }),
    plugins: [edges(vocab), workflows()],
  })
  let seen = new Map<string, Actor | null>()
  let r = runner(g, {
    tools: [{
      name: 'echo',
      description: 'Say who asked',
      readOnly: true,
      run: (call: Bundle) => {
        seen.set(String((call.call as { source?: string }).source), who(call))
        return []
      },
    }],
  })
  await r.ensure()
  await g.apply(['ada', 'session'].map((eid) => ({
    entity: { eid },
    content: { body: eid },
  })))
  await g.apply(['write', 'commit'].flatMap((when) => [
    { entity: { eid: when }, workflow: {}, doc: { title: when } },
    {
      entity: { eid: `${when}-step` },
      step: {
        match: `$o .order.when=${when}`,
        write: [{ entity: { eid: '$c' }, call: { ...echo, source: '$o' } }],
        when,
      },
    },
    link(when, 'contains', `${when}-step`),
  ]))
  return { g, r, seen }
}

let doors: [string, Bundle][] = [
  ['a door', { entity: { eid: 'door' }, call: { ...echo, source: 'door' } }],
  ['a step in the write', { entity: { eid: 'o1' }, order: { when: 'write' } }],
  ['a step after commit', { entity: { eid: 'o2' }, order: { when: 'commit' } }],
]

for (let [name, bundle] of doors) {
  test(`a call written by ${name} runs as its writer`, async () => {
    let { g, r, seen } = await world()
    await g.apply([{ ...bundle, $actor: ada }])
    await r.drive()
    equal(seen.get(bundle.entity.eid), ada)
  })
}
