// A person's MCP servers on their connections page: added with a key, their
// tools chosen, turned off, removed to the trash and restored, through the
// page's own forms against a server that takes a key in a header.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'
import { fixture } from '../../packages/mcp-client/testing.ts'
import { connecting } from './connections.ts'
import { mcpPage } from './connected-mcp.ts'
import { directory, over } from './directory.ts'
import { meta } from './meta.ts'
import { desk } from './desk-pages.ts'
import { platform } from './testing.ts'
import type { Who } from './session.ts'

let KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
let p = platform('a probe secret', {
  VAULT: d1() as unknown as D1Like,
  VAULT_KEY: KEY,
})
let at = meta(p.env)
let dir = directory({ fetch: over(at) })
let person = crypto.randomUUID()
await at.apply([
  { entity: { eid: person }, person: {} },
  {
    entity: { eid: '$space' },
    doc: { title: 'ada' },
    space: { slug: 'ada', store: 'ada' },
  },
  {
    entity: { eid: '$seat' },
    member: { space: '$space', person, role: 'owner' },
  },
], { 'x-yak-person': person, 'x-yak-role': 'owner' })
await at.apply([
  {
    entity: { eid: '$space' },
    doc: { title: 'Club' },
    space: { slug: 'club', store: 'club' },
  },
  {
    entity: { eid: '$seat' },
    member: { space: '$space', person, role: 'owner' },
  },
], { 'x-yak-person': person, 'x-yak-role': 'owner' })
let space = (await dir.space('ada'))!
let club = (await dir.space('club'))!
let who: Who = { person, role: 'owner' }

// The server, on the public internet as far as the page knows.
let box = fixture()
let real = globalThis.fetch
let reached = (fn: () => Promise<unknown>) => {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let req = new Request(input, init)
    if (new URL(req.url).pathname.startsWith('/.well-known/')) {
      return Promise.resolve(new Response(null, { status: 404 }))
    }
    if (req.method == 'POST' && req.headers.get('x-api-key') != 'k-1') {
      return Promise.resolve(new Response(null, { status: 401 }))
    }
    return box.fetcher(req)
  }) as typeof fetch
  return fn().finally(() => globalThis.fetch = real)
}
let post = (fields: Record<string, string | string[]>, on = space) => {
  let form = new FormData()
  for (let [k, v] of Object.entries(fields)) {
    for (let one of [v].flat()) form.append(k, one)
  }
  return reached(() =>
    connecting(
      new Request('https://yaks.app/manage/connections?space=ada'),
      p.env,
      on,
      who,
      form,
    )
  )
}
let page = (open?: string, on = space) =>
  reached(() => mcpPage(p.env, dir, who, on.eid, { open })) as ReturnType<
    typeof mcpPage
  >

test('a person adds an MCP server with its key, chooses its tools, and removes and restores it', async () => {
  assertEquals(
    await post({
      do: 'mcp-add',
      name: 'Keys',
      url: 'https://keys.test/mcp',
      header: 'X-API-Key',
      key: 'k-1',
    }),
    { say: 'Keys is connected.', no: false },
  )
  let [one] = (await page()).servers
  assertEquals(
    [one.name, one.status, one.keyed, one.header, one.enabled, one.trashed],
    ['Keys', 'connected', true, 'X-API-Key', true, false],
  )
  let tools = (await page(one.id)).tools!.list!
  assertEquals(tools.map((t) => [t.name, t.allowed]), [[
    'publish_mockup',
    true,
  ]])
  await post({ do: 'mcp-tools', server: one.id })
  assertEquals((await page()).servers[0].allow, [])
  await post({ do: 'mcp-tools', server: one.id, tool: 'publish_mockup' })
  assertEquals((await page()).servers[0].allow, undefined)
  await post({ do: 'mcp-off', server: one.id })
  assertEquals((await page()).servers[0].enabled, false)
  await post({ do: 'mcp-on', server: one.id })
  await post({ do: 'mcp-remove', server: one.id })
  assertEquals((await page()).servers[0].trashed, true)
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
      mcp: await page(),
    },
  })).text()
  assertStringIncludes(drawn, 'MCP servers in the trash')
  assertStringIncludes(drawn, 'value="mcp-restore"')
  await post({ do: 'mcp-restore', server: one.id })
  assertEquals((await page()).servers[0].trashed, false)
})

test('a server is connected in the space whose page added it, and one kept from before spaces moves to the space connecting it again', async () => {
  let names = async (on: typeof space) =>
    (await page(undefined, on)).servers.filter((s) => !s.trashed).map((s) =>
      s.name
    ).sort()
  let before = await names(space)
  await post(
    { do: 'mcp-add', name: 'Slides', url: 'https://slides.test/mcp' },
    club,
  )
  assertEquals(await names(club), ['Slides'])
  assertEquals(await names(space), before)
  let legacy = crypto.randomUUID()
  await at.apply([{
    entity: { eid: legacy },
    mcp_server: { owner: person, name: 'Old', url: 'https://old.test/mcp' },
  }], { 'x-yak-person': person, 'x-yak-role': 'owner' })
  assertEquals(await names(club), ['Old', 'Slides'])
  assertEquals(await names(space), [...before, 'Old'].sort())
  await post({ do: 'mcp-add', name: 'Old', url: 'https://old.test/mcp' }, club)
  assertEquals(await names(club), ['Old', 'Slides'])
  assertEquals(await names(space), before)
})

test('a server that asks for a key, added without one, says so', async () => {
  assertEquals(
    await post({ do: 'mcp-add', name: 'Lin', url: 'https://lin.test/mcp' }),
    { say: 'Lin is added. Paste its key to connect it.', no: false },
  )
})

test('a page form for a server the person does not keep says so', async () => {
  assertEquals(
    await post({ do: 'mcp-remove', server: crypto.randomUUID() }),
    { say: 'This MCP server is not connected for you.', no: true },
  )
})

// The page as the dialog asks for it with `?detail=<open>`, beside a server
// waiting on its sign-in.
let detail = async (open: string) => {
  let html = await (await desk({
    space: 'ada',
    apps: [],
    view: 'connections',
    connections: {
      on: true,
      list: [],
      services: [],
      built: [],
      borrowed: [],
      open,
      mcp: {
        servers: [{
          id: 's-1',
          name: 'Linear',
          url: 'https://mcp.linear.app/mcp',
          enabled: true,
          everyone: false,
          trashed: false,
          status: 'needed',
          connection: 'c-1',
          keyed: false,
          apps: [],
        }],
      },
    },
  })).text()
  return html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'))
}

test('a server waiting on its sign-in opens as a dialog that starts it', async () => {
  let drawn = await detail('mcp:s-1')
  assertStringIncludes(drawn, 'data-modal-key="mcp:s-1"')
  assertStringIncludes(drawn, 'name="connection" value="c-1"')
  assertStringIncludes(drawn, 'value="signin"')
})

test('a dialog asked for what the page does not hold says why', async () => {
  let drawn = await detail('gone')
  assertStringIncludes(drawn, 'data-modal-key="gone"')
  assertStringIncludes(drawn, 'it was removed, or it belongs to another space')
})
