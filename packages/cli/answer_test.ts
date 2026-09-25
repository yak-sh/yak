import { assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc'
import { edgeDoc, edgeKeywords } from '@yaks/edge/vocab'
import { views as docViews } from '@yaks/doc/views'
import { idKeywords } from '@yaks/id'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { taskDoc } from '@yaks/task'
import { views as taskViews } from '@yaks/task/views'
import { toolsDoc } from '@yaks/tools'
import { views as toolViews } from '@yaks/tools/views'
import { loadVocab } from '@yaks/vocab'
import { define, resolve } from '@yaks/render'
import { printed, referenced, registry, terminal } from './answer.ts'

let vocab = loadVocab([kernelDoc, edgeDoc, docDoc, taskDoc, toolsDoc], [
  kernelKeywords,
  idKeywords,
  edgeKeywords,
])
let modules: Record<string, unknown> = {
  '@yaks/doc': { views: docViews },
  '@yaks/task': { views: taskViews },
  '@yaks/tools': { views: toolViews },
}
let views = await registry(
  ['@yaks/doc', '@yaks/task', '@yaks/web'],
  (p) => Promise.resolve(modules[p] ?? null),
)
let said = (...answer: Record<string, unknown>[]) =>
  printed(views, vocab, answer as never)

let t9 = {
  entity: { eid: '11111111-1111-4111-8111-111111111111', num: 9 },
  doc: { title: 'Fix the bar' },
  task: {},
}
let t10 = {
  entity: { eid: '22222222-2222-4222-8222-222222222222', num: 10 },
  doc: { title: 'Ship it' },
  task: {},
  completed: {},
}

Deno.test('a tool’s text prints as written, line for line', () => {
  let text = { entity: { eid: 'c' }, content: { body: 'one\ntwo\x1b[31m' } }
  assertEquals(said(text), 'one\ntwo[31m')
  assertEquals(said(text, text), 'one\ntwo[31m\none\ntwo[31m')
})

Deno.test('several entities are a line each; nothing is no lines', () => {
  assertEquals(said(t9, t10), 'T-9 Fix the bar open\nT-10 Ship it done')
  assertEquals(said(), '')
})

Deno.test('a lone entity is shown whole', () => {
  assertEquals(
    said(t10),
    'task T-10 done\n\nShip it\n\nDetails\n\ntask: ✓\ncompleted: ✓',
  )
})

Deno.test('a reference prints as the id of the entity looked up for it', () => {
  let t11 = {
    entity: { eid: '33333333-3333-4333-8333-333333333333', num: 11 },
    task: {},
  }
  let done = { ...t10, completed: { by: t11.entity.eid } }
  assertEquals(referenced(vocab, [done as never]), [t11.entity.eid])
  let facts = (named: unknown[]) =>
    printed(views, vocab, [done as never], named as never).split('\n').pop()
  // Not looked up: its handle, which a shell reads as a comment from the `#`.
  assertEquals(facts([]), 'completed: by #3333333333')
  assertEquals(facts([t11]), 'completed: by T-11')
})

Deno.test('a held answer is drawn by a plugin’s terminal views first', async () => {
  let app = { view: 'Page', match: true as const, Render: () => null }
  let held = await terminal(
    ['@yaks/task'],
    (p) => Promise.resolve(modules[p] ?? null),
    (p) => Promise.resolve(p == '@yaks/task' ? { views: define([app]) } : null),
  )
  assertEquals(resolve(held, t9, 'Page', vocab), app)
  // A printed answer never reaches a component: it is not text.
  assertEquals(said(t9).includes('Fix the bar'), true)
})

// `from relation to`, as a stored link: the relation is the component beside
// `edge`.
let link = (from: string, relation: string, to: string) => ({
  entity: { eid: `${from.slice(0, 8)}-${relation}` },
  edge: { from, to },
  [relation]: {},
})

Deno.test('an entity and what links to it prints whole, each link by its relation', () => {
  let t9eid = t9.entity.eid, t10eid = t10.entity.eid
  let shown = printed(views, vocab, [
    t9,
    link(t10eid, 'contains', t9eid),
    link(t9eid, 'requires', t10eid),
    link(t10eid, 'references', t9eid),
  ] as never, [t10] as never)
  assertEquals(
    shown.split('\n\nDetails')[0],
    'task T-9 open\n\nFix the bar\n\n' +
      'contains ←\n\n- T-10 Ship it done\n\n' +
      'requires →\n\n- T-10 Ship it done',
  )
})

Deno.test('a link in a list reads as the sentence it states', () => {
  assertEquals(
    printed(views, vocab, [
      link(t10.entity.eid, 'contains', t9.entity.eid),
      link(t9.entity.eid, 'requires', t10.entity.eid),
    ] as never, [t9, t10] as never).split('\n')
      .map((line) => line.replace(/^#\S+ /, '').trimEnd()),
    ['T-10 contains T-9', 'T-9 requires T-10'],
  )
})
