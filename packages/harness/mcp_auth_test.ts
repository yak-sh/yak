import { assert, assertEquals } from '@std/assert'
import { h } from 'preact'
import { mount } from '../tui/testing.ts'
import { MCPAuthPanel } from './MCPAuthPanel.ts'
import { frontend } from './frontend.ts'
import { authorizedMCP } from './mcp_auth.ts'
import { signins } from './signin.ts'
import type { UIAgent } from './panels.ts'
import { fixture } from '../mcp-client/testing.ts'
import { remote } from './remote.ts'
import { at, harness } from './testing.ts'

Deno.test('authorization UI captures pasted callback privately, preserving draft and never sending it', async () => {
  const ui = frontend()
  ui.keys({ mode: 'NORMAL' })
  const received: string[] = []
  const api = {
    authorizeMCP: (action: string, _name?: string, callback?: string) => {
      if (action === 'complete') received.push(callback!)
      return Promise.resolve(
        action === 'list' ? { servers: ['site'] } : action === 'begin'
          ? {
            url: 'https://issuer.test/authorize?state=public-state',
            redirectUrl: 'http://127.0.0.1/callback',
          }
          : { message: 'Connected' },
      )
    },
  } as UIAgent
  const view = await mount(() => h(MCPAuthPanel, { ui, agent: api }), 100, 15)
  try {
    await view.send('A')
    await view.send('\r')
    const callback =
      'http://127.0.0.1/callback?code=VERY_SECRET&state=public-state'
    await view.send('\x1b[200~' + callback + '\x1b[201~')
    assert(!view.out.join('').includes('VERY_SECRET'))
    assert(!JSON.stringify(ui.client.ent('draft')).includes('VERY_SECRET'))
    await view.send('\r')
    assertEquals(received, [callback])
    assert(view.text().includes('Connected'))
  } finally {
    view.free()
    ui.close()
  }
})

Deno.test('local HTTP OAuth exchange reconnects MCP discovery and works through worker controls', async () => {
  const dir = await Deno.makeTempDir()
  let origin = '', exchanges = 0
  const f = fixture()
  const server = Deno.serve(
    { port: 0, hostname: '127.0.0.1', onListen() {} },
    async (req) => {
      const u = new URL(req.url)
      if (u.pathname.includes('oauth-protected-resource')) {
        return Response.json({
          resource: origin + '/mcp',
          authorization_servers: [origin],
        })
      }
      if (u.pathname.includes('well-known')) {
        return Response.json({
          issuer: origin,
          authorization_endpoint: origin + '/authorize',
          token_endpoint: origin + '/token',
          registration_endpoint: origin + '/register',
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        })
      }
      if (u.pathname === '/register') {
        return Response.json({ ...await req.json(), client_id: 'public' }, {
          status: 201,
        })
      }
      if (u.pathname === '/token') {
        exchanges++
        return Response.json({
          access_token: 'private-access',
          token_type: 'Bearer',
          expires_in: 3600,
        })
      }
      if (
        req.headers.get('authorization') !== 'Bearer private-access'
      ) return new Response(null, { status: 401 })
      return f.fetcher(req)
    },
  )
  origin = 'http://127.0.0.1:' + server.addr.port
  const db = dir + '/graph.db'
  const seed = await harness(db)
  await seed.g.apply([{
    entity: { eid: 'site' },
    mcp_server: { name: 'site', url: origin + '/mcp' },
  }])
  seed.close()
  const backend = await remote({ config: at(db), fake: true })
  try {
    assertEquals((await backend.agent.authorizeMCP!('list')).servers, [
      'site [site]',
    ])
    const pending = await backend.agent.authorizeMCP!('begin', 'site')
    const callback = pending.redirectUrl + '?code=authorization-code&state=' +
      new URL(pending.url!).searchParams.get('state')
    const reply = await backend.agent.authorizeMCP!(
      'complete',
      'site',
      callback,
    )
    assert(reply.message!.includes('Connected'))
    assertEquals(exchanges, 1)
    // Another process over the same graph finds the sign-in, a connection the
    // server owns, in the vault beside it, and nothing of the exchange that
    // produced it.
    const again = await harness(db)
    const signin = signins(again)
    const local = authorizedMCP(
      [{ name: 'site', url: origin + '/mcp' }],
      (s) => signin.key(s.name, s.url),
    )
    try {
      const tools = await local.tools()
      assertEquals(tools.length, 1)
      assert(!JSON.stringify(tools).includes('private-access'))
    } finally {
      await local.close()
      again.close()
    }
    const kept = [...Deno.readDirSync(dir + '/secrets')]
      .filter((e) => e.name.endsWith('.json'))
      .map((e) => Deno.readTextFileSync(dir + '/secrets/' + e.name))
    assert(kept.some((text) => text.includes('private-access')))
    assert(!kept.some((text) => text.includes('authorization-code')))
  } finally {
    await backend.close()
    await server.shutdown()
    await Deno.remove(dir, { recursive: true })
  }
})
