// The Shelf's write seam: first use mints the per-client canvas, while later
// cards reuse it. UI gestures only choose when to send these graph facts.

import { assertEquals } from '@std/assert'
import { shelfChanges } from './shelf.ts'

Deno.test('shelfChanges mints client, shelf, and requested card atomically', () => {
  let changes = shelfChanges(
    'client',
    'session',
    'Session',
    undefined,
    'pin',
    1,
    'browser',
  )
  let shelf = changes[1].eid
  assertEquals(changes, [
    { eid: 'client', name: 'client', comp: { user_agent: 'browser' } },
    { eid: shelf, name: 'canvas', comp: {} },
    { eid: shelf, name: 'shelf', comp: { client: 'client' } },
    { eid: 'pin', name: 'card', comp: { target: 'session', view: 'Session' } },
    {
      eid: 'pin',
      name: 'pin',
      comp: { canvas: shelf, x: 0, y: 0, w: 0, h: 0, z: 1 },
    },
  ])
})

Deno.test('shelfChanges reuses an existing shelf', () => {
  assertEquals(shelfChanges('client', 'task', 'Full', 'shelf', 'pin', 4), [
    { eid: 'pin', name: 'card', comp: { target: 'task', view: 'Full' } },
    {
      eid: 'pin',
      name: 'pin',
      comp: { canvas: 'shelf', x: 0, y: 0, w: 0, h: 0, z: 4 },
    },
  ])
})

Deno.test('two cold shelf writes derive one canvas, isolated per client', () => {
  let a = shelfChanges('cold-client', 'a', 'Full', undefined, 'a-pin')
  let b = shelfChanges('cold-client', 'b', 'Full', undefined, 'b-pin')
  let c = shelfChanges('other-client', 'b', 'Full', undefined, 'c-pin')
  assertEquals(a[0].eid, b[0].eid)
  assertEquals(a[0].eid == c[0].eid, false)
  assertEquals(a.at(-1)?.comp?.canvas, b.at(-1)?.comp?.canvas)
})
