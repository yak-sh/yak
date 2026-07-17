// Scored resolution: the most specific renderer wins, ties go to
// registration order, platform overrides beat the shared list on ties.
import { applicable, define, extend, has, resolve } from './registry.ts'
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

Deno.test('tabs = views with a live matcher', () => {
  assertEquals(applicable(ent({ doc: {}, task: {} })), ['Task', 'Doc', 'JSON'])
  assertEquals(applicable(ent({})), ['JSON'])
})

Deno.test('override wins its tie', () => {
  extend([R('Task', has('doc', 'task'), 'tui-task')])
  assertEquals(
    (resolve(ent({ doc: {}, task: {} }), 'Task').Render as unknown as () =>
      string)(),
    'tui-task',
  )
})
