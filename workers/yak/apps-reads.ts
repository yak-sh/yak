// What a space's Apps page (@yaks/platform/space-apps) reads that no store
// holds, answered by the page graph's door (reach-door.ts) as the page asks
// and by the page itself for its first paint (manage.ts): what is broken in
// each app, from the space's tracker with what its Operator made of each
// break (unseen.ts `brokenIn`, which also tells the Operator of a break it
// never heard of). A read that fails is reported and answered with no rows:
// the apps are drawn without what is broken.
import type { Bundle } from '@yaks/graph'
import { brokenRows } from '@yaks/platform/space-apps'
import { shelf } from './apps.ts'
import { caught } from './defects.ts'
import type { Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'
import { brokenIn } from './unseen.ts'

/** What is broken in the apps of `space` its Apps page lists for `who`, as
 * the person's rows. */
export let brokenOf = async (
  env: Env,
  dir: Directory,
  space: Space,
  who: Who & { person: string },
): Promise<Bundle[]> => {
  let { all } = shelf(await dir.apps(space), space, who)
  if (!all.length) return []
  try {
    return brokenRows(
      who.person,
      space.eid,
      await brokenIn(env, space, who, all),
    )
  } catch (e) {
    caught(e, { request: 'read open errors', space: space.slug })
    return []
  }
}
