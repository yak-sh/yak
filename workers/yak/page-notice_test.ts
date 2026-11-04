import { equal, test } from '@yaks/testing'
import { broadcast, drafted } from './page-notice.ts'

let request = (body: unknown, init: RequestInit = {}) =>
  new Request('http://store/drafted', {
    method: 'POST',
    headers: { 'x-yak-kernel': '1' },
    body: JSON.stringify(body),
    ...init,
  })

test('a draft notice reaches pages without subscriptions', async () => {
  let sent: string[] = []
  let draft = { files: [{ path: 'main.ts', entries: ['page.ts'] }] }
  let result = await drafted(request({ draft }), (packet) => {
    broadcast([{ send: (packet) => void sent.push(packet) }], packet, () => {})
  })
  equal(await result.json(), { ok: true })
  equal(sent.map((packet) => JSON.parse(packet)), [{ draft }])
})

test('a failed page send is reported and other pages still receive the notice', () => {
  let error = new Error('closed page')
  let failures: unknown[] = [], sent: string[] = []
  broadcast(
    [
      {
        send: () => {
          throw error
        },
      },
      { send: (packet) => void sent.push(packet) },
    ],
    'packet',
    (error) => void failures.push(error),
  )
  equal(failures, [error])
  equal(sent, ['packet'])
})

test('only the kernel posts an object as a draft notice', async () => {
  let sent: string[] = []
  for (let body of [{}, { draft: [] }, { draft: null }, { draft: 'file' }]) {
    equal((await drafted(request(body), (p) => void sent.push(p))).status, 400)
  }
  equal(
    (await drafted(
      request({ draft: {} }, { headers: {} }),
      (p) => void sent.push(p),
    ))
      .status,
    404,
  )
  equal(
    (await drafted(
      new Request('http://store/drafted', {
        headers: { 'x-yak-kernel': '1' },
      }),
      (p) => void sent.push(p),
    )).status,
    404,
  )
  equal(sent, [])
})
