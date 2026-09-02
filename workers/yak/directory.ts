// The directory part (D-32318 §The meta-space): spaces, apps, and members
// are entities in the meta-space's store — the Store object named
// yak/platform — and this handler is that store's read door, `GET /query`,
// in the graph's own wire: the filter grammar in, entity JSON out. No shape
// of its own: a caller in this Worker and a caller across a service binding
// ask the same query, and `directory(fetcher)` below is the typed client
// that phrases the questions the kernel asks (a space by slug, an app in it,
// its home, a person's role) and reads the rows back.
//
// Answers are cached in a Map private to this module with a 30-second TTL
// rather than the Cache API: a resolution is a few hundred bytes, the Cache
// API is per-colo anyway and wants a synthetic Request as its key, and a Map
// costs nothing to reason about; a rename shows within the TTL. An empty
// answer is never cached, so an app is served the moment it is created. The
// cache is this part's own — no other module reads it — and moves with it.
// The meta space seeds itself on first touch (space `yak`, app `platform`),
// written as an entity literal through the store's /apply, so the directory
// can describe its own store.
import type { Env, Fetcher } from './env.ts'
import { storeOf } from './store.ts'

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
let cache = new Map<string, { at: number; body: string }>()

// One seed per isolate, awaited by every query behind it. A second isolate
// racing the first bounces on the unique slug and is ignored: its query
// then finds the winner.
let seeded: Promise<void> | undefined

let seed = async (env: Env) => {
  let meta = storeOf(env.STORE, META.space, META.app)
  let found = await (await meta(`/query?.space.slug=${META.space}`)).json()
  if ((found as Row[]).length) return
  await meta('/apply', {
    method: 'POST',
    body: JSON.stringify({
      entities: [
        {
          key: 'space',
          comps: { doc: { title: META.space }, space: { slug: META.space } },
        },
        {
          comps: {
            doc: { title: META.app },
            app: { slug: META.app, space: 'space' },
          },
        },
      ],
    }),
  })
}

let notFound = () => new Response('not found', { status: 404 })

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let url = new URL(req.url)
  if (url.pathname != '/query' || req.method != 'GET') return notFound()
  await (seeded ??= seed(env))
  let hit = cache.get(url.search)
  if (hit && hit.at > Date.now() - TTL) {
    return Response.json(JSON.parse(hit.body))
  }
  let r = await storeOf(env.STORE, META.space, META.app)(`/query${url.search}`)
  if (!r.ok) return r
  let body = await r.text()
  if (body != '[]') cache.set(url.search, { at: Date.now(), body })
  return new Response(body, { headers: { 'content-type': 'application/json' } })
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

// The typed client over the handler, in-process or across a binding.
export type Directory = ReturnType<typeof directory>

export let directory = (via: Fetcher) => {
  let query = async (q: string): Promise<Row[]> => {
    let r = await via.fetch(new Request(`http://directory/query?${q}`))
    if (!r.ok) throw new Error(`directory: ${await r.text()}`)
    return r.json()
  }
  let one = async (q: string) => (await query(q))[0]
  return {
    space: async (slug: string) => {
      let row = await one(`.space.slug=${slug}`)
      return row ? spaceOf(row) : null
    },
    app: async (space: Space, slug: string) => {
      let row = await one(`.app.space=${space.eid}&.app.slug=${slug}`)
      return row ? appOf(row) : null
    },
    // The app that answers the space's bare hostname, if it has one.
    home: async (space: Space) => {
      let row = space.home ? await one(`id=${space.home}`) : undefined
      return row?.app ? appOf(row) : null
    },
    role: async (space: Space, person: string) =>
      (await one(`.member.space=${space.eid}&.member.person=${person}`))
        ?.member?.role ?? null,
    // Whether nobody belongs yet: read only to admit the first member.
    memberless: async (space: Space) =>
      !(await one(`.member.space=${space.eid}&limit=1`)),
  }
}
