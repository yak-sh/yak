import { equal, test, throws } from '@yaks/testing'
import { MockAgent } from 'undici'
import { freshFetch, httpClient } from './http.ts'

let agent = new MockAgent()
agent.disableNetConnect()
let pool = agent.get('https://provider.test')
let body: Promise<string> = Promise.resolve('')
pool.intercept({
  path: '/answer',
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-owner': 'native' },
}).reply(201, (options) => {
  body = (async () => {
    let text = '', decoder = new TextDecoder()
    for await (let chunk of options.body as AsyncIterable<Uint8Array>) {
      text += decoder.decode(chunk, { stream: true })
    }
    return text + decoder.decode()
  })()
  return 'answer'
}, { headers: { 'x-reply': 'ok' } })
let http = httpClient(agent)

test('HTTP pool accepts native requests and preserves the response', async () => {
  try {
    let response = await http.fetch(
      new Request('https://provider.test/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-owner': 'native' },
        body: '{"prompt":"hello"}',
      }),
    )
    equal(response instanceof Response, true)
    equal(response.status, 201)
    equal(response.headers.get('x-reply'), 'ok')
    equal(await response.text(), 'answer')
    equal(await body, '{"prompt":"hello"}')
    agent.assertNoPendingInterceptors()
  } finally {
    await http.close()
  }
})

test('fresh fetch collects each answer and closes its private pool', async () => {
  let opened = 0, closed = 0
  let fetch = freshFetch(() => {
    opened++
    return {
      fetch: () => Promise.resolve(new Response('collected', { status: 201 })),
      close: () => {
        closed++
      },
    }
  })
  let response = await fetch('https://provider.test')
  equal([opened, closed], [1, 1])
  equal(response.status, 201)
  equal(await response.text(), 'collected')
  await fetch('https://provider.test')
  equal([opened, closed], [2, 2])
})

test('fresh fetch closes its pool when the response body fails', async () => {
  let closed = 0, failure = new Error('body interrupted')
  let fetch = freshFetch(() => ({
    fetch: () =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start: (controller) => controller.error(failure),
          }),
        ),
      ),
    close: () => {
      closed++
    },
  }))
  equal(await throws(() => fetch('https://provider.test')), failure)
  equal(closed, 1)
})
