import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { accountHost, closeAccounts, personal } from '@yaks/cli'
import { connect, integrationEid, need } from '@yaks/connections'
import { remote } from './remote.ts'

// The login file is isolated, and both transports meet a real HTTP door.
// A socket reconnect calls the same connector, with the same bearer.
test('remote inspector uses saved login on resolution, HTTP and socket handshakes', async () => {
  let state = Deno.makeTempDirSync({ prefix: 'inspect-login-' })
  let controller = new AbortController()
  let calls: { path: string; auth: string | null }[] = []
  let server = Deno.serve({
    hostname: '127.0.0.1',
    port: 0,
    signal: controller.signal,
    onListen: () => {},
  }, (req) => {
    let at = new URL(req.url)
    calls.push({
      path: at.pathname + at.search,
      auth: req.headers.get('authorization'),
    })
    if (at.pathname == '/api/app') {
      return Response.json({
        app: 'probe/empty',
        url: `${at.origin}/empty/api`,
      })
    }
    if (at.pathname == '/empty/api/ws') {
      let { socket, response } = Deno.upgradeWebSocket(req)
      socket.addEventListener('message', () => socket.close())
      return response
    }
    return Response.json({ ok: true })
  })
  try {
    let host = `127.0.0.1:${server.addr.port}`
    let path = await personal(state)
    let h = await accountHost(path)
    await h.graph.apply([{
      entity: { eid: integrationEid(`http://${host}/mcp`) },
      integration: { name: `http://${host}/mcp`, hosts: ['127.0.0.1'] },
    }])
    let [b] = await h.graph.apply(
      await need(h.graph.read, {
        owner: h.config.person!,
        integration: `http://${host}/mcp`,
      }),
    )
    await connect({ graph: h.graph, vault: h.vault }, b.entity.eid, {
      key: 'probe-token',
    })
    let { url, wire } = await remote('probe/empty', host, state, undefined, {
      config: path,
    })
    assertEquals(url, `http://${host}/empty/api`)
    assertEquals(
      await (await wire.fetch!(
        new Request(`${url}/query`, { headers: wire.headers }),
      )).json(),
      { ok: true },
    )
    for (let i = 0; i < 2; i++) {
      let socket = wire.connect!(`${url.replace('http:', 'ws:')}/ws`)
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => socket.send('done'))
        socket.addEventListener('close', () => resolve())
        socket.addEventListener(
          'error',
          () => reject(new Error('socket failed')),
        )
      })
    }
    assertEquals(calls, [
      { path: '/api/app?app=probe%2Fempty', auth: 'Bearer probe-token' },
      { path: '/empty/api/query', auth: 'Bearer probe-token' },
      ...[0, 1].map(() => ({
        path: '/empty/api/ws',
        auth: 'Bearer probe-token',
      })),
    ])
    await assertRejects(
      () =>
        remote('missing', host, state, () =>
          Promise.resolve(Response.json({
            error: { code: 'not_found', message: 'no app missing' },
          }, { status: 404 })), { config: path }),
      Error,
      'no app missing',
    )
    await assertRejects(
      () => remote('empty', host, `${state}/none`),
      Error,
      'yak auth yaks.app',
    )
  } finally {
    await closeAccounts()
    controller.abort()
    await server.finished
    Deno.removeSync(state, { recursive: true })
  }
})
