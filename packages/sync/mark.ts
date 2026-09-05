// Two marks this package puts on a batch, and neither is ever stored. A
// component is data associated with an entity; where that data lives is a
// separate question, and one that a phase of `apply()` can answer with "only
// here, only long enough to tell a later phase what I decided". Both marks are
// spelled with a leading `$`, which is what keeps them out of admission's
// column checks and out of every adapter's write path.
//
//   $sent   put on each bundle the caller asked for, before the patches went
//           in, carrying the image of that entity as it stood. Its PRESENCE
//           says "a caller wrote this" — the stamps and casualties later
//           phases synthesize carry none — and its contents are the inverse to
//           patch back if the server refuses the batch.
//
//   $echo   put on every batch that CAME FROM the server: the reply to a post,
//           and a push over the socket. The outbound hook skips a bundle
//           wearing it, which is the whole reason a client can apply what it
//           just heard without telling the server about it again.

import type { Bundle } from '@yaks/graph'

/** The mark on a bundle a caller sent, carrying the entity as it stood. */
export let SENT = '$sent'

/** The mark on a batch that arrived FROM the server and must not go back. */
export let ECHO = '$echo'

/** Mark a bundle as the caller's, with the image of the entity it patches
 * (`null` when there was no such entity yet). */
export let asking = (b: Bundle, was: Bundle | null): Bundle => ({
  ...b,
  [SENT]: { before: was },
})

/** Whether a caller asked for this bundle — as opposed to a later phase
 * synthesizing it. */
export let asked = (b: Bundle): boolean => b[SENT] !== undefined

/** The entity as it stood before this batch: the bundle for it, `null` if it
 * did not exist, `undefined` if this bundle is not a caller's. */
export let before = (b: Bundle): Bundle | null | undefined =>
  (b[SENT] as { before: Bundle | null } | undefined)?.before

/** Mark a batch as the server's, so the outbound hook lets it pass. */
export let echo = (bundles: Bundle[]): Bundle[] =>
  bundles.map((b) => ({ ...b, [ECHO]: true }))

/** Whether a bundle came from the server. */
export let echoed = (b: Bundle): boolean => b[ECHO] === true

/** A bundle with both marks taken off: what a caller gets back from
 * `apply()`, which is their data and not this package's notes. */
export let clean = (b: Bundle): Bundle => {
  if (b[SENT] === undefined && b[ECHO] === undefined) return b
  let out = { ...b }
  delete out[SENT]
  delete out[ECHO]
  return out
}
