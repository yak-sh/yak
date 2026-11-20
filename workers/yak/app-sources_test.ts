// An app's code calls the tools of an MCP server the person using it added,
// once that person allows it on their connections page: listed and called at
// the app's own ./api/commands and ./api/command with `at`, as them alone,
// and stopped as soon as they take it back. It calls the tools of a
// connection its space connected it to the same way, as far as the caller
// may call out through it.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { fixture } from '../../packages/mcp-client/testing.ts'
import * as apps from './apps.ts'
import { connecting, ctxOf } from './connections.ts'
import { need, USES } from '@yaks/connections'
import { edgeEid } from '@yaks/edge'
import { mcpPage } from './connected-mcp.ts'
import { desk } from './desk-pages.ts'
import { ADA, as, platform, seeded, visit } from './serving-probe.ts'
import type { Who } from './session.ts'
import type { D1Like } from '@yaks/d1'
import type { Env } from './env.ts'
import { d1 } from '../../packages/d1/testing.ts'

let ELI = 'e0000000-0000-4000-8000-000000000001'

let apiOf =
  (env: Env) => async (person: string | null, path: string, body?: unknown) => {
    let res = await apps.fetch(
      visit(`/cookbook/api${path}`, {
        method: body ? 'POST' : 'GET',
        headers: person ? { cookie: await as(person) } : {},
        ...body ? { body: JSON.stringify(body) } : {},
      }),
      env,
    )
    return { status: res.status, body: await res.json() }
  }

test("an app calls the tools of a person's MCP server only once they allow it, and as them", async () => {
  await using p = platform({
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  })
  let { env } = p
  let { dir, space, app } = await seeded(env, 'public')
  let box = fixture()
  let real = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let req = new Request(input, init)
    return new URL(req.url).pathname.startsWith('/.well-known/')
      ? Promise.resolve(new Response(null, { status: 404 }))
      : box.fetcher(req)
  }) as typeof fetch
  try {
    let who: Who = { person: ADA, role: 'owner' }
    let form = async (fields: Record<string, string>) => {
      let f = new FormData()
      for (let [k, v] of Object.entries(fields)) f.append(k, v)
      return await connecting(
        new Request('https://yaks.app/manage/ada/connections'),
        env,
        space,
        who,
        f,
      )
    }
    assertEquals(
      await form({
        do: 'mcp-add',
        name: 'Mockups',
        url: 'https://mock.test/mcp',
      }),
      { say: 'Mockups is connected.', no: false },
    )
    let [server] = (await mcpPage(env, dir, who, space.eid)).servers
    let at = `mcp:${server.id}`
    let api = apiOf(env)
    let call = (person: string | null = ADA) =>
      api(person, '/command', {
        at,
        name: 'publish_mockup',
        args: { html: '<p>hi</p>' },
      })

    let refused = await call()
    assertEquals(refused.status, 403)
    assertStringIncludes(refused.body.error.message, 'not granted to this app')
    assertEquals((await api(ADA, '/commands?at=mcp:')).body, [])

    let allow = await apps.fetch(
      visit('/cookbook/api/allow?at=mcp:', {
        headers: { cookie: await as(ADA) },
      }),
      env,
    )
    assertEquals(
      allow.headers.get('location'),
      `https://yaks.app/manage/connections?grant=${app.eid}&at=mcp%3A`,
    )
    let asked = await mcpPage(env, dir, who, space.eid, {
      grant: app.eid,
      at: 'mcp:',
    })
    assertEquals(asked.ask?.sources.map((s) => [s.at, s.granted]), [
      [at, false],
    ])
    assertEquals(
      await form({ do: 'source-grant', app: app.eid, at }),
      {
        say: `${app.title} may use it now, whenever you use ${app.title}.`,
        no: false,
      },
    )
    let page = await mcpPage(env, dir, who, space.eid, { grant: app.eid, at })
    assertEquals(page.ask?.sources.map((s) => s.granted), [true])
    assertEquals(page.servers[0].apps.map((a) => a.eid), [app.eid])
    let drawn = await (await desk({
      space: 'ada',
      apps: [],
      view: 'connections',
      connections: {
        on: true,
        list: [],
        services: [],
        built: [],
        borrowed: [],
        mcp: page,
      },
    })).text()
    assertStringIncludes(drawn, `asks to use what you connected`)
    assertStringIncludes(drawn, `Used by ${app.title}`)

    let listed = await api(ADA, `/commands?at=${at}`)
    assertEquals(listed.status, 200)
    assertEquals(
      listed.body.map((c: { at: string; name: string }) => [c.at, c.name]),
      [[at, 'publish_mockup']],
    )
    let done = await call()
    assertEquals(done.status, 200, JSON.stringify(done.body))
    assertEquals(done.body.ok, true)
    assertStringIncludes(done.body.text, 'https://example.test/mockup/1')
    // Somebody else using the app reaches nothing of Ada's.
    assertEquals((await call(ELI)).status, 403)
    assertEquals((await api(null, '/commands?at=mcp:')).status, 403)
    assertEquals((await call(null)).status, 403)

    await form({ do: 'source-revoke', app: app.eid, at })
    assertEquals((await call()).status, 403)
    assertEquals(
      box.calls.filter((c) => c.method == 'tools/call').length,
      1,
    )
  } finally {
    globalThis.fetch = real
  }
})

test("an app calls a tool of a connection its space connected it to, as far as the caller and the link's cap allow", async () => {
  await using p = platform({
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
  })
  let { env } = p
  let { dir, space, app } = await seeded(env, 'public')
  await dir.apply({ entities: [{ entity: { eid: ELI }, person: {} }] }, {
    'x-yak-person': ELI,
  })
  let c = ctxOf(env)
  let connect = async (integration: string, key: string) => {
    let made = await c.graph.apply(
      await need(c.graph.read, {
        owner: space.eid,
        app: app.eid,
        integration,
        hosts: ['api.hub.test'],
      }),
    )
    let eid = made.find((b) => b.connection)!.entity.eid
    let f = new FormData()
    f.append('do', 'key')
    f.append('connection', eid)
    f.append('key', key)
    await connecting(
      new Request('https://yaks.app/manage/ada/connections'),
      env,
      space,
      { person: ADA, role: 'owner' },
      f,
    )
    return eid
  }
  let eid = await connect('Hub', 'sk-hub')
  let other = `connection:${await connect('Other', 'sk-other')}`
  let at = `connection:${eid}`
  let sent: Request[] = []
  let real = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(new Request(input, init))
    return Promise.resolve(Response.json({ hello: 'hub' }))
  }) as typeof fetch
  try {
    let api = apiOf(env)
    let call = (person: string | null = ADA, source = at) =>
      api(person, '/command', {
        at: source,
        name: 'request',
        args: { url: 'https://api.hub.test/v1' },
      })

    let listed = await api(ADA, `/commands?at=${at}`)
    assertEquals(
      listed.body.map((c: { at: string; name: string }) => [c.at, c.name]),
      [[at, 'request']],
    )
    let done = await call()
    assertEquals(done.status, 200, JSON.stringify(done.body))
    assertEquals(done.body.value.body, '{"hello":"hub"}')
    assertEquals(
      [sent[0].url, sent[0].headers.get('authorization')],
      ['https://api.hub.test/v1', 'Bearer sk-hub'],
    )
    // Eli, signed in but holding nothing on the app, may not call out
    // through the space's connection, as at ./api/fetch.
    assertEquals((await api(ELI, '/commands?at=connection:')).body, [])
    assertEquals((await call(ELI)).status, 403)

    let { body: { HUB, OTHER } } = await api(ADA, '/env')
    let target = 'https://api.hub.test/v1'
    let fetched = async (sentinel = HUB) => {
      let url = encodeURIComponent(`${target}?key=${sentinel}`)
      let res = await apps.fetch(visit(`/cookbook/api/fetch?url=${url}`), env)
      await res.body?.cancel()
      return res.status
    }
    let pool = '/commands?at=connection:'
    let open = (anyone: boolean) =>
      c.graph.apply([{
        entity: { eid: edgeEid(app.eid, USES, eid) },
        [USES]: { anyone },
      }])
    assertEquals(await api(null, pool), { status: 200, body: [] })
    assertEquals((await call(null)).status, 403)
    assertEquals(await fetched(), 403)
    assertEquals(sent.length, 1)

    await open(true)
    let publicPool = await api(null, pool)
    assertEquals(publicPool.status, 200)
    assertEquals(publicPool.body, listed.body)
    assertEquals((await call(null)).status, 200)
    assertEquals(await fetched(), 200)
    assertEquals((await call(null, other)).status, 403)
    assertEquals(await fetched(OTHER), 403)
    assertEquals(
      sent.slice(1).map((r) => [r.url, r.headers.get('authorization')]),
      [
        [target, 'Bearer sk-hub'],
        [`${target}?key=sk-hub`, null],
      ],
    )

    await open(false)
    assertEquals(await api(null, pool), { status: 200, body: [] })
    assertEquals((await call(null)).status, 403)
    assertEquals(await fetched(), 403)

    // A link at its cap refuses the call before anything is sent.
    await c.graph.apply([{
      entity: { eid: edgeEid(app.eid, USES, eid) },
      [USES]: { cap: 0, anyone: true },
    }])
    let capped = await call(null)
    assertEquals(capped.status, 403)
    assertStringIncludes(capped.body.error.message, 'capped at 0')
    assertEquals(await fetched(), 403)
    assertEquals(sent.length, 3)
  } finally {
    globalThis.fetch = real
  }
})
