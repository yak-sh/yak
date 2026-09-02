// The directory (D-32318 §The meta-space): spaces, apps, and members are
// entities in the meta-space's store — the Store object named yak/platform —
// read through its /query door and cached here. The cache is an in-isolate
// Map with a 30-second TTL rather than the Cache API: a resolution is a few
// hundred bytes, the Cache API is per-colo anyway and wants a synthetic
// Request as its key, and a Map costs nothing to reason about; a rename shows
// within the TTL. A miss is never cached, so an app is served the moment it
// is created. The meta space seeds itself on first touch — space `yak`, app
// `platform` — so the directory can describe its own store.
import { type Door, type Namespace, storeOf } from './store.ts'

export let META = { space: 'yak', app: 'platform' }

export type Space = { eid: string; slug: string; home: string | null }
export type App = {
  eid: string
  slug: string
  space: string
  version: number | null
}
export type Role = 'owner' | 'editor' | 'viewer'

type Row = {
  entity: { eid: string }
  space?: { slug: string; home: string | null }
  app?: { slug: string; space: string; version: number | null }
  member?: { space: string; person: string; role: Role }
}

let TTL = 30_000
let cache = new Map<string, { at: number; value: unknown }>()
let cached = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
  let hit = cache.get(key)
  if (hit && hit.at > Date.now() - TTL) return hit.value as T
  let value = await load()
  if (value != null) cache.set(key, { at: Date.now(), value })
  return value
}

let spaceOf = (r: Row): Space => ({
  eid: r.entity.eid,
  slug: r.space!.slug,
  home: r.space!.home,
})

let appOf = (r: Row): App => ({
  eid: r.entity.eid,
  slug: r.app!.slug,
  space: r.app!.space,
  version: r.app!.version,
})

export type Directory = ReturnType<typeof directory>

export let directory = (ns: Namespace) => {
  let meta: Door = storeOf(ns, META.space, META.app)
  let query = async (q: string): Promise<Row[]> => {
    let r = await meta(`/query?${q}`)
    if (!r.ok) throw new Error(`directory: ${await r.text()}`)
    return r.json()
  }
  // The meta space's own rows. A second seed racing the first bounces on
  // the unique slug and is ignored: the query after it finds the winner.
  let seed = async () => {
    let space = crypto.randomUUID(), app = crypto.randomUUID()
    await meta('/apply', {
      method: 'POST',
      body: JSON.stringify([
        { eid: space, name: 'doc', comp: { title: META.space } },
        { eid: space, name: 'space', comp: { slug: META.space } },
        { eid: app, name: 'doc', comp: { title: META.app } },
        { eid: app, name: 'app', comp: { slug: META.app, space } },
      ]),
    })
  }
  let space = (slug: string) =>
    cached(`space:${slug}`, async () => {
      let [row] = await query(`.space.slug=${slug}`)
      if (!row && slug == META.space) {
        await seed()
        ;[row] = await query(`.space.slug=${slug}`)
      }
      return row ? spaceOf(row) : null
    })
  let app = (space: Space, slug: string) =>
    cached(`app:${space.eid}/${slug}`, async () => {
      let [row] = await query(`.app.space=${space.eid}&.app.slug=${slug}`)
      return row ? appOf(row) : null
    })
  // The app that answers the space's bare hostname, if it has one.
  let home = (space: Space) =>
    space.home
      ? cached(`home:${space.home}`, async () => {
        let [row] = await query(`id=${space.home}`)
        return row?.app ? appOf(row) : null
      })
      : Promise.resolve(null)
  let role = (space: Space, person: string) =>
    cached(`member:${space.eid}/${person}`, async () => {
      let [row] = await query(
        `.member.space=${space.eid}&.member.person=${person}`,
      )
      return row?.member?.role ?? null
    })
  // Uncached: read only to admit the first member (index.ts).
  let memberless = async (space: Space) =>
    (await query(`.member.space=${space.eid}&limit=1`)).length == 0
  return { space, app, home, role, memberless }
}
