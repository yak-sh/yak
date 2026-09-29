// The page waits for all of the store's words before it opens a local graph.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { client } from '@yaks/client'
import { vocabulary } from './net.ts'
import words from './vocab.json' with { type: 'json' }
import core from '../../packages/kernel/vocab.json' with { type: 'json' }

test('a vocabulary 500 recovers before the page can query created', async () => {
  using time = new FakeTime()
  let fetchBefore = globalThis.fetch
  let calls = 0
  let urls: string[] = []
  try {
    globalThis.fetch = (url) => {
      urls.push(String(url))
      return Promise.resolve(
        ++calls == 1
          ? new Response('store unavailable', { status: 500 })
          : Response.json([words, core]),
      )
    }

    let opened = false
    let opening = vocabulary(new URL('https://example.test/vale/api/'))
      .then((vocab) => {
        opened = true
        return vocab
      })
    await time.tickAsync(0)
    assertEquals(calls, 1)
    assertEquals(opened, false)
    await time.tickAsync(1000)
    let vocab = await opening
    assertEquals(calls, 2)
    assertEquals(
      urls,
      Array(2).fill('https://example.test/vale/api/vocab.json'),
    )
    assertEquals(vocab.comp('created')?.name, 'created')
    let page = client(vocab, [], { vault: false, wireVault: false })
    assertEquals(page.read('.player&.created.by="person"&*'), [])
    page.close()
  } finally {
    globalThis.fetch = fetchBefore
  }
})
