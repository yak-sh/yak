// Use belongs to the directory, independently of platform bookkeeping. App
// receipts round up to the hour so repeated visits need no durable writes and
// the idle sweep errs towards keeping an app a little longer.
import type { Comp, Plugin } from '@yaks/graph'
import type { Handler } from '@yaks/effects'
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

export let scheduleUse = (
  env: Partial<Env>,
  eid: string,
  retain?: (work: Promise<void>) => void,
): void => {
  if (!env.STORE) return
  let work = tallying(new Map(), () =>
    within(
      env,
      { request: 'record app use', app: eid },
      () => recordUse(env.STORE!, eid),
      undefined,
      { retain },
    )).then(() => {})
  ;(retain ?? background)(work)
}

export let recordUse = (
  ns: Namespace,
  eid: string,
): Promise<string | null> => {
  let held = receipts.get(ns)
  if (!held) receipts.set(ns, held = new Map())
  let at = held?.get(eid)
  if (at && Date.parse(at) > Date.now()) return Promise.resolve(at)
  let waiting = pending.get(ns)
  let running = waiting?.get(eid)
  if (running) return running
  if (!waiting) pending.set(ns, waiting = new Map())
  let work = (async () => {
    try {
      let response = await storeOf(ns, PLATFORM_STORE)('/used', {
        method: 'POST',
        body: JSON.stringify({ eid }),
      }, KERNEL)
      if (!response.ok) throw await answered(response)
      at = (await response.json() as { at: string }).at
      if (held.size >= 1000) {
        for (let [eid, at] of held) {
          if (Date.parse(at) <= Date.now()) held.delete(eid)
        }
        if (held.size >= 1000) held.delete(held.keys().next().value!)
      }
      held.set(eid, at)
      return at
    } catch (error) {
      defect(error, { request: 'record app use', app: eid })
      return null
    }
  })().finally(() => waiting!.delete(eid))
  waiting.set(eid, work)
  return work
}

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
