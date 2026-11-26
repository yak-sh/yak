import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { Interrupted } from '@yaks/tools/errors'
import { gateway } from './gateway.ts'

let stopping = new AbortController().signal

test('gateway observation reads the public response without a version override or cached answer', async () => {
  let observed = await gateway(
    stopping,
    ((url, init) => {
      equal(url, 'https://yaks.app/_yak/version')
      equal(init?.cache, 'no-store')
      equal(init?.headers, undefined)
      return Promise.resolve(Response.json({ kernel: 'old' }, {
        headers: { 'x-yak-front-version': 'front' },
      }))
    }) as typeof fetch,
  )
  equal([observed.kernel, observed.front], ['old', 'front'])
})

for (
  let [name, response] of [
    ['failure', () => new Response('unavailable', { status: 503 })],
    ['missing kernel', () =>
      Response.json({ kernel: null }, {
        headers: { 'x-yak-front-version': 'front' },
      })],
    ['missing front', () => Response.json({ kernel: 'kernel' })],
  ] as const
) {
  test(`a ${name} never becomes a claim that promoted code serves`, async () => {
    await assertRejects(() =>
      gateway(stopping, (() => Promise.resolve(response())) as typeof fetch)
    )
  })
}

test('a read the host stops is interrupted, not a gateway failure', async () => {
  let host = new AbortController()
  let read = gateway(
    host.signal,
    ((_url, init) =>
      new Promise((_, reject) =>
        init!.signal!.addEventListener(
          'abort',
          () => reject(init!.signal!.reason),
        )
      )) as typeof fetch,
  )
  host.abort()
  await assertRejects(() => read, Interrupted)
})
