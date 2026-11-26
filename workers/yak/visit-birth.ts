import { instrumentEid } from '@yaks/platform/instrument'
import { claim, settled, type Visit, visitAt } from '@yaks/platform/visits'
import { background } from './defects.ts'
import { type App, type Space, storeName } from './directory.ts'
import { storeOf } from './door.ts'
import type { Env } from './env.ts'
import { KERNEL } from './meta.ts'
import { COPY } from './relocate.ts'
import { cleared } from './sample.ts'
import { ledgerOf } from './visit.ts'

// The births under way in this isolate, by app and browser: a page that sends
// two writes at once makes one store.
let births = new Map<string, Promise<Visit>>()

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
  let held = births.get(key)
  if (held) return held
  let birth = bear(env, space, app, via, by, now)
    .finally(() => births.delete(key))
  births.set(key, birth)
  // Another request may await this birth: held to its end (lib/shared.ts).
  background(birth.then(() => {}, () => {}))
  return birth
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
