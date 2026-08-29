// Scored resolution: the most specific renderer wins, ties go to
// registration order, platform overrides beat the shared list on ties.
import { h } from 'preact'
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
import { mount } from './mount.ts'
import { type Ent } from '../types.ts'
import { assertEquals } from '@std/assert'

// A fixture renderer is a component like any other — it just paints its tag
// as text. Resolution picks the winner; mounting through Preact reads which
// tag it painted (tag() below), never a bare call.
let R = (view: string, match: (e: Ent) => number | boolean, tag: string) => ({
  view,
  match,
  Render: () => tag,
})

define([
  R('Task', has('doc', 'task'), 'task'),
  R('Doc', has('doc'), 'doc'),
  R('Card.Title', has('doc', 'task'), 'task-title'),
  R('Card.Title', has('doc'), 'doc-title'),
  R('Card.Title', () => true, 'any-title'),
  R('Tile', has('doc', 'task'), 'task-tile'),
  R('Tile', has('doc'), 'doc-tile'),
  R('JSON', () => true, 'json'),
], ['Task', 'Doc', 'JSON'])

let ent = (comps: Record<string, unknown>) =>
  ({ eid: 'x', num: 1, kind: '?', refs: [], kids: [], ...comps }) as Ent

// Mount the renderer resolution picks and read the tag it painted — the
// renderer is a component, so it goes through Preact, never a bare call.
let tag = (comps: Record<string, unknown>, view: string) => {
  let e = ent(comps)
  let { root, free } = mount(h(resolve(e, view).Render, { e }))
  let text = root.textContent
  free()
  return text
}

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
  assertEquals(tag({ doc: {}, task: {} }, 'Card.Title'), 'task-title')
  assertEquals(tag({ doc: {} }, 'Card.Title'), 'doc-title')
  assertEquals(tag({}, 'Card.Title'), 'any-title')
})

Deno.test('suffix walk: qualifiers fall leftward', () => {
  let task = { doc: {}, task: {} }
  // place-qualified requests keep walking when no place specializes them
  assertEquals(tag(task, 'List.Tile'), 'task-tile')
  assertEquals(tag(task, 'Board.List.Tile'), 'task-tile')
  // no match at a level → keep walking to Tile
  assertEquals(tag({ doc: {} }, 'Board.List.Tile'), 'doc-tile')
  // component specificity still breaks ties within a level
  assertEquals(tag(task, 'Kanban.Tile'), 'task-tile')
  // a name unknown at every level still falls back to JSON
  assertEquals(resolve(ent(task), 'Nope.Nada').view, 'JSON')
  // alias heals an old stored name at ANY level: bare, and after a strip
  // (the card frame prefixes its ask, so Card.Show must land on the heal)
  let was = alias['Show']
  alias['Show'] = 'Board.Tile'
  assertEquals(tag(task, 'Show'), 'task-tile')
  assertEquals(tag(task, 'Card.Show'), 'task-tile')
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
    actionsFor(ent({ task: {} })).map((a) => a.label),
    ['set-open', 'delete'], // both contributors, registration order
  )
  assertEquals(actionsFor(ent({})).map((a) => a.label), ['delete'])
})

Deno.test('override wins its tie', () => {
  extend([R('Task', has('doc', 'task'), 'tui-task')])
  assertEquals(tag({ doc: {}, task: {} }, 'Task'), 'tui-task')
})
