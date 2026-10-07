import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Comp } from '@yaks/graph'
import { toolEid } from '@yaks/tools'
import { buildFor, current, outputFor } from './build.ts'
import { answering } from './effects.ts'
import { build, runs } from './tools.ts'
import { supply } from './supply.ts'
import { marksDoc } from '@yaks/kernel/vocab'
import { ids, shop } from './testing.ts'

let source = 'input'
let tool = toolEid('builder_model')
let blob = 'blob'
let seed = (
  query = '$input .doc, doc.title=Input, doc.body=$body',
): Bundle[] => [{
  entity: { eid: source },
  doc: { title: 'Input', body: 'Before' },
}, {
  entity: { eid: blob },
  artifact: { address: 'existing-bytes', media_type: 'audio/wav', size: 4 },
}, {
  entity: { eid: ids.builder },
  builder: { query, to: tool, immediate: true },
  content: { body: 'Build $input' },
  staged: {},
}]
let ask = (slot = 'main') => ({
  builder: ids.builder,
  for: source,
  slot,
  artifact: blob,
})
let comp = (row: Bundle, name: string): Comp => row[name] as Comp

test('supply is current, costs zero and rebuilds only after input edits', async () => {
  let { g, vocab } = await shop()
  await g.apply(seed())
  let id = await supply(g, vocab, {
    ...ask('song'),
    args: { prompt: 'Original' },
  }, null)
  let buildId = (await buildFor(g, ids.builder, [source]))!
  assertEquals(await outputFor(g, buildId, 'song'), id)
  let [run, output] = await g.get([buildId, id])
  assertEquals(
    current(comp(run, 'build'), comp(output, 'built'), !!output.chosen),
    true,
  )
  assertEquals(comp(output, 'built').artifact, blob)
  let [call] = await g.get([String(comp(run, 'build').call)])
  assertEquals(comp(call, 'execution').state, 'done')
  assertEquals(comp(call, 'cost').dollars, 0)
  assertEquals((comp(call, 'call').args as Comp).prompt, 'Original')
  assertEquals((await g.read('.built.current=true')).map((r) => r.entity.eid), [
    id,
  ])
  assertEquals((await g.read('.call')).length, 1)
  assertEquals(await build(g, vocab, { builder: ids.builder }, null), [buildId])
  assertEquals((await g.read('.call')).length, 1)
  await g.apply([{ entity: { eid: source }, doc: { body: 'After' } }])
  await build(g, vocab, { builder: ids.builder }, null)
  assertEquals((await g.read('.call')).length, 2)
  assertEquals((await g.read('.built.current=true')).length, 0)
  assertEquals(await buildFor(g, ids.builder, [source]), buildId)
  assertEquals(await outputFor(g, buildId, 'song'), id)
})

test('supply adds takes and keeps other chosen slots; replay does not undo a choice', async () => {
  let { g, vocab } = await shop()
  await g.apply(seed())
  let main = await supply(g, vocab, ask(), null)
  let other = await supply(g, vocab, ask('other'), null)
  let next = await supply(g, vocab, ask(), null)
  assertEquals(next == main, false)
  assertEquals((await g.read('.built')).length, 3)
  assertEquals((await g.read('.built.current=true')).length, 2)
  let buildId = (await buildFor(g, ids.builder, [source]))!
  assertEquals(await outputFor(g, buildId), next)
  assertEquals(await outputFor(g, buildId, 'other'), other)
  await g.apply([{ entity: { eid: main }, chosen: {} }], { trusted: true })
  assertEquals(await outputFor(g, buildId), main)
  let replies = await g.read('.output')
  for (let reply of replies) {
    await g.storage.tx((tx) =>
      answering(vocab)(
        {
          entity: reply.entity,
          touched: ['output'],
          kind: 'created',
          name: 'output',
        },
        tx,
        (writes) => g.apply(writes, { trusted: true }),
      )
    )
  }
  assertEquals(await outputFor(g, buildId), main)
  assertEquals((await g.read('.built')).length, 3)
})

test('supply refuses invalid or ambiguous bindings without writing a call', async () => {
  let { g, vocab } = await shop({}, [marksDoc])
  await g.apply(seed('$input .doc, doc.title=Input; $project .project'))
  await g.apply([{
    entity: { eid: 'other-project' },
    project: { name: 'Other' },
  }])
  await assertRejects(
    () => supply(g, vocab, ask(), null),
    'supply needs exactly one',
  )
  await assertRejects(
    () => supply(g, vocab, { ...ask(), artifact: source }, null),
    'no artifact',
  )
  await assertRejects(
    () => supply(g, vocab, { ...ask(), for: blob }, null),
    '0 bindings',
  )
  await g.apply([{ entity: { eid: ids.builder }, archived: {} }])
  await assertRejects(() => supply(g, vocab, ask(), null), 'archived')
  assertEquals((await g.read('.call')).length, 0)
  assertEquals((await g.read('.built')).length, 0)
})

test('builder_supply tool resolves identifiers and answers with the output id', async () => {
  let { g, vocab } = await shop()
  await g.apply(seed())
  let call: Bundle = {
    entity: { eid: 'supply-call' },
    call: { args: ask() },
  }
  let out = await runs({ vocab }).builder_supply(call, g)
  let id = (out[0].content as Comp).body
  assertEquals((await g.get([String(id)]))[0].built != null, true)
  assertEquals((out[0].output as Comp).source, 'supply-call')
})
