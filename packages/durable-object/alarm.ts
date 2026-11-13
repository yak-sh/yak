/**
 * A Durable Object's one alarm, worked as one loop: everything the object
 * does on its own time (wakes, the effects pool, upkeep, a backlog) is a
 * {@link Work}, and each time the alarm rings every work is given one slice
 * and answers when it is next owed. The alarm is then set for the soonest.
 *
 * - An alarm that answers once its slice is under way (`keep`) stands at a
 *   backstop a few seconds out while the slice runs: an instance a deploy or
 *   an eviction cuts off mid-slice is rung again, and its replacement takes
 *   the work up. One that answers when its slice ends needs none, since the
 *   runtime delivers an alarm again when its handler was cut off, and an idle
 *   ring writes nothing.
 * - An object past its row ceiling (`./ceiling.ts`) works nothing and is rung
 *   again when its window ends; a work it stopped part way is no failure.
 * - A work that fails is reported and tried again a minute on, and the works
 *   after it still run.
 * - A ring while a slice is still going starts no second slice.
 *
 * Writes arm the alarm with {@link Clock.arm}, which keeps an alarm already
 * set sooner. The loop is pure over the {@link Alarms} it is handed, so Deno
 * drives it with `./testing.ts`'s stand-in storage.
 *
 * ```ts
 * import { clock } from '@yaks/durable-object/alarm'
 * import { assertEquals } from '@std/assert'
 *
 * let at: number | null = null, now = 1000, owed: number[] = []
 * let storage = {
 *   getAlarm: () => Promise.resolve(at),
 *   setAlarm: (next: number) => Promise.resolve(void (at = next)),
 * }
 * let time = clock(storage, {
 *   sweep: () => (owed.push(now), now + 5000),
 * }, { now: () => now })
 * await time.ring()
 * assertEquals([owed, at], [[1000], 6000])
 * ```
 * ```
 *
 * @module
 */

import { LOST } from '@yaks/wake/cloudflare'
import { stopped } from './ceiling.ts'

/** The alarm methods a Durable Object's storage provides. */
export type Alarms = {
  getAlarm(): Promise<number | null>
  setAlarm(at: number): Promise<void>
  deleteAlarm?(): Promise<void>
}

/**
 * One kind of work the alarm does. Given the instant its slice ends, it does
 * what is due and answers when it is next owed, in ms since the epoch: now or
 * earlier when the slice ended with some left, null when nothing is owed.
 */
export type Work = (
  until: number,
) => Promise<number | null | undefined> | number | null | undefined

/** How the loop is run. */
export type Options = {
  /** The clock; `Date.now` by default. */
  now?: () => number
  /** A work's failure, by the work's name. */
  report?: (error: unknown, work: string) => void
  /** How long until the object may work again: its ceiling's
   * `stopped(true)`, 0 while it is admitted. */
  wait?: () => number
  /** Given the slice once it is under way, so the alarm answers then: the
   * object's `waitUntil`. Without it the ring answers once the slice ends. */
  keep?: (slice: Promise<void>) => void
  /** How long one ring works: an alarm is one invocation, and the runtime
   * caps its CPU. */
  slice?: number
  /** How far out the alarm stands while a slice it answered before runs. */
  backstop?: number
  /** How long a failed work waits before it is tried again. */
  retry?: number
}

/** An object's alarm loop. */
export type Clock = {
  /** Ring at `at` (ms since the epoch), unless the alarm is set sooner. */
  arm(at: number): Promise<void>
  /** The runtime's `alarm()`: one slice of every work, then the alarm set
   * for the soonest owed. */
  ring(): Promise<void>
}

/** How long one ring works. */
export let SLICE = 10_000
/** How far out the alarm stands while a slice runs. */
export let BACKSTOP = 15_000
/** How long a failed work waits before it is tried again. */
export let RETRY = 60_000

/** The loop over `works`, run in the order given. Given as a function, the
 * works are asked for at each ring, so an object can name them once it has
 * opened what they work on. */
export let clock = (
  storage: Alarms,
  works: Record<string, Work> | (() => Record<string, Work>),
  opts: Options = {},
): Clock => {
  let now = opts.now ?? Date.now
  let slice = opts.slice ?? SLICE
  let backstop = opts.backstop ?? BACKSTOP
  let retry = opts.retry ?? RETRY
  let report = opts.report ?? ((e) => console.error(e))
  // The alarm a ring took over: the one standing when it began, which the
  // works' answer supersedes even when it is later, or the backstop it set.
  // One armed since, by a write during the slice, stands where it is sooner,
  // and one later than the alarm taken over is owed with the works' answer.
  let standing: number | null = null
  let asked = Infinity
  let going: Promise<void> | undefined
  // The runtime gives an object one alarm, and two handlers' read, compare
  // and write would race, so every change to it waits on the one before.
  let serial: Promise<unknown> = Promise.resolve()
  let change = (body: (held: number | null) => Promise<void>) => {
    let next = serial.then(async () => {
      let held = await storage.getAlarm()
      await body(held != null && held < now() - LOST ? null : held)
    })
    serial = next.catch(() => {})
    return next
  }
  let arm = (at: number) =>
    change(async (held) => {
      if (held != null && held == standing) asked = Math.min(asked, at)
      if (held == null || at < held) await storage.setAlarm(at)
    })

  let work = async () => {
    let until = now() + slice, next = Infinity
    let named = typeof works == 'function' ? works() : works
    for (let [name, run] of Object.entries(named)) {
      try {
        let at = await run(until)
        if (at != null) next = Math.min(next, at)
      } catch (e) {
        // Stopped part way, the object takes nothing until its window ends,
        // so the works after this one would only be stopped too.
        if (stopped(e)) {
          next = Math.min(next, now() + e.retry.after)
          break
        }
        report(e, name)
        next = Math.min(next, now() + retry)
      }
    }
    await change(async (held) => {
      let mine = standing
      next = Math.min(next, asked)
      standing = null
      asked = Infinity
      if (Number.isFinite(next)) {
        if (held == null || held == mine || next < held) {
          await storage.setAlarm(next)
        }
      } else if (held != null && held == mine) await storage.deleteAlarm?.()
    })
  }

  let ring = async () => {
    let wait = opts.wait?.() ?? 0
    if (wait) return arm(now() + wait)
    let mine = now() + backstop, was = standing
    await change(async (held) => {
      if (opts.keep && (held == null || held == was || mine < held)) {
        await storage.setAlarm(held = mine)
      }
      standing = held
    })
    if (going) return
    let run = going = work().finally(() => going = undefined)
    if (opts.keep) opts.keep(run.catch((e) => report(e, 'alarm')))
    else await run
  }

  return { arm, ring }
}
