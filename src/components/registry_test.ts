// Scored resolution: the most specific renderer wins, ties go to
// registration order, platform overrides beat the shared list on ties.
import {
  actionsFor,
  alias,
  applicable,
  define,
  defineActions,
  extend,
  has,
  resolve,
} from './registry.ts'
import { type Ent } from '../types.ts'
import { assertEquals } from '@std/assert'

let R = (view: string, match: (e: Ent) => number | boolean, tag: string) => // deno-lint-ignore no-explicit-any
({ view, match, Render: (() => tag) as any })

define([
  R('Task', has('doc', 'task'), 'task'),
  R('Doc', has('doc'), 'doc'),
  R('Card.Title', has('doc', 'task'), 'task-title'),
  R('Card.Title', has('doc'), 'doc-title'),
  R('Card.Title', () => true, 'any-title'),
  R('List.Tile', has('doc', 'task'), 'list-tile'),
  R('Tile', has('doc', 'task'), 'task-tile'),
  R('Tile', has('doc'), 'doc-tile'),
  R('JSON', () => true, 'json'),
], ['Task', 'Doc', 'JSON'])

let ent = (comps: Record<string, unknown>) =>
  ({ eid: 'x', num: 1, kind: '?', refs: [], kids: [], ...comps }) as Ent

let CASES: [string, Record<string, unknown>, string | undefined, string][] = [
  ['doc+task outranks doc', { doc: {}, task: {} }, undefined, 'Task'],
  ['doc alone', { doc: {} }, undefined, 'Doc'],
  ['bare falls to catch-all', {}, undefined, 'JSON'],
  [
    'named view, specific wins',
    { doc: {}, task: {} },
    'Card.Title',
    'Card.Title',
  ],
  ['unservable named view falls back to JSON', {}, 'Task', 'JSON'],
]

Deno.test('resolution', () => {
  for (let [name, comps, view, want] of CASES) {
    assertEquals(resolve(ent(comps), view).view, want, name)
  }
  // title tier: the 2-scorer, then the 1-scorer, then the catch-all
  assertEquals(
    (resolve(ent({ doc: {}, task: {} }), 'Card.Title')
      .Render as unknown as () => string)(),
    'task-title',
  )
  assertEquals(
    (resolve(ent({ doc: {} }), 'Card.Title').Render as unknown as () =>
      string)(),
    'doc-title',
  )
  assertEquals(
    (resolve(ent({}), 'Card.Title').Render as unknown as () => string)(),
    'any-title',
  )
})

let tag = (comps: Record<string, unknown>, view: string) =>
  (resolve(ent(comps), view).Render as unknown as () => string)()

Deno.test('suffix walk: qualifiers fall leftward', () => {
  let task = { doc: {}, task: {} }
  // exact match wins over its own suffix
  assertEquals(tag(task, 'List.Tile'), 'list-tile')
  // A.B.C → B.C → C; the first matching level ends the walk, so
  // List.Tile (place) beats the equally-matching bare Tile (shape)
  assertEquals(tag(task, 'Board.List.Tile'), 'list-tile')
  // no match at a level → keep walking (doc-only misses List.Tile)
  assertEquals(tag({ doc: {} }, 'Board.List.Tile'), 'doc-tile')
  // component specificity still breaks ties within a level
  assertEquals(tag(task, 'Kanban.Tile'), 'task-tile')
  // a name unknown at every level still falls back to JSON
  assertEquals(resolve(ent(task), 'Nope.Nada').view, 'JSON')
  // alias heals an old stored name at ANY level: bare, and after a strip
  // (the card frame prefixes its ask, so Card.Show must land on the heal)
  let was = alias['Show']
  alias['Show'] = 'Board.List.Tile'
  assertEquals(tag(task, 'Show'), 'list-tile')
  assertEquals(tag(task, 'Card.Show'), 'list-tile')
  alias['Show'] = was
})

Deno.test('tabs = views with a live matcher', () => {
  assertEquals(applicable(ent({ doc: {}, task: {} })), ['Task', 'Doc', 'JSON'])
  assertEquals(applicable(ent({})), ['JSON'])
})

Deno.test('actions union across matching contributors, in order', () => {
  defineActions([
    {
      match: has('task'),
      acts: (e) => [{
        label: `set-${(e.task as { status: string }).status}`,
        run: () => {},
      }],
    },
    { match: () => true, acts: () => [{ label: 'delete', run: () => {} }] },
  ])
  assertEquals(
    actionsFor(ent({ task: { status: 'open' } })).map((a) => a.label),
    ['set-open', 'delete'], // both contributors, registration order
  )
  assertEquals(actionsFor(ent({})).map((a) => a.label), ['delete'])
})

Deno.test('override wins its tie', () => {
  extend([R('Task', has('doc', 'task'), 'tui-task')])
  assertEquals(
    (resolve(ent({ doc: {}, task: {} }), 'Task').Render as unknown as () =>
      string)(),
    'tui-task',
  )
})
