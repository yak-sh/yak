import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { passages } from './worker.js'

test('a signed-out visitor looks up Scripture through the sentinel', async () => {
  let worker = passages((url, init) => {
    assertEquals(url.hostname, 'api.esv.org')
    assertEquals(url.searchParams.get('q'), 'John 15:1-5')
    assertEquals(init.headers.Authorization, 'Token yak_sentinel_demo')
    return Promise.resolve(Response.json({
      canonical: 'John 15:1–5',
      passages: ['<p>Scripture from the service</p>'],
    }))
  })
  let response = await worker.fetch(
    new Request('https://yourname.yaks.app/bible-study/passage?q=John+15:1-5'),
    { ESV: 'yak_sentinel_demo' },
  )
  assertEquals(response.status, 200)
  assertEquals(await response.json(), {
    reference: 'John 15:1–5',
    html: ['<p>Scripture from the service</p>'],
  })
})

test('a visitor sees the borrowing limit and the way to connect their own key', async () => {
  let message =
    'yaks.app refused this call: monthly cap reached. Connect your own key at https://yaks.app/manage/connections?space=example'
  let worker = passages(() =>
    Promise.resolve(new Response(message, { status: 403 }))
  )
  let response = await worker.fetch(
    new Request('https://yourname.yaks.app/bible-study/passage?q=John+15:1-5'),
    { ESV: 'yak_sentinel_demo' },
  )
  assertEquals(response.status, 403)
  assertEquals((await response.json()).error, message)
})

test('an unconnected install explains its missing connection', async () => {
  let response = await passages(() => {
    throw new Error('must not call out')
  }).fetch(
    new Request('https://example.yaks.app/bible-study/passage?q=John+15:1-5'),
    {},
  )
  assertEquals(response.status, 409)
  assertStringIncludes((await response.json()).error, 'ESV API connection')
})
