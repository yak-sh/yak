// What a space is allowed, and the letters it spends (T-32758, T-33688): the
// numbers the free and paid plans are sold on (public/pricing.html), the line
// the agent reads before it runs into one, and the sentence every door says no
// with. usage.ts is the other half — the hourly sweep that reads three of these
// figures off Cloudflare's analytics. Its wake and effect rule live here
// beside the meter's other contributions to the host.
//
// They are two files because the LETTERS are counted where they happen rather
// than swept, and one of those two doors is inside the Store Durable Object
// itself (`metering` below, wired in graph.ts). That object is checked against
// the runtime's own types with nothing of Deno in its graph (conform.ts), so
// the sweep is loaded only when its directory wake fires, after the plugin
// list has been composed.
import type { Host } from './host.ts'
import { planSettings } from './route.ts'
import type { Sender } from '@yaks/mail'
import {
  COMPED,
  type Directory,
  directoryOf,
  type Meter,
  type Space,
  stamp,
  type Tier,
} from './directory.ts'
import type { Namespace } from './door.ts'
import type { Env } from './env.ts'
import type { Plugin } from './plugin.ts'
import { mailedTo } from './post.ts'
import { reporting } from './wake.ts'
import { refuse } from './tool.ts'
import { ModelError, weigh } from '@yaks/model'
import { LIMIT } from '@yaks/session/status'
import { type Binding, failure, usageOf } from '@yaks/workers-ai'
import { CATALOGUE, guess, priceOf } from './models.ts'
import { defect } from './sentry.ts'

/** The hourly reading: `fired` on this tagged wake runs the existing meter. */
export let meterPlugin: Plugin = {
  name: 'yak/meter',
  vocab: [{
    $defs: {
      account_usage: {
        component: true,
        wire: false,
        type: 'object',
        properties: {
          month: { type: 'string' },
          at: { type: 'string', format: 'date-time' },
          requests: { type: 'number' },
          rows_read: { type: 'number' },
          duration: { type: 'number' },
        },
      },
      account_alert: {
        component: true,
        wire: false,
        type: 'object',
        properties: {
          month: { type: 'string' },
          requests: { type: 'string' },
          rows_read: { type: 'string' },
          duration: { type: 'string' },
          rate: { type: 'string' },
        },
      },
    },
  }],
  wakes: [{
    entity: { eid: 'yak-meter' },
    wake: { every: '@hourly', note: 'Read yaks.app usage for this month' },
    sweep: { kind: 'meter' },
  }],
  rules: [{
    name: 'meter',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=meter, #Env, #Now',
    run: async (row) => {
      let { Env: env, Now } = row
      // Every store composes the rules; only the directory gets the bindings
      // that authorize a platform job, even if an app declares the same tags.
      if (!env) return
      return await reporting(env as unknown as Env, row, async () => {
        let { metered } = await import('./usage.ts')
        await metered(env as unknown as Env, new Date(Now.at))
      })
    },
  }, {
    // A spend, added to the month's meter inside the write's own transaction
    // and taken off again (vocab.ts `spend`): the sum is the directory's, never
    // a caller's, so two spends at once both count.
    name: 'spend',
    phase: 'rules',
    match: '+meter, *spend',
    run: ({ meter, spend }) => ({
      meter: added(props(meter), props(spend)),
      spend: null,
    }),
  }],
}

// A component as the rule is handed it, read as its properties.
let props = (c: unknown): Record<string, unknown> =>
  c && typeof c == 'object' ? Object.fromEntries(Object.entries(c)) : {}

// What one store did, as the analytics answer them (usage.ts `read`). Bytes
// come from the store itself, and the month and the letters from the row being
// written (directory.ts `Meter` is the whole component).
export type Counts = {
  requests: number
  ws_messages: number
  ws_hibernated: number
  rows_read: number
  rows_written: number
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
// At the monthly request ceiling, apps.ts refuses serving with 429 (T-37150).
// This is a soft quota: the hourly analytics reading can lag live traffic.

let GB = 1024 ** 3

// The free tier, as decided (D-32751): what a space gets for nothing.
export let FREE = { apps: 5, requests: 50_000, bytes: GB, files: GB }
export let PLUS = {
  apps: null,
  requests: 1_000_000,
  bytes: 10 * GB,
  files: 50 * GB,
}

// Photos and files, including on comped spaces (only apps/data are exempt).
// Free: proposed 1 GB allowance (T-37149), pending owner feedback.
export let FILES: Record<Tier, number> = { free: FREE.files, plus: PLUS.files }

// Where the warning line sits, as a fraction of a ceiling.
export let WARN = 0.8

// Comped spaces retain their app/data/visit exemption independently of Plus.
export let ceilings = (tier: Tier | null, slug = '') =>
  COMPED.includes(slug) ? null : tier == 'plus' ? PLUS : FREE

// The letters, both directions, a space may spend in a month — the one
// allowance both tiers carry, because a letter costs money to carry however
// the plan is paid for, and the pricing page sells a number on each
// (public/pricing.html). Counted at the two mail doors as they happen:
// `metering` below for a letter that left, inbox.ts for one that arrived.
export let LETTERS: Record<Tier, number> = { free: 100, plus: 2_500 }

export let letters = (tier: Tier | null): number => LETTERS[tier ?? 'free']

// Monthly allowances for the optional built-in builder. Making and changing
// apps through a connected agent (app_new, app_files) is not metered here.
export let BUILDS: Record<Tier, number> = { free: 5, plus: 100 }

export let builds = (tier: Tier | null): number => BUILDS[tier ?? 'free']

// One monthly dollar budget belongs to an account. Each Plus subscription
// contributes the $3 its space was previously allowed, on top of the free
// $0.20. Space meters still say where the dollars went.
export let BUDGET: Record<Tier, number> = { free: 0.2, plus: 3 }

// Build seconds a month: the sandbox container's (sandbox.ts) and the compile
// at app_deploy's (esbuild.ts). An hour free is six builds' whole sandbox
// budget (sandbox.ts `BUDGET`); ten hours on the Plus plan is about $1.30 of
// standard-2 time at Cloudflare's rates (wrangler.toml). A compile's second
// costs less than a container's, so the one allowance bounds both.
export let SECONDS: Record<Tier, number> = { free: 3_600, plus: 36_000 }

// What a tier costs a month, in whole dollars (D-32751). The number is
// tax-inclusive: $9 is what a customer pays anywhere, so this is the whole
// price rather than a subtotal something is added to. Stripe holds the same
// number as a price id (wrangler.toml STRIPE_PRICE) and that is what a card is
// charged against; this is the number the site says out loud — the pricing
// copy, and the `Offer`s in the home page's JSON-LD, which is what a search
// engine shows beside the result. A price change also updates the static HTML
// in public/index.html and public/pricing.html, billing_kernel_test.ts, and
// bin/verify-deploy{,_test}.ts. site_test.ts holds the pages to this number.
export let PRICE: Record<Tier, number> = { free: 0, plus: 9 }

export let CURRENCY = 'USD'

// ---- the account (T-37882) --------------------------------------------------
//
// Jeff, 2026-09-22 (C-37911): "oh yes, those should be per-account. and maybe
// limit to 5 (same as apps) on free account. i want to prompt folks to
// upgrade, but also the reason for more spaces is to *share*, so that should
// be encouraged! and yeah, limit anything currently uncapped"
//
// A person owns at most {@link SPACES} free spaces. Their letter, build and
// second allowances pool over those free spaces; a Plus space has its own.
// Dollar costs pool across all spaces the person owns, including Plus spaces.
// Every spend stays on its source space's meter, so changing a plan or moving
// through a month never requires moving a balance between rows.

/** The free spaces one person may own. */
export let SPACES = 5

/** The monthly usage counters. Models and realtime spend the same account
 * budget; their separate counters still say what each source cost. */
export type Spend = 'emails' | 'builds' | 'models' | 'realtime' | 'seconds'
export type Limited = Exclude<Spend, 'models' | 'realtime'>
export type Budget = { spent: number; limit: number }

let ALLOWANCE: Record<Limited, Record<Tier, number>> = {
  emails: LETTERS,
  builds: BUILDS,
  seconds: SECONDS,
}
let SPENDS: Spend[] = ['emails', 'builds', 'models', 'realtime', 'seconds']
let LIMITED = Object.keys(ALLOWANCE) as Limited[]

/** What a reading has spent: model and voice dollars together. */
let used = (m: Meter, what: Spend) =>
  what == 'models' || what == 'realtime' ? m.models + m.realtime : m[what]

export let allowance = (what: Limited, tier: Tier | null) =>
  ALLOWANCE[what][tier ?? 'free']

/** A space its owners' free allowance covers: not on the Plus plan, and not
 * comped (directory.ts `tierOf` reads a comp as the Plus plan). */
export let free = (space: Space) => space.tier != 'plus'

/** The directory, as far as the account reads it. */
export type Owned = Pick<Directory, 'owners' | 'spaces'>

/**
 * What a space answers to this month: its own reading on the Plus plan, and
 * on the free tier each figure summed over the free spaces of whichever owner
 * of it has spent the most. A space almost always has one owner; one with
 * several stops when any of them is out, since each of them is paying for it
 * out of their own allowance.
 */
export let pooled = async (
  dir: Owned,
  space: Space,
  now = new Date(),
): Promise<Meter> => {
  let most = { ...spent(space, now) }
  if (!free(space)) return most
  for (let person of await dir.owners(space)) {
    let theirs = (await dir.spaces(person, 'owner')).filter(free)
    for (let what of LIMITED) {
      let sum = theirs.reduce((n, s) => n + spent(s, now)[what], 0)
      most[what] = Math.max(most[what], sum)
    }
  }
  return most
}

/** Whether a reading is at an allowance; `more` is what the caller holds
 * that is not counted yet — the dollars and seconds of a build still going. */
export let over = (space: Space, m: Meter, what: Limited, more = 0) =>
  used(m, what) + more >= allowance(what, space.tier)

/** Each owner pays from one budget across every space they own. A shared
 * space must fit every owner's budget, as its free allowances already do. */
export let budgets = async (
  dir: Owned,
  space: Space,
  now = new Date(),
): Promise<Budget[]> => {
  let owners = await dir.owners(space)
  if (!owners.length) {
    return [{
      spent: used(spent(space, now), 'models'),
      limit: BUDGET[space.tier ?? 'free'],
    }]
  }
  return await Promise.all(owners.map(async (person) => {
    let spaces = [
      space,
      ...(await dir.spaces(person, 'owner')).filter((s) => s.eid != space.eid),
    ]
    let paid = spaces.filter((s) => s.tier == 'plus').length
    return {
      spent: spaces.reduce((n, s) => n + used(spent(s, now), 'models'), 0),
      limit: BUDGET.free + paid * BUDGET.plus,
    }
  }))
}

/** What stops this spend here, or null to go ahead. */
export let refusedSpend = async (
  dir: Owned,
  space: Space,
  what: Spend,
  env: Host = {},
  more = 0,
  now = new Date(),
) => {
  if (what == 'models' || what == 'realtime') {
    let full = (await budgets(dir, space, now)).find((b) =>
      b.spent + more >= b.limit
    )
    return full ? atCeiling(space, what, env, full.limit) : null
  }
  return over(space, await pooled(dir, space, now), what, more)
    ? atCeiling(space, what, env)
    : null
}

let empty = (month: string, built = 0): Meter => ({
  month,
  ...none(),
  bytes: 0,
  emails: 0,
  builds: 0,
  models: 0,
  realtime: 0,
  seconds: 0,
  built,
  at: '',
})

// This month's reading, whatever the row holds — a month behind is nothing
// spent, and no row at all is the same. `built` is the exception it carries
// through: a lifetime figure is not started over by a new month.
export let spent = (space: Space, now = new Date()) =>
  thisMonth(space.meter, monthOf(now)) ??
    {
      ...empty(monthOf(now), space.meter?.built ?? 0),
      files: space.meter?.files ?? 0,
    }

/**
 * A meter with a spend added, as the patch that writes it: onto what it holds
 * when it holds the spend's month, and onto a fresh month when it holds
 * another. `built` counts every build ever, so a new month carries it.
 *
 * ```ts
 * import { added } from './meter.ts'
 *
 * let sep = { month: '2026-09', models: 0.5, built: 3 }
 * added(sep, { month: '2026-09', models: 0.25 })
 * // { month: '2026-09', models: 0.75 }
 * added(sep, { month: '2026-10', builds: 1 }).built // 4
 * added(sep, { month: '2026-10', builds: 1 }).models // 0
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
  return out
}

/** The serving quota uses the existing hourly reading, not a per-hit write.
 * Keep refusing an over-limit reading until the UTC month turns or the plan
 * changes; an absent reading permits serving. Management stays outside this
 * gate, so an owner can still change plans or work on their apps. */
export let refusedVisit = (
  space: Space,
  req: Request,
  env: Host = {},
  now = new Date(),
): Response | null => {
  let limit = ceilings(space.tier, space.slug)
  if (!limit || requestUnits(spent(space, now)) < limit.requests) return null
  let reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return new Response(
    req.method == 'HEAD'
      ? null
      : `This space has reached its ${
        count(limit.requests)
      } monthly request units. ` +
        `Its apps will be available again on the 1st (UTC). ` +
        `Its own people, signed in, can still use them and manage the ` +
        `space. Plan settings: ${planSettings(space.slug, env)}`,
    {
      status: 429,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'retry-after': reset.toUTCString(),
      },
    },
  )
}

// Both plans count completed builds in the current calendar month.
export let usedBuilds = (space: Space, now = new Date()) =>
  spent(space, now).builds

// How full a space is, per space ceiling, as a fraction: 1 is at it. The
// account's dollar budget is checked through `budgets`, not a space's reading.
export let fullness = (space: Space, apps: number, now = new Date()) => {
  let free = ceilings(space.tier, space.slug)
  let m = spent(space, now)
  let both = {
    files: (m.files ?? 0) / FILES[space.tier ?? 'free'],
    ...Object.fromEntries(
      LIMITED.map((
        what,
      ) => [what, used(m, what) / allowance(what, space.tier)]),
    ),
  }
  return free
    ? {
      ...(free.apps == null ? {} : { apps: apps / free.apps }),
      requests: requestUnits(m) / free.requests,
      bytes: m.bytes / free.bytes,
      ...both,
    }
    : both
}

// Where a space stands: nothing to say, near a ceiling, or past one. The
// sweep watches this for a change, which is what un-tells the agent.
export let level = (space: Space, apps: number, now = new Date()) => {
  let worst = Math.max(...Object.values(fullness(space, apps, now)))
  return worst >= 1 ? 'over' : worst >= WARN ? 'near' : 'ok'
}

let count = (n: number) => n.toLocaleString('en-US')

/** Dollars as a person reads them: cents, and two figures of a cent where a
 * month has spent less than one. */
export let dollars = (n: number) =>
  n >= 0.01 || n <= 0
    ? `$${n.toFixed(2)}`
    : `$${n.toFixed(1 - Math.floor(Math.log10(n))).replace(/0+$/, '')}`

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

// The line the agent reads: every number against its ceiling, and what
// happens at each. One line, because the agent has work to get back to.
export let standing = (
  space: Space,
  apps: number,
  now = new Date(),
  env: Host = {},
) => {
  let free = ceilings(space.tier, space.slug)
  let m = spent(space, now)
  let mail = `${count(m.emails)} of ${count(letters(space.tier))} emails`
  let made = `${count(usedBuilds(space, now))} of ${
    count(builds(space.tier))
  } builds a month`
  // Space meters attribute model and voice cost; the budget is shared by the
  // owner's accounts across spaces, so no space may state its own ceiling.
  let voice = m.realtime ? ` (${dollars(m.realtime)} of it voice)` : ''
  let cost =
    `${dollars(used(m, 'models'))} of model use and voice here${voice}, ` +
    `from the owner's account budget, and ${count(m.seconds)} of ${
      count(allowance('seconds', space.tier))
    } build seconds this month`
  let files = `${size(m.files ?? 0)} of ${
    size(FILES[space.tier ?? 'free'])
  } photos and files (hourly reading)`
  if (!free) {
    return `${space.slug}: no ceilings on this plan beyond ${mail} and ` +
      `${made} (${cost}), and ${files}.`
  }
  let refused =
    `App serving pauses at ${count(free.requests)} monthly request units ` +
    `(HTTP 429 to everyone but the space's own people signed in, checked ` +
    `hourly; resets on the 1st UTC); ${
      free.apps == null ? '' : `an app past ${free.apps}, `
    }a build past ${count(builds(space.tier))}, data past ${
      size(free.bytes)
    }, files past ${size(free.files)}, the account budget spent, or the ${
      count(letters(space.tier) + 1)
    }st letter sent is refused — a letter that ` +
    `arrives always lands. Plan settings: ${planSettings(space.slug, env)}`
  let head = `${space.slug} (${
    space.tier ?? 'free'
  } tier, ${m.month}): ${apps}${
    free.apps == null ? ' apps (unlimited)' : ` of ${free.apps} apps`
  }`
  let read = asOf(m.at)
  // The apps, the letters and the builds are counted here and now; the rest
  // waits on the sweep. Before the first one this month there is no reading at
  // all, and zero would be a claim rather than a number.
  if (!read) {
    return `${head}, ${files}, ${mail}, ${made} (${cost}). The month's request units and ` +
      `data have not been read yet — the meter sweeps hourly. ${refused}`
  }
  return `${head}, ${count(requestUnits(m))} of ${count(free.requests)} ` +
    `estimated request units (incoming WebSocket messages at 20:1), ` +
    `${size(m.bytes)} of ${
      size(free.bytes)
    } app data, ${files}, ${mail}${read}, ${made} ` +
    `(${cost}). ${refused}`
}

// The refusal, one sentence: what the ceiling is, and where the plans are
// written down. Every door that says no says it this way.
//
// It names account plan settings, never a checkout link. This is a policy
// line rather than a preference (C-33033 on D-32751): an agent surface may
// explain that a feature needs a plan and may link to a page describing the
// plans; it may not hand back anything that starts a purchase. Paying is the
// signed-in web page's door (billing.ts).
export let atCeiling = (
  space: Space,
  what: 'apps' | 'bytes' | 'files' | Spend,
  env: Host = {},
  budget = BUDGET[space.tier ?? 'free'],
) => {
  let free = ceilings(space.tier, space.slug)!
  let tier = space.tier ?? 'free'
  // A free allowance is the account's ({@link pooled}), so it is said as the
  // owner's: the space in hand may have spent none of it.
  let shared = tier == 'free' ? ', shared by the free spaces its owner has' : ''
  // Comped spaces can hit the letter/build allowances, not app/data ceilings.
  let said = {
    apps: () =>
      `${space.slug} is on the ${tier} tier, which is ${free.apps} apps` +
      ` — delete one (app_delete) to make another`,
    bytes: () =>
      `${space.slug} is on the ${tier} tier, which is ${
        size(free.bytes)
      } of app data — delete what it no longer needs to save more`,
    files: () =>
      `${space.slug} is on the ${tier} tier, which is ${size(FILES[tier])}` +
      ` of photos and files — delete files it no longer needs to upload more`,
    // The one refusal both tiers can hit, and the one a person cannot clear
    // by deleting something: the month is what lifts it. An arrival is never
    // refused — a letter turned away at the door is somebody else's words
    // lost — so it says which half stopped.
    emails: () =>
      `${space.slug} is on the ${tier} tier, which is ${
        count(letters(space.tier))
      } emails a month${shared}, and this month's are sent — it can send ` +
      `again on the 1st, and letters written to it still arrive`,
    // The builder's refusal, which it says in the chat rather than bouncing
    // (T-34242 renders it): a person asked for an app in words, and a person
    // asked in words is owed an answer in words. What it leaves them is the
    // app they already have and the tools to change it themselves.
    builds: () =>
      `${space.slug} is on the ${tier} tier, which is ${
        count(builds(space.tier))
      } built-in builds a month${shared}, and this month's are used — it ` +
      `can build again on the 1st, or keep building with a connected agent`,
    // Every model call on the space stops here, the builder's and its apps'
    // alike, so it names neither: models answer again on the 1st. Voice
    // spends the same dollars, so each sentence says both.
    models: () =>
      `the account budget of ${dollars(budget)} for models and voice ` +
      `this month is spent — ` +
      `models answer again on the 1st, and a connected agent can keep ` +
      `building`,
    realtime: () =>
      `the account budget of ${dollars(budget)} for models and voice ` +
      `this month is spent — ` +
      `voices go quiet until the 1st`,
    seconds: () =>
      `${space.slug} is on the ${tier} tier, which is ${
        count(allowance('seconds', space.tier))
      } build seconds a month${shared} (the sandbox, and compiling ` +
      `TypeScript and npm packages at app_deploy), and this month's are ` +
      `spent — they come back on the 1st, and an app of html, css and js ` +
      `needs none`,
  }[what]()
  return `${said}. ${
    tier == 'plus'
      ? `Manage usage and plan settings`
      : `The Plus plan allows more. Compare paid plans in settings`
  }: ${planSettings(space.slug, env)}`
}

/** The refusal at {@link SPACES}: the free spaces a person owns, and what
 * frees one. Sharing is never what stops them, so it says so. */
export let tooManySpaces = (held: Space[], env: Host = {}) =>
  `you own ${held.length} free spaces, which is what one person gets for ` +
  `nothing — delete one (space_delete) to make another. A space on the Plus ` +
  `plan does not count toward them, and neither does a space somebody else ` +
  `invited you into. The Plus plan allows more. Compare paid plans in ` +
  `settings: ${planSettings(held[0].slug, env)}`

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
  bind: { STORE?: Namespace } & Host,
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
    let no = await refusedSpend(dir, space, 'emails', bind)
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
// the catalogue (models.ts), so the call that crosses the line still
// completes: a soft ceiling, like the others.

/**
 * The AI binding an app reaches Workers AI through, and the only one: the
 * store's runner is lent it (models.ts), and so is `./api/ai/run`. A model the
 * catalogue does not offer is refused before anything is spent, and so is a
 * call that could not be counted — no namespace to count it in, no space to
 * count it against — since nothing reaches the account's AI unmetered.
 *
 * Over the budget it throws a `ModelError` coded `limit` carrying the
 * ceiling's sentence, which a transcript comes to rest on (@yaks/session
 * `LIMIT`) and the direct door answers 429 with. The account's own credits
 * spent are a ceiling too (@yaks/workers-ai `failure`), refused the same way,
 * and reported: the account met no budget of its own, and only the platform
 * can buy more.
 */
export let metered = (
  bind: { AI?: Binding; STORE?: Namespace } & Host,
  spaceOf: (dir: Directory) => Promise<Space | null>,
): Binding => ({
  run: async (model, input, options) => {
    let price = priceOf(model)
    if (!price?.offered) {
      throw new ModelError(
        'model',
        `${model} is not a model an app here can ask — it can ask ` +
          CATALOGUE.filter((r) => r.offered).map((r) => r.name).join(', '),
      )
    }
    let ns = bind.STORE
    let dir = ns ? directoryOf(ns) : null
    let space = dir ? await spaceOf(dir) : null
    if (!bind.AI || !ns || !dir || !space) {
      throw new ModelError(
        'unbound',
        'No model can be asked here: nothing binds this store to Workers AI ' +
          'and to the space that pays for it',
      )
    }
    let no = await refusedSpend(dir, space, 'models', bind)
    if (no) throw new ModelError(LIMIT, no)
    let answer = await bind.AI.run(model, input, options).catch((e) => {
      let said = failure(e)
      if (said instanceof ModelError && said.code == LIMIT) {
        defect(e, { request: `model ${model}`, space: space.slug })
      }
      throw said
    })
    let n = usageOf(answer)
    let cost = weigh(price, {
      input_tokens: n.input_tokens ?? guess(input),
      output_tokens: n.output_tokens ?? guess(answer),
      cached_tokens: n.cached_tokens,
    })
    await countedSpend({ STORE: ns }, space, cost, 0)
    return answer
  },
})
