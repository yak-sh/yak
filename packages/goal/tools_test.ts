// Setting goals, finding them, and saying which work served them, on a graph
// of goals, docs and edges.

import { equal, test } from '@yaks/testing'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { goalDoc } from './vocab.ts'
import { listing, runs } from './tools.ts'

let tools = runs()
let vocab = loadVocab([docDoc, edgeDoc, goalDoc], [edgeKeywords])
let g = graph({ storage: ram(vocab), vocab, plugins: [edges(vocab)] })

// A tool's answer, applied as its host applies it.
let call = async (name: string, args: Record<string, unknown>) => {
  let out = await tools[name]!({ entity: { eid: 'c' }, call: { args } }, g)
  return name == 'goal_list' ? out as Bundle[] : g.apply(out as Bundle[])
}
let satisfying = async (goal: string) =>
  (await g.read(`.satisfies&.edge.to=${goal}`)).map((b) =>
    (b.edge as Comp).from
  )

await g.apply([{ entity: { eid: 'fix' }, doc: { title: 'cut a slow query' } }])
let [made] = await call('goal_new', {
  title: 'A fast app',
  body: 'Pages answer in under 100 ms.',
  satisfied_by: ['fix'],
})
let goal = made.entity.eid

test('every goal tool is declared and implemented', () => {
  equal(loadTools(goalDoc, tools).map((t) => t.name).sort(), [
    'goal_list',
    'goal_new',
    'goal_update',
  ])
})

test('a new goal is goal{} plus its words, served by the work it names', async () => {
  equal(made.goal, {})
  equal(made.doc, {
    title: 'A fast app',
    body: 'Pages answer in under 100 ms.',
  })
  equal(await satisfying(goal), ['fix'])
})

test('a listing is every goal, whole, unless a query narrows it', async () => {
  equal(listing(), '.goal&*')
  equal(listing('fast', 3), '.goal&fast&.limit=3&*')
  equal((await call('goal_list', {})).map((b) => (b.doc as Comp).title), [
    'A fast app',
  ])
})

test('an update patches what it names, keeps the rest, and links more work', async () => {
  await g.apply([{ entity: { eid: 'cache' }, doc: { title: 'cache pages' } }])
  await call('goal_update', {
    goal,
    title: 'A faster app',
    satisfied_by: ['cache'],
  })
  let [after] = await g.get([goal])
  equal(after.doc, {
    title: 'A faster app',
    body: 'Pages answer in under 100 ms.',
  })
  equal((await satisfying(goal)).sort(), ['cache', 'fix'])
})
