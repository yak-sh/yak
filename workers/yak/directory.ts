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
import { slugsOf } from '../../src/types.ts'
import type { Env, Fetcher } from './env.ts'
import { SLUG } from './route.ts'
import { nameOf } from './signin.ts'
import { storeOf } from './store.ts'

export let META = { space: 'yak', app: 'platform' }
// The meta space's own store, named the way every app's is. Its slugs are
// the platform's own and never move, so the name is a constant.
export let META_STORE = `${META.space}/${META.app}`

// What a space or an app spent this calendar month (platform.rs `Meter`,
// usage.ts writes it): on an app its own store's, on a space every app of it
// summed plus the letters it sent. Null where nothing has been metered yet.
export type Meter = {
  month: string
  requests: number
  rows_read: number
  rows_written: number
  bytes: number
  emails: number
  at: string
}
export type Tier = 'free' | 'plus'

export type Space = {
  eid: string
  slug: string
  home: string | null
  title: string
  // What this space pays (D-32751). Null for a space the sweep has not
  // reached yet, which means free — the terms every space is on today.
  tier: Tier | null
  meter: Meter | null
  // Whether the agent has already been told where this space stands against
  // its ceilings (unseen.ts `ceiling`). The mark is `notified`, the same one
  // an error wears once it has been served; the sweep clears it when the
  // standing changes, so a new line is one the agent has not heard.
  told: boolean
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
  // Every address this app has ever answered at — its birth address first,
  // then each one a rename left behind. They resolve like ids (types.ts
  // slugsOf), which is how an old link still finds the app it was made for.
  slugs: string[]
  // What this app's own store spent this month, as the hourly sweep last read
  // it (usage.ts). Null until it has been metered once.
  meter: Meter | null
  // The offer it stands as right now, null unless it is published, and where
  // it was installed from, null unless it was.
  published: Offer | null
  installed: Pin | null
}
export type Role = 'owner' | 'editor' | 'viewer'
export type Access = 'public' | 'open' | 'private'

// The offer an app stands as while it is published (T-32888): the
// platform-wide name another space installs it by, the deploy on offer, when
// it was offered, and the line a browsing agent reads.
export type Offer = {
  name: string
  version: number
  at: string
  about: string
}
// Where an installed app came from, and the version it took (T-32889). The
// pin is what makes `app_update` a deliberate act.
export type Pin = { of: string; version: number }

// A hostname a person owns, aimed at one app (platform.rs `Hostname`,
// T-33037). How far provisioning has come, and when that was last read from
// Cloudflare.
export type HostStage = 'pending' | 'active' | 'error'
export type Host = {
  eid: string
  name: string
  app: string
  stage: HostStage | null
  at: string
}

// A reference column, as a READ hands it back: the bare eid, or `{eid, name}`
// where the store could name what it points at (listing.ts `named`, T-32733).
// What the directory wants either way is the id — the same lowering client.ts
// `where` does on the write side.
type Id = string | { eid: string }
let idOf = (v: Id): string => typeof v == 'string' ? v : v.eid

type Row = {
  entity: { eid: string }
  space?: { slug: string; home: Id | null }
  app?: {
    slug: string
    space: Id
    version: number | null
    access?: Access | null
  }
  published?: {
    name?: string | null
    version?: number | null
    at?: string | null
    about?: string | null
  }
  installed?: { of?: Id | null; version?: number | null }
  hostname?: {
    name: string
    app: Id
    stage?: HostStage | null
    at?: string | null
  }
  deploy?: { app: Id; version: number; files?: string; worker?: string }
  created?: { at?: string }
  member?: { space: Id; person: Id; role: Role }
  email?: { address: string }
  alias?: { slug: string; slugs?: string | null }
  doc?: { title?: string }
  plan?: { tier?: Tier | null }
  meter?: Partial<Meter>
  notified?: unknown
}

// The meter as a whole number, however little of the row is written: a column
// nobody has filled reads zero, so nothing downstream tests for null twice.
let meterOf = (r: Row): Meter | null =>
  r.meter
    ? {
      month: r.meter.month ?? '',
      requests: r.meter.requests ?? 0,
      rows_read: r.meter.rows_read ?? 0,
      rows_written: r.meter.rows_written ?? 0,
      bytes: r.meter.bytes ?? 0,
      emails: r.meter.emails ?? 0,
      at: r.meter.at ?? '',
    }
    : null

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

// A read that must not be a moment old, asked for by the caller. The cache
// above is per-isolate and 30 seconds wide, which is exactly the window a
// deploy opens: the isolate serving the app has not heard of the bump the
// deploy just made, so the first break after one named the version BEFORE it
// (C-32869 item 4). A break is rare and its read is fresh; everything else
// keeps the cache. The header is the kernel's own — a client's copy never
// reaches here, since this part is only ever called with `bound`.
export let FRESH = 'x-yak-fresh'

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
  let hit = req.headers.get(FRESH) ? null : cache.get(url.search)
  if (hit && hit.at > Date.now() - TTL) {
    return Response.json(JSON.parse(hit.body))
  }
  let r = await storeOf(env.STORE, META_STORE)(`/query${url.search}`)
  if (!r.ok) return r
  let body = await r.text()
  if (body != '[]') cache.set(url.search, { at: Date.now(), body })
  return new Response(body, {
    headers: { 'content-type': 'application/json' },
  })
}

// A write the kernel makes ABOUT the directory rather than for a person: the
// hourly meter and the plan a space is on (usage.ts), which are the
// platform's word and never a person's. It goes straight at the meta store
// carrying the kernel flag — `fetch` above forwards only what vouches for a
// person, so that flag can never arrive from outside — and empties the cache,
// because what it just changed is what the next read answers.
export let stamp = async (env: Env, mutation: Mutation) => {
  let r = await storeOf(env.STORE, META_STORE)('/apply', {
    method: 'POST',
    body: JSON.stringify(mutation),
  }, { 'x-yak-kernel': '1' })
  if (!r.ok) throw new Error(`directory: ${await r.text()}`)
  await r.body?.cancel()
  cache.clear()
}

// A listing carries the components the filter NAMES (workers/yak/query.ts),
// so every read here asks for what it reads: a space with its title, plan and
// meter, an app with its title, the alias its store is named by, and its
// meter. `id=` names no component and answers the whole bundle, which is why
// those are bare.
// What every read of an APP asks for beside the app row itself, in one place
// because `appOf` reads all of it and a filter that forgets one answers null
// where there is a value.
let ABOUT = '.doc?&.alias?&.meter?&.published?&.installed?'

let spaceOf = (r: Row): Space => ({
  eid: r.entity.eid,
  slug: r.space!.slug,
  home: r.space!.home == null ? null : idOf(r.space!.home),
  title: r.doc?.title || r.space!.slug,
  tier: r.plan?.tier ?? null,
  meter: meterOf(r),
  told: r.notified != null,
})

export let appOf = (r: Row): App => ({
  eid: r.entity.eid,
  slug: r.app!.slug,
  space: idOf(r.app!.space),
  version: r.app!.version,
  access: r.app!.access ?? null,
  title: r.doc?.title || r.app!.slug,
  store: r.alias?.slug ?? null,
  slugs: slugsOf(r.alias),
  meter: meterOf(r),
  published: r.published?.name
    ? {
      name: r.published.name,
      version: r.published.version ?? 0,
      at: r.published.at ?? '',
      about: r.published.about ?? '',
    }
    : null,
  installed: r.installed?.of
    ? { of: idOf(r.installed.of), version: r.installed.version ?? 0 }
    : null,
})

let hostOf = (r: Row): Host => ({
  eid: r.entity.eid,
  name: r.hostname!.name,
  app: idOf(r.hostname!.app),
  stage: r.hostname!.stage ?? null,
  at: r.hostname!.at ?? '',
})

// A deploy of an app, as versions.ts reads one: the manifest parsed, since
// the store holds it as the text it is. A row whose manifest cannot be read
// is a version nothing can restore, so it answers no files rather than
// throwing — the list still shows that the deploy happened.
export let deployOf = (r: Row) => ({
  eid: r.entity.eid,
  version: r.deploy!.version ?? 0,
  at: r.created?.at ?? '',
  files: (() => {
    try {
      return JSON.parse(r.deploy!.files || '{}') as Record<string, string>
    } catch {
      return {}
    }
  })(),
  worker: r.deploy!.worker ?? '',
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

// `now` makes every read of this client a fresh one (FRESH above): the agent
// tier asks for it, because a tool answers right after a tool wrote, and the
// cache is per-isolate — `app_versions` straight after `app_rollback` still
// marked the version before it live (C-32905 item 5). Page traffic keeps the
// cache; an agent's answer never disagrees with the write it just made.
export let directory = (via: Fetcher, now = false) => {
  let query = async (q: string, fresh = now): Promise<Row[]> => {
    let r = await via.fetch(
      new Request(
        `http://directory/query?${q}`,
        fresh ? { headers: { [FRESH]: '1' } } : {},
      ),
    )
    if (!r.ok) throw new Error(`directory: ${await r.text()}`)
    return r.json()
  }
  let one = async (q: string, fresh = now) => (await query(q, fresh))[0]
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
      let row = await one(`.space.slug=${slug}&.doc?&.plan?&.meter?&.notified?`)
      return row ? spaceOf(row) : null
    },
    // `fresh` skips the read cache: what a break names has to be the deploy
    // it happened on, not one the cache is still holding (unseen.ts
    // `serving`).
    app: async (space: Space, slug: string, fresh = now) => {
      let row = await one(
        `.app.space=${space.eid}&.app.slug=${slug}&${ABOUT}`,
        fresh,
      )
      return row ? appOf(row) : null
    },
    // An address the app has LEFT, still pointing at it. A rename moves
    // `app.slug` and keeps the old address on the app's alias, and every
    // alias resolves like an id — so this is the id door, asked in the meta
    // store, and an answer that is an app of THIS space is a move to follow
    // (T-32576: a rename used to strand every open page).
    former: async (space: Space, slug: string) => {
      let row = await one(`id=${bornAt(space, slug)}`)
      let app = row?.app && row.app.space == space.eid ? appOf(row) : null
      return app && app.slug != slug ? app : null
    },
    // Every app in a space, oldest first — the order they were made.
    apps: async (space: Space): Promise<App[]> =>
      (await query(`.app.space=${space.eid}&${ABOUT}`)).map(appOf),
    // A space by eid, which is how an app names the space it belongs to.
    at: async (eid: string) => {
      let row = await one(`id=${eid}`)
      return row?.space ? spaceOf(row) : null
    },
    // One app by eid, with the space it belongs to — what an installed app's
    // pin names (`installed.of`), and how an offer is read back.
    appAt: async (eid: string) => {
      let row = await one(`id=${eid}`)
      if (!row?.app) return null
      let app = appOf(row)
      let space = await self.at(app.space)
      return space ? { space, app } : null
    },
    // What a hostname someone else owns is aimed at (T-33037): the hostname
    // row, the app it serves, and the space that app is in — one hostname,
    // one place, which the unique index on `hostname.name` is what makes
    // true. Null for a hostname the platform has never been given, which is
    // every hostname until someone attaches one — and is what keeps an
    // unknown host routing exactly as it always did. Cached like every other
    // read here, and an empty answer is not cached, so a domain serves the
    // moment it is attached rather than a TTL later.
    serves: async (host: string) => {
      let row = await one(`.hostname.name=${encodeURIComponent(host)}`)
      if (!row?.hostname) return null
      let at = await self.appAt(idOf(row.hostname.app))
      return at ? { ...at, host: hostOf(row) } : null
    },
    // Every domain attached to an app of this space (T-33038), oldest first.
    // A hostname belongs to a space through its app, so this reads the
    // hostnames and keeps the ones aimed into the space — one query, where
    // one per app would be several, and the whole table is exactly the
    // platform's custom hostname count.
    hosts: async (space: Space): Promise<Host[]> => {
      let apps = new Set((await self.apps(space)).map((a) => a.eid))
      return (await query('.hostname!')).map(hostOf)
        .filter((h) => apps.has(h.app))
    },
    // The app offered under a platform-wide name (T-32888), with the space it
    // came from — an offer is an app, so this is one row read two ways.
    offered: async (name: string) => {
      let row = await one(
        `.published.name=${encodeURIComponent(name)}&.app!`,
      )
      return row?.app ? await self.appAt(row.entity.eid) : null
    },
    // Every offer standing, newest first — what a person's agent browses.
    offers: async (): Promise<{ space: Space; app: App }[]> => {
      let rows = (await query(`.published!&.app!&${ABOUT}`)).map(appOf)
        .filter((a) => a.published)
        .sort((a, b) => b.published!.at.localeCompare(a.published!.at))
      let out: { space: Space; app: App }[] = []
      for (let app of rows) {
        let space = await self.at(app.space)
        if (space) out.push({ space, app })
      }
      return out
    },
    // Every deploy of an app, newest first — the versions app_versions lists
    // and app_rollback picks from (versions.ts). Twenty at most, so the list
    // is read whole and ordered here. Never cached: a deploy reads its own
    // versions back the moment it writes one.
    deploys: async (app: App) =>
      (await query(`.deploy.app=${app.eid}&.created?`, true))
        .map(deployOf)
        .sort((a, b) => b.version - a.version),
    // Every space there is. Only the meter asks this (usage.ts): a tool
    // always works in one space, and a person only ever sees their own.
    all: async (): Promise<Space[]> =>
      (await query('.space!&.doc?&.plan?&.meter?&.notified?')).map(spaceOf),
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
    // Everyone in a space, by person eid — who to tell when an app's tools
    // move (declared.ts `toolsChanged`), since reaching the app is exactly
    // being in the space.
    members: async (space: Space): Promise<string[]> =>
      (await query(`.member.space=${space.eid}`))
        .map((r) => r.member && idOf(r.member.person))
        .filter((p): p is string => !!p),
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
    // The same question the other way: where the platform writes to this
    // person — the letter's envelope, and nothing else (T-32629).
    emailAt: async (person: string) =>
      (await one(`id=${person}`))?.email?.address ?? null,
    // What to call this person anywhere their address must not go: the name
    // they chose at sign-in, else the front of their address (signin.ts
    // `nameOf`). An app's store is written this and never the address, so a
    // page that shows its bylines shows names (T-32654).
    nameAt: async (person: string) => {
      let row = await one(`id=${person}`)
      return row?.email ? nameOf(row.doc?.title, row.email.address) : null
    },
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
        let row = m.member && await one(`id=${idOf(m.member.space)}`)
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
