// Two marks this package puts on bundles while they pass through `apply()`.
// Neither is ever stored: they exist only to carry a decision from one phase of
// the write to a later one. Both names begin with `$`, which is what keeps them
// out of admission's property checks and out of every storage adapter's write
// path.
//
//   $sent   added to each bundle the caller passed in, before the patches went
//           in, carrying a copy of that entity as it then stood. Its presence
//           means a caller wrote this bundle — the stamps and the cascade
//           deletions that later phases add have no such mark — and its
//           contents are what to patch back if the server refuses the write.
//
//   $echo   added to every list of bundles that came from the server: the
//           response to a POST, and a push over the socket. The outbound hook
//           skips any bundle carrying it, which is how a client can apply what
//           it just received without sending it straight back.

import type { Bundle, Plugin } from '@yaks/graph'

/** The mark on a bundle a caller sent, carrying the entity as it then stood. */
export let SENT = '$sent'

/** The mark on a batch that arrived from the server and must not go back. */
export let ECHO = '$echo'

/** Mark a bundle as the caller's, with a copy of the entity it patches
 * (`null` when there was no such entity yet). */
export let asking = (b: Bundle, was: Bundle | null): Bundle => ({
  ...b,
  [SENT]: { before: was },
})

/** Whether a caller passed this bundle in — as opposed to a later phase
 * adding it. */
export let asked = (b: Bundle): boolean => b[SENT] !== undefined

/** The entity as it stood before this write: the bundle for it, `null` if it
 * did not exist, `undefined` if this bundle is not a caller's. */
export let before = (b: Bundle): Bundle | null | undefined =>
  (b[SENT] as { before: Bundle | null } | undefined)?.before

/** The plugin a graph registers to accept these two marks when it carries no
 * sync plugin of its own — a replica that only lands what a server sent
 * (`land`, `snapshot`) and never posts anything back. `apply()` refuses a `$`
 * key no plugin declared, and these are ours; it declares them and does nothing
 * else. */
export let marks: Plugin = {
  name: '@yaks/sync/marks',
  requests: [SENT, ECHO],
}

/** Mark bundles as the server's, so the outbound hook lets them pass. */
export let echo = (bundles: Bundle[]): Bundle[] =>
  bundles.map((b) => ({ ...b, [ECHO]: true }))

/** Whether a bundle came from the server. */
export let echoed = (b: Bundle): boolean => b[ECHO] === true

/** A bundle with both marks removed: what a caller gets back from `apply()`,
 * which is their data and not this package's bookkeeping. */
export let clean = (b: Bundle): Bundle => {
  if (b[SENT] === undefined && b[ECHO] === undefined) return b
  let out = { ...b }
  delete out[SENT]
  delete out[ECHO]
  return out
}
