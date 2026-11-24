// A person with an app's page open is on yaks.app: each page says its tab on
// its socket, and the app's store keeps one `whereabouts` row for the person
// on that app, across their pages there, saying "away" once the last closes.
import { equal, test } from '@yaks/testing'
import { installPair, made } from '../../packages/workerd/testing.ts'
import * as apps from './apps.ts'
import { platform } from './testing.ts'
import { ADA, as, SECRET, seeded, visit } from './serving-data-probe.ts'
import { directoryOf, storeName, url } from './directory.ts'
import { whereaboutsOf, whereaboutsShow } from './whereabouts.ts'

test("an app's open pages keep where their person is, across their tabs", async () => {
  let runtime = platform(SECRET)
  await using _ = runtime
  let { env } = runtime
  let { space, app } = await seeded(env, 'private')
  let cookie = await as(ADA)
  let page = async () => {
    let undo = installPair()
    try {
      let response = await apps.fetch(
        visit('/cookbook/api/ws', {
          headers: { cookie, upgrade: 'websocket' },
        }),
        env,
      )
      await response.body?.cancel()
      equal(response.status, 101)
      return made.at(-1)![1]
    } finally {
      undo()
    }
  }
  let tab = (ws: Awaited<ReturnType<typeof page>>, focused: boolean) =>
    runtime.object(storeName(space, app)).webSocketMessage(
      ws,
      JSON.stringify({ tab: { visible: true, focused } }),
    )
  // Gone as the runtime lets a socket go: closed, then the object told.
  let close = (ws: Awaited<ReturnType<typeof page>>) => {
    ws.readyState = 3
    return runtime.object(storeName(space, app)).webSocketClose(ws)
  }
  let where = async () => {
    await runtime.settled()
    return (await whereaboutsOf(env, ADA)).map(({ whereabouts: w }) => {
      let { channel, place, state } = w as Record<string, string>
      return [channel, place, state]
    })
  }

  let front = await page(), back = await page(), quiet = await page()
  equal(await where(), [])
  await tab(front, true)
  await tab(back, false)
  equal(await where(), [['apps', app.eid, 'here']])
  equal([front.sent, back.sent], [[], []]) // nothing to answer
  // Their Operator reads which app it is, by its address.
  let shown = whereaboutsShow(env, ADA, space.eid, () => directoryOf(env.STORE))
  let { channels } = JSON.parse(String(await shown.run({})))
  equal(channels.map((c: Record<string, string>) => [c.app, c.url, c.state]), [
    [`${space.slug}/${app.slug}`, url(space, app, env), 'here'],
  ])
  // A tab said on a hibernated socket can be what wakes the store.
  runtime.evict(storeName(space, app))
  await tab(front, false)
  equal(await where(), [['apps', app.eid, 'background']])
  await close(front)
  equal(await where(), [['apps', app.eid, 'background']])
  // A page that never said its tab (an older client) counts for nothing.
  await close(back)
  equal(await where(), [['apps', app.eid, 'away']])
  await close(quiet)
  equal(await where(), [['apps', app.eid, 'away']])
})
