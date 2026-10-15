// The served client's `digest`: the SHA-256 a page names a file by before an
// upload in parts, which must be the platform's own or every such upload is
// refused. Lengths either side of a block and of the padding's two shapes.
import { equal, test } from '@yaks/testing'
import { digest } from './public/client.js'
import { sha256 } from './versions.ts'

test("a file's digest is its SHA-256", async () => {
  for (let n of [0, 55, 56, 64, 130]) {
    let bytes = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff)
    equal(await digest(new Blob([bytes])), await sha256(bytes), `${n} bytes`)
  }
})
