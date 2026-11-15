import { ownedPrefix } from './file-root.ts'
import type { Objects } from '@yaks/blob'
import { uploads } from '@yaks/platform/uploads'
import type { Graph } from '@yaks/graph'
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

/** Where the ledger of an app's uploads in parts is kept (@yaks/blob
 * `parts`): outside every space's prefix, so it never counts against one, and
 * by the app's eid, so a rename leaves it in place. The bucket's lifecycle
 * rule expires what nobody finished (README.md). */
export let uploadPrefix = (app: { eid: string }) => `.uploads/${app.eid}/`

/** Delete the bytes of an upload whose row is gone, unless a row of the app's
 * store names them again by now (an upload of the same file meanwhile does).
 * Answers whether they were deleted. */
export let released = async (
  graph: Pick<Graph, 'read'>,
  objects: Pick<Objects, 'delete'>,
  prefix: string,
  sha: string,
): Promise<boolean> => {
  if ((await graph.read(uploads.names(sha))).length) return false
  await objects.delete(prefix + sha)
  return true
}
