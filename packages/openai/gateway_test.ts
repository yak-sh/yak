// Gateway configuration reaches Responses and listing with the same identity.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { gateway } from './gateway.ts'

test('gateway uses its stored credential for an arbitrary release and listing', async () => {
  let seen: string[] = []
  let model = gateway({
    base: 'https://gateway.example/openai',
    token: 'gateway-token',
    fetch: (url, init) => {
      seen.push(String(url))
      assertEquals(
        new Headers(init?.headers).get('cf-aig-authorization'),
        'Bearer gateway-token',
      )
      if (String(url).endsWith('/models')) {
        return Promise.resolve(
          Response.json({ data: [{ id: 'next-release' }] }),
        )
      }
      assertEquals(JSON.parse(String(init?.body)).model, 'next-release')
      return Promise.resolve(
        new Response(
          'data: ' + JSON.stringify({
            type: 'response.completed',
            response: {
              id: 'r',
              model: 'next-release',
              status: 'completed',
              output: [],
            },
          }) + '\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        ),
      )
    },
  })
  let reply = await model({ model: 'next-release', items: [], tools: [] })
  assertEquals(reply.model, 'next-release')
  assertEquals(await model.list!(), [{ name: 'next-release' }])
  assertEquals(seen, [
    'https://gateway.example/openai/responses',
    'https://gateway.example/openai/models',
  ])
})
