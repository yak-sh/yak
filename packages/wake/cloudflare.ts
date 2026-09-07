/**
 * Cloudflare supplies the heartbeat; the graph holds the schedules. A Cron
 * Trigger calls `scheduled`, while a Durable Object can arm its one alarm for
 * a wake that falls before the next heartbeat. Neither path imports a host
 * global, so Deno can exercise the same driver with a storage stand-in.
 * @module
 */

import type { Wake } from './comp.ts'
import { type Driver, tick, type Ticked } from './tick.ts'

/** The instant Cloudflare scheduled, independent of delivery latency. */
export type Scheduled = { scheduledTime: number }

/** The alarm methods a Durable Object's storage supplies. */
export type Alarm = {
  getAlarm: () => Promise<number | null>
  setAlarm: (at: number) => Promise<void>
}

// The runtime owns one alarm per object. Calls in the same handler may race,
// so serialize the read/compare/write for each storage object, even when one
// failed. A later wake must never overwrite an earlier one just being armed.
let arming = new WeakMap<Alarm, Promise<unknown>>()

/**
 * A Worker's scheduled handler, reduced to the graph write all hosts share.
 * The event's cron string does not select a job: due wake rows do.
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
 * Arm a Durable Object for one wake before the next Cron Trigger. An earlier
 * alarm is preserved because the object may hold other wakes. Returns whether
 * this wake needs the alarm; an absent or later `at` leaves it alone.
 *
 * Call on a wake write. In the object's `alarm()` call `tick(graph)` and arm
 * its next pending wake; the heartbeat retries any refused occurrences.
 *
 * ```ts
 * import { arm } from '@yaks/wake/cloudflare'
 *
 * // await arm(ctx.storage, wake, nextHeartbeat)
 * ```
 */
export let arm = (
  storage: Alarm,
  wake: Wake,
  before: number,
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
