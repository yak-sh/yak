// The directory part (D-32318 §The meta-space): spaces, apps, and members
// are entities in the meta-space's store — the Store object named
// yak/platform — and this handler is that store's door, `GET /query` and
// `POST /apply`, in the graph's own wire: the filter grammar or an entity
// bundle in, entity JSON out. No shape of its own: a caller in this Worker
// and a caller across a service binding ask the same question, and
// `directory(fetcher)` below is the typed client that phrases the ones the
// kernel asks (a space by slug, an app in it, its home, a person's role) and
// writes the ones that change it (a space born, an app born, a deploy).
//
// Answers are cached in a Map private to this module with a 30-second TTL
// rather than the Cache API: a resolution is a few hundred bytes, the Cache
// API is per-colo anyway and wants a synthetic Request as its key, and a Map
// costs nothing to reason about; a rename shows within the TTL. An empty
// answer is never cached, so an app is served the moment it is created. The
// write door is here for that cache: a directory write empties it, so the
// space whose home app was just named answers its own hostname at once
// rather than a TTL later. A write that goes around this door — the generic
// graph tier aimed at (yak, platform) — is seen within the TTL like any
// change made elsewhere. The cache is this part's own — no other module
// reads it — and moves with it.
// The meta space seeds itself on first touch (space `yak`, app `platform`),
// written as an entity literal through the store's /apply, so the directory
// can describe its own store.
import type { Mutation } from '../../src/mutation.ts'
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
          entity: { eid: '$space' },
          doc: { title: META.space },
          space: { slug: META.space },
        },
        {
          doc: { title: META.app },
          app: { slug: META.app, space: '$space' },
        },
      ],
    }),
  })
}

let notFound = () => new Response('not found', { status: 404 })

// The headers a caller's request carries through to the store: who is
// asking, and nothing a client could have sent — `x-yak-kernel` is never
// forwarded, so a directory write is an ordinary one.
let VOUCH = ['x-yak-person', 'x-yak-role', 'x-via']

let forwarded = (req: Request) =>
  Object.fromEntries(
    VOUCH.map((h) => [h, req.headers.get(h)]).filter(([, v]) => v),
  ) as Record<string, string>

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let url = new URL(req.url)
  await (seeded ??= seed(env))
  if (url.pathname == '/apply' && req.method == 'POST') {
    let r = await storeOf(env.STORE, META.space, META.app)('/apply', {
      method: 'POST',
      body: await req.text(),
    }, forwarded(req))
    // The directory just moved; nothing read before it is still true.
    if (r.ok) cache.clear()
    return r
  }
  if (url.pathname != '/query' || req.method != 'GET') return notFound()
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
    // A write that changes the directory: the whole wire, either shape — a
    // bundle (which mints at an eid its author chose, T-32455) or a flat
    // Change batch.
    apply: async (
      mutation: Mutation,
      headers: Record<string, string> = {},
    ): Promise<{ changes: unknown[]; aliases?: Record<string, string> }> => {
      let r = await via.fetch(
        new Request('http://directory/apply', {
          method: 'POST',
          body: JSON.stringify(mutation),
          headers,
        }),
      )
      if (!r.ok) throw new Error(await r.text())
      return r.json()
    },
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
