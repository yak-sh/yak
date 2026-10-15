// Use belongs to the directory, independently of platform bookkeeping. App
// receipts round up to the hour so repeated visits need no durable writes and
// the idle sweep errs towards keeping an app a little longer. The same receipt
// records each retired query spelling an app's code still sends, so a
// translation in the grammar goes only once nothing sends it (T-123000).
import type { Comp, Plugin } from '@yaks/graph'
import type { Handler } from '@yaks/effects'
import { parse, retired } from '@yaks/query'
import { type Namespace, PLATFORM_STORE, storeOf } from './door.ts'
import { answered, KERNEL } from './meta.ts'
import { background, defect, within } from './defects.ts'
import type { Env } from './env.ts'
import { tallying } from './lib/hops.ts'

export let useUntil = (now = Date.now()) =>
  new Date((Math.floor(now / 3_600_000) + 1) * 3_600_000).toISOString()

export let maintenance = (run: Handler): Handler & { maintenance: true } =>
  Object.assign(run, { maintenance: true as const })

let receipts = new WeakMap<Namespace, Map<string, string>>()
let pending = new WeakMap<Namespace, Map<string, Promise<string | null>>>()

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
      () => receipt(env.STORE!, r),
      undefined,
      { retain },
    )).then(() => {})
  ;(retain ?? background)(work)
}

let receipt = (ns: Namespace, r: Receipt): Promise<string | null> => {
  let held = receipts.get(ns)
  if (!held) receipts.set(ns, held = new Map())
  let at = held?.get(r.key)
  if (at && Date.parse(at) > Date.now()) return Promise.resolve(at)
  let waiting = pending.get(ns)
  let running = waiting?.get(r.key)
  if (running) return running
  if (!waiting) pending.set(ns, waiting = new Map())
  let work = (async () => {
    try {
      let response = await storeOf(ns, PLATFORM_STORE)(r.door, {
        method: 'POST',
        body: JSON.stringify(r.body),
      }, KERNEL)
      if (!response.ok) throw await answered(response)
      at = (await response.json() as { at: string }).at
      if (held.size >= 1000) {
        for (let [key, at] of held) {
          if (Date.parse(at) <= Date.now()) held.delete(key)
        }
        if (held.size >= 1000) held.delete(held.keys().next().value!)
      }
      held.set(r.key, at)
      return at
    } catch (error) {
      defect(error, { request: r.request, app: r.app })
      return null
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

export let recordUse = (ns: Namespace, eid: string): Promise<string | null> =>
  receipt(ns, used(eid))

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
    match: '.entity, ?used, #Actor, #Now',
    run: (row) => {
      let actor = row.$actor ?? row.Actor
      let at = row.Now.at
      let previous = (row.used as Comp | undefined)?.at
      if (
        typeof previous == 'string' && Date.parse(previous) > Date.parse(at)
      ) {
        at = previous
      }
      return allowed() && (actor.by || actor.via) ? { used: { at } } : undefined
    },
  }],
})
