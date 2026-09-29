// The page waits for all of the store's words before it opens a local graph.
import { assertEquals } from '@std/assert'
import { FakeTime } from '@std/testing/time'
import { client } from '@yaks/client'
import words from './vocab.json' with { type: 'json' }
import core from '../../packages/kernel/vocab.json' with { type: 'json' }

Deno.test('a vocabulary 500 recovers before the page can query created', async () => {
  using time = new FakeTime()
  let fetchBefore = globalThis.fetch
  let documentBefore = Object.getOwnPropertyDescriptor(globalThis, 'document')
  let calls = 0
  try {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { baseURI: 'https://example.test/vale/' },
    })
    globalThis.fetch = () =>
      Promise.resolve(
        ++calls == 1
          ? new Response('store unavailable', { status: 500 })
          : Response.json([words, core]),
      )

    let opened = false
    let opening = import('./net.ts?retry-vocab').then((net) => {
      opened = true
      return net
    })
    await time.tickAsync(0)
    assertEquals(calls, 1)
    assertEquals(opened, false)
    await time.tickAsync(1000)
    let { vocab } = await opening
    assertEquals(calls, 2)
    assertEquals(vocab.comp('created')?.name, 'created')
    let page = client(vocab, [], { vault: false, wireVault: false })
    assertEquals(page.read('.player&.created.by="person"&*'), [])
    page.close()
  } finally {
    globalThis.fetch = fetchBefore
    if (documentBefore) {
      Object.defineProperty(globalThis, 'document', documentBefore)
    } else delete (globalThis as { document?: Document }).document
  }
})
