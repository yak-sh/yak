// An app made ready before a person opens it: its store woken and its worker
// started, from the moment its link or icon is drawn, so the page they open
// next doesn't wait out the app's cold start. What the app serves is
// unchanged: its worker is started through the platform's wrapper, which
// answers the start itself (dispatch.ts `WARMING`), so none of the app's code
// is asked anything and its pages are gated as they always are.
import type { App, Space } from './directory.ts'
import { scriptOf, storeName } from './directory.ts'
import type { Env } from './env.ts'
import { nowhere, script, scriptName, WARMING } from './dispatch.ts'
import { ahead } from './door.ts'
import { wake } from './used.ts'
import { spaceHost } from '@yaks/platform/host'

// An app started in the last minute is still up: a page drawn again, or a
// side drawn on every page, starts it once a minute, not once a view.
let WARM = 60_000
let MOST = 1024
let warm = new Map<string, number>()

// The apps any one page starts, its first: a side lists a person's apps in
// the order they reach for them.
let EACH = 8

/** Start `app`'s worker and wake its store, unless this isolate did in the
 * last minute. */
export let warmApp = (
  env: Env,
  space: Space,
  app: App,
  now = Date.now(),
): void => {
  let name = scriptName(scriptOf(space, app))
  let key = `${app.eid} ${name}`
  if (now - (warm.get(key) ?? -Infinity) < WARM) return
  warm.delete(key)
  warm.set(key, now)
  if (warm.size > MOST) warm.delete(warm.keys().next().value!)
  wake(env, storeName(space, app))
  let { DISPATCH } = env
  if (!DISPATCH || app.worker === '') return
  ahead(
    async () => {
      try {
        return await script(DISPATCH, name, app, { person: null, role: null })
          .fetch(
            new Request(`https://${spaceHost(env, space.slug)}/${app.slug}/`, {
              method: 'HEAD',
              headers: { [WARMING]: '1' },
            }),
          )
      } catch (error) {
        if (nowhere(error)) return new Response(null)
        if (warm.get(key) == now) warm.delete(key)
        throw error
      }
    },
    { request: 'app warm', app: app.eid },
  )
}

/** Which links on a roster get a speculative start. Fill spare places with
 * apps whose store can start even though they have no worker. */
export let warmable = (apps: App[]): App[] =>
  [
    ...apps.filter((app) => app.worker !== ''),
    ...apps.filter((app) => app.worker === ''),
  ].slice(0, EACH)

/** Start the apps drawn in the roster, with the explicitly chosen one first. */
export let warmApps = (
  env: Env,
  space: Space,
  apps: App[],
  chosen?: string | null,
): void => {
  let picked = chosen && apps.find((app) => app.slug == chosen)
  if (picked) warmApp(env, space, picked)
  for (let app of warmable(apps)) if (app != picked) warmApp(env, space, app)
}
