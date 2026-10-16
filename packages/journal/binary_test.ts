/// <reference lib="deno.ns" />
// Exercise the journal's public write/feed/history doors, not its table format.
import { equal, test } from '@yaks/testing'
import { wikiLog } from './testing.ts'

let { j } = wikiLog()
let bytes = new Uint8Array([19, 0, 255, 128, 19]).subarray(1, 4)
let seq = j.write({ at: '2026-10-16T00:00:00Z' }, [{
  target: 'ada',
  comp: 'document',
  value: { bytes },
}])
test('journal write and feed preserve binary after-images', () => {
  equal(j.since(seq - 1)[0].patches[0].value, { bytes })
  equal(j.history('ada')[0].deltas.find((d) => d.prop == 'bytes')?.after, bytes)
})
