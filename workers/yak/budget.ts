// A space's monthly model and voice budget, set by the platform's owner
// (T-137556): a support credit, a demo, a test that needs more than its plan's.
// GET `?space=` reads it; POST `space` and `dollars` sets it, and an empty
// `dollars` hands the space back to its plan's (meter.ts `BUDGET`). It is
// stamped for the reason the fee is (sell.ts `fees`): a budget a space could
// write for itself lifts its own ceiling, and a write around this door would
// leave the read cache answering the old one for a TTL.

import * as dirPart from './directory.ts'
import { directory, type Space, stamp } from './directory.ts'
import { bound, type Env } from './env.ts'
import { adminWho } from './identity.ts'
import { limitOf } from './meter.ts'

let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

let shown = (space: Space, dollars: number | null) =>
  Response.json({
    space: space.slug,
    dollars,
    limit: limitOf({ ...space, budget: dollars }),
  })

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
  if (!form) return shown(space, space.budget)
  // Read as digits, not as a number: `Number('')` is 0, a budget of nothing.
  let given = String(said('dollars') ?? '')
  if (given != '' && !/^\d+(\.\d+)?$/.test(given)) {
    return json(400, 'bad_budget', `not a number of dollars: ${given}`)
  }
  let dollars = given == '' ? null : Number(given)
  await stamp(env, {
    entities: [{
      entity: { eid: space.eid },
      budget: dollars == null ? null : { dollars },
    }],
  }, { actor: { by: who.person! } })
  return shown(space, dollars)
}
