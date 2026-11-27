// A call a step writes runs as the writer of the change it matched, inside
// the write or after it commits, exactly as the same call through a door.
import { equal, test } from '@yaks/testing'
import { type Actor, type Bundle, graph, type Plugin, who } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { docDoc } from '@yaks/doc/vocab'
import { executionComputed, runner, toolEid, toolsDoc } from '@yaks/tools'
import { loadVocab } from '@yaks/vocab'
import { effects } from '@yaks/effects'
import { handlers, workflowDoc, workflows } from './mod.ts'

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

// A store's guard, as @yaks/member's is on yaks.app: a write signed by nobody
// is a signed-out visitor's, refused, unless the host makes it.
let guard: Plugin = {
  name: 'guard',
  hooks: {
    precondition: (bundles, _tx, _err, context) => {
      if (context?.trusted || bundles.some((b) => b.$actor?.by)) return bundles
      throw new Error('someone signed out may not write')
    },
  },
}

// One workflow per `when`, each calling `echo` for the orders that say it. The
// store keeps no effect pool, so a step owed after commit runs in this process.
let world = async (guarded = false) => {
  let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g = graph({
    vocab,
    storage: ram(vocab, { computed: executionComputed }),
    plugins: [edges(vocab), workflows(), ...guarded ? [guard] : [], fx],
  })
  fx.handle(handlers(vocab))
  let seen = new Map<string, Actor | null>()
  // The runner writes its bookkeeping through the host's door, as a store's
  // does (yaks.app graph.ts `#kernelGraph`).
  let host = {
    ...g,
    apply: (b: Bundle[]) => g.apply(b, { trusted: true }),
  } as typeof g
  let r = runner(host, {
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
  await g.apply(
    ['ada', 'session'].map((eid) => ({
      entity: { eid },
      content: { body: eid },
    })),
    { trusted: true },
  )
  await g.apply(
    ['write', 'commit'].flatMap((when) => [
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
    ]),
    { trusted: true },
  )
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

// An effect's own write, such as a tool's answer, is signed by nobody: the step
// it owes writes as the host, through the effect's door, and is not refused as
// a signed-out visitor's.
test('a step after a commit nobody signed writes as the host', async () => {
  let { g, r, seen } = await world(true)
  await g.apply([{ entity: { eid: 'o3' }, order: { when: 'commit' } }], {
    trusted: true,
  })
  await r.drive()
  equal(seen.get('o3'), null)
})
