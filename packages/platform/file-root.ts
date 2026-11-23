// An app owns one bucket prefix for its lifetime. Moving an old app records
// its existing prefix; new apps start under their identity. No bytes move.
export let ownedPrefix = (
  space: { store: string },
  app: { slug: string; files?: string | null },
) => app.files ?? `${space.store}/${app.slug}`

export let rootedPrefix = (space: { store: string }, app: { eid: string }) =>
  `${space.store}/.apps/${app.eid}`

let bucketRoot = (
  space: { store: string },
  app: { slug: string; files?: string | null },
) => ownedPrefix(space, app).split('/')[0]

export let releasesPrefix = (
  space: { store: string },
  app: { eid: string; slug: string; files?: string | null },
) => `${bucketRoot(space, app)}/.releases/${app.eid}/`

export let declarationsPrefix = (
  space: { store: string },
  app: { eid: string; slug: string; files?: string | null },
) => `${bucketRoot(space, app)}/.declarations/${app.eid}/`
