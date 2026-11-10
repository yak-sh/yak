// A platform grant, independent of the space's subscription. The ordinary
// graph door cannot write its stamped properties; this door vouches for it.
import * as dirPart from './directory.ts'
import type { Comp } from '@yaks/platform/comp'
import { directory, type Space, stamp, tierOf } from './directory.ts'
import { bound, type Env } from './env.ts'
import { adminWho } from './asking.ts'

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })
let shown = (space: Space) =>
  Response.json({
    space: space.slug,
    tier: space.tier,
    comp: space.comp ?? null,
  })

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  if (req.method != 'GET' && req.method != 'POST') {
    return json(405, 'method_not_allowed', 'get the comp, or post one')
  }
  let form = req.method == 'POST' ? await req.formData() : null
  let said = (key: string) =>
    form ? form.get(key) : new URL(req.url).searchParams.get(key)
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env))
  let meta = await dir.space(dirPart.META.space)
  if (!meta) return json(503, 'no_platform', 'the directory has not seeded yet')
  let who = await adminWho(env, req, (person) => dir.role(meta, person))
  if (who.role != 'owner') {
    return json(403, 'not_owner', `a comp is set by an owner of ${meta.slug}`)
  }
  let space = await dir.space(String(said('space') ?? ''))
  if (!space) return json(404, 'no_space', 'no space has that name')
  if (!form) return shown(space)
  let tier = String(said('tier') ?? '')
  let reason = String(said('reason') ?? '').trim()
  if (!['plus', 'pro', 'revoke'].includes(tier)) {
    return json(400, 'bad_tier', 'choose plus, pro or revoke')
  }
  if (tier != 'revoke' && !reason) {
    return json(400, 'no_reason', 'say why the platform grants this comp')
  }
  let comp: Comp | null = tier == 'revoke'
    ? null
    : { tier: tier as Comp['tier'], reason, by: who.person! }
  await stamp(env, { entities: [{ entity: { eid: space.eid }, comp }] }, {
    actor: { by: who.person! },
  })
  return shown({
    ...space,
    comp,
    tier: tierOf(
      space.slug,
      space.plan?.tier ?? null,
      space.comped,
      Date.now(),
      comp,
    ),
  })
}
