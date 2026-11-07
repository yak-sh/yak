// A space's monthly model and voice budget, set by the platform's owner
// (T-137556): a support credit, a demo, a test that needs more than its plan's.
// GET `?space=` reads it; POST `space` and `dollars` sets it, and an empty
// `dollars` hands the space back to its plan's (meter.ts `BUDGET`).
//
// POST `space`, `refund` and `why` refunds dollars the space spent this month
// (T-145906): a spend of its own, `refunded`, which the meter takes off what
// the month spent and off `drawn` (meter.ts `added`), so its budget, plan and
// starter read as if those dollars had not been spent. Who refunded, how much
// and why are in the journal, where the spend is written. Both writes are
// stamped for the reason the fee is (sell.ts `fees`): a budget a space could
// write for itself lifts its own ceiling, and a write around this door would
// leave the read cache answering the old one for a TTL.

import * as dirPart from './directory.ts'
import { directory, type Space, stamp } from './directory.ts'
import { bound, type Env } from './env.ts'
import { adminWho } from './identity.ts'
import { added, budget, monthOf, starterOf } from './meter.ts'
import type { SpaceBudget } from '@yaks/platform/budget'

let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

// Dollars to the cent, as digits: `Number('')` is 0, a budget of nothing.
let DOLLARS = /^\d+(\.\d+)?$/

/** A space's budget as it stands: the door's answer, and what the platform
 * admin's Operator reads (operator-admin.ts). */
export let standing = (space: Space): SpaceBudget => {
  let now = budget(space)
  return {
    space: space.slug,
    dollars: space.budget ?? null,
    limit: now.limit,
    spent: now.spent,
    starter: starterOf(space),
  }
}

let shown = (space: Space) => Response.json(standing(space))

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
  let space = slug ? await dir.space(slug) : null
  if (!space) return json(404, 'no_space', `no space is called "${slug}"`)
  if (!form) return shown(space)
  let write = (bundle: Record<string, unknown>) =>
    stamp(env, { entities: [{ entity: { eid: space.eid }, ...bundle }] }, {
      actor: { by: who.person! },
    })
  // The answer is the space as the write leaves it, worked out here: the read
  // this door makes goes through the directory's cache.
  if (!form.has('refund')) {
    let given = String(said('dollars') ?? '')
    if (given != '' && !DOLLARS.test(given)) {
      return json(400, 'bad_budget', `not a number of dollars: ${given}`)
    }
    let dollars = given == '' ? null : Number(given)
    await write({ budget: dollars == null ? null : { dollars } })
    return shown({ ...space, budget: dollars })
  }
  let given = String(said('refund'))
  let why = String(said('why') ?? '').trim()
  let spent = budget(space).spent
  if (!DOLLARS.test(given) || !Number(given)) {
    return json(400, 'bad_refund', `not a number of dollars: ${given}`)
  }
  if (Number(given) > spent) {
    return json(
      400,
      'bad_refund',
      `${space.slug} has spent $${spent} this month, less than $${given}`,
    )
  }
  if (!why) return json(400, 'no_why', 'say why it is refunded')
  let spend = { month: monthOf(new Date()), refunded: Number(given), why }
  await write({ spend })
  let meter = { ...space.meter, ...added(space.meter ?? undefined, spend) }
  return shown({ ...space, meter } as Space)
}
