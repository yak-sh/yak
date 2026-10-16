// The digest has to be the standard one: a precondition token is computed by a
// reader and checked by a writer that share no code, so "our sha256" would be
// a bug with a long fuse. Held against the published vectors and against the
// platform's own digest.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { sha256, token } from '@yaks/graph/sha256'

let hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

test('sha256 matches the published vectors', () => {
  assertEquals(
    sha256(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
  assertEquals(
    sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
})

// Platform digests are independent expected values, not work under test. Ask
// for them while the file loads so OS thread scheduling cannot time the check.
let texts = [
  '',
  'a',
  'the quick brown fox',
  'æøå — 日本語',
  'x'.repeat(55),
  'x'.repeat(56),
  'x'.repeat(200),
  'æ'.repeat(300),
  'y'.repeat(1000),
  'z',
]
let wants = await Promise.all(
  texts.map(async (s) =>
    hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  ),
)

test('sha256 matches the platform digest, including multi-byte text', () => {
  texts.forEach((s, i) => assertEquals(sha256(s), wants[i], s.slice(0, 20)))
})

test('a guard token hashes the value as text, and absence is null', () => {
  assertEquals(token(null), null)
  assertEquals(token(undefined), null)
  assertEquals(token(42), sha256('42'))
  assertEquals(token('42'), sha256('42'))
})

let bytes = new Uint8Array([19, 0, 255, 128, 19]).subarray(1, 4)
let digest = hex(await crypto.subtle.digest('SHA-256', bytes))
test('binary tokens hash exactly the visible bytes', () => {
  assertEquals(token(bytes), digest)
  assertEquals(token(bytes), token(new Uint8Array([0, 255, 128])))
  assertEquals(token(new Uint8Array()), sha256(''))
})
