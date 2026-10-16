import { equal, test } from '@yaks/testing'
import { addressOf, hasher } from './mod.ts'

// Independent whole-buffer digest and immutable chunks are test inputs; the
// contract is the incremental hasher with every padding/block boundary cut.
let bytes = new Uint8Array(1000).map((_, i) => (i * 31) & 0xff)
let expected = await addressOf(bytes)
for (let cuts of [[], [1, 63, 64, 65], [55, 56, 119, 120], [999]]) {
  let at = 0
  let chunks = [...cuts, bytes.length].map((to) => bytes.slice(at, at = to))
  test(`bytes hashed in pieces hash as they do whole: cuts ${cuts}`, () => {
    let h = hasher()
    for (let chunk of chunks) h.add(chunk)
    equal(h.end(bytes.length), expected, `cut at ${cuts}`)
  })
}
