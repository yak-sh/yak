// The served client's `digest`: the SHA-256 a page names a file by before an
// upload in parts, which must be the platform's own or every such upload is
// refused. Lengths either side of a block and of the padding's two shapes.
import { equal, test } from '@yaks/testing'
import { digest } from './public/client.js'

test("a file's digest is its SHA-256", async () => {
  // Independent SHA-256 vectors, including both padding shapes. No second asynchronous
  // hash is needed to check the served algorithm.
  for (let [n, sha] of vectors) {
    let bytes = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff)
    equal(await digest(new Blob([bytes])), sha, `${n} bytes`)
  }
})

let vectors: [number, string][] = [
  [0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  [55, '0c74b286e2c8b409ed0fd89f5a8344aeb274bda5d9bfbe7b8e537cfc6142736d'],
  [56, '8136496fb4867a08f8c0f1afaf000ef4093ecc2d544f4f808ef9d5945ca4c2fa'],
  [64, '3ea97ec766b8247739939247b4d4cb362cf13c100deb0cc2ba5391f762023852'],
  [130, 'bc4914958d557f459f021ee6e4e1c3195d97368f91052bdab54edadae4030ba7'],
]
