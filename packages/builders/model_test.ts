import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { toolRow } from '@yaks/tools'
import { test } from '@yaks/testing'
import { modelTool, modelToolEid } from './model.ts'
import { ids, workshop } from './testing.ts'

let desk = async () => {
  let vocab = workshop()
  let g = graph({ storage: ram(vocab), vocab })
  let call: Bundle = {
    entity: { eid: 'model-call' },
    call: {
      to: modelToolEid(),
      args: {
        key: 'one-attempt',
        binding: { entities: [], vars: {} },
        template: 'Make a sound',
        using: { model: ids.model },
      },
    },
  }
  let tool = modelTool()
  await g.apply([
    toolRow(tool),
    { entity: { eid: ids.model }, model: { name: 'builder-test' } },
    call,
  ])
  return { g, call, tool }
}

test('replaying a model builder call keeps one session and its prompt', async () => {
  let { g, call, tool } = await desk()
  // Two reads before either commits still produce the same durable work.
  let [first, racing] = await Promise.all([
    tool.run(call, g),
    tool.run(call, g),
  ])
  assertEquals(racing, first)
  await g.apply(first)
  await g.apply(racing)
  let sessions = await g.read('.session&*')
  let entries = await g.read('.entry&*')
  assertEquals(sessions.length, 1)
  assertEquals(entries.length, 1)
  assertEquals(await tool.run(call, g), [])
  assertEquals(await g.read('.session&*'), sessions)
  assertEquals(await g.read('.entry&*'), entries)
})

test('replaying a legacy model builder call keeps its recorded session', async () => {
  let { g, call, tool } = await desk()
  await g.apply([
    { entity: { eid: 'old-session' }, session: { source: call.entity.eid } },
    {
      entity: { eid: 'old-prompt' },
      entry: { session: 'old-session', seq: 1 },
      content: { body: 'Original request' },
    },
  ])
  let before = await g.read('.session|.entry&*')
  assertEquals(await tool.run(call, g), [])
  assertEquals(await g.read('.session|.entry&*'), before)
})
