// The directory part (D-32318 §The meta-space): spaces, apps, and members
// are entities in the meta-space's store — the Store object named
// yak/platform, a graph on the platform's own vocabulary (vocab.ts
// `platformDoc`, T-33814) — and this handler is that store's door,
// `GET /query?q=<filter line>` and `POST /apply`, bundles in and entity JSON
// out. No shape of its own: a caller in this Worker and a caller across a
// service binding ask the same question, and `directory(fetcher)` below is the
// typed client that phrases the ones the kernel asks (a space by slug, an app
// in it, its home, a person's role) and writes the ones that change it (a
// space born, an app born, a deploy). meta.ts is the store below it.
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
// written as bundles through the store's /apply, so the directory can describe
// its own store.
import type { Bundle } from '@yaks/graph'
import type { EntityLiteral, Mutation } from '../../src/mutation.ts'
import { slugsOf } from '../../src/types.ts'
import { type Door, type Fetcher, type Namespace, storeOf } from './door.ts'
import { KERNEL, type Meta, meta as metaStore } from './meta.ts'
import { mailFrom } from './post.ts'
import { SLUG } from './route.ts'
import { firstOf } from './router.ts'
import { nameOf } from './signin.ts'
import { PLATFORM_STORE } from './vocab.ts'

export let META = { space: 'yak', app: 'platform' }
// The meta space's own store, named the way every app's is. Its slugs are
// the platform's own and never move, so the name is a constant — vocab.ts
// spells it, because the store's own vocabulary is chosen by that name.
export let META_STORE = PLATFORM_STORE

// What a space or an app spent this calendar month (platform.rs `Meter`,
// usage.ts writes it): on an app its own store's, on a space every app of it
// summed plus the letters it sent and received. Null where nothing has been
// metered yet.
export type Meter = {
  month: string
  requests: number
  rows_read: number
  rows_written: number
  bytes: number
  emails: number
  // What the builder did and what it cost (T-34241): the builds it completed
  // this month, the tokens they spent, and — the one figure here that is not
  // the month's — every build in this space's life, because the free plan's
  // build is for the life of the space rather than the month.
  builds: number
  tokens: number
  // The seconds the builder's workbench spent awake (sandbox.ts, T-34264).
  // Its own column beside `tokens` because a token and a container-second are
  // priced differently, and one number made of both is a number nobody can
  // add up.
  seconds: number
  built: number
  at: string
}
export type Tier = 'free' | 'plus'

// Spaces the platform comps. `yourname` is its own shopfront — the six apps
// every home page example links to (T-33053), one over the free five — and it
// pays nobody, so it answers to no ceiling.
//
// A comp is a CONSTANT, read here and written nowhere. `plan` is stamped
// precisely so that a person cannot lift their own ceilings (billing.ts), and
// that has to hold for a comp too: comping is a deploy, reviewable in the
// diff, rather than a request anybody can make. T-33164 asks for the operator
// door that would make this a decision instead of a list — a comp, a support
// credit and a demo all want one, and Stripe owns only the paying case.
export let COMPED = ['yourname']

// The tier a space is HELD to: what it pays for, or `plus` where we comp it.
export let tierOf = (slug: string, tier: Tier | null): Tier | null =>
  COMPED.includes(slug) ? 'plus' : tier

// What a space pays and what Stripe knows about it (platform.rs `Plan`,
// billing.ts derives and writes it). The whole row, because the webhook reads
// every column of it to decide whether an event is news: `at` is the moment of
// the Stripe event that last wrote this, `status` is Stripe's own word, and
// `ending` is set only when the subscription will not renew.
export type Plan = {
  tier: Tier
  customer: string
  subscription: string
  status: string
  until: string | null
  ending: string | null
  at: string
}

export type Space = {
  eid: string
  slug: string
  title: string
  // What this space pays (D-32751). Null for a space the sweep has not
  // reached yet, which means free — the terms every space is on today.
  tier: Tier | null
  // The same row whole, for the one caller that needs every column of it
  // (billing.ts). Null where no `plan` row has ever been written.
  plan: Plan | null
  meter: Meter | null
  // Whether the agent has already been told where this space stands against
  // its ceilings (unseen.ts `ceiling`). The mark is `notified`, the same one
  // an error wears once it has been served; the sweep clears it when the
  // standing changes, so a new line is one the agent has not heard.
  told: boolean
  // In the trash, and since when (erase.ts, T-34431) — the same word an app
  // wears, on the row above it. Null for every space that is not, which is
  // almost all of them. While it is worn every hostname of the space answers
  // nothing, its apps leave every roster, its mail bounces and its slug is
  // held; nothing it holds is touched until the thirty days run out.
  trashed: Trashed | null
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
  // Whether this app is the space's FRONT PAGE — the app wearing `home`
  // (T-34227). At most one app in a space does; `homing` below is what keeps
  // that true.
  home: boolean
  // The paths its worker answers BEFORE the app whose slug owns them, the
  // columns of that same word (D-34197, router.ts). Empty for every app that
  // never opted in, which is almost all of them.
  first: string[]
  // What this app's own store spent this month, as the hourly sweep last read
  // it (usage.ts). Null until it has been metered once.
  meter: Meter | null
  // The offer it stands as right now, null unless it is published, and where
  // it was installed from, null unless it was.
  published: Offer | null
  installed: Pin | null
  // When this app's store was seeded and by which release (seed.ts), null
  // until it has been. A release reads it to know the seed has already run.
  seeded: Sowed | null
  // In the trash, and since when (erase.ts, T-34430). Null for every app that
  // is not — which is almost all of them — and every reader of an app asks
  // it: a trashed app serves nothing, declares nothing, is nobody's front
  // page and takes no mail, while its bytes, its store and its slug are all
  // still here for the thirty days `app_restore` has to bring it back.
  trashed: Trashed | null
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

// That the app's store carries the data its files seed it with, and the
// release that put it there (seed.ts, T-34327).
export type Sowed = { at: string; version: number }

// When an app or a space was thrown away and by whom (erase.ts, T-34430,
// T-34431). `at` is what the thirty days are counted from, and `by` is the
// person the sweep erases it as, since they are the one who asked for it gone.
export type Trashed = { at: string; by: string }

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
  space?: { slug: string }
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
  seeded?: { at?: string | null; version?: number | null }
  trashed?: { at?: string | null; by?: Id | null }
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
  former?: { slug: string; slugs?: string | null }
  home?: { first?: string | null }
  doc?: { title?: string }
  plan?: {
    tier?: Tier | null
    customer?: string | null
    subscription?: string | null
    status?: string | null
    until?: string | null
    ending?: string | null
    at?: string | null
  }
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
      builds: r.meter.builds ?? 0,
      tokens: r.meter.tokens ?? 0,
      seconds: r.meter.seconds ?? 0,
      built: r.meter.built ?? 0,
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

// One seed per isolate, awaited by the WRITE door and by nothing else
// (T-33176). It used to sit in front of every read, which cost a round trip
// to the meta store on every cold isolate — and an isolate is cold for
// almost every request a quiet platform serves, so that trip was ~100ms on
// the front of every page load, forever, to re-confirm two rows that have
// existed since the platform's first day. A read needs none of it: a meta
// space that is not there answers empty, which is what an unseeded platform
// should say. Every path that MINTS anything goes through /apply, so the
// seed still happens before there is anything to describe.
//
// A second isolate racing the first bounces on the unique slug and is
// ignored: its query then finds the winner. Held against the DOOR rather than
// the module, so that one door is seeded once and a test with its own store
// seeds its own.
let seeded = new WeakMap<Meta, Promise<void>>()

let seed = async (store: Meta) => {
  if ((await store.query(`.space.slug=${META.space}`)).length) return
  await store.apply([
    {
      entity: { eid: '$space' },
      doc: { title: META.space },
      space: { slug: META.space },
    },
    {
      entity: { eid: '$app' },
      doc: { title: META.app },
      app: { slug: META.app, space: '$space' },
    },
  ])
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

// This part's own door is the fleet's mutation envelope — a bundle list under
// `entities`, which is what its typed client and every tool writes — and the
// store below it is a graph, so the envelope is opened here and the bundles go
// on as they are (meta.ts). `over` names the store the door speaks to, which is
// the seam a test drives a whole directory against.
export let over = (store: Meta) => async (req: Request): Promise<Response> => {
  let url = new URL(req.url)
  if (url.pathname == '/apply' && req.method == 'POST') {
    let first = seeded.get(store)
    if (!first) seeded.set(store, first = seed(store))
    await first
    try {
      let sent = await req.json() as { entities?: Bundle[] }
      let applied = await store.apply(sent.entities ?? [], forwarded(req))
      // The directory just moved; nothing read before it is still true.
      cache.clear()
      return Response.json({ ok: true, ...resulted(applied) })
    } catch (e) {
      return new Response(e instanceof Error ? e.message : String(e), {
        status: 400,
      })
    }
  }
  if (url.pathname != '/query' || req.method != 'GET') return notFound()
  let line = url.searchParams.get('q') ?? ''
  let hit = req.headers.get(FRESH) ? null : cache.get(line)
  if (hit && hit.at > Date.now() - TTL) {
    return Response.json(JSON.parse(hit.body))
  }
  let rows: Bundle[]
  try {
    rows = await store.query(line)
  } catch (e) {
    return new Response(e instanceof Error ? e.message : String(e), {
      status: 400,
    })
  }
  let body = JSON.stringify(rows)
  if (body != '[]') cache.set(line, { at: Date.now(), body })
  return new Response(body, {
    headers: { 'content-type': 'application/json' },
  })
}

/** The part, over the directory's own store. The env it asks for is the one
 * binding it reads, so a caller holding the namespace and nothing else — a
 * Store object metering a letter (meter.ts `metering`) — can call it too. */
export let fetch = (
  req: Request,
  env: { STORE: Namespace },
): Promise<Response> => over(metaStore(env))(req)

// The applied batch in the shape this part's callers read: the flat changes a
// tool inspects for the eid it just wrote, and the aliases a mint is looked up
// by. Both are projections of the bundles the graph answered with.
let resulted = (applied: Bundle[]) => ({
  changes: applied.flatMap((b) =>
    Object.entries(b)
      .filter(([k]) => k != 'entity' && !k.startsWith('$'))
      .map(([name, comp]) => ({ eid: b.entity.eid, name, comp }))
  ),
  aliases: Object.fromEntries(
    applied.flatMap((b) =>
      typeof b.$alias == 'string' ? [[b.$alias, b.entity.eid]] : []
    ),
  ),
})

// A write the kernel makes ABOUT the directory rather than for a person: the
// hourly meter (usage.ts), a letter counted as it goes or arrives (meter.ts
// `counted`) and the plan a space is on, which are the
// platform's word and never a person's. It goes straight at the meta store
// carrying the kernel flag — `fetch` above forwards only what vouches for a
// person, so that flag can never arrive from outside — and empties the cache,
// because what it just changed is what the next read answers.
export let stamp = async (
  env: { STORE: Namespace },
  mutation: { entities: Bundle[] },
) => {
  await metaStore(env).apply(mutation.entities, KERNEL)
  cache.clear()
}

// A listing carries the components the filter NAMES (graph.ts `#wanted`),
// so every read here asks for what it reads: a space with its title, plan and
// meter, an app with its title, the address its store is named by, and its
// meter. `.eid=` names no component and answers the whole bundle, which is why
// those are bare.
// What every read of an APP asks for beside the app row itself, in one place
// because `appOf` reads all of it and a filter that forgets one answers null
// where there is a value.
let ABOUT =
  '.doc?&.former?&.home?&.meter?&.published?&.installed?&.seeded?&.trashed?'

// And what every read of a SPACE asks for, for the same reason.
let SPACE_ABOUT = '.doc?&.plan?&.meter?&.notified?&.trashed?'

// The plan as a whole row, however little of it is written: a column nobody
// has filled reads empty, the way `meterOf` does, so nothing downstream tests
// for null twice.
let planOf = (r: Row): Plan | null =>
  r.plan
    ? {
      tier: r.plan.tier ?? 'free',
      customer: r.plan.customer ?? '',
      subscription: r.plan.subscription ?? '',
      status: r.plan.status ?? '',
      until: r.plan.until ?? null,
      ending: r.plan.ending ?? null,
      at: r.plan.at ?? '',
    }
    : null

// The trash mark as both rows wear it (erase.ts): one reader, because an app
// and a space are in the trash the same way and are counted the same way out
// of it.
let trashedOf = (r: Row) =>
  r.trashed
    ? { at: r.trashed.at ?? '', by: r.trashed.by ? idOf(r.trashed.by) : '' }
    : null

let spaceOf = (r: Row): Space => ({
  eid: r.entity.eid,
  slug: r.space!.slug,
  title: r.doc?.title || r.space!.slug,
  tier: tierOf(r.space!.slug, r.plan?.tier ?? null),
  plan: planOf(r),
  meter: meterOf(r),
  told: r.notified != null,
  trashed: trashedOf(r),
})

export let appOf = (r: Row): App => ({
  eid: r.entity.eid,
  slug: r.app!.slug,
  space: idOf(r.app!.space),
  version: r.app!.version,
  access: r.app!.access ?? null,
  title: r.doc?.title || r.app!.slug,
  store: r.former?.slug ?? null,
  slugs: slugsOf(r.former),
  home: r.home != null,
  first: firstOf(r.home),
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
  seeded: r.seeded
    ? { at: r.seeded.at ?? '', version: r.seeded.version ?? 0 }
    : null,
  trashed: trashedOf(r),
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
// every recipe in it. So the name is pinned at birth on the app's `former`
// record — the address it was born at — and read back here. An app born before
// that (`store` null) is named by its address, which for it has never moved.
export let storeName = (space: Space, app: App) =>
  app.store ?? `${space.slug}/${app.slug}`

// What app_new pins, and what a rename must therefore leave alone.
export let bornAt = (space: Space, slug: string) => `${space.slug}/${slug}`

// The door onto one app's store, told WHICH app it holds and what this
// directory says its access mode is (T-33813). A store keeps both (graph.ts
// `#learn`) and answers @yaks/member's questions with them, so every caller
// that has an App in hand opens its store this way; the ones that only have a
// name — the meta store, the usage sweep — have no app to name and use
// `storeOf` directly.
export let appStore = (ns: Namespace, space: Space, app: App): Door =>
  storeOf(ns, storeName(space, app), {
    eid: app.eid,
    access: app.access,
    mail: mailbox(space, app),
  })

// The other address a (space, app) has, beside {@link url}: what its letters
// leave from, and what a reader writes back to (post.ts `mailFrom`, T-33686).
// The home app's is the bare space name, for the same reason its page is the
// bare hostname. Derived HERE and carried to the store on every request,
// because the store is named at birth and knows neither the app's current slug
// nor which app the space's front page is.
export let mailbox = (space: Space, app: App) =>
  mailFrom(space.slug, app.home ? null : app.slug)

// The address a person is handed for an app. A space's front page IS its
// bare hostname (T-33040, apps.ts `fetch`) — its own `/<app>/` only forwards
// there — so every answer that hands out a link hands out the one to hold.
// The app must be the one read back AFTER the caller's own write, or a tool
// that just moved the front page reports the address it had before. It lives
// here beside the store's name because it is the other name a (space, app)
// has, and everything that says one out loud reads it from one place: the
// tools, and the letter that names what deleting a space would destroy
// (erase.ts).
export let url = (space: Space, app: App) =>
  `https://${space.slug}.yaks.app/` + (app.home ? '' : `${app.slug}/`)

/**
 * Moving the front page, as the bundles that do it (T-34227): the word comes
 * OFF the app that had it and goes ON the one that gets it, in whatever batch
 * the caller is already writing, so the space is never for one moment a space
 * with two front pages or none it did not ask for.
 *
 * This is where "at most one home app per space" lives. The vocabulary would
 * say it if it could — `unique` is over one component's own columns, and `home`
 * has no space of its own to pair with (vocab.ts) — so the rule is the
 * directory's, and it is one function rather than a paragraph in each caller.
 *
 * `was` is the app wearing `home` now (`dir.home`), `onto` the one that should
 * wear it, or null to leave the space with no front page. `first` rides along
 * when the same call also set the globs, since they are columns of this word.
 */
export let homing = (
  was: App | null,
  onto: App | null,
  first?: string[] | null,
): EntityLiteral[] => [
  // `home: null` drops the whole component, globs and all: an app that is not
  // the front page routes nothing first, so there is no column left to keep.
  ...(was && was.eid != onto?.eid
    ? [{ entity: { eid: was.eid }, home: null }]
    : []),
  ...(onto
    ? [{
      entity: { eid: onto.eid },
      home: first == null
        // A patch with no columns: an app already home keeps the globs it had.
        ? {}
        : { first: first.length ? JSON.stringify(first) : null },
    }]
    : []),
]

// The typed client over the handler, in-process or across a binding.
export type Directory = ReturnType<typeof directory>

// `now` makes every read of this client a fresh one (FRESH above): the agent
// tier asks for it, because a tool answers right after a tool wrote, and the
// cache is per-isolate — `app_versions` straight after `app_rollback` still
// marked the version before it live (C-32905 item 5). Page traffic keeps the
// cache; an agent's answer never disagrees with the write it just made.
export let directory = (via: Fetcher, now = false) => {
  // The whole filter line as ONE parameter, values written raw: the door
  // hands it to the graph as the query it is (meta.ts), rather than each
  // caller escaping the pieces of a search string.
  let query = async (q: string, fresh = now): Promise<Row[]> => {
    let r = await via.fetch(
      new Request(
        `http://directory/query?q=${encodeURIComponent(q)}`,
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
      let row = await one(`.space.slug=${slug}&${SPACE_ABOUT}`)
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
    // `app.slug` and keeps the old address in the app's `former`, so the answer
    // is the app of THIS space that still answers to the address asked for —
    // a move to follow (T-32576: a rename used to strand every open page).
    former: async (space: Space, slug: string) => {
      let was = bornAt(space, slug)
      let app = (await self.apps(space))
        .find((a) => a.slug != slug && a.slugs.includes(was))
      return app ?? null
    },
    // Every app in a space, oldest first — the order they were made.
    apps: async (space: Space): Promise<App[]> =>
      (await query(`.app.space=${space.eid}&${ABOUT}`)).map(appOf),
    // The space that pays as this Stripe customer (billing.ts). It is how a
    // subscription event is attributed when its metadata does not say — a
    // space keeps ONE customer for its whole life, so the answer is one space
    // or nobody.
    payer: async (customer: string) => {
      let row = await one(
        `.plan.customer=${customer}&.space!&${SPACE_ABOUT}`,
      )
      return row?.space ? spaceOf(row) : null
    },
    // A space by eid, which is how an app names the space it belongs to.
    at: async (eid: string) => {
      let row = await one(`.eid=${eid}`)
      return row?.space ? spaceOf(row) : null
    },
    // One app by eid, with the space it belongs to — what an installed app's
    // pin names (`installed.of`), and how an offer is read back.
    appAt: async (eid: string) => {
      let row = await one(`.eid=${eid}`)
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
      let row = await one(`.hostname.name=${host}`)
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
      let row = await one(`.published.name=${name}&.app!`)
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
      (await query(`.space!&${SPACE_ABOUT}`)).map(spaceOf),
    // The app that answers the space's bare hostname, if it has one: the one
    // in this space WEARING `home` (T-34227). At most one does — `homing`
    // below is the rule — so the first row is the answer.
    // A trashed app is nobody's front page (erase.ts, T-34430): the word
    // stays ON it so a restore puts the space back exactly as it was, and
    // until then the space is one with no front page — which is the ordinary
    // state and already has an answer everywhere.
    home: async (space: Space) => {
      let rows = await query(`.app.space=${space.eid}&.home!&${ABOUT}`)
      return rows.filter((r) => r.app).map(appOf).find((a) => !a.trashed) ??
        null
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
      (await one(`.person!&.email.address=${email}`))
        ?.entity.eid ?? null,
    // The same question the other way: where the platform writes to this
    // person — the letter's envelope, and nothing else (T-32629).
    emailAt: async (person: string) =>
      (await one(`.eid=${person}`))?.email?.address ?? null,
    // What to call this person anywhere their address must not go: the name
    // they chose at sign-in, else the front of their address (signin.ts
    // `nameOf`). An app's store is written this and never the address, so a
    // page that shows its bylines shows names (T-32654).
    nameAt: async (person: string) => {
      let row = await one(`.eid=${person}`)
      return row?.email ? nameOf(row.doc?.title, row.email.address) : null
    },
    // Every space this person belongs to, the meta space left out: `yak` is
    // the platform's own, and a person who owns it (the first to sign in)
    // still means their own space when they name none. Name a role and the
    // answer is the spaces they hold it in — `owner` is the set that means
    // "spaces of theirs", which is not the set they can see (T-33142).
    spaces: async (person: string, role?: Role): Promise<Space[]> => {
      // A filter resolves an eid to an entity, so a person the meta store has
      // never seen — someone who signed in before it kept a row — makes the
      // question itself unanswerable. No row, no memberships.
      if (!(await one(`.eid=${person}`))) return []
      let members = await query(
        `.member.person=${person}${role ? `&.member.role=${role}` : ''}`,
      )
      let spaces: Space[] = []
      for (let m of members) {
        let row = m.member && await one(`.eid=${idOf(m.member.space)}`)
        if (row?.space && row.space.slug != META.space) {
          spaces.push(spaceOf(row))
        }
      }
      return spaces
    },
    // The next free spelling of a derived name: the name itself, else
    // numbered until nothing answers to it. What `own` mints, and what the
    // sign-in card offers a person before it does (T-32967).
    free: async (base: string) => {
      let slug = base
      for (let n = 2; await self.space(slug); n++) slug = `${base}${n}`
      return slug
    },
    // The person's own space, minted the moment they first need one — at
    // sign-in, or at the first tool call by someone who signed in before this
    // existed (T-32482). Theirs is a space they OWN — the one their address
    // spells, if they own it, else the first they own — and being a member of
    // somebody else's is not having one, so an invited person is minted theirs
    // here rather than handed the inviter's (T-33142). A race that loses on
    // the unique slug re-reads and finds the winner.
    //
    // `want` is the address they chose at the sign-in card, taken only when it
    // is a slug and still free — the card asked the same question a moment
    // earlier and refused a taken one out loud (identity.ts `refuse`), so this
    // is the race between that answer and the mint, not the refusal a person
    // reads. Someone who already has a space is not minting one, so their
    // choice is moot here and `/connect` is where they move (T-34137).
    own: async (person: string, want?: string): Promise<Space> => {
      let mine = await self.spaces(person, 'owner')
      let row = await one(`.eid=${person}`)
      let wanted = slugFor(row?.email?.address ?? 'space')
      if (mine.length) return mine.find((s) => s.slug == wanted) ?? mine[0]
      let chosen = !!want && SLUG.test(want) && !await self.space(want)
      let slug = chosen ? want! : await self.free(wanted)
      // The same batch space_new writes, for the same reasons: the person's
      // own row (they may have none yet), the space, and their ownership of
      // it — all bundles, since a bundle mints at an eid its author chose
      // (T-32455).
      try {
        await self.apply({
          entities: [
            { entity: { eid: person }, person: {} },
            // A space nobody has named is known by the name it answers to,
            // which is what `/connect` writes when one is chosen there too.
            {
              entity: { eid: '$space' },
              doc: { title: slug },
              space: { slug },
            },
            {
              entity: { eid: '$seat' },
              member: { space: '$space', person, role: 'owner' },
            },
          ],
        }, { 'x-yak-person': person, 'x-yak-role': 'owner' })
      } catch (e) {
        let [theirs] = await self.spaces(person, 'owner')
        if (!theirs) throw e
        return theirs
      }
      return (await self.space(slug))!
    },
    // Whether nobody belongs yet: read only to admit the first member.
    memberless: async (space: Space) =>
      !(await one(`.member.space=${space.eid}&.limit=1`)),
  }
  return self
}
