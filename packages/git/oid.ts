// What a Git object is called: the digest of its own header and body.
//
// Every object in this package is named twice. `oid` is Git's SHA-1 object id
// — the one a `git clone` asks for, and the entity id of the row we keep about
// the object. `oid256` is the SHA-256 object id of the same object, computed
// from the first write so that a client asking for `object-format=sha256` is
// answered by a lookup rather than by converting the repository (Git's own
// hash-function transition, stored as @yaks/key rows instead of a
// loose-object index).
//
// The two ids are not two digests of the same bytes. A tree or a commit names
// its children by id, so the SHA-256 body is the SHA-1 body with every child
// id translated — which is why the builders here take the ids to write rather
// than the objects themselves, and why `Oids` is always a pair.
//
// SHA-1 is a name here, never a security claim: it is what the packfile format
// and Git's protocol specify, so it is what we compute. `crypto.subtle` is the
// only digest available that does both algorithms over bytes, and it is async,
// which makes writing an object async all the way up. That is the price of not
// shipping a second SHA-1 implementation.

/** The four types a Git object can have. */
export type Kind = 'blob' | 'tree' | 'commit' | 'tag'

/** One object's two ids: Git's SHA-1 id, and the SHA-256 id of the same
 * object with its children's ids translated. */
export type Oids = { oid: string; oid256: string }

let utf8 = new TextEncoder()

/** The bytes Git prefixes a body with before hashing it: `tree 42\0`. */
export let header = (type: Kind, size: number): Uint8Array =>
  utf8.encode(`${type} ${size}\0`)

/** Joins byte runs end to end — how every body in this package is assembled.
 *
 * The return type is `Uint8Array<ArrayBuffer>` because `crypto.subtle` refuses
 * a view that might be over shared memory, and every body here ends up in a
 * digest. A freshly allocated array never is. */
export let concat = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  let out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (let p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** A body as it is hashed: the header, then the body. */
export let framed = (
  type: Kind,
  body: Uint8Array,
): Uint8Array<ArrayBuffer> => concat([header(type, body.length), body])

/** Bytes as lowercase hex. Every id in this package is a hex string. */
export let hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** A hex id back as the raw bytes a tree body writes it with. */
export let bin = (id: string): Uint8Array =>
  Uint8Array.from(
    { length: id.length / 2 },
    (_, i) => parseInt(id.slice(i * 2, i * 2 + 2), 16),
  )

/** Computing an object id under one hash algorithm: the signature both
 * {@link oid} and {@link oid256} have. */
export type Namer = (type: Kind, body: Uint8Array) => Promise<string>

/** The object id under one algorithm: `digest(algo, "<type> <size>\0<body>")`.
 * {@link oid} and {@link oid256} are the two callers use. */
export let objectId =
  (algo: 'SHA-1' | 'SHA-256'): Namer => async (type, body) =>
    hex(new Uint8Array(await crypto.subtle.digest(algo, framed(type, body))))

/** Git's object id: the SHA-1 of the header and the body. */
export let oid: Namer = objectId('SHA-1')

/** The same object's SHA-256 object id. Pass it the SHA-256 body — the one
 * whose children are named by their own `oid256` — or the result is the digest
 * of an object nobody can ask for. */
export let oid256: Namer = objectId('SHA-256')
