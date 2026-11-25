// A space's monthly model and voice budget, set by the platform's owner
// (T-137556): a support credit, a demo, a test that needs more than its plan's.
// GET `?space=` reads it; POST `space` and `dollars` sets it, and an empty
// `dollars` hands the space back to its plan's. `tier=free` reads or sets the
// Free plan's allowance once for the platform, in `free_ai_budget{dollars}`.
//
// POST `space`, `refund` and `why` refunds dollars the space spent this month
// (T-145906): a spend of its own, `refunded`, which the meter takes off what
// the month spent and off `drawn` (@yaks/platform/meter `added`), so its
// budget, plan and starter read as if those dollars had not been spent. Who
// refunded, how much and why are in the journal, where the spend is written.
// Both writes are stamped for the reason the fee is (sell.ts `fees`): a budget
// a space could write for itself lifts its own ceiling, and a write around this
// door would leave the read cache answering the old one for a TTL.

import * as dirPart from './directory.ts'
import { type Directory, directory, type Space, stamp } from './directory.ts'
import { bound, type Env } from './env.ts'
import { adminWho } from './asking.ts'
import { budget, monthOf, starterOf } from '@yaks/platform/meter'
import type { FreeBudget, SpaceBudget } from '@yaks/platform/budget'
import { BUDGET, FREE_BUDGET_FROM } from '@yaks/platform/plans'

let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

// Dollars to the cent, as digits: `Number('')` is 0, a budget of nothing.
let DOLLARS = /^\d+(\.\d+)?$/

let amount = (given: string): number | undefined =>
  DOLLARS.test(given) && Number.isFinite(Number(given))
    ? Number(given)
    : undefined

export let freePlan = (dollars: number | null): FreeBudget => ({
  tier: 'free',
  dollars: dollars ?? BUDGET.free,
  from: FREE_BUDGET_FROM,
})

let planBudget = async (
  dir: Directory,
  form: FormData | null,
  write: (bundle: Record<string, unknown>) => Promise<unknown>,
) => {
  if (!form) return Response.json(freePlan(await dir.freeBudget()))
  let given = String(form.get('dollars') ?? '')
  let dollars = amount(given)
  if (dollars == null || form.has('refund')) {
    return json(
      400,
      'bad_budget',
      'give the monthly Free plan budget in dollars',
    )
  }
  await write({ free_ai_budget: { dollars } })
  return Response.json(freePlan(dollars))
}

/** A space's budget as it stands: the door's answer, and what the platform
 * admin's Operator reads (operator-admin.ts). */
export let standing = async (
  dir: Directory,
  space: Space,
  at = new Date(),
): Promise<SpaceBudget> => {
  let now = budget(await dir.withBudget(space), at)
  return {
    space: space.slug,
    dollars: space.budget ?? null,
    limit: now.limit,
    spent: now.spent,
    starter: starterOf(space, at),
  }
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  if (req.method != 'GET' && req.method != 'POST') {
    return json(405, 'method_not_allowed', 'get the budget, or post one')
  }
  let form = req.method == 'POST' ? await req.formData() : null
  let said = (k: string) =>
    form ? form.get(k) : new URL(req.url).searchParams.get(k)
  let dir = dirOf(env)
  let meta = await dir.space(dirPart.META.space)
  if (!meta) {
    return json(503, 'no_platform', 'the directory has not seeded yet')
  }
  let who = await adminWho(env, req, (person) => dir.role(meta, person))
  if (who.role != 'owner') {
    return json(403, 'not_owner', `a budget is set by an owner of ${meta.slug}`)
  }
  let slug = String(said('space') ?? '')
  let tier = String(said('tier') ?? '')
  let now = new Date(env.CLOCK?.now() ?? Date.now())
  let shown = async (space: Space) =>
    Response.json(await standing(dir, space, now))
  let write = (space: Space) => (bundle: Record<string, unknown>) =>
    stamp(env, { entities: [{ entity: { eid: space.eid }, ...bundle }] }, {
      actor: { by: who.person! },
    })
  if (tier) {
    if (tier != 'free' || slug) {
      return json(400, 'bad_budget_target', 'choose a space or the Free plan')
    }
    return planBudget(dir, form, write(meta))
  }
  let space = slug ? await dir.space(slug) : null
  if (!space) return json(404, 'no_space', `no space is called "${slug}"`)
  if (!form) return shown(space)
  // The answer is the space as the write leaves it, worked out here: the read
  // this door makes goes through the directory's cache.
  if (!form.has('refund')) {
    let given = String(said('dollars') ?? '')
    let dollars = given == '' ? null : amount(given)
    if (dollars === undefined) {
      return json(400, 'bad_budget', `not a number of dollars: ${given}`)
    }
    await write(space)({ budget: dollars == null ? null : { dollars } })
    return shown({ ...space, budget: dollars })
  }
  let given = String(said('refund'))
  let why = String(said('why') ?? '').trim()
  let refunded = amount(given)
  if (refunded == null || refunded <= 0) {
    return json(400, 'bad_refund', `not a number of dollars: ${given}`)
  }
  if (!why) return json(400, 'no_why', 'say why it is refunded')
  try {
    await write(space)({ spend: { month: monthOf(now), refunded, why } })
  } catch (err) {
    let no = err as Error & { comp?: string; prop?: string }
    if (no.name != 'Refused' || no.comp != 'spend' || no.prop != 'refunded') {
      throw err
    }
    return json(400, 'bad_refund', no.message)
  }
  return shown((await dir.at(space.eid))!)
}
