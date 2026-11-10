import { assertEquals, assertRejects } from '@std/assert'
import { test } from '@yaks/testing'
import { memory } from '../printbound/storefront_fixture.ts'
import manifest from './vocab.json' with { type: 'json' }
import { gallery } from './gallery.ts'

test('a gallery page needs continuing consent and serves only its reviewed public caption', async () => {
  let { db } = memory(manifest),
    book = crypto.randomUUID(),
    page = crypto.randomUUID(),
    blob = 'a'.repeat(64)
  await db.apply([{
    entity: { eid: book },
    gallery_consent: { at: new Date().toISOString() },
  }, {
    entity: { eid: page },
    coloring_page: {
      book,
      position: 1,
      prompt: 'Private family idea',
      caption: 'Private story sentence',
    },
    artwork: { blob, hash: blob, mime: 'image/png', input: blob },
    gallery_approved: {
      at: new Date().toISOString(),
      caption: 'A day at the river',
    },
  }])
  let published = gallery(db, {
    fetch: () => Promise.resolve(new Response('artwork')),
  })
  assertEquals((await published.list()).map((row) => row.caption), [
    'A day at the river',
  ])
  assertEquals(await (await published.file(page)).text(), 'artwork')
  await db.apply([{
    entity: { eid: page },
    gallery_approved: { caption: null },
  }])
  assertEquals((await published.list()).map((row) => row.caption), [''])
  await db.apply([{ entity: { eid: book }, gallery_consent: null }])
  assertEquals(await published.list(), [])
  await assertRejects(() => published.file(page))
})
