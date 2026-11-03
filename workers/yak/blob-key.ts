import { ownedPrefix } from './file-root.ts'
import { type Objects, type Representation, represents } from '@yaks/blob'
import type { Bundle, Graph } from '@yaks/graph'
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

/** What in an app's store still names bytes it keeps at `sha`: the content
 * row while it carries them (an upload's `blob`, a model's `artifact`), and
 * any attachment pointing at them. Bytes none of these name are deleted with
 * their upload (facets/app-effects.ts `delete_upload`). */
export let naming = (sha: string) =>
  `.entity.eid=${sha} .blob|.entity.eid=${sha} .artifact|` +
  `.attachment.blob=${sha}|.attachment.artifact=${sha}`

/** The representation `eid` of the bytes at `sha` that an app serves, read
 * off its store in one query, or none: one scoped to another app, one that
 * does not address these bytes, or bytes no row names any more. A
 * representation outlives a deleted upload (@yaks/blob never deletes one), and
 * a copy of the bytes may be left in a cache or in the bucket, so serving asks
 * whether a row still names them, and a deleted upload stops here. */
export let servable = async (
  read: (query: string) => Promise<Bundle[]>,
  app: { eid: string },
  sha: string,
  eid: string,
): Promise<Representation | null> => {
  let rows = await read(`.entity.eid=${eid} .representation|${naming(sha)}`)
  let rep = rows.find((r) => r.entity.eid == eid)?.representation as
    | Representation
    | undefined
  return rep && rep.scope == app.eid && rep.address == sha &&
      represents(eid, rep) && rows.some((r) => r.entity.eid != eid)
    ? rep
    : null
}

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
  if ((await graph.read(naming(sha))).length) return false
  await objects.delete(prefix + sha)
  return true
}
