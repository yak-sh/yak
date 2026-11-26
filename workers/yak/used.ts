// Use belongs to the directory, independently of platform bookkeeping. An app's
// receipt records the moment of the hour's first use and is held until the
// hour's end, so repeated visits need no durable writes. The same receipt
// records each retired query spelling an app's code still sends, so a
// translation in the grammar goes only once nothing sends it (T-123000).
import type { Plugin } from '@yaks/graph'
import { parse, retired } from '@yaks/query'
import { ahead, storeOf, WAKE, WARM } from './door.ts'
import { type Namespace } from '@yaks/durable-object/door'
import { overloaded } from '@yaks/durable-object/resets'
import { PLATFORM_STORE } from '@yaks/platform/names'
import { answered, KERNEL } from './meta.ts'
import { background, defect, within } from './defects.ts'
import type { Env } from './env.ts'
import { tallying } from './lib/hops.ts'
import { type Clock, system } from '@yaks/fp'

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
// overloaded store refused (as a deploy restarts it, bug dbe06394) holds
// nothing for `REST`, so that store is asked once a minute from each isolate,
// not once for every request behind the refusal.
type Held = { at: string | null; until: number }
let receipts = new WeakMap<Namespace, Map<string, Held>>()
let pending = new WeakMap<Namespace, Map<string, Promise<string | null>>>()

/** How long an isolate holds back a receipt an overloaded store refused. */
export let REST = 60_000

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
      () => receipt(env.STORE!, r, env.CLOCK),
      undefined,
      { retain },
    )).then(() => {})
  ;(retain ?? background)(work)
}

let receipt = (
  ns: Namespace,
  r: Receipt,
  clock: Clock = system,
): Promise<string | null> => {
  let held = receipts.get(ns)
  if (!held) receipts.set(ns, held = new Map())
  let kept = held.get(r.key)
  if (kept && kept.until > clock.now()) return Promise.resolve(kept.at)
  let waiting = pending.get(ns)
  let running = waiting?.get(r.key)
  if (running) return running
  if (!waiting) pending.set(ns, waiting = new Map())
  let hold = (at: string | null, until: number) => {
    if (held.size >= 1000) {
      for (let [key, h] of held) if (h.until <= clock.now()) held.delete(key)
      if (held.size >= 1000) held.delete(held.keys().next().value!)
    }
    held.set(r.key, { at, until })
    return at
  }
  let work = (async () => {
    try {
      let at = await storeOf(ns, PLATFORM_STORE).consume(
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
      return hold(at, Date.parse(at))
    } catch (error) {
      defect(error, { request: r.request, app: r.app })
      return overloaded(error) ? hold(null, clock.now() + REST) : null
    }
  })().finally(() => waiting!.delete(r.key))
  waiting.set(r.key, work)
  return work
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
): Promise<string | null> => receipt(ns, used(eid), clock)

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
