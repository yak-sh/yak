import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { accountHost, closeAccounts, personal } from '@yaks/cli'
import { connect, integrationEid, need } from '@yaks/connections'
import { remote } from './remote.ts'

// The account lives in a temporary directory; requests stay in process.
test('remote inspector uses saved login on resolution and HTTP requests', async () => {
  let state = Deno.makeTempDirSync({ prefix: 'inspect-login-' })
  let calls: { path: string; auth: string | null }[] = []
  let host = 'inspector.test'
  let go = ((url, init) => {
    let req = new Request(url, init)
    let at = new URL(req.url)
    calls.push({
      path: at.pathname + at.search,
      auth: req.headers.get('authorization'),
    })
    return Promise.resolve(
      at.pathname == '/api/app'
        ? Response.json({ app: 'probe/empty', url: `${at.origin}/empty/api` })
        : Response.json({ ok: true }),
    )
  }) as typeof fetch
  try {
    let path = await personal(state)
    let h = await accountHost(path)
    await h.graph.apply([{
      entity: { eid: integrationEid(`https://${host}/mcp`) },
      integration: { name: `https://${host}/mcp`, hosts: [host] },
    }])
    let [b] = await h.graph.apply(
      await need(h.graph.read, {
        owner: h.config.person!,
        integration: `https://${host}/mcp`,
      }),
    )
    await connect({ graph: h.graph, vault: h.vault }, b.entity.eid, {
      key: 'probe-token',
    })
    let { url, wire } = await remote('probe/empty', host, state, go, {
      config: path,
    })
    assertEquals(url, `https://${host}/empty/api`)
    assertEquals(
      await (await wire.fetch!(
        new Request(`${url}/query`, { headers: wire.headers }),
      )).json(),
      { ok: true },
    )
    assertEquals(calls, [
      { path: '/api/app?app=probe%2Fempty', auth: 'Bearer probe-token' },
      { path: '/empty/api/query', auth: 'Bearer probe-token' },
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
    Deno.removeSync(state, { recursive: true })
  }
})
