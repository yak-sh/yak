// The digest has to be the standard one: a precondition token is computed by a
// reader and checked by a writer that share no code, so "our sha256" would be
// a bug with a long fuse. Held against the published vectors and against the
// platform's own digest.

import { assertEquals } from '@std/assert'
import { sha256 } from './sha256.ts'
import { token } from './guard.ts'

let hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

Deno.test('sha256 matches the published vectors', () => {
  assertEquals(
    sha256(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
  assertEquals(
    sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
})

Deno.test('sha256 matches the platform digest, including multi-byte text', async () => {
  for (
    let s of ['', 'a', 'the quick brown fox', 'æøå — 日本語', 'x'.repeat(200)]
  ) {
    let want = hex(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
    )
    assertEquals(sha256(s), want, s.slice(0, 20))
  }
})

Deno.test('a guard token hashes the value as text, and absence is null', () => {
  assertEquals(token(null), null)
  assertEquals(token(undefined), null)
  assertEquals(token(42), sha256('42'))
  assertEquals(token('42'), sha256('42'))
})
