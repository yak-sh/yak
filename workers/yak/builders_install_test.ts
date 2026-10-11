import { assert, assertEquals } from '@std/assert'
import { type Comp, type Graph, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { current, supply } from '@yaks/builders'
import { keys } from '@yaks/key'
import { edges } from '@yaks/edge'
import { toolEid, toolRow } from '@yaks/tools'
import { test } from '@yaks/testing'
import { workshop } from '../../packages/builders/testing.ts'
import { builderModelTool } from './builders.ts'
import { effects as appEffects } from './facets/app-effects.ts'
import type { Stored } from './plugin.ts'
import { platformVocab } from './vocab.ts'

let install = async (g: Graph, meta: boolean, app: string | null) => {
  let handler = appEffects({}, { store: { graph: g, meta, app } as Stored })
    .builder_install
  await handler(
    { entity: { eid: 'startup' }, name: 'builder_install', kind: 'created' },
    g,
    (bundles) => g.apply(bundles, { trusted: true }),
  )
}

test('builders install succeeds in stores without builder vocabulary', async () => {
  let vocab = platformVocab()
  let g = graph({ storage: ram(vocab), vocab })
  assertEquals(vocab.comp('builder'), undefined)
  for (let meta of [true, false]) {
    await install(g, meta, null)
    assertEquals(await g.read('.entity'), [])
  }
})

test('builders install preserves legacy provenance in a store declaring builders', async () => {
  let vocab = workshop()
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [keys(vocab), edges(vocab)],
  })
  await g.apply([toolRow(builderModelTool), {
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
  // Provenance must run even before a store has an app assigned.
  await install(g, false, null)
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
  await install(g, false, null)
  assertEquals(await g.get([build, 'builder', output]), after)
})
