// An app's bytes live beside its files, under its own address even if its
// served files are borrowed from another app.
export let blobPrefix = (space: { slug: string }, app: { slug: string }) =>
  `${space.slug}/${app.slug}/blobs/`

/** Internal root namespaces cannot be space names or mirrored app files.
 * An app eid keeps the private receipt prefix stable across space renames. */
export let receiptPrefix = (app: { eid: string }) =>
  `.model-receipts/${app.eid}/`
