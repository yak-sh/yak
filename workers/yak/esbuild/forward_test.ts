import { equal, test } from '@yaks/testing'
import { forwarded } from './forward.ts'

test('compiler jobs carry the kernel catalog and preserve container refusals', async () => {
  let catalog = '{"toolkit":"this kernel"}'
  let ask = '{"pages":["main.ts"]}'
  let job = `{"ask":${ask},"catalog":${catalog}}`
  let response = new Response('compiler outgrew memory', { status: 507 })
  let send = async (req: Request) => {
    equal(req.url, 'http://compiler/')
    equal(req.headers.get('content-type'), 'application/json')
    equal(await req.text(), job)
    return response
  }
  equal(
    await forwarded(
      new Request('http://binding/', {
        method: 'POST',
        headers: { 'x-yak-compiler-job': '1' },
        body: job,
      }),
      send,
      '{"toolkit":"older sibling"}',
    ),
    response,
  )
  equal(
    await forwarded(
      new Request('http://binding/', {
        method: 'POST',
        body: ask,
      }),
      send,
      catalog,
    ),
    response,
  )
  equal(
    (await forwarded(new Request('http://binding/'), send, catalog)).status,
    405,
  )
})
