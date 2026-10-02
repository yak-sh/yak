// The connector reaches the same build door without running any model.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { keys } from '@yaks/key'
import { edges } from '@yaks/edge'
import { toolEid, toolRow } from '@yaks/tools'
import { current, supply } from '@yaks/builders'
import { workshop } from '../../packages/builders/testing.ts'
import { builderModelTool, buildersPlugin, building } from './builders.ts'
import type { Ctx } from './tool.ts'

test('hosted provider, model and native input override keeps supplied main outputs current', async () => {
  let vocab = workshop()
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [keys(vocab), edges(vocab)],
  })
  let source = crypto.randomUUID(), builder = crypto.randomUUID()
  let artifact = crypto.randomUUID(), person = crypto.randomUUID()
  let using = { provider: 'openrouter', model: 'google/lyria-3-pro-preview' }
  await g.apply([toolRow(builderModelTool), {
    entity: { eid: source },
    doc: { title: 'Song', body: 'Wordless choir.' },
  }, {
    entity: { eid: artifact },
    artifact: { address: 'existing-song', media_type: 'audio/mpeg', size: 4 },
  }, {
    entity: { eid: builder },
    using,
    staged: {},
    content: { body: 'Compose $song' },
    builder: { query: '$song .doc.title=Song', to: toolEid('builder_model') },
  }])
  let output = await supply(g, vocab, {
    builder,
    for: source,
    slot: 'main',
    artifact,
  }, null)
  let [mainOutput] = await g.get([output])
  let mainId = String((mainOutput.built as Comp).build)
  let before = await g.get([builder, mainId, output])
  let sent: Record<string, unknown> = {}
  let ctx = {
    person,
    dir: {
      space: async () => ({ eid: 'space', slug: 'fixture' }),
      role: async () => 'owner',
      app: async () => ({ eid: 'app', slug: 'music', access: 'private' }),
    },
    env: {
      STORE: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: async (req: Request) => {
            assertEquals(new URL(req.url).pathname, '/build')
            sent = await req.json()
            return building(g, sent as Parameters<typeof building>[1])
          },
        }),
      },
    },
  } as unknown as Ctx
  let input = { lyrics: '[Verse]\nAh oh mm\n[Chorus]\nOo ah' }
  let tool = buildersPlugin.tools!.find((t) => t.name == 'builder_build')!
  let result = await tool.run(ctx, {
    space: 'fixture',
    app: 'music',
    builder,
    only: [source],
    provider: 'workers-ai',
    model: 'minimax/music-2.6',
    input,
  })
  assertEquals(sent.provider, 'workers-ai')
  assertEquals(sent.model, 'minimax/music-2.6')
  assertEquals(sent.by, person)
  assertEquals(sent.input, input)
  let [shadowId] = result.value!.builds as string[]
  let [shadow] = await g.get([shadowId])
  assert(String((shadow.build as Comp).variant).startsWith('shadow:'))
  let [call] = await g.get([String((shadow.build as Comp).call)])
  assertEquals(((call.call as Comp).args as Comp).using, {
    provider: 'workers-ai',
    model: 'minimax/music-2.6',
    input,
  })
  await g.apply(await builderModelTool.run(call, g), { trusted: true })
  let [entry] = await g.read('.entry&?using')
  assertEquals((entry.using as Comp).input, input)
  assertEquals(await g.get([builder, mainId, output]), before)
  assertEquals(current(before[1].build as Comp, before[2].built as Comp), true)
})
