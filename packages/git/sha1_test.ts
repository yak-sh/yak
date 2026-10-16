// The open-state digest against the platform's closed one: same bytes, same
// twenty, however the bytes arrive.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { hex } from './oid.ts'
import { sha1 } from './sha1.ts'

let subtle = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  hex(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes)))

// The same message, fed in runs of these lengths.
let fed = (bytes: Uint8Array, runs: number[]): string => {
  let sum = sha1()
  let at = 0
  for (let i = 0; at < bytes.length; i++) {
    let n = Math.min(runs[i % runs.length], bytes.length - at)
    sum.update(bytes.subarray(at, at + n))
    at += n
  }
  return hex(sum.digest())
}

let some = (n: number): Uint8Array<ArrayBuffer> =>
  Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 256)

// Platform digests are fixture expectations, not the incremental hash under
// test. OS worker scheduling does not belong in either assertion's timing.
let padding = await Promise.all(
  [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 128, 1000].map(async (n) => {
    let bytes = some(n)
    return { n, bytes, want: await subtle(bytes) }
  }),
)
let bytes = some(1000), want = await subtle(bytes)

test("the digest is the platform's, at every padding boundary", () => {
  for (let { n, bytes, want } of padding) {
    assertEquals(fed(bytes, [n || 1]), want, `${n} bytes`)
  }
})

for (let runs of [[1], [7], [63], [64], [65], [1, 100, 3], [500]]) {
  test(`incremental digest accepts byte runs of ${runs.join('+')}`, () => {
    assertEquals(fed(bytes, runs), want, runs.join('+'))
  })
}
