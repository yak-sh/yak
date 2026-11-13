import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { type Bundle, graph, type Plugin } from '@yaks/graph'
import { edited } from '@yaks/graph/tools'
import { ram } from '@yaks/ram'
import { idDoc, idKeywords } from '@yaks/id'
import { ids } from '@yaks/id/graph'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { plugins } from './graph.ts'

let doc: VocabDoc = {
  $defs: {
    entity: { component: true, type: 'object', wire: false, properties: {} },
    doc: {
      component: true,
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string', prose: true },
      },
    },
    content: {
      component: true,
      type: 'object',
      properties: { body: { type: 'string', prose: ['topic'] } },
    },
    project: { component: true, type: 'object', kind: true, prefix: 'P' },
    task: { component: true, type: 'object', kind: true, prefix: 'T' },
    topic: { component: true, type: 'object', kind: true, properties: {} },
    entry: { component: true, type: 'object', kind: true, properties: {} },
  },
}
let vocab = loadVocab([doc, idDoc], [idKeywords])
let PROJECT = '352e9920-08ae-436c-94e2-14bd02a37b2d'
let TASK = '0e513227-de00-4000-8000-000000000001'

// A store numbering its entities, which knows the ids people type: the
// project is P-1 and the task T-2. `prose` composes the plugin or does not.
let store = (prose = true) => {
  let g = graph({
    storage: ram(vocab, { number: true }),
    vocab,
    plugins: [ids(vocab), ...prose ? plugins({ vocab }) : []] as Plugin[],
  })
  g.apply([
    { entity: { eid: PROJECT, prefix: 'P', num: 1 }, project: {} },
    { entity: { eid: TASK, prefix: 'T', num: 2 }, task: {} },
  ])
  return g
}
let body = async (
  g: ReturnType<typeof store>,
  eid: string,
  comp = 'doc',
  prop = 'body',
) => ((await g.get([eid]))[0][comp] as Record<string, string>)[prop]

test('a write stores each id typed in its prose as the eid it names', async () => {
  let g = store()
  await g.apply([{
    entity: { eid: 'n' },
    doc: {
      title: 'T-2 as a title',
      body: 'P-1 and #0e513227de; T-99, K-2, `T-2` and [plan](T-2) stay',
    },
  }])
  assertEquals(
    await body(g, 'n'),
    `${PROJECT} and ${TASK}; T-99, K-2, \`T-2\` and [plan](${TASK}) stay`,
  )
  assertEquals(await body(g, 'n', 'doc', 'title'), 'T-2 as a title')
})

test("a topic's contents are prose, a transcript entry's are kept as written", async () => {
  let g = store()
  await g.apply([
    { entity: { eid: 'topic' }, topic: {} },
    { entity: { eid: 'said' }, entry: {}, content: { body: 'T-2' } },
  ])
  // The write names no topic: the store says the entity is one.
  await g.apply([{ entity: { eid: 'topic' }, content: { body: 'T-2' } }])
  assertEquals(await body(g, 'topic', 'content'), TASK)
  assertEquals(await body(g, 'said', 'content'), 'T-2')
})

test('a store that does not compose the plugin keeps prose as typed', async () => {
  let g = store(false)
  await g.apply([{ entity: { eid: 'n' }, doc: { body: 'P-1' } }])
  assertEquals(await body(g, 'n'), 'P-1')
})

test('an edit finds the id it types in the eid stored', async () => {
  let g = store()
  await g.apply([{ entity: { eid: 'n' }, doc: { body: 'See P-1.' } }])
  await g.apply(
    await edited(g, [{
      id: 'n',
      text: [{ path: 'doc.body', find: 'P-1', replace: 'T-2', append: ' P-1' }],
    }]),
  )
  assertEquals(await body(g, 'n'), `See ${TASK}. ${PROJECT}`)
  assertEquals(await g.prose(['P-1, not K-1']), [`${PROJECT}, not K-1`])
})

test('a search for an id finds it as stored and as typed', async () => {
  let g = store()
  await g.apply([
    { entity: { eid: 'n' }, doc: { body: 'about T-2' } },
    { entity: { eid: 'said' }, entry: {}, content: { body: 'T-2 too' } },
    { entity: { eid: 'other' }, doc: { body: 'about P-1' } },
  ])
  let found = await g.read('T-2')
  assertEquals(found.map((b) => b.entity.eid).sort(), ['n', 'said'])
})

test('a replica keeps the prose its server stored', async () => {
  let g = store()
  let copy: Bundle = { entity: { eid: 'n' }, doc: { body: 'P-1' } }
  await g.apply([copy], { replica: true })
  assertEquals(await body(g, 'n'), 'P-1')
})

// A body stored before its ids were swapped, as a replica copies it: its
// words stay as typed until a write adds them.
let kept = async (text: string) => {
  let g = store()
  await g.apply([{ entity: { eid: 'n' }, doc: { body: text } }], {
    replica: true,
  })
  return g
}

test('a write swaps only the ids it adds, never words left as they were', async () => {
  let g = await kept('P-1 is very useful.')
  await g.apply(
    await edited(g, [{
      id: 'n',
      text: [{ path: 'doc.body', append: ' T-2' }],
    }]),
  )
  assertEquals(await body(g, 'n'), `P-1 is very useful. ${TASK}`)
  await g.apply([{ entity: { eid: 'n' }, doc: { body: 'P-1 is useful. P-1' } }])
  assertEquals(await body(g, 'n'), `P-1 is useful. ${PROJECT}`)
})

test('a body written back as it was drawn keeps each eid where it stood', async () => {
  let g = await kept(`${PROJECT} beside a typed P-1`)
  await g.apply([{
    entity: { eid: 'n' },
    doc: { body: 'P-1 beside a typed P-1, and T-2' },
  }])
  assertEquals(await body(g, 'n'), `${PROJECT} beside a typed P-1, and ${TASK}`)
})
