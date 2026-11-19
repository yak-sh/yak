import { ownedPrefix } from './file-root.ts'
import { sha256 } from '@yaks/graph/sha256'
import { addressed } from '@yaks/blob'
/** Where an app keeps its uploads: the prefix its row was born with
 * (`app.blobs`), which stays with its store, so a store adopted from a visit
 * still finds the bytes its rows name. A row the mover has not reached yet
 * (blobs-move.ts) keeps them where they always were, beneath its own files,
 * even when its served files come from another app.
 *
 * ```ts
 * import { blobPrefix } from './blob-key.ts'
 * import { assertEquals } from '@std/assert'
 * let space = { store: 'ada' }
 * assertEquals(blobPrefix(space, { slug: 'notes' }), 'ada/notes/blobs/')
 * assertEquals(
 *   blobPrefix(space, { slug: 'notes', blobs: 'bo/.apps/b/blobs/' }),
 *   'bo/.apps/b/blobs/',
 * )
 * ```
 */
export let blobPrefix = (
  space: { store: string },
  app: { slug: string; files?: string | null; blobs?: string | null },
) => app.blobs ?? `${ownedPrefix(space, app)}/blobs/`

/** Internal root namespaces cannot be space names or mirrored app files.
 * An app eid keeps the private receipt prefix stable across space renames. */
export let receiptPrefix = (app: { eid: string }) =>
  `.model-receipts/${app.eid}/`

/** Each immutable blob prefix owns its multipart ledger. A visitor's store
 * has a prefix of its own even while it is served under the source app's eid;
 * adopting that store keeps the prefix and resumes the same uploads. Legacy
 * `.uploads/<app eid>/` ledgers are retained because their owners were mixed. */
export let uploadPrefix = (prefix: string) =>
  `.uploads/by-prefix/${sha256(prefix)}/`

/// shaOf('/cookbook/api/blob/' + 'a'.repeat(64) + '/' + 'b'.repeat(64)) -> 'a'.repeat(64)
/// shaOf('./api/blob/' + 'c'.repeat(64)) -> 'c'.repeat(64)
/// shaOf('d'.repeat(64)) -> 'd'.repeat(64)
/// shaOf('./api/blob/nope') -> null
/** The upload an address names: what `POST ./api/blob` answered as its `url`,
 * relative or whole, or as its `eid`, the bare SHA-256. */
export let shaOf = (address: unknown): string | null => {
  if (typeof address != 'string') return null
  let path = address.split(/[?#]/)[0]
  let at = path.lastIndexOf('/api/blob/')
  return addressed(at < 0 ? path : path.slice(at + '/api/blob/'.length))?.sha ??
    null
}
