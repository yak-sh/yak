import type { ByDay } from '@yaks/ui/chart'
import { christened, pick } from '@yaks/persona'
import { calledOf } from './operator-name.ts'
import {
  EPOCH,
  MEND,
  READS,
  servingDirectory,
  type ServingDirectoryOptions,
} from './directory-copy.ts'
// The directory part (D-32318 §The meta-space): spaces, apps, and members
// are entities in the meta-space's store — the Store object named
// yak/platform, a graph on the platform's own vocabulary (vocab.ts
// `platformDocs`, T-33814) — and this handler is that store's door,
// `GET /query?q=<filter line>` and `POST /apply`, bundles in and entity JSON
// out. No shape of its own: a caller in this Worker and a caller across a
// service binding ask the same question, and `directory(fetcher)` below is the
// typed client that phrases the ones the kernel asks (a space by slug, an app
// in it, its home, a person's role) and writes the ones that change it (a
// space born, an app born, a deploy). meta.ts is the store below it.
//
// Non-app answers are cached per store in private Maps, with a 30-second TTL
// rather than the Cache API: a resolution is a few hundred bytes, the Cache
// API is per-colo anyway and wants a synthetic Request as its key, and a Map
// costs nothing to reason about; a rename shows within the TTL. An empty
// answer is never cached, so an app is served the moment it is created. The
// write door is here for that cache: a directory write empties it, so the
// space whose home app was just named answers its own hostname at once
// rather than a TTL later. A write that goes around this door — the generic
// graph tier aimed at (yak, platform) — is seen within the TTL like any
// change made elsewhere. App rows select Store declarations, so they are
// always read fresh. The cache is this part's own — no other module reads it.
// The meta space seeds itself on first touch (space `yak`, app `platform`),
// written as bundles through the store's /apply, so the directory can describe
// its own store.
import { knownOptions } from '@yaks/graph/errors'
import type { Reload } from '@yaks/platform'
import type { Comp } from '@yaks/platform/comp'
import { type Host as HostEnv, spaceHost } from '@yaks/platform/host'
import { type Upstream, upstreamOf } from '@yaks/platform/upstream'
import type { Actor, Bundle, Tx } from '@yaks/graph'
import { type Listed, listing } from '@yaks/connections/integrations'
import { integrationEid } from '@yaks/connections/identity'
import { identityEid, minted } from '@yaks/graph/identity'
import type { Rec } from './domains.ts'
import { type Fetcher, STATIC_QUERY, storeOf } from './door.ts'
import { type Door, type Namespace } from '@yaks/durable-object/door'
import { PLATFORM_STORE, SLUG } from '@yaks/platform/names'
import { ADMIN } from '@yaks/platform/bots'
import {
  ambient,
  forget,
  recall,
  type Tally,
  writing,
  wrote,
} from './lib/hops.ts'
import { refusal } from '@yaks/api/refuse'
import { CallError } from '@yaks/tools/errors'
import {
  answered,
  KERNEL,
  type Meta,
  meta as metaStore,
  written,
} from './meta.ts'
import { caught, refusing } from './defects.ts'
import { mailFrom } from './post.ts'
import { payments } from './config.ts'
import { firstOf } from './router.ts'
import { nameOf } from './names.ts'
import type { Texting } from './operator-texts.ts'
import type { Alerting } from './operator-alerts.ts'
import type { Subscription } from '@yaks/push'
import type { Row as GrantRow } from './grant-rows.ts'
import { principals, type Stamp, stampOf, writers } from './stamps.ts'
import { instrumentEid } from './instrument.ts'

// The slugs no space or app may take, because at `<slug>.yaks.app` and at
// `<slug>@yaks.app` (post.ts `mailFrom`) they would read as the platform
// speaking (T-37886): a sign-in page at `login.yaks.app`, a letter from
// `security@yaks.app`. The doors that mint an address check it (tools.ts
// `fresh`, `free` and `own` here, identity.ts `choose`); an address already
// held keeps working. `yak` is the platform's own space (`META`), and
// `origin` and `saas` its custom-hostname origin (@yaks/platform/routes `ORIGIN`).
// `sha` and `git` are the platform's own key prefixes in the files bucket
// (versions.ts `SHA`, gitobj.ts `BODY`): a space's files are kept under its
// slug, so a space by either name would share storage with the platform's.
// The payment provider's name is its doors' prefix (config.ts `payments`,
// payment-doors.ts), so a space by that name would read as the provider.
export let RESERVED = new Set([
  payments.via,
  'abuse',
  'account',
  'accounts',
  'admin',
  'administrator',
  'api',
  'app',
  'apps',
  'auth',
  'billing',
  'cf-bounce',
  'checkout',
  'connect',
  'dashboard',
  'docs',
  'email',
  'git',
  'hello',
  'help',
  'hostmaster',
  'login',
  'logout',
  'mail',
  'manage',
  'mcp',
  'mx',
  'no-reply',
  'noreply',
  'oauth',
  'official',
  'origin',
  'password',
  'pay',
  'payment',
  'payments',
  'postmaster',
  'pricing',
  'privacy',
  'root',
  'saas',
  'secure',
  'security',
  'settings',
  'sha',
  'sign-in',
  'sign-up',
  'signin',
  'signup',
  'staff',
  'status',
  'support',
  'system',
  'terms',
  'verify',
  'webmaster',
  'www',
  'yak',
  'yaks',
])

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
  // GraphQL invocation requests include hibernated WebSocket messages.
  requests: number
  // All inbound messages, and the subset included in `requests`. Older rows
  // without them remain conservative until the next hourly reading.
  ws_messages?: number
  ws_hibernated?: number
  rows_read: number
  rows_written: number
  bytes: number
  // An app's page views over the last 30 days, no month's figure.
  visits?: number
  // Stored R2 bytes, independent of the calendar month; absent before rollout.
  files?: number
  emails: number
  // Monthly builder usage. `built` keeps a lifetime total for usage reporting;
  // both plans enforce their build allowance against the monthly `builds`.
  builds: number
  // Dollars spent on models this month: the builder's and the apps' calls,
  // each weighed by its model's price (models.ts).
  models: number
  // Dollars an app's voices received this month (rtc.ts): Cloudflare
  // Realtime's egress, weighed at each renewal of a session's lease. It spends
  // the same space budget as `models` (meter.ts `budgets`).
  realtime: number
  // Dollars an app's texts cost this month (app-texts.ts), the same budget.
  texts?: number
  // The seconds the builder's workbench spent awake (sandbox.ts, T-34264).
  // Its own property beside `models` because a model call and a
  // container-second are billed separately, and one number made of both is a
  // number nobody can add up.
  seconds: number
  built: number
  // Every dollar models, voice and texts have spent here, all months
  // together: what the starter is drawn against (meter.ts `starterOf`).
  drawn?: number
  // The dollars of models, voice and texts this month that were spent for
  // the space's apps' visitors, already counted in each source's own.
  visitors?: number
  // The dollars of models, voice and texts this month that the platform's
  // owner refunded (budget.ts): off what the month spent and off `drawn`,
  // while each source's own still says what it cost.
  refunded?: number
  // The dollars of models, voice and texts this month past the space's
  // budget, drawn from its credit (meter.ts `credited`).
  credit?: number
  at: string
}
export type Tier = 'free' | 'plus' | 'pro'

/** Whether a tier is paid for: the Plus plan or the Pro plan
 * (D-134567). Every paid feature asks this, never one plan's name. */
export let paid = (tier: Tier | null | undefined) =>
  tier == 'plus' || tier == 'pro'

// Spaces the platform comps. `yak` holds its own directory, whose requests
// serve every space. `yourname` is its shopfront, with the example apps every
// home page links to. Neither has app/data or visitor ceilings (meter.ts
// `ceilings`); platform traffic must not shut the directory's public doors.
//
// These two platform spaces keep their unlimited app/data/visit exemption.
// Operational comps are stamped comp{tier, reason, by} rows, managed through
// the platform-only comp.ts door independently of Stripe's subscription.
export let COMPED = ['yourname', 'yak']

// Paid features and mail/build allowances: `plus` also applies to comps.
// Their separate app/data exemption is resolved by meter.ts from COMPED.
// A space given the Plus plan free until a day (`comped`, a month for each
// person its owner invited who built an app, referral.ts) is on it until then.
export let tierOf = (
  slug: string,
  tier: Tier | null,
  comped: string | null = null,
  now = Date.now(),
  comp?: Comp | null,
): Tier | null => {
  let base = COMPED.includes(slug)
    ? 'plus'
    : !paid(tier) && comped && Date.parse(comped) > now
    ? 'plus'
    : tier
  return comp?.tier == 'pro' || base == 'pro' ? 'pro' : comp?.tier ?? base
}

// What a space pays and what the payment provider knows about it (platform.rs
// `Plan`, billing.ts derives and writes it). The whole row, because the webhook
// reads every property of it to decide whether an event is news: `at` is the
// moment of the provider's event that last wrote this, `status` is the
// provider's own word, and
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

/** A space's AI credit (D-134567, meter.ts `creditOf`): the cap its owner
 * set on a month past its budget, and every dollar of it bought and spent,
 * so what was not spent carries to the next month. */
export type Credit = { cap: number; bought: number; spent: number }

/** A space's connected account, as the directory holds it (sell.ts). Four
 * properties and no more: the merchant's own books are their provider's, and
 * the platform keeps only which provider it is (`via`), the id every call
 * names them by and the provider's two answers on whether they are ready —
 * `submitted` is "they finished the form", `ready` is "it will take money for
 * them", and the checkout door reads the second one alone. */
export type Seller = {
  via: string
  account: string
  ready: boolean
  submitted: boolean
}

/** The tunnel a space has to a machine (tunnel.ts, @yaks/tunnel): the tunnel
 * it dials out on, the Workers VPC Service the tunnel's gateway is bound to, and
 * whether the platform made the pair or only records one made elsewhere. */
export type Tunnel = { id: string; service: string; adopted: boolean }

export type Space = {
  eid: string
  slug: string
  // The space's handle: the root of every key it keeps in the bucket — its
  // apps' files, uploads, releases and declarations. Written once at birth
  // ({@link spaceHandle}) and never derived from the slug again, so a rename
  // moves an address and never a byte, and a space that later takes the old
  // name roots elsewhere (D-131924). A space from before the word wears its
  // slug, which is where its bytes already were (925e91572).
  store: string
  title: string
  // What its Operator is called (operator-name.ts).
  operator: string
  // The voice its Operator speaks in on a call (speech.ts `VOICES`), or none
  // for the provider's own.
  voice?: string | null
  // How fast its Operator speaks (speech.ts `PACES`), or none for Normal.
  voice_speed?: string | null
  // The model that answers its calls (speech.ts `setupOf`), or none for the
  // quickest on here.
  voice_model?: string | null
  // The larger model its talking model hands a hard request to, on the
  // provider's side (speech.ts `BACKENDS`), or none for its Operator.
  voice_backend?: string | null
  // How long, in seconds, its Operator's conversations ask the model's
  // provider to keep their cached prefix, or none for the provider's default.
  cache_retention?: number | null
  // The picture it wears in place of its first letter, or null for none.
  logo?: { sha: string; type: string } | null
  // Whether the platform features this space as a publisher (`featured`,
  // T-160642): everything it shares shows the mark.
  featured?: boolean
  sender?: import('@yaks/phone').Transport
  // What this space pays (D-32751). Null for a space the sweep has not
  // reached yet, which means free — the terms every space is on today.
  tier: Tier | null
  // The same row whole, for the one caller that needs every property of it
  // (billing.ts). Null where no `plan` row has ever been written.
  plan: Plan | null
  // Its AI credit, where its owner ever set a cap or bought any; null on
  // every other space, which spends nothing past its budget.
  credit?: Credit | null
  // The day the Plus plan given free runs through (`comped`, reward.ts),
  // past or to come; absent or null where none was ever given.
  comped?: string | null
  comp?: Comp | null
  // What this space sells through (sell.ts, T-34524): the connected account,
  // and whether its provider says it may take money yet. Null for a space
  // that has never asked to sell, which is almost all of them.
  seller: Seller | null
  // What the platform takes from a sale here, in basis points (sell.ts
  // `feeOf`). It is asked of one space — `yak`, the platform's own row — and
  // 0 on every other, where nobody has ever written one.
  fee: number
  // The space's monthly dollar budget for models and voice where the
  // platform's owner set one (budget.ts), in place of its plan's (meter.ts
  // `BUDGET`). Null on every space nobody has given one, which is almost all.
  budget: number | null
  // The site the box was given when it opened a build here, and when
  // (newcomer.ts `previewing`); null for every space no box was given an
  // address for, which is almost all of them.
  preview?: Preview | null
  // Whether that budget is a newcomer's one build (newcomer.ts `oneBuild`):
  // what lifts it is keeping the app, so its refusals ask for their email
  // rather than offering a plan (meter.ts `unkept`).
  newcomer?: boolean
  // The dollars this space holds once, before its monthly budget, where it
  // holds other than meter.ts `STARTER`: none for a person's later spaces
  // (`mint`). Absent on almost every space.
  starter?: number | null
  // The percent of that budget its apps' visitors may spend together, where
  // its owner set one (meter.ts `visiting`); none is meter.ts `VISITORS`.
  visitors?: number | null
  // The model calls one visitor may ask its apps for in a day, where its
  // owner set a number (meter.ts `visitorCalls`); none is meter.ts
  // `VISITOR_CALLS`.
  visitorCalls?: number | null
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
export type App = AppInfo & { policy: number }
/** A site rebuilt from its web address, and when the box was given it. */
export type Preview = { site: string; at: string }
let previewOf = (r: Row): Preview | null =>
  r.preview?.site ? { site: r.preview.site, at: r.preview.at ?? '' } : null
export type AppInfo = {
  /** A transient view may keep its graph within this store alone. */
  scope?: 'store'
  /** An internal mount for an isolated preview, never directory state. */
  mount?: string
  eid: string
  slug: string
  space: string
  version: number | null
  lenses?: Record<string, number>
  // A borrowed property can move this while the app's own files stay put.
  declaration?: string | null
  source?: string | null
  files?: string | null
  // Where its uploads are kept (blob-key.ts `blobPrefix`): written once at
  // birth with its store, so an app given a store it did not make keeps the
  // bytes that store names. Null where the mover has not reached the row.
  blobs?: string | null
  draft?: string | null
  fence?: string | null
  // The app's preview link (preview.ts), kept across deploys; its draft's
  // writes and its deploys are told to the link's pages.
  followed?: string | null
  script?: string | null
  // The worker its release built: empty when it built none, so a page asks
  // the dispatch namespace for nothing (dispatch.ts `called`); null where no
  // release recorded it, which asks.
  worker?: string | null
  title: string
  // Who may read and write its store (T-32504): 'public', 'open', or
  // 'private'. Every app is born with it said (`app_new`); a row without it is
  // read as 'private' and reported (`appOf`), since a lost row must lock an
  // app, never open it.
  access: Access
  // The app's handle: the name of everything the platform keeps for it — its
  // Durable Object, its dispatch script, its export path, its analytics rows
  // (`storeName` below). Written once at birth and never derived from a slug
  // again. Null only for an app the backfill has not reached (migrate.ts
  // `handled`), which no read can be: the pass runs on the directory's first
  // request of the deploy, before any app of it is answered for.
  store: string | null
  // The app's own number, its row's `phone{number}`: what its texts leave
  // from and arrive at (app-texts.ts). An admin writes it once the number is
  // registered to text; null for every app without one, which texts only in
  // its pilot.
  phone?: string | null
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
  // Whether the platform features it (`featured`, T-160642).
  featured?: boolean
  // The app's uploaded image chosen by its owner for listings.
  screenshot: string | null
  // The site somebody else may own that this app was rebuilt from
  // (newcomer.ts `previewing`): until its domain is verified here the app is
  // that site's private preview. Null for every other app.
  preview?: Preview | null
  // When this app's store was seeded and by which release (seed.ts), null
  // until it has been. A release reads it to know the seed has already run.
  seeded: Sowed | null
  // The sample a stranger at a private published app reads (sample.ts,
  // D-134327): a store of its own holding the published version's seed and
  // nothing else. Null for every app that keeps none.
  demo?: Demo | null
  // In the trash, and since when (erase.ts, T-34430). Null for every app that
  // is not — which is almost all of them — and every reader of an app asks
  // it: a trashed app serves nothing, declares nothing, is nobody's front
  // page and takes no mail, while its bytes and store stay for thirty days.
  // Its slug is free immediately; former keeps the address to restore at.
  trashed: Trashed | null
  // The colours this app's owner set for its installed chrome (apps.ts
  // `manifesting`/`pinned`, T-33055): the phone's splash while it opens
  // (`backgroundColor`) and the browser/status chrome around it
  // (`themeColor`), both CSS, set through `app_set`. Either half null where
  // the app never set it — the platform's own palette answers instead
  // (apps.ts `PLATFORM_THEME`/`PLATFORM_BACKGROUND`), so an app that asked
  // for neither is never colourless.
  theme: { themeColor: string | null; backgroundColor: string | null } | null
  // Whether its pages in folders resolve relative URLs from the app's root
  // rather than their own folder (`rooted`, apps.ts `asset`).
  rooted?: boolean
  // The paths it has published files at (`publishing`, public-files.ts): a
  // request at one of them is answered its file before the app runs, and one
  // anywhere else goes on to the app without asking the directory again.
  publishing?: string[]
}
export type Role = 'owner' | 'editor' | 'viewer'

/** A person's place in a space: the space, what they are in it, the seat's
 * eid, whether the space is their own (`member.own`, {@link directory}'s
 * `own`), and the person who owns it. */
export type Seat = {
  space: Space
  role: Role
  seat: string
  own: boolean
  owner?: string
}

/** A space reached by another's Operator, or the Operator's space a space let
 * in (`operator_reach`): that space, the role given, the row's eid and who gave it. */
export type Reach = { eid: string; space: Space; role: Role; by?: string }

/** One app a person is a guest of, and what the grant lets them do. */
export type Granted = { space: Space; app: App; access: Role }

/** A place one person holds or is offered: a seat in a space, a grant on one
 * app, or an invitation to either, not yet accepted, with when its latest
 * letter went. `on` is the space or app it is in. */
export type Held = {
  eid: string
  held: 'seat' | 'grant' | 'invite'
  on: string
  person: string
  role: Role
  sent: string | null
}
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

/** Whether anyone may have the app's release files: a published app's,
 * which installing hands to whoever asks, private or not. Any release's, not
 * only the one on offer: each is named by an id only its own pages carry
 * (asset_url.ts). The app's data stays its own people's. */
export let offered = (app: { published?: Offer | null }) => !!app.published
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
// yet listed is the waiting state. A decline clears both and keeps its review.
export type Gallery = {
  askedAt: string
  listedAt: string
  reviewedAt?: string
  /** the published version an agent's code review read (`code_review`) */
  version?: number
  decision?: 'approved' | 'declined'
  by?: string
  via?: string
  reason?: string
}

/** Anything one space shares with the whole platform, as the gallery's
 * verbs read it: an app, a skill. Its offer, and where the gallery stands. */
export type Shared = {
  eid: string
  title: string
  published: Offer | null
  gallery: Gallery | null
  /** whether the platform features it (`featured`, T-160642) */
  featured?: boolean
}

/** A skill a space published (shared-skill.ts): the text on offer, at the
 * version on offer, read off its directory row. */
export type SkillOffer = Shared & {
  published: Offer
  space: string
  description: string
  body: string
  skill: Record<string, unknown>
  /** Where it came from when someone outside yaks.app wrote it. */
  upstream: Upstream | null
}

// That the app's store carries the data its files seed it with, and the
// release that put it there (seed.ts, T-34327).
export type Sowed = { at: string; version: number }

// An app's sample store (sample.ts): its handle, the sha of the declaration
// and seed it was made from, so a republish that changed neither keeps it, and
// the published version and the release it was selected at, which is what a
// stranger is served (visit.ts).
export type Demo = {
  store: string
  seed: string
  version: number | null
  release: string | null
}

// When an app or a space was thrown away and by whom (erase.ts, T-34430,
// T-34431). `at` is what the thirty days are counted from, and `by` is the
// person the sweep erases it as, since they are the one who asked for it gone.
export type Trashed = { at: string; by: string }

// How long the trash keeps it. Thirty days is the owner's number, and it is
// the same number `/privacy` says out loud.
export let GRACE = 30 * 24 * 60 * 60_000

// Days left before the sweep takes it, never below zero — what a person is
// told, in the unit they would ask in. Trashed a moment ago is thirty.
export let daysLeft = (t: Trashed, now = Date.now()) =>
  Math.max(0, Math.ceil((Date.parse(t.at) + GRACE - now) / 86_400_000))

// Whether the trash has run out. A mark with no readable `at` is due —
// something nothing can count the days of cannot be kept forever on a null.
export let due = (t: Trashed, now = Date.now()) =>
  !(Date.parse(t.at) + GRACE > now)

// What the sweep takes: the rows in the trash whose days have run out, and
// nothing else. Apps or spaces, since both wear the one word — the whole of
// the selection, as one pure answer, because what a sweep deletes is the part
// worth holding to a test.
export let overdue = <T extends { trashed: Trashed | null }>(
  rows: T[],
  now = Date.now(),
) => rows.filter((r) => r.trashed && due(r.trashed, now))

// A hostname a person owns, aimed at one place (platform.rs `Hostname`,
// T-33037): `serves` is the eid of the space it opens, or of the one app it
// opens (T-34596). How far provisioning has come, and when that was last read
// from Cloudflare. `to` is another hostname of that place this one sends its
// visitors to (kernel.ts `forwarded`), or null where it serves the place.
export type HostStage = 'pending' | 'active' | 'error'
/** A number the platform holds for a space, bought through the phone `via`
 * at its price in dollars (numbers.ts), and the toll-free verification
 * filed for it, by the provider's id. Where it is used is whichever space or
 * app row carries it as `phone{number}`. */
export type PhoneLine = {
  eid: string
  number: string
  via: string
  space: string
  upfront: number
  monthly: number
  at: string
  verification: string | null
}

export type Host = {
  eid: string
  name: string
  serves: string
  stage: HostStage | null
  at: string
  verification: Partial<Rec> | null
  verified: string | null
  to: string | null
}

// A reference property, as a read hands it back: the bare eid, or `{eid, name}`
// where the store could name what it points at (listing.ts `named`, T-32733).
// What the directory wants either way is the id — the same lowering client.ts
// `where` does on the write side.
export type Id = string | { eid: string }
export let idOf = (v: Id): string => typeof v == 'string' ? v : v.eid

/** That `space` installed `of`, something another space shared (T-131912):
 * one row a space and thing, which `install`'s declared identity finds again
 * on every later install, so installing twice is counted once. */
export let installOf = (of: string, space: string): Bundle => ({
  entity: { eid: '$install' },
  install: { of, space },
})

/** What the spaces that installed something shared made of it, read and
 * never stored (T-160642, T-160643): how many installed it, and how they
 * rate it. */
export type Uptake = { installs: number; rated: Rated | null }
/** The mean of each counting space's latest stars, and how many spaces. */
export type Rated = { stars: number; count: number }
export let NO_UPTAKE: Uptake = { installs: 0, rated: null }

/** That someone in `space` rated `of` (T-160643): a row of its own each
 * time, so who rated is its `created.by` and an earlier rating is kept. */
export let ratingOf = (
  of: string,
  space: string,
  stars: number,
  why?: string,
): Bundle => ({
  entity: { eid: '$rating' },
  rating: { of, space, stars, ...why ? { why } : {} },
})

/** Each thing's rating from rating rows: the latest from each space in
 * `installed` (by the thing's eid), counted once. */
export let ratedBy = (
  rows: Row[],
  installed: Map<string, Set<string>>,
): Map<string, Rated> => {
  let latest = new Map<string, Map<string, { at: string; stars: number }>>()
  for (let r of rows) {
    let { of, space, stars } = r.rating ?? {}
    if (!of || !space || typeof stars != 'number') continue
    let thing = idOf(of), at = idOf(space)
    if (!installed.get(thing)?.has(at)) continue
    let by = latest.get(thing) ?? new Map()
    latest.set(thing, by)
    let when = r.created?.at ?? ''
    if ((by.get(at)?.at ?? '') <= when) by.set(at, { at: when, stars })
  }
  return new Map([...latest].map(([thing, by]) => {
    let all = [...by.values()].map((v) => v.stars)
    return [thing, {
      stars: all.reduce((a, b) => a + b, 0) / all.length,
      count: all.length,
    }]
  }))
}

/** A space asked by a walk to it while its eid is still being read, and kept
 * to that eid once known (@yaks/connections `Path`): so a page's own rows are
 * asked beside the read that learns its space (`page`), and travel in its
 * trip. */
export type Walk = { path: `.${string}`; eid: Promise<string> }

/** The walk to the space at an address. A page asks its rows by it whether
 * or not it knows the eid yet, so the line it asks is the one asked ahead of
 * it (apps.ts `foresee`), answered again from that reading (hops.ts
 * `recall`). */
export let walkTo = (slug: string, eid: string | Promise<string>): Walk => ({
  path: `.space.slug=${slug}`,
  eid: Promise.resolve(eid),
})

/** A directory row as a read hands it back: the components the kernel reads,
 * each optional, since a row is whichever of them it wears. */
export type Row = {
  policy?: { revision: number }
  switched?: {
    app: string
    from?: string | null
    to: string
    source?: string | null
    at?: string | null
    by?: Id | null
    via?: Id | null
  }
  written?: {
    app: Id
    draft?: string | null
    path: string
    sha?: string | null
    was?: string | null
    size?: number | null
    at?: string | null
    by?: Id | null
  }
  entity: { eid: string }
  // A browser and the person who claimed its guest work (attribution.ts).
  browser?: { by?: Id | null }
  space?: { slug: string; store?: string | null }
  app?: {
    slug: string | null
    space: Id
    version: number | null
    lenses?: Record<string, number> | null
    declaration?: string | null
    source?: string | null
    files?: string | null
    blobs?: string | null
    draft?: string | null
    fence?: string | null
    followed?: string | null
    script?: string | null
    worker?: string | null
    access?: Access | null
    store?: string | null
  }
  published?: {
    name?: string | null
    version?: number | null
    at?: string | null
    about?: string | null
    space?: Id | null
  }
  skill?: Record<string, unknown>
  upstream?: Partial<Upstream> | null
  content?: { body?: string | null }
  installed?: {
    of?: Id | null
    version?: number | null
    sandboxed?: string | null
  }
  install?: { of?: Id | null; space?: Id | null }
  rating?: {
    of?: Id | null
    space?: Id | null
    stars?: number | null
    why?: string | null
  }
  gallery?: {
    asked_at?: string | null
    listed_at?: string | null
    reviewed_at?: string
    decision?: 'approved' | 'declined'
    by?: Id | null
    via?: Id | null
    reason?: string
  }
  code_review?: { version?: number | null }
  featured?: { at?: string | null }
  screenshot?: { blob?: string | null }
  seeded?: { at?: string | null; version?: number | null }
  demo?: {
    store?: string | null
    seed?: string | null
    version?: number | null
    release?: string | null
  }
  trashed?: { at?: string | null; by?: Id | null }
  theme?: { theme_color?: string | null; background_color?: string | null }
  rooted?: Record<string, never>
  publishing?: { paths?: string | null }
  public_file?: {
    app: Id
    path: string
    sha: string
    mime?: string | null
    size?: number | null
  }
  hostname?: {
    name: string
    serves: Id
    stage?: HostStage | null
    at?: string | null
    verification?: Partial<Rec> | null
    to?: string | null
  }
  verified?: { at?: string | null }
  deploy?: {
    app: Id
    version: number
    files?: string
    worker?: string
    script?: string
    source?: string | null
    reload?: Reload | null
    lenses?: Record<string, number>
    speaks?: Record<string, number>
    message?: string | null
  }
  restored?: {
    app: Id
    at?: string | null
    to?: string | null
    by?: Id | null
    from_bookmark?: string | null
  }
  fee?: { bps?: number | null }
  budget?: { dollars?: number | null; newcomer?: boolean | null }
  space_logo?: { sha?: string | null; type?: string | null }
  operator?: {
    name?: string | null
    voice?: string | null
    voice_speed?: string | null
    voice_model?: string | null
    voice_backend?: string | null
    cache_retention?: number | null
  }
  starter?: { dollars?: number | null }
  visitor_share?: { percent?: number | null; calls?: number | null }
  started?: { space?: Id | null }
  newcomer?: { at?: string }
  visitor_build?: { at?: string }
  preview?: { site?: string | null; at?: string | null }
  created?: { at?: string; by?: Id | null }
  last_deploy?: { at?: string; by?: Id | null; via?: Id | null }
  acts_for?: { person?: Id | null }
  member?: { space: Id; person: Id; role: Role; own?: boolean }
  grant?: { app: Id; person: Id; access: Role }
  operator_reach?: { space: Id; operator: Id; role: Role; by?: Id | null }
  invite?: {
    to: Id
    person: Id
    role: Role
    sent?: string | null
    by?: Id | null
  }
  inviting?: { hour?: string | null; sent?: number | null }
  referral_code?: { code: string }
  referral?: { inviter: Id; invitee: Id }
  rewarded?: {
    at: string
    space: Id
    until: string
    subscription?: string | null
  }
  comped?: { until: string }
  comp?: { tier: 'plus' | 'pro'; reason: string; by: Id }
  person?: Record<string, unknown>
  email?: { address: string }
  sender?: { via: string }
  phone?: { number: string }
  phone_line?: {
    number: string
    via: string
    space: Id
    upfront?: number | null
    monthly?: number | null
    at?: string | null
    verification?: string | null
  }
  sms_consent?: { person: Id; consent: string; at: string; space?: Id }
  operator_alerts?: { channel?: Alerting | null }
  desk_sidebar?: { collapsed?: boolean | null }
  push_subscription?: {
    person: Id
    endpoint: string
    p256dh: string
    auth: string
  }
  oauth_grant?: Omit<GrantRow, 'person'> & { person: Id }
  grants_listed?: { at: string }
  signed_in?: { at?: string | null; via?: string | null }
  used?: { at?: string | null }
  changed?: { at?: string | null }
  errored?: { at?: string | null }
  former?: { slug: string; slugs?: string | null }
  home?: { first?: string | null }
  doc?: { title?: string; body?: string }
  plan?: {
    tier?: Tier | null
    customer?: string | null
    subscription?: string | null
    status?: string | null
    until?: string | null
    ending?: string | null
    at?: string | null
  }
  credit?: {
    cap?: number | null
    bought?: number | null
    spent?: number | null
  }
  seller?: {
    via?: string | null
    account?: string | null
    ready?: boolean | null
    submitted?: boolean | null
  }
  meter?: Partial<Meter>
  trend?: {
    requests?: ByDay
    spend?: ByDay
    sources?: Record<string, ByDay>
    paid?: ByDay
  }
  notified?: Record<string, unknown> | null
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
      ws_messages: r.meter.ws_messages ?? 0,
      ws_hibernated: r.meter.ws_hibernated ?? 0,
      rows_read: r.meter.rows_read ?? 0,
      rows_written: r.meter.rows_written ?? 0,
      bytes: r.meter.bytes ?? 0,
      files: r.meter.files ?? 0,
      emails: r.meter.emails ?? 0,
      builds: r.meter.builds ?? 0,
      models: r.meter.models ?? 0,
      realtime: r.meter.realtime ?? 0,
      texts: r.meter.texts ?? 0,
      seconds: r.meter.seconds ?? 0,
      built: r.meter.built ?? 0,
      drawn: r.meter.drawn ?? 0,
      visitors: r.meter.visitors ?? 0,
      refunded: r.meter.refunded ?? 0,
      credit: r.meter.credit ?? 0,
      at: r.meter.at ?? '',
    }
    : null

/** Whether a person's row is a newcomer's (newcomer.ts): the home page's box
 * signed their browser in, and they have no address and no number yet. */
export let newcomerIs = (r?: Pick<Row, 'newcomer' | 'email' | 'phone'>) =>
  !!r?.newcomer && !r.email && !r.phone

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

/** The platform's own rows in the meta store (`seed`), written once per
 * store: before a directory write, and before the first-owner bootstrap
 * reads the meta space (identity.ts `founding`), which on a new platform
 * may follow a sign-in no directory write came before. */
export let seeding = (store: Meta) => {
  let first = seeded.get(store)
  if (!first) seeded.set(store, first = seed(store))
  return first
}

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
  let bundles: Bundle[] = []
  if (!space) {
    bundles.push({
      entity: { eid: '$space' },
      doc: { title: META.space },
      // Its handle is the bare slug, as every space from before handles
      // wears its own (925e91572), since it never moves.
      space: { slug: META.space, store: META.space },
      operator: { name: pick(META.space) },
    }, {
      entity: { eid: '$app' },
      doc: { title: META.app },
      // The one app whose handle is not minted (`handle`): the meta store is
      // the object this very row is being written into, and it has been called
      // `yak/platform` since the platform's first day. Said outright rather
      // than left to the backfill, which would only ever arrive at the same
      // string by a longer road. Private, as every app is born with its mode
      // said (`appOf` reports one without) and as the live one stands.
      app: {
        slug: META.app,
        space: '$space',
        store: META_STORE,
        access: 'private',
      },
    })
  }
  if (!admin) {
    bundles.push({
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
    bundles.push({
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
  if (bundles.length) await store.apply(bundles)
}

let notFound = () => new Response('not found', { status: 404 })

// A read that must not be a moment old, asked for by the caller. App rows
// always use this door so a release selects the consumer and its homes from
// one directory answer. Other reads keep the 30-second cache unless their
// caller asks fresh. The header is the kernel's own — a client's copy never
// reaches here, since this part is only ever called with `bound`.
export let FRESH = 'x-yak-fresh'

// The headers an ordinary caller carries through to the store. The directory
// binding is internal; its `stamp` door passes the kernel header separately
// for platform-owned properties that an ordinary graph write cannot set.
let VOUCH = [
  'x-yak-person',
  'x-yak-actor',
  'x-yak-role',
  'x-yak-via',
  'x-yak-administrative',
]

let forwarded = (req: Request) =>
  Object.fromEntries(
    VOUCH.map((h) => [h, req.headers.get(h)]).filter(([, v]) => v),
  ) as Record<string, string>

/** The directory's cached read and seeded write boundary over its meta store.
 * In-process callers hold this interface; {@link over} carries it over HTTP. */
export let part = (store: Meta) => ({
  query: async (line: string, fresh = false): Promise<string> => {
    let cache = cached(store)
    let hit = fresh ? null : cache.get(line)
    if (hit && hit.at > Date.now() - TTL) return hit.body
    let body = JSON.stringify(await store.query(line))
    if (body != '[]') cache.set(line, { at: Date.now(), body })
    return body
  },
  apply: async (bundles: Bundle[], headers: Record<string, string> = {}) => {
    await seeding(store)
    let admitted = Object.fromEntries(
      [...VOUCH, 'x-yak-kernel']
        .filter((name) =>
          headers[name] &&
          (name != 'x-yak-kernel' || headers[name] == '1')
        )
        .map((name) => [name, headers[name]]),
    )
    let applied = await store.apply(bundles, admitted)
    cached(store).clear()
    return applied
  },
})

export type Part = ReturnType<typeof part>

// What went wrong, answered in the store's own terms and at its own status:
// the store's body as it came when the error relays one, else the error as
// @yaks/api says it. A failure raised here is thrown on to the entry that
// reached this door (defects.ts `refusing`), never answered as the caller's
// mistake.
let refused = (e: unknown, tags: Record<string, string>) => {
  let status = refusing(e, tags)
  let body = (e as { body?: unknown } | null)?.body
  return new Response(
    typeof body == 'string' ? body : JSON.stringify(refusal(e)),
    { status, headers: { 'content-type': 'application/json' } },
  )
}

// The fleet's mutation envelope holds bundles under `entities`; the store
// speaks bundles directly. HTTP carries only the headers this door admits.
export let over = (store: Meta) => {
  let door = part(store)
  return async (req: Request): Promise<Response> => {
    let url = new URL(req.url)
    if (req.method == 'GET' && req.headers.has(EPOCH) && store.door) {
      return store.door(url.pathname + url.search, {}, {
        ...req.headers.has(STATIC_QUERY) ? { [STATIC_QUERY]: '1' } : {},
      })
    }
    if (url.pathname == '/apply' && req.method == 'POST') {
      try {
        let sent = await req.json() as { entities?: Bundle[] }
        let headers = forwarded(req)
        if (req.headers.get('x-yak-kernel') == '1') {
          headers['x-yak-kernel'] = '1'
        }
        return Response.json(await door.apply(sent.entities ?? [], headers))
      } catch (e) {
        return refused(e, { request: 'directory /apply' })
      }
    }
    if (url.pathname != '/query' || req.method != 'GET') return notFound()
    try {
      let body = await door.query(
        url.searchParams.get('q') ?? '',
        !!req.headers.get(FRESH),
      )
      return new Response(body, {
        headers: { 'content-type': 'application/json' },
      })
    } catch (e) {
      return refused(e, { request: 'directory /query' })
    }
  }
}

/** The part, over the directory's own store. The env it asks for is the one
 * binding it reads, so a caller holding the namespace and nothing else — a
 * Store object metering a letter (meter.ts `metering`) — can call it too. */
export let fetch = (
  req: Request,
  env: { STORE: Namespace },
): Promise<Response> => {
  // The serving-copy reader needs the revision captured beside the actual
  // directory read, not a revision fetched after the answer. Bypass part's TTL.
  if (
    req.method == 'GET' &&
    (req.headers.get(EPOCH) == '1' || req.headers.get(STATIC_QUERY) == '1')
  ) {
    let url = new URL(req.url)
    let q = url.searchParams.get('q') ?? ''
    let door = metaStore(env).door ?? storeOf(env.STORE, PLATFORM_STORE)
    return door(
      url.pathname == READS
        ? READS + url.search
        : `/query?q=${encodeURIComponent(q)}${
          req.headers.has(MEND) ? '&mend=1' : ''
        }`,
      {},
      req.headers.get(STATIC_QUERY) == '1' ? { [STATIC_QUERY]: '1' } : {},
    )
  }
  return over(metaStore(env))(req)
}

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
  opts: { stamp?: boolean; actor?: Actor } = {},
) => {
  knownOptions(opts, ['stamp', 'actor'])
  let { actor, ...apply } = opts
  let headers = {
    ...KERNEL,
    ...(actor?.by ? { 'x-yak-person': actor.by } : {}),
    ...(actor?.via ? { 'x-yak-via': actor.via } : {}),
  }
  let applied = await metaStore(env).apply(mutation.entities, headers, apply)
  cached(metaStore(env)).clear()
  return applied
}

// A listing carries the components the filter names (@yaks/graph `wanted`),
// so every read here asks for what it reads: a space with its title, plan and
// meter, an app with its title, the address its store is named by, and its
// meter. `.entity.eid=` names no component and answers the whole bundle,
// which is why those are bare.
// What every read of an app asks for beside the app row itself, in one place
// because `appOf` reads all of it and a filter that forgets one answers null
// where there is a value. What a page can show of an app or a space is in
// these too (facets/pages-graph.ts).
export let APP_PARTS = [
  'doc',
  'former',
  'home',
  'meter',
  'published',
  'installed',
  'gallery',
  'code_review',
  'featured',
  'screenshot',
  'preview',
  'seeded',
  'demo',
  'trashed',
  'theme',
  'rooted',
  'publishing',
  'phone',
]
let ABOUT = APP_PARTS.map((part) => `?${part}`).join('&')

// And what every read of a space asks for, for the same reason.
export let SPACE_PARTS = [
  'doc',
  'plan',
  'credit',
  'meter',
  'notified',
  'trashed',
  'seller',
  'fee',
  'budget',
  'starter',
  'visitor_share',
  'former',
  'tunnel',
  'operator',
  'sender',
  'phone',
  'comped',
  'comp',
  'space_logo',
  'preview',
  'featured',
]
let SPACE_ABOUT = SPACE_PARTS.map((part) => `?${part}`).join('&')

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

/** One person who signed up through another's invite (referral.ts): who
 * invited whom and when, and the month it gave once they built an app. */
export type Referral = {
  eid: string
  inviter: string
  invitee: string
  at: string
  rewarded: {
    at: string
    space: string
    until: string
    subscription: string | null
  } | null
}

let referralOf = (r: Row): Referral[] =>
  r.referral
    ? [{
      eid: r.entity.eid,
      inviter: idOf(r.referral.inviter),
      invitee: idOf(r.referral.invitee),
      at: r.created?.at ?? '',
      rewarded: r.rewarded
        ? {
          at: r.rewarded.at,
          space: idOf(r.rewarded.space),
          until: r.rewarded.until,
          subscription: r.rewarded.subscription || null,
        }
        : null,
    }]
    : []

// The seller's row, or null where nothing has ever connected. An account with
// neither answer yet — minted a second ago, the webhook not in — reads false
// on both, which is the truth: nothing may be sold through it until its
// provider says so.
let sellerOf = (r: Row): Seller | null =>
  r.seller?.account
    ? {
      via: r.seller.via ?? '',
      account: r.seller.account,
      ready: !!r.seller.ready,
      submitted: !!r.seller.submitted,
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

export let spaceOf = (r: Row): Space => ({
  eid: r.entity.eid,
  slug: r.space!.slug,
  store: r.space!.store ?? unrooted(r.entity.eid, r.space!.slug),
  title: r.doc?.title || r.space!.slug,
  operator: calledOf(r),
  voice: r.operator?.voice ?? null,
  voice_speed: r.operator?.voice_speed ?? null,
  voice_model: r.operator?.voice_model ?? null,
  voice_backend: r.operator?.voice_backend ?? null,
  cache_retention: r.operator?.cache_retention ?? null,
  logo: r.space_logo?.sha
    ? { sha: r.space_logo.sha, type: r.space_logo.type ?? '' }
    : null,
  ...(r.featured ? { featured: true } : {}),
  ...(r.sender
    ? {
      sender: { ...r.sender, ...(r.phone ? { number: r.phone.number } : {}) },
    }
    : {}),
  tier: tierOf(
    r.space!.slug,
    r.plan?.tier ?? null,
    r.comped?.until,
    Date.now(),
    r.comp ? { ...r.comp, by: idOf(r.comp.by) } : null,
  ),
  plan: planOf(r),
  credit: r.credit
    ? {
      cap: r.credit.cap ?? 0,
      bought: r.credit.bought ?? 0,
      spent: r.credit.spent ?? 0,
    }
    : null,
  comped: r.comped?.until ?? null,
  ...(r.comp ? { comp: { ...r.comp, by: idOf(r.comp.by) } } : {}),
  seller: sellerOf(r),
  fee: r.fee?.bps ?? 0,
  budget: r.budget?.dollars ?? null,
  newcomer: !!r.budget?.newcomer,
  preview: previewOf(r),
  starter: r.starter?.dollars ?? null,
  visitors: r.visitor_share?.percent ?? null,
  visitorCalls: r.visitor_share?.calls ?? null,
  meter: meterOf(r),
  told: r.notified != null,
  trashed: trashedOf(r),
  slugs: slugsOf(r.former),
  tunnel: tunnelOf(r),
})

// A space row with no handle: nothing writes one (every space has worn one
// since 925e91572 backfilled them), so it is a failure to report. It is read
// as its slug, the handle the backfill gave every space from before the word,
// which is where the bytes of a space that never moved are.
let unrooted = (space: string, slug: string) => {
  caught(new Error(`space ${space} has no handle; read as ${slug}`), {
    request: 'space handle',
    space,
  })
  return slug
}

// Every way in writes the person before asking for their space (signin.ts
// `personOf`, identity.ts `textedIn`), so a credential naming nobody outlived
// an account that was erased. Minting for it would bring the row back as a
// bare `person{}` (T-144468).
let erased = () =>
  new CallError('access', 'This account was erased. Sign in again.')

// What a person's own space is named for: their address. One with no address
// (who signed up by text) has nothing to name it after, so it is named at
// random until they rename it: one name for all of them would number its way
// past every space already holding it, a read each.
let slugOf = (row: Row) =>
  row.email?.address
    ? slugFor(row.email.address)
    : `space-${crypto.randomUUID().slice(0, 6)}`

// A person who owns several spaces, none marked as theirs and none named by
// their address: one renamed away from it before `member.own` (T-135921), so
// which is theirs is a guess the tracker hears about until their seat is
// marked.
let unmarked = (person: string, space: Space) => {
  caught(
    new Error(
      `person ${person} has no own space marked; read as ${space.slug}`,
    ),
    {
      request: 'own space',
      space: space.eid,
    },
  )
  return space
}

// An app row with no access mode: nothing writes one (T-59268 stamped the six
// born before the word), so it is a failure to report, and the app is read as
// private until its owner says otherwise.
let unsaid = (app: string): Access => {
  caught(new Error(`app ${app} has no access mode; read as private`), {
    request: 'app access',
    app,
  })
  return 'private'
}

let galleryOf = (r: Row): Gallery | null =>
  r.gallery
    ? {
      askedAt: r.gallery.asked_at ?? '',
      listedAt: r.gallery.listed_at ?? '',
      ...(r.gallery.reviewed_at ? { reviewedAt: r.gallery.reviewed_at } : {}),
      ...(r.code_review?.version != null
        ? { version: r.code_review.version }
        : {}),
      ...(r.gallery.decision ? { decision: r.gallery.decision } : {}),
      ...(r.gallery.by ? { by: idOf(r.gallery.by) } : {}),
      ...(r.gallery.via ? { via: idOf(r.gallery.via) } : {}),
      ...(r.gallery.reason ? { reason: r.gallery.reason } : {}),
    }
    : null

let offerOf = (r: Row): Offer | null =>
  r.published?.name
    ? {
      name: r.published.name,
      version: r.published.version ?? 0,
      at: r.published.at ?? '',
      about: r.published.about ?? '',
    }
    : null

/** A skill offer's directory row, read back (shared-skill.ts). */
export let skillOfferOf = (r: Row): SkillOffer | null => {
  let published = offerOf(r)
  if (!published || !r.skill || !r.published?.space) return null
  return {
    eid: r.entity.eid,
    title: r.doc?.title ?? '',
    description: r.doc?.body ?? '',
    body: r.content?.body ?? '',
    skill: r.skill,
    space: idOf(r.published.space),
    published,
    gallery: galleryOf(r),
    featured: !!r.featured,
    upstream: upstreamOf(r.upstream),
  }
}

export let appAbout = (r: Row): AppInfo => ({
  eid: r.entity.eid,
  slug: r.app!.slug ?? r.former?.slug ?? '',
  space: idOf(r.app!.space),
  version: r.app!.version,
  ...(r.app!.lenses ? { lenses: r.app!.lenses } : {}),
  declaration: r.app!.declaration ?? null,
  source: r.app!.source ?? null,
  files: r.app!.files ?? null,
  blobs: r.app!.blobs ?? null,
  draft: r.app!.draft ?? null,
  fence: r.app!.fence ?? null,
  followed: r.app!.followed ?? null,
  script: r.app!.script ?? null,
  worker: r.app!.worker ?? null,
  access: r.app!.access ?? unsaid(r.entity.eid),
  title: r.doc?.title || r.app!.slug || r.former?.slug || '',
  store: r.app!.store ?? null,
  phone: r.phone?.number ?? null,
  slugs: slugsOf(r.former),
  home: r.home != null,
  first: firstOf(r.home),
  meter: meterOf(r),
  published: offerOf(r),
  installed: r.installed
    ? {
      of: r.installed.of ? idOf(r.installed.of) : null,
      version: r.installed.version ?? 0,
      sandboxed: r.installed.sandboxed || null,
    }
    : null,
  gallery: galleryOf(r),
  featured: !!r.featured,
  screenshot: r.screenshot?.blob ?? null,
  preview: previewOf(r),
  seeded: r.seeded
    ? { at: r.seeded.at ?? '', version: r.seeded.version ?? 0 }
    : null,
  demo: r.demo?.store
    ? {
      store: r.demo.store,
      seed: r.demo.seed ?? '',
      version: r.demo.version ?? null,
      release: r.demo.release ?? null,
    }
    : null,
  trashed: trashedOf(r),
  theme: r.theme
    ? {
      themeColor: r.theme.theme_color ?? null,
      backgroundColor: r.theme.background_color ?? null,
    }
    : null,
  rooted: r.rooted != null,
  publishing: publishingOf(r.publishing),
})

type ReadRow = Row & { policy: { revision: number } }
let appOf = (r: ReadRow): App => ({ ...appAbout(r), policy: r.policy.revision })

/** A published app with the space it stands in. */
export type OnOffer = { space: Space; app: App }

// The offers among published apps and their spaces, newest first. A trashed
// app, or any app in a trashed space, offers nothing: the trash writes nothing
// on the row (erase.ts), so the offer is screened here and a restore puts it
// back as it was.
let offering = (rows: ReadRow[]): OnOffer[] => {
  let spaces = new Map(
    rows.filter((row) => row.space).map((
      row,
    ) => [row.entity.eid, spaceOf(row)]),
  )
  return rows.filter((row) => row.app).map(appOf)
    .filter((app) => app.published && !app.trashed)
    .sort((a, b) => b.published!.at.localeCompare(a.published!.at))
    .flatMap((app) => {
      let space = spaces.get(app.space)
      return space && !space.trashed ? [{ space, app }] : []
    })
}

// An eid a query may name: a word with no query syntax in it.
let EID = /^[\w-]+$/

let hostOf = (r: Row): Host => ({
  eid: r.entity.eid,
  name: r.hostname!.name,
  serves: idOf(r.hostname!.serves),
  stage: r.hostname!.stage ?? null,
  at: r.hostname!.at ?? '',
  verification: r.hostname!.verification ?? null,
  verified: r.verified?.at ?? null,
  to: r.hostname!.to || null,
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
  script: r.deploy!.script ?? '',
  source: r.deploy!.source ?? null,
  reload: r.deploy!.reload ?? null,
  message: r.deploy!.message ?? null,
  lenses: r.deploy!.lenses as Record<string, number> | undefined,
  speaks: r.deploy!.speaks as Record<string, number> | undefined,
})

/** One file written into an app (drafts.ts `Written`), as a row reads. */
export let writtenOf = (r: Row) => ({
  eid: r.entity.eid,
  draft: r.written!.draft ?? null,
  path: r.written!.path,
  sha: r.written!.sha ?? null,
  was: r.written!.was ?? null,
  size: r.written!.size ?? null,
  at: r.written!.at ?? null,
  by: r.written!.by ? idOf(r.written!.by) : null,
})

/// publishingOf({paths: '["notes/week-1","posts/hello"]'}) -> ['notes/week-1', 'posts/hello']
/// publishingOf({}) -> []
/// publishingOf(undefined) -> []
/// publishingOf({paths: 'not json'}) -> []
/** The paths an app has published files at, as its row keeps them: the JSON
 * array in `publishing.paths` (facets/publishing-graph.ts), or none. */
export let publishingOf = (publishing?: Row['publishing']): string[] => {
  try {
    let held = JSON.parse(publishing?.paths || '[]')
    return Array.isArray(held) ? held.filter((p) => typeof p == 'string') : []
  } catch {
    return []
  }
}

// One file an app published (public-files.ts): where it answers, and its
// bytes' address, type and length.
export let publicFileOf = (r: Row) => ({
  eid: r.entity.eid,
  app: idOf(r.public_file!.app),
  path: r.public_file!.path,
  sha: r.public_file!.sha,
  mime: r.public_file!.mime || 'application/octet-stream',
  size: r.public_file!.size ?? 0,
})
export type PublicFile = ReturnType<typeof publicFileOf>

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
export let storeName = (
  space: Pick<Space, 'slug'>,
  app: { slug: string; store?: string | null },
) => app.store ?? `${space.slug}/${app.slug}`

/** The dispatch script serving the app's live release: each release uploads
 * its own (`app-<eid>-r-<uuid>`, tools.ts), and an app released before that
 * still runs the one named by its handle. What the running worker reads, its
 * connections included (connections.ts `rebind`), is bound here. */
export let scriptOf = (space: Space, app: App) =>
  app.script ?? storeName(space, app)

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
  tagged(`${space.slug}/${slug}`, eid)

/**
 * A space's handle, made the same way one level up: the slug it is born at and
 * the same six hex off its eid, `ada.1f7c3e`. It roots every key the space
 * keeps in the bucket (D-131924), so the bucket still reads as ada's, and a
 * space born later at `ada` — after this one has moved — roots at a handle of
 * its own. A slug is a hostname label with no dot in it, so no handle is ever
 * a slug, the bare ones the backfill wrote included.
 */
export let spaceHandle = (slug: string, eid: string) => tagged(slug, eid)

let tagged = (name: string, eid: string) =>
  `${name}.${eid.replaceAll('-', '').slice(-6)}`

// The door onto one app's store, told which app it holds and what this
// directory says its access mode is (T-33813). A store keeps both (graph.ts
// `#learn`) and answers @yaks/member's questions with them, so every caller
// that has an App in hand opens its store this way; the ones that only have a
// name — the meta store, the usage sweep — have no app to name and use
// `storeOf` directly.
let served = (space: Space, app: App, env: HostEnv) => ({
  policy: app.policy,
  eid: app.eid,
  space: space.eid,
  access: app.access,
  mail: mailbox(space, app, env),
  phone: app.phone ?? '',
})

/**
 * Which of its declarations an app's store serves: the one a borrowing deploy
 * last planted there, else the app's own version. A store's words and
 * commands arrive only with a release, so an app still at `'0'` has declared
 * nothing, and whoever asks what it declares has its answer without waking
 * the store.
 */
export let releaseOf = (app: App) => app.declaration ?? String(app.version ?? 0)

/** Which store holds an app's rows and what it is told of the app on every
 * call: what {@link appStore} opens, for a caller that opens it elsewhere
 * (files.ts `serves`). */
export let storeAt = (space: Space, app: App, env: HostEnv = {}) => ({
  name: storeName(space, app),
  app: { ...served(space, app, env), release: releaseOf(app) },
})

export let appStore = (
  ns: Namespace,
  space: Space,
  app: App,
  env: HostEnv = {},
): Door => {
  let at = storeAt(space, app, env)
  return storeOf(ns, at.name, at.app)
}

/** Prepare a declaration without selecting it for ordinary Store requests.
 * The directory's pointer moves only when record() commits. */
export let draftStore = (
  ns: Namespace,
  space: Space,
  app: App,
  release: string,
  env: HostEnv = {},
): Door =>
  storeOf(ns, storeName(space, app), {
    ...served(space, app, env),
    release,
    base: releaseOf(app),
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

/** The address history a call leaves behind: the one it had, minus an
 * address forgotten, plus the address a move is leaving. Null when neither
 * happened, which is a call that must not write the property at all.
 * app_set and a space's `rename` both keep theirs this way. */
/// kept('ada', [], true, null) -> ['ada']
/// kept('bob', ['ada'], false, 'ada') -> []
/// kept('ada', ['ada'], false, null) -> null
export let kept = (
  live: string,
  had: string[],
  moving: boolean,
  drop: string | null,
) => {
  if (!moving && drop == null) return null
  let now = drop == null ? had : had.filter((s) => s != drop)
  return moving && !now.includes(live) ? [...now, live] : now
}

// The typed client over the handler, in-process or across a binding.
export type Directory = ReturnType<typeof directory>

let remote = (via: Fetcher) => ({
  apply: async (entities: Bundle[], headers: Record<string, string>) => {
    let r = await via.fetch(
      new Request('http://directory/apply', {
        method: 'POST',
        body: JSON.stringify({ entities }),
        headers,
      }),
    )
    return written(r)
  },
})

// A versioned door's read, always fresh, its rows marked with the revision the
// directory answered at (`policy`): the revision belongs to this response, not
// a shared last-response slot, since parallel reads resume in either order.
type Revised = Readonly<{ text: string; revision: number }>
let revised = async (via: Fetcher, q: string): Promise<Revised> => {
  let answer = await via.fetch(
    new Request(
      `http://directory/query?q=${encodeURIComponent(q)}`,
      { headers: { [EPOCH]: '1', [FRESH]: '1', [STATIC_QUERY]: '1' } },
    ),
  )
  if (!answer.ok) throw await answered(answer)
  let epoch = answer.headers.get(EPOCH)
  let text = await answer.text()
  if (
    epoch == null || !/^\d+$/.test(epoch) ||
    !Number.isSafeInteger(Number(epoch))
  ) {
    throw new Error('The directory answered without a serving revision')
  }
  return { text, revision: Number(epoch) }
}

export type Page = ReturnType<typeof paged>

// What a page says out of the rows one snapshot answered: the space (its
// row given), the app at the address, the front page, the roster when
// `every` app was read, and the asker's seat (`directory.page`).
let paged = (
  rows: ReadRow[],
  space: ReadRow | undefined,
  app: string | null | undefined,
  person: string | null | undefined,
  over: boolean,
  every: boolean,
) => {
  let apps = rows.filter((row) => row.app).map(appOf)
  // The app living at the address, as `app` asks: not one that left it
  // (an app's slug falls back to the address it left, `appAbout`), and a
  // live one before one in the trash that kept it.
  let here = rows.filter((row) => app && row.app?.slug == app).map(appOf)
  let member = space &&
    rows.find((row) =>
      row.member && idOf(row.member.person) == person &&
      idOf(row.member.space) == space.entity.eid
    )?.member
  return {
    space: space ? spaceOf(space) : null,
    app: here.find((one) => !one.trashed) ?? here.at(0) ?? null,
    home: apps.find((one) => one.home && !one.trashed) ?? null,
    roster: every ? apps : null,
    ...person
      ? {
        role: member?.role ?? null,
        ...(over
          ? {
            administrative: rows.some((row) =>
              row.member &&
              idOf(row.member.person) == person &&
              row.member.role == 'owner' &&
              idOf(row.member.space) != space?.entity.eid
            ) ||
              space?.space?.slug == META.space && member?.role == 'owner',
          }
          : {}),
        grants: new Map(
          rows.filter((row) => row.grant).map((row) => [
            idOf(row.grant!.app),
            row.grant!.access as Role,
          ]),
        ),
      }
      : {},
  }
}

/** The line that reads a person's seats: each space they sit in, their seat
 * in it, and the seat of whoever owns it, so a space they are only a member
 * of says whose it is. One read, whatever a caller keeps of it
 * (`seatsOf`). */
export let seatsLine = (person: string) => {
  let mine = `.members_space.member.person=${person}`
  return `(.member.person=${person})|(.space&${mine})|(.member.role=owner&.member.space${mine})&*`
}

/** A person's seats among the rows `seatsLine` read: each space they sit in
 * with their own seat in it and the seat of whoever owns it. */
export let seatsOf = (rows: Row[], person: string, role?: Role): Seat[] => {
  let seats = rows.filter((r) => r.member)
  let held = new Map(
    seats.filter((r) => idOf(r.member!.person) == person)
      .map((r) => [idOf(r.member!.space), r]),
  )
  let owners = new Map(
    seats.filter((r) => r.member!.role == 'owner')
      .map((r) => [idOf(r.member!.space), idOf(r.member!.person)]),
  )
  return rows.flatMap((r) => {
    let seat = r.space && held.get(r.entity.eid)
    if (!seat || role && seat.member!.role != role) return []
    return [{
      space: spaceOf(r),
      role: seat.member!.role as Role,
      seat: seat.entity.eid,
      own: !!seat.member!.own,
      owner: owners.get(r.entity.eid),
    }]
  })
}

/** The space marked a person's own (`own`) among the rows `seatsLine`
 * read, if one is. */
export let ownOf = (rows: Row[], person: string): Space | undefined =>
  seatsOf(rows, person, 'owner')
    .find((s) => s.own && s.space.slug != META.space)?.space

// Each seat, grant and invitation among the rows, as `held` answers them.
let heldOf = (rows: ReadRow[]) =>
  rows.flatMap((r): Held[] => {
    let { member: m, grant: g, invite: i } = r
    let at = m
      ? { held: 'seat' as const, on: m.space, who: m.person, role: m.role }
      : g
      ? { held: 'grant' as const, on: g.app, who: g.person, role: g.access }
      : i
      ? { held: 'invite' as const, on: i.to, who: i.person, role: i.role }
      : null
    return at
      ? [{
        eid: r.entity.eid,
        held: at.held,
        on: idOf(at.on),
        person: idOf(at.who),
        role: at.role,
        sent: i?.sent ?? null,
      }]
      : []
  })

/** What to call a person, where their letters go and the number they gave. */
export type Known = { name: string; email: string; phone: string | null }

// Each person among the rows with an address, by eid (`persons`).
let personsOf = (rows: ReadRow[]): Map<string, Known> =>
  new Map(
    rows.flatMap((row) =>
      row.email
        ? [
          [row.entity.eid, {
            name: nameOf(row.doc?.title, row.email.address),
            email: row.email.address,
            phone: row.phone?.number ?? null,
          }] as const,
        ]
        : []
    ),
  )

/** A person's whole listing (tools.ts `app_list`): their seats, the meta
 * space's left out as `seats` leaves it; every app in those spaces and what is
 * bound to each; and, in the spaces they own, who holds or is offered a place
 * in the space or its apps, and what to call each of them (people.ts). */
export type Listing = {
  seats: Seat[]
  apps: App[]
  bound: Bundle[]
  held: Held[]
  persons: Map<string, Known>
}

// The arms of a read answering who holds or is offered a place in the spaces
// `at` walks to, and their apps: each place by the row that holds it and its
// walk to the space, and whom it names by the same walk back from them
// (`people`, `listing`).
let placed = (at: string) => {
  let places = [
    ['member', `space${at}`],
    ['grant', `app.app.space${at}`],
    ['invite', `to${at}`],
    ['invite', `to.app.space${at}`],
  ]
  return [
    ...places.map(([held, to]) => `(.${held}.${to})`),
    ...places.map(([held, to]) =>
      `(.${held}s_person.${held}.${to}&.email&?doc&?phone)`
    ),
  ]
}

// A listing out of the rows one read answered: only what stands in the
// person's spaces is kept, and who is in a space, and what to call them, only
// where they own it, since that is the owner's alone (people.ts).
let listed = (rows: ReadRow[], person: string): Listing => {
  let seats = seatsOf(rows, person).filter((s) => s.space.slug != META.space)
  let spaces = new Set(seats.map((s) => s.space.eid))
  let apps = rows.filter((r) => r.app && spaces.has(idOf(r.app.space)))
    .map(appOf)
  let eids = new Set(apps.map((a) => a.eid))
  let owned = new Set(
    seats.filter((s) => s.role == 'owner').map((s) => s.space.eid),
  )
  let theirs = new Set([
    ...owned,
    ...apps.filter((a) => owned.has(a.space)).map((a) => a.eid),
  ])
  let held = heldOf(rows).filter((h) => theirs.has(h.on))
  let named = new Set(held.map((h) => h.person))
  return {
    seats,
    apps,
    bound: rows.map(({ policy: _, ...row }) => row as Bundle)
      .filter((row) => {
        let app = (row.binding as { app?: Id } | undefined)?.app
        return app != null && eids.has(idOf(app))
      }),
    held,
    persons: new Map([...personsOf(rows)].filter(([eid]) => named.has(eid))),
  }
}

/** The same listing asked the long way, one question after another, over a
 * directory that cannot say it in one read (grants.ts `narrowed`). */
export let listingOf = async (
  dir: Directory,
  person: string,
): Promise<Listing> => {
  let seats = await dir.seats(person)
  let apps = await dir.apps(seats.map((s) => s.space))
  let owned = seats.filter((s) => s.role == 'owner').map((s) => s.space.eid)
  let [bound, { held, persons }] = await Promise.all([
    apps.length
      ? dir.read(`.binding.app=${apps.map((a) => a.eid).join(',')}`)
      : [],
    dir.people(owned),
  ])
  return { seats, apps, bound, held, persons }
}

// Every read carries the directory's revision. The app and the homes it borrows
// from select declarations written by one directory commit.
// Address lookups select one app, routing the app and the front page; the
// bare address of a space reads its roster (`page`), and other roster
// consumers explicitly ask apps().
//
// A request asks once. The door, the reach it answers over and the tool itself
// each ask who the caller is and where they sit, and within one request those
// are one moment, so a line already asked is answered from what came back
// until the request writes to the directory, by this client or any other door
// (hops.ts `recall`). Each answer holds the revision it was read at: every
// directory read is a round trip from wherever the request landed (T-130730).
// What is kept is the text: every caller parses rows of its own.
export let directory = (
  via: Fetcher,
  options: ServingDirectoryOptions = {},
) => {
  let serving = servingDirectory(via, options)
  let door = remote(serving)
  let query = (q: string): Promise<ReadRow[]> =>
    recall(
      META_STORE,
      `${EPOCH} ${q}`,
      () => revised(serving, q),
      true,
      ({ text, revision }) =>
        (JSON.parse(text) as Row[]).map((row) => ({
          ...row,
          policy: { revision },
        })),
    )
  return directoryRows({
    query,
    apply: door.apply,
    get stale() {
      return serving.stale
    },
  })
}

// What this request's reads found, kept with the request (hops.ts `ambient`)
// and answering no other, since a client outlives a request (`directoryOf`
// holds one an isolate long), and shared by every client the request reads
// through, as a line already read is (hops.ts `recall`). Each is kept with
// where the request stood in its directory writes then (hops.ts `wrote`): it
// answers until the request writes there. `apps` is every app of each space a
// page named whole (`page` with `every`) or an Operator reaches (`reaches`),
// by the space's eid, so a request asks a space's apps once. `invited` is the
// invitations standing for the person a page asked about, by the space or app
// each is to, so `invite` asks nothing more of them; a space or app the read
// held with no invitation to it is known to have none.
type Found = {
  apps: Map<string, { at: number; apps: App[] }>
  invited?: {
    at: number
    person: string
    to: Map<string, { eid: string; role: Role } | null>
  }
}
let requests = new WeakMap<Tally, Found>()
let found = () => {
  let tally = ambient()
  if (!tally) return undefined
  let held = requests.get(tally)
  if (!held) requests.set(tally, held = { apps: new Map() })
  return held
}

// The apps a read found of each of `spaces`, kept for this request's `apps`
// of them, as of where it stood in its directory writes before reading.
let keep = (spaces: Iterable<string>, apps: App[], since?: number) => {
  let mine = found()
  if (!mine || since == null) return
  for (let space of spaces) {
    mine.apps.set(space, {
      at: since,
      apps: apps.filter((app) => app.space == space),
    })
  }
}

/** The directory's decisions over a write's own transaction, for a hook
 * deciding inside it (facets/directory-graph.ts, facets/signin-graph.ts): its
 * reads are the write's, and it writes nothing itself. */
export let inside = (tx: Tx) =>
  directoryRows({
    query: async (q) =>
      (await tx.read(q) as Row[]).map((row) => ({
        ...row,
        policy: { revision: 0 },
      })),
    apply: () => {
      throw new Error('a write decided inside another writes nothing itself')
    },
  })

/** Directory decisions over supplied reads and writes. The binding client
 * above owns revisions, request caching and transport recovery. */
export let directoryRows = (rows: {
  query: (q: string) => Promise<ReadRow[]>
  apply: (
    entities: Bundle[],
    headers: Record<string, string>,
  ) => Promise<Bundle[]>
  readonly stale?: boolean
}) => {
  let query = rows.query
  let one = async (q: string) => (await query(q))[0]
  let held = (to: string, person: string) => {
    let invited = found()?.invited
    return invited?.person == person && invited.at == wrote(META_STORE)
      ? invited.to.get(to)
      : undefined
  }
  let write = (
    mutation: { entities: Bundle[] },
    headers: Record<string, string> = {},
  ): Promise<Bundle[]> =>
    writing(META_STORE, () => rows.apply(mutation.entities, headers))
  // What a filter on one person answers. A filter resolves an eid to an
  // entity, so a person the meta store has never seen — someone who signed in
  // before it kept a row — makes the question itself unanswerable: no row,
  // nothing held. Nobody at all (an empty person, `member` below) holds
  // nothing either. Both are asked at once, since `seated` is the first step
  // of every signed-in call (mcp.ts `door`) and each read waited on in turn is
  // a round trip under every tool; the answer for a person with no row is
  // never read, and its refusal is nobody's to report.
  let theirs = async (person: string, line: string) => {
    if (!person) return []
    let asked = query(line)
    if (!(await one(`.entity.eid=${person}`))) {
      asked.catch(() => {})
      return []
    }
    return await asked
  }
  // The `operator_reach` rows on one side, each with the live space on the
  // other, in one read: of the space by its eid, or by a walk to it, kept to
  // its eid once known.
  let reaching = async (
    side: 'space' | 'operator',
    other: 'space' | 'operator',
    on: string | Walk,
  ): Promise<Reach[]> => {
    let at = typeof on == 'string' ? `=${on}` : on.path
    let reached = `.operator_reachs_${other}.operator_reach.${side}${at}`
    // The spaces an Operator reaches come with their apps, which is what it
    // asks of them next (grants.ts `narrowed`): this request's `apps` of
    // them is answered from this read.
    let withApps = other == 'space'
    let since = wrote(META_STORE)
    let [got, eid] = await Promise.all([
      query(
        `(.operator_reach.${side}${at})` +
          `|(.space&${reached}&${SPACE_ABOUT})` +
          (withApps ? `|(.app.space${reached}&${ABOUT})` : ''),
      ),
      typeof on == 'string' ? on : on.eid,
    ])
    let rows = got.filter((r) =>
      r.operator_reach && idOf(r.operator_reach[side]) == eid
    )
    let spaces = new Map(
      got.filter((r) => r.space).map((r) => [r.entity.eid, spaceOf(r)]),
    )
    if (withApps) {
      keep(
        spaces.keys(),
        got.filter((r) => r.app).map(appOf),
        since,
      )
    }
    return rows.flatMap((r) => {
      let space = spaces.get(idOf(r.operator_reach![other]))
      return space && !space.trashed
        ? [{
          eid: r.entity.eid,
          space,
          role: r.operator_reach!.role,
          ...r.operator_reach!.by ? { by: idOf(r.operator_reach!.by) } : {},
        }]
        : []
    })
  }
  // Named, because two of the questions below are asked in terms of the
  // others: a person's own space is read, minted, and read back.
  let self = {
    get stale() {
      return !!rows.stale
    },
    // Ask again what this request already asked: what another request wrote
    // since is read, rather than this request's first answer (versions.ts
    // `waiting` watches another's release lift its fence).
    reread: () => forget(META_STORE),
    // A write that changes the directory: a batch of bundles, each minting at
    // an eid its author chose (T-32455), answered as applied.
    apply: write,
    // One filter line, answered as rows: a read the questions below don't
    // name (connections.ts `connectionsOf`), asked through this client so it
    // travels with whatever else this moment asks.
    read: async (line: string): Promise<Bundle[]> =>
      (await query(line)).map(({ policy: _, ...row }) => row as Bundle),
    stamp: (mutation: { entities: Bundle[] }, headers = {}) =>
      write(mutation, { ...headers, 'x-yak-kernel': '1' }),
    space: async (slug: string) => {
      let row = await one(`.space.slug=${slug}&${SPACE_ABOUT}`)
      return row ? spaceOf(row) : null
    },
    // A page needs the space, its two possible apps and the seat of whoever
    // is asking, together. Filtering through app.space and member.space
    // avoids an earlier trip just to learn the space eid; the same
    // authoritative snapshot answers the whole route. `role` is said only
    // when a person was asked about: their role, or null for no seat. With no
    // app named it is the space's bare address, where the front page or else
    // the listing of every app answers, so the read is every app (`roster`,
    // oldest first, as `apps` says) and the listing asks nothing more. A door
    // admitting a call that names an app asks for `every` app too, for what
    // its answer says about the space (agent.ts `answered`).
    page: async (
      slug: string,
      app?: string | null,
      person?: string | null,
      over = false,
      every = !app,
    ) => {
      let at = `.app.space.space.slug=${slug}`
      let which = every ? at : `((${at}&.app.slug=${app})|(${at}&.home))`
      let seat = person
        ? `|(.member.space.space.slug=${slug}&.member.person=${person})` +
          `|(.grant.app.app.space.space.slug=${slug}&.grant.person=${person})` +
          `|(.invite.to.space.slug=${slug}&.invite.person=${person})` +
          `|(.invite.to.app.space.space.slug=${slug}&.invite.person=${person})` +
          `|(.browser.by=${person})` +
          (over
            ? `|(.member.space.space.slug=${META.space}&.member.person=${person})`
            : '')
        : ''
      let epoch = wrote(META_STORE)
      let rows = await query(
        `(.space.slug=${slug}&${SPACE_ABOUT})|(${which}&${ABOUT})${seat}`,
      )
      let mine = epoch != null && epoch == wrote(META_STORE)
        ? found()
        : undefined
      if (mine && person) {
        let to = new Map<string, { eid: string; role: Role } | null>(
          rows.filter((row) => row.space || row.app)
            .map((row) => [row.entity.eid, null]),
        )
        for (let row of rows) {
          if (row.invite && idOf(row.invite.person) == person) {
            to.set(idOf(row.invite.to), {
              eid: row.entity.eid,
              role: row.invite.role,
            })
          }
        }
        mine.invited = { at: epoch!, person, to }
      }
      let page = paged(
        rows,
        rows.find((row) => row.space),
        app,
        person,
        over,
        every,
      )
      if (mine && page.space && page.roster) {
        mine.apps.set(page.space.eid, { at: epoch!, apps: page.roster })
      }
      // The browsers whose guest work the person claimed (attribution.ts
      // `browsersOf`), read in this same trip.
      let said: Page & { browsers?: string[] } = page
      if (person) {
        said = {
          ...page,
          browsers: rows.filter((row) =>
            row.browser?.by && idOf(row.browser.by) == person
          ).map((row) => instrumentEid(row.entity.eid)),
        }
      }
      return said
    },
    // The same for a space named by its eid, as an object keyed by it knows
    // it (build.ts `#operate`): the space and the seat of whoever is asking,
    // in one read, and no apps.
    seat: async (eid: string, person: string, over = false) => {
      let rows = await query(
        `(.entity.eid=${eid}&.space&${SPACE_ABOUT})` +
          `|(.member.space=${eid}&.member.person=${person})` +
          (over
            ? `|(.member.space.space.slug=${META.space}&.member.person=${person})`
            : ''),
      )
      return paged(
        rows,
        rows.find((row) => row.space && row.entity.eid == eid),
        null,
        person,
        over,
        false,
      )
    },
    // The page of the one space among the person's seats holding a live app
    // at `app`: what a call naming an app and no space means (tool.ts
    // `ownSpace`), in the same one snapshot as `page`. `holding` is every
    // such space, so a caller whose two spaces each hold the app is asked
    // which, and `page` is said only when one does. The meta space is the
    // platform's, never a space a call means without naming it. Null is a
    // directory that cannot say it in one read (grants.ts `narrowed`), and
    // the caller asks the long way.
    holding: async (
      app: string,
      person: string,
      over = false,
      every = false,
    ): Promise<{ holding: Space[]; page: Page | null } | null> => {
      if (!person) return { holding: [], page: null }
      let mine = `members_space.member.person=${person}`
      let held = `apps.app.slug=${app}`
      let which = every
        ? `.app.space.${mine}&.app.space.${held}`
        : `(.app.slug=${app}&.app.space.${mine})|` +
          `(.home&.app.space.${mine}&.app.space.${held})`
      let rows = await query(
        `(.space&.${mine}&.${held}&${SPACE_ABOUT})|(${which}&${ABOUT})` +
          `|(.member.person=${person})` +
          `|(.grant.person=${person}&.grant.app.app.space.${held})` +
          (over ? `|(.space.slug=${META.space})` : ''),
      )
      let meta = rows.find((row) => row.space?.slug == META.space)
      let apps = rows.filter((row) => row.app).map(appOf)
      let holding = rows.filter((row) =>
        row.space && row !== meta &&
        apps.some((one) =>
          one.slug == app && !one.trashed && one.space == row.entity.eid
        )
      ).map(spaceOf).filter((space) => !space.trashed)
      if (holding.length != 1) return { holding, page: null }
      let [space] = holding
      // The page's rows: this space's own, and the caller's seat in the
      // platform's where the door says `over`.
      let theirs = new Set(
        apps.filter((one) => one.space == space.eid).map((one) => one.eid),
      )
      let here = (eid: Id) =>
        idOf(eid) == space.eid || over && idOf(eid) == meta?.entity.eid
      let own = rows.filter((row) =>
        row.space
          ? row.entity.eid == space.eid
          : row.app
          ? idOf(row.app.space) == space.eid
          : row.member
          ? here(row.member.space)
          : !!row.grant && theirs.has(idOf(row.grant.app))
      )
      return {
        holding,
        page: paged(
          own,
          own.find((row) => row.space),
          app,
          person,
          over,
          every,
        ),
      }
    },
    // A person's whole listing in one read (tools.ts `app_list`): one
    // snapshot of every row reached from the person's own seats, so nothing
    // in it waits on ids an earlier read learned. Who is in their spaces, and
    // what to call them, is read in each of them and kept only where they own
    // it (`listed`), since no one hop says "a seat of theirs that is an
    // owner's".
    listing: async (person: string): Promise<Listing> => {
      if (!person) return listed([], person)
      let mine = `members_space.member.person=${person}`
      let rows = await query(
        [
          `(.member.person=${person})`,
          `(.space&.${mine}&${SPACE_ABOUT})`,
          `(.app.space.${mine}&${ABOUT})`,
          `(.binding.app.app.space.${mine})`,
          ...placed(`.${mine}`),
        ].join('|'),
      )
      return listed(rows, person)
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
    // The space an address reaches: the one living there, else the one that
    // left it and still answers there. What a letter, a webhook and a clone
    // aimed at an old address follow (inbox.ts, connections.ts `hook`,
    // git_door.ts) and are served by where they land, since none of their
    // senders follows a redirect — the hostname's pages redirect instead
    // (apps.ts `served`). Asked in that order, so a space living at the name
    // always wins it.
    answering: async (slug: string) =>
      await self.space(slug) ?? await self.formerly(slug),
    // The same one level down: the app at an address in its space, else the
    // app that left it.
    answeringApp: async (space: Space, slug: string) =>
      await self.app(space, slug) ?? await self.former(space, slug),
    // What taking `slug` costs the space it still redirects for (D-131924).
    // An address a space has left is anyone's to claim — Jeff: the old name is
    // free for someone else — and the claim drops it from that space's
    // history in the same write, so every door at the name (its hostname, its
    // letters, its hooks) reaches the claimant alone, and no later move of
    // the claimant can hand it back. Nothing for a name that redirects for
    // nobody, or for `by` itself moving back to where it was.
    claimed: async (slug: string, by?: string): Promise<Bundle[]> => {
      let was = await self.formerly(slug)
      if (!was || was.eid == by) return []
      return [{
        entity: { eid: was.eid },
        former: addresses(was.slugs.filter((s) => s != slug)),
      }]
    },
    // A space minted at `slug`, owned by `person`: the batch both doors that
    // make one write (tools.ts `space_new`, `own` below) — the person's own
    // row (they may have none yet), the space with its handle and its
    // Operator's name, clear of the Operators they already reach, their seat,
    // and the name taken from a space it still redirected for. The eid is
    // minted here rather than by a `$alias` the store resolves, because the
    // handle is made out of it and there is no second moment to write it in
    // (`spaceHandle`); a bundle mints at an eid its author chose (T-32455).
    // A person's first space draws the starter (meter.ts `STARTER`) and the
    // person wears `started` from then on; a space minted for someone who
    // owns one already, or who has had theirs, holds none. Both are the
    // platform's to say, and so is taking a name from another space, so the
    // batch is the kernel's. Answers the eid.
    mint: async (
      person: string,
      slug: string,
      title: string,
      headers: Record<string, string>,
      own = false,
    ) => {
      let { eid, entities } = await self.minting(person, slug, title, own)
      await self.stamp({ entities }, headers)
      return eid
    },
    // What minting that space writes, read and decided here and written by
    // whoever asked: `mint` above, or the directory itself inside the write
    // that mints a person their own (`owning`).
    minting: async (
      person: string,
      slug: string,
      title: string,
      own = false,
    ) => {
      let eid = crypto.randomUUID()
      let [claims, seats, row] = await Promise.all([
        self.claimed(slug),
        self.seats(person),
        one(`.entity.eid=${person}&?started`),
      ])
      let name = christened(
        eid,
        seats.map((s) => ({ eid: s.space.eid, name: s.space.operator })),
      )
      let first = !row?.started && !seats.some((s) => s.role == 'owner')
      return {
        eid,
        entities: [
          {
            entity: { eid: person },
            person: {},
            ...(first ? { started: { space: eid } } : {}),
          },
          {
            entity: { eid },
            doc: { title },
            space: { slug, store: spaceHandle(slug, eid) },
            operator: { name },
            ...(first ? {} : { starter: { dollars: 0 } }),
          },
          // Its eid chosen here too, not a `$seat` the store resolves: a
          // batch decided inside a write (`owning`) is past resolving one.
          {
            entity: { eid: crypto.randomUUID() },
            member: {
              space: eid,
              person,
              role: 'owner',
              ...(own ? { own } : {}),
            },
          },
          ...claims,
        ] as Bundle[],
      }
    },
    // A space moved to another address, retitled, or made to forget one it
    // left: the one write behind both doors that do it (tools.ts `space_set`,
    // identity.ts `choose`). Nothing but directory rows change. The handle
    // stays where it is, so no byte moves (D-131924); the address left joins
    // the space's history and redirects until another space takes it, and
    // the address moved onto is taken from whichever space still redirected
    // there. Answers the space as it now stands.
    rename: async (
      space: Space,
      change: {
        slug?: string | null
        title?: string | null
        forget?: string | null
      },
      headers: Record<string, string>,
    ): Promise<Space> => {
      let to = change.slug ?? space.slug
      let moving = to != space.slug
      let had = kept(space.slug, space.slugs, moving, change.forget ?? null)
      let claims = moving ? await self.claimed(to, space.eid) : []
      await (claims.length ? self.stamp : self.apply)({
        entities: [{
          entity: { eid: space.eid },
          ...(change.title == null ? {} : { doc: { title: change.title } }),
          ...(moving ? { space: { slug: to } } : {}),
          ...(had ? { former: addresses(had.filter((s) => s != to)) } : {}),
        }, ...claims],
      }, headers)
      return (await self.at(space.eid))!
    },
    // The space whose apps' visitors may spend `percent` of its month budget
    // together (meter.ts `visiting`) and one of them `calls` model calls a
    // day (meter.ts `visitorCalls`); what is not given stays as it was.
    welcome: async (
      space: Space,
      share: { percent?: number | null; calls?: number | null },
      headers: Record<string, string>,
    ): Promise<Space> => {
      let percent = share.percent ?? space.visitors
      let calls = share.calls ?? space.visitorCalls
      await self.apply({
        entities: [{
          entity: { eid: space.eid },
          visitor_share: {
            ...percent == null ? {} : { percent },
            ...calls == null ? {} : { calls },
          },
        }],
      }, headers)
      return (await self.at(space.eid))!
    },
    // The space wearing the picture at `sha`, or none (apps.ts `logoed`).
    badge: async (
      space: Space,
      logo: { sha: string; type: string } | null,
      headers: Record<string, string>,
    ): Promise<Space> => {
      await self.apply({
        entities: [{ entity: { eid: space.eid }, space_logo: logo }],
      }, headers)
      return (await self.at(space.eid))!
    },
    app: async (space: Space, slug: string) => {
      let row = await one(
        `.app.space=${space.eid}&.app.slug=${slug}&${ABOUT}`,
      )
      return row ? appOf(row) : null
    },
    binned: async (space: Space, name: string) => {
      let pair = minted(name) ? await self.appAt(name) : null
      if (pair?.space.eid == space.eid) return pair.app
      let current = await self.app(space, name)
      if (current) return current
      let trash = (await self.apps(space)).filter((app) =>
        app.trashed && app.slug == name
      )
      return trash.length == 1 ? trash[0] : null
    },
    claimApp: async (
      space: Space,
      slug: string,
      by?: string,
    ): Promise<Bundle[]> => {
      let was = await self.former(space, slug)
      return was && was.eid != by
        ? [{
          entity: { eid: was.eid },
          former: addresses(was.slugs.filter((s) => s != slug)),
        }]
        : []
    },
    // What routing a path asks (apps.ts): the app at its address and the
    // space's front page, whose router may claim the path first. One read
    // answers both, so a page view asks the directory about its apps once,
    // and each arm of the union is its own index seek (@yaks/sql seeks a
    // disjunction an index narrows), never the space's roster. With no
    // address, the front page alone.
    routing: async (space: Space, slug?: string | null) => {
      let at = `.app.space=${space.eid}`
      let which = slug
        ? `((${at}&.app.slug=${slug})|(${at}&.home))`
        : `${at}&.home`
      let apps = (await query(`${which}&${ABOUT}`)).map(appOf)
      return {
        app: apps.find((app) => app.slug == slug) ?? null,
        home: apps.find((app) => app.home && !app.trashed) ?? null,
      }
    },
    // An address the app has left, still pointing at it. A rename moves
    // `app.slug` and keeps the old address in the app's `former`, so the answer
    // is the app of this space that still answers to the address asked for —
    // a move to follow (T-32576: a rename used to strand every open page).
    former: async (space: Space, slug: string) => {
      let app = (await self.apps(space))
        .find((a) => !a.trashed && a.slug != slug && a.slugs.includes(slug))
      return app ?? null
    },
    // Every app in a space, oldest first — the order they were made. Many
    // spaces is one read rather than one per space, because a person's whole
    // listing is one question (tools.ts `app_list`, T-35431); the answer is
    // still one flat list, and a caller wanting them per space groups by
    // `app.space`. A space named by the walk to what names it (`.space.slug=
    // ada`, @yaks/connections `Path`) is asked before its eid is known, beside
    // whatever learns it; a walk reaching several answers each one's apps.
    apps: async (
      space: Pick<Space, 'eid'> | Pick<Space, 'eid'>[] | { path: string },
    ): Promise<App[]> => {
      if ('path' in space) {
        return (await query(`.app.space${space.path}&${ABOUT}`)).map(appOf)
      }
      let eids = [space].flat().map((s) => s.eid)
      if (!eids.length) return []
      let held = found()?.apps
      let read = eids.map((eid) => held?.get(eid))
      if (read.every((r) => r && r.at === wrote(META_STORE))) {
        return structuredClone(read.flatMap((r) => r!.apps))
      }
      return (await query(`.app.space=${eids.join(',')}&${ABOUT}`))
        .map(appOf)
    },
    // The space that pays as this customer of the payment provider
    // (billing.ts). It is how a
    // subscription event is attributed when its metadata does not say — a
    // space keeps one customer for its whole life, so the answer is one space
    // or nobody.
    payer: async (customer: string) => {
      let row = await one(
        `.plan.customer=${customer}&.space&${SPACE_ABOUT}`,
      )
      return row?.space ? spaceOf(row) : null
    },
    // The space that sells through this connected account at the provider
    // `via` (sell.ts). The provider's webhook's only way in: an event from a
    // connected account names its id and nothing of ours, so this is what
    // turns it back into a space. One account per space, so the answer is one
    // space or nobody — and nobody is an event about somebody else's
    // platform, or one for a space that has since disconnected.
    seller: async (via: string, account: string) => {
      let row = await one(
        `.seller.via=${via}&.seller.account=${account}&.space&${SPACE_ABOUT}`,
      )
      return row?.space ? spaceOf(row) : null
    },
    // A space by eid, which is how an app names the space it belongs to.
    at: async (eid: string) => {
      let row = await one(`.entity.eid=${eid}`)
      return row?.space ? spaceOf(row) : null
    },
    // One app by eid, with the space it belongs to — what an installed app's
    // pin names (`installed.of`), and how an offer is read back.
    appAt: async (eid: string) => {
      let row = await one(`.entity.eid=${eid}`)
      if (!row?.app) return null
      let app = appOf(row)
      let space = await self.at(app.space)
      if (!space) return null
      let selected = (await self.apps(space)).find((one) => one.eid == eid)
      return selected ? { space, app: selected } : null
    },
    // A target a tool holds, read again by identity in one round trip, as it
    // is after a directory commit (tool.ts `reacquire`): the space, the app
    // when one is held and still in it, and the person's role there, null for
    // no seat. Asked one after another these were four round trips, three
    // times in every deploy (T-130730).
    target: async (space: string, person: string, app?: string | null) => {
      let rows = await query(
        [
          `(.entity.eid=${space}&.space&${SPACE_ABOUT})`,
          ...app ? [`(.entity.eid=${app}&.app&${ABOUT})`] : [],
          // Never for nobody, as `member` says.
          ...person
            ? [`(.member.space=${space}&.member.person=${person})`]
            : [],
        ].join('|'),
      )
      let found = rows.find((r) => r.space && r.entity.eid == space)
      let named = rows.find((r) =>
        r.app && r.entity.eid == app && idOf(r.app.space) == space
      )
      let seat = rows.find((r) =>
        r.member && idOf(r.member.person) == person &&
        idOf(r.member.space) == space
      )
      return {
        space: found ? spaceOf(found) : null,
        app: named ? appOf(named) : null,
        role: seat?.member?.role ?? null,
      }
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
      let row = await one(`.hostname.name=${host}&?verified`)
      if (!row?.hostname) return null
      let eid = idOf(row.hostname.serves)
      let aimed = hostOf(row)
      let at = await self.appAt(eid)
      if (at) {
        return { space: at.space, app: at.app as App | null, host: aimed }
      }
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
      return (await query('.hostname&?verified')).map(hostOf)
        .filter((h) => mine.has(h.serves))
    },
    // The app offered under a platform-wide name (T-32888), with the space it
    // came from — an offer is an app, so this is one row read two ways.
    offered: async (name: string) => {
      let row = await one(`.published.name=${name}&.app`)
      return row?.app ? await self.appAt(row.entity.eid) : null
    },
    // The skill offered under a platform-wide name, or one by its eid, with
    // the space it came from: a trashed space offers nothing, as `offering`
    // screens it (shared-skill.ts).
    skillOffered: async (
      at: { name: string } | { eid: string },
    ): Promise<{ space: Space; skill: SkillOffer } | null> => {
      let key = 'name' in at
        ? `.published.name=${at.name}`
        : EID.test(at.eid)
        ? `.entity.eid=${at.eid}&.published`
        : null
      if (!key) return null
      let row = await one(
        `${key}&.skill&?doc&?content&?gallery&?upstream&?code_review&?featured`,
      )
      let skill = row ? skillOfferOf(row) : null
      let space = skill ? await self.at(skill.space) : null
      return skill && space && !space.trashed ? { space, skill } : null
    },
    // Every skill on offer, newest first, with its space.
    skillOffers: async (): Promise<{ space: Space; skill: SkillOffer }[]> => {
      let skills = (await query(
        '.published&.skill&?doc&?content&?gallery&?upstream&?code_review&?featured',
      ))
        .flatMap((r) => skillOfferOf(r) ?? [])
        .sort((a, b) => b.published.at.localeCompare(a.published.at))
      let spaces = new Map<string, Space | null>()
      for (let { space } of skills) {
        if (!spaces.has(space)) spaces.set(space, await self.at(space))
      }
      return skills.flatMap((skill) => {
        let space = spaces.get(skill.space)
        return space && !space.trashed ? [{ space, skill }] : []
      })
    },
    // What the spaces that installed `of` made of it, credited to `maker`,
    // the space that shared it ({@link Uptake}).
    uptake: async (of: string, maker: string): Promise<Uptake> =>
      (await self.uptakes([{ of, maker }])).get(of) ?? NO_UPTAKE,
    // The same for many at once: each `of`'s uptake by its eid, as a listing
    // shows them (T-160642).
    uptakes: async (made: { of: string; maker: string }[]) =>
      self.uptaken(
        await self.installers(made),
        (of) => of,
        made.map((m) => m.of),
      ),
    // The spaces that installed each `of`, by its eid, never its maker's own
    // (T-131912): those with an `install` row for it, and for an app those
    // holding a copy, which also answers for copies made before installs
    // were recorded. A space counts once, however often it installs or
    // deletes its copy.
    installers: async (
      made: { of: string; maker: string }[],
    ): Promise<Map<string, Set<string>>> => {
      let ofs = [...new Set(made.map((m) => m.of).filter((of) => EID.test(of)))]
      let spaces = new Map(ofs.map((of) => [of, new Set<string>()]))
      if (ofs.length) {
        let list = ofs.join(',')
        for (
          let r of await query(
            `(.install.of=${list})|(.installed.of=${list}&.app)`,
          )
        ) {
          let of = r.install?.of ?? r.installed?.of
          let at = r.install?.space ?? r.app?.space
          if (of && at) spaces.get(idOf(of))?.add(idOf(at))
        }
      }
      for (let { of, maker } of made) spaces.get(of)?.delete(maker)
      return spaces
    },
    // The uptake of each integration named (T-160642), by its name.
    integrationUptakes: async (
      all: { name: string; owner?: string | null }[],
    ) =>
      self.uptaken(
        await self.integrationInstallers(all),
        integrationEid,
        all.map((i) => i.name),
      ),
    // The spaces other than its owner's that hold a connection through each
    // integration named, by the integration's eid (`integrationEid`): an
    // integration's installs.
    integrationInstallers: async (
      all: { name: string; owner?: string | null }[],
    ): Promise<Map<string, Set<string>>> => {
      // A name is somebody's words, which a line would have to quote, so only
      // a plain name is asked by; the connections are compared after the read.
      let names = all.map((i) => i.name).filter((n) => /^[\w.-]+$/.test(n))
      let spaces = new Map(all.map((i) => [i.name, new Set<string>()]))
      if (names.length) {
        for (
          let r of await query(`.connection.integration=${names.join(',')}`)
        ) {
          let c = (r as Row & {
            connection?: { integration?: string; owner?: Id | null }
          }).connection
          if (c?.integration && c.owner) {
            spaces.get(c.integration)?.add(idOf(c.owner))
          }
        }
      }
      // A person's own connection is no space's install.
      let owners = [...new Set([...spaces.values()].flatMap((s) => [...s]))]
        .filter((eid) => EID.test(eid))
      let spaced = new Set(
        owners.length
          ? (await query(`.entity.eid=${owners.join(',')}&.space`))
            .map((r) => r.entity.eid)
          : [],
      )
      return new Map(all.map(({ name, owner }) => [
        integrationEid(name),
        new Set([...spaces.get(name) ?? []]
          .filter((at) => spaced.has(at) && at != owner)),
      ]))
    },
    // Each key's uptake, from the spaces that installed each thing (by its
    // eid, which `eid` finds from a key) and how they rate it.
    uptaken: async <K extends string>(
      installed: Map<string, Set<string>>,
      eid: (key: K) => string,
      keys: K[],
    ): Promise<Map<K, Uptake>> => {
      let rated = await self.rated(installed)
      return new Map(keys.map((key) => {
        let at = eid(key)
        return [key, {
          installs: installed.get(at)?.size ?? 0,
          rated: rated.get(at) ?? null,
        }]
      }))
    },
    // How each thing is rated by the spaces that installed it, given those
    // spaces by its eid (T-160643): the latest `rating` from each counts
    // once. A rating from any other space is kept, and not counted.
    rated: async (
      installed: Map<string, Set<string>>,
    ): Promise<Map<string, Rated>> => {
      let ofs = [...installed.keys()].filter((of) => EID.test(of))
      if (!ofs.length) return new Map()
      return ratedBy(
        await query(`.rating.of=${ofs.join(',')}&?created`),
        installed,
      )
    },
    // That someone in `space` rated `of` ({@link ratingOf}), as them.
    rate: (
      of: string,
      space: string,
      stars: number,
      why: string | undefined,
      headers = {},
    ) => self.stamp({ entities: [ratingOf(of, space, stars, why)] }, headers),
    // Record that `space` installed `of` ({@link installOf}).
    install: (of: string, space: string, headers = {}) =>
      self.stamp({ entities: [installOf(of, space)] }, headers),
    // Every offer standing, newest first — what a person's agent browses. Its
    // spaces are found from their published apps, so it reads rows in
    // proportion to the offers, never to the directory (T-143237).
    offers: async (): Promise<OnOffer[]> =>
      offering(
        await query(
          `(.published&.app&${ABOUT})|(.space&.apps.published&${SPACE_ABOUT})`,
        ),
      ),
    // One app's offer, or null: the app with the space its `app.space` names,
    // in the same one round trip, screened as `offers` screens it.
    offer: async (eid: string): Promise<OnOffer | null> =>
      EID.test(eid)
        ? offering(
          await query(
            `(.entity.eid=${eid}&.published&.app&${ABOUT})|` +
              `(.space&.app.space[<=1]<-${eid}&${SPACE_ABOUT})`,
          ),
        )[0] ?? null
        : null,
    // The integration directory (T-132636): every built integration and every
    // custom one its owner listed, which anyone may read, signed in or not
    // (integrations.ts).
    integrations: (words?: string): Promise<Listed[]> =>
      listing((q) => query(String(q)) as Promise<Bundle[]>, words),
    switches: async (app: App) =>
      (await query(`.switched.app=${app.eid}`)).map((row) => ({
        ...row,
        switched: row.switched && {
          ...row.switched,
          by: row.switched.by ? idOf(row.switched.by) : null,
          via: row.switched.via ? idOf(row.switched.via) : null,
        },
      })),
    // What was written into an app's files (drafts.ts): every row it keeps,
    // or one draft's alone. Never cached: a write reads its own draft back.
    written: async (app: App, draft?: string) =>
      (await query(
        `.written.app=${app.eid}${draft ? `&.written.draft=${draft}` : ''}`,
      )).map(writtenOf),
    // The file an app published at a path, or none (public-files.ts). Its
    // eid is derived from the two, so this asks for one row by its eid.
    publicFile: async (app: App, path: string) => {
      let row = await one(
        `.entity.eid=${identityEid('public_file', [app.eid, path])}` +
          '&.public_file',
      )
      return row?.public_file ? publicFileOf(row) : null
    },
    // Every file an app published, by path.
    publicFiles: async (app: App) =>
      (await query(`.public_file.app=${app.eid}`))
        .map(publicFileOf)
        .sort((a, b) => a.path.localeCompare(b.path)),
    // Every deploy of an app, newest first — the versions app_versions pages
    // through, app_rollback picks from, and the retention sweep marks live
    // bytes off (versions.ts). None is ever buried, so this grows with the
    // app; a manifest is a few hundred bytes and git derives its commit chain
    // from them (D-34942). Never cached: a deploy reads its own versions back
    // the moment it writes one.
    deploys: async (app: Pick<App, 'eid'>) =>
      (await query(`.deploy.app=${app.eid}&?created`))
        .map(deployOf)
        .sort((a, b) => b.version - a.version),
    // When each app of a space was made and last put live, and by whom
    // (T-151161): its `created` and `last_deploy`, and for an app last
    // deployed before `last_deploy` was kept, its newest release's `created`.
    // With them, what each writer is called (stamps.ts `writers`), so a page
    // says every one the same way. Asked by the walk to the space, every line
    // at once, so a page asks it beside the read that learns its space and it
    // travels in that trip (`walkTo`).
    provenance: async (space: Walk) => {
      let apps = `app.space${space.path}`
      // Each stamp's writer comes back beside the row it stamps, as a bundle
      // of its own (@yaks/graph projections): their names, and for an agent
      // the person it writes for and theirs.
      let names = ['doc.title', 'email.address', 'phone.number']
      let who = (stamp: string) => [
        `${stamp}.at`,
        ...[
          ...names,
          'acts_for.person',
          ...names.map((n) => `acts_for.person.${n}`),
        ]
          .map((n) => `${stamp}.by.${n}`),
      ]
      let [made, releases] = await Promise.all([
        query(
          `.${apps}&?created&?last_deploy` +
            `&.fields=${[...who('created'), ...who('last_deploy')]}`,
        ),
        query(
          `.deploy.app.${apps}&!deploy.app.last_deploy&?created` +
            `&.fields=deploy.app,${who('created')}`,
        ),
      ])
      let of = new Map<string, { made: Stamp | null; deployed: Stamp | null }>()
      let by = new Set<string>()
      let stamped = (s: { by?: Id | null } | undefined) => {
        if (s?.by) by.add(idOf(s.by))
        return stampOf(s)
      }
      for (let r of made) {
        if (!r.created && !r.last_deploy) continue
        of.set(r.entity.eid, {
          made: stamped(r.created),
          deployed: stamped(r.last_deploy),
        })
      }
      for (let r of releases) {
        if (!r.deploy) continue
        let app = idOf(r.deploy.app), at = stamped(r.created)
        let was = of.get(app) ?? { made: null, deployed: null }
        if (at && at.at > (was.deployed?.at ?? '')) was.deployed = at
        of.set(app, was)
      }
      let rows = [...made, ...releases]
      let theirs = new Set(principals(rows.filter((r) => by.has(r.entity.eid))))
      let named = rows.filter((r) =>
        by.has(r.entity.eid) || theirs.has(r.entity.eid)
      )
      return { of, writers: writers(named) }
    },
    // What each writer is called (stamps.ts `writers`): a person, or an agent
    // for its person, whose row is read beside it.
    writers: async (eids: string[]): Promise<Map<string, string>> => {
      let ids = [...new Set(eids)]
      if (!ids.length) return new Map()
      let rows = await query(`.entity.eid=${ids.join(',')}`)
      let more = principals(rows).filter((p) => !ids.includes(p))
      return writers([
        ...rows,
        ...more.length ? await query(`.entity.eid=${more.join(',')}`) : [],
      ])
    },
    // One release of the app, by its version.
    deployAt: async (app: App, version: number) => {
      let row = await one(
        `.deploy.app=${app.eid}&.deploy.version=${version}&?created`,
      )
      return row?.deploy ? deployOf(row) : null
    },
    // A toolkit remake keeps the deploy's version and records its new
    // source in the switch history. Both histories own immutable assets a
    // page already open may still load, as the blob sweep keeps them.
    released: async (app: App, source: string) =>
      !!(await one(
        `(.deploy.app=${app.eid}&.deploy.source=${source})|` +
          `(.switched.app=${app.eid}&.switched.source=${source})`,
      )),
    // Every time this app's store was put back to a moment, newest first
    // (recover.ts, T-34507). Never cached, for the reason `deploys` is not: a
    // restore reads its own trail back the moment it writes to it.
    restores: async (app: App) =>
      (await query(`.restored.app=${app.eid}`))
        .map(restoreOf)
        .sort((a, b) => b.at.localeCompare(a.at)),
    // Every space there is. Only the meter asks this (usage.ts): a tool
    // always works in one space, and a person only ever sees their own.
    all: async (): Promise<Space[]> =>
      (await query(`.space&${SPACE_ABOUT}`)).map(spaceOf),
    // Every person, space, app, seat and invite there is, each row whole with
    // when it was made and last used: the platform admin's directory
    // (admin.ts), and nothing else, asks this. Fresh, since the admin opens it
    // to see what is. A person says the number they text from, which space
    // their starter went to, and when they came in by the home page's box.
    census: async () => {
      let stamps = '?created&?used'
      let [people, spaces, apps, seats, deploys, referrals, agents] =
        await Promise.all([
          query(
            `.person&?doc&?email&?phone&?signed_in&?started&?newcomer&${stamps}`,
          ),
          // A row's days ride only here: every other read of a row does
          // without.
          query(`.space&${SPACE_ABOUT}&?trend&?visitor_build&${stamps}`),
          query(
            `.app&${ABOUT}&?trend&${stamps}&?changed&?errored&?last_deploy`,
          ),
          query('.member'),
          // Only which app, when and by whom: a release's whole row is its
          // file list.
          query('.deploy&.fields=deploy.app,created.at,created.by'),
          query('.referral&?rewarded&?created'),
          // The agents a stamp may name (stamps.ts `writers`).
          query('.acts_for&?doc'),
        ])
      return { people, spaces, apps, seats, deploys, referrals, agents }
    },
    // The app that answers the space's bare hostname, if it has one: the one
    // in this space wearing `home` (T-34227). At most one does — `homing`
    // below is the rule — so the first row is the answer.
    // A trashed app is nobody's front page (erase.ts, T-34430): the word
    // stays on it so a restore puts the space back exactly as it was, and
    // until then the space is one with no front page — which is the ordinary
    // state and already has an answer everywhere.
    home: async (space: Space) => (await self.routing(space)).home,
    // A person's membership row: the eid, so an invite can revise or remove
    // the one that stands, and the role, which is the same question asked
    // shorter.
    member: async (space: Pick<Space, 'eid'>, person: string) => {
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
    role: async (space: Pick<Space, 'eid'>, person: string) =>
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
      let known = held(to, person)
      if (known !== undefined) return known
      let row = await one(`.invite.to=${to}&.invite.person=${person}`)
      return row?.invite ? { eid: row.entity.eid, role: row.invite.role } : null
    },
    // One invitation by the eid its letter carries, and who sent its latest
    // letter, when one went. Fresh, because the click that accepts it is
    // often the second one on the same letter.
    invitation: async (eid: string) => {
      let row = await one(`.entity.eid=${eid}`)
      return row?.invite
        ? {
          eid: row.entity.eid,
          to: idOf(row.invite.to),
          person: idOf(row.invite.person),
          role: row.invite.role,
          by: row.invite.by ? idOf(row.invite.by) : null,
        }
        : null
    },
    // Everyone holding or offered a place in these spaces and their apps, by
    // their eids or a walk to them: each seat, each guest's grant and each
    // invitation standing, and what to call each of those people, in one read
    // however many there are (people.ts gives it its shape, keeping what is
    // of the space it draws). Fresh, because the page showing it is the page
    // an invitation was just sent again from.
    people: async (
      spaces: string[] | { path: string },
    ): Promise<Pick<Listing, 'held' | 'persons'>> => {
      if (Array.isArray(spaces) && !spaces.length) {
        return { held: [], persons: new Map() }
      }
      let at = 'path' in spaces ? spaces.path : `=${spaces.join(',')}`
      let rows = await query(placed(at).join('|'))
      return { held: heldOf(rows), persons: personsOf(rows) }
    },
    // How many invitations this person has sent in the hour it names. Fresh:
    // two invitations a second apart must not both read the same count.
    inviting: async (person: string) =>
      (await one(`.entity.eid=${person}`))?.inviting ?? null,
    // The code this person's invite carries (referral.ts), or null for one
    // whose invite page never opened.
    referralCode: async (person: string) =>
      (await one(`.entity.eid=${person}`))?.referral_code?.code ?? null,
    // Whose invite carries this code, by person eid, or null.
    referrer: async (code: string) =>
      (await one(`.referral_code.code=${JSON.stringify(code)}`))?.entity.eid ??
        null,
    // Who signed up through somebody's invite, and the month each one gave
    // once they built an app (referral.ts): those `inviter` invited, or
    // everybody's, newest first.
    referrals: async (inviter?: string): Promise<Referral[]> =>
      (await query(
        `${
          inviter ? `.referral.inviter=${inviter}` : '.referral'
        }&?rewarded&?created&.order=-created.at`,
      )).flatMap(referralOf),
    // The referral that brought this person in, or null.
    referral: async (invitee: string): Promise<Referral | null> =>
      (await query(`.referral.invitee=${invitee}&?rewarded&?created`))
        .flatMap(referralOf)[0] ?? null,
    // Whether this person has built an app of their own: one in a space they
    // own that is not a copy of somebody else's.
    built: async (person: string) => {
      let spaces = await self.spaces(person, 'owner')
      return (await self.apps(spaces)).some((a) => !a.installed)
    },
    // Everyone in a space, by person eid — who to tell when an app's tools
    // move (declared.ts `toolsChanged`), since reaching the app is exactly
    // being in the space.
    members: async (space: Space): Promise<string[]> =>
      (await query(`.member.space=${space.eid}`))
        .map((r) => r.member && idOf(r.member.person))
        .filter((p): p is string => !!p),
    // Who owns a space, by person eid: so removing a member can refuse to
    // leave it with none.
    owners: async (space: Space): Promise<string[]> =>
      (await query(`.member.space=${space.eid}&.member.role=owner`))
        .map((r) => r.member && idOf(r.member.person))
        .filter((p): p is string => !!p),
    // Who is at an address, if the platform has met them. signin.ts's
    // `personOf` asks this same question and mints when the answer is
    // nobody, which is how an invited person's later sign-in finds the row
    // the invite made.
    personAt: async (email: string) =>
      (await one(`.person&.email.address=${JSON.stringify(email)}`))
        ?.entity.eid ?? null,
    // Who has this mobile number (@yaks/phone `mobile`'s form), if anyone:
    // where a text that arrived is from.
    phoned: async (number: string) =>
      (await one(`.person&.phone.number=${JSON.stringify(number)}`))
        ?.entity.eid ?? null,
    // A space's registered line, independent of the transport selected for it.
    textSpace: async (number: string) => {
      let row = await one(
        `.space&.phone.number=${JSON.stringify(number)}&${SPACE_ABOUT}`,
      )
      return row ? spaceOf(row) : null
    },
    // The numbers the platform holds for this space (numbers.ts).
    lines: async (space: Space): Promise<PhoneLine[]> =>
      (await query(`.phone_line.space=${space.eid}`)).map((row) => {
        let r = row as unknown as Row
        let l = r.phone_line!
        return {
          eid: r.entity.eid,
          number: l.number,
          via: l.via,
          space: idOf(l.space),
          upfront: l.upfront ?? 0,
          monthly: l.monthly ?? 0,
          at: l.at ?? '',
          verification: l.verification ?? null,
        }
      }),
    // The app whose own number this is (an app row's `phone{number}`), with
    // its space: where a text that arrived at it is kept (app-texts.ts).
    lined: async (number: string) => {
      let row = await one(`.app&.phone.number=${JSON.stringify(number)}`)
      return row ? await self.appAt(row.entity.eid) : null
    },
    // The same question the other way: where the platform writes to this
    // person — the letter's envelope, and nothing else (T-32629).
    emailAt: async (person: string): Promise<string | null> =>
      (await self.known(person))?.email ?? null,
    // Text-only people have no email, so `known` cannot supply their number.
    phoneAt: async (person: string): Promise<string | null> =>
      (await one(`.entity.eid=${person}&.person&.phone`))?.phone?.number ??
        null,
    // The number a person agreed to be texted at, in the words they agreed
    // to (@yaks/phone), or null when they have not agreed. Read off their
    // row rather than through `known`: a person who signed up by text has a
    // number and no address.
    texting: async (person: string): Promise<Texting | null> => {
      let [them, [row]] = await Promise.all([
        one(`.entity.eid=${person}`),
        theirs(person, `.sms_consent.person=${person}`),
      ])
      let agreed = row?.sms_consent
      let number = them?.phone?.number
      return number && agreed
        ? {
          number,
          consent: agreed.consent,
          at: agreed.at,
          ...(agreed.space ? { space: idOf(agreed.space) } : {}),
        }
        : null
    },
    // How this person chose to be told what their Operators tell them, or
    // null when they have not chosen (operator-alerts.ts `routeOf`).
    alerts: async (person: string): Promise<Alerting | null> =>
      (await one(`.entity.eid=${person}`))?.operator_alerts?.channel ?? null,
    // Whether this person keeps the side of their pages collapsed to icons.
    collapsed: async (person: string): Promise<boolean> =>
      !!(await one(`.entity.eid=${person}`))?.desk_sidebar?.collapsed,
    // The browsers this person allowed notifications on (@yaks/push), each
    // as its `PushSubscription` gave it, and since when.
    pushes: async (
      person: string,
    ): Promise<(Subscription & { since?: string })[]> =>
      (await theirs(person, `.push_subscription.person=${person}&?created`))
        .flatMap(({ push_subscription: sub, created }) =>
          sub
            ? [{
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
              ...created?.at ? { since: created.at } : {},
            }]
            : []
        ),
    // This person's MCP servers and the lists they offer the Operator's page
    // (operator-lists.ts), each as its row: asked beside the page that draws
    // them (manage.ts `foresee`), so they travel in that page's trip.
    listings: async (person: string) => {
      let bare = ({ policy: _, ...row }: ReadRow) => row as Bundle
      let [servers, lists] = await Promise.all([
        query(`.mcp_server.owner=${person}&*`),
        query(`.mcp_list.server.mcp_server.owner=${person}&*`),
      ])
      return { servers: servers.map(bare), lists: lists.map(bare) }
    },
    // The OAuth grants this person holds, as their agents are listed
    // (grant-rows.ts), and whether those rows are whole.
    grants: async (person: string) => {
      let [them, rows] = await Promise.all([
        one(`.entity.eid=${person}`),
        theirs(person, `.oauth_grant.person=${person}`),
      ])
      return {
        listed: !!them?.grants_listed,
        held: !!them,
        rows: rows.flatMap(({ oauth_grant: g }) =>
          g ? [{ ...g, person: idOf(g.person) }] : []
        ),
      }
    },
    // What to call this person anywhere their address must not go: the name
    // they chose in their settings or were invited under, else the front of
    // their address (signin.ts `nameOf`). An app's store is written this and never the address, so a
    // page that shows its bylines shows names (T-32654).
    nameAt: async (person: string): Promise<string | null> =>
      (await self.known(person))?.name ?? null,
    // Whether this person is a newcomer (`newcomerIs`).
    newcomer: async (person: string) =>
      newcomerIs(await one(`.entity.eid=${person}`)),
    // All at once, from the person's one row: what to call them, where to
    // write to them and the mobile number they gave. Null for anybody the platform has no address for.
    known: async (person: string) =>
      (await self.persons([person])).get(person) ?? null,
    // The same, for many people in one read.
    persons: async (persons: string[]): Promise<Map<string, Known>> => {
      if (!persons.length) return new Map()
      return personsOf(await query(`.entity.eid=${persons.join(',')}`))
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
    seats: async (person: string, role?: Role): Promise<Seat[]> =>
      (await self.seated(person, role))
        .filter((s) => s.space.slug != META.space),
    // Every seat, the meta space's among them: the same read, and what says
    // whether this person may address the platform's own store (agent.ts
    // `spoken`), which is a seat in `yak` like any other.
    seated: async (person: string, role?: Role): Promise<Seat[]> => {
      if (!person) return []
      return seatsOf(await query(seatsLine(person)), person, role)
    },
    // The eid of each space this person sits in, with their role there: all
    // of them whatever a caller goes on to keep, so that every question about
    // a person's seats is the one line, asked once.
    sitting: async (person: string): Promise<Map<string, Role>> =>
      new Map(
        (await theirs(person, `.member.person=${person}`)).flatMap((m) =>
          m.member ? [[idOf(m.member.space), m.member.role]] : []
        ),
      ),
    // Membership, spaces and apps are one question at the connector door.
    // Reverse associations let the directory answer it without waiting for
    // ids learned from an earlier read.
    reachable: async (
      person: string,
    ): Promise<{ space: Space; app: App; role: Role }[]> => {
      if (!person) return []
      let mine = `.members_space.member.person=${person}`
      let since = wrote(META_STORE)
      // Each row with the parts `spaceOf` and `appOf` read, and no others:
      // an app's whole row is much more than the reach says of it.
      let rows = await query(
        `(.member.person=${person})|(.space&${mine}&${SPACE_ABOUT})|(.app.space${mine}&${ABOUT})`,
      )
      let spaces = new Map(
        rows.filter((r) => r.space).map((r) => [r.entity.eid, spaceOf(r)]),
      )
      let roles = new Map(
        rows.filter((r) => r.member).map((
          r,
        ) => [idOf(r.member!.space), r.member!.role as Role]),
      )
      let apps = rows.filter((r) => r.app).map(appOf)
      // Every app of each space they sit in, the platform's and an empty one
      // too, is what this request's `apps` of those spaces asks.
      keep(spaces.keys(), apps, since)
      return [...spaces.values()].flatMap((space) => {
        let eid = space.eid, role = roles.get(eid)
        return role && space.slug != META.space && !space.trashed
          ? apps.filter((app) => app.space == eid && !app.trashed).map((
            app,
          ) => ({ space, app, role }))
          : []
      })
    },
    // Every app this person is a guest of, by a grant rather than a seat
    // (T-37615), with its space and what the grant lets them do: what their
    // dashboard lists as shared with them (apps.ts `shared`). Fresh, because
    // that page is often opened right after the click that accepted one.
    granted: async (person: string): Promise<Granted[]> => {
      let held = new Map<string, Role>()
      for (let r of await theirs(person, `.grant.person=${person}`)) {
        if (r.grant) held.set(idOf(r.grant.app), r.grant.access)
      }
      if (!held.size) return []
      // Bare `.entity.eid=`, as in `seated`: the rows are read whole.
      let apps = (await query(`.entity.eid=${[...held.keys()].join(',')}`))
        .filter((r) => r.app).map(appOf)
      let ids = [...new Set(apps.map((a) => a.space))]
      let spaces = new Map(
        ids.length
          ? (await query(`.entity.eid=${ids.join(',')}`))
            .filter((r) => r.space).map((r) => [r.entity.eid, spaceOf(r)])
          : [],
      )
      return apps.flatMap((app) => {
        let space = spaces.get(app.space)
        return space ? [{ space, app, access: held.get(app.eid)! }] : []
      })
    },
    // The spaces that let a space's Operator in (T-136179), and the other
    // way, the Operators a space let in: each space with the role given.
    reaches: (operator: string | Walk) =>
      reaching('operator', 'space', operator),
    admits: (space: string | Walk) => reaching('space', 'operator', space),
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
    // existed (T-32482). Theirs is the space whose seat says so (`member.own`),
    // which a rename leaves standing: it was once the space their address
    // named, so renaming it away handed them whichever other space they owned,
    // and settings renamed a church's space for its second owner (T-135921).
    // A person seated before the mark is marked once, at the space their
    // address names or the only one they own. Being a member of somebody
    // else's is not having one, so an invited person is minted theirs here
    // rather than handed the inviter's (T-33142).
    //
    // The mint is the request `$own`, decided inside the write that makes it
    // (facets/directory-graph.ts, by `owning` below), so two doors asking at
    // once (a sign-in settling behind its answer and the first page it sent
    // them to) mint one space between them, and the later finds the earlier's.
    //
    // `want` is the address they chose at the sign-in card, taken only when it
    // is a slug and still free — the card asked the same question a moment
    // earlier and refused a taken one out loud (identity.ts `refuse`), so this
    // is the race between that answer and the mint, not the refusal a person
    // reads. Someone who already has a space is not minting one, so their
    // choice is moot here and `/connect` is where they move (T-34137).
    own: async (person: string, want?: string): Promise<Space> => {
      let mine = await self.seats(person, 'owner')
      let marked = mine.find((s) => s.own)
      if (marked) return marked.space
      let row = await one(`.entity.eid=${person}`)
      if (!row) throw erased()
      let wanted = slugOf(row)
      let found = mine.find((s) => s.space.slug == wanted) ??
        (mine.length == 1 ? mine[0] : null)
      if (found) {
        await self.apply({
          entities: [{ entity: { eid: found.seat }, member: { own: true } }],
        }, { 'x-yak-person': person, 'x-yak-role': 'owner' })
        return found.space
      }
      if (mine.length) return unmarked(person, mine[0].space)
      await self.stamp({
        entities: [{
          entity: { eid: '$own' },
          $own: { person, ...(want ? { want } : {}) },
        }],
      }, { 'x-yak-person': person, 'x-yak-role': 'owner' })
      let theirs = await self.seats(person, 'owner')
      let space = (theirs.find((s) => s.own) ?? theirs[0])?.space
      if (!space) throw erased()
      return space
    },
    // What minting a person their own space writes, decided over this
    // directory's reads: nothing once they own a space or have no row, else
    // the batch space_new writes (`minting`), at the address they chose if it
    // is still free and otherwise the next free one their address names. A
    // space nobody has named is known by the name it answers to, which is
    // what `/connect` writes when one is chosen there too. `as` is the
    // person as the same write makes them, for a write that mints them too
    // (facets/signin-graph.ts `landing`), whose row is not stored yet.
    owning: async (
      person: string,
      want?: string,
      as?: Row,
    ): Promise<Bundle[]> => {
      let [mine, row] = await Promise.all([
        self.seats(person, 'owner'),
        as ?? one(`.entity.eid=${person}`),
      ])
      if (mine.length || !row) return []
      let chosen = !!want && SLUG.test(want) && !RESERVED.has(want) &&
        !await self.space(want)
      let slug = chosen ? want! : await self.free(slugOf(row))
      return (await self.minting(person, slug, slug, true)).entities
    },
    // The space this directory is narrowed to: none, for the whole directory
    // (grants.ts `narrowed` answers one).
    narrowedTo: (): Promise<Space | null> => Promise.resolve(null),
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
      let seats = await query(`.member.space=${space.eid}&.limit=2`)
      if (seats.length != 1) return !seats.length
      let seat = seats[0].member
      return !!seat && idOf(seat.person) == await self.personAt(ADMIN)
    },
  }
  return self
}

// The directory as a Store object reads it: the same client the kernel's own
// callers hold, over the meta store directly, since a Durable Object is handed
// the namespace and no service binding. Memoized per namespace so the meta
// space is seeded once per isolate rather than once per ask, and read fresh:
// what a store asks — what a space has spent this month (meter.ts
// `metering`), whether its app is in the trash (graph.ts `tick`) — must not be
// a moment old.
let reached = new WeakMap<Namespace, Directory>()
export let directoryOf = (ns: Namespace): Directory => {
  let held = reached.get(ns)
  if (!held) {
    reached.set(
      ns,
      held = directory({ fetch: (req) => fetch(req, { STORE: ns }) }),
    )
  }
  return held
}
