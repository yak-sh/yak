// An app's bytes live beside its files, under its own address even if its
// served files are borrowed from another app.
export let blobPrefix = (space: { slug: string }, app: { slug: string }) =>
  `${space.slug}/${app.slug}/blobs/`
