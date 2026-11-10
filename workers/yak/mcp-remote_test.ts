import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { type Bundle, graph, mint } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import {
  begin,
  connect,
  connectionsDoc,
  disconnect,
  known,
  pick,
} from '@yaks/connections'
import { ramVault, secrets, secretsDoc } from '@yaks/secrets'
import { provisionalDoc } from '@yaks/effects'
import { kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { edgeDoc } from '@yaks/edge'
import { mcpDoc } from '@yaks/mcp-client/vocab'
import { fixture } from '../../packages/mcp-client/testing.ts'
import { remoteCommands } from './mcp-remote.ts'

let setup = async () => {
  let vocab = loadVocab([
    mcpDoc,
    connectionsDoc,
    secretsDoc,
    provisionalDoc,
    kernelDoc,
    provenanceDoc,
    edgeDoc,
  ])
  let vault = ramVault(), person = mint(), other = mint()
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [
      secrets(vault, (rows) => g.apply(rows, { trusted: true }), vocab),
    ],
  })
  let graphHost = {
    read: g.read,
    apply: (rows: Bundle[]) => g.apply(rows, { trusted: true }),
  }
  let failures: unknown[] = []
  let host = {
    graph: graphHost,
    vault,
    redirect: 'https://yaks.test/connections/callback',
    signIn: 'https://yaks.test/manage/connections',
    report: (e: unknown) => {
      failures.push(e)
    },
  }
  await g.apply([{ entity: { eid: person } }, { entity: { eid: other } }])
  return { g, host, person, other, failures }
}

test('connected MCP discovery and dispatch retain exact schemas, names and structured replies', async () => {
  let { host, person, other } = await setup()
  let f = fixture()
  let remote = remoteCommands(person, host, { fetch: f.fetcher })
  let one = await remote.configure({
    name: 'Books: Print',
    url: 'https://one.test/mcp',
  })
  let two = await remote.configure({ name: 'Art', url: 'https://two.test/mcp' })
  let all = await remote.list()
  assertEquals(all.map((t) => [t.at, t.name]), [
    [`mcp:${one.server}`, 'publish_mockup'],
    [`mcp:${two.server}`, 'publish_mockup'],
  ])
  assertEquals(all[0].namespace, 'Books_Print')
  assertEquals(all[0].input, {
    type: 'object',
    properties: { html: { type: 'string' } },
    required: ['html'],
  })
  let result = await remote.call(`mcp:${two.server}`, 'publish_mockup', {
    html: '<h1>Book</h1>',
  })
  assertEquals(result.value?.structuredContent, { saved: '<h1>Book</h1>' })
  assertStringIncludes(result.text, 'https://example.test/mockup/1')
  assertEquals(
    f.calls.filter((c) => c.method == 'tools/call').map((c) => c.params),
    [{
      name: 'publish_mockup',
      arguments: { html: '<h1>Book</h1>' },
    }],
  )
  let stranger = remoteCommands(other, host, { fetch: f.fetcher })
  assertEquals(await stranger.list(), [])
  await assertRejects(
    () => stranger.call(`mcp:${one.server}`, 'publish_mockup', {}),
    Error,
    'not connected for you',
  )
})

test('configuration is idempotent, namespace collisions are visible and removing access stops calls', async () => {
  let { g, host, person } = await setup()
  let f = fixture(), remote = remoteCommands(person, host, { fetch: f.fetcher })
  let one = await remote.configure({
    name: 'Books',
    url: 'https://one.test/mcp',
  })
  let again = await remote.configure({
    name: 'Books',
    url: 'https://one.test/mcp',
  })
  assertEquals(one.server, again.server)
  await assertRejects(
    () => remote.configure({ name: 'Books', url: 'https://two.test/mcp' }),
    Error,
    'Duplicate MCP namespace',
  )
  await remote.configure({
    name: 'Books',
    url: 'https://one.test/mcp',
    allow: [],
  })
  assertEquals(await remote.list(), [])
  await assertRejects(
    () => remote.call(`mcp:${one.server}`, 'publish_mockup', {}),
    Error,
    'no command',
  )
  await remote.configure({
    name: 'Books',
    url: 'https://one.test/mcp',
    enabled: false,
  })
  assertEquals(await remote.list(), [])
  await assertRejects(
    () => remote.call(`mcp:${one.server}`, 'publish_mockup', {}),
    Error,
    'not connected for you',
  )
  await g.apply([{ entity: { eid: one.server }, $delete: true }])
  assertEquals(await remote.list(), [])
  assertEquals(f.calls.filter((c) => c.method == 'tools/call'), [])
})

test('an unavailable MCP server is reported without blocking another server and recovers on the next call', async () => {
  let { host, person, failures } = await setup()
  let f = fixture(), down = true
  let fetcher: typeof fetch = (input, init) => {
    let req = new Request(input, init)
    return req.url.startsWith('https://down.test/') && down
      ? Promise.resolve(new Response(null, { status: 503 }))
      : f.fetcher(req)
  }
  let remote = remoteCommands(person, host, { fetch: fetcher })
  let failed = await remote.configure({
    name: 'Down',
    url: 'https://down.test/mcp',
  })
  await remote.configure({ name: 'Books', url: 'https://books.test/mcp' })
  assertEquals((await remote.list()).map((t) => t.name), [
    'connection_status',
    'publish_mockup',
  ])
  assert(failures.length > 0)
  down = false
  let checked = await remote.call(
    `mcp:${failed.server}`,
    'connection_status',
    {},
  )
  assertEquals(
    (checked.value?.commands as { name: string }[])[0].name,
    'publish_mockup',
  )
})

test('a server on a machine is asked through the tunnel its host answers, with no sign-in', async () => {
  let { host, person, failures } = await setup()
  let f = fixture(), space = mint(), mine = true, up = true
  // A machine that is off is asked for a sign-in by nobody, whatever answers.
  let off = () =>
    Promise.resolve(
      new Response(null, {
        status: 401,
        headers: { 'www-authenticate': 'Bearer resource_metadata="/x"' },
      }),
    )
  let machine = (at: string) =>
    Promise.resolve(mine && at == space ? up ? f.fetcher : off : null)
  let elsewhere: string[] = []
  let remote = remoteCommands(person, { ...host, machine }, {
    fetch: (input) => {
      elsewhere.push(String(input))
      return Promise.resolve(new Response(null, { status: 404 }))
    },
  })
  let tasks = { name: 'tasks', url: '/mcp', machine: space }
  await assertRejects(
    () => remote.configure({ ...tasks, url: 'https://box.test/mcp' }),
    Error,
    'its path there',
  )
  let made = await remote.configure({ ...tasks, allow: ['publish_mockup'] })
  assertEquals((await remote.configure(tasks)).server, made.server)
  assertEquals(made.commands.map((c) => c.name), ['publish_mockup'])
  let at = `mcp:${made.server}`
  let out = await remote.call(at, 'publish_mockup', { html: 'x' })
  assertEquals(out.value?.structuredContent, { saved: 'x' })
  assertEquals([...new Set(f.requests.map((r) => r.url))], [
    'http://machine/mcp',
  ])
  assertEquals(f.requests.some((r) => r.headers.has('authorization')), false)
  up = false
  assertEquals((await remote.list()).map((c) => c.name), ['connection_status'])
  assertEquals((await remote.call(at, 'connection_status', {})).value, {
    unavailable: true,
  })
  await assertRejects(
    () => remote.call(at, 'publish_mockup', {}),
    Error,
    'the machine may be off',
  )
  assertEquals(elsewhere, [])
  assertEquals(await host.graph.read('.integration|.connection'), [])
  assertEquals(failures, [])
  mine = false
  assertEquals(await remote.list(), [])
  await assertRejects(
    () => remote.call(at, 'publish_mockup', {}),
    Error,
    'not connected for you',
  )
  await assertRejects(() => remote.configure(tasks), Error, 'Only the owner')
})

test('ambiguous exposed MCP names leave both connections visible without choosing one', async () => {
  let { host, person, failures } = await setup()
  let f = fixture()
  let fetcher: typeof fetch = async (input, init) => {
    let req = new Request(input, init)
    let body = req.method == 'POST' ? await req.clone().json() : null
    let reply = await f.fetcher(req)
    if (body?.method != 'tools/list') return reply
    let value = await reply.json()
    value.result.tools[0].name = new URL(req.url).hostname == 'one.test'
      ? 'b__c'
      : 'c'
    return Response.json(value, { headers: reply.headers })
  }
  let remote = remoteCommands(person, host, { fetch: fetcher })
  await remote.configure({ name: 'a', url: 'https://one.test/mcp' })
  await remote.configure({ name: 'a__b', url: 'https://two.test/mcp' })
  assertEquals((await remote.list()).map((c) => [c.namespace, c.name]), [
    ['a', 'connection_status'],
    ['a__b', 'connection_status'],
  ])
  assertStringIncludes(String(failures[0]), 'Duplicate MCP tool name')
  assertEquals(f.calls.filter((c) => c.method == 'tools/call'), [])
})

test('MCP OAuth asks for the current person to sign in once and revoked grants never borrow credentials', async () => {
  let { host, person, other, failures } = await setup()
  let f = fixture(), registrations = 0, rejectCalls = false
  let fetcher: typeof fetch = async (input, init) => {
    let req = new Request(input, init), path = new URL(req.url).pathname
    if (path.startsWith('/.well-known/oauth-protected-resource')) {
      return Response.json({
        resource: 'https://books.test/mcp',
        authorization_servers: ['https://login.test'],
      })
    }
    if (path.startsWith('/.well-known/')) {
      return Response.json({
        issuer: 'https://login.test',
        authorization_endpoint: 'https://login.test/authorize',
        token_endpoint: 'https://login.test/token',
        registration_endpoint: 'https://login.test/register',
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
      })
    }
    if (path == '/register') {
      registrations++
      return Response.json(
        { ...await req.json(), client_id: 'public-client' },
        { status: 201 },
      )
    }
    if (path == '/token') {
      return Response.json({
        access_token: 'persons-token',
        token_type: 'Bearer',
        expires_in: 3600,
      })
    }
    if (req.method == 'POST' && path == '/mcp') {
      let body = await req.clone().json()
      if (
        !req.headers.has('authorization') ||
        (rejectCalls && body.method == 'tools/call')
      ) {
        return new Response(null, {
          status: 401,
          headers: {
            'www-authenticate':
              'Bearer resource_metadata="https://books.test/.well-known/oauth-protected-resource"',
          },
        })
      }
    }
    return f.fetcher(req)
  }
  let authHost = { ...host, fetch: fetcher }
  let remote = remoteCommands(person, authHost, { fetch: fetcher })
  let configured = await remote.configure({
    name: 'Books',
    url: 'https://books.test/mcp',
  })
  assertEquals(failures.map(String), [])
  assertEquals(configured.commands[0].name, 'sign_in')
  assertStringIncludes(
    configured.commands[0].description,
    'https://yaks.test/manage/connections#',
  )
  assertEquals(registrations, 1)
  let name = `mcp:${configured.server}`
  await remote.configure({
    name: 'Books',
    url: 'https://books.test/mcp',
    client_id: 'replacement-client',
  })
  assertEquals(
    (await known(host.graph.read, name))?.client_id,
    'replacement-client',
  )
  assertEquals(registrations, 1)
  let held = (await pick(host.graph.read, person, name))!
  assert(held)
  let { attempt } = await begin(authHost, held.entity.eid)
  await connect(authHost, held.entity.eid, {
    attempt: attempt!,
    callback: `${host.redirect}?state=${attempt!.state}&code=granted`,
  })
  assertEquals((await remote.list())[0].name, 'publish_mockup')
  rejectCalls = true
  let needed = await remote.call(name, 'publish_mockup', { html: 'book' })
  assert(needed.value?.authorization)
  assertEquals(registrations, 1)
  assertEquals(f.calls.filter((c) => c.method == 'tools/call'), [])
  let [now] = await host.graph.read(
    `.entity.eid=${held.entity.eid}&.connection`,
  )
  assertEquals((now.connection as { status: string }).status, 'broken')
  await disconnect(host, held.entity.eid)
  let stranger = remoteCommands(other, host, { fetch: fetcher })
  assertEquals(await stranger.list(), [])
  assertEquals((await remote.list())[0].name, 'sign_in')
  assertEquals(failures, [])
})
