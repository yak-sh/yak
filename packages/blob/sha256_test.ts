import { equal, test } from '@yaks/testing'
import { addressOf, hasher } from './mod.ts'

test('bytes hashed in pieces of any size hash as they do whole', async () => {
  let bytes = new Uint8Array(1000).map((_, i) => (i * 31) & 0xff)
  for (let cuts of [[], [1, 63, 64, 65], [55, 56, 119, 120], [999]]) {
    let h = hasher()
    let at = 0
    for (let to of [...cuts, bytes.length]) h.add(bytes.slice(at, at = to))
    equal(h.end(bytes.length), await addressOf(bytes), `cut at ${cuts}`)
  }
})
