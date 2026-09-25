import { assertEquals } from '@std/assert'
import { docDoc } from '@yaks/doc'
import { views as docViews } from '@yaks/doc/views'
import { idKeywords } from '@yaks/id'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { taskDoc } from '@yaks/task'
import { views as taskViews } from '@yaks/task/views'
import { toolsDoc } from '@yaks/tools'
import { views as toolViews } from '@yaks/tools/views'
import { loadVocab } from '@yaks/vocab'
import { define, resolve } from '@yaks/render'
import { printed, registry, terminal } from './answer.ts'

let vocab = loadVocab([kernelDoc, docDoc, taskDoc, toolsDoc], [
  kernelKeywords,
  idKeywords,
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
