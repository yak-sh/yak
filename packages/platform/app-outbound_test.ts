import { equal, test } from '@yaks/testing'
import { incoming, outgoing } from './app-outbound.ts'

test('the outbound service forwards an upgrade and its trusted caller through fetch', async () => {
  let trusted = { app: 'room' }
  let response = new Response()
  let request = new Request('https://game.test/api/ws', {
    headers: {
      upgrade: 'websocket',
      'x-yak-outbound-caller': '{"app":"another"}',
    },
  })
  let result = await outgoing(request, trusted, {
    send: () => Promise.reject(new Error('RPC received an upgrade')),
    fetch: (req) =>
      incoming(req, (request, caller) => {
        equal(caller, trusted)
        equal(request.headers.get('upgrade'), 'websocket')
        equal(request.headers.has('x-yak-outbound-caller'), false)
        return Promise.resolve(response)
      }),
  })
  equal(result === response, true)
})
