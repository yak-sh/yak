// Where a space stands against its plan, as a person reads it: its gauges,
// the line an agent hears near a ceiling, and every refusal a spend or a
// write meets there. The arithmetic is ./meter.ts's and the figures
// ./plans.ts's; each line ends at the page that describes the plans.
import { size } from '@yaks/fp'
import type { Host } from './host.ts'
import { planSettings } from './routes.ts'
import {
  allowance,
  BUDGET,
  budgeted,
  builds,
  ceilings,
  FILES,
  letters,
  LIMITED,
  type Limited,
  paid,
  PRO,
  PRO_GRANT,
  SPACES,
  type Spend,
  SUBSCRIBED,
  type Tier,
  WARN,
} from './plans.ts'
import {
  budget,
  type Capped,
  creditOf,
  drawnOf,
  left,
  limitOf,
  type Meter,
  type Metered,
  over,
  requestUnits,
  spent,
  used,
  visitorCalls,
} from './meter.ts'

/** What a space, or one of its apps, holds: app data and photos and files. */
export type Held = { bytes: number; files: number }

/** What a space holds, and each app's share of it by identity. */
export type Holding = Held & {
  apps: Map<string, Held>
  names?: Map<string, string>
}

/** A space's standing as data (`standingOf`). */
export type SpaceStanding = {
  tier: Tier
  month: string
  read: string | null
  level: Level
  limits: Partial<Record<Ceiling, Gauge>>
  models: number
  voice: number
  settings: string
}

/** Where a space stands: nothing to say, near a ceiling, or past one. */
export type Level = 'ok' | 'near' | 'over'

/** The line a space's owner hears at a {@link capped} standing: what it
 * is, for which space, and where the cap is raised or credit bought. */
export let capLine = (
  space: Metered,
  standing: Capped,
  env: Host = {},
  now: Date = new Date(),
): string => {
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

/** What tells a visitor who has asked for `calls` model calls today that the
 * app answers them again tomorrow, or null while they have more. */
export let tooManyCalls = (space: Metered, calls: number): string | null =>
  calls < visitorCalls(space) ? null : `You have asked this app for as many ` +
    `answers today as its owner lets one visitor, so it cannot answer you ` +
    `now. It answers you again tomorrow`

/** What refuses holding `dollars` of a space's model and voice budget this
 * month, or null when it fits: the space at its ceiling, or too little left
 * for this call, or for a visitor's, their share spent. The directory refuses
 * a held spend with it (./meter-graph.ts `spend`), and a caller quoting a call
 * says it before asking. A visitor is told plainly when the app answers them
 * again, and never of plans that are not theirs to buy. */
export let unaffordable = (
  space: Metered,
  what: 'models' | 'realtime' | 'texts',
  dollars: number,
  now: Date = new Date(),
  visitor: boolean = false,
): string | null => {
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
  space: Metered,
  what: Spend,
  env: Host = {},
  more: number = 0,
  now: Date = new Date(),
): string | null => {
  if (budgeted(what)) {
    let b = budget(space, now)
    return b.spent + more >= b.limit ? atCeiling(space, what, env) : null
  }
  return over(space, what, more, now) ? atCeiling(space, what, env) : null
}

/** A plan as a person reads it: "the free plan", "the Plus plan" or "the
 * Pro plan", never a bare tier name (M-37846). */
export let planName = (tier: Tier | null): string =>
  `the ${{ free: 'free', plus: 'Plus', pro: 'Pro' }[tier ?? 'free']} plan`

/**
 * The plan a space is on and what it allows a month, in one line: what its
 * Operator is told, so it speaks of this space's allowances and never a new
 * free space's. A comped space reads as the plan it is given.
 *
 * ```ts
 * import { planned } from '@yaks/platform/standing'
 * import { equal } from '@yaks/testing'
 *
 * equal(
 *   planned({ slug: 'yourname', tier: 'plus' }),
 *   'yourname is on the Plus plan: as many apps as it likes, 2,500 emails, ' +
 *     '100 built-in builds and 36,000 compute seconds a month.',
 * )
 * ```
 */
export let planned = (space: Pick<Metered, 'slug' | 'tier'>): string => {
  let apps = ceilings(space.tier, space.slug)?.apps
  return `${space.slug} is on ${planName(space.tier)}: ${
    apps == null ? 'as many apps as it likes' : `${count(apps)} apps`
  }, ${count(letters(space.tier))} emails, ${
    count(builds(space.tier))
  } built-in builds and ${
    count(allowance('seconds', space.tier))
  } compute seconds a month.`
}

/** A ceiling a space answers to: what it has used and what it is allowed. */
export type Gauge = { used: number; limit: number }
export type Ceiling = 'apps' | 'requests' | 'bytes' | 'files' | Limited

// What the space held at the sweep's last reading (workers/yak held.ts says
// what it holds).
let reading = (m: Meter): Held => ({ bytes: m.bytes, files: m.files ?? 0 })

// Each ceiling a space answers to this month: apps, request units and app data
// where its plan limits them, and the allowances every plan carries. The
// space's dollar budget is checked through `budget`.
// What it holds is the sweep's last reading unless a caller has the space's
// apps in hand and passes what they hold now (workers/yak held.ts `holding`).
export let gauges = (
  space: Metered,
  apps: number,
  now: Date = new Date(),
  held: Held = reading(spent(space, now)),
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
  space: Metered,
  apps: number,
  now: Date = new Date(),
  held?: Held,
): Level => {
  let worst = Math.max(
    ...Object.values(gauges(space, apps, now, held)).map(full),
  )
  return worst >= 1 ? 'over' : worst >= WARN ? 'near' : 'ok'
}

// Whole counters need grouping, not locale data on the first request.
export let count = (n: number): string =>
  Number.isSafeInteger(n) && !Object.is(n, -0)
    ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : n.toLocaleString('en-US')

/** Dollars as a person reads them: cents, and two figures of a cent where a
 * month has spent less than one. */
export let dollars = (n: number): string =>
  n >= 0.01 || n <= 0
    ? `$${n.toFixed(2)}`
    : `$${n.toFixed(1 - Math.floor(Math.log10(n))).replace(/0+$/, '')}`

/** A share of the model and voice budget as a person reads it, a percent:
 * the budget's dollars are ours to allocate, never shown (T-138720). */
export let share = (n: number, of: number): string =>
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
  space: Metered,
  apps: number,
  now: Date = new Date(),
  env: Host = {},
  held?: Held,
): SpaceStanding => {
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
  space: Metered,
  apps: number,
  now: Date = new Date(),
  env: Host = {},
  held?: Held,
): string => {
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
  space: Metered,
  what: 'apps' | Spend,
  env: Host = {},
): string => {
  if (space.newcomer && what != 'apps' && budgeted(what)) return UNKEPT
  let free = ceilings(space.tier, space.slug)!
  // Comped spaces can hit the letter/build allowances, not the app ceiling.
  let said = {
    apps: () =>
      `${space.slug} is on ${
        planName(space.tier)
      }, which is ${free.apps} apps` +
      ` — delete one (app_delete) to make another`,
    // The one refusal both tiers can hit, and the one a person cannot clear
    // by deleting something: the month is what lifts it. An arrival is never
    // refused — a letter turned away at the door is somebody else's words
    // lost — so it says which half stopped.
    emails: () =>
      `${space.slug} is on ${planName(space.tier)}, which is ${
        count(letters(space.tier))
      } emails a month, and this month's are sent — it can send ` +
      `again on the 1st, and letters written to it still arrive`,
    // The month's built-in builds, used (T-1655: nothing counts them since
    // the builder was deleted).
    builds: () =>
      `${space.slug} is on ${planName(space.tier)}, which is ${
        count(builds(space.tier))
      } built-in builds a month, and this month's are used — it ` +
      `can build again on the 1st, or keep building with a connected agent`,
    // Every model call on the space stops here, the Operator's and its apps'
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
      `${space.slug} is on ${planName(space.tier)}, which is ${
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
export let UNKEPT: string =
  `This free build has used what it can before you keep ` +
  `it. Give your email in the card above this chat to keep this app and ` +
  `keep building, free`

/**
 * What the Pro plan gives beyond the Plus plan, AI use first, from the
 * numbers it holds.
 *
 * ```ts
 * import { beyond } from '@yaks/platform/standing'
 * import { equal } from '@yaks/testing'
 *
 * equal(
 *   beyond(),
 *   '$100 of AI use a month, 50 GB of app data, 250 GB of photos and ' +
 *     'files, 10,000 emails and 500 built-in builds a month',
 * )
 * ```
 */
export let beyond = (): string =>
  `$${BUDGET.pro} of AI use a month, ${size(PRO.bytes)} of app data, ` +
  `${size(PRO.files)} of photos and files, ${count(letters('pro'))} emails ` +
  `and ${count(builds('pro'))} built-in builds a month`

// Where every refusal ends: the page that describes the plans, after the plan
// above this one, which allows more of everything, and the building credit
// taking it adds: a person's first subscription's (./plans.ts `SUBSCRIBED`)
// and the Pro plan's (`PRO_GRANT`).
export let plans = (space: Metered, env: Host): string =>
  `${
    space.tier == 'pro'
      ? `Manage usage and plan settings`
      : paid(space.tier)
      ? `Putting ${space.slug} on the Pro plan allows more: ${beyond()}, ` +
        `and adds $${PRO_GRANT} of building credit once. Manage usage and ` +
        `plan settings`
      : `Putting ${space.slug} on the Plus plan allows more, the Pro plan ` +
        `more again. Your first subscription adds $${SUBSCRIBED} of ` +
        `building credit, and the Pro plan $${PRO_GRANT} more once. Compare ` +
        `paid plans in its settings`
  }: ${planSettings(space.slug, env)}`

/** What one app holds, as a person reads it, leaving out what it holds none
 * of: `holds 2 MB of app data and 880 MB of photos and files`, or nothing. */
export let heldAloud = (h: Held): string => {
  let what = [
    h.bytes ? `${size(h.bytes)} of app data` : '',
    h.files ? `${size(h.files)} of photos and files` : '',
  ].filter(Boolean)
  return what.length ? `holds ${what.join(' and ')}` : ''
}

/** Each app's share of one stored ceiling, largest first, leaving out the
 * apps that hold none of it: `openai-math 900 MB, robolab 120 MB`. */
export let shares = (held: Holding, what: keyof Held): string =>
  [...held.apps].filter(([, h]) => h[what] > 0)
    .sort(([, a], [, b]) => b[what] - a[what])
    .map(([id, h]) => `${held.names?.get(id) ?? id} ${size(h[what])}`)
    .join(', ')

/** A line for each stored ceiling the space is near or at, saying each app's
 * share of it, so the agent can choose what to delete before a write is
 * refused: `Photos and files by app: openai-math 900 MB, robolab 120 MB`. */
export let divided = (
  space: Metered,
  apps: number,
  held: Holding,
  now: Date = new Date(),
): string[] => {
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
  space: Metered,
  what: 'bytes' | 'files',
  held: Holding,
  env: Host = {},
): string => {
  let tier = space.tier ?? 'free'
  let limit = what == 'files' ? FILES[tier] : ceilings(space.tier)!.bytes
  let each = shares(held, what)
  return `${space.slug} is on ${planName(space.tier)}, which is ${
    size(limit)
  } of ${NAME[what]}, and holds ${size(held[what])}${
    each ? ` (${each})` : ''
  } — ${
    what == 'files'
      ? 'delete files it no longer needs to upload more'
      : 'delete what it no longer needs to save more'
  }. ${plans(space, env)}`
}

/** The refusal at a person's allowance (`allowed`, {@link SPACES} unless
 * theirs was raised): the free spaces they own, and what makes room. Sharing
 * is never what stops them, so it says so. */
export let tooManySpaces = (
  held: Metered[],
  env: Host = {},
  allowed: number = SPACES,
): string => {
  let gets = allowed == 1 ? 'one free space' : `${allowed} free spaces`
  let extra = held.length - allowed + 1
  return `${
    allowed == SPACES ? 'one person gets' : 'you get'
  } ${gets}, and you own ${count(held.length)} ` +
    `(${held.map((s) => s.slug).join(', ')}) — put ${
      extra == 1 ? 'one' : extra
    } on the Plus plan or delete ${
      extra == 1 ? 'one' : 'them'
    } (space_delete) to make another. A space on a paid plan does not ` +
    `count, and neither does a space somebody else invited you into. ` +
    `Compare paid plans in its settings: ${planSettings(held[0].slug, env)}`
}
