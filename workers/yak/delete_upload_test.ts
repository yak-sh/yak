// Deleting an upload: a page deletes the row at the upload's eid, and the
// bytes leave the app's bucket with it, unless a row the app keeps still
// names them. Read straight off the bucket the platform in memory keeps.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import * as apps from './apps.ts'
import { blobPrefix } from './blob-key.ts'
import { r2Objects } from './lib/objects.ts'
import { ADA, as, platform, seeded, visit } from './serving-probe.ts'

type File = { eid: string; url: string }

test('deleting an upload deletes its bytes, unless a row still names them', async () => {
  using scenario = platform()
  let { env } = scenario
  let { space, app } = await seeded(env, 'open')
  let held = (sha: string) =>
    r2Objects(env.BLOBS).has(blobPrefix(space, app) + sha)
  let person = async (eid: string) => {
    let cookie = await as(eid)
    let send = (path: string, body: BodyInit, type: string) =>
      apps.fetch(
        visit(`/cookbook/api/${path}`, {
          method: 'POST',
          headers: { cookie, 'content-type': type },
          body,
        }),
        env,
      )
    return {
      upload: async (text: string) =>
        await (await send('blob', text, 'text/plain')).json() as File,
      drop: async (eid: string) =>
        (await send(
          'apply',
          JSON.stringify([{ entity: { eid }, $delete: true }]),
          'application/json',
        )).status,
      apply: async (bundles: unknown[]) =>
        (await send('apply', JSON.stringify(bundles), 'application/json'))
          .status,
      status: async (url: string) => {
        let res = await apps.fetch(visit(url, { headers: { cookie } }), env)
        await res.body?.cancel()
        return res.status
      },
    }
  }
  let ada = await person(ADA)
  let stranger = await person('b0000000-0000-4000-8000-0000000000b0')

  let kept = await ada.upload('the cake')
  let gone = await stranger.upload('their cake')
  // On an open app a stranger deletes only what they uploaded.
  assertEquals(await stranger.drop(kept.eid), 403)
  assertEquals(await stranger.drop(gone.eid), 200)
  await scenario.settled()
  assertEquals(await held(kept.eid), true)
  assertEquals(await held(gone.eid), false)
  assertEquals(await ada.status(gone.url), 404)
  assertEquals(await ada.status(`/cookbook/api/blob/${gone.eid}`), 404)

  // An attachment naming the bytes keeps them past their upload's row.
  let named = await ada.upload('a generated cake')
  assertEquals(await ada.apply([{ attachment: { artifact: named.eid } }]), 200)
  assertEquals(await ada.drop(named.eid), 200)
  // An owner deletes anyone's.
  assertEquals(await ada.drop(kept.eid), 200)
  await scenario.settled()
  assertEquals(await held(named.eid), true)
  assertEquals(await held(kept.eid), false)

  // Bytes nothing names are never served, wherever a copy is left: in a
  // cache, or in the bucket from before deleting reached it.
  let key = blobPrefix(space, app) + kept.eid
  await r2Objects(env.BLOBS).put(key, new TextEncoder().encode('the cake'))
  assertEquals(await ada.status(kept.url), 404)
  // …until the same bytes are sent again, and named again.
  assertEquals((await ada.upload('the cake')).url, kept.url)
  assertEquals(await ada.status(kept.url), 200)
})
