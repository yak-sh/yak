/**
 * Cloudflare decides when to run; the graph holds the schedules. A Cron Trigger
 * calls `scheduled`, while a Durable Object can set its single alarm for a wake
 * that falls before the next Cron Trigger. Neither imports a Cloudflare global,
 * so Deno can exercise the same driver with a stand-in storage.
 * @module
 */

import type { Wake } from './comp.ts'
import { type Driver, tick, type Ticked } from './tick.ts'

/** The instant Cloudflare scheduled, independent of delivery latency. */
export type Scheduled = { scheduledTime: number }

/** The alarm methods a Durable Object's storage provides. */
export type Alarm = {
  getAlarm: () => Promise<number | null>
  setAlarm: (at: number) => Promise<void>
}

// The runtime gives each object a single alarm. Calls within one handler can
// race, so the read/compare/write is serialized per storage object, even after
// one of them failed. A later wake must never overwrite an earlier one that is
// in the middle of being set.
let arming = new WeakMap<Alarm, Promise<unknown>>()

/**
 * A Worker's scheduled handler, reduced to the graph write every runtime
 * shares. The event's cron string does not select a job: the due wake rows do.
 *
 * ```ts
 * import { scheduled } from '@yaks/wake/cloudflare'
 *
 * // export default { scheduled: (event) => scheduled(graph, event) }
 * ```
 */
export let scheduled = (
  graph: Driver,
  event: Scheduled,
): Promise<Ticked> => tick(graph, event.scheduledTime)

/**
 * Set a Durable Object's alarm for one wake. An alarm that is already earlier
 * is kept, because the object may hold other wakes. Returns whether this wake
 * needs the alarm at all; a wake with no `at`, or a later one, leaves it alone.
 *
 * Call it when a wake is written. In the object's `alarm()`, call `tick(graph)`
 * and then set the alarm for its next pending wake. `before` is for an
 * application that ALSO has a Cron Trigger: pass the time of the next trigger,
 * and a wake falling after it is left for that trigger to fire rather than this
 * object. An application whose alarm is its only clock leaves `before` out.
 *
 * ```ts
 * import { arm } from '@yaks/wake/cloudflare'
 *
 * // await arm(ctx.storage, wake)
 * ```
 */
export let arm = (
  storage: Alarm,
  wake: Wake,
  before = Infinity,
): Promise<boolean> => {
  let pending = (arming.get(storage) ?? Promise.resolve()).then(async () => {
    let at = wake.at ? Date.parse(wake.at) : NaN
    if (!Number.isFinite(at) || at >= before) return false
    let held = await storage.getAlarm()
    if (held == null || held > at) await storage.setAlarm(at)
    return true
  })
  arming.set(storage, pending.catch(() => {}))
  return pending
}
