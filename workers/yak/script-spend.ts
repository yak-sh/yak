// A fresh script reserves its maximum CPU cost in the same ledger as an
// app preview or a model call. The Dynamic Worker's tail settles the receipt,
// so a script's open hold is the script running: a space runs at most `RUNS`.
import { HOSTED_LIMITS } from '@yaks/code-mode'
import { ModelError } from '@yaks/model'
import { line } from '@yaks/query'
import { meta } from './meta.ts'
import { scriptDollars } from '@yaks/platform/meter'
import { type Space } from './directory.ts'
import type { Env } from './env.ts'
import { reserved, settled } from './model-spend.ts'
import { refuse } from './tool.ts'

export type ScriptBill = { space: Space; person: string; call: string }
export type ScriptTrace = { readonly cpuTime: number }

/** How many scripts one space runs at once. */
export let RUNS = 4

export let tooManyRuns = (slug: string) =>
  `${slug} already runs ${RUNS} scripts at once; wait for one to finish, ` +
  'or do more in each script.'

// Two reservations made at the same moment may both see three running, as
// sandboxes count who is awake (sandbox.ts `awake`): the limit is for
// fairness, not a guard.
let running = async (env: Env, space: Space, now: Date) =>
  (await meta(env).query(
    line`.model_reservation.space=${space.eid}&.model_reservation.source=scripts&.model_reservation.until>${now.toISOString()}&.limit=${RUNS}`,
  )).length

export let reserveScript = async (env: Env, bill: ScriptBill) => {
  let now = new Date(env.CLOCK?.now() ?? Date.now())
  let dollars = scriptDollars(HOSTED_LIMITS.cpuMs)
  if (await running(env, bill.space, now) >= RUNS) {
    throw refuse('limit', tooManyRuns(bill.space.slug))
  }
  try {
    let hold = await reserved(env, bill.space, () => ({ dollars }), bill.call, {
      source: 'scripts',
      person: bill.person,
      now,
      likely: scriptDollars(0),
      until: new Date(now.getTime() + 5 * 60_000),
    })
    return hold.release
  } catch (error) {
    if (
      error instanceof ModelError && ['limit', 'submitted'].includes(error.code)
    ) {
      throw refuse(error.code, error.message)
    }
    throw error
  }
}

export let settleScript = async (
  env: Env,
  call: string,
  events: ScriptTrace[],
) => {
  if (!events.length) return
  let cpuMs = events.reduce((ms, event) => ms + event.cpuTime, 0)
  if (!await settled(env, call, scriptDollars(cpuMs))) {
    throw new Error(
      'A Dynamic Worker trace arrived without a script reservation',
    )
  }
}
