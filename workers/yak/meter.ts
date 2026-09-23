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
import * as dirPart from './directory.ts'
import {
  COMPED,
  type Directory,
  directory,
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

/** The hourly reading: `fired` on this tagged wake runs the existing meter. */
export let meterPlugin: Plugin = {
  name: 'yak/meter',
  wakes: [{
    entity: { eid: 'yak-meter' },
    wake: { every: '@hourly', note: 'Read yaks.app usage for this month' },
    sweep: { kind: 'meter' },
  }],
  rules: [{
    name: 'meter',
    phase: 'effect',
    match: '.wake, *fired, .sweep, sweep.kind=meter, #Env, #Now',
    run: async ({ Env: env, Now }) => {
      // Every store composes the rules; only the directory gets the bindings
      // that authorize a platform job, even if an app declares the same tags.
      if (!env) return
      return await reporting(env as unknown as Env, 'meter', async () => {
        let { metered } = await import('./usage.ts')
        await metered(env as unknown as Env, new Date(Now.at))
      })
    },
  }],
}

// What one store did, as the analytics answer them (usage.ts `read`). Bytes
// come from the store itself, and the month and the letters from the row being
// written (directory.ts `Meter` is the whole component).
export type Counts = {
  requests: number
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

export let none = (): Counts => ({ requests: 0, rows_read: 0, rows_written: 0 })

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

// What the builder's model may read and write in a month, input and output
// summed as `meter.tokens` is. A build is up to a dozen rounds over a prompt
// of several thousand tokens, so the free five builds fit in a million with
// room for the conversations that ship nothing; the Plus plan's hundred builds
// are held to ten million, which on Workers AI is a few dollars of the nine.
export let TOKENS: Record<Tier, number> = { free: 1_000_000, plus: 10_000_000 }

// Seconds of sandbox container a month (sandbox.ts). An hour free is six
// builds' whole budget (sandbox.ts `BUDGET`); ten hours on the Plus plan is
// about $1.30 of standard-2 time at Cloudflare's rates (wrangler.toml).
export let SECONDS: Record<Tier, number> = { free: 3_600, plus: 36_000 }

// What a tier costs a month, in whole dollars (D-32751). The number is
// tax-inclusive: $9 is what a customer pays anywhere, so this is the whole
// price rather than a subtotal something is added to. Stripe holds the same
// number as a price id (wrangler.toml STRIPE_PRICE) and that is what a card is
// charged against; this is the number the site says out loud — the pricing
// copy, and the `Offer`s in the home page's JSON-LD, which is what a search
// engine shows beside the result. A price change also updates the static HTML
// in public/index.html and public/pricing.html, billing_workerd_test.ts, and
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
// So a free allowance is a person's, not a space's. A person owns at most
// {@link SPACES} free spaces, and the spaces somebody else made and invited
// them into are not theirs to count. What they spend is counted where it
// always was, on each space's meter, and the account's month is those meters
// summed over the free spaces they own ({@link pooled}) rather than a second
// counter beside them: one place a letter is written down, and a space that
// moves to the Plus plan takes its reading with it. A Plus space answers to
// its own allowance alone, since it is paid for on its own.

/** The free spaces one person may own. */
export let SPACES = 5

/** The monthly allowances a spend is refused at, before it is spent. */
export type Spend = 'emails' | 'builds' | 'tokens' | 'seconds'

let ALLOWANCE: Record<Spend, Record<Tier, number>> = {
  emails: LETTERS,
  builds: BUILDS,
  tokens: TOKENS,
  seconds: SECONDS,
}
let SPENDS = Object.keys(ALLOWANCE) as Spend[]

export let allowance = (what: Spend, tier: Tier | null) =>
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
    for (let what of SPENDS) {
      let sum = theirs.reduce((n, s) => n + spent(s, now)[what], 0)
      most[what] = Math.max(most[what], sum)
    }
  }
  return most
}

/** Whether a reading is at an allowance; `more` is what the caller holds
 * that is not counted yet — the tokens and seconds of a build still going. */
export let over = (space: Space, m: Meter, what: Spend, more = 0) =>
  m[what] + more >= allowance(what, space.tier)

/** What stops this spend here, or null to go ahead. */
export let refusedSpend = async (
  dir: Owned,
  space: Space,
  what: Spend,
  env: Host = {},
  more = 0,
  now = new Date(),
) =>
  over(space, await pooled(dir, space, now), what, more)
    ? atCeiling(space, what, env)
    : null

// What one build's model calls cost, as the builder's loop reports them
// (T-34239 `build()` returns it). Input and output are summed into
// `meter.tokens`, because the meter is read for cost and the two prices differ
// per model — a split here would be a number nobody could add up.
export type Usage = { input: number; output: number }

let empty = (month: string, built = 0): Meter => ({
  month,
  ...none(),
  bytes: 0,
  emails: 0,
  builds: 0,
  tokens: 0,
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
  if (!limit || spent(space, now).requests < limit.requests) return null
  let reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return new Response(
    req.method == 'HEAD'
      ? null
      : `This space has reached its ${count(limit.requests)} monthly visits. ` +
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

// How full a space is, per ceiling, as a fraction: 1 is at it. The letters and
// the builds are there on every plan; the other three only where the plan has
// them.
export let fullness = (space: Space, apps: number, now = new Date()) => {
  let free = ceilings(space.tier, space.slug)
  let m = spent(space, now)
  let both = {
    files: (m.files ?? 0) / FILES[space.tier ?? 'free'],
    ...Object.fromEntries(
      SPENDS.map((what) => [what, m[what] / allowance(what, space.tier)]),
    ),
  }
  return free
    ? {
      ...(free.apps == null ? {} : { apps: apps / free.apps }),
      requests: m.requests / free.requests,
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
  // The tokens and the sandbox time the builder spent: the one place a person
  // sees what a build costs us, each against its own monthly allowance.
  let cost = `${count(m.tokens)} of ${
    count(allowance('tokens', space.tier))
  } tokens and ${count(m.seconds)} of ${
    count(allowance('seconds', space.tier))
  } sandbox seconds this month`
  let files = `${size(m.files ?? 0)} of ${
    size(FILES[space.tier ?? 'free'])
  } photos and files (hourly reading)`
  if (!free) {
    return `${space.slug}: no ceilings on this plan beyond ${mail} and ` +
      `${made} (${cost}), and ${files}.`
  }
  let refused =
    `App serving pauses at ${count(free.requests)} monthly visits ` +
    `(HTTP 429 to everyone but the space's own people signed in, checked ` +
    `hourly; resets on the 1st UTC); ${
      free.apps == null ? '' : `an app past ${free.apps}, `
    }a build past ${count(builds(space.tier))}, data past ${
      size(free.bytes)
    }, files past ${size(free.files)}, or the ${
      count(letters(space.tier) + 1)
    }st letter SENT is — a letter that ` +
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
    return `${head}, ${files}, ${mail}, ${made} (${cost}). The month's requests and ` +
      `data have not been read yet — the meter sweeps hourly. ${refused}`
  }
  return `${head}, ${count(m.requests)} of ${count(free.requests)} requests, ` +
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
    tokens: () =>
      `${space.slug} is on the ${tier} tier, which is ${
        count(allowance('tokens', space.tier))
      } builder tokens a month${shared}, and this month's are spent — the ` +
      `builder answers again on the 1st, or keep building with a connected ` +
      `agent`,
    seconds: () =>
      `${space.slug} is on the ${tier} tier, which is ${
        count(allowance('seconds', space.tier))
      } seconds of sandbox time a month${shared}, and this month's are ` +
      `spent — the sandbox wakes again on the 1st, and an app of html, css ` +
      `and js needs none`,
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
// The month turning is a fresh row here as it is in the sweep: the counters
// that are the analytics' to answer wait for the next reading rather than
// carrying last month's numbers under this month's name.

/** One letter, on the space's month: the count, one higher. */
export let counted = async (
  env: { STORE: Namespace },
  space: Space,
  now = new Date(),
) => {
  let month = monthOf(now)
  let held = thisMonth(space.meter, month)
  await stamp(env, {
    entities: [{
      entity: { eid: space.eid },
      meter: held
        ? { month, emails: held.emails + 1 }
        : { ...empty(month), emails: 1 },
    }],
  })
}

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
 * One completed build and what it cost: the month's builds, tokens and
 * container seconds, and the space's lifetime builds, each one higher.
 *
 * This is the call the builder's loop makes with the `usage` its `build()`
 * returns (T-34239) and the seconds its workbench held (sandbox.ts
 * `released`). A build that was refused never reaches it, so a refusal costs
 * a person nothing — not a build, and not the tokens of the sentence that
 * turned it down.
 *
 * The seconds ride here rather than in a second call because both figures are
 * derived from one reading of the space: on a month with no row yet each
 * write starts from `empty()`, and the second would put the first one's
 * properties back at zero.
 */
export let countedBuild = async (
  env: { STORE: Namespace },
  space: Space,
  usage: Usage,
  seconds = 0,
  now = new Date(),
) => {
  let month = monthOf(now)
  let held = thisMonth(space.meter, month)
  let tokens = usage.input + usage.output
  let built = (space.meter?.built ?? 0) + 1
  await stamp(env, {
    entities: [{
      entity: { eid: space.eid },
      meter: held
        ? {
          month,
          builds: held.builds + 1,
          tokens: held.tokens + tokens,
          seconds: held.seconds + seconds,
          built,
        }
        : { ...empty(month), builds: 1, tokens, seconds, built },
    }],
  })
}

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
 * The tokens and container seconds spent, on the space's month, with no build
 * beside them.
 *
 * The door for a conversation that shipped nothing (builder.ts `end`) — its
 * model calls cost the same whether or not they ended in a deploy — and for a
 * lone sandbox tool call somebody's own agent made over the connector
 * (tools.ts `bench`). Where a build is being counted both go with it
 * ({@link countedBuild}), so that one reading of the space makes one write.
 */
export let countedSpend = async (
  env: { STORE: Namespace },
  space: Space,
  tokens: number,
  seconds: number,
  now = new Date(),
) => {
  if (tokens <= 0 && seconds <= 0) return
  let month = monthOf(now)
  let held = thisMonth(space.meter, month)
  await stamp(env, {
    entities: [{
      entity: { eid: space.eid },
      meter: held
        ? {
          month,
          tokens: held.tokens + tokens,
          seconds: held.seconds + seconds,
        }
        : { ...empty(month, space.meter?.built ?? 0), tokens, seconds },
    }],
  })
}

// The directory as a Store object reads it: the same client the kernel's own
// callers hold, over the meta store directly, since a Durable Object is handed
// the namespace and no service binding. Memoized per namespace so the meta
// space is seeded once per isolate rather than once per letter, and read
// fresh — two letters a second apart must not both see the same count.
let dirs = new WeakMap<Namespace, Directory>()
let reaching = (ns: Namespace) => {
  let held = dirs.get(ns)
  if (!held) {
    dirs.set(
      ns,
      held = directory(
        { fetch: (req) => dirPart.fetch(req, { STORE: ns }) },
        true,
      ),
    )
  }
  return held
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
    let dir = reaching(ns)
    let space = await dir.space(box.space)
    if (!space) return await sender.send(m)
    let no = await refusedSpend(dir, space, 'emails', bind)
    if (no) throw refuse('limit', no)
    let receipt = await sender.send(m)
    await counted({ STORE: ns }, space)
    return receipt
  },
})
