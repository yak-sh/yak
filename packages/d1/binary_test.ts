/// <reference lib="deno.ns" />
// D1 accepts ArrayBuffers and returns BLOBs as number arrays. The adapter
// hides both representations, preserving the exact Uint8Array view.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { binaryVocab } from '../sqlite/binary_cases.ts'
import { store } from './testing.ts'

let s = await store(binaryVocab)
let input = Uint8Array.of(99, 0, 255, 128, 99).subarray(1, 4)
await s.tx((tx) =>
  tx.patch([
    { entity: { eid: 'full' }, document: { bytes: input } },
    { entity: { eid: 'empty' }, document: { bytes: new Uint8Array() } },
  ])
)
input.fill(17)

test('D1 round-trips a byte view and an empty BLOB through its native bindings', async () => {
  let out = await s.get(['full', 'empty'])
  assertEquals(out.map((b) => (b.document as { bytes: Uint8Array }).bytes), [
    Uint8Array.of(0, 255, 128),
    new Uint8Array(),
  ])
})

test('D1 filters a byte value through its native bindings', async () => {
  assertEquals(
    (await s.read('.document.bytes=AP+A')).map((b) => b.entity.eid),
    ['full'],
  )
})

test('D1 projects byte values and empty BLOBs through its native bindings', async () => {
  assertEquals(await s.rows('.document .fields=document.bytes'), [
    { eid: 'full', 'document.bytes': Uint8Array.of(0, 255, 128) },
    { eid: 'empty', 'document.bytes': new Uint8Array() },
  ])
})
