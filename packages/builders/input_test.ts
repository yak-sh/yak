// Native input overrides use a shadow without changing supplied main outputs.
import { assert, assertEquals, assertNotEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { keys } from '@yaks/key'
import { edges } from '@yaks/edge'
import { toolRow } from '@yaks/tools'
import { current } from './build.ts'
import { modelTool, modelToolEid } from './model.ts'
import { supply } from './supply.ts'
import { build } from './tools.ts'
import { workshop } from './testing.ts'

test('native input shadows preserve main and reach recorded calls and sessions', async () => {
  let vocab = workshop()
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [keys(vocab), edges(vocab)],
  })
  let builder = crypto.randomUUID(), source = crypto.randomUUID()
  let artifact = crypto.randomUUID()
  let tool = modelTool()
  await g.apply([toolRow(tool), {
    entity: { eid: source },
    doc: { title: 'Song' },
  }, {
    entity: { eid: artifact },
    artifact: { address: 'existing', media_type: 'audio/mpeg', size: 4 },
  }, {
    entity: { eid: builder },
    builder: { query: '$song .doc.title=Song', to: modelToolEid() },
    content: { body: 'Compose $song' },
    using: {
      model: 'music-model',
      input: { lyrics: 'old', audio_setting: { format: 'mp3' } },
    },
    staged: {},
  }])
  let output = await supply(g, vocab, {
    builder,
    for: source,
    slot: 'main',
    artifact,
  }, null)
  let [supplied] = await g.get([output])
  let main = String((supplied.built as Comp).build)
  let before = await g.get([builder, main, output])
  let input = { lyrics: '[Verse]\nAh oh mm\n[Chorus]\nOo ah' }
  let ask = { builder, only: [source], input }
  let [shadowId] = await build(g, vocab, ask, null)
  let [shadow] = await g.get([shadowId])
  assert(String((shadow.build as Comp).variant).startsWith('shadow:'))
  let [call] = await g.get([String((shadow.build as Comp).call)])
  let effective = { audio_setting: { format: 'mp3' }, ...input }
  assertEquals(((call.call as Comp).args as Comp).using, {
    model: 'music-model',
    input: effective,
  })
  await g.apply(await tool.run(call, g), { trusted: true })
  let [entry] = await g.read('.entry&?using')
  assertEquals((entry.using as Comp).input, effective)
  assertEquals(await build(g, vocab, ask, null), [shadowId])
  assertEquals(await g.get([shadowId]), [shadow])
  let [other] = await build(g, vocab, {
    ...ask,
    input: { lyrics: 'Mm oo ah' },
  }, null)
  assertNotEquals(other, shadowId)
  let [changed] = await g.get([other])
  assertNotEquals((changed.build as Comp).key, (shadow.build as Comp).key)
  assertEquals(await g.get([builder, main, output]), before)
  assert(current(before[1].build as Comp, before[2].built as Comp))
})
