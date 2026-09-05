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

/**
 * The short handle an entity with no number wears: the eid's leading 8 hex —
 * its first group, already dashless. Honest that there is no human id, and
 * still typeable, because a store resolves it back by prefix match.
 */
export let short = (eid: string): string => eid.slice(0, 8)

/**
 * What a short handle looks like as a TOKEN: 6–8 hex, no dashes. Six at the
 * least, so a stray two-character word never "resolves" to somebody's entity.
 */
export let SHORT: RegExp = /^[0-9a-f]{6,8}$/i
