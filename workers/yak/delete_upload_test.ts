// Deleting an upload, through the whole kernel (probe.ts `kernel`): a page
// deletes the row at the upload's eid and the bytes leave the bucket with it,
// unless a row the app keeps still names them. A representation's URL
// outlives the bytes (@yaks/blob), so it answering 404 is the bucket's word
// that they are gone.
import { test } from '@yaks/testing'
import { assert, assertEquals } from '@std/assert'
import { connector, kernel, seed, signIn, unique } from './probe.ts'

type File = { eid: string; url: string }

test('deleting an upload deletes its bytes, unless a row still names them', async () => {
  let k = await kernel()
  let slug = unique('album')
  let owner = await seed(k, [{ slug, apps: ['photos'] }])
  await connector(k, owner.cookie).tool('app_set', {
    space: slug,
    app: 'photos',
    access: 'open',
  })
  let stranger = await signIn(k)
  let host = `${slug}.yaks.app`
  let as = (cookie: string) => {
    let send = (path: string, body: BodyInit, type: string) =>
      k.at(host, `/photos/api/${path}`, {
        method: 'POST',
        headers: { cookie, 'content-type': type },
        body,
      })
    return {
      upload: async (text: string) =>
        await (await send('blob', text, 'text/plain')).json() as File,
      apply: (bundles: unknown[]) =>
        send('apply', JSON.stringify(bundles), 'application/json'),
      status: async (url: string) => {
        let res = await k.at(host, url, { headers: { cookie } })
        await res.body?.cancel()
        return res.status
      },
    }
  }
  let mine = as(owner.cookie), theirs = as(stranger.cookie)
  let drop = (eid: string) => [{ entity: { eid }, $delete: true }]
  try {
    let kept = await mine.upload('the cake')
    let gone = await theirs.upload('their cake')

    // On an open app a stranger deletes only what they uploaded.
    assertEquals((await theirs.apply(drop(kept.eid))).status, 403)
    assertEquals((await theirs.apply(drop(gone.eid))).status, 200)
    await k.settled?.()
    assertEquals(await mine.status(kept.url), 200)
    assertEquals(await mine.status(gone.url), 404)
    assertEquals(await mine.status(`/photos/api/blob/${gone.eid}`), 404)

    // A row naming the bytes keeps them past their upload's row.
    let named = await mine.upload('a generated cake')
    let use = await mine.apply([{ attachment: { artifact: named.eid } }])
    assertEquals(use.status, 200)
    assertEquals((await mine.apply(drop(named.eid))).status, 200)
    // An owner deletes anyone's.
    assertEquals((await mine.apply(drop(kept.eid))).status, 200)
    await k.settled?.()
    assertEquals(await mine.status(named.url), 200)
    assertEquals(await mine.status(kept.url), 404)

    // The same bytes sent again are stored again.
    assertEquals((await mine.upload('the cake')).url, kept.url)
    assertEquals(await mine.status(kept.url), 200)

    // A URL left over from a deleted upload is no platform bug.
    await k.flushReports?.()
    assert(!JSON.stringify(k.reported ?? []).includes('missing blob'))
  } finally {
    await k.stop()
  }
})
