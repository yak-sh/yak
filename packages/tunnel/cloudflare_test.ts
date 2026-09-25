import { assertEquals, assertRejects } from '@std/assert'
import {
  type Api,
  connect,
  disconnect,
  gateways,
  tunnels,
} from './cloudflare.ts'

type Seen = { method: string; path: string; body?: unknown }

// An account that answers each call from `answers`, keyed `METHOD /path`, and
// keeps what it was asked.
let account = (answers: Record<string, [number, unknown]>) => {
  let seen: Seen[] = []
  let api: Api = {
    account: 'acct',
    token: 'tok',
    fetch: (url, init) => {
      let path = new URL(url).pathname.replace('/client/v4/accounts/acct', '')
      let key = `${init.method} ${path.replace(/\/[0-9a-f-]{8,}$/, '/:id')}`
      seen.push({
        method: String(init.method),
        path,
        ...init.body instanceof FormData
          ? { body: init.body }
          : init.body
          ? { body: JSON.parse(String(init.body)) }
          : {},
      })
      let [status, result] = answers[key] ?? [404, null]
      return Promise.resolve(Response.json(
        status < 300
          ? { success: true, result }
          : { success: false, errors: [{ message: String(result) }] },
        { status },
      ))
    },
  }
  return { api, seen }
}

Deno.test('connect makes a tunnel and a service behind it on the port', async () => {
  let { api, seen } = account({
    'POST /cfd_tunnel': [200, { id: 't-1', token: 'secret-token' }],
    'POST /connectivity/directory/services': [200, { service_id: 's-1' }],
  })
  assertEquals(await connect(api, 'box', { port: 5173 }), {
    tunnel: 't-1',
    service: 's-1',
    token: 'secret-token',
  })
  assertEquals(seen[1].body, {
    type: 'http',
    name: 'box',
    http_port: 5173,
    host: { ipv4: '127.0.0.1', network: { tunnel_id: 't-1' } },
  })
})

Deno.test('a service that cannot be made takes its tunnel with it', async () => {
  let { api, seen } = account({
    'POST /cfd_tunnel': [200, { id: '11111111-aaaa', token: 'x' }],
    'POST /connectivity/directory/services': [403, 'not authorized'],
    'DELETE /cfd_tunnel/:id': [200, null],
  })
  await assertRejects(
    () => connect(api, 'box', { port: 5173 }),
    Error,
    'not authorized',
  )
  assertEquals(seen.at(-1), {
    method: 'DELETE',
    path: '/cfd_tunnel/11111111-aaaa',
  })
})

Deno.test('disconnect removes the service, then the tunnel, gone or not', async () => {
  let { api, seen } = account({
    'DELETE /connectivity/directory/services/:id': [404, 'service not found'],
    'DELETE /cfd_tunnel/:id': [200, null],
  })
  await disconnect(api, { tunnel: '22222222-bbbb', service: '33333333-cccc' })
  assertEquals(seen.map((s) => s.path), [
    '/connectivity/directory/services/33333333-cccc',
    '/cfd_tunnel/22222222-bbbb',
  ])
})

Deno.test('rotate answers the new token', async () => {
  let { api, seen } = account({
    'PATCH /cfd_tunnel/:id': [200, { id: 't', token: 'fresh' }],
  })
  assertEquals(await tunnels(api).rotate('44444444-dddd'), 'fresh')
  let body = seen[0].body as { tunnel_secret: string }
  assertEquals(atob(body.tunnel_secret).length, 32)
})

Deno.test('a gateway is bound to the tunnel’s service and nothing else', async () => {
  let at = '/workers/dispatch/namespaces/ns/scripts/tunnel-1'
  let { api, seen } = account({
    [`PUT ${at}`]: [200, {}],
    [`DELETE ${at}`]: [404, 'This Worker does not exist'],
  })
  let g = gateways(api, 'ns')
  await g.put('tunnel-1', 's-1')
  let form = seen[0].body as FormData
  let meta = JSON.parse(await (form.get('metadata') as File).text())
  assertEquals(meta.bindings, [
    { type: 'vpc_service', name: 'BOX', service_id: 's-1' },
  ])
  await g.remove('tunnel-1')
  assertEquals(seen.map((s) => `${s.method} ${s.path}`), [
    `PUT ${at}`,
    `DELETE ${at}`,
  ])
})
