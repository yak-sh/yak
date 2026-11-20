// A person's sources and an app's grants over a graph and vault in memory:
// what an app may reach of theirs, and a connection's request command.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { provisionalDoc } from '@yaks/effects'
import { platformDoc } from '@yaks/platform/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import { mcpDoc } from '@yaks/mcp-client/vocab'
import { ramVault, secrets, secretsDoc } from '@yaks/secrets'
import {
  connect,
  connectionsDoc,
  type Ctx,
  grant,
  grantable,
  granted,
  grantees,
  grantsOf,
  install,
  need,
  publishService,
  request,
  requests,
  revoke,
} from './mod.ts'

let vocab = loadVocab(
  [
    kernelDoc,
    provenanceDoc,
    edgeDoc,
    secretsDoc,
    provisionalDoc,
    { $defs: { published: platformDoc.$defs!.published } },
    mcpDoc,
    connectionsDoc,
  ],
  [edgeKeywords],
)
let vault = ramVault()
let g = graph({
  storage: ram(vocab),
  vocab,
  plugins: [
    secrets(vault, (b) => g.apply(b, { trusted: true }), vocab),
    edges(vocab),
  ],
})
let ada = mint(), bob = mint(), app = mint(), shop = mint()
await g.apply(
  await install(g.read, [
    { name: 'texts', title: 'Texts', hosts: ['api.texts.example'] },
  ]),
  { trusted: true },
)
let sent: string[] = []
let c: Ctx = {
  graph: g,
  vault,
  fetch: (input, init) => {
    let h = new Headers(init?.headers)
    sent.push(`${init?.method} ${input} ${h.get('authorization')}`)
    return Promise.resolve(Response.json({ ok: 1 }, {
      headers: { 'set-cookie': 'a=b', 'x-seen': 'yes' },
    }))
  },
}
// A connection `owner` holds through `integration`, connected with a key.
let held = async (owner: string, integration = 'texts') => {
  let [made] = await g.apply(await need(g.read, { owner, integration }))
  await connect(c, made.entity.eid, { key: `key-of-${owner}` })
  return made.entity.eid
}
let texts = await held(ada), bobs = await held(bob)
let server = mint()
await g.apply([{
  entity: { eid: server },
  mcp_server: { owner: ada, name: 'tasks', url: 'https://tasks.example/mcp' },
}])
await g.apply(
  await publishService(g.read, { app: shop, owner: bob, listed: true }),
)
let service = await held(ada, `app-${shop}`)
await g.apply(
  await need(g.read, {
    owner: ada,
    app,
    integration: `app-${shop}`,
    each: true,
  }),
)

test('a grant is a link from the app to a source the person holds, read until it is revoked', async () => {
  let at = `mcp:${server}`
  assertEquals(await granted(g.read, { app, person: ada, at }), false)
  await g.apply(await grant(g.read, { app, person: ada, at }))
  assertEquals(await granted(g.read, { app, person: ada, at }), true)
  assertEquals(await granted(g.read, { app, person: bob, at }), false)
  await g.apply(revoke({ app, at }))
  assertEquals(await granted(g.read, { app, person: ada, at }), false)
})

test('a source names the apps granted it, never an app asking for a binding', async () => {
  let other = mint()
  await g.apply(
    await grant(g.read, { app: other, person: ada, at: `mcp:${server}` }),
  )
  let by = await grantees(g.read, [server, service])
  assertEquals(by.get(server), [other])
  assertEquals(by.get(service), [])
  await g.apply(revoke({ app: other, at: `mcp:${server}` }))
  assertEquals((await grantees(g.read, [server])).get(server), [])
})

test('only the person who holds a source grants it, at its own kind', async () => {
  for (
    let [person, at] of [
      [bob, `mcp:${server}`],
      [ada, `connection:${bobs}`],
      [ada, `connection:${server}`],
      [ada, `connection:${service}`],
    ]
  ) {
    await assertRejects(() => grant(g.read, { app, person, at }))
  }
})

test("an app's grants name each kind of source by its address", async () => {
  let other = mint()
  for (let at of [`mcp:${server}`, `connection:${texts}`]) {
    await g.apply(await grant(g.read, { app: other, person: ada, at }))
  }
  assertEquals((await grantsOf(g.read, { app: other, person: ada })).sort(), [
    `connection:${texts}`,
    `mcp:${server}`,
  ])
  assertEquals(await grantsOf(g.read, { app, person: ada }), [
    `service:${shop}/${app}`,
  ])
})

test('a person is offered their own sources of the kind asked for', async () => {
  let titles = async (at: string) =>
    (await grantable(g.read, ada, at)).map((s) => `${s.title}: ${s.about}`)
  assertEquals(await titles('mcp:'), ['tasks: https://tasks.example/mcp'])
  assertEquals(await titles('connection:'), [
    'Texts: requests to api.texts.example',
  ])
  assertEquals(await titles(`connection:${bobs}`), [])
})

test('a connection offers request to the owners a host names', async () => {
  let listed = await requests(g.read, [ada])
  assertEquals(listed.map((r) => [r.at, r.name]), [
    [`connection:${texts}`, 'request'],
  ])
  assertEquals(await requests(g.read, [ada], []), [])
  assertEquals((await requests(g.read, [ada, bob], [bobs])).length, 1)
})

test('request sends through the connection to its hosts alone, and answers without the credential', async () => {
  let ask = (url: string, owners = [ada], name = 'request') =>
    request(c, {
      at: `connection:${texts}`,
      owners,
      name,
      args: { url, method: 'post', body: { hi: 1 } },
    })
  sent.length = 0
  let out = await ask('https://api.texts.example/send')
  assertEquals(sent, [
    'POST https://api.texts.example/send Bearer key-of-' + ada,
  ])
  assertEquals(out.value.status, 200)
  assertEquals(out.value.body, '{"ok":1}')
  assertEquals(out.value.headers['x-seen'], 'yes')
  assertEquals('set-cookie' in out.value.headers, false)
  await assertRejects(() => ask('https://evil.example/send'))
  await assertRejects(() => ask('http://api.texts.example/send'))
  await assertRejects(() => ask('https://api.texts.example/send', [bob]))
  await assertRejects(() => ask('https://api.texts.example/send', [ada], 'x'))
  assertEquals(sent.length, 1)
})
