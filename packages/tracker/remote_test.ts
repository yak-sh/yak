// The transport against a local Worker double, which sees each connection by
// its port.
import { equal, test } from '@yaks/testing'
import { request } from './remote.ts'

test('each request reaches the Worker over a connection of its own', async () => {
  let ports: number[] = []
  let server = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen: () => {} },
    (_, info) => {
      ports.push(info.remoteAddr.port)
      return new Response('ok')
    },
  )
  let remote = { url: `http://127.0.0.1:${server.addr.port}`, secret: 'test' }
  try {
    for (let i = 0; i < 2; i++) {
      await (await request(remote, 'bugs', new URLSearchParams())).text()
    }
    equal(new Set(ports).size, 2)
  } finally {
    await server.shutdown()
  }
})
