// Minting an eid, and the handle an entity wears before it has a number.
//
// Both sides of the wire mint eids — a client names the entity it is creating,
// so a write is one round trip and never waits for an id — which is why the
// minter is plain `getRandomValues`: `crypto.randomUUID` is gated to secure
// contexts, and a page served over plain http still has to mint.

/**
 * A fresh eid: a random (v4) uuid. Works anywhere `crypto.getRandomValues`
 * does — a browser on plain http, a worker, a server.
 */
export let mint = (): string => {
  let b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40 // version 4
  b[8] = (b[8] & 0x3f) | 0x80 // variant 1
  let h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${
    h.slice(16, 20)
  }-${h.slice(20)}`
}

/** A sigilled, dashless 10-hex eid fragment, optionally kind-prefixed. */
export let short = (eid: string, prefix = ''): string =>
  `${prefix}#${eid.replaceAll('-', '').slice(0, 10).toLowerCase()}`

/** Short input handles carry 6–64 hex characters; bare hex is never an id fragment. */
export let SHORT: RegExp = /^(?:[a-z]+)?#[0-9a-f]{6,64}$/i

// What an id this family MINTS looks like: a uuid, or the hex of a content
// address (@yaks/graph `derivedEid`, a key, a blob). A word of that shape is
// an id however it was meant, so every ladder that reads "an eid, else a name
// somebody chose" tells the two apart here rather than each in its own copy.
let MINTED = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$|^[0-9a-f]{40,64}$/i

/**
 * Whether an id is one this family minted, rather than a word a person chose.
 *
 * ```ts
 * minted(mint()) // true
 * minted('lemon-cake') // false
 * ```
 */
export let minted = (id: string): boolean => MINTED.test(id)
