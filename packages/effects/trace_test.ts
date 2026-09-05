/// <reference lib="deno.ns" />
// The derivation on its own: a batch plus a reading of what stood before it,
// read as what happened. No graph, no storage — just the arithmetic.

import { assertEquals } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { BEFORE, type Before, events, strip } from './trace.ts'

// A batch carrying the reading `before()` would have taken.
let batch = (had: Before, ...bundles: Bundle[]): Bundle[] =>
  bundles.map((b) => ({ ...b, [BEFORE]: had }))

let said = (bundles: Bundle[]) =>
  events(bundles).map((e) => `${e.kind} ${e.entity.eid} ${e.name}`)

Deno.test('a component nobody carried is a birth, one carried is a change', () => {
  assertEquals(
    said(batch(
      { p2: ['post'] },
      { entity: { eid: 'p1' }, post: { title: 'One' } },
      { entity: { eid: 'p2' }, post: { published: true } },
    )),
    ['created p1 post', 'changed p2 post'],
  )
})

Deno.test('a birth patched again in the same batch is one birth', () => {
  assertEquals(
    said(batch(
      {},
      { entity: { eid: 'p1' }, post: { title: 'One' } },
      { entity: { eid: 'p1' }, post: { published: true } },
    )),
    ['created p1 post', 'changed p1 post'],
  )
})

Deno.test('a null component is a removal, and only if it was there', () => {
  assertEquals(
    said(batch(
      { p1: ['post'] },
      { entity: { eid: 'p1' }, post: null },
      { entity: { eid: 'p2' }, post: null },
    )),
    ['removed p1 post'],
  )
})

Deno.test('a removal then a re-statement is a second birth', () => {
  assertEquals(
    said(batch(
      { p1: ['post'] },
      { entity: { eid: 'p1' }, post: null },
      { entity: { eid: 'p1' }, post: { title: 'Again' } },
    )),
    ['removed p1 post', 'created p1 post'],
  )
})

Deno.test('a dead entity removes every component it carried, once', () => {
  assertEquals(
    said(batch(
      { p1: ['post', 'created'] },
      { entity: { eid: 'p1' }, $delete: true },
      { entity: { eid: 'p1' }, tombstone: {} },
    )),
    ['removed p1 post', 'removed p1 created'],
  )
})

Deno.test('a casualty with nothing read for it says nothing', () => {
  assertEquals(said(batch({}, { entity: { eid: 'c9' }, tombstone: {} })), [])
})

Deno.test('an event carries the patch, and the num the batch minted', () => {
  let [e] = events(batch(
    {},
    { entity: { eid: 'p1' }, post: { title: 'One' } },
    { entity: { eid: 'p1', num: 7 } },
  ))
  assertEquals(e.comp, { title: 'One' })
  assertEquals(e.entity, { eid: 'p1', num: 7 })
})

Deno.test('stripping leaves the batch as applied', () => {
  let bundles = batch({ p1: [] }, {
    entity: { eid: 'p1' },
    post: { title: 'x' },
  })
  assertEquals(strip(bundles), [{
    entity: { eid: 'p1' },
    post: { title: 'x' },
  }])
})
