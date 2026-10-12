// The connector reaches the same build door without running any model.
import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import { type Comp, graph, identityEid, mint, signed } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { ram } from '@yaks/ram'
import { keys } from '@yaks/key'
import { edges } from '@yaks/edge'
import { answerOf, runner, toolEid, toolRow } from '@yaks/tools'
import { current, supply } from '@yaks/builders'
import { workshop } from '../../packages/builders/testing.ts'
import { modelTool } from '@yaks/builders/model'
import { runs } from '@yaks/builders/tools'
import { builderDoc } from '@yaks/builders/vocab'
import { invokePackage } from './package-tools.ts'
import type { Ctx } from './tool.ts'
import { useUntil } from './used.ts'

test('hosted provider, model and native input override keeps supplied main outputs current', async () => {
  let vocab = workshop()
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [keys(vocab), edges(vocab)],
  })
  let builderModelTool = modelTool()
  let run = runner(g, { tools: loadTools(builderDoc, runs({ vocab })) })
  await run.ensure()
  let source = crypto.randomUUID(), builder = crypto.randomUUID()
  let artifact = crypto.randomUUID(), person = crypto.randomUUID()
  let using = { provider: 'openrouter', model: 'google/lyria-3-pro-preview' }
  await g.apply([
    ...['openrouter', 'workers-ai'].map((name) => ({
      entity: { eid: identityEid('provider', [name]) },
      provider: { name },
      doc: { title: name },
    })),
    ...['google/lyria-3-pro-preview', 'minimax/music-2.6'].map((name) => ({
      entity: { eid: identityEid('model', [name]) },
      model: { name },
      doc: { title: name },
    })),
  ])
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
    source,
    dir: {
      space: () => Promise.resolve({ eid: 'space', slug: 'fixture' }),
      role: () => Promise.resolve('owner'),
      nameAt: () => Promise.resolve('Ada'),
      app: () =>
        Promise.resolve({ eid: 'app', slug: 'music', access: 'private' }),
    },
    env: {
      STORE: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: async (req: Request) => {
            if (new URL(req.url).pathname == '/used') {
              assertEquals(req.method, 'POST')
              assertEquals(req.headers.get('x-yak-kernel'), '1')
              let { eid } = await req.json() as { eid: string }
              assert(['space', 'app'].includes(eid))
              return Response.json({ at: useUntil() })
            }
            assertEquals(new URL(req.url).pathname, '/call')
            assertEquals(req.headers.get('x-yak-person'), person)
            let body = await req.json()
            sent = body.args
            let id = mint()
            let answer = await run.call(
              signed([{
                entity: { eid: id },
                call: {
                  to: toolEid(body.name),
                  args: body.args,
                  source: body.source,
                },
              }], { by: person })[0],
            )
            return Response.json(answerOf(answer, id))
          },
        }),
      },
    },
  } as unknown as Ctx
  let input = { lyrics: '[Verse]\nAh oh mm\n[Chorus]\nOo ah' }
  let result = await invokePackage(ctx, 'builder_build', {
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
  assertEquals(sent.input, input)
  let shadowId = String((result[0].content as Comp).body)
  let [shadow] = await g.get([shadowId])
  assert(String((shadow.build as Comp).variant).startsWith('shadow:'))
  let [call] = await g.get([String((shadow.build as Comp).call)])
  assertEquals(((call.call as Comp).args as Comp).using, {
    provider: identityEid('provider', ['workers-ai']),
    model: identityEid('model', ['minimax/music-2.6']),
    input,
  })
  await g.apply(await builderModelTool.run(call, g), { trusted: true })
  let [entry] = await g.read('.entry&?using')
  assertEquals((entry.using as Comp).input, input)
  assertEquals(await g.get([builder, mainId, output]), before)
  assertEquals(
    current(
      before[1].build as Comp,
      before[2].built as Comp,
      !!before[2].chosen,
    ),
    true,
  )
})
