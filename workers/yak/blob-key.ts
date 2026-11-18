import { ownedPrefix } from './file-root.ts'
import type { Objects } from '@yaks/blob'
import { uploads } from '@yaks/platform/uploads'
import type { Graph } from '@yaks/graph'
import { WINDOW } from './recover.ts'
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

/** How long the bytes of an upload whose row went at `at` still have to
 * wait, in milliseconds: they outlast the row by the store's own way back
 * (recover.ts `WINDOW`), so a store_restore that brings the row back finds
 * its bytes still there. A deleted upload is in the trash this long, not
 * gone.
 *
 * ```ts
 * import { waiting } from './blob-key.ts'
 * import { assertEquals } from '@std/assert'
 * let day = 24 * 60 * 60_000, at = '2026-11-01T00:00:00Z'
 * assertEquals(waiting(at, Date.parse(at) + day), 29 * day)
 * assertEquals(waiting(at, Date.parse(at) + 31 * day), 0)
 * ```
 */
export let waiting = (at: string, now = Date.now()) =>
  Math.max(0, Date.parse(at) + WINDOW - now)

/** Delete the bytes of an upload whose row is gone, unless a row of the app's
 * store names them again by now (an upload of the same file meanwhile does,
 * and so does a store_restore to before the row went). Answers whether they
 * were deleted. */
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
