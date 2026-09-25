// The views as a terminal prints them: the same renderers a browser mounts,
// through @yaks/text, with a package's own views ahead of the generic ones.

import { assertEquals } from '@std/assert'
import { views as docViews } from '@yaks/doc/views'
import { docDoc } from '@yaks/doc'
import { kernelDoc, kernelKeywords } from '@yaks/kernel/vocab'
import { define } from './mod.ts'
import { taskDoc } from '@yaks/task'
import { views as taskViews } from '@yaks/task/views'
import { type Node, plain, tree } from '@yaks/text'
import { loadVocab } from '@yaks/vocab'
import { type Shown, views } from './views.ts'

let vocab = loadVocab([kernelDoc, docDoc, taskDoc], [kernelKeywords])
let registry = define([
  ...docViews.renderers,
  ...taskViews.renderers,
  ...views.renderers,
])

let WEB = '00000000-0000-4000-8000-000000000001'
let JEFF = '00000000-0000-4000-8000-000000000002'
let task = {
  entity: { eid: WEB, num: 9 },
  doc: { title: 'Web door', body: 'Opens *any* entity.' },
  task: {},
}
let done = {
  entity: { eid: '00000000-0000-4000-8000-000000000003', num: 4 },
  doc: { title: 'Reserve a name' },
  task: {},
  completed: { at: '2026-09-23T15:00:00Z' },
}
let comment = {
  entity: { eid: '00000000-0000-4000-8000-000000000004', num: 5 },
  doc: { body: 'Looks right.' },
  comment: { target: WEB },
  created: { by: JEFF, at: '2026-09-23T16:00:00Z' },
}

let ctx: Shown<Node> = {
  id: (b) => `T-${b.entity.num}`,
  kind: () => 'task',
  name: (eid) => (eid == JEFF ? 'Jeff' : eid),
  link: (eid) => (eid == JEFF ? '/P-2' : undefined),
  when: () => 'today',
  show: (b, view) => tree(registry, b, view, vocab, ctx),
}
let text = (b: object, view: string, extra: Partial<Shown<Node>> = {}) =>
  plain(tree(registry, b as never, view, vocab, { ...ctx, ...extra }))

Deno.test('a tile is the id, the title and the status the marks give', () => {
  assertEquals(text(task, 'Tile'), 'T-9 Web door open')
  assertEquals(text(done, 'Tile'), 'T-4 Reserve a name done')
})

Deno.test('an entity with no title is called by its id', () => {
  assertEquals(text({ entity: { eid: WEB, num: 9 } }, 'Title'), 'T-9')
})

Deno.test('a comment names its author and when, then its body', () => {
  assertEquals(text(comment, 'Comment'), 'Jeff (/P-2) · today\n\nLooks right.')
})

Deno.test('a page gathers its relations and comments through show', () => {
  let page = text(task, 'Page', {
    relations: [{ title: 'requires', items: [done] }, {
      title: 'empty',
      items: [],
    }],
    comments: [comment],
  })
  for (
    let part of [
      'task T-9 open',
      'Web door',
      'Opens any entity.',
      'requires',
      'T-4 Reserve a name done',
      '1 comment',
      'Looks right.',
      'Details',
      'task: ✓',
    ]
  ) assertEquals(page.includes(part), true, part)
  assertEquals(page.includes('empty'), false)
})
