import { ownedPrefix } from './file-root.ts'
// What a space holds and how it divides across its apps (T-124320): the two
// stored ceilings a plan sets, app data and photos and files, for the space
// whole and for each app. Every reader takes it from here: the hourly sweep
// writes it (usage.ts `sweep`), the doors that refuse a write past a ceiling
// decide by it and say it (usage.ts `full`, `fullFiles`), app_list says it
// (tools.ts), and the admin's directory counts it (admin.ts).
//
// App data is what each app's store last told the directory it weighs
// (meter.ts `weighed`). A trashed app's store keeps its rows until it is
// erased, so it counts. Photos and files are the space's objects in the
// bucket, everything under `<handle>/` (the space's own, directory.ts
// `spaceHandle`), each counted for the app whose prefix
// holds it (file-root.ts `ownedPrefix`): its files,
// uploads, kept versions and history. A key under no app's prefix still counts
// for the space, so the apps' files can sum to less than the space's.
import type { App, Space } from './directory.ts'

/** What a space, or one of its apps, holds: app data and photos and files. */
export type Held = { bytes: number; files: number }

/** What a space holds, and each app's share of it by identity. */
export type Holding = Held & {
  apps: Map<string, Held>
  names?: Map<string, string>
}

let sum = (ns: Iterable<number>) => [...ns].reduce((a, b) => a + b, 0)

// The bucket's objects under a space, totalled by the app whose prefix holds
// them.
/// let sizes = new Map([['jeff/notes/a', 2], ['jeff/notes/blobs/f', 3], ['jeff/cart/b', 4], ['jeff/stray', 9]])
/// split({ store: 'jeff' }, sizes) -> new Map([['notes', 5], ['cart', 4]])
export let split = (
  space: Pick<Space, 'store'>,
  sizes: Map<string, number>,
) => {
  let by = new Map<string, number>()
  let prefix = `${space.store}/`
  for (let [key, n] of sizes) {
    let rest = key.startsWith(prefix) ? key.slice(prefix.length) : ''
    let slug = rest.startsWith('.apps/')
      ? rest.split('/')[1]
      : rest.includes('/')
      ? rest.slice(0, rest.indexOf('/'))
      : ''
    if (slug) by.set(slug, (by.get(slug) ?? 0) + n)
  }
  return by
}

// App totals use identities: a retained app and its replacement can share a
// displayed slug while owning different roots and stores.
/// let jeff = { store: 'jeff', meter: { files: 20 } }
/// let notes = { eid: 'n', slug: 'notes', meter: { bytes: 7, files: 20 } }
/// holding(jeff, [notes]) -> { names: new Map([['n', 'notes']]), bytes: 7, files: 20, apps: new Map([['n', { bytes: 7, files: 20 }]]) }
/// holding(jeff, [notes], new Map([['jeff/cart/a', 4]])) -> { names: new Map([['n', 'notes']]), bytes: 7, files: 4, apps: new Map([['n', { bytes: 7, files: 0 }], ['cart', { bytes: 0, files: 4 }]]) }
export let holding = (
  space: Pick<Space, 'store'> & { meter: Partial<Held> | null },
  apps:
    (Pick<App, 'eid' | 'slug' | 'files'> & { meter: Partial<Held> | null })[],
  sizes?: Map<string, number>,
): Holding => {
  let held = new Map<string, Held>(apps.map((a) => [a.eid, {
    bytes: a.meter?.bytes ?? 0,
    files: sizes
      ? sum(
        [...sizes].filter(([key]) =>
          key.startsWith(ownedPrefix(space, a) + '/')
        ).map(([, n]) => n),
      )
      : a.meter?.files ?? 0,
  }]))
  let names = new Map(apps.map((app) => [app.eid, app.slug]))
  for (let [id, files] of sizes ? split(space, sizes) : []) {
    if (
      !held.has(id) &&
      !apps.some((app) => ownedPrefix(space, app) == `${space.store}/${id}`)
    ) held.set(id, { bytes: 0, files })
  }
  return {
    names,
    bytes: sum([...held.values()].map((h) => h.bytes)),
    files: sizes ? sum(sizes.values()) : space.meter?.files ?? 0,
    apps: held,
  }
}
