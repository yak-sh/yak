// A store's builders keep their provenance once a release brings them, on any
// host that runs yak/app's effects.
import { assert, assertEquals } from '@std/assert'
import { type Comp, type Graph, graph } from '@yaks/graph'
import type { Host } from '@yaks/host'
import { loadVocab, metaDoc } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { current, supply } from '@yaks/builders'
import { keys } from '@yaks/key'
import { edges } from '@yaks/edge'
import { toolEid, toolRow } from '@yaks/tools'
import { test } from '@yaks/testing'
import { workshop } from '../builders/testing.ts'
import { modelTool } from '@yaks/builders/model'
import { effects } from './app-effects.ts'
import { bare } from './lent.ts'

// The host's own graph, as a host that lends the store none writes through.
let install = async (g: Graph) => {
  let handler = effects({ graph: g } as Host, { store: bare('recipes', {}) })
    .builder_install
  await handler(
    { entity: { eid: 'startup' }, name: 'builder_install', kind: 'created' },
    g,
    (bundles) => g.apply(bundles, { trusted: true }),
  )
}

test('builders install succeeds in stores without builder vocabulary', async () => {
  let vocab = loadVocab([metaDoc])
  let g = graph({ storage: ram(vocab), vocab })
  assertEquals(vocab.comp('builder'), undefined)
  await install(g)
  assertEquals(await g.read('.entity'), [])
})

test('builders install preserves legacy provenance in a store declaring builders', async () => {
  let vocab = workshop()
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [keys(vocab), edges(vocab)],
  })
  await g.apply([toolRow(modelTool()), {
    entity: { eid: 'source' },
    doc: { title: 'Source', body: 'Before' },
  }, {
    entity: { eid: 'artifact' },
    artifact: { address: 'existing', media_type: 'audio/wav', size: 4 },
  }, {
    entity: { eid: 'builder' },
    staged: {},
    content: { body: 'Build $source' },
    builder: {
      query: '$source .doc.title=Source',
      to: toolEid('builder_model'),
    },
  }])
  let output = await supply(g, vocab, {
    builder: 'builder',
    for: 'source',
    slot: 'main',
    artifact: 'artifact',
  }, null)
  let [out] = await g.get([output])
  let build = String((out.built as Comp).build)
  await g.apply([{
    entity: { eid: build },
    build: { key: 'legacy', inputs: null, definition: null },
  }, {
    entity: { eid: output },
    built: { key: 'legacy', definition: null },
  }, {
    entity: { eid: 'builder' },
    builder: { definition: null },
  }], { trusted: true })
  let before = await g.get([output, 'builder'])
  let calls = await g.read('.call&*')
  await install(g)
  let [run, builder] = await g.get([build, 'builder'])
  assertEquals((run.build as Comp).key, 'legacy')
  assert(typeof (run.build as Comp).inputs == 'string')
  assert(typeof (builder.builder as Comp).definition == 'string')
  assertEquals(builder.staged, before[1].staged)
  assertEquals(await g.get([output]), [before[0]])
  assertEquals(
    current(run.build as Comp, before[0].built as Comp, !!before[0].chosen),
    true,
  )
  assertEquals(await g.read('.call&*'), calls)
  let after = await g.get([build, 'builder', output])
  await install(g)
  assertEquals(await g.get([build, 'builder', output]), after)
})
