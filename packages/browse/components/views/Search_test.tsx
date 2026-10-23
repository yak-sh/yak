// Search decorates real domain tiles; it never supplies a substitute title.
// Words someone said, and any long text, are one passage row: who, when,
// where, and the words around what was sought, never the text whole.
import { test } from '@yaks/testing'
import '../../testing.ts'
import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import { applyLocal } from '../../live.ts'
import { Entity } from '../Entity.tsx'
import { contribute } from '../inspect.tsx'
import { mount } from '../mount.ts'
import * as sessionFacet from '@yaks/session/views'

// The session package's views, taken in while this file reads its rows, and
// put back before any test runs: other files share this page's registry.
let drop = await contribute([sessionFacet])

let seed = (eid: string, comps: Record<string, unknown>) =>
  applyLocal(
    Object.entries({ entity: { eid, num: 1 }, ...comps }).map((
      [name, comp],
    ) => ({ eid, name, comp: comp as Record<string, unknown> })),
  )

// A row of the palette's results for `words`, read once the file loads.
let found = (eid: string, words: string[]) => {
  let seen = mount(h(Entity, { eid, view: 'Search.Tile', words }))
  let root = seen.root
  let read = {
    text: root.textContent ?? '',
    href: root.querySelector('a')?.getAttribute('href'),
    marks: [...root.querySelectorAll('.Match')].map((m) => m.textContent),
    passage: root.querySelector('.Passage_Text')?.textContent,
    who: root.querySelector('.Passage_Who')?.textContent,
    whole: !!root.querySelector('.Entry'),
  }
  seen.free()
  return read
}

let cases = [
  {
    kind: 'mail',
    comps: {
      mail: {},
      doc: { title: '=?UTF-8?Q?Hello_=E2=9C=93?=', body: '' },
    },
    title: 'Hello ✓',
  },
  {
    kind: 'comment',
    comps: { comment: {}, doc: { body: 'Use the shared renderer' } },
    title: 'Use the shared renderer',
  },
  {
    kind: 'session',
    comps: { session: {}, brief: { text: 'Ship the update' } },
    title: 'Ship the update',
  },
]
for (let { kind, comps } of cases) seed(`search-${kind}`, comps)
let readings = cases.map(({ kind }) => found(`search-${kind}`, []))

cases.forEach(({ kind, title }, i) =>
  test(`search preserves the ${kind} tile's own reading`, () => {
    let seen = readings[i]
    assertEquals(seen.text.includes(title), true)
    assertEquals(seen.text.toLowerCase().includes('untitled'), false)
    assertEquals(seen.href != null, true)
  })
)

let subject = found('search-mail', ['hello'])
test('a matched mail subject is marked as it reads, decoded', () => {
  assert(subject.text.includes('Hello ✓'))
  assertEquals(subject.marks, ['Hello'])
})

seed('search-task', {
  doc: { title: 'Fix the bar', body: 'Find the bar before it closes.' },
  task: {},
})
let task = found('search-task', ['bar'])
test('a task found by its words marks its title, and the passage under it', () => {
  assertEquals(task.marks, ['bar', 'bar'])
  assertEquals(task.passage, 'Find the bar before it closes.')
})

let JEFF = '00000000-0000-4000-8000-00000000000a'
let SESSION = '00000000-0000-4000-8000-00000000000b'
seed(JEFF, { doc: { title: 'Jeff', body: '' }, person: {} })
seed(SESSION, {
  doc: { title: 'Search rows for words', body: '' },
  session: { id: 'run-1' },
})
let filler = 'A paragraph that is not the match. '.repeat(40)
seed('search-entry', {
  entry: { session: SESSION, seq: 12 },
  content: {
    body: `${filler}\n\nresults are often miles long\n\n${filler}`,
  },
  created: { by: JEFF, at: '2026-10-23T18:26:21Z' },
})
let entry = found('search-entry', ['miles'])
drop()
test('words said in a transcript are one passage row, not the message whole', () => {
  assertEquals(entry.whole, false)
  assertEquals(entry.who, 'Jeff')
  assert(entry.text.includes('in Search rows for words'))
  assertEquals(entry.marks, ['miles'])
  assert(entry.passage!.includes('results are often miles long'))
  assert(entry.passage!.length < 240)
})
