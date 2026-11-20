// An app's code calls the tools of an MCP server the person using it added,
// once that person allows it on their connections page: listed and called at
// the app's own ./api/commands and ./api/command with `at`, as them alone,
// and stopped as soon as they take it back.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { fixture } from '../../packages/mcp-client/testing.ts'
import * as apps from './apps.ts'
import { connecting } from './connections.ts'
import { mcpPage } from './connected-mcp.ts'
import { desk } from './desk-pages.ts'
import { ADA, as, platform, seeded, visit } from './serving-probe.ts'
import type { Who } from './session.ts'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'

let ELI = 'e0000000-0000-4000-8000-000000000001'

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
    let [server] = (await mcpPage(env, dir, who)).servers
    let at = `mcp:${server.id}`
    let api = async (person: string, path: string, body?: unknown) => {
      let res = await apps.fetch(
        visit(`/cookbook/api${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { cookie: await as(person) },
          ...body ? { body: JSON.stringify(body) } : {},
        }),
        env,
      )
      return { status: res.status, body: await res.json() }
    }
    let call = (person = ADA) =>
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
      `https://yaks.app/manage/connections?grant=${app.eid}&at=mcp%3A#grant`,
    )
    let asked = await mcpPage(env, dir, who, { grant: app.eid, at: 'mcp:' })
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
    let page = await mcpPage(env, dir, who, { grant: app.eid, at })
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
