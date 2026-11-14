// A space's allowances, counted spends and metered model/mail providers.
// facets/meter-graph.ts owns the transactional spend rule, the hourly sweep
// and each held number's monthly charge;
// facets/directory-effects.ts seeds the directory's recurring usage schedule.
import { reached } from './lib/hops.ts'
import { type ByDay, kept } from '@yaks/ui/chart'
import type { Host } from '@yaks/platform/host'
import { planSettings } from '@yaks/platform/routes'
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
import type { Namespace } from '@yaks/durable-object/door'
import type { Env } from './env.ts'
import type { Held, Holding } from './held.ts'
import { mailedTo } from './post.ts'
import { usedMail } from './space-mail.ts'
import { refuse } from './tool.ts'
import {
  affordable,
  billed,
  type Listed,
  measured,
  type Model,
  ModelError,
  type ModelResults,
  type Native,
  type Price,
  requestBound,
  retained,
} from '@yaks/model'
import { defect } from './defects.ts'
import { reserved, settled } from './model-spend.ts'
import { outputTokens } from './model-tokens.ts'
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
// The Pro plan (D-134567) carries the Plus plan's allowances; what it
// adds is a bigger model budget, the operator and support.
export let PRO = PLUS

// Photos and files, including on comped spaces (only apps/data are exempt).
// Free: proposed 1 GB allowance (T-37149), pending owner feedback.
export let FILES: Record<Tier, number> = {
  free: FREE.files,
  plus: PLUS.files,
  pro: PRO.files,
}

// Where the warning line sits, as a fraction of a ceiling.
export let WARN = 0.8

// Comped spaces retain their app/data/visit exemption independently of Plus.
export let ceilings = (tier: Tier | null, slug = '') =>
  COMPED.includes(slug)
    ? null
    : tier == 'pro'
    ? PRO
    : tier == 'plus'
    ? PLUS
    : FREE

// The letters, both directions, a space may spend in a month — the one
// allowance both tiers carry, because a letter costs money to carry however
// the plan is paid for, and the pricing page sells a number on each
// (site/pricing.tsx). Counted at the two mail doors as they happen:
// `metering` below for a letter that left, inbox.ts for one that arrived.
export let LETTERS: Record<Tier, number> = {
  free: 100,
  plus: 2_500,
  pro: 2_500,
}

export let letters = (tier: Tier | null): number => LETTERS[tier ?? 'free']

// Monthly allowances for the optional built-in builder. Making and changing
// apps through a connected agent (app_new, app_files) is not metered here.
export let BUILDS: Record<Tier, number> = {
  free: 5,
  plus: 100,
  pro: 100,
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
  pro: 60,
}

// The dollars a person's first space holds once, spent before its monthly
// budget (T-138717: "Once, then a larger monthly"). It guards a spike rather
// than rationing: Jeff, 2026-11-05, "the $100 is just to prevent a random
// spike, but basically we want them to not think about or hit the limit".
// Once per person: a space minted for someone who already holds one, or who
// has had theirs, holds none (directory.ts `mint`, `starter`).
export let STARTER = 100

// Compute seconds a month: the sandbox container's (sandbox.ts) and the compile
// at app_deploy's (esbuild.ts). An hour free is six builds' whole sandbox
// budget (sandbox.ts `BUDGET`); ten hours on the Plus plan is about $1.30 of
// standard-2 time at Cloudflare's rates (wrangler.toml). A compile's second
// costs less than a container's, so the one allowance bounds both.
export let SECONDS: Record<Tier, number> = {
  free: 3_600,
  plus: 36_000,
  pro: 36_000,
}

// What a tier costs a month, in whole dollars (D-32751). The number is
// tax-inclusive: $9 is what a customer pays anywhere, so this is the whole
// price rather than a subtotal something is added to. The payment provider
// holds the same number as the price config.ts `payments` sells the tier at,
// and that is what a card is charged against; this is the number the site
// says out loud — the pricing copy, and the `Offer`s in the home page's JSON-LD, which is what a search
// engine shows beside the result. A price change also updates the site's pages
// (site/home.tsx and site/pricing.tsx), billing_kernel_test.ts, and
// bin/verify-deploy{,_test}.ts. site_test.ts holds the pages to this number.
export let PRICE: Record<Tier, number> = { free: 0, plus: 9, pro: 49 }

// What a year costs, for a plan sold by the year as well (D-134567: organizations
// budget by the year). The payment provider holds it as the
// tier's yearly price in config.ts `payments`.
export let YEARLY: Partial<Record<Tier, number>> = { pro: 490 }

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
// What a spend adds to: each source, the visitors' share of the dollars,
// which is already counted in its source, and the dollars refunded.
let COUNTERS = [...SPENDS, 'visitors', 'refunded']

/** What a reading has spent: model, voice and text dollars together, less
 * what the platform's owner refunded this month (budget.ts). */
let used = (m: Meter, what: Spend) =>
  budgeted(what)
    ? m.models + m.realtime + (m.texts ?? 0) - (m.refunded ?? 0)
    : m[what]

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

/** The dollars a space's models and voice may spend this month before its
 * credit: the month the platform's owner set on it (budget.ts), else its
 * plan's, and what is left of its starter. */
export let budgetOf = (space: Space, now = new Date()) =>
  (space.budget ?? BUDGET[space.tier ?? 'free']) + starterOf(space, now)

/** The dollars a space's models and voice may spend this month: its budget,
 * and past it what its credit allows. */
export let limitOf = (space: Space, now = new Date()) =>
  budgetOf(space, now) + creditOf(space, now)

// ---- credit (D-134567) ------------------------------------------------------
//
// Past its monthly budget, a space on the Pro plan spends credit its
// owner bought in blocks, before it is spent, up to a monthly cap they set:
// $0 until they choose one, so a space with no credit spends what it always
// has. The cap bounds both what the space spends past its budget in a month
// and what credit it may hold for one month, so nothing is ever bought past
// it. What a month leaves unspent carries to the next, inside that month's
// cap. `credit.spent` counts every dollar drawn, and the month's meter what
// this month drew (`meter.credit`), so what the space held as the month
// began is a subtraction, and the draw is kept in the directory's own
// transaction with the spend that made it (meter-graph.ts `spend`).
//
// Only the Pro plan buys it (D-134567 answers T-131904 for that
// plan); credit already bought is spent on whatever plan the space is on.
// There is no top-up that buys a block when the budget runs out: that is a
// charge with nobody at the page, and Managed Payments, which sells every
// plan here, authorizes no charge of its own outside its subscriptions.

/** Dollars of credit one checkout buys. */
export let BLOCK = 10

/** The plans that may buy credit. */
export let CREDITED: Tier[] = ['pro']

/** What this month has drawn from the space's credit. */
export let drawnOf = (space: Space, now = new Date()) =>
  spent(space, now).credit ?? 0

/** The credit a space holds for this month: what it held as the month
 * began and has bought since, drawn or not. */
export let heldOf = (space: Space, now = new Date()) =>
  space.credit
    ? space.credit.bought - (space.credit.spent - drawnOf(space, now))
    : 0

/** The dollars past its budget a space may spend this month: the credit it
 * holds for it, up to its cap. */
export let creditOf = (space: Space, now = new Date()) =>
  Math.max(0, Math.min(space.credit?.cap ?? 0, heldOf(space, now)))

/** What is left of that this month. */
export let creditLeft = (space: Space, now = new Date()) =>
  Math.max(0, creditOf(space, now) - drawnOf(space, now))

/** Whether a space may buy a block now: its plan buys credit, and one more
 * leaves what it holds for the month within its cap. */
export let buyable = (space: Space, now = new Date()) =>
  CREDITED.includes(space.tier ?? 'free') &&
  heldOf(space, now) + BLOCK <= (space.credit?.cap ?? 0) + 1e-9

/**
 * The patch a spend makes to a space's credit and month: the draw, the
 * month's spending past the budget, up to what its credit allows, and a
 * block bought added to it. Null where the space has no credit and buys
 * none, which is every space that never chose a cap. `meter` is the month's
 * reading once the spend is added.
 *
 * ```ts
 * import { credited } from './meter.ts'
 * import { equal } from '@yaks/testing'
 *
 * let now = new Date('2026-11-07T12:00:00Z')
 * let base = { tier: 'pro', budget: 60, starter: 0, meter: null }
 * let space = { ...base, credit: { cap: 20, bought: 10, spent: 0 } } as never
 * equal(credited(space, { month: '2026-11', models: 65 }, 0, now), {
 *   credit: { cap: 20, bought: 10, spent: 5 },
 *   drawn: 5,
 * })
 * // never past what it bought
 * equal(credited(space, { month: '2026-11', models: 90 }, 0, now)?.drawn, 10)
 * equal(credited({ ...base, credit: null } as never, { month: '2026-11', models: 90 }, 0, now), null)
 * ```
 */
export let credited = (
  space: Space,
  meter: Partial<Meter>,
  bought: number,
  now = new Date(),
) => {
  let was = space.credit
  if (!was && !bought) return null
  let credit = {
    cap: was?.cap ?? 0,
    bought: (was?.bought ?? 0) + bought,
    spent: was?.spent ?? 0,
  }
  let before = drawnOf(space, now)
  let room = Math.max(
    0,
    Math.min(credit.cap, credit.bought - (credit.spent - before)),
  )
  let past = used({ ...spent(space, now), ...meter } as Meter, 'models') -
    budgetOf(space, now)
  let drawn = Math.max(0, Math.min(past, room))
  credit.spent += drawn - before
  return { credit, drawn }
}

/** Where a space stands against its cap this month: four fifths of it
 * drawn, or no more to draw, the cap or its credit reached; null otherwise
 * and for a space with no cap. */
export let capped = (space: Space, now = new Date()): Capped | null => {
  let cap = space.credit?.cap ?? 0
  if (!cap) return null
  let drawn = drawnOf(space, now)
  let room = creditOf(space, now)
  if (room && drawn >= room - 1e-9) return 'at'
  return drawn >= cap * WARN ? 'near' : null
}

export type Capped = 'near' | 'at'

/** The line a space's owner hears at a {@link capped} standing: what it
 * is, for which space, and where the cap is raised or credit bought. */
export let capLine = (
  space: Space,
  standing: Capped,
  env: Host = {},
  now = new Date(),
) => {
  let cap = space.credit?.cap ?? 0
  let at = planSettings(space.slug, env)
  if (standing == 'near') {
    return `${space.slug} has spent ${dollars(drawnOf(space, now))} of its ` +
      `${dollars(cap)} monthly cap on AI credit past its budget. Raise the ` +
      `cap or buy credit in plan settings: ${at}`
  }
  return creditOf(space, now) >= cap - 1e-9
    ? `${space.slug} has reached its ${dollars(cap)} monthly cap on AI ` +
      `credit, so its models, voices and texts stop until the 1st. Nothing ` +
      `is charged past the cap. Raise it in plan settings: ${at}`
    : `${space.slug} has spent the AI credit it bought, so its models, ` +
      `voices and texts stop until the 1st or until more is bought, up to ` +
      `its ${dollars(cap)} monthly cap. Buy credit in plan settings: ${at}`
}

/** The space's models and voice this month, against its budget. */
export let budget = (space: Space, now = new Date()): Budget => ({
  spent: used(spent(space, now), 'models'),
  limit: limitOf(space, now),
})

// ---- the visitors (T-144737) ------------------------------------------------
//
// Anyone who may write an app whose manifest opens its models or voices to
// them (`"models": "open"`, `"rtc": "open"`) spends the space's one budget,
// and its owner says how much of it visitors as a whole may spend a month
// (`space_set visitors`): a share of that budget, never a second one. What
// they spend is counted on the month's meter (`visitors`) beside the source
// counters, so a stranger can spend the share and never the owner's month.
// One visitor may ask for a number of model calls a day as well
// (`space_set visitor_calls`), counted in the directory as each is held
// (model-spend.ts `reserved`), so no one of them spends the whole share.

/** The model calls one visitor may ask a space's apps for in a day (UTC)
 * where its owner has set none. */
export let VISITOR_CALLS = 50

/** The model calls one visitor may ask a space's apps for today. */
export let visitorCalls = (space: Space) => space.visitorCalls ?? VISITOR_CALLS

/** What tells a visitor who has asked for `calls` model calls today that the
 * app answers them again tomorrow, or null while they have more. */
export let tooManyCalls = (space: Space, calls: number) =>
  calls < visitorCalls(space) ? null : `You have asked this app for as many ` +
    `answers today as its owner lets one visitor, so it cannot answer you ` +
    `now. It answers you again tomorrow`

/** The percent of a space's month budget its visitors may spend where its
 * owner has set none. */
export let VISITORS = 25

/** What a space's visitors spent this month, against the share of its
 * budget its owner lets them. */
export let visiting = (space: Space, now = new Date()): Budget => ({
  spent: spent(space, now).visitors ?? 0,
  limit: limitOf(space, now) * (space.visitors ?? VISITORS) / 100,
})

/** The dollars a call may hold now: what is left of the space's month, and,
 * for a visitor's, no more than is left of their share. */
export let left = (space: Space, now = new Date(), visitor = false) => {
  let room = (b: Budget) => Math.max(0, b.limit - b.spent)
  let all = room(budget(space, now))
  return visitor ? Math.min(all, room(visiting(space, now))) : all
}

/** What refuses holding `dollars` of a space's model and voice budget this
 * month, or null when it fits: the space at its ceiling, or too little left
 * for this call, or for a visitor's, their share spent. The directory refuses
 * a held spend with it (meter-graph.ts `spend`), and a caller quoting a call
 * says it before asking. A visitor is told plainly when the app answers them
 * again, and never of plans that are not theirs to buy. */
export let unaffordable = (
  space: Space,
  what: 'models' | 'realtime' | 'texts',
  dollars: number,
  now = new Date(),
  visitor = false,
) => {
  // A quote fitted to exactly what is left is a sum of floats, so a hold may
  // overshoot it by a rounding.
  if (dollars <= left(space, now, visitor) + 1e-9) return null
  if (visitor) {
    return `This app's visitors have spent what its owner sets aside for ` +
      `them this month, so it cannot answer you now. It answers visitors ` +
      `again on the 1st`
  }
  if (space.newcomer) return UNKEPT
  let { spent, limit } = budget(space, now)
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
  visitors: 0,
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
 * new month carries them. A refund counts on the month beside what each
 * source cost, and comes off `drawn`, so the month and the starter read as if
 * the dollars refunded had never been spent.
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
 * added({ ...sep, drawn: 4 }, { month: '2026-09', refunded: 0.5 })
 * // { month: '2026-09', refunded: 0.5, drawn: 3.5 }
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
  for (let k of COUNTERS) if (n(spend[k])) out[k] = n(held?.[k]) + n(spend[k])
  if (n(spend.builds)) out.built = n(meter?.built) + n(spend.builds)
  let cost = DOLLARS.reduce((sum, k) => sum + n(spend[k]), 0) -
    n(spend.refunded)
  if (cost) out.drawn = n(meter?.drawn) + cost
  return out
}

/** What a dollar is spent on, as the admin's spending page tells them
 * apart: each model provider by the name its plug serves under (config.ts),
 * a voice (an app's or an Operator's call, and speech), texts and numbers,
 * and the browser that renders a preview. A spend that names none is said
 * by what it buys (`sourceOf`). */
export let SOURCES: Record<string, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  'workers-ai': 'Workers AI',
  openrouter: 'OpenRouter',
  voice: 'Voice',
  texts: 'Texts',
  browser: 'Browser',
  models: 'Other models',
}

/** The source a spend is kept under: the one it names, else what it buys. */
export let sourceOf = (spend: Record<string, unknown>) =>
  typeof spend.source == 'string' && spend.source
    ? spend.source
    : Number(spend.realtime ?? 0)
    ? 'voice'
    : Number(spend.texts ?? 0)
    ? 'texts'
    : 'models'

/**
 * The patch a spend makes to a space's `trend`: what it cost on its day, in
 * all and under its source (`sourceOf`), and under `paid` too when the space
 * pays for a plan, so a day's dollars say who covered them: the space's own
 * plan, or the platform. A letter or a spend of nothing costs nothing and
 * leaves the days as they are.
 *
 * ```ts
 * import { trended } from './meter.ts'
 * import { equal } from '@yaks/testing'
 *
 * let now = Date.parse('2026-10-31T12:00:00Z')
 * equal(
 *   trended({ spend: { '2026-10-31': 1 } }, {
 *     models: 0.5,
 *     source: 'anthropic',
 *   }, now),
 *   {
 *     spend: { '2026-10-31': 1.5 },
 *     sources: { anthropic: { '2026-10-31': 0.5 } },
 *   },
 * )
 * equal(trended({}, { texts: 0.25 }, now, true), {
 *   spend: { '2026-10-31': 0.25 },
 *   sources: { texts: { '2026-10-31': 0.25 } },
 *   paid: { '2026-10-31': 0.25 },
 * })
 * equal(trended({}, { emails: 1 }, now), {})
 * ```
 */
export let trended = (
  trend: Record<string, unknown> | undefined,
  spend: Record<string, unknown>,
  now: number,
  paying = false,
): Record<string, unknown> => {
  let cost = DOLLARS.reduce((sum, k) => sum + Number(spend[k] ?? 0), 0)
  if (!cost) return {}
  let source = sourceOf(spend)
  let sources = (trend?.sources ?? {}) as Record<string, ByDay>
  return {
    spend: kept(trend?.spend as ByDay, cost, now),
    sources: { ...sources, [source]: kept(sources[source], cost, now) },
    ...paying ? { paid: kept(trend?.paid as ByDay, cost, now) } : {},
  }
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
  seconds: 'compute seconds',
}

let READ: Record<Ceiling, (g: Gauge) => string> = {
  apps: (g) => `${count(g.used)} of ${count(g.limit)} apps`,
  requests: (g) => `${count(g.used)} of ${count(g.limit)} request units`,
  bytes: (g) => `${size(g.used)} of ${size(g.limit)} of app data`,
  files: (g) => `${size(g.used)} of ${size(g.limit)} of photos and files`,
  emails: (g) => `${count(g.used)} of ${count(g.limit)} emails`,
  builds: (g) => `${count(g.used)} of ${count(g.limit)} builds`,
  seconds: (g) => `${count(g.used)} of ${count(g.limit)} compute seconds`,
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
  if (space.newcomer && what != 'apps' && budgeted(what)) return UNKEPT
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
    // The Operator's texts and an app's broadcast stop here; the answers to
    // STOP and HELP a carrier requires go regardless (app-texts.ts), and so
    // does the text telling a person their Operator's answer did not
    // (operator-channels.ts `texted`).
    texts: () =>
      `${space.slug}'s model and voice budget for this month is spent, and ` +
      `texts spend it too — texts go again on the 1st`,
    seconds: () =>
      `${space.slug} is on the ${tier} tier, which is ${
        count(allowance('seconds', space.tier))
      } compute seconds a month (the sandbox, and compiling ` +
      `TypeScript and npm packages at app_deploy), and this month's are ` +
      `spent — they come back on the 1st, and an app of html, css and js ` +
      `needs none`,
  }[what]()
  return `${said}. ${plans(space, env)}`
}

// What stops a newcomer's build at its budget, spent or too little for the
// next call: their space holds one build (newcomer.ts `oneBuild`), and what
// lifts it is giving their email in the card above their chat (operator-page.ts
// `keepCard`, newcomer.ts `keep`), not a plan they have no way to buy yet.
export let UNKEPT = `This free build has used what it can before you keep ` +
  `it. Give your email in the card above this chat to keep this app and ` +
  `keep building, free`

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
  spend: Partial<Record<Spend, number>> & { source?: string },
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
  source?: string,
) => {
  if (cost <= 0 && seconds <= 0) return
  await spending(
    env,
    space,
    { models: cost, seconds, ...source ? { source } : {} },
    now,
  )
}

/** The original media call and its spend commit together, once. A crash after
 * commit is recognized by the ledger rather than charged a second time. */
export let countedMedia = async (
  env: { STORE: Namespace },
  space: Pick<Space, 'eid'>,
  call: string,
  dollars: number,
  reported = true,
  source?: string,
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
        spend: { month: monthOf(new Date()), models: dollars, source },
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
  bind: Partial<Env> & { STORE?: Namespace },
  from: () => string | null,
  sender: Sender,
): Sender => ({
  send: async (m) => {
    let ns = bind.STORE
    let box = ns ? await mailedTo(from() ?? '', directoryOf(ns), bind) : null
    if (!ns || !box) return await sender.send(m)
    let { space } = box
    let no = refusedSpend(space, 'emails', bind)
    if (no) throw refuse('limit', no)
    let receipt = await sender.send(m)
    await counted({ STORE: ns }, space)
    // A Plus plan space's first letter sets its subdomain up for mail.
    await usedMail(bind, space)
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
 * first provider config.ts `answering` names whose door answers the model
 * asked for (providers.ts `native`), OpenAI's for the chat models apps
 * already name and Workers AI's binding for the rest: `./api/ai/run`,
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
 * A `visitor`'s calls, named by who they are, are held to their share of
 * the budget and to the calls one visitor may ask for in a day as well.
 */
export let metered = (
  bind: Partial<Env> & { STORE?: Namespace } & Host,
  spaceOf: (dir: Directory) => Promise<Space | null>,
  rows?: {
    price(name: string): Promise<Price | undefined>
    answered(provider: string, name: string, info: Listed): Promise<void>
  },
  visitor?: string,
): Native => ({
  run: async (model, input, options) => {
    let ns = bind.STORE
    let dir = ns ? directoryOf(ns) : null
    let space = dir ? await spaceOf(dir) : null
    let provider = ''
    let { native, platform } = await import('./providers.ts')
    let door = ns && space
      ? native(bind, platform(bind as Env), {
        hold: (quote) =>
          reserved({ STORE: ns }, space, quote, undefined, {
            visitor,
            source: provider,
          }),
        answered: (name, info) =>
          rows?.answered(provider, name, info) ?? Promise.resolve(),
        report: (e, model) =>
          e instanceof ModelError && e.code == 'model'
            ? defect(e, { request: 'model price', model }, {
              fault: `model-price:${model}`,
            })
            : defect(e, { request: `model ${model}`, space: space.slug }),
      }, model)
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

/** Deliver a saved result and finish only its original, idempotent settlement. */
export let resultOf = (
  bind: Partial<Pick<Env, 'STORE'>>,
  results: ModelResults,
): NonNullable<Model['result']> =>
async (call) => {
  let result = await results.read(call)
  if (!result) return
  let cost = result.reply.cost
  if (cost != null) {
    if (!bind.STORE) throw new ModelError('unbound')
    if (
      !await settled(
        { STORE: bind.STORE },
        call,
        cost,
        result.reply.costReported,
      )
    ) {
      throw new Error(
        'Completed model result has no original reservation',
      )
    }
  }
  return result
}

/** Why a request's most cost cannot be known before it runs, or null: its
 * model has no listed price, its provider lists no context window to bound
 * the input by, or it asks for output that is not priced by the token. Such a
 * call is refused before anything is held, saying which. */
let unboundable = (
  req: Parameters<Model>[0],
  tariff: Price | undefined | null | false,
  window: number | undefined,
) => {
  let cannot = `so the most this call could cost can't be known, and it is ` +
    `not made`
  let other = req.modalities?.filter((m) => m != 'text')
  if (other?.length) {
    return `${req.model} is asked for ${other.join(' and ')} output, which ` +
      `is not priced by the token, ${cannot}`
  }
  if (!tariff) return `${req.model} has no listed price, ${cannot}`
  if (window == null) {
    return `${req.model}'s provider lists no context window for it, ${cannot}`
  }
  return null
}

/** A hosted provider spends from the same space budget as every other door.
 * Costs are supplied by the adapter, never guessed from media JSON. A call
 * `visiting` names a visitor for is held to their share as well, and counted
 * among their calls of the day. */
export let accounted = (
  bind: Host & Partial<Pick<Env, 'STORE'>>,
  spaceOf: (dir: Directory) => Promise<Space | null>,
  model: Model,
  price?: (name: string) => Promise<Price | undefined>,
  visiting?: (req: Parameters<Model>[0]) => Promise<string | undefined>,
  source?: string,
  results?: ModelResults,
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
      let listed = reached('priced', info?.price ?? await price?.(req.model))
      // Held and charged at what the request can be billed.
      let tariff = listed && retained(listed, req.cacheRetention)
      let window = info?.context ??
        (tariff && Object.values(tariff).every((p) => p == 0) ? 0 : undefined)
      let unbounded = !own && unboundable(req, tariff, window)
      if (unbounded) throw new ModelError('limit', unbounded)
      let call = req.call ?? mint()
      let visitor = await visiting?.(req)
      let hold = await reserved(
        { STORE: ns },
        space,
        (remaining) => {
          if (own) return model.quote!(req, remaining) ?? null
          let output = req.questions ? window : outputTokens(info, req.tokens)
          // What the provider's own tools may add is reserved beside it.
          let extra = model.hosted
          let quote = affordable(
            tariff!,
            requestBound(req, window!) + (extra?.input ?? 0),
            remaining,
            output,
            extra?.searches,
          )
          return req.questions && quote?.tokens != output ? null : quote
        },
        call,
        { visitor, source },
      )
      reached('reserved', hold)
      let submitted = false
      let requestedAt = Date.now()
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
        // Media the space's files had no room to keep is not charged for,
        // though its provider may have been paid.
        let unkept = error instanceof ModelError && error.code == 'space_full'
        if (!submitted || unkept) await hold.settle(0, false)
        throw error
      }
      let cost = measured(reply, tariff)
      if (cost && (!Number.isFinite(cost.dollars) || cost.dollars < 0)) {
        throw new Error('Hosted provider returned no valid request cost')
      }
      reply = { ...reply, cost: cost?.dollars, costReported: cost?.reported }
      try {
        await results?.save(call, {
          reply,
          mark: model.mark?.(reply, { requestedAt }),
        })
        if (cost) await hold.settle(cost.dollars, cost.reported)
      } catch (error) {
        if (!results) throw error
        throw new ModelError('model_result_delivery', String(error), {
          after: 1000,
        })
      }
      return reply
    },
    model,
    {
      ...results
        ? {
          result: resultOf(bind, results),
        }
        : {},
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
            source,
          )
        }
        return reply
      },
    },
  )
