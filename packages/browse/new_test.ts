// A sketch written to a graph: what it makes, how the outline nests, which
// ids the graph gives it, and where a refusal points.
import { equal, test } from '@yaks/testing'
import { type Bundle, type Comp, graph, Refused } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { plugins } from '@yaks/edge/graph'
import { docs as kernel } from '@yaks/kernel/vocab'
import { docs as provenance } from '@yaks/provenance/vocab'
import { docs as edge } from '@yaks/edge/vocab'
import { docs as doc } from '@yaks/doc/vocab'
import { docs as task } from '@yaks/task/vocab'
import { docs as topic } from '@yaks/topic/vocab'
import { keywords } from './types.ts'
import { batch, type Context, find, like, type Sketch } from './new.ts'

let vocab = loadVocab([
  ...kernel,
  ...provenance,
  ...edge,
  ...doc,
  ...task,
  ...topic,
  {
    $defs: {
      book: { component: true, properties: { pages: { type: 'number' } } },
      shelf: {
        component: true,
        properties: { aisle: { type: 'string', identity: true } },
      },
    },
  },
], keywords)
let read = (comp: string, prop: string, text: string) => {
  if (vocab.prop(comp, prop)?.scalar != 'number') return text
  if (isNaN(Number(text))) throw new Error(`${comp}.${prop} is a number`)
  return Number(text)
}
let sketch = (s: Partial<Sketch>): Sketch => ({ comps: {}, outline: '', ...s })
let fresh = () =>
  graph({ storage: ram(vocab), vocab, plugins: plugins({ vocab }) })
let plan = { entity: { eid: 'plan' }, doc: { title: 'Plan' } }

// What a sketch writes into a graph holding the plan, read when the file
// loads: each `contains` as `from > to @ord` by title, and the eids of what
// it made by kind.
let written = async (s: Partial<Sketch>, cx: Partial<Context> = {}) => {
  let g = fresh()
  await g.apply([plan])
  await g.apply(batch(sketch(s), { vocab, read, ...cx }).bundles)
  let eids = async (q: string) =>
    (await g.read(q)).map((b) => b.entity.eid).toSorted()
  let title = new Map(
    (await g.read('.doc')).map((b) => [b.entity.eid, (b.doc as Comp).title]),
  )
  let links = (await g.read('.contains *')).map((b) => b.edge as Comp)
    .toSorted((a, b) => Number(a.ord) - Number(b.ord))
    .map((e) =>
      `${title.get(e.from as string)} > ${title.get(e.to as string)} @${e.ord}`
    )
  let topics = (await g.read('.topic')).map((b) => (b.topic as Comp).name)
  return { links, tasks: await eids('.task'), topics: topics.toSorted() }
}
let nested = await written(
  { comps: { task: {} }, outline: 'A\n  B\n    C\n  D\nE' },
  { in: 'plan', ord: 2 },
)
let rooted = await written({
  comps: { doc: { title: 'Root' }, task: {} },
  outline: 'x\ny',
}, { in: 'plan' })
let topics = await written({ comps: { topic: {} }, outline: 'breads\n  rye' })
let refused: Refused | undefined
try {
  await fresh().apply(
    batch(sketch({ comps: { shelf: {} } }), { vocab, read }).bundles,
  )
} catch (e) {
  refused = e as Refused
}

test('a sketch with no outline is one entity, made by alias', () => {
  let s = sketch({ comps: { doc: { title: 'Ship it', body: '' }, task: {} } })
  equal(batch(s, { vocab, read }), {
    bundles: [{ entity: { eid: '$1' }, doc: { title: 'Ship it' }, task: {} }],
    said: [],
    made: [{ alias: '$1' }],
  })
})

test('an outline nests by contains, in order, in the entity it is made in', () => {
  equal(nested.links.toSorted(), [
    'A > B @0',
    'A > D @1',
    'B > C @0',
    'Plan > A @2',
    'Plan > E @3',
  ])
})

test('a sketch that names itself holds its outline, and each line is like it', () => {
  equal(rooted.links, ['Plan > Root @0', 'Root > x @0', 'Root > y @1'])
  equal(rooted.tasks.length, 3)
})

test('a line is what identifies its entity, so a topic is named by its line', () => {
  equal(topics.topics, ['breads', 'rye'])
})

test('nothing typed writes nothing, and an outline alone is its titled lines', () => {
  equal(batch(sketch({}), { vocab, read }).bundles, [])
  equal(batch(sketch({ outline: 'a\n  b' }), { vocab, read }).bundles, [
    { entity: { eid: '$1' }, doc: { title: 'a' } },
    { entity: { eid: '$2' }, doc: { title: 'b' } },
    {
      entity: { eid: '$e1' },
      edge: { from: '$1', to: '$2', ord: 0 },
      contains: {},
    },
  ])
})

test('typed text that cannot be read is said beside its field, and left out', () => {
  let s = sketch({ comps: { book: { pages: 'many' } } })
  equal(batch(s, { vocab, read }).said, [
    { comp: 'book', prop: 'pages', said: 'book.pages is a number' },
  ])
  equal(batch(s, { vocab, read }).bundles, [{
    entity: { eid: '$1' },
    book: {},
  }])
})

test('a refusal points at the alias and field it is about', () => {
  equal([refused?.eid, refused?.comp, refused?.prop], ['$1', 'shelf', 'aisle'])
})

test('like this is the components a client writes, without values or history', () => {
  let e: Bundle = {
    entity: { eid: 't' },
    doc: { title: 'T', body: 'b' },
    task: {},
    completed: { at: 'now' },
    created: { at: 'now', by: 'p' },
  }
  equal(like(vocab, e), { comps: { doc: {}, task: {} }, outline: '' })
})

test('a search ranks by name, then by what a component is said to be', () => {
  equal(find(vocab, 'book')[0], {
    name: 'book',
    signature: 'book{pages}',
    about: '',
  })
  equal(find(vocab, 'doc', ['doc']).some((h) => h.name == 'doc'), false)
  equal(find(vocab, 'zzz'), [])
})
