// What a space's Apps page (@yaks/platform/space-apps) reads that no store
// holds, answered by the page graph's door (reach-door.ts) as the page asks
// and by the page itself for its first paint (manage.ts): what is broken in
// each app, from the space's tracker with what its Operator made of each
// break (unseen.ts `brokenIn`, which also tells the Operator of a break it
// never heard of), and how many agents the person connected, from the OAuth
// provider (connected.ts `agentsOf`). A read that fails is reported and
// answered with no rows: the apps are drawn without what is broken, and what
// depends on the agents stays unsettled.
import type { Bundle } from '@yaks/graph'
import { agentRows, brokenRows } from '@yaks/platform/space-apps'
import { shelf } from './apps.ts'
import { caught } from './defects.ts'
import type { Directory, Space } from './directory.ts'
import type { Env } from './env.ts'
import type { Who } from './session.ts'
import { brokenIn } from './unseen.ts'

// The identity part, asked for at request time: it carries the OAuth
// provider, whose `cloudflare:` modules exist only inside workerd
// (manage.ts `identity`).
let identity = () => import('./identity.ts')

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

/** How many agents `person` connected, as their row. */
export let agentsIn = async (
  env: Env,
  dir: Directory,
  person: string,
): Promise<Bundle[]> => {
  try {
    let agents = await (await identity()).agents(env, person, dir)
    return agentRows(person, agents.length)
  } catch (e) {
    caught(e, { request: 'read agents' })
    return []
  }
}
