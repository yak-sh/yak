// The platform's own jobs, which only the directory runs: each sweep its wake
// row's kind names, and a held number's month. A platform facet's rule asks
// for one by name (@yaks/platform/lent `job`), and the directory's Store lends
// them with its bindings (graph.ts `Stored`). Each job is imported when it
// first runs, so composing a store never loads one.
import type { Bound } from '@yaks/graph'
import type { Env } from './env.ts'
import { reporting } from './wake.ts'
import { KERNEL, meta } from './meta.ts'
import { idOf, stamp } from './directory.ts'
import { monthOf } from '@yaks/platform/meter'
import type { Remake } from './remake.ts'

/** A platform job: the row whose rule asked for it, run with the directory's
 * bindings. */
export type Job = (env: Env, row: Bound) => Promise<undefined>

// A wrap pass that could not reach every script comes back this soon.
let AGAIN = 60_000

let props = (c: unknown): Record<string, unknown> =>
  c && typeof c == 'object' ? Object.fromEntries(Object.entries(c)) : {}

export let jobs: Record<string, Job> = {
  // The trash sweep: what has sat in the trash past its time, erased.
  trash: (env, row) =>
    reporting(env, row, async (spent) => {
      let { collected } = await import('./erase.ts')
      return await collected(env, new Date(row.Now.at), spent)
    }),
  // The hourly meter: each store's counts, read into the directory, every
  // model call's hold its caller died holding settled (model-spend.ts
  // `expired`), and each bought number's calls charged, let go only the ways
  // its space allows, and its texts pointed here (number-upkeep.ts).
  meter: (env, row) =>
    reporting(env, row, async () => {
      let now = new Date(row.Now.at)
      let { expired } = await import('./model-spend.ts')
      let n = await expired(env, now)
      if (n) console.log(`yak-meter: ${n} expired model holds settled`)
      let { metered } = await import('./usage.ts')
      await metered(env, now)
      let { allowed, minutes, orders, pointed } = await import(
        './number-upkeep.ts'
      )
      let met = (await import('./phone-slow.ts')).tally()
      await orders(env, now, met)
      await minutes(env, now, met)
      await allowed(env, now, met)
      await pointed(env, met)
      await met.settle(env, now.getTime())
    }),
  phone_release: async (env, row) => {
    let { finishRelease } = await import('./number-release.ts')
    await finishRelease(env, row.entity.eid, new Date(row.Now.at))
  },
  // Each month after the first that a space holds a number (numbers.ts
  // `number_buy`), its monthly price spent from the space's budget under
  // its texts. Never refused: the provider bills the platform for the month
  // whether or not the budget has room, so the spend counts all the same.
  lines: async (env, row) => {
    let { space, monthly, ordering, returned } = props(row.phone_line)
    if (!monthly || ordering || returned) return
    await stamp(env, {
      entities: [{
        entity: { eid: idOf(space as string) },
        spend: { month: monthOf(new Date(row.Now.at)), texts: Number(monthly) },
      }],
    })
  },
  // The kill sweep (kills.ts). Each run reads on from where the last one
  // finished, which the row keeps as `sweep.through`.
  kills: (env, row) =>
    reporting(env, row, async () => {
      let { swept } = await import('./kills.ts')
      let sweep = row.sweep as { through?: string | null }
      let through = await swept(env, sweep.through, Date.parse(row.Now.at))
      if (!through) return
      await meta(env).apply(
        [{ entity: row.entity, sweep: { through } }],
        KERNEL,
      )
    }),
  // The wrap pass (rewrap.ts).
  wrap: (env, row) =>
    reporting(env, row, async () => {
      let { rewrapped } = await import('./rewrap.ts')
      let { rewrapped: n, failed, left } = await rewrapped(env)
      if (n || failed || left) {
        console.log(`yak-wrap: ${n} rewrapped, ${failed} failed, ${left} left`)
      }
      if (!left) return
      await meta(env).apply([{
        entity: row.entity,
        wake: { at: new Date(Date.now() + AGAIN).toISOString() },
      }], KERNEL)
    }),
  // The remake sweep, fired by a release's remake row (remake.ts).
  remake: (env, row) =>
    reporting(env, row, async () => {
      let { remade } = await import('./remake.ts')
      await remade(env, row.release_remake as Remake)
    }),
  // Each deploy not yet committed to git, committed (gitobj.ts).
  git: (env, row) =>
    reporting(env, row, async () => {
      let { backfilled, held } = await import('./gitobj.ts')
      let made = await backfilled(env, held(meta(env)))
      if (made) console.log(`yak-git: ${made} deploys committed`)
    }),
}
