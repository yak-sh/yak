// What each plan gives a space: its tier, the ceilings and allowances it
// answers to, its model and voice budget and what it costs. The space's month
// is spent against these (./meter.ts) and said aloud (./standing.ts);
// workers/yak counts it.
import type { Comp } from './comp.ts'

export type Tier = 'free' | 'plus' | 'pro'

/** What each plan is called where a person reads it. The stored tier keeps
 * its id (`plus` is the Personal plan, D-476), so a rename is this one line
 * and no row moves. */
export let NAMES: Record<Tier, string> = {
  free: 'Free',
  plus: 'Personal',
  pro: 'Pro',
}

/** A plan as a person reads it: "the Personal plan" or "the Pro plan", never
 * a bare name (M-37846).
 *
 * ```ts
 * import { planName } from '@yaks/platform/plans'
 * import { equal } from '@yaks/testing'
 *
 * equal(planName('plus'), 'the Personal plan')
 * equal(planName(null), 'the free plan')
 * ```
 */
export let planName = (tier: Tier | null | undefined): string =>
  !tier || tier == 'free' ? 'the free plan' : `the ${NAMES[tier]} plan`

/** Whether a tier is paid for: the Personal plan or the Pro plan
 * (D-134567). Every paid feature asks this, never one plan's name. */
export let paid = (tier: Tier | null | undefined): boolean =>
  tier == 'plus' || tier == 'pro'

// Spaces the platform comps. `yak` holds its own directory, whose requests
// serve every space. `yourname` is its shopfront, with the example apps every
// home page links to. Neither has app/data or visitor ceilings (`ceilings`
// below); platform traffic must not shut the directory's public doors.
//
// These two platform spaces keep their unlimited app/data/visit exemption.
// Operational comps are stamped comp{tier, reason, by} rows, managed through
// the platform-only comp.ts door independently of Stripe's subscription.
export let COMPED: string[] = ['yourname', 'yak']

/**
 * The tier a space is on. Paid features and usage allowances: `plus`
 * also applies to comps. Their separate app/data exemption is resolved by
 * `ceilings` from COMPED. A space given the Personal plan free until a day
 * (`comped`: a month for each person its owner invited who built an app,
 * workers/yak referral.ts, or the day its trial runs through, ./trial.ts
 * `freeUntil`) is on it until then. Operational comps are granted through the
 * platform-only door (workers/yak comp.ts).
 *
 * ```ts
 * import { tierOf } from '@yaks/platform/plans'
 * import { equal } from '@yaks/testing'
 *
 * equal(tierOf('yourname', null), 'plus')
 * equal(tierOf('yourname', 'free'), 'plus')
 * equal(tierOf('jeff', null), null)
 * equal(tierOf('jeff', 'free'), 'free')
 * equal(tierOf('jeff', 'plus'), 'plus')
 * equal(tierOf('jeff', 'free', '2999-01-01'), 'plus')
 * equal(tierOf('jeff', 'plus', null, Date.now(), { tier: 'pro' }), 'pro')
 * ```
 */
export let tierOf = (
  slug: string,
  tier: Tier | null,
  comped: string | null = null,
  now: number = Date.now(),
  comp?: Pick<Comp, 'tier'> | null,
): Tier | null => {
  let base = COMPED.includes(slug)
    ? 'plus'
    : !paid(tier) && comped && Date.parse(comped) > now
    ? 'plus'
    : tier
  return comp?.tier == 'pro' || base == 'pro' ? 'pro' : comp?.tier ?? base
}

// ---- the ceilings (T-32758) ------------------------------------------------
//
// At 80% the agent gets one line on the unseen channel (unseen.ts `ceiling`).
// Request units are never a ceiling on visitors: however many come, they are
// served, and the owner is told when a month's units pass the plan's figure.

let GB = 1024 ** 3

/** What a plan holds a space to: its apps (null for as many as it likes),
 * the month's request units, its app data and its photos and files. */
export type Ceilings = {
  apps: number | null
  requests: number
  bytes: number
  files: number
}

// The free tier, as decided (D-32751): what a space gets for nothing.
export let FREE: Ceilings = { apps: 5, requests: 50_000, bytes: GB, files: GB }
export let PLUS: Ceilings = {
  apps: null,
  requests: 1_000_000,
  bytes: 10 * GB,
  files: 50 * GB,
}
// The Pro plan (D-134567) holds more of each than the Personal plan, about five
// times. It also adds a larger model budget, the Operator and support.
export let PRO: Ceilings = {
  apps: null,
  requests: 5_000_000,
  bytes: 50 * GB,
  files: 250 * GB,
}

// Photos and files, including on comped spaces (only apps/data are exempt).
// Free: proposed 1 GB allowance (T-37149), pending owner feedback.
export let FILES: Record<Tier, number> = {
  free: FREE.files,
  plus: PLUS.files,
  pro: PRO.files,
}

// Where the warning line sits, as a fraction of a ceiling.
export let WARN: number = 0.8

// Comped spaces retain their app/data/visit exemption independently of the Personal plan.
export let ceilings = (tier: Tier | null, slug = ''): Ceilings | null =>
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
// workers/yak meter.ts `counted` for a letter that left, inbox.ts for one
// that arrived.
export let LETTERS: Record<Tier, number> = {
  free: 100,
  plus: 2_500,
  pro: 10_000,
}

export let letters = (tier: Tier | null): number => LETTERS[tier ?? 'free']

// Each space spends from one monthly AI budget after its building credit.
export let BUDGET: Record<Tier, number> = {
  free: 10,
  plus: 8,
  pro: 35,
}

export let FREE_BUDGET_FROM: string = '2026-12'

let MONTHLY: Record<string, Partial<Record<Tier, number>>> = {
  '2026-11': { plus: 30, pro: 100 },
}

/** Included AI use for a UTC month. November's allowances stay in effect
 * through month end. From December on the platform can set Free's amount. */
export let monthlyBudget = (
  tier: Tier | null,
  month: string,
  freeMonthly?: number | null,
): number => {
  let plan = tier ?? 'free'
  return plan == 'free'
    ? month < FREE_BUDGET_FROM ? 20 : freeMonthly ?? BUDGET.free
    : MONTHLY[month]?.[plan] ?? BUDGET[plan]
}

// The building credit given once, spent before a space's monthly budget.
// A person's first space starts its trial with {@link STARTER}, which is the
// trial's AI use (./trial.ts). Subscribing to the Personal plan while that
// trial runs or is paused adds {@link SUBSCRIBED}, once
// (`plan_trial.subscribed`); a space never given a trial adds it on its
// owners' first paid subscription, once a person (`subscribed`).
// The first time a space takes the Pro plan, paid or comped, it adds
// {@link PRO_GRANT}, once per space, stamped `pro_grant` (workers/yak
// directory.ts `granting`).
export let STARTER: number = 20
export let SUBSCRIBED: number = 100
export let PRO_GRANT: number = 200

// Compute seconds a month: the sandbox container's (sandbox.ts) and the compile
// at app_deploy's (esbuild.ts). An hour free is six builds' whole sandbox
// budget (sandbox.ts `BUDGET`); ten hours on the Personal plan is about $1.30 of
// standard-2 time at Cloudflare's rates (wrangler.toml), and fifty on the Pro
// plan about $6.50. A compile's second
// costs less than a container's, so the one allowance bounds both.
export let SECONDS: Record<Tier, number> = {
  free: 3_600,
  plus: 36_000,
  pro: 180_000,
}

// What a tier costs a month, in whole dollars (D-32751). The number is
// tax-inclusive: $12 is what a customer pays anywhere, so this is the whole
// price rather than a subtotal something is added to. The payment provider
// holds the same number as the price config.ts `payments` sells the tier at,
// and that is what a card is charged against; this is the number the site
// says out loud — the pricing copy, and the `Offer`s in the home page's JSON-LD, which is what a search
// engine shows beside the result. A price change also updates the site's copy
// (apps/home/copy.json, then `deno task content`) and the provider's price,
// whose old id stays recognized as config.ts `payments` `kept`. site_test.ts
// holds the pages to this number.
export let PRICE: Record<Tier, number> = { free: 0, plus: 12, pro: 49 }

// What a year costs, for a plan sold by the year as well (D-134567: organizations
// budget by the year), ten months' price. The payment provider holds it as the
// tier's yearly price in config.ts `payments`.
export let YEARLY: Partial<Record<Tier, number>> = { plus: 120, pro: 490 }

export let CURRENCY: string = 'USD'

let DOMAIN_CAP = 1200

/** Annual renewal credit, in cents, for one domain registered through yaks.app. */
export let DOMAIN_CREDIT = {
  free: { month: 0, year: 0 },
  plus: { month: 0, year: DOMAIN_CAP },
  pro: { month: DOMAIN_CAP, year: DOMAIN_CAP },
}

export let domainCredit = (
  tier: Tier | null,
  per?: 'month' | 'year' | null,
): number => DOMAIN_CREDIT[tier ?? 'free'][per ?? 'month']

export let DOMAIN_RENEWAL: string =
  `One domain’s renewal is included on ${planName('pro')}, and on ${
    planName('plus')
  } when you pay yearly. ` +
  'The plan covers up to $12 a year for that domain. Other domains renew at the registrar’s price, with no markup.'

// ---- the space (D-131886) ----------------------------------------------------
//
// Every allowance and the model budget belong to the space: each one compares
// the space's own meter with the space's own plan, and nothing is summed
// across the spaces one person owns. A person has no plan, allowance or
// budget; they own at most {@link SPACES} free spaces (T-131887). Jeff,
// 2026-10-22: "and yes, one included space." Spaces that were free before
// the cap stay free; it only stops making or restoring another.

/** The free spaces one person may own, unless their own allowance says
 * otherwise ({@link freeSpaces}). */
export let SPACES: number = 1

/** An allowance of free spaces as an admin set it (admin_spaces): a
 * `count`, or none for no limit. */
export type Allowance = { count?: number | null }

/** The free spaces this person may own: the first allowance set, in the
 * order given (their own, then their role's), else {@link SPACES}. An
 * allowance without a count is no limit. */
export let freeSpaces = (
  ...set: (Allowance | null | undefined)[]
): number => {
  let first = set.find(Boolean)
  return first ? first.count ?? Infinity : SPACES
}

/** The monthly usage counters. Models, realtime and texts spend the same
 * space budget; their separate counters still say what each source cost. */
export type Spend =
  | 'emails'
  | 'models'
  | 'realtime'
  | 'texts'
  | 'seconds'
/** The spends counted in dollars against the space's one budget. */
export type Dollars = 'models' | 'realtime' | 'texts'
export let DOLLARS: Spend[] = ['models', 'realtime', 'texts']
export let budgeted = (what: Spend): what is Dollars => DOLLARS.includes(what)
/** The spends each plan allows a number of. */
export type Limited = Exclude<Spend, Dollars>

let ALLOWANCE: Record<Limited, Record<Tier, number>> = {
  emails: LETTERS,
  seconds: SECONDS,
}
export let LIMITED: Limited[] = Object.keys(ALLOWANCE) as Limited[]

/** What a tier allows of a spend in a month. */
export let allowance = (what: Limited, tier: Tier | null): number =>
  ALLOWANCE[what][tier ?? 'free']
