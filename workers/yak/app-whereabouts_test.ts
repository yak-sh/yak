// A person with an app's page open is on yaks.app: each page says its tab on
// its socket, and the app's store keeps one `whereabouts` row for the person
// on that app, across their pages there, saying "away" once the last closes.
import { equal, test } from '@yaks/testing'
import { installPair, made } from '../../packages/workerd/testing.ts'
import * as apps from './apps.ts'
import { platform } from './testing.ts'
import { ADA, as, SECRET, seeded, visit } from './serving-data-probe.ts'
import { storeName } from './directory.ts'
import { whereaboutsOf } from './whereabouts.ts'

test("an app's open pages keep where their person is, across their tabs", async () => {
  let runtime = platform(SECRET)
  await using _ = runtime
  let { env } = runtime
  let { space, app } = await seeded(env, 'private')
  let object = runtime.object(storeName(space, app))
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
    object.webSocketMessage(
      ws,
      JSON.stringify({ tab: { visible: true, focused } }),
    )
  // Gone as the runtime lets a socket go: closed, then the object told.
  let close = (ws: Awaited<ReturnType<typeof page>>) => {
    ws.readyState = 3
    return object.webSocketClose(ws)
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
  await close(front)
  equal(await where(), [['apps', app.eid, 'background']])
  // A page that never said its tab (an older client) counts for nothing.
  await close(back)
  equal(await where(), [['apps', app.eid, 'away']])
  await close(quiet)
  equal(await where(), [['apps', app.eid, 'away']])
})
