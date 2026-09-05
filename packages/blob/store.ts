// The backend seam: where the bytes go. Three methods over one key — and the
// key is not the caller's to choose, it is the SHA-256 of the bytes themselves,
// which is what makes the store content-addressed: the same value written twice
// is one stored object, and a stored object can never be the wrong one for its
// key.
//
// Everything above this seam is bytes and hashes; nothing above it knows
// whether they landed in a table, a directory or a bucket. That is why a
// backend is three functions and not a class: `sqliteBlobs`, `fileBlobs` and
// `objectBlobs` in this package are each a small object of this shape, and so
// is anything you write yourself.
//
// Every method is async-OR-sync, the same pass-through rule @yaks/graph's
// `Storage` follows: a table in the database you are already writing answers
// immediately and keeps `apply()` synchronous, a bucket over the network
// answers with a promise and makes it asynchronous.

import { sha256 } from '@yaks/graph'

/**
 * A content-addressed byte store. `sha` is always the lowercase-hex SHA-256 of
 * the bytes — {@link address} computes it, and a backend may take it on trust
 * rather than re-hashing.
 */
export type Blobs = {
  /** whether the store already holds an object under this hash */
  has: (sha: string) => boolean | Promise<boolean>
  /** the bytes stored under this hash, or `undefined` if there are none */
  get: (
    sha: string,
  ) => Uint8Array | undefined | Promise<Uint8Array | undefined>
  /** store these bytes under this hash; storing the same pair twice is a
   * no-op, because the second copy is the first one */
  put: (sha: string, bytes: Uint8Array) => void | Promise<void>
}

let utf8 = new TextEncoder()
let text = new TextDecoder()

/**
 * The address of a string: the SHA-256 of its UTF-8 bytes, lowercase hex. This
 * is the value a content-addressed column holds in place of its text, and the
 * key the bytes are stored under.
 *
 * It reuses @yaks/graph's synchronous digest rather than `crypto.subtle`, whose
 * promise would make every write to a body column asynchronous — including one
 * over an embedded database that is otherwise synchronous end to end.
 */
export let address = (value: string): string => sha256(value)

/** A string as the bytes a store holds: its UTF-8 encoding. */
export let encode = (value: string): Uint8Array => utf8.encode(value)

/** Stored bytes read back as the string they encode. */
export let decode = (bytes: Uint8Array): string => text.decode(bytes)
