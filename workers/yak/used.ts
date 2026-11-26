// Use belongs to the directory, independently of platform bookkeeping. An app's
// receipt records the moment of the hour's first use and is held until the
// hour's end, so repeated visits need no durable writes. Each colo marks what
// the store took in its cache, so the receipts an app's traffic sends grow
// with the colos it reaches, not with its requests or the isolates they start
// (T-3847). The same receipt
// records each retired query spelling an app's code still sends, so a
// translation in the grammar goes only once nothing sends it (T-123000).
import type { Plugin } from '@yaks/graph'
import { parse, retired } from '@yaks/query'
import { ahead, storeOf, WAKE, WARM } from './door.ts'
import { type Namespace } from '@yaks/durable-object/door'
import { jittered, overloaded } from '@yaks/durable-object/resets'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { answered, KERNEL } from './meta.ts'
import { background, defect, within } from './defects.ts'
import type { Env } from './env.ts'
import { tallying } from './lib/hops.ts'
import { type Clock, system, within as inTime } from '@yaks/fp'
import type { Stored } from '@yaks/workerd/cache'

export let useUntil = (now = Date.now()) =>
  new Date((Math.floor(now / 3_600_000) + 1) * 3_600_000).toISOString()

/// stale(undefined, 1794238920000) -> true
/// stale('2026-11-09T14:05:00.000Z', 1794238920000) -> true
/// stale('2026-11-09T15:05:00.000Z', 1794238920000) -> false
/// stale('2026-11-09T16:00:00.000Z', 1794238920000) -> true
/** Whether a receipt at `now` writes its moment: nothing kept since the hour
 * began, or a moment kept ahead of now, which no use can be. A receipt keeps
 * the moment it happened and answers the hour's end (`useUntil`). */
export let stale = (kept: unknown, now = Date.now()): boolean =>
  typeof kept != 'string' ||
  !(Date.parse(kept) >= Math.floor(now / 3_600_000) * 3_600_000 &&
    Date.parse(kept) <= now)

/// returned('2026-11-01T10:00:00.000Z', '2026-11-02T11:00:00.000Z') -> true
/// returned('2026-11-01T23:00:00.000Z', '2026-11-02T01:00:00.000Z') -> false
/// returned('2026-11-01T10:00:00.000Z', '2026-11-01T22:00:00.000Z') -> false
/// returned(undefined, '2026-11-02T11:00:00.000Z') -> false
/** Whether a use at `at` is somebody coming back: at least a day after the
 * use before it (funnel.ts `returned`). A first use is nobody coming back. */
export let returned = (previous: unknown, at: string) =>
  typeof previous == 'string' &&
  Date.parse(at) - Date.parse(previous) >= 86_400_000

// What an isolate holds for each key: the answer it may give again without
// asking, until when. A receipt the store took holds its hour's end. One an
// overloaded store refused through every resend (as a deploy restarts it, bug
// dbe06394) holds nothing for `REST`, so that store is asked once a minute
// from each colo, not once for every request behind the refusal. The colo's cache holds the
// same, for every isolate there.
type Held = { at: string | null; until: number }
let receipts = new WeakMap<Namespace, Map<string, Held>>()
// When this isolate began asking for each receipt it is asking for: a value,
// never the asking's promise, which settles only in the request that made it
// (@yaks/fp `Scope`). A request that finds one under way leaves it to that
// one; one whose request ended without an answer is asked again after
// `ASKING`.
let asking = new WeakMap<Namespace, Map<string, number>>()
let ASKING = 30_000

/** How long a colo holds back a receipt an overloaded store refused. */
export let REST = 60_000

/** The colo's cache of what the store took (env.ts `USE_CACHE`). */
export type Shelf = () => Promise<Stored>

// How long a receipt waits on the colo's cache before it asks the store
// itself: a match takes a few milliseconds, and now and then seconds (T-1112).
let GLANCE = 500

let markAt = (r: Receipt) =>
  new Request(`https://uses.invalid${r.door}/${encodeURIComponent(r.key)}`)

// What the colo holds for a receipt, or null when it holds nothing or its
// cache can't say in time. A cache that fails is reported and asked around.
let glance = async (
  shelf: Shelf,
  r: Receipt,
  clock: Clock,
): Promise<Held | null> => {
  try {
    let held = await inTime(
      shelf().then((c) => c.match(markAt(r))).then((res) =>
        res?.json() as Promise<Held> | undefined
      ),
      GLANCE,
      clock,
    )
    return held && held.until > clock.now() ? held : null
  } catch (error) {
    defect(error, { request: 'read a use receipt mark', app: r.app })
    return null
  }
}

let mark = async (shelf: Shelf, r: Receipt, held: Held, clock: Clock) => {
  let seconds = Math.ceil((held.until - clock.now()) / 1000)
  if (seconds <= 0) return
  try {
    await (await shelf()).put(
      markAt(r),
      Response.json(held, {
        headers: { 'cache-control': `public, max-age=${seconds}` },
      }),
    )
  } catch (error) {
    defect(error, { request: 'mark a use receipt', app: r.app })
  }
}

// A receipt the platform store keeps until the hour it answers: one POST to
// `door` per `key` an hour, from this isolate, whatever the traffic.
type Receipt = {
  door: '/used' | '/translated'
  key: string
  body: Record<string, string>
  request: string
  app: string
}

let schedule = (
  env: Partial<Env>,
  r: Receipt,
  retain?: (work: Promise<void>) => void,
): void => {
  if (!env.STORE) return
  let work = tallying(new Map(), () =>
    within(
      env,
      { request: r.request, app: r.app },
      () => receipt(env.STORE!, r, env.CLOCK, env.USE_CACHE),
      undefined,
      { retain },
    )).then(() => {})
  ;(retain ?? background)(work)
}

let receipt = (
  ns: Namespace,
  r: Receipt,
  clock: Clock = system,
  shelf?: Shelf,
): Promise<string | null> => {
  let held = receipts.get(ns)
  if (!held) receipts.set(ns, held = new Map())
  let kept = held.get(r.key)
  if (kept && kept.until > clock.now()) return Promise.resolve(kept.at)
  let under = asking.get(ns)
  if (!under) asking.set(ns, under = new Map())
  let began = under.get(r.key)
  if (began != null && clock.now() - began < ASKING) {
    return Promise.resolve(null)
  }
  if (under.size >= 1000) {
    for (let [key, at] of under) {
      if (clock.now() - at >= ASKING) under.delete(key)
    }
  }
  under.set(r.key, clock.now())
  let hold = (at: string | null, until: number) => {
    if (held.size >= 1000) {
      for (let [key, h] of held) if (h.until <= clock.now()) held.delete(key)
      if (held.size >= 1000) held.delete(held.keys().next().value!)
    }
    held.set(r.key, { at, until })
    return at
  }
  // What the store said, held here and marked for the colo.
  let took = async (at: string | null, until: number) => {
    if (shelf) await mark(shelf, r, { at, until }, clock)
    return hold(at, until)
  }
  return (async () => {
    let colo = shelf && await glance(shelf, r, clock)
    if (colo) return hold(colo.at, colo.until)
    try {
      let at = await storeOf(ns, PLATFORM_STORE, undefined, jittered(clock))
        .consume(
          r.door,
          async (response) => {
            if (!response.ok) throw await answered(response)
            return (await response.json() as { at: string }).at
          },
          {
            method: 'POST',
            body: JSON.stringify(r.body),
          },
          KERNEL,
        )
      return await took(at, Date.parse(at))
    } catch (error) {
      defect(error, { request: r.request, app: r.app })
      return overloaded(error) ? await took(null, clock.now() + REST) : null
    }
  })().finally(() => under.delete(r.key))
}

let used = (eid: string): Receipt => ({
  door: '/used',
  key: eid,
  body: { eid },
  request: 'record app use',
  app: eid,
})

// What an app's row keeps beside its use (facets/directory-vocab.ts). The
// platform store's `/used` answers it, and a store on the previous code hears
// only a use, so no deploy order refuses a receipt.
type Mark = 'changed' | 'errored'

let marked = (eid: string, word: Mark): Receipt => ({
  door: '/used',
  key: `${word} ${eid}`,
  body: { eid, word },
  request: `record app ${word}`,
  app: eid,
})

let spoke = (eid: string, spelling: string): Receipt => ({
  door: '/translated',
  key: `${eid} ${spelling}`,
  body: { eid, spelling },
  request: 'record a retired query spelling',
  app: eid,
})

export let scheduleUse = (
  env: Partial<Env>,
  eid: string,
  retain?: (work: Promise<void>) => void,
): void => schedule(env, used(eid), retain)

// A start a caller sends a store ahead of what it will ask (door.ts
// `ahead`).
let starting = (path: string, request: string) =>
(
  env: Partial<Env>,
  store: string,
  retain?: (work: Promise<void>) => void,
): void => {
  let STORE = env.STORE
  if (!STORE) return
  ahead(
    () => storeOf(STORE, store)(path, {}, KERNEL),
    { request, store },
    retain,
  )
}

// A store woken a moment ago is still up. A burst of views (a crawler
// walking an app's pages) sends its store one wake per binding per `AWAKE`,
// not one per view queued behind the reads the views make (T-1112).
let AWAKE = 10_000
let WOKEN = 1024
let woken = new WeakMap<Namespace, Map<string, number>>()
let waking = starting(WAKE, 'store wake')

/** Boot the store `store` names (door.ts `WAKE`) for a page's scripts, whose
 * first `/api/` call would otherwise wait out its whole start and boot
 * (T-149697, T-150366), unless this isolate woke it in the last ten seconds. */
export let wake = (
  env: Partial<Env>,
  store: string,
  retain?: (work: Promise<void>) => void,
): void => {
  let ns = env.STORE
  if (!ns) return
  let held = woken.get(ns)
  if (!held) woken.set(ns, held = new Map())
  let now = (env.CLOCK ?? system).now()
  if (now - (held.get(store) ?? -Infinity) < AWAKE) return
  held.delete(store)
  held.set(store, now)
  if (held.size > WOKEN) held.delete(held.keys().next().value!)
  waking(env, store, retain)
}

/** Start the object a birth names (door.ts `WARM`) for its first write
 * (T-143307). Its store holds nothing yet, and the start reads nothing, so one
 * nobody follows up keeps nothing. */
export let start = starting(WARM, 'store warm')

/** A write changed this app's store, or its code reported an error. */
export let scheduleMark = (
  env: Partial<Env>,
  eid: string,
  word: Mark,
  retain?: (work: Promise<void>) => void,
): void => schedule(env, marked(eid, word), retain)

/** The person who did it is active too: their calls and page views count. */
export let scheduleBy = (
  env: Partial<Env>,
  who: { person: string | null; administrative?: boolean },
  eid: string,
  retain?: (work: Promise<void>) => void,
): void => {
  if (who.administrative) return
  scheduleUse(env, eid, retain)
  if (who.person) scheduleUse(env, who.person, retain)
}

export let recordUse = (
  ns: Namespace,
  eid: string,
  clock?: Clock,
  shelf?: Shelf,
): Promise<string | null> => receipt(ns, used(eid), clock, shelf)

/** What a receipt writes: when something was last used, and which retired
 * spellings an app still sends. No authorization reads either. */
export let RECEIPTS = ['used', 'changed', 'errored', 'translated']

/// isRetired('.drill!') -> true
/// isRetired('.drill') -> false
/// isRetired('.a! .b?') -> false
/// isRetired('.a!=') -> false
/** Whether `s` is one retired query spelling, as `retired()` reports them. */
export let isRetired = (s: string): boolean => {
  try {
    let old = retired(parse(s))
    return old.length == 1 && old[0] == s
  } catch {
    return false
  }
}

/** That app's code sent these retired query spellings (T-123000). */
export let scheduleRetired = (
  env: Partial<Env>,
  eid: string,
  spellings: string[],
  retain?: (work: Promise<void>) => void,
): void => {
  for (let s of new Set(spellings)) schedule(env, spoke(eid, s), retain)
}

export let recordRetired = (
  ns: Namespace,
  eid: string,
  spelling: string,
): Promise<string | null> => receipt(ns, spoke(eid, spelling))

export let using = (allowed: () => boolean): Plugin => ({
  name: 'yak/used',
  rules: [{
    name: 'used',
    phase: 'stamp',
    match: '.entity, #Actor, #Now',
    run: (row) => {
      let actor = row.$actor ?? row.Actor
      return allowed() && (actor.by || actor.via)
        ? { used: { at: row.Now.at } }
        : undefined
    },
  }],
})
