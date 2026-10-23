// The topic tools over a graph small enough to read: one name is one topic, a
// name holding another's words is refused, a find answers by words, and a
// topic holds what is added to it, a project as much as any other topic.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Comp, graph, Refused } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { taskDoc } from '@yaks/task/vocab'
import { projectDoc } from '@yaks/project/vocab'
import { topicDoc } from './vocab.ts'
import { runs } from './tools.ts'

let vocab = loadVocab(
  [edgeDoc, docDoc, taskDoc, projectDoc, topicDoc],
  [edgeKeywords],
)
let tools = runs()

type G = ReturnType<typeof fresh>
let fresh = () => graph({ storage: ram(vocab), vocab, plugins: [edges(vocab)] })

let ask = async (name: string, args: Record<string, unknown>, g: G) =>
  await tools[name]!({ entity: { eid: 'c1' }, call: { args } }, g) as Bundle[]

let part = (b: Bundle | undefined, name: string) => b?.[name] as Comp
let eids = (bs: Bundle[]) => bs.map((b) => b.entity.eid)

// Graphs of topics, each written once at load: the cases below only ask.
let topical = async (briefs: [string, string][]) => {
  let g = fresh()
  for (let [name, body] of briefs) {
    await g.apply(await ask('topic_new', { name, body }, g))
  }
  return g
}
let market = await topical([['market design', 'the market']])
let [marketDesign] = eids(await market.read('.topic'))
let subjects = await topical([
  ['testing', 'what a test checks'],
  ['naming', 'one thing, one name'],
])

// What a topic holds, by the eids its edges reach.
let holds = async (g: G, eid: string) =>
  (await g.read(`.contains&.edge.from=${eid}&?edge`))
    .map((b) => part(b, 'edge').to).sort()

test('every topic tool is declared and implemented', () => {
  assertEquals(loadTools(topicDoc, tools).map((t) => t.name).sort(), [
    'topic_add',
    'topic_find',
    'topic_new',
  ])
})

test('a topic is its name, and a name said twice is one topic', async () => {
  let g = fresh()
  await g.apply(
    await ask('topic_new', {
      name: 'UI  Components',
      body: 'how the interface is built from display-only parts',
    }, g),
  )
  let [made] = await g.read('.topic&*')
  assertEquals(part(made, 'topic'), { name: 'ui components' })
  assertEquals(part(made, 'doc').title, 'UI Components')
  await assertRejects(
    () => ask('topic_new', { name: 'ui components', body: 'again' }, g),
    Refused,
    made.entity.eid,
  )
})

test('a topic holds for the project its scope names, or everywhere', async () => {
  let g = fresh()
  let [held] = await ask('topic_new', { name: 'a', body: 'b', scope: 'P' }, g)
  let [everywhere] = await ask('topic_new', { name: 'c', body: 'd' }, g)
  assertEquals(part(held, 'topic'), { name: 'a', scope: 'P' })
  assertEquals(part(everywhere, 'topic'), { name: 'c' })
})

test("a name holding another topic's words, or held by them, is refused", async () => {
  for (let name of ['economic market design', 'markets', 'design']) {
    await assertRejects(
      () => ask('topic_new', { name, body: 'the same' }, market),
      Refused,
      marketDesign,
    )
  }
  let [ui] = await ask(
    'topic_new',
    { name: 'ui design', body: 'screens' },
    market,
  )
  assertEquals(part(ui, 'topic'), { name: 'ui design' })
})

test('find answers the topics holding the words, else every one by name', async () => {
  let g = subjects
  let names = (bs: Bundle[]) => bs.map((b) => part(b, 'topic').name)
  assertEquals(names(await ask('topic_find', {}, g)), ['naming', 'testing'])
  assertEquals(names(await ask('topic_find', { said: 'check' }, g)), [
    'testing',
  ])
  assertEquals(names(await ask('topic_find', { said: 'tests named' }, g)), [])
  assertEquals(names(await ask('topic_find', { said: 'named' }, g)), [
    'naming',
  ])
  assertEquals(names(await ask('topic_find', { limit: 1 }, g)), ['naming'])
})

test('a topic holds what is added to it, until it is dropped', async () => {
  let g = await topical([['data model', 'how data is shaped']])
  let [model] = eids(await g.read('.topic'))
  await g.apply([
    { entity: { eid: 'm1' }, doc: { title: 'one aspect per component' } },
    { entity: { eid: 'm2' }, doc: { title: 'marks, not states' } },
  ])
  let add = async (args: Record<string, unknown>) =>
    await g.apply(await ask('topic_add', args, g))
  await assertRejects(
    () => ask('topic_add', { topic: 'm1', ids: ['m2'] }, g),
    Refused,
    'not a topic',
  )
  await add({ topic: model, ids: ['m1', 'm2'] })
  await add({ topic: model, ids: ['m1'] })
  assertEquals(await holds(g, model), ['m1', 'm2'])
  await add({ topic: model, ids: ['m1'], drop: true })
  assertEquals(await holds(g, model), ['m2'])
  await assertRejects(
    () => ask('topic_add', { topic: model, ids: [model] }, g),
    Refused,
    'itself',
  )
})

test('a project is its own topic: it holds things, and its name is taken', async () => {
  let g = fresh()
  await g.apply([
    {
      entity: { eid: 'p1' },
      project: {},
      topic: { name: 'mossvale' },
      doc: { title: 'Mossvale', body: 'a voxel game' },
    },
    { entity: { eid: 'd1' }, doc: { title: 'creatures as components' } },
  ])
  await g.apply(await ask('topic_add', { topic: 'p1', ids: ['d1'] }, g))
  assertEquals(await holds(g, 'p1'), ['d1'])
  await assertRejects(
    () => ask('topic_new', { name: 'Mossvale', body: 'the game' }, g),
    Refused,
    'p1',
  )
  // It is still read as a project, so its human id keeps its P.
  let [p1] = await g.get(['p1'])
  assertEquals(vocab.kindOf(p1), 'project')
})
