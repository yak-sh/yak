import type { Objects } from '@yaks/blob'
import type { Graph } from '@yaks/graph'
// An app's bytes live beside its files, under its own address even if its
// served files are borrowed from another app.
export let blobPrefix = (space: { slug: string }, app: { slug: string }) =>
  `${space.slug}/${app.slug}/blobs/`

/** What in an app's store still names bytes it keeps at `sha`: the content
 * row while it carries them (an upload's `blob`, a model's `artifact`), and
 * any attachment pointing at them. Bytes none of these name are deleted with
 * their upload (facets/app-effects.ts `delete_upload`). */
export let naming = (sha: string) =>
  `.entity.eid=${sha} .blob|.entity.eid=${sha} .artifact|` +
  `.attachment.blob=${sha}|.attachment.artifact=${sha}`

/** Internal root namespaces cannot be space names or mirrored app files.
 * An app eid keeps the private receipt prefix stable across space renames. */
export let receiptPrefix = (app: { eid: string }) =>
  `.model-receipts/${app.eid}/`

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
