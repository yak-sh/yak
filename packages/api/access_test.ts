import { equal, test } from '@yaks/testing'
import { secured } from './access.ts'
import type { Peer } from './deno.ts'

let peer = (hostname: string): Peer => ({
  remoteAddr: { hostname, port: 1234 },
})
let request = (headers: HeadersInit = {}) =>
  new Request('http://127.0.0.1/mcp', { headers })

test('only transport loopback addresses bypass a bearer credential', async () => {
  let door = secured(() => new Response('ok'), () => undefined)
  for (let ip of ['127.0.0.1', '127.0.2.3', '::1', '::ffff:127.0.0.1']) {
    equal((await door(request(), peer(ip))).status, 200)
  }
  for (let ip of ['10.10.10.42', '100.64.0.2', '::ffff:10.10.10.42', '::2']) {
    equal(
      (await door(
        request({
          host: 'localhost',
          'x-forwarded-for': '127.0.0.1',
          forwarded: 'for=127.0.0.1',
          'x-via': 'a-session',
        }),
        peer(ip),
      )).status,
      401,
    )
  }
  equal((await door(request(), undefined as unknown as Peer)).status, 401)
})

test('remote access requires the current nonempty bearer credential', async () => {
  let token: unknown
  let door = secured(() => new Response('ok'), () => token)
  let remote = peer('10.10.10.42')
  let ask = (authorization?: string) =>
    door(request(authorization ? { authorization } : {}), remote)
  for (token of [undefined, '', { secret: 'unresolved' }]) {
    equal((await ask('Bearer first')).status, 401)
  }
  token = 'first'
  for (
    let authorization of [
      undefined,
      'Basic first',
      'Bearer wrong',
      'Bearer firs',
    ]
  ) {
    let refused = await ask(authorization)
    equal(refused.status, 401)
    equal(refused.headers.get('www-authenticate'), 'Bearer')
  }
  equal((await ask('Bearer first')).status, 200)
  token = 'second'
  equal((await ask('Bearer first')).status, 401)
  equal((await ask('bearer second')).status, 200)
})
