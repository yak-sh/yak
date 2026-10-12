// An app's bytes live beside its files, under its own address even if its
// served files are borrowed from another app.
export let blobPrefix = (space: { slug: string }, app: { slug: string }) =>
  `${space.slug}/${app.slug}/blobs/`

/** Outside every served app prefix; an app eid survives space renames. */
export let receiptPrefix = (app: { eid: string }) =>
  `.model-receipts/${app.eid}/`
