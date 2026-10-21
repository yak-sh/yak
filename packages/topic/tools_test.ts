// The topic tools over a graph small enough to read: one name is one topic, a
// name holding another's words is refused, and a find answers by words.
import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Comp, graph, Refused } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'
import { topicDoc } from './vocab.ts'
import { runs } from './tools.ts'
import { topicEid } from './topic.ts'

let vocab = loadVocab([docDoc, topicDoc, {
  $defs: { project: { component: true, type: 'object', kind: true } },
}])
let tools = runs()

type G = ReturnType<typeof fresh>
let fresh = () => graph({ storage: ram(vocab), vocab, plugins: [] })

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
let subjects = await topical([
  ['testing', 'what a test checks'],
  ['naming', 'one thing, one name'],
])

test('every topic tool is declared and implemented', () => {
  assertEquals(loadTools(topicDoc, tools).map((t) => t.name).sort(), [
    'topic_find',
    'topic_new',
  ])
})

test('a topic is its name, and a name said twice is one topic', async () => {
  let g = fresh()
  let answer = await ask('topic_new', {
    name: 'UI  Components',
    body: 'how the interface is built from display-only parts',
  }, g)
  // The answer names the id itself, for whoever asked to use.
  assertEquals(eids(answer), [topicEid('ui components')])
  await g.apply(answer)
  let [made] = await g.read('.topic&*')
  assertEquals(made.entity.eid, topicEid('ui components'))
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
  let g = market
  for (let name of ['economic market design', 'markets', 'design']) {
    await assertRejects(
      () => ask('topic_new', { name, body: 'the same' }, g),
      Refused,
      topicEid('market design'),
    )
  }
  assertEquals(
    eids(await ask('topic_new', { name: 'ui design', body: 'screens' }, g)),
    [topicEid('ui design')],
  )
})

test('find answers the topics holding the words, else every one by name', async () => {
  let g = subjects
  let names = (bs: Bundle[]) => bs.map((b) => part(b, 'topic').name)
  assertEquals(names(await ask('topic_find', {}, g)), ['naming', 'testing'])
  assertEquals(names(await ask('topic_find', { said: 'check' }, g)), [
    'testing',
  ])
})
