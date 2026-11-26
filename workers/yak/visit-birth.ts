import { instrumentEid } from '@yaks/platform/instrument'
import { claim, settled, type Visit, visitAt } from '@yaks/platform/visits'
import { type App, type Space, storeName } from './directory.ts'
import { storeOf } from './door.ts'
import type { Env } from './env.ts'
import { KERNEL } from './meta.ts'
import { COPY } from './relocate.ts'
import { cleared } from './sample.ts'
import { ledgerOf } from './visit.ts'
import { inFlight } from './lib/shared.ts'

// The births under way, by app and browser, shared within a request
// (lib/shared.ts). Two requests that write at once each bear one; the edge
// keeps the first, and the other's copy is emptied (`settled`).
let births = {}

/**
 * A store of this browser's own, copied from the app's sample at one instant,
 * then written on its edge (@yaks/platform/visits `settled`). Answers the
 * store the edge holds, which is another birth's where one won the race; the
 * loser's copy is emptied. A browser someone is signed in on is theirs before
 * the copy is made (`claim`, the way attribution.ts `claimed` writes it at
 * sign-in), so what they make there is claimed from its first write, and no
 * sweep takes it for nobody's.
 */
export let born = (
  env: Env,
  space: Space,
  app: App,
  via: string,
  by: string | null,
  now = new Date(),
): Promise<Visit> => {
  let key = `${app.eid} ${instrumentEid(via)}`
  return inFlight(births, key, () => bear(env, space, app, via, by, now))
}

let bear = async (
  env: Env,
  space: Space,
  app: App,
  via: string,
  by: string | null,
  now: Date,
): Promise<Visit> => {
  let l = ledgerOf(env)
  if (by) await claim(l, via, by)
  let visit: Visit = {
    ...visitAt(storeName(space, app), crypto.randomUUID()),
    seen: now.toISOString(),
    adopted: null,
  }
  let copy = await storeOf(env.STORE, app.demo!.store)(
    `${COPY}?to=${encodeURIComponent(visit.store)}`,
    { method: 'POST' },
    KERNEL,
  )
  if (!copy.ok) throw new Error(`visit copy: ${await copy.text()}`)
  await copy.body?.cancel()
  let kept = await settled(l, via, app.eid, visit)
  if (kept.store != visit.store) await cleared(env, visit.store)
  return kept
}
