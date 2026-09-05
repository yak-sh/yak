/**
 * @yaks/wake — coming back to something later, as data: the scheduling
 * component domain for a {@link https://jsr.io/@yaks/graph | @yaks/graph}.
 *
 * Say a calendar entry should nudge you the morning of, and a plant should
 * remind you to water it every three days. Both are the same one idea — a row
 * that says WHEN — and this package is that row plus the rule for reading it:
 *
 * - **`wake{at, every, target, note}`** — come back at `at`; if `every` is
 *   set, come back again. `target` is what it is about, `note` is the line you
 *   left yourself.
 * - **`fired{at}`** — when it last went off.
 *
 * ## Two functions
 * ```ts
 * import { due, ring } from '@yaks/wake'
 *
 * let now = Date.now()
 * // let owed = due(storage, now)          // the wakes whose hour has come
 * // for (let w of owed) {
 * //   waterThePlant(w)                     // whatever the wake was for
 * //   graph.apply([ring(w, now)])          // stamp it, and move it on
 * // }
 * ```
 * {@link due} is one query — `at` has passed — and {@link ring} is the patch
 * that consumes one: a recurring wake's `at` moves to {@link next}, a
 * one-shot's is cleared, and both stamp `fired`.
 *
 * ## It fires nothing
 * There is no timer in this package, on purpose. When to come back is a
 * property of the HOST, not of the data: a server has `setTimeout`, a Durable
 * Object has `alarm()`, a Worker has a cron trigger, a browser tab has
 * whatever it is given. All four call the same `due()` and get the same
 * answer, which is what makes a schedule portable. The README wires each one.
 *
 * Because `at` is a row and not a process's memory, being away is not missing
 * it: a host that was down for a day comes back, asks `due()`, and is handed
 * everything owed — once, not once per missed tick, since a cadence catches up
 * in a single step.
 *
 * ## How `every` is read
 * A DURATION (`30m`, `2h`, `every 3 days`) counts from the last instant, so a
 * reminder set at 09:17 keeps landing at :17. A CRON line (`0 9 * * 1-5`,
 * `@daily`) names positions on a calendar and lands at nine whatever time you
 * wrote it — parsed by croner, and read in UTC unless you name a zone, so
 * every reader of one graph agrees on one instant.
 *
 * An `every` this package cannot read is `null`, never a throw: the wake fires
 * once, on its `at`, and stops.
 *
 * It imports no platform API, so the same rules run on a server, in a worker,
 * and in a browser tab.
 *
 * @module
 */

export * from './comp.ts'
export * from './every.ts'
export * from './due.ts'
export * from './plugin.ts'
