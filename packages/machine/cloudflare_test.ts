// A Cloudflare namespace chooses its deployed image. Unsupported request
// inputs must fail before any RPC can create a container with the wrong data.
import { equal, test } from '@yaks/testing'
import { type Box, cloudflareProvider } from './cloudflare.ts'

test('Cloudflare refuses unsupported provenance, images and existing addresses without RPC', async () => {
  let calls = 0
  let provider = cloudflareProvider({
    idFromName: (name) => name,
    get: () => {
      calls++
      return {} as Box
    },
  })
  for (
    let request of [{ id: 'a', from: 'commit' }, { id: 'a', image: 'image' }]
  ) {
    let refused = false
    try {
      await provider.request!(request)
    } catch {
      refused = true
    }
    equal(refused, true)
  }
  let refused = false
  try {
    await provider.wake({ id: 'a', address: 'remote' })
  } catch {
    refused = true
  }
  equal(refused, true)
  equal(calls, 0)
})
