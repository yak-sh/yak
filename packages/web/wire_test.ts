// The sync wire's two-way rolling-deploy contract.
import { assert, assertEquals } from '@std/assert'
import type { Change } from './types.ts'
import { liveChanges, liveFrame } from './wire.ts'

let changes: Change[] = [
  { eid: 'one', name: 'doc', comp: { title: 'One' } },
]

Deno.test('unadvertised clients receive the old bare batch', () => {
  let frame = liveFrame(changes, 7, false)
  assert(Array.isArray(frame))
  assertEquals(frame, changes)
})

Deno.test('advertised clients receive a cursor envelope', () => {
  assertEquals(liveFrame(changes, 7, true), { live: changes, cursor: 7 })
})

Deno.test('new decoders accept old and new server frames', () => {
  assertEquals(liveChanges(changes), changes)
  assertEquals(liveChanges({ live: changes, cursor: 7 }), changes)
})
