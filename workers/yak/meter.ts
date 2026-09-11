// What a space is ALLOWED, and the letters it spends (T-32758, T-33688): the
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
import { type Host, url } from './host.ts'
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
// Adoption over revenue (T-32756): a ceiling is something the person's agent
// SEES COMING and is told about, not a wall the person hits. So only what
// costs money is refused outright — a sixth app, data past the ceiling, the
// 101st letter SENT — and requests past 50,000 are served and reported. At 80%
// of any of them the agent gets one line on the unseen channel (unseen.ts
// `ceiling`), marked the way an error is, so it rides one reply.

let GB = 1024 ** 3

// The free tier, as decided (D-32751): what a space gets for nothing.
export let FREE = { apps: 5, requests: 50_000, bytes: GB }
export let PLUS = { apps: 50, requests: 1_000_000, bytes: 10 * GB }

// Published R2 allowance; enforcement is added by T-37149. Free is unmetered.
export let FILES: Record<Tier, number | null> = { free: null, plus: 50 * GB }

// Where the warning line sits, as a fraction of a ceiling.
export let WARN = 0.8

// Visits are reported, not refused. Comped spaces retain their app/data
// exemption independently of the paid Plus allowance.
export let ceilings = (tier: Tier | null, slug = '') =>
  COMPED.includes(slug) ? null : tier == 'plus' ? PLUS : FREE

// The letters, both directions, a space may spend in a month — the one
// allowance BOTH tiers carry, because a letter costs money to carry however
// the plan is paid for, and the pricing page sells a number on each
// (public/pricing.html). Counted at the two mail doors as they happen:
// `metering` below for a letter that left, inbox.ts for one that arrived.
export let LETTERS: Record<Tier, number> = { free: 100, plus: 2_500 }

export let letters = (tier: Tier | null): number => LETTERS[tier ?? 'free']

// Monthly allowances for the optional built-in builder. Making and changing
// apps through a connected agent (app_new, app_files) is not metered here.
export let BUILDS: Record<Tier, number> = { free: 5, plus: 100 }

export let builds = (tier: Tier | null): number => BUILDS[tier ?? 'free']

// What a tier COSTS a month, in whole dollars (D-32751). The number is
// tax-inclusive: $9 is what a customer pays anywhere, so this is the whole
// price rather than a subtotal something is added to. Stripe holds the same
// number as a price id (wrangler.toml STRIPE_PRICE) and that is what a card is
// charged against; this is the number the SITE says out loud — the pricing
// copy, and the `Offer`s in the home page's JSON-LD, which is what a search
// engine shows beside the result. A price change also updates the static HTML
// in public/index.html and public/pricing.html, billing_workerd_test.ts, and
// bin/verify-deploy{,_test}.ts. site_test.ts holds the pages to this number.
export let PRICE: Record<Tier, number> = { free: 0, plus: 9 }

export let CURRENCY = 'USD'

// What one build's model calls cost, as the builder's loop reports them
// (T-34239 `build()` returns it). Input and output are summed into
// `meter.tokens`, because the meter is read for COST and the two prices differ
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
    empty(monthOf(now), space.meter?.built ?? 0)

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
    emails: m.emails / letters(space.tier),
    builds: usedBuilds(space, now) / builds(space.tier),
  }
  return free
    ? {
      apps: apps / free.apps,
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
  // The tokens those builds spent: the one place a person sees what a build
  // costs us, and the month's, whatever span the builds are counted over.
  let cost = `${count(m.tokens)} tokens this month`
  if (!free) {
    return `${space.slug}: no ceilings on this plan beyond ${mail} and ` +
      `${made} (${cost}).`
  }
  let refused =
    `Requests are never refused; an app past ${free.apps}, a build past ${
      count(builds(space.tier))
    }, data past ${size(free.bytes)}, or the ${
      count(letters(space.tier) + 1)
    }st letter SENT is — a letter that ` +
    `arrives always lands. What the plans hold: ${url(env, '/pricing')}`
  let head =
    `${space.slug} (${
      space.tier ?? 'free'
    } tier, ${m.month}): ${apps} of ${free.apps} ` +
    'apps'
  let read = asOf(m.at)
  // The apps, the letters and the builds are counted here and now; the rest
  // waits on the sweep. Before the first one this month there is no reading at
  // all, and zero would be a claim rather than a number.
  if (!read) {
    return `${head}, ${mail}, ${made} (${cost}). The month's requests and ` +
      `data have not been read yet — the meter sweeps hourly. ${refused}`
  }
  return `${head}, ${count(m.requests)} of ${count(free.requests)} requests, ` +
    `${size(m.bytes)} of ${size(free.bytes)}, ${mail}${read}, ${made} ` +
    `(${cost}). ${refused}`
}

// The refusal, one sentence: what the ceiling is, and where the plans are
// written down. Every door that says no says it this way.
//
// It names the PRICING PAGE and never a checkout link, and that is a policy
// line rather than a preference (C-33033 on D-32751): an agent surface may
// explain that a feature needs a plan and may link to a page describing the
// plans; it may not hand back anything that starts a purchase. Paying is the
// signed-in web page's door (billing.ts).
export let atCeiling = (
  space: Space,
  what: 'apps' | 'bytes' | 'emails' | 'builds',
  env: Host = {},
) => {
  let free = ceilings(space.tier, space.slug)!
  let tier = space.tier ?? 'free'
  // Comped spaces can hit the letter/build allowances, not app/data ceilings.
  let said = {
    apps: () =>
      `${space.slug} is on the ${tier} tier, which is ${free.apps} apps` +
      ` — delete one (app_delete) to make another`,
    bytes: () =>
      `${space.slug} is on the ${tier} tier, which is ${
        size(free.bytes)
      } of app data — delete what it no longer needs to save more`,
    // The one refusal both tiers can hit, and the one a person cannot clear
    // by deleting something: the month is what lifts it. An ARRIVAL is never
    // refused — a letter turned away at the door is somebody else's words
    // lost — so it says which half stopped.
    emails: () =>
      `${space.slug} is on the ${tier} tier, which is ${
        count(letters(space.tier))
      } emails a month, and this month's are sent — it can send again on the ` +
      `1st, and letters written to it still arrive`,
    // The builder's refusal, which it SAYS in the chat rather than bouncing
    // (T-34242 renders it): a person asked for an app in words, and a person
    // asked in words is owed an answer in words. What it leaves them is the
    // app they already have and the tools to change it themselves.
    builds: () =>
      `${space.slug} has used its ${
        count(builds(space.tier))
      } built-in builds this month — it can build again on the 1st, ` +
      `or keep building with a connected agent`,
  }[what]()
  return `${said}. ${
    tier == 'plus' ? `What the plans hold` : `Plus lifts it`
  }: ${url(env, '/pricing')}`
}

// ---- the letters (T-33688) --------------------------------------------------
//
// Mail rides no store, so nothing in the analytics counts it: a letter is
// counted where it happens, one per letter DELIVERED (post.ts's binding took
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

// ---- the builds (T-34241) ---------------------------------------------------
//
// A build is counted where it happens, like a letter and for the same reason:
// nothing in the analytics knows what the builder did. One count per COMPLETED
// build — an `app_deploy` the builder performed — and never per message, so a
// long conversation that ships one app costs one build.
//
// The refusal is a SENTENCE the builder says, not a bounce: the person is
// talking to it, and a door slamming mid-conversation is not an answer. The
// builder asks before it starts and repeats what comes back.

/** What stops the builder here, or null to go ahead. */
export let refusedBuild = (space: Space, now = new Date(), env: Host = {}) =>
  usedBuilds(space, now) >= builds(space.tier)
    ? atCeiling(space, 'builds', env)
    : null

/**
 * One completed build and what it cost: the month's builds, tokens and
 * container seconds, and the space's lifetime builds, each one higher.
 *
 * This is the call the builder's loop makes with the `usage` its `build()`
 * returns (T-34239) and the seconds its workbench held (sandbox.ts
 * `released`). A build that was REFUSED never reaches it, so a refusal costs
 * a person nothing — not a build, and not the tokens of the sentence that
 * turned it down.
 *
 * The seconds ride HERE rather than in a second call because both figures are
 * derived from one reading of the space: on a month with no row yet each
 * write starts from `empty()`, and the second would put the first one's
 * columns back at zero.
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
// is ONE SECOND OF CONTAINER WALL TIME — what Cloudflare bills on — measured
// from the first sandbox call in a build to the moment the build lets the
// container go (sandbox.ts `Spend`), rounded up.
//
// There is no ceiling on the PLAN here, only the per-build budget the tools
// refuse at (sandbox.ts `BUDGET`), because the builds ceiling already bounds
// how many builds a plan gets and a build cannot spend more than its budget.
// What `meter.seconds` is for is the bill: the one place a month of container
// time is written down.

/**
 * The container seconds spent, on the space's month, on their own.
 *
 * The door for the seconds that ride BESIDE no build: a conversation that
 * compiled something and shipped nothing (builder.ts `end`), and a lone
 * sandbox tool call somebody's own agent made over the connector (tools.ts
 * `bench`). Where a build IS being counted the seconds go with it
 * ({@link countedBuild}), so that one reading of the space makes one write.
 */
export let countedSandbox = async (
  env: { STORE: Namespace },
  space: Space,
  seconds: number,
  now = new Date(),
) => {
  if (seconds <= 0) return
  let month = monthOf(now)
  let held = thisMonth(space.meter, month)
  await stamp(env, {
    entities: [{
      entity: { eid: space.eid },
      meter: held
        ? { month, seconds: held.seconds + seconds }
        : { ...empty(month, space.meter?.built ?? 0), seconds },
    }],
  })
}

// The directory as a Store object reads it: the same client the kernel's own
// callers hold, over the meta store directly, since a Durable Object is handed
// the namespace and no service binding. Memoized per namespace so the meta
// space is seeded once per isolate rather than once per letter, and read
// FRESH — two letters a second apart must not both see the same count.
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
 * ride the one seam @yaks/mail already has: over the allowance this THROWS,
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
    let space = await reaching(ns).space(box.space)
    if (!space) return await sender.send(m)
    if (spent(space).emails >= letters(space.tier)) {
      throw new Error(atCeiling(space, 'emails', bind))
    }
    let receipt = await sender.send(m)
    await counted({ STORE: ns }, space)
    return receipt
  },
})
