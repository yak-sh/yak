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
import { SLUG } from './route.ts'
import { storeOf } from './store.ts'

export let META = { space: 'yak', app: 'platform' }
// The meta space's own store, named the way every app's is. Its slugs are
// the platform's own and never move, so the name is a constant.
export let META_STORE = `${META.space}/${META.app}`

export type Space = {
  eid: string
  slug: string
  home: string | null
  title: string
}
export type App = {
  eid: string
  slug: string
  space: string
  version: number | null
  title: string
  // Who may read and write its store (T-32504): 'public', 'open', or
  // 'private'. Null for an app born before the word, which means public —
  // what every app did before there was one.
  access: Access | null
  // The name of the Durable Object holding this app's data, pinned when the
  // app was born (`store` below); null for an app born before it was pinned,
  // which is named by its address the way it always was.
  store: string | null
}
export type Role = 'owner' | 'editor' | 'viewer'
export type Access = 'public' | 'open' | 'private'

type Row = {
  entity: { eid: string }
  space?: { slug: string; home: string | null }
  app?: {
    slug: string
    space: string
    version: number | null
    access?: Access | null
  }
  member?: { space: string; person: string; role: Role }
  email?: { address: string }
  alias?: { slug: string }
  doc?: { title?: string }
}

// A person's address as a hostname label: the local part, lowercased, with
// anything that is not a slug character folded to a dash. `jeff@yak.sh`
// becomes `jeff`; an address that leaves nothing usable becomes `space`,
// and `own()` below numbers it until the name is free.
export let slugFor = (email: string) => {
  let name = email.split('@')[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 40)
  return SLUG.test(name) ? name : 'space'
}

let TTL = 30_000
let cache = new Map<string, { at: number; body: string }>()

// One seed per isolate, awaited by every query behind it. A second isolate
// racing the first bounces on the unique slug and is ignored: its query
// then finds the winner.
let seeded: Promise<void> | undefined

let seed = async (env: Env) => {
  let meta = storeOf(env.STORE, META_STORE)
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
    let r = await storeOf(env.STORE, META_STORE)('/apply', {
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
  let r = await storeOf(env.STORE, META_STORE)(`/query${url.search}`)
  if (!r.ok) return r
  let body = await r.text()
  if (body != '[]') cache.set(url.search, { at: Date.now(), body })
  return new Response(body, { headers: { 'content-type': 'application/json' } })
}

let spaceOf = (r: Row): Space => ({
  eid: r.entity.eid,
  slug: r.space!.slug,
  home: r.space!.home,
  title: r.doc?.title || r.space!.slug,
})

export let appOf = (r: Row): App => ({
  eid: r.entity.eid,
  slug: r.app!.slug,
  space: r.app!.space,
  version: r.app!.version,
  access: r.app!.access ?? null,
  title: r.doc?.title || r.app!.slug,
  store: r.alias?.slug ?? null,
})

// A Durable Object cannot be renamed, so an app's store must not be named by
// anything a person may change: renaming `recipes` to `cookbook` would strand
// every recipe in it. So the name is pinned at birth as the app's alias — the
// address it was born at — and read back here. An app born before that
// (`store` null) is named by its address, which for it has never moved.
export let storeName = (space: Space, app: App) =>
  app.store ?? `${space.slug}/${app.slug}`

// What app_new pins, and what a rename must therefore leave alone.
export let bornAt = (space: Space, slug: string) => `${space.slug}/${slug}`

// The typed client over the handler, in-process or across a binding.
export type Directory = ReturnType<typeof directory>

export let directory = (via: Fetcher) => {
  let query = async (q: string): Promise<Row[]> => {
    let r = await via.fetch(new Request(`http://directory/query?${q}`))
    if (!r.ok) throw new Error(`directory: ${await r.text()}`)
    return r.json()
  }
  let one = async (q: string) => (await query(q))[0]
  // Named, because two of the questions below are asked in terms of the
  // others: a person's own space is read, minted, and read back.
  let self = {
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
    // Every app in a space, oldest first — the order they were made.
    apps: async (space: Space): Promise<App[]> =>
      (await query(`.app.space=${space.eid}`)).map(appOf),
    // The app that answers the space's bare hostname, if it has one.
    home: async (space: Space) => {
      let row = space.home ? await one(`id=${space.home}`) : undefined
      return row?.app ? appOf(row) : null
    },
    // A person's membership row: the eid, so an invite can revise or remove
    // the one that stands, and the role, which is the same question asked
    // shorter.
    member: async (space: Space, person: string) => {
      let row = await one(
        `.member.space=${space.eid}&.member.person=${person}`,
      )
      return row?.member ? { eid: row.entity.eid, role: row.member.role } : null
    },
    role: async (space: Space, person: string) =>
      (await self.member(space, person))?.role ?? null,
    // How many owners a space has, so removing a member can refuse to leave
    // it with none.
    owners: async (space: Space) =>
      (await query(`.member.space=${space.eid}&.member.role=owner`)).length,
    // Who is at an address, if the platform has met them. signin.ts's
    // `personOf` asks this same question and mints when the answer is
    // nobody, which is how an invited person's later sign-in finds the row
    // the invite made.
    personAt: async (email: string) =>
      (await one(`.person!&.email.address=${encodeURIComponent(email)}`))
        ?.entity.eid ?? null,
    // Every space this person belongs to, the meta space left out: `yak` is
    // the platform's own, and a person who owns it (the first to sign in)
    // still means their own space when they name none.
    spaces: async (person: string): Promise<Space[]> => {
      // A filter resolves an eid to an entity, so a person the meta store has
      // never seen — someone who signed in before it kept a row — makes the
      // question itself unanswerable. No row, no memberships.
      if (!(await one(`id=${person}`))) return []
      let members = await query(`.member.person=${person}`)
      let spaces: Space[] = []
      for (let m of members) {
        let row = m.member && await one(`id=${m.member.space}`)
        if (row?.space && row.space.slug != META.space) {
          spaces.push(spaceOf(row))
        }
      }
      return spaces
    },
    // The person's own space, minted the moment they first need one — at
    // sign-in, or at the first tool call by someone who signed in before this
    // existed (T-32482). Nobody is ever asked to name a space. Theirs is the
    // one their address spells, if they are in it, else the first they
    // belong to; a race that loses on the unique slug re-reads and finds the
    // winner.
    own: async (person: string): Promise<Space> => {
      let mine = await self.spaces(person)
      let row = await one(`id=${person}`)
      let wanted = slugFor(row?.email?.address ?? 'space')
      if (mine.length) return mine.find((s) => s.slug == wanted) ?? mine[0]
      let slug = wanted
      for (let n = 2; await self.space(slug); n++) slug = `${wanted}${n}`
      // The same batch space_new writes, for the same reasons: the person's
      // own row (they may have none yet), the space, and their ownership of
      // it — all bundles, since a bundle mints at an eid its author chose
      // (T-32455).
      try {
        await self.apply({
          entities: [
            { entity: { eid: person }, person: {} },
            {
              entity: { eid: '$space' },
              doc: { title: wanted },
              space: { slug },
            },
            { member: { space: '$space', person, role: 'owner' } },
          ],
        }, { 'x-yak-person': person, 'x-yak-role': 'owner' })
      } catch (e) {
        let [theirs] = await self.spaces(person)
        if (!theirs) throw e
        return theirs
      }
      return (await self.space(slug))!
    },
    // Whether nobody belongs yet: read only to admit the first member.
    memberless: async (space: Space) =>
      !(await one(`.member.space=${space.eid}&limit=1`)),
  }
  return self
}
