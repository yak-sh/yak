// Words given a session from outside: one input per item, linked back to it,
// with its channel, model and files, and nothing written when given again.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph } from '@yaks/graph'
import { link } from '@yaks/edge'
import { edgeDoc } from '@yaks/edge/vocab'
import { artifactDoc } from '@yaks/blob/vocab'
import { attachmentOf } from '@yaks/blob/attachment'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { toolsDoc } from '@yaks/tools/vocab'
import { taskDoc } from '@yaks/task/vocab'
import { kernelDoc } from '@yaks/kernel/vocab'
import { personaDoc } from '@yaks/persona/vocab'
import { provenanceDoc } from '@yaks/provenance'
import { modelDoc } from '@yaks/model/vocab'
import { sessionDoc } from './comp.ts'
import { inputOf, take, taskSession } from './intake.ts'

let vocab = loadVocab([
  kernelDoc,
  provenanceDoc,
  personaDoc,
  modelDoc,
  sessionDoc,
  toolsDoc,
  taskDoc,
  artifactDoc,
  edgeDoc,
])
let fresh = async () => {
  let g = graph({ storage: ram(vocab), vocab })
  await g.apply([
    { entity: { eid: 'talk' }, session: {} },
    { entity: { eid: 'ada' }, person: {} },
    { entity: { eid: 'request' }, task: {} },
    { entity: { eid: 'small' }, model: {} },
  ])
  return g
}
let lines = async (g: Awaited<ReturnType<typeof fresh>>): Promise<Bundle[]> =>
  (await g.read('.entry.session=talk *')).map((b) => ({
    ...b,
    created: { by: (b.created as { by?: string }).by },
  }))

let file = { name: 'notes.pdf', media_type: 'application/pdf', address: 'ab' }

test('an item is taken in once, with its channel, model and files', async () => {
  let g = await fresh()
  let words = {
    session: 'talk',
    item: 'request',
    body: 'By text: hello',
    by: 'ada',
    channel: { name: 'text', framing: 'By text: ' },
    using: { model: 'small' },
    files: [file],
  }
  let note = (eid: string) => [{ entity: { eid }, task: {} }]
  let at = await Promise.all([take(g, words, note('a')), take(g, words)])
  let after = await take(g, words, note('b'))
  assertEquals(at.map((t) => t.input), [inputOf('request'), inputOf('request')])
  assertEquals([...at, after].map((t) => t.fresh), [true, false, false])
  assertEquals((await g.get(['a', 'b'])).map((b) => b.entity.eid), ['a'])
  assertEquals(await lines(g), [{
    entity: { eid: inputOf('request') },
    entry: { session: 'talk' },
    intake: { item: 'request' },
    content: { body: 'By text: hello' },
    channel: { name: 'text', framing: 'By text: ' },
    using: { model: 'small' },
    created: { by: 'ada' },
  }])
  let [use] = await g.get([attachmentOf('request', 0)])
  assertEquals(use?.attachment, {
    name: 'notes.pdf',
    media_type: 'application/pdf',
    artifact: 'ab',
    message: 'request',
  })
})

test('words nothing names are each their own input', async () => {
  let g = await fresh()
  let words = { session: 'talk', body: 'hi', by: 'ada', files: [file] }
  let [a, b] = [await take(g, words), await take(g, words)]
  let named = { ...words, id: 'mine' }
  let [c, d] = [await take(g, named), await take(g, named)]
  assertEquals([a.fresh, b.fresh, a.input == b.input], [true, true, false])
  assertEquals([c, d.fresh], [{ input: inputOf('mine'), fresh: true }, false])
  assertEquals((await g.get([attachmentOf(a.input, 0)]))[0]?.attachment, {
    name: 'notes.pdf',
    media_type: 'application/pdf',
    artifact: 'ab',
    message: a.input,
  })
})

test("a task's words go to the newest session it holds", async () => {
  let g = await fresh()
  assertEquals(await taskSession(g, 'task'), undefined)
  await g.apply([
    { entity: { eid: 'task' }, task: {} },
    { entity: { eid: 'old' }, session: {}, $at: '2026-01-01T00:00:00Z' },
    { entity: { eid: 'new' }, session: {}, $at: '2026-02-01T00:00:00Z' },
    link('task', 'contains', 'new'),
    link('task', 'contains', 'old'),
  ], { trusted: true })
  assertEquals(await taskSession(g, 'task'), 'new')
})
