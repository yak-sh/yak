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
// Answers are cached per store in private Maps, with a 30-second TTL
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
import { type Host as HostEnv, spaceHost } from './host.ts'
import type { Bundle } from '@yaks/graph'
import {
  type Door,
  type Fetcher,
  type Namespace,
  PLATFORM_STORE,
  storeOf,
} from './door.ts'
import { ADMIN } from './lib/bots.ts'
import { answered, KERNEL, type Meta, meta as metaStore } from './meta.ts'
import { caught } from './sentry.ts'
import { mailFrom } from './post.ts'
import { RESERVED, SLUG } from './route.ts'
import { firstOf } from './router.ts'
import { nameOf } from './signin.ts'

export let META = { space: 'yak', app: 'platform' }
// The meta space's own store, named the way every app's is. Its slugs are
// the platform's own and never move, so the name is a constant — door.ts
// builds it, beside the rest of what addresses a store.
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
  // Stored R2 bytes, independent of the calendar month; absent before rollout.
  files?: number
  emails: number
  // Monthly builder usage. `built` keeps a lifetime total for usage reporting;
  // both plans enforce their build allowance against the monthly `builds`.
  builds: number
  tokens: number
  // The seconds the builder's workbench spent awake (sandbox.ts, T-34264).
  // Its own property beside `tokens` because a token and a container-second are
  // priced differently, and one number made of both is a number nobody can
  // add up.
  seconds: number
  built: number
  at: string
}
export type Tier = 'free' | 'plus'

// Spaces the platform comps. `yourname` is its own shopfront — the six apps
// every home page example links to (T-33053), one over the free five — and it
// pays nobody, so it has no app/data ceiling (meter.ts `ceilings`).
//
// A comp is a constant, read here and written nowhere. `plan` is stamped
// precisely so that a person cannot lift their own ceilings (billing.ts), and
// that has to hold for a comp too: comping is a deploy, reviewable in the
// diff, rather than a request anybody can make. T-33164 asks for the operator
// door that would make this a decision instead of a list — a comp, a support
// credit and a demo all want one, and Stripe owns only the paying case.
export let COMPED = ['yourname']

// Paid features and mail/build allowances: `plus` also applies to comps.
// Their separate app/data exemption is resolved by meter.ts from COMPED.
export let tierOf = (slug: string, tier: Tier | null): Tier | null =>
  COMPED.includes(slug) ? 'plus' : tier

// What a space pays and what Stripe knows about it (platform.rs `Plan`,
// billing.ts derives and writes it). The whole row, because the webhook reads
// every property of it to decide whether an event is news: `at` is the moment
// of the Stripe event that last wrote this, `status` is Stripe's own word, and
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

/** A space's connected Stripe account, as the directory holds it (sell.ts).
 * Three properties and no more: the merchant's own books are Stripe's, and the
 * platform keeps only the id every call names them by and the two words that
 * say whether they are ready — `details_submitted` is "they finished the
 * form", `charges_enabled` is "Stripe will take money for them", and the
 * checkout door reads the second one alone. */
export type Stripe = {
  account: string
  chargesEnabled: boolean
  detailsSubmitted: boolean
}

/** The tunnel a space has to a machine (tunnel.ts, @yaks/tunnel): the tunnel
 * it dials out on, the Workers VPC Service the tunnel's gateway is bound to, and
 * whether the platform made the pair or only records one made elsewhere. */
export type Tunnel = { id: string; service: string; adopted: boolean }

export type Space = {
  eid: string
  slug: string
  title: string
  // What this space pays (D-32751). Null for a space the sweep has not
  // reached yet, which means free — the terms every space is on today.
  tier: Tier | null
  // The same row whole, for the one caller that needs every property of it
  // (billing.ts). Null where no `plan` row has ever been written.
  plan: Plan | null
  // What this space sells through (sell.ts, T-34524): the connected Stripe
  // account, and whether Stripe says it may take money yet. Null for a space
  // that has never asked to sell, which is almost all of them.
  stripe: Stripe | null
  // What the platform takes from a sale here, in basis points (sell.ts
  // `feeOf`). It is asked of one space — `yak`, the platform's own row — and
  // 0 on every other, where nobody has ever written one.
  fee: number
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
  // Every subdomain this space has answered at, oldest first — the same word
  // an app wears for the same reason (T-34658). Empty for a space that has
  // never moved, which is almost all of them; each entry redirects to the
  // address it lives at now, and stays reserved until somebody forgets it.
  slugs: string[]
  // The tunnel this space has to a machine, whose opened paths an app's
  // worker reaches through a `vpc_services` door (tunnel.ts `reach`). Null for
  // a space with no tunnel, which is almost all of them.
  tunnel: Tunnel | null
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
  // The app's handle: the name of everything the platform keeps for it — its
  // Durable Object, its dispatch script, its export path, its analytics rows
  // (`storeName` below). Written once at birth and never derived from a slug
  // again. Null only for an app the backfill has not reached (migrate.ts
  // `handled`), which no read can be: the pass runs on the directory's first
  // request of the deploy, before any app of it is answered for.
  store: string | null
  // Every address this app has answered at within its space — the slug it was
  // born at first, then each one a rename left behind, oldest first. They
  // resolve like ids ({@link slugsOf}), which is how an old link still finds
  // the app it was made for.
  slugs: string[]
  // Whether this app is the space's front page — the app wearing `home`
  // (T-34227). At most one app in a space does; `homing` below is what keeps
  // that true.
  home: boolean
  // The paths its worker answers before the app whose slug owns them, the
  // properties of that same word (D-34197, router.ts). Empty for every app that
  // never opted in, which is almost all of them.
  first: string[]
  // What this app's own store spent this month, as the hourly sweep last read
  // it (usage.ts). Null until it has been metered once.
  meter: Meter | null
  // The offer it stands as right now, null unless it is published, and where
  // it was installed from, null unless it was.
  published: Offer | null
  installed: Pin | null
  // Where this offer stands with the gallery (gallery.ts, T-34476): null for
  // every app that never asked, which is almost all of them.
  gallery: Gallery | null
  // When this app's store was seeded and by which release (seed.ts), null
  // until it has been. A release reads it to know the seed has already run.
  seeded: Sowed | null
  // In the trash, and since when (erase.ts, T-34430). Null for every app that
  // is not — which is almost all of them — and every reader of an app asks
  // it: a trashed app serves nothing, declares nothing, is nobody's front
  // page and takes no mail, while its bytes, its store and its slug are all
  // still here for the thirty days `app_restore` has to bring it back.
  trashed: Trashed | null
  // The colours this app's owner set for its installed chrome (apps.ts
  // `manifesting`/`pinned`, T-33055): the phone's splash while it opens
  // (`backgroundColor`) and the browser/status chrome around it
  // (`themeColor`), both CSS, set through `app_set`. Either half null where
  // the app never set it — the platform's own palette answers instead
  // (apps.ts `PLATFORM_THEME`/`PLATFORM_BACKGROUND`), so an app that asked
  // for neither is never colourless.
  theme: { themeColor: string | null; backgroundColor: string | null } | null
}
export type Role = 'owner' | 'editor' | 'viewer'
/** The modes an app's `access.mode` takes, from everyone to its own people. */
export let MODES = ['public', 'open', 'private'] as const
export type Access = typeof MODES[number]

/** Every address an app answered at: the slug it wears now, then the ones a
 * rename left behind (`former.slugs`, space-separated). */
export let slugsOf = (a?: { slug?: string | null; slugs?: string | null }) =>
  a?.slug ? [a.slug, ...(a.slugs?.split(/\s+/).filter(Boolean) ?? [])] : []

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
// pin is what makes `app_update` a deliberate act. `of` is null once the app
// it came from is gone, and the copy is still a copy. `sandboxed` is when its
// space's owner walled it off (installed.ts), null while it runs like the
// space's own apps.
export type Pin = {
  of: string | null
  version: number
  sandboxed: string | null
}

// Where a published app stands with the gallery (gallery.ts, T-34476): when
// its owner asked to be shown on yaks.app, and when we said yes. Asked and not
// yet listed is the waiting state; both empty is a row that never asked.
export type Gallery = { askedAt: string; listedAt: string }

// That the app's store carries the data its files seed it with, and the
// release that put it there (seed.ts, T-34327).
export type Sowed = { at: string; version: number }

// When an app or a space was thrown away and by whom (erase.ts, T-34430,
// T-34431). `at` is what the thirty days are counted from, and `by` is the
// person the sweep erases it as, since they are the one who asked for it gone.
export type Trashed = { at: string; by: string }

// A hostname a person owns, aimed at one place (platform.rs `Hostname`,
// T-33037): `serves` is the eid of the space it opens, or of the one app it
// opens (T-34596). How far provisioning has come, and when that was last read
// from Cloudflare.
export type HostStage = 'pending' | 'active' | 'error'
export type Host = {
  eid: string
  name: string
  serves: string
  stage: HostStage | null
  at: string
}

// A reference property, as a read hands it back: the bare eid, or `{eid, name}`
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
    store?: string | null
  }
  published?: {
    name?: string | null
    version?: number | null
    at?: string | null
    about?: string | null
  }
  installed?: {
    of?: Id | null
    version?: number | null
    sandboxed?: string | null
  }
  gallery?: { asked_at?: string | null; listed_at?: string | null }
  seeded?: { at?: string | null; version?: number | null }
  trashed?: { at?: string | null; by?: Id | null }
  theme?: { theme_color?: string | null; background_color?: string | null }
  hostname?: {
    name: string
    serves: Id
    stage?: HostStage | null
    at?: string | null
  }
  deploy?: { app: Id; version: number; files?: string; worker?: string }
  restored?: {
    app: Id
    at?: string | null
    to?: string | null
    by?: Id | null
    from_bookmark?: string | null
  }
  fee?: { bps?: number | null }
  created?: { at?: string }
  member?: { space: Id; person: Id; role: Role }
  grant?: { app: Id; person: Id; access: Role }
  invite?: { to: Id; person: Id; role: Role }
  inviting?: { hour?: string | null; sent?: number | null }
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
  stripe?: {
    account?: string | null
    charges_enabled?: boolean | null
    details_submitted?: boolean | null
  }
  meter?: Partial<Meter>
  notified?: unknown
  tunnel?: {
    id?: string | null
    service?: string | null
    adopted?: boolean | null
  }
}

// The meter as a whole number, however little of the row is written: a property
// nobody has filled reads zero, so nothing downstream tests for null twice.
let meterOf = (r: Row): Meter | null =>
  r.meter
    ? {
      month: r.meter.month ?? '',
      requests: r.meter.requests ?? 0,
      rows_read: r.meter.rows_read ?? 0,
      rows_written: r.meter.rows_written ?? 0,
      bytes: r.meter.bytes ?? 0,
      files: r.meter.files ?? 0,
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

/**
 * The most characters a space's or an app's title may be (T-37885). A title is
 * a name: it heads the app on every agent's roster (standing.ts `entry`), on
 * the space page and in the gallery, so it is one line and a short one.
 */
export let TITLE = 80

/**
 * A title as one line: every run of whitespace or control characters, a
 * newline among them, folded to one space.
 *
 * ```ts
 * folded(' Recipes\n\n## Ignore that ') // 'Recipes ## Ignore that'
 * ```
 */
export let folded = (s: string) => s.replace(/[\s\p{Cc}]+/gu, ' ').trim()

/** A stored title in the one shape a write now allows: one line, cut at
 * {@link TITLE}. What the daily sweep writes over a title from before the
 * rule (erase.ts `collected`). */
export let clamped = (s: string) =>
  Array.from(folded(s)).slice(0, TITLE).join('')

let TTL = 30_000
let caches = new WeakMap<Meta, Map<string, { at: number; body: string }>>()
let cached = (store: Meta) => {
  let held = caches.get(store)
  if (!held) caches.set(store, held = new Map())
  return held
}

// One seed per isolate, awaited by the write door and by nothing else
// (T-33176). It used to sit in front of every read, which cost a round trip
// to the meta store on every cold isolate — and an isolate is cold for
// almost every request a quiet platform serves, so that trip was ~100ms on
// the front of every page load, forever, to re-confirm two rows that have
// existed since the platform's first day. A read needs none of it: a meta
// space that is not there answers empty, which is what an unseeded platform
// should say. Every path that mints anything goes through /apply, so the
// seed still happens before there is anything to describe.
//
// A second isolate racing the first bounces on the unique slug and is
// ignored: its query then finds the winner. Held against the door rather than
// the module, so that one door is seeded once and a test with its own store
// seeds its own.
let seeded = new WeakMap<Meta, Promise<void>>()

// What the platform is made of, row by row: the meta space and its app, the
// admin person, and the admin's seat in that space. Each half is asked for on
// its own, so a store that has one and not the other — production, seeded
// before the admin existed; a kernel where the admin signed in before the
// first directory write minted its person (signin.ts `personOf` goes straight
// at the store) — is completed rather than left as it is. Two round trips at
// most, once per isolate, on a write.
let seed = async (store: Meta) => {
  let [[space], [admin]] = await Promise.all([
    store.query(`.space.slug=${META.space}`),
    store.query(`.person&.email.address=${ADMIN}`),
  ])
  let batch: Bundle[] = []
  if (!space) {
    batch.push({
      entity: { eid: '$space' },
      doc: { title: META.space },
      space: { slug: META.space },
    }, {
      entity: { eid: '$app' },
      doc: { title: META.app },
      // The one app whose handle is not minted (`handle`): the meta store is
      // the object this very row is being written into, and it has been called
      // `yak/platform` since the platform's first day. Said outright rather
      // than left to the backfill, which would only ever arrive at the same
      // string by a longer road.
      app: { slug: META.app, space: '$space', store: META_STORE },
    })
  }
  if (!admin) {
    batch.push({
      entity: { eid: '$admin' },
      person: {},
      email: { address: ADMIN },
    })
  }
  // Nothing can hold a seat that was minted a line ago, so the seat is only
  // ever asked about when both ends already existed.
  let seat = space && admin &&
    (await store.query(
      `.member.space=${space.entity.eid}&.member.person=${admin.entity.eid}`,
    )).length
  if (!seat) {
    batch.push({
      entity: { eid: '$seat' },
      // Owner: the gate on every platform act is a seat in `yak` and the role
      // it names — the fee is set by an owner of it (sell.ts `fees`), and the
      // meter and a sale answer to the same authority.
      member: {
        space: space ? space.entity.eid : '$space',
        person: admin ? admin.entity.eid : '$admin',
        role: 'owner',
      },
    })
  }
  if (batch.length) await store.apply(batch)
}

let notFound = () => new Response('not found', { status: 404 })

// A read that must not be a moment old, asked for by the caller. The cache
// above is per-isolate and 30 seconds wide, which is exactly the window a
// deploy opens: the isolate serving the app has not heard of the bump the
// deploy just made, so the first break after one named the version before it
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
// store below it is a graph, so the envelope is opened here, the bundles go on
// as they are, and the batch as applied comes back (meta.ts). `over` names the
// store the door speaks to, which is the seam a test drives a whole directory
// against.
export let over = (store: Meta) => async (req: Request): Promise<Response> => {
  let cache = cached(store)
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
      return Response.json(applied)
    } catch (e) {
      caught(e, { request: 'directory /apply' })
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
    caught(e, { request: 'directory /query' })
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
  cached(metaStore(env)).clear()
}

// A listing carries the components the filter names (@yaks/graph `wanted`),
// so every read here asks for what it reads: a space with its title, plan and
// meter, an app with its title, the address its store is named by, and its
// meter. `.eid=` names no component and answers the whole bundle, which is why
// those are bare.
// What every read of an app asks for beside the app row itself, in one place
// because `appOf` reads all of it and a filter that forgets one answers null
// where there is a value.
let ABOUT = '?doc&?former&?home&?meter&?published&?installed&?gallery&?seeded' +
  '&?trashed&?theme'

// And what every read of a space asks for, for the same reason.
let SPACE_ABOUT = '?doc&?plan&?meter&?notified&?trashed&?stripe&?fee&?former' +
  '&?tunnel'

// The plan as a whole row, however little of it is written: a property nobody
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

// The seller's row, or null where nothing has ever connected. An account with
// neither word yet — minted a second ago, the webhook not in — reads false on
// both, which is the truth: nothing may be sold through it until Stripe says
// so.
let stripeOf = (r: Row): Stripe | null =>
  r.stripe?.account
    ? {
      account: r.stripe.account,
      chargesEnabled: !!r.stripe.charges_enabled,
      detailsSubmitted: !!r.stripe.details_submitted,
    }
    : null

// The tunnel, or null where no machine is: a row missing either id names
// nothing a worker could bind to.
let tunnelOf = (r: Row): Tunnel | null =>
  r.tunnel?.id && r.tunnel.service
    ? {
      id: r.tunnel.id,
      service: r.tunnel.service,
      adopted: !!r.tunnel.adopted,
    }
    : null

let spaceOf = (r: Row): Space => ({
  eid: r.entity.eid,
  slug: r.space!.slug,
  title: r.doc?.title || r.space!.slug,
  tier: tierOf(r.space!.slug, r.plan?.tier ?? null),
  plan: planOf(r),
  stripe: stripeOf(r),
  fee: r.fee?.bps ?? 0,
  meter: meterOf(r),
  told: r.notified != null,
  trashed: trashedOf(r),
  slugs: slugsOf(r.former),
  tunnel: tunnelOf(r),
})

export let appOf = (r: Row): App => ({
  eid: r.entity.eid,
  slug: r.app!.slug,
  space: idOf(r.app!.space),
  version: r.app!.version,
  access: r.app!.access ?? null,
  title: r.doc?.title || r.app!.slug,
  store: r.app!.store ?? null,
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
  installed: r.installed
    ? {
      of: r.installed.of ? idOf(r.installed.of) : null,
      version: r.installed.version ?? 0,
      sandboxed: r.installed.sandboxed || null,
    }
    : null,
  gallery: r.gallery
    ? {
      askedAt: r.gallery.asked_at ?? '',
      listedAt: r.gallery.listed_at ?? '',
    }
    : null,
  seeded: r.seeded
    ? { at: r.seeded.at ?? '', version: r.seeded.version ?? 0 }
    : null,
  trashed: trashedOf(r),
  theme: r.theme
    ? {
      themeColor: r.theme.theme_color ?? null,
      backgroundColor: r.theme.background_color ?? null,
    }
    : null,
})

let hostOf = (r: Row): Host => ({
  eid: r.entity.eid,
  name: r.hostname!.name,
  serves: idOf(r.hostname!.serves),
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

// One restore of an app's store, as recover.ts reads it (T-34507). `from` is
// the bookmark the store stood at before this one moved it, which is the way
// back out of it if the recovery itself turns out to be the mistake.
export let restoreOf = (r: Row) => ({
  eid: r.entity.eid,
  at: r.restored!.at ?? '',
  to: r.restored!.to ?? '',
  by: r.restored!.by ? idOf(r.restored!.by) : '',
  from: r.restored!.from_bookmark ?? '',
})

// A Durable Object cannot be renamed, so an app's store must not be named by
// anything a person may change: renaming `recipes` to `cookbook` would strand
// every recipe in it. The name is therefore the app's own handle, written once
// at birth (`handle` below) and read back here — never derived from a slug.
// The fallback is the answer for an app the backfill has not reached
// (migrate.ts `handled`), which is what the app was already named before the
// property existed; it fires for nobody after the directory's first request of
// the deploy.
export let storeName = (space: Space, app: App) =>
  app.store ?? `${space.slug}/${app.slug}`

/**
 * The handle app_new writes, and what a rename — of the app or of its space —
 * must therefore leave alone: the address it was born at, plus a short key off
 * its eid so the string is the app's and not the address's (T-34657).
 *
 * The key is a suffix because the dashboard sorts by the string: `ada/cookbook
 * .1f7c` still reads as ada's cookbook and still sits beside her other apps,
 * which is the whole reason the handle is legible at all rather than a bare
 * eid. Jeff: "i *do* like being able to see these names in the cloudflare
 * dashboard".
 *
 * Six hex off the eid's tail (a uuid v4's last twelve are random), which is
 * unique enough that there is no collision branch here — the unique index on
 * `app.store` is what decides it if the impossible happens, the way every other
 * race in this directory is decided.
 */
export let handle = (space: Pick<Space, 'slug'>, slug: string, eid: string) =>
  `${space.slug}/${slug}.${eid.replaceAll('-', '').slice(-6)}`

// The door onto one app's store, told which app it holds and what this
// directory says its access mode is (T-33813). A store keeps both (graph.ts
// `#learn`) and answers @yaks/member's questions with them, so every caller
// that has an App in hand opens its store this way; the ones that only have a
// name — the meta store, the usage sweep — have no app to name and use
// `storeOf` directly.
export let appStore = (
  ns: Namespace,
  space: Space,
  app: App,
  env: HostEnv = {},
): Door =>
  storeOf(ns, storeName(space, app), {
    eid: app.eid,
    access: app.access,
    mail: mailbox(space, app, env),
  })

// The other address a (space, app) has, beside {@link url}: what its letters
// leave from, and what a reader writes back to (post.ts `mailFrom`, T-33686).
// The home app's is the bare space name, for the same reason its page is the
// bare hostname. Derived here and carried to the store on every request,
// because the store is named at birth and knows neither the app's current slug
// nor which app the space's front page is.
export let mailbox = (space: Space, app: App, env: HostEnv = {}) =>
  mailFrom(space.slug, app.home ? null : app.slug, env)

// The address a person is handed for an app. A space's front page is its
// bare hostname (T-33040, apps.ts `fetch`) — its own `/<app>/` only forwards
// there — so every answer that hands out a link hands out the one to hold.
// The app must be the one read back after the caller's own write, or a tool
// that just moved the front page reports the address it had before. It lives
// here beside the store's name because it is the other name a (space, app)
// has, and everything that says one out loud reads it from one place: the
// tools, and the letter that names what deleting a space would destroy
// (erase.ts).
export let url = (space: Space, app: App, env: HostEnv = {}) =>
  `https://${spaceHost(env, space.slug)}/` + (app.home ? '' : `${app.slug}/`)

/**
 * Moving the front page, as the bundles that do it (T-34227): the word comes
 * off the app that had it and goes on the one that gets it, in whatever batch
 * the caller is already writing, so the space is never for one moment a space
 * with two front pages or none it did not ask for.
 *
 * This is where "at most one home app per space" lives. The vocabulary would
 * say it if it could — `unique` is over one component's own properties, and
 * `home` has no space of its own to pair with (vocab.ts) — so the rule is the
 * directory's, and it is one function rather than a paragraph in each caller.
 *
 * `was` is the app wearing `home` now (`dir.home`), `onto` the one that should
 * wear it, or null to leave the space with no front page. `first` rides along
 * when the same call also set the globs, since they are properties of this
 * word.
 */
export let homing = (
  was: App | null,
  onto: App | null,
  first?: string[] | null,
): Bundle[] => [
  // `home: null` drops the whole component, globs and all: an app that is not
  // the front page routes nothing first, so there is no property left to keep.
  ...(was && was.eid != onto?.eid
    ? [{ entity: { eid: was.eid }, home: null }]
    : []),
  ...(onto
    ? [{
      entity: { eid: onto.eid },
      home: first == null
        // A patch with no properties: an app already home keeps the globs it
        // had.
        ? {}
        : { first: first.length ? JSON.stringify(first) : null },
    }]
    : []),
]

/**
 * An address history as the two properties that hold it: the head in `slug`,
 * the rest in `slugs`, oldest first — `former` written the way types.ts
 * `slugsOf` reads it. An app wears one and so does a space (T-34658).
 *
 * The whole record every time rather than a patch of one property, because a
 * single call may both leave an address and forget another (T-34659), and two
 * patches of one history disagree about what the history is. A history that has
 * emptied clears both properties, which is a row that redirects from nowhere.
 */
export let addresses = (had: string[]) => ({
  slug: had[0] ?? null,
  slugs: had.slice(1).join(' ') || null,
})

// The typed client over the handler, in-process or across a binding.
export type Directory = ReturnType<typeof directory>

// `now` makes every read of this client a fresh one (FRESH above): the agent
// tier asks for it, because a tool answers right after a tool wrote, and the
// cache is per-isolate — `app_versions` straight after `app_rollback` still
// marked the version before it live (C-32905 item 5). Page traffic keeps the
// cache; an agent's answer never disagrees with the write it just made.
export let directory = (via: Fetcher, now = false) => {
  // The whole filter line as one parameter, values written raw: the door
  // hands it to the graph as the query it is (meta.ts), rather than each
  // caller escaping the pieces of a search string.
  let query = async (q: string, fresh = now): Promise<Row[]> => {
    let r = await via.fetch(
      new Request(
        `http://directory/query?q=${encodeURIComponent(q)}`,
        fresh ? { headers: { [FRESH]: '1' } } : {},
      ),
    )
    if (!r.ok) throw await answered(r)
    return r.json()
  }
  let one = async (q: string, fresh = now) => (await query(q, fresh))[0]
  // Named, because two of the questions below are asked in terms of the
  // others: a person's own space is read, minted, and read back.
  let self = {
    // A write that changes the directory: a batch of bundles, each minting at
    // an eid its author chose (T-32455), answered as applied.
    apply: async (
      mutation: { entities: Bundle[] },
      headers: Record<string, string> = {},
    ): Promise<Bundle[]> => {
      let r = await via.fetch(
        new Request('http://directory/apply', {
          method: 'POST',
          body: JSON.stringify(mutation),
          headers,
        }),
      )
      if (!r.ok) throw await answered(r)
      return r.json()
    },
    space: async (slug: string) => {
      let row = await one(`.space.slug=${slug}&${SPACE_ABOUT}`)
      return row ? spaceOf(row) : null
    },
    // A subdomain the space has left, still pointing at it (T-34658) — what
    // `former` is to an app, one level up. Asked only after `space` has
    // answered nobody, so a space is never found by an address it still lives
    // at: what is at an address and what redirects to it are two questions,
    // and this is only the second. One query over the spaces that have ever
    // moved, which is a handful of rows and never grows with the platform.
    formerly: async (slug: string) => {
      let space = (await query(`.former&.space&${SPACE_ABOUT}`))
        .map(spaceOf)
        .find((s) => s.slug != slug && s.slugs.includes(slug))
      return space ?? null
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
    // An address the app has left, still pointing at it. A rename moves
    // `app.slug` and keeps the old address in the app's `former`, so the answer
    // is the app of this space that still answers to the address asked for —
    // a move to follow (T-32576: a rename used to strand every open page).
    former: async (space: Space, slug: string) => {
      let app = (await self.apps(space))
        .find((a) => a.slug != slug && a.slugs.includes(slug))
      return app ?? null
    },
    // Every app in a space, oldest first — the order they were made. Many
    // spaces is one read rather than one per space, because a person's whole
    // listing is one question (tools.ts `app_list`, T-35431); the answer is
    // still one flat list, and a caller wanting them per space groups by
    // `app.space`.
    apps: async (space: Space | Space[]): Promise<App[]> => {
      let eids = [space].flat().map((s) => s.eid)
      if (!eids.length) return []
      return (await query(`.app.space=${eids.join(',')}&${ABOUT}`)).map(appOf)
    },
    // The space that pays as this Stripe customer (billing.ts). It is how a
    // subscription event is attributed when its metadata does not say — a
    // space keeps one customer for its whole life, so the answer is one space
    // or nobody.
    payer: async (customer: string) => {
      let row = await one(
        `.plan.customer=${customer}&.space&${SPACE_ABOUT}`,
      )
      return row?.space ? spaceOf(row) : null
    },
    // The space that sells through this connected Stripe account (sell.ts).
    // The Connect webhook's only way in: an event from a connected account
    // names the `acct_…` and nothing of ours, so this is what turns it back
    // into a space. One account per space, so the answer is one space or
    // nobody — and nobody is an event about somebody else's platform, or one
    // for a space that has since disconnected.
    seller: async (account: string) => {
      let row = await one(
        `.stripe.account=${account}&.space&${SPACE_ABOUT}`,
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
    // What a hostname someone else owns is aimed at (T-33037, T-34596): the
    // hostname row, the space it opens, and the app when it opens one app
    // rather than the whole space — `app` null is the space form, which is the
    // difference index.ts `aimed` routes by. One hostname, one place, which the
    // unique index on `hostname.name` is what makes true. Null for a hostname
    // the platform has never been given, which is every hostname until someone
    // attaches one — and is what keeps an unknown host routing exactly as it
    // always did. Cached like every other read here, and an empty answer is not
    // cached, so a domain serves the moment it is attached rather than a TTL
    // later.
    serves: async (host: string) => {
      let row = await one(`.hostname.name=${host}`)
      if (!row?.hostname) return null
      let eid = idOf(row.hostname.serves)
      let aimed = hostOf(row)
      let at = await self.appAt(eid)
      if (at) return { space: at.space, app: at.app as App | null, host: aimed }
      let space = await self.at(eid)
      return space ? { space, app: null, host: aimed } : null
    },
    // Every domain of this space (T-33038), oldest first: the ones aimed at the
    // space itself and the ones aimed at an app of it. One query over the whole
    // table, which is exactly the platform's custom hostname count, where one
    // per app would be several.
    hosts: async (space: Space): Promise<Host[]> => {
      let mine = new Set([
        space.eid,
        ...(await self.apps(space)).map((a) => a.eid),
      ])
      return (await query('.hostname')).map(hostOf)
        .filter((h) => mine.has(h.serves))
    },
    // The app offered under a platform-wide name (T-32888), with the space it
    // came from — an offer is an app, so this is one row read two ways.
    offered: async (name: string) => {
      let row = await one(`.published.name=${name}&.app`)
      return row?.app ? await self.appAt(row.entity.eid) : null
    },
    // Every offer standing, newest first — what a person's agent browses.
    offers: async (): Promise<{ space: Space; app: App }[]> => {
      let rows = (await query(`.published&.app&${ABOUT}`)).map(appOf)
        .filter((a) => a.published)
        .sort((a, b) => b.published!.at.localeCompare(a.published!.at))
      let out: { space: Space; app: App }[] = []
      for (let app of rows) {
        let space = await self.at(app.space)
        if (space) out.push({ space, app })
      }
      return out
    },
    // Every deploy of an app, newest first — the versions app_versions pages
    // through, app_rollback picks from, and the retention sweep marks live
    // bytes off (versions.ts). None is ever buried, so this grows with the
    // app; a manifest is a few hundred bytes and git derives its commit chain
    // from them (D-34942). Never cached: a deploy reads its own versions back
    // the moment it writes one.
    deploys: async (app: App) =>
      (await query(`.deploy.app=${app.eid}&?created`, true))
        .map(deployOf)
        .sort((a, b) => b.version - a.version),
    // Every time this app's store was put back to a moment, newest first
    // (recover.ts, T-34507). Never cached, for the reason `deploys` is not: a
    // restore reads its own trail back the moment it writes to it.
    restores: async (app: App) =>
      (await query(`.restored.app=${app.eid}`, true))
        .map(restoreOf)
        .sort((a, b) => b.at.localeCompare(a.at)),
    // Every space there is. Only the meter asks this (usage.ts): a tool
    // always works in one space, and a person only ever sees their own.
    all: async (): Promise<Space[]> =>
      (await query(`.space&${SPACE_ABOUT}`)).map(spaceOf),
    // The app that answers the space's bare hostname, if it has one: the one
    // in this space wearing `home` (T-34227). At most one does — `homing`
    // below is the rule — so the first row is the answer.
    // A trashed app is nobody's front page (erase.ts, T-34430): the word
    // stays on it so a restore puts the space back exactly as it was, and
    // until then the space is one with no front page — which is the ordinary
    // state and already has an answer everywhere.
    home: async (space: Space) => {
      let rows = await query(`.app.space=${space.eid}&.home&${ABOUT}`)
      return rows.filter((r) => r.app).map(appOf).find((a) => !a.trashed) ??
        null
    },
    // A person's membership row: the eid, so an invite can revise or remove
    // the one that stands, and the role, which is the same question asked
    // shorter.
    member: async (space: Space, person: string) => {
      // Nobody is a member of nothing. An empty person is a caller who has not
      // signed in (anon.ts), and it must never be asked: `.member.person=`
      // reads as that property being absent, which is a question that could
      // answer yes and hand a stranger a seat.
      if (!person) return null
      let row = await one(
        `.member.space=${space.eid}&.member.person=${person}`,
      )
      return row?.member ? { eid: row.entity.eid, role: row.member.role } : null
    },
    role: async (space: Space, person: string) =>
      (await self.member(space, person))?.role ?? null,
    // What one person holds on one app, by a grant rather than a seat
    // (T-37615): a guest invited to this app and nothing else in the space.
    // The same guard as `member` — an empty person is a caller who has not
    // signed in, and `.grant.person=` would read as that property being absent
    // and hand a stranger somebody's grant.
    grant: async (app: App, person: string) => {
      if (!person) return null
      let row = await one(`.grant.app=${app.eid}&.grant.person=${person}`)
      return row?.grant
        ? { eid: row.entity.eid, access: row.grant.access }
        : null
    },
    // The invitation standing for this person on a space or an app (invite.ts,
    // T-37880): the eid, so asking again revises the one that stands, and the
    // role it offers. The same guard as `member`.
    invite: async (to: string, person: string) => {
      if (!person) return null
      let row = await one(`.invite.to=${to}&.invite.person=${person}`, true)
      return row?.invite ? { eid: row.entity.eid, role: row.invite.role } : null
    },
    // One invitation by the eid its letter carries. Fresh, because the click
    // that accepts it is often the second one on the same letter.
    invitation: async (eid: string) => {
      let row = await one(`.eid=${eid}`, true)
      return row?.invite
        ? {
          eid: row.entity.eid,
          to: idOf(row.invite.to),
          person: idOf(row.invite.person),
          role: row.invite.role,
        }
        : null
    },
    // How many invitations this person has sent in the hour it names. Fresh:
    // two invitations a second apart must not both read the same count.
    inviting: async (person: string) =>
      (await one(`.eid=${person}`, true))?.inviting ?? null,
    // Everyone in a space, by person eid — who to tell when an app's tools
    // move (declared.ts `toolsChanged`), since reaching the app is exactly
    // being in the space.
    members: async (space: Space): Promise<string[]> =>
      (await query(`.member.space=${space.eid}`))
        .map((r) => r.member && idOf(r.member.person))
        .filter((p): p is string => !!p),
    // Who owns a space, by person eid: so removing a member can refuse to
    // leave it with none, and so a free space's spending is read against its
    // owners' allowance (meter.ts `pooled`).
    owners: async (space: Space): Promise<string[]> =>
      (await query(`.member.space=${space.eid}&.member.role=owner`))
        .map((r) => r.member && idOf(r.member.person))
        .filter((p): p is string => !!p),
    // Who is at an address, if the platform has met them. signin.ts's
    // `personOf` asks this same question and mints when the answer is
    // nobody, which is how an invited person's later sign-in finds the row
    // the invite made.
    personAt: async (email: string) =>
      (await one(`.person&.email.address=${email}`))
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
    spaces: async (person: string, role?: Role): Promise<Space[]> =>
      (await self.seats(person, role)).map((s) => s.space),
    // The same question with the seat kept: what the person is in each space,
    // which the membership read already answered. Asking `role` back per space
    // afterwards was a second read for a row this one held, and reading the
    // spaces one eid at a time was a third per space — three spaces cost eight
    // round trips where the whole answer is three (T-35431).
    seats: async (
      person: string,
      role?: Role,
    ): Promise<{ space: Space; role: Role }[]> => {
      // A filter resolves an eid to an entity, so a person the meta store has
      // never seen — someone who signed in before it kept a row — makes the
      // question itself unanswerable. No row, no memberships. Nobody at all
      // (an empty person, `member` above) belongs to nothing either.
      if (!person || !(await one(`.eid=${person}`))) return []
      let members = await query(
        `.member.person=${person}${role ? `&.member.role=${role}` : ''}`,
      )
      let held = new Map<string, Role>()
      for (let m of members) {
        if (m.member) held.set(idOf(m.member.space), m.member.role)
      }
      if (!held.size) return []
      // Bare `.eid=` and nothing else: naming components would project the row
      // down to them, and a space is read whole ({@link spaceOf}).
      let rows = await query(`.eid=${[...held.keys()].join(',')}`)
      return rows
        .filter((r) => r.space && r.space.slug != META.space)
        .map((r) => ({ space: spaceOf(r), role: held.get(r.entity.eid)! }))
    },
    // The next free variant of a derived name: the name itself, else
    // numbered until nothing answers to it. What `own` mints, and what the
    // sign-in card offers a person before it does (T-32967).
    free: async (base: string) => {
      let slug = base
      for (
        let n = 2;
        RESERVED.has(slug) || await self.space(slug);
        n++
      ) slug = `${base}${n}`
      return slug
    },
    // The person's own space, minted the moment they first need one — at
    // sign-in, or at the first tool call by someone who signed in before this
    // existed (T-32482). Theirs is a space they own — the one their address
    // names, if they own it, else the first they own — and being a member of
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
      let chosen = !!want && SLUG.test(want) && !RESERVED.has(want) &&
        !await self.space(want)
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
    // Whether anybody at all holds a seat here — what identity.ts asks of the
    // meta space, so the first person ever to sign in owns the platform. The
    // admin's own seat is the seed's (`seed` above), not somebody claiming the
    // platform, so it does not answer that question: two rows are proof
    // somebody else is here, one row has to be looked at.
    memberless: async (space: Space) => {
      // Admission cannot use a cached vacancy: sign-in writes the first seat
      // directly to meta, and another isolate's cache would not hear even a
      // directory write. A later sign-in must not mint a second owner seat.
      let seats = await query(`.member.space=${space.eid}&.limit=2`, true)
      if (seats.length != 1) return !seats.length
      let seat = seats[0].member
      return !!seat && idOf(seat.person) == await self.personAt(ADMIN)
    },
  }
  return self
}
