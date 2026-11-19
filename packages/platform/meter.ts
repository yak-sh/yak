// A space's month: what it spent, what its plan (./plans.ts) and its owner
// let it spend, and the patches a spend makes. All of it is arithmetic on a
// space as the directory reads it (`Metered`); workers/yak counts the spends
// and writes them, and ./standing.ts says where a space stands.
import { type ByDay, kept } from '@yaks/ui/chart'
import {
  allowance,
  BUDGET,
  budgeted,
  DOLLARS,
  type Limited,
  paid,
  type Spend,
  STARTER,
  type Tier,
  tierOf,
  WARN,
} from './plans.ts'

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
  // the same space budget as `models` (`budget`).
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
  // together: what the starter is drawn against (`starterOf`).
  drawn?: number
  // The dollars of models, voice and texts this month that were spent for
  // the space's apps' visitors, already counted in each source's own.
  visitors?: number
  // The dollars of models, voice and texts this month that the platform's
  // owner refunded (budget.ts): off what the month spent and off `drawn`,
  // while each source's own still says what it cost.
  refunded?: number
  // The dollars of models, voice and texts this month past the space's
  // budget, drawn from its credit (`credited`).
  credit?: number
  at: string
}

/** A space's AI credit (D-134567, `creditOf`): the cap its owner
 * set on a month past its budget, and every dollar of it bought and spent,
 * so what was not spent carries to the next month. */
export type Credit = { cap: number; bought: number; spent: number }

/** A space as its plan and its meter read it: what its month is spent
 * against. The directory's whole space (workers/yak directory.ts `Space`)
 * is one of these and more. */
export type Metered = {
  slug: string
  // What this space pays (D-32751), a comp read as the plan it gives
  // (`tierOf`). Null for a space the sweep has not reached yet, which means
  // free — the terms every space is on today.
  tier: Tier | null
  // Its AI credit, where its owner ever set a cap or bought any; null on
  // every other space, which spends nothing past its budget.
  credit?: Credit | null
  // The space's monthly dollar budget for models and voice where the
  // platform's owner set one (workers/yak budget.ts), in place of its plan's
  // (`BUDGET`). Null on every space nobody has given one, which is almost all.
  budget: number | null
  // Whether that budget is a newcomer's one build (newcomer.ts `oneBuild`):
  // what lifts it is keeping the app, so its refusals ask for their email
  // rather than offering a plan (./standing.ts `UNKEPT`).
  newcomer?: boolean
  // The dollars this space holds once, before its monthly budget, where it
  // holds other than `STARTER`: none for a person's later spaces
  // (directory.ts `mint`). Absent on almost every space.
  starter?: number | null
  // The percent of that budget its apps' visitors may spend together, where
  // its owner set one (`visiting`); none is `VISITORS`.
  visitors?: number | null
  // The model calls one visitor may ask its apps for in a day, where its
  // owner set a number (`visitorCalls`); none is `VISITOR_CALLS`.
  visitorCalls?: number | null
  meter: Meter | null
}

/** The components of a space's directory row that say how it is
 * {@link Metered}, each optional, since a row is whichever of them it wears. */
export type MeteredRow = {
  space?: { slug: string; store?: string | null }
  plan?: {
    tier?: Tier | null
    customer?: string | null
    subscription?: string | null
    status?: string | null
    until?: string | null
    ending?: string | null
    at?: string | null
  }
  comped?: { until: string }
  comp?: {
    tier: 'plus' | 'pro'
    reason: string
    by: string | { eid: string }
  }
  credit?: {
    cap?: number | null
    bought?: number | null
    spent?: number | null
  }
  budget?: { dollars?: number | null; newcomer?: boolean | null }
  starter?: { dollars?: number | null }
  visitor_share?: { percent?: number | null; calls?: number | null }
  meter?: Partial<Meter>
}

// The meter as a whole number, however little of the row is written: a property
// nobody has filled reads zero, so nothing downstream tests for null twice.
export let meterOf = (r: MeteredRow): Meter | null =>
  r.meter
    ? {
      month: r.meter.month ?? '',
      requests: r.meter.requests ?? 0,
      ws_messages: r.meter.ws_messages ?? 0,
      ws_hibernated: r.meter.ws_hibernated ?? 0,
      rows_read: r.meter.rows_read ?? 0,
      rows_written: r.meter.rows_written ?? 0,
      bytes: r.meter.bytes ?? 0,
      ...r.meter.visits == null ? {} : { visits: r.meter.visits },
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

/** A space's row as its meter reads it. */
export let meteredOf = (r: MeteredRow): Metered => ({
  slug: r.space!.slug,
  tier: tierOf(
    r.space!.slug,
    r.plan?.tier ?? null,
    r.comped?.until,
    Date.now(),
    r.comp,
  ),
  credit: r.credit
    ? {
      cap: r.credit.cap ?? 0,
      bought: r.credit.bought ?? 0,
      spent: r.credit.spent ?? 0,
    }
    : null,
  budget: r.budget?.dollars ?? null,
  newcomer: !!r.budget?.newcomer,
  starter: r.starter?.dollars ?? null,
  visitors: r.visitor_share?.percent ?? null,
  visitorCalls: r.visitor_share?.calls ?? null,
  meter: meterOf(r),
})

// What one store did, as the analytics answer them (usage.ts `read`). Bytes
// come from the store itself, and the month and the letters from the row being
// written (`Meter` is the whole component).
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
export let thisMonth = (meter: Meter | null, month: string): Meter | null =>
  meter && meter.month == month ? meter : null

export let monthOf = (at: Date): string => at.toISOString().slice(0, 7)

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
): number => {
  let hibernated = m.ws_hibernated ?? 0
  return Math.ceil(
    m.requests - hibernated + (m.ws_messages ?? 0) / 20,
  )
}

/** What a month counts a spend by: each one the plan allows a number of
 * (`Limited`), and the dollars that spend its budget. */
let SPENDS: Spend[] = [
  'emails',
  'builds',
  'models',
  'realtime',
  'texts',
  'seconds',
]
// What a spend adds to: each source, the visitors' share of the dollars,
// which is already counted in its source, and the dollars refunded.
let COUNTERS = [...SPENDS, 'visitors', 'refunded']

/** The dollars a space may spend and has spent, or a visitors' share of
 * them. */
export type Budget = { spent: number; limit: number }

/** What a reading has spent: model, voice and text dollars together, less
 * what the platform's owner refunded this month (workers/yak budget.ts). */
export let used = (m: Meter, what: Spend): number =>
  budgeted(what)
    ? m.models + m.realtime + (m.texts ?? 0) - (m.refunded ?? 0)
    : m[what]

/** A space on the free tier: not on a paid plan, and not comped
 * (`tierOf` reads a comp as the Plus plan). */
export let free = (space: Pick<Metered, 'tier'>): boolean => !paid(space.tier)

/** Whether a space is at an allowance this month; `more` is what the caller
 * holds that is not counted yet — the dollars and seconds of a build still
 * going. */
export let over = (
  space: Metered,
  what: Limited,
  more: number = 0,
  now: Date = new Date(),
): boolean =>
  used(spent(space, now), what) + more >= allowance(what, space.tier)

/** What is left of a space's starter as this month began: what it holds,
 * less every dollar it drew before this month (`drawn` counts them all). */
export let starterOf = (space: Metered, now: Date = new Date()): number =>
  Math.max(0, (space.starter ?? STARTER) - drawnBefore(space, now))

// Every dollar a space drew before this month.
let drawnBefore = (space: Metered, now: Date) =>
  Math.max(0, (space.meter?.drawn ?? 0) - used(spent(space, now), 'models'))

/** The starter that leaves `dollars` more of it than {@link starterOf} does
 * now: a grant on top of what is left, never swallowed by what was drawn
 * before it (workers/yak billing.ts `granted`).
 *
 * ```ts
 * import { meterOf, starterOf, topUp } from '@yaks/platform/meter'
 * import { equal } from '@yaks/testing'
 *
 * let now = new Date('2026-11-19T00:00:00Z')
 * let space = (starter: number | null, drawn: number) => ({
 *   slug: 'a',
 *   tier: null,
 *   budget: null,
 *   starter,
 *   meter: meterOf({ meter: { month: '2026-11', drawn } }),
 * })
 * equal(topUp(space(null, 5), 100, now), 120)
 * equal(topUp(space(0, 150), 100, now), 250)
 * equal(starterOf({ ...space(0, 150), starter: 250 }, now), 100)
 * ```
 */
export let topUp = (
  space: Metered,
  dollars: number,
  now: Date = new Date(),
): number =>
  Math.max(space.starter ?? STARTER, drawnBefore(space, now)) + dollars

/** The dollars a space's models and voice may spend this month before its
 * credit: the month the platform's owner set on it (budget.ts), else its
 * plan's, and what is left of its starter. */
export let budgetOf = (space: Metered, now: Date = new Date()): number =>
  (space.budget ?? BUDGET[space.tier ?? 'free']) + starterOf(space, now)

/** The dollars a space's models and voice may spend this month: its budget,
 * and past it what its credit allows. */
export let limitOf = (space: Metered, now: Date = new Date()): number =>
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
// transaction with the spend that made it (./meter-graph.ts `spend`).
//
// Only the Pro plan buys it (D-134567 answers T-131904 for that
// plan); credit already bought is spent on whatever plan the space is on.
// There is no top-up that buys a block when the budget runs out: that is a
// charge with nobody at the page, and Managed Payments, which sells every
// plan here, authorizes no charge of its own outside its subscriptions.

/** Dollars of credit one checkout buys. */
export let BLOCK: number = 10

/** The plans that may buy credit. */
export let CREDITED: Tier[] = ['pro']

/** What this month has drawn from the space's credit. */
export let drawnOf = (space: Metered, now: Date = new Date()): number =>
  spent(space, now).credit ?? 0

/** The credit a space holds for this month: what it held as the month
 * began and has bought since, drawn or not. */
export let heldOf = (space: Metered, now: Date = new Date()): number =>
  space.credit
    ? space.credit.bought - (space.credit.spent - drawnOf(space, now))
    : 0

/** The dollars past its budget a space may spend this month: the credit it
 * holds for it, up to its cap. */
export let creditOf = (space: Metered, now: Date = new Date()): number =>
  Math.max(0, Math.min(space.credit?.cap ?? 0, heldOf(space, now)))

/** What is left of that this month. */
export let creditLeft = (space: Metered, now: Date = new Date()): number =>
  Math.max(0, creditOf(space, now) - drawnOf(space, now))

/** Whether a space may buy a block now: its plan buys credit, and one more
 * leaves what it holds for the month within its cap. */
export let buyable = (space: Metered, now: Date = new Date()): boolean =>
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
 * import { credited } from '@yaks/platform/meter'
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
  space: Metered,
  meter: Partial<Meter>,
  bought: number,
  now: Date = new Date(),
): { credit: Credit; drawn: number } | null => {
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
export let capped = (space: Metered, now: Date = new Date()): Capped | null => {
  let cap = space.credit?.cap ?? 0
  if (!cap) return null
  let drawn = drawnOf(space, now)
  let room = creditOf(space, now)
  if (room && drawn >= room - 1e-9) return 'at'
  return drawn >= cap * WARN ? 'near' : null
}

export type Capped = 'near' | 'at'

/** The space's models and voice this month, against its budget. */
export let budget = (space: Metered, now: Date = new Date()): Budget => ({
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
export let VISITOR_CALLS: number = 50

/** The model calls one visitor may ask a space's apps for today. */
export let visitorCalls = (space: Metered): number =>
  space.visitorCalls ?? VISITOR_CALLS

/** The percent of a space's month budget its visitors may spend where its
 * owner has set none. */
export let VISITORS: number = 25

/** What a space's visitors spent this month, against the share of its
 * budget its owner lets them. */
export let visiting = (space: Metered, now: Date = new Date()): Budget => ({
  spent: spent(space, now).visitors ?? 0,
  limit: limitOf(space, now) * (space.visitors ?? VISITORS) / 100,
})

/** The dollars a call may hold now: what is left of the space's month, and,
 * for a visitor's, no more than is left of their share. */
export let left = (
  space: Metered,
  now: Date = new Date(),
  visitor: boolean = false,
): number => {
  let room = (b: Budget) => Math.max(0, b.limit - b.spent)
  let all = room(budget(space, now))
  return visitor ? Math.min(all, room(visiting(space, now))) : all
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
export let spent = (space: Metered, now: Date = new Date()): Meter =>
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
 * import { added } from '@yaks/platform/meter'
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
export let sourceOf = (spend: Record<string, unknown>): string =>
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
 * import { trended } from '@yaks/platform/meter'
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
  paying: boolean = false,
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
