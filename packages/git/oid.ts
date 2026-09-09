// What a git object is CALLED: the digest of its own header and body.
//
// Every object in this package is named twice. `oid` is git's SHA-1 name — the
// one a `git clone` asks for, and the entity id of the row we keep about the
// object. `oid256` is the SHA-256 name of the same object, computed from the
// first day so a client that asks for `object-format=sha256` is answered by a
// lookup rather than a migration (git's own hash-function transition, kept as
// @yaks/key rows instead of a loose-object index).
//
// The two names are NOT two digests of the same bytes. A tree or a commit
// spells its children out by name, so the SHA-256 body is the SHA-1 body with
// every child id translated — which is why the builders here take the ids to
// write rather than the objects, and why `Oids` travels in pairs.
//
// SHA-1 is a NAME here, never a security claim: it is what the wire format
// says, so it is what we compute. `crypto.subtle` is the only digest that
// speaks both algorithms over bytes, and it is async — which makes writing an
// object async all the way up. That is the price of not shipping a second
// SHA-1.

/** The four things a git object can be. */
export type Kind = 'blob' | 'tree' | 'commit' | 'tag'

/** One object's two names: git's SHA-1 id, and the SHA-256 id of the same
 * object with its children translated. */
export type Oids = { oid: string; oid256: string }

let utf8 = new TextEncoder()

/** The bytes git prefixes a body with before hashing it: `tree 42\0`. */
export let header = (type: Kind, size: number): Uint8Array =>
  utf8.encode(`${type} ${size}\0`)

/** Byte runs end to end — how every body in this package is assembled.
 *
 * The answer is spelled `Uint8Array<ArrayBuffer>` because `crypto.subtle`
 * refuses a view that might be over shared memory, and every body here ends up
 * in a digest. Freshly allocated, it never is. */
export let concat = (parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
  let out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (let p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** A body as it is hashed and as a pack stores it: the header, then the body. */
export let framed = (
  type: Kind,
  body: Uint8Array,
): Uint8Array<ArrayBuffer> => concat([header(type, body.length), body])

/** Bytes as lowercase hex — every id in this package is a hex string. */
export let hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** A hex id back as the bytes a tree body spells it with. */
export let bin = (id: string): Uint8Array =>
  Uint8Array.from(
    { length: id.length / 2 },
    (_, i) => parseInt(id.slice(i * 2, i * 2 + 2), 16),
  )

/** The object id under one algorithm: `digest(algo, "<type> <size>\0<body>")`.
 * {@link oid} and {@link oid256} are the two spellings anybody says. */
export let objectId =
  (algo: 'SHA-1' | 'SHA-256') =>
  async (type: Kind, body: Uint8Array): Promise<string> =>
    hex(new Uint8Array(await crypto.subtle.digest(algo, framed(type, body))))

/** Git's own name for an object: the SHA-1 of header and body. */
export let oid = objectId('SHA-1')

/** The same object's SHA-256 name. Give it the SHA-256 BODY — the one whose
 * children are named by their own `oid256` — or the answer is a digest of
 * nothing anybody can ask for. */
export let oid256 = objectId('SHA-256')
