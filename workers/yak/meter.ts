// A space's allowances, counted spends and metered model/mail providers.
// facets/meter-graph.ts owns the transactional spend rule and hourly sweep;
// facets/directory-effects.ts seeds the directory's recurring usage schedule.
import { reached } from './lib/hops.ts'
import { type ByDay, kept } from '@yaks/ui/chart'
import type { Host } from './host.ts'
import { planSettings } from './route.ts'
import type { Sender } from '@yaks/mail'
import {
  COMPED,
  type Directory,
  directoryOf,
  type Meter,
  paid,
  type Space,
  stamp,
  type Tier,
} from './directory.ts'
import type { Namespace } from './door.ts'
import type { Env } from './env.ts'
import type { Held, Holding } from './held.ts'
import { mailedTo } from './post.ts'
import { refuse } from './tool.ts'
import {
  affordable,
  billed,
  charged,
  type Listed,
  type Model,
  ModelError,
  type Native,
  type Price,
  requestBound,
} from '@yaks/model'
import { defect } from './defects.ts'
import { reserved, settled } from './model-spend.ts'
import { native, platform } from './providers.ts'
import { mint } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import { Stale } from '@yaks/graph/errors'

// What one store did, as the analytics answer them (usage.ts `read`). Bytes
// come from the store itself, and the month and the letters from the row being
// written (directory.ts `Meter` is the whole component).
export type Counts = {
  requests: number
  ws_messages: number
  ws_hibernated: number
  rows_read: number
  rows_written: number
  /** an app's page views over the last 30 days, when they could be read */
  visits?: number
}

// The month's counters for an entity that may have none, or whose row is a
// month behind: a new month is a fresh reading, never a running total.
export let thisMonth = (meter: Meter | null, month: string) =>
  meter && meter.month == month ? meter : null

export let monthOf = (at: Date) => at.toISOString().slice(0, 7)

// Bytes as a person says them. The meter is read out loud in tool answers,
// where `241 MB` is the number and `252706816` is noise.
export let size = (bytes: number) => {
  let units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = 0
  while (bytes >= 1024 && n < units.length - 1) {
    bytes /= 1024
    n++
  }
  // A tenth where it says something — 1.5 KB — and never where it does not:
  // the ceiling is 1 GB, and `1.0 GB` reads like a measurement of it.
  let round = !n || bytes >= 10 || Number.isInteger(bytes)
  return `${round ? Math.round(bytes) : bytes.toFixed(1)} ${units[n]}`
}

export let none = (): Counts => ({
  requests: 0,
  ws_messages: 0,
  ws_hibernated: 0,
  rows_read: 0,
  rows_written: 0,
})

// `requests` is the raw invocation reading, kept in its original shape.
// Hibernated messages are included in it; active-socket messages are not.
// An unknown invocation type counts once. Cloudflare bills incoming messages
// at 20:1, so this is a conservative estimate until analytics catches up.
export let requestUnits = (
  m: Pick<Meter, 'requests' | 'ws_messages' | 'ws_hibernated'>,
) => {
  let hibernated = m.ws_hibernated ?? 0
  return Math.ceil(
    m.requests - hibernated + (m.ws_messages ?? 0) / 20,
  )
}

// ---- the ceilings (T-32758) ------------------------------------------------
//
// At 80% the agent gets one line on the unseen channel (unseen.ts `ceiling`).
// Request units are never a ceiling on visitors: however many come, they are
// served, and the owner is told when a month's units pass the plan's figure.

let GB = 1024 ** 3

// The free tier, as decided (D-32751): what a space gets for nothing.
export let FREE = { apps: 5, requests: 50_000, bytes: GB, files: GB }
export let PLUS = {
  apps: null,
  requests: 1_000_000,
  bytes: 10 * GB,
  files: 50 * GB,
}
// The Organization plan (D-134567) carries the Plus plan's allowances; what it
// adds is a bigger model budget, the operator and support.
export let ORGANIZATION = PLUS

// Photos and files, including on comped spaces (only apps/data are exempt).
// Free: proposed 1 GB allowance (T-37149), pending owner feedback.
export let FILES: Record<Tier, number> = {
  free: FREE.files,
  plus: PLUS.files,
  organization: ORGANIZATION.files,
}

// Where the warning line sits, as a fraction of a ceiling.
export let WARN = 0.8

// Comped spaces retain their app/data/visit exemption independently of Plus.
export let ceilings = (tier: Tier | null, slug = '') =>
  COMPED.includes(slug)
    ? null
    : tier == 'organization'
    ? ORGANIZATION
    : tier == 'plus'
    ? PLUS
    : FREE

// The letters, both directions, a space may spend in a month — the one
// allowance both tiers carry, because a letter costs money to carry however
// the plan is paid for, and the pricing page sells a number on each
// (public/pricing.html). Counted at the two mail doors as they happen:
// `metering` below for a letter that left, inbox.ts for one that arrived.
export let LETTERS: Record<Tier, number> = {
  free: 100,
  plus: 2_500,
  organization: 2_500,
}

export let letters = (tier: Tier | null): number => LETTERS[tier ?? 'free']

// Monthly allowances for the optional built-in builder. Making and changing
// apps through a connected agent (app_new, app_files) is not metered here.
export let BUILDS: Record<Tier, number> = {
  free: 5,
  plus: 100,
  organization: 100,
}

export let builds = (tier: Tier | null): number => BUILDS[tier ?? 'free']

// Each space's models and voice spend its one monthly dollar budget, and a
// person's first space draws on {@link STARTER} before it. The free month is
// sized so a year of free spaces spends the model credits we hold rather than
// saving them (T-138720): a free person talks with their Operator and never
// meets a figure. Each paid plan holds more than the one below it, which is
// what a refusal's "the Plus plan allows more" promises.
export let BUDGET: Record<Tier, number> = {
  free: 20,
  plus: 30,
  organization: 60,
}

// The dollars a person's first space holds once, spent before its monthly
// budget (T-138717: "Once, then a larger monthly"). It guards a spike rather
// than rationing: Jeff, 2026-11-05, "the $100 is just to prevent a random
// spike, but basically we want them to not think about or hit the limit".
// Once per person: a space minted for someone who already holds one, or who
// has had theirs, holds none (directory.ts `mint`, `starter`).
export let STARTER = 100

// Build seconds a month: the sandbox container's (sandbox.ts) and the compile
// at app_deploy's (esbuild.ts). An hour free is six builds' whole sandbox
// budget (sandbox.ts `BUDGET`); ten hours on the Plus plan is about $1.30 of
// standard-2 time at Cloudflare's rates (wrangler.toml). A compile's second
// costs less than a container's, so the one allowance bounds both.
export let SECONDS: Record<Tier, number> = {
  free: 3_600,
  plus: 36_000,
  organization: 36_000,
}

// What a tier costs a month, in whole dollars (D-32751). The number is
// tax-inclusive: $9 is what a customer pays anywhere, so this is the whole
// price rather than a subtotal something is added to. Stripe holds the same
// number as a price id (wrangler.toml STRIPE_PRICE, and STRIPE_PRICE_ORGANIZATION
// for the Organization plan) and that is what a card is charged against; this is the number the site says out loud — the pricing
// copy, and the `Offer`s in the home page's JSON-LD, which is what a search
// engine shows beside the result. A price change also updates the static HTML
// in public/index.html and public/pricing.html, billing_kernel_test.ts, and
// bin/verify-deploy{,_test}.ts. site_test.ts holds the pages to this number.
export let PRICE: Record<Tier, number> = { free: 0, plus: 9, organization: 49 }

// What a year costs, for a plan sold by the year as well (D-134567: an
// organization budgets by the year). Stripe holds it as
// STRIPE_PRICE_ORGANIZATION_YEAR.
export let YEARLY: Partial<Record<Tier, number>> = { organization: 490 }

export let CURRENCY = 'USD'

// ---- the space (D-131886) ----------------------------------------------------
//
// Every allowance and the model budget belong to the space: each one compares
// the space's own meter with the space's own plan, and nothing is summed
// across the spaces one person owns. A person has no plan, allowance or
// budget; they own at most {@link SPACES} free spaces (T-131887). Jeff,
// 2026-10-22: "and yes, one included space." Spaces that were free before
// the cap stay free; it only stops making or restoring another.

/** The free spaces one person may own. */
export let SPACES = 1

/** The monthly usage counters. Models, realtime and texts spend the same
 * space budget; their separate counters still say what each source cost. */
export type Spend =
  | 'emails'
  | 'builds'
  | 'models'
  | 'realtime'
  | 'texts'
  | 'seconds'
/** The spends counted in dollars against the space's one budget. */
export type Dollars = 'models' | 'realtime' | 'texts'
let DOLLARS: Spend[] = ['models', 'realtime', 'texts']
let budgeted = (what: Spend): what is Dollars => DOLLARS.includes(what)
export type Limited = Exclude<Spend, Dollars>
export type Budget = { spent: number; limit: number }

let ALLOWANCE: Record<Limited, Record<Tier, number>> = {
  emails: LETTERS,
  builds: BUILDS,
  seconds: SECONDS,
}
let SPENDS: Spend[] = [
  'emails',
  'builds',
  'models',
  'realtime',
  'texts',
  'seconds',
]
let LIMITED = Object.keys(ALLOWANCE) as Limited[]

/** What a reading has spent: model, voice and text dollars together. */
let used = (m: Meter, what: Spend) =>
  budgeted(what) ? m.models + m.realtime + (m.texts ?? 0) : m[what]

export let allowance = (what: Limited, tier: Tier | null) =>
  ALLOWANCE[what][tier ?? 'free']

/** A space on the free tier: not on a paid plan, and not comped
 * (directory.ts `tierOf` reads a comp as the Plus plan). */
export let free = (space: Space) => !paid(space.tier)

/** Whether a space is at an allowance this month; `more` is what the caller
 * holds that is not counted yet — the dollars and seconds of a build still
 * going. */
export let over = (space: Space, what: Limited, more = 0, now = new Date()) =>
  used(spent(space, now), what) + more >= allowance(what, space.tier)

/** What is left of a space's starter as this month began: what it holds,
 * less every dollar it drew before this month (`drawn` counts them all). */
export let starterOf = (space: Space, now = new Date()) => {
  let before = (space.meter?.drawn ?? 0) - used(spent(space, now), 'models')
  return Math.max(0, (space.starter ?? STARTER) - Math.max(0, before))
}

/** The dollars a space's models and voice may spend this month: the month
 * the platform's owner set on it (budget.ts), else its plan's, and what is
 * left of its starter. */
export let limitOf = (space: Space, now = new Date()) =>
  (space.budget ?? BUDGET[space.tier ?? 'free']) + starterOf(space, now)

/** The space's models and voice this month, against its budget. */
export let budget = (space: Space, now = new Date()): Budget => ({
  spent: used(spent(space, now), 'models'),
  limit: limitOf(space, now),
})

/** What refuses holding `dollars` of a space's model and voice budget this
 * month, or null when it fits: the space at its ceiling, or too little left
 * for this call. The directory refuses a held spend with it (meter-graph.ts
 * `spend`), and a caller quoting a call says it before asking. */
export let unaffordable = (
  space: Space,
  what: 'models' | 'realtime' | 'texts',
  dollars: number,
  now = new Date(),
) => {
  let { spent, limit } = budget(space, now)
  // A quote fitted to exactly what is left is a sum of floats, so a hold may
  // overshoot it by a rounding.
  if (dollars <= Math.max(0, limit - spent) + 1e-9) return null
  return spent >= limit
    ? atCeiling(space, what)
    : `What is left of ${space.slug}'s model and voice budget this month is ` +
      `too little for this call. ${plans(space, {})}`
}

/** What stops this spend in this space, or null to go ahead. */
export let refusedSpend = (
  space: Space,
  what: Spend,
  env: Host = {},
  more = 0,
  now = new Date(),
) => {
  if (budgeted(what)) {
    let b = budget(space, now)
    return b.spent + more >= b.limit ? atCeiling(space, what, env) : null
  }
  return over(space, what, more, now) ? atCeiling(space, what, env) : null
}

// A month with nothing spent yet. What the space holds (`bytes`, `files`) is
// not a month's figure, so a new month neither starts it over nor writes it.
let empty = (month: string, built = 0): Omit<Meter, 'bytes'> => ({
  month,
  ...none(),
  emails: 0,
  builds: 0,
  models: 0,
  realtime: 0,
  texts: 0,
  seconds: 0,
  built,
  at: '',
})

// This month's reading, whatever the row holds — a month behind is nothing
// spent, and no row at all is the same. What it carries through is what is
// not started over by a new month: `built`, a lifetime figure, and what the
// space holds (held.ts).
export let spent = (space: Space, now = new Date()): Meter =>
  thisMonth(space.meter, monthOf(now)) ??
    {
      ...empty(monthOf(now), space.meter?.built ?? 0),
      bytes: space.meter?.bytes ?? 0,
      files: space.meter?.files ?? 0,
    }

/**
 * A meter with a spend added, as the patch that writes it: onto what it holds
 * when it holds the spend's month, and onto a fresh month when it holds
 * another. `built` counts every build ever and `drawn` every dollar, so a
 * new month carries them.
 *
 * ```ts
 * import { added } from './meter.ts'
 *
 * let sep = { month: '2026-09', models: 0.5, built: 3 }
 * added(sep, { month: '2026-09', models: 0.25 })
 * // { month: '2026-09', models: 0.75 }
 * added(sep, { month: '2026-10', builds: 1 }).built // 4
 * added(sep, { month: '2026-10', builds: 1 }).models // 0
 * added({ ...sep, drawn: 4 }, { month: '2026-10', models: 0.5 }).drawn // 4.5
 * ```
 */
export let added = (
  meter: Record<string, unknown> | undefined,
  spend: Record<string, unknown>,
): Record<string, unknown> => {
  let n = (v: unknown) => Number(v ?? 0)
  let month = String(spend.month)
  let held = meter?.month == month ? meter : undefined
  let out: Record<string, unknown> = held
    ? { month }
    : empty(month, n(meter?.built))
  for (let k of SPENDS) if (n(spend[k])) out[k] = n(held?.[k]) + n(spend[k])
  if (n(spend.builds)) out.built = n(meter?.built) + n(spend.builds)
  let cost = DOLLARS.reduce((sum, k) => sum + n(spend[k]), 0)
  if (cost) out.drawn = n(meter?.drawn) + cost
  return out
}

/**
 * The patch a spend makes to a space's `trend`: what it cost, on its day. A
 * letter or a spend of nothing costs nothing and leaves the days as they are.
 *
 * ```ts
 * import { trended } from './meter.ts'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-10-31T12:00:00Z')
 * equal(trended({ spend: { '2026-10-31': 1 } }, { models: 0.5 }, now), {
 *   spend: { '2026-10-31': 1.5 },
 * })
 * equal(trended({}, { emails: 1 }, now), {})
 * ```
 */
export let trended = (
  trend: Record<string, unknown> | undefined,
  spend: Record<string, unknown>,
  now: number,
): Record<string, unknown> => {
  let cost = Number(spend.models ?? 0)
  return cost ? { spend: kept(trend?.spend as ByDay, cost, now) } : {}
}

/** A ceiling a space answers to: what it has used and what it is allowed. */
export type Gauge = { used: number; limit: number }
export type Ceiling = 'apps' | 'requests' | 'bytes' | 'files' | Limited

// What the space held at the sweep's last reading (held.ts says what it holds).
let reading = (m: Meter): Held => ({ bytes: m.bytes, files: m.files ?? 0 })

// Each ceiling a space answers to this month: apps, request units and app data
// where its plan limits them, and the allowances every plan carries. The
// space's dollar budget is checked through `budget`.
// What it holds is the sweep's last reading unless a caller has the space's
// apps in hand and passes what they hold now (held.ts `holding`).
export let gauges = (
  space: Space,
  apps: number,
  now = new Date(),
  held = reading(spent(space, now)),
): Partial<Record<Ceiling, Gauge>> => {
  let free = ceilings(space.tier, space.slug)
  let m = spent(space, now)
  return {
    ...(free?.apps == null ? {} : { apps: { used: apps, limit: free.apps } }),
    ...(free
      ? {
        requests: { used: requestUnits(m), limit: free.requests },
        bytes: { used: held.bytes, limit: free.bytes },
      }
      : {}),
    files: { used: held.files, limit: FILES[space.tier ?? 'free'] },
    ...Object.fromEntries(LIMITED.map((what) => [what, {
      used: used(m, what),
      limit: allowance(what, space.tier),
    }])),
  }
}

let full = (g: Gauge) => g.used / g.limit

// Where a space stands: nothing to say, near a ceiling, or past one. The
// sweep watches this for a change, which is what un-tells the agent.
export let level = (
  space: Space,
  apps: number,
  now = new Date(),
  held?: Held,
) => {
  let worst = Math.max(
    ...Object.values(gauges(space, apps, now, held)).map(full),
  )
  return worst >= 1 ? 'over' : worst >= WARN ? 'near' : 'ok'
}

// Whole counters need grouping, not locale data on the first request.
export let count = (n: number) =>
  Number.isSafeInteger(n) && !Object.is(n, -0)
    ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : n.toLocaleString('en-US')

/** Dollars as a person reads them: cents, and two figures of a cent where a
 * month has spent less than one. */
export let dollars = (n: number) =>
  n >= 0.01 || n <= 0
    ? `$${n.toFixed(2)}`
    : `$${n.toFixed(1 - Math.floor(Math.log10(n))).replace(/0+$/, '')}`

/** A share of the model and voice budget as a person reads it, a percent:
 * the budget's dollars are ours to allocate, never shown (T-138720). */
export let share = (n: number, of: number) =>
  n <= 0 || !of
    ? '0%'
    : n / of < 0.01
    ? 'under 1%'
    : `${Math.round((n / of) * 100)}%`

// When the metered figures were last read. Everything but the app count comes
// from the hourly sweep above, not from a live counter, so a line that prints
// those numbers bare reads as live and looks broken: the ninth user test made
// ~25 requests to a new app and was told `0 of 50,000 requests` (C-32869
// item 6). A reading says its hour; no reading says so instead of saying zero.
let asOf = (at: string) => {
  let read = new Date(at)
  return Number.isNaN(read.getTime())
    ? ''
    : ` (as of ${read.toISOString().slice(11, 16)} UTC)`
}

/** Where a space stands, as data: each ceiling it answers to, what models and
 * voice cost here from its budget, and when the hourly sweep
 * last read it (null before the month's first reading). */
export let standingOf = (
  space: Space,
  apps: number,
  now = new Date(),
  env: Host = {},
  held?: Held,
) => {
  let m = spent(space, now)
  return {
    tier: space.tier ?? 'free',
    month: m.month,
    read: m.at || null,
    level: level(space, apps, now, held),
    limits: gauges(space, apps, now, held),
    models: m.models,
    voice: m.realtime,
    settings: planSettings(space.slug, env),
  }
}

// Each ceiling as a person reads it: what it is called, and how much of it.
// Request units say that visitors are served past it, since a spike is news to
// the owner, never a reason to stop serving.
let NAME: Record<Ceiling, string> = {
  apps: 'apps',
  requests: 'request units (visitors are always served)',
  bytes: 'app data',
  files: 'photos and files',
  emails: 'emails',
  builds: 'builds',
  seconds: 'build seconds',
}

let READ: Record<Ceiling, (g: Gauge) => string> = {
  apps: (g) => `${count(g.used)} of ${count(g.limit)} apps`,
  requests: (g) => `${count(g.used)} of ${count(g.limit)} request units`,
  bytes: (g) => `${size(g.used)} of ${size(g.limit)} of app data`,
  files: (g) => `${size(g.used)} of ${size(g.limit)} of photos and files`,
  emails: (g) => `${count(g.used)} of ${count(g.limit)} emails`,
  builds: (g) => `${count(g.used)} of ${count(g.limit)} builds`,
  seconds: (g) => `${count(g.used)} of ${count(g.limit)} build seconds`,
}

// What only the hourly sweep reads. Before its first reading of the month
// it is no reading at all, and zero would be a claim (`asOf`). What the space
// holds is no month's figure, so last month's reading still says it.
let SWEPT: Ceiling[] = ['requests']

/**
 * Where a space stands this month, in one line: every ceiling it answers to,
 * what models and voice cost here from its budget, and, at
 * four fifths of a ceiling or past it, which ones and where the plan is
 * settled.
 */
export let gauged = (
  space: Space,
  apps: number,
  now = new Date(),
  env: Host = {},
  held?: Held,
) => {
  let m = spent(space, now)
  let read = asOf(m.at)
  let all = Object.entries(gauges(space, apps, now, held)) as [
    Ceiling,
    Gauge,
  ][]
  let shown = all.filter(([what]) => read || !SWEPT.includes(what))
  let close = shown.filter(([, g]) => full(g) >= WARN)
  let over = close.filter(([, g]) => full(g) >= 1).length
  let state = !over ? 'near' : over == close.length ? 'at' : 'at or near'
  let limit = limitOf(space, now)
  let voice = m.realtime ? ` (${share(m.realtime, limit)} on voice)` : ''
  return `This month${read}: ${
    shown.map(([what, g]) => READ[what](g)).join(', ')
  }${shown.length < all.length ? ', request units not read yet' : ''}, and ${
    share(used(m, 'models'), limit)
  } of ${space.slug}'s model and voice budget used${voice}${
    close.length
      ? ` — ${state} the limit for ${
        close.map(([what]) => NAME[what]).join(', ')
      }; plan settings: ${planSettings(space.slug, env)}`
      : ''
  }`
}

// The refusal, one sentence: what the ceiling is, and where the plans are
// written down. Every door that says no says it this way.
//
// It names the space's plan settings, never a checkout link. This is a policy
// line rather than a preference (C-33033 on D-32751): an agent surface may
// explain that a feature needs a plan and may link to a page describing the
// plans; it may not hand back anything that starts a purchase. Paying is the
// signed-in web page's door (billing.ts).
export let atCeiling = (
  space: Space,
  what: 'apps' | Spend,
  env: Host = {},
) => {
  let free = ceilings(space.tier, space.slug)!
  let tier = space.tier ?? 'free'
  // Comped spaces can hit the letter/build allowances, not the app ceiling.
  let said = {
    apps: () =>
      `${space.slug} is on the ${tier} tier, which is ${free.apps} apps` +
      ` — delete one (app_delete) to make another`,
    // The one refusal both tiers can hit, and the one a person cannot clear
    // by deleting something: the month is what lifts it. An arrival is never
    // refused — a letter turned away at the door is somebody else's words
    // lost — so it says which half stopped.
    emails: () =>
      `${space.slug} is on the ${tier} tier, which is ${
        count(letters(space.tier))
      } emails a month, and this month's are sent — it can send ` +
      `again on the 1st, and letters written to it still arrive`,
    // The builder's refusal, which it says in the chat rather than bouncing
    // (T-34242 renders it): a person asked for an app in words, and a person
    // asked in words is owed an answer in words. What it leaves them is the
    // app they already have and the tools to change it themselves.
    builds: () =>
      `${space.slug} is on the ${tier} tier, which is ${
        count(builds(space.tier))
      } built-in builds a month, and this month's are used — it ` +
      `can build again on the 1st, or keep building with a connected agent`,
    // Every model call on the space stops here, the builder's and its apps'
    // alike, so it names neither: models answer again on the 1st. Voice
    // spends the same dollars, so each sentence says both.
    models: () =>
      `${space.slug}'s model and voice budget for this month is spent — ` +
      `models answer again on the 1st, and a connected agent can keep ` +
      `building`,
    realtime: () =>
      `${space.slug}'s model and voice budget for this month is spent — ` +
      `voices go quiet until the 1st`,
    // An app's broadcast stops here; the answers to STOP and HELP a carrier
    // requires go regardless (app-texts.ts).
    texts: () =>
      `${space.slug}'s model and voice budget for this month is spent, and ` +
      `its apps' texts spend it too — they go again on the 1st`,
    seconds: () =>
      `${space.slug} is on the ${tier} tier, which is ${
        count(allowance('seconds', space.tier))
      } build seconds a month (the sandbox, and compiling ` +
      `TypeScript and npm packages at app_deploy), and this month's are ` +
      `spent — they come back on the 1st, and an app of html, css and js ` +
      `needs none`,
  }[what]()
  return `${said}. ${plans(space, env)}`
}

// Where every refusal ends: the page that describes the plans.
export let plans = (space: Space, env: Host) =>
  `${
    paid(space.tier)
      ? `Manage usage and plan settings`
      : `Putting ${space.slug} on the Plus plan allows more. Compare paid plans in its settings`
  }: ${planSettings(space.slug, env)}`

/** What one app holds, as a person reads it, leaving out what it holds none
 * of: `holds 2 MB of app data and 880 MB of photos and files`, or nothing. */
export let heldAloud = (h: Held) => {
  let what = [
    h.bytes ? `${size(h.bytes)} of app data` : '',
    h.files ? `${size(h.files)} of photos and files` : '',
  ].filter(Boolean)
  return what.length ? `holds ${what.join(' and ')}` : ''
}

/** Each app's share of one stored ceiling, largest first, leaving out the
 * apps that hold none of it: `openai-math 900 MB, robolab 120 MB`. */
export let shares = (held: Holding, what: keyof Held) =>
  [...held.apps].filter(([, h]) => h[what] > 0)
    .sort(([, a], [, b]) => b[what] - a[what])
    .map(([id, h]) => `${held.names?.get(id) ?? id} ${size(h[what])}`)
    .join(', ')

/** A line for each stored ceiling the space is near or at, saying each app's
 * share of it, so the agent can choose what to delete before a write is
 * refused: `Photos and files by app: openai-math 900 MB, robolab 120 MB`. */
export let divided = (
  space: Space,
  apps: number,
  held: Holding,
  now = new Date(),
) => {
  let g = gauges(space, apps, now)
  return (['bytes', 'files'] as const)
    .filter((what) => g[what] && full(g[what]) >= WARN && shares(held, what))
    .map((what) =>
      `${NAME[what][0].toUpperCase()}${NAME[what].slice(1)} by app: ${
        shares(held, what)
      }`
    )
}

/**
 * The refusal at a stored ceiling (app data, or photos and files): what the
 * plan allows, what the space holds and how that divides across its apps, so
 * the agent can choose what to delete, and where the plans are written.
 */
export let atStored = (
  space: Space,
  what: 'bytes' | 'files',
  held: Holding,
  env: Host = {},
) => {
  let tier = space.tier ?? 'free'
  let limit = what == 'files' ? FILES[tier] : ceilings(space.tier)!.bytes
  let each = shares(held, what)
  return `${space.slug} is on the ${tier} tier, which is ${size(limit)} of ${
    NAME[what]
  }, and holds ${size(held[what])}${each ? ` (${each})` : ''} — ${
    what == 'files'
      ? 'delete files it no longer needs to upload more'
      : 'delete what it no longer needs to save more'
  }. ${plans(space, env)}`
}

/** The refusal at {@link SPACES}: the free spaces a person owns, and what
 * makes room. Sharing is never what stops them, so it says so. */
export let tooManySpaces = (held: Space[], env: Host = {}) => {
  let gets = SPACES == 1 ? 'one free space' : `${SPACES} free spaces`
  let extra = held.length - SPACES + 1
  return `one person gets ${gets}, and you own ${count(held.length)} ` +
    `(${held.map((s) => s.slug).join(', ')}) — put ${
      extra == 1 ? 'one' : extra
    } on the Plus plan or delete ${
      extra == 1 ? 'one' : 'them'
    } (space_delete) to make another. A space on a paid plan does not ` +
    `count, and neither does a space somebody else invited you into. ` +
    `Compare paid plans in its settings: ${planSettings(held[0].slug, env)}`
}

// ---- the letters (T-33688) --------------------------------------------------
//
// Mail rides no store, so nothing in the analytics counts it: a letter is
// counted where it happens, one per letter delivered (post.ts's binding took
// it) and one per letter that arrived (inbox.ts filed it). An attempt is not a
// letter — a bounce costs the space nothing — and an arrival is counted but
// never refused, because turning a letter away at the door loses somebody
// else's words.
//
// Every count is a `spend` the directory adds to the meter in its own
// transaction ({@link added}), never a sum written back: two counts for one
// space at once, or one landing while the sweep runs, would otherwise each
// write their own total and the later would erase the earlier. The month
// turning is a fresh row there, as it is in the sweep: the counters that are
// the analytics' to answer wait for the next reading rather than carrying last
// month's numbers under this month's name.

/** What a space spent, sent for the directory to add to its month. */
let spending = async (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  spend: Partial<Record<Spend, number>>,
  now: Date,
) =>
  await stamp(env, {
    entities: [{
      entity: { eid: space.eid },
      spend: { month: monthOf(now), ...spend },
    }],
  })

/** One letter, on the space's month: the count, one higher. */
export let counted = (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  now = new Date(),
) => spending(env, space, { emails: 1 }, now)

// ---- the bytes --------------------------------------------------------------
//
// What an app's store holds is its own to say: Cloudflare's storage analytics
// have no per-object figure, and the store is the one place the number exists.
// It says it when a committed write moved it (graph.ts `#tell`), so a store
// nobody writes to is never asked and never tells. Not a month's figure: the
// sweep leaves it where the store put it and adds up a space's from it.

/** An app's stored bytes, as its own store just measured them. */
export let weighed = async (
  env: { STORE: Namespace },
  app: string,
  bytes: number,
) =>
  await stamp(env, { entities: [{ entity: { eid: app }, meter: { bytes } }] })

// ---- the builds (T-34241) ---------------------------------------------------
//
// A build is counted where it happens, like a letter and for the same reason:
// nothing in the analytics knows what the builder did. One count per completed
// build — an `app_deploy` the builder performed — and never per message, so a
// long conversation that ships one app costs one build.
//
// The refusal is a sentence the builder says, not a bounce: the person is
// talking to it, and a door slamming mid-conversation is not an answer. The
// builder asks before it starts and repeats what comes back.

/**
 * One completed build and what it cost: the month's builds, model dollars
 * and container seconds, and the space's lifetime builds, each one higher.
 *
 * This is the call the builder's loop makes with what its `build()` spent on
 * its model (T-34239, weighed by models.ts) and the seconds its workbench held
 * (sandbox.ts `released`). A build that was refused never reaches it, so a
 * refusal costs a person nothing — not a build, and not the model call of the
 * sentence that turned it down.
 */
export let countedBuild = (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  cost: number,
  seconds = 0,
  now = new Date(),
) => spending(env, space, { builds: 1, models: cost, seconds }, now)

// ---- the workbench (T-34264) ------------------------------------------------
//
// Container seconds, counted where they happen like the letters and the
// builds: nothing in the analytics knows what the builder compiled. The unit
// is one second of container wall time — what Cloudflare bills on — measured
// from the first sandbox call in a build to the moment the build lets the
// container go (sandbox.ts `Spend`), rounded up.
//
// Two ceilings hold it: the per-build budget the tools refuse at (sandbox.ts
// `BUDGET`), and the month's {@link SECONDS}, which is what bounds the lone
// calls that belong to no build (tools.ts `bench` asks before each).

/**
 * The model dollars and container seconds spent, on the space's month, with
 * no build beside them.
 *
 * The door for a conversation that shipped nothing (builder.ts `end`) — its
 * model calls cost the same whether or not they ended in a deploy — and for a
 * lone sandbox tool call somebody's own agent made over the connector
 * (tools.ts `bench`). Where a build is being counted both go with it
 * ({@link countedBuild}).
 */
export let countedSpend = async (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  cost: number,
  seconds: number,
  now = new Date(),
) => {
  if (cost <= 0 && seconds <= 0) return
  await spending(env, space, { models: cost, seconds }, now)
}

/** The original media call and its spend commit together, once. A crash after
 * commit is recognized by the ledger rather than charged a second time. */
export let countedMedia = async (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  call: string,
  dollars: number,
  reported = true,
) => {
  if (!Number.isFinite(dollars) || dollars < 0) {
    throw new Error('Generated media returned no valid request cost')
  }
  if (await settled(env, call, dollars, reported)) return
  let eid = derivedEid('generated-media-spend|' + call)
  try {
    await stamp(env, {
      entities: [{
        entity: { eid },
        $was: { cost: { dollars: null } },
        cost: { dollars, reported },
      }, {
        entity: { eid: space.eid },
        spend: { month: monthOf(new Date()), models: dollars },
      }],
    })
  } catch (error) {
    if (!(error instanceof Stale) || error.eid != eid) throw error
  }
}

/** The dollars an app's voices received, weighed at a lease's renewal
 * (rtc.ts), on the space's month. */
export let countedRealtime = async (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  cost: number,
  now = new Date(),
) => {
  if (cost <= 0) return
  await spending(env, space, { realtime: cost }, now)
}

/** The dollars an app's texts cost (app-texts.ts), on the space's month. */
export let countedTexts = async (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  cost: number,
  now = new Date(),
) => {
  if (cost <= 0) return
  await spending(env, space, { texts: cost }, now)
}

/**
 * A letter counted against the space it left from: the month's allowance read
 * before it goes, the count written after it went.
 *
 * It wraps the transport rather than sitting in the effect, so the two rules
 * ride the one seam @yaks/mail already has: over the allowance this throws,
 * which the sending effect comes to rest on as `bounced{reason}` naming the
 * ceiling, and a transport that refused for its own reasons never reaches the
 * count.
 *
 * A store with no namespace bound and one that cannot name its own mailbox
 * both send uncounted — the stand-in in a test, an object that has not learned
 * its address yet — the way an unset analytics token meters nothing.
 */
export let metering = (
  bind: { STORE?: Namespace; MODEL_FETCH?: typeof fetch } & Host,
  from: () => string | null,
  sender: Sender,
): Sender => ({
  send: async (m) => {
    let ns = bind.STORE
    let box = ns ? mailedTo(from() ?? '', bind) : null
    if (!ns || !box) return await sender.send(m)
    let dir = directoryOf(ns)
    let space = await dir.space(box.space)
    if (!space) return await sender.send(m)
    let no = refusedSpend(space, 'emails', bind)
    if (no) throw refuse('limit', no)
    let receipt = await sender.send(m)
    await counted({ STORE: ns }, space)
    return receipt
  },
})

// ---- the models (D-40545) ---------------------------------------------------
//
// A model call is counted where it happens, like a letter and for the same
// reason: nothing in the analytics knows which space asked. The budget is
// read before the call and the call weighed after it, by its model's price in
// the catalogue (models.ts). Each call reserves its bounded maximum first.

/**
 * The door an app reaches its models' own API through: the own door of the
 * first provider config.ts `serving` names that has one (providers.ts
 * `native`), as Workers AI's binding is, and the only one: `./api/ai/run`,
 * documents and embeddings are lent it. A call that could not be counted, with
 * no namespace to count it in or no space to count it against, is refused
 * before anything is spent, since nothing reaches a provider unmetered.
 *
 * Each call holds what its provider quotes against the space's budget
 * (model-spend.ts) and settles at its cost. Over the budget it throws a
 * `ModelError` coded `limit` carrying the ceiling's sentence, which a
 * transcript comes to rest on (@yaks/session `LIMIT`) and the direct door
 * answers 429 with. What the provider says is the platform's to hear (the
 * account's own credit spent, a model it prices nothing for) is reported.
 */
export let metered = (
  bind: Partial<Env> & { STORE?: Namespace } & Host,
  spaceOf: (dir: Directory) => Promise<Space | null>,
  rows?: {
    price(name: string): Promise<Price | undefined>
    answered(provider: string, name: string, info: Listed): Promise<void>
  },
): Native => ({
  run: async (model, input, options) => {
    let ns = bind.STORE
    let dir = ns ? directoryOf(ns) : null
    let space = dir ? await spaceOf(dir) : null
    let provider = ''
    let door = ns && space
      ? native(bind, platform(bind as Env), {
        hold: (quote) => reserved({ STORE: ns }, space, quote),
        answered: (name, info) =>
          rows?.answered(provider, name, info) ?? Promise.resolve(),
        report: (e, model) =>
          e instanceof ModelError && e.code == 'model'
            ? defect(e, { request: 'model price', model }, {
              fault: `model-price:${model}`,
            })
            : defect(e, { request: `model ${model}`, space: space.slug }),
      })
      : undefined
    if (!door) {
      throw new ModelError(
        'unbound',
        'No model can be asked here: nothing binds this store to a provider ' +
          'and to the space that pays for it',
      )
    }
    provider = door.provider
    return await door.run(model, input, options)
  },
})

/** A hosted provider spends from the same space budget as every other door.
 * Costs are supplied by the adapter, never guessed from media JSON. */
export let accounted = (
  bind: Host & Partial<Pick<Env, 'STORE'>>,
  spaceOf: (dir: Directory) => Promise<Space | null>,
  model: Model,
  price?: (name: string) => Promise<Price | undefined>,
): Model =>
  Object.assign(
    async (req: Parameters<Model>[0]) => {
      let ns = bind.STORE
      let dir = ns ? directoryOf(ns) : null
      let space = dir ? await spaceOf(dir) : null
      if (!ns || !dir || !space) {
        throw new ModelError(
          'unbound',
          'No account is bound to this model call',
        )
      }
      // A request priced by the call is quoted by its model alone.
      let own = model.quote?.(req, 0) !== undefined
      let info = own ? undefined : await model.info?.(req.model)
      let tariff = reached(
        'priced',
        info?.price ?? await price?.(req.model),
      )
      let call = req.call ?? mint()
      let hold = await reserved({ STORE: ns }, space, (remaining) => {
        if (own) return model.quote!(req, remaining) ?? null
        if (
          req.modalities?.some((m) => m != 'text')
        ) return null
        let window = info?.context ??
          (tariff && Object.values(tariff).every((p) => p == 0) ? 0 : undefined)
        let output = req.questions ? window : req.tokens
        let quote = tariff && window != null
          ? affordable(tariff, requestBound(req, window), remaining, output)
          : null
        return req.questions && quote?.tokens != output ? null : quote
      }, call)
      reached('reserved', hold)
      let submitted = false
      let reply: Awaited<ReturnType<Model>>
      try {
        reply = await model({
          ...req,
          call,
          tokens: hold.value.tokens,
          onSubmit: async () => {
            if (submitted) {
              throw new ModelError(
                'submitted',
                'This call has already been submitted',
              )
            }
            await req.onSubmit?.()
            submitted = true
          },
        })
      } catch (error) {
        if (!submitted) await hold.settle(0, false)
        throw error
      }
      let cost = charged(reply, tariff, hold.value.dollars)
      if (!cost || !Number.isFinite(cost.dollars) || cost.dollars < 0) {
        throw new Error('Hosted provider returned no valid request cost')
      }
      await hold.settle(cost.dollars, cost.reported)
      return { ...reply, cost: cost.dollars, costReported: cost.reported }
    },
    model,
    {
      recover: async (call: string) => {
        if (!model.recover) {
          throw new ModelError(
            'media_missing',
            'This provider has no media recovery',
          )
        }
        let ns = bind.STORE
        let space = ns ? await spaceOf(directoryOf(ns)) : null
        if (!ns || !space) {
          throw new ModelError(
            'unbound',
            'No account is bound to this model call',
          )
        }
        // Delivery needs no allowance: the original generation already spent it.
        let reply = await model.recover(call)
        let cost = billed(reply, await price?.(reply.model))
        if (!cost) {
          throw new Error(
            'Recovered provider returned no request cost',
          )
        }
        if (!await settled({ STORE: ns }, call, cost.dollars, cost.reported)) {
          await countedMedia(
            { STORE: ns },
            space,
            call,
            cost.dollars,
            cost.reported,
          )
        }
        return reply
      },
    },
  )
