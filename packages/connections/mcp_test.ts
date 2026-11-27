import { line } from '@yaks/query'
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
  install,
  known,
  opens,
  pick,
} from '@yaks/connections'
import { ramVault, secrets, secretsDoc } from '@yaks/secrets'
import { provisionalDoc } from '@yaks/effects'
import { kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { edgeDoc } from '@yaks/edge'
import { mcpDoc } from '@yaks/mcp-client/vocab'
import { fixture } from '../../packages/mcp-client/testing.ts'
import { hostKey, remoteCommands, type Seat } from './mcp.ts'

let setup = async () => {
  let vocab = loadVocab([
    mcpDoc,
    connectionsDoc,
    secretsDoc,
    provisionalDoc,
    kernelDoc,
    provenanceDoc,
    edgeDoc,
    // The host's mark for what is in the trash, as yaks.app's directory has.
    {
      title: 'trash',
      $defs: {
        trashed: {
          component: true,
          type: 'object',
          properties: { at: { type: 'string' } },
        },
      },
    },
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
    // Everyone owns every space, unless a test seats them otherwise.
    seat: (_: string) => Promise.resolve<Seat>('owns'),
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
  let two = await remote.configure({
    name: 'Art',
    url: 'https://two.test/mcp',
  })
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
  let f = fixture(),
    remote = remoteCommands(person, host, { fetch: f.fetcher })
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
  // Its sign-in is what the service's own API is asked with, as a bearer.
  assertEquals(await hostKey(host, await remote.kept(), 'books.test'), {
    key: 'persons-token',
    header: null,
  })
  rejectCalls = true
  let needed = await remote.call(name, 'publish_mockup', { html: 'book' })
  assert(needed.value?.authorization)
  assertEquals(registrations, 1)
  assertEquals(f.calls.filter((c) => c.method == 'tools/call'), [])
  let [now] = await host.graph.read(
    line`.entity.eid=${held.entity.eid}&.connection`,
  )
  assertEquals((now.connection as { status: string }).status, 'broken')
  await disconnect(host, held.entity.eid)
  let stranger = remoteCommands(other, host, { fetch: fetcher })
  assertEquals(await stranger.list(), [])
  assertEquals((await remote.list())[0].name, 'sign_in')
  assertEquals(failures, [])
})

// A server that takes `key` in `header` (a bearer token where none is named),
// answers 401 to anything else, and names no sign-in.
let locked = (key: string, header?: string) => {
  let f = fixture()
  let fetcher: typeof fetch = (input, init) => {
    let req = new Request(input, init)
    if (new URL(req.url).pathname.startsWith('/.well-known/')) {
      return Promise.resolve(new Response(null, { status: 404 }))
    }
    let said = header
      ? req.headers.get(header)
      : req.headers.get('authorization')?.replace(/^Bearer /, '')
    if (req.method == 'POST' && said != key) {
      return Promise.resolve(new Response(null, { status: 401 }))
    }
    return f.fetcher(req)
  }
  return { ...f, fetcher }
}

for (
  let [label, header] of [['a bearer token', undefined], [
    'a header',
    'X-API-Key',
  ]]
) {
  test(`a server that takes a key in ${label} asks the person for it, and its calls carry it there alone`, async () => {
    let { host, person, failures } = await setup()
    let f = locked('k-1', header)
    let remote = remoteCommands(person, host, { fetch: f.fetcher })
    let made = await remote.configure({
      name: 'Keys',
      url: 'https://keys.test/mcp',
      ...header ? { header } : {},
    })
    assertEquals(made.commands.map((c) => c.name), ['sign_in'])
    assertStringIncludes(made.commands[0].description, 'Keys takes a key')
    let name = `mcp:${made.server}`
    assertEquals((await known(host.graph.read, name))?.token, undefined)
    assertEquals(
      ((await pick(host.graph.read, person, name))?.connection as {
        status: string
      }).status,
      'needed',
    )
    await remote.give(made.server, 'k-1')
    assertEquals((await remote.list()).map((c) => c.name), ['publish_mockup'])
    f.requests.length = 0
    let out = await remote.call(name, 'publish_mockup', { html: 'x' })
    assertStringIncludes(out.text, 'https://example.test/mockup/1')
    for (let r of f.requests) {
      assertEquals(
        r.headers.get(header ?? 'authorization'),
        header ? 'k-1' : 'Bearer k-1',
      )
      if (header) assertEquals(r.headers.has('authorization'), false)
    }
    assertEquals(failures, [])
  })
}

test('a credential is never sent in a header the transport owns', async () => {
  let { host, person } = await setup()
  let remote = remoteCommands(person, host, { fetch: fixture().fetcher })
  for (let header of ['Cookie', 'Host', 'Mcp-Session-Id', 'X Key']) {
    await assertRejects(
      () =>
        remote.configure({
          name: 'Keys',
          url: 'https://keys.test/mcp',
          header,
        }),
      Error,
      'MCP header',
    )
  }
})

test('a server removed goes to the trash with its tools, and comes back with its key', async () => {
  let { host, person } = await setup()
  let f = locked('k-1')
  let remote = remoteCommands(person, host, { fetch: f.fetcher })
  let { server } = await remote.configure({
    name: 'Keys',
    url: 'https://keys.test/mcp',
  })
  await remote.give(server, 'k-1')
  let at = `mcp:${server}`
  let keyOf = async (to: string) => hostKey(host, await remote.kept(), to)
  assertEquals(await keyOf('keys.test'), { key: 'k-1', header: null })
  assertEquals(await keyOf('elsewhere.test'), undefined)
  await remote.set(server, { header: 'X-API-Key' })
  assertEquals((await keyOf('keys.test'))?.header, 'X-API-Key')
  await remote.set(server, { header: null })
  await remote.remove(server)
  assertEquals(await keyOf('keys.test'), undefined)
  assertEquals(await remote.list(), [])
  await assertRejects(
    () => remote.call(at, 'publish_mockup', {}),
    Error,
    'not connected for you',
  )
  assertEquals((await remote.kept()).map((r) => !!r.trashed), [true])
  await remote.restore(server)
  assertEquals((await remote.list()).map((c) => c.name), ['publish_mockup'])
  // Connecting the same address again brings it back too.
  await remote.remove(server)
  let again = await remote.configure({
    name: 'Keys',
    url: 'https://keys.test/mcp',
  })
  assertEquals(again.server, server)
  assertEquals(again.commands.map((c) => c.name), ['publish_mockup'])
  // A server named as one in the trash keeps it there.
  await remote.remove(server)
  await remote.configure({ name: 'Keys', url: 'https://other.test/mcp' })
  await assertRejects(() => remote.restore(server), Error, 'rename one')
})

test("a server connected for everyone in a space reaches others there with its owner's key, and one for its owner alone reaches nobody else", async () => {
  let { host, person, other } = await setup()
  let f = locked('k-1', 'X-API-Key')
  let space = mint(), elsewhere = mint()
  let as = (who: string, at = space) =>
    remoteCommands(who, { ...host, space: at }, { fetch: f.fetcher })
  let shared = await as(person).configure({
    name: 'Team',
    url: 'https://team.test/mcp',
    header: 'X-API-Key',
  })
  await as(person).give(shared.server, 'k-1')
  let mine = await as(person).configure({
    name: 'Mine',
    url: 'https://mine.test/mcp',
    everyone: false,
  })
  let names = async (who: string, at = space) =>
    (await as(who, at).list()).map((t) => t.namespace).sort()
  assertEquals(await names(person), ['Mine', 'Team'])
  assertEquals(await names(other), ['Team'])
  assertEquals(await names(other, elsewhere), [])
  let out = await as(other).call(`mcp:${shared.server}`, 'publish_mockup', {
    html: 'x',
  })
  assertStringIncludes(out.text, 'https://example.test/mockup/1')
  await assertRejects(
    () => as(other).call(`mcp:${mine.server}`, 'publish_mockup', {}),
    Error,
    'not connected for you',
  )
  // Only the person who connected it changes it.
  await assertRejects(() => as(other).remove(shared.server), Error)
  await as(person).set(shared.server, { everyone: false })
  assertEquals(await names(other), [])
})

test('in a space, a person with no seat reaches no server, and one who only reads reaches only their own', async () => {
  let { host, person, other } = await setup()
  let f = fixture()
  let space = mint()
  // The caller sits in `seat`; whoever connected a server owns the space.
  let as = (who: string, seat: Seat = 'writes') =>
    remoteCommands(who, {
      ...host,
      space,
      seat: (p) => Promise.resolve(p == who ? seat : 'owns'),
    }, { fetch: f.fetcher })
  let shared = await as(person).configure({
    name: 'Team',
    url: 'https://team.test/mcp',
  })
  await as(other).configure({
    name: 'Mine',
    url: 'https://mine.test/mcp',
    everyone: false,
  })
  let names = async (who: string, seat: Seat) =>
    (await as(who, seat).list()).map((t) => t.namespace).sort()
  assertEquals(await names(other, 'writes'), ['Mine', 'Team'])
  assertEquals(await names(other, 'reads'), ['Mine'])
  assertEquals(await names(other, null), [])
  await assertRejects(
    () =>
      as(other, null).call(`mcp:${shared.server}`, 'publish_mockup', {
        html: 'from a stranger',
      }),
    Error,
    'not connected for you',
  )
  assertEquals(f.calls.filter((c) => c.method == 'tools/call'), [])
})

test('a server shared with everyone reaches nobody else once its connector owns the space no longer, and again once they do', async () => {
  let { g, host, person, other } = await setup()
  let f = fixture()
  let space = mint()
  let seats = new Map<string, Seat>([[person, 'owns'], [other, 'owns']])
  let as = (who: string) =>
    remoteCommands(who, {
      ...host,
      space,
      seat: (p) => Promise.resolve(seats.get(p) ?? null),
    }, { fetch: f.fetcher })
  let shared = await as(person).configure({
    name: 'Team',
    url: 'https://team.test/mcp',
  })
  await as(other).configure({
    name: 'Mine',
    url: 'https://mine.test/mcp',
    everyone: false,
  })
  let names = async (who: string) =>
    (await as(who).list()).map((t) => t.namespace).sort()
  let kept = () => g.read(line`.mcp_server.space=${space}&*`)
  let before = await kept()
  assertEquals(await names(other), ['Mine', 'Team'])
  for (let left of ['writes', 'reads', null] as Seat[]) {
    seats.set(person, left)
    assertEquals(await names(other), ['Mine'])
    await assertRejects(
      () =>
        as(other).call(`mcp:${shared.server}`, 'publish_mockup', { html: 'x' }),
      Error,
      'not connected for you',
    )
  }
  assertEquals(f.calls.filter((c) => c.method == 'tools/call'), [])
  // Demoted, the connector still reaches it as their own.
  seats.set(person, 'writes')
  assertEquals(await names(person), ['Team'])
  // Nothing they kept was changed, and owning the space again shares it.
  assertEquals(await kept(), before)
  seats.set(person, 'owns')
  assertEquals(await names(other), ['Mine', 'Team'])
})

// A server at `host` that takes a sign-in through its OAuth metadata, a key
// it names no sign-in for, or nothing, over the fixture's MCP.
let door = (kind: 'sign-in' | 'key' | 'open', host: string) => {
  let f = fixture()
  let fetcher: typeof fetch = async (input, init) => {
    let req = new Request(input, init), path = new URL(req.url).pathname
    if (path.startsWith('/.well-known/')) {
      if (kind != 'sign-in') return new Response(null, { status: 404 })
      return Response.json(
        path.includes('protected-resource')
          ? {
            resource: `https://${host}/mcp`,
            authorization_servers: ['https://login.test'],
          }
          : {
            issuer: 'https://login.test',
            authorization_endpoint: 'https://login.test/authorize',
            token_endpoint: 'https://login.test/token',
            registration_endpoint: 'https://login.test/register',
            response_types_supported: ['code'],
            code_challenge_methods_supported: ['S256'],
          },
      )
    }
    if (path == '/register') {
      return Response.json({ ...await req.json(), client_id: 'c-1' }, {
        status: 201,
      })
    }
    if (kind != 'open' && req.method == 'POST' && path == '/mcp') {
      return new Response(null, {
        status: 401,
        ...kind == 'sign-in'
          ? {
            headers: {
              'www-authenticate':
                `Bearer resource_metadata="https://${host}/.well-known/oauth-protected-resource"`,
            },
          }
          : {},
      })
    }
    return f.fetcher(req)
  }
  return { fetcher, requests: f.requests }
}

test('a server added by its address alone is named, and found to take a sign-in, a key or nothing', async () => {
  let { host, person, failures } = await setup()
  let space = mint()
  let at = (kind: 'sign-in' | 'key' | 'open', name: string) => {
    let d = door(kind, name)
    return {
      d,
      remote: remoteCommands(person, { ...host, space }, { fetch: d.fetcher }),
    }
  }
  let found = async (kind: 'sign-in' | 'key' | 'open', name: string) => {
    let { remote, d } = at(kind, name)
    let made = await remote.configure({ url: `https://${name}/mcp` })
    let [one] = await remote.shown(
      (await remote.kept()).filter((r) => r.entity.eid == made.server),
    )
    return { made, one, d }
  }
  let open = await found('open', 'mcp.open.test')
  let again = await found('open', 'mcp.again.test')
  let oauth = await found('sign-in', 'mcp.canva.test')
  let keyed = await found('key', 'keys.test')
  assertEquals(
    [open, again, oauth, keyed].map(({ made, one }) => [
      made.name,
      made.needs,
      one.everyone,
    ]),
    [
      ['mock', undefined, true],
      ['mock 2', undefined, true],
      ['canva.test', 'sign-in', false],
      ['keys.test', 'key', true],
    ],
  )
  assertEquals(oauth.made.commands.map((c) => c.name), ['sign_in'])
  assertEquals(failures.map(String), [])
  // No request leaves with a credential before the person gives one.
  assert(
    [oauth, keyed].every(({ d }) =>
      d.requests.every((r) => !r.headers.has('authorization'))
    ),
  )
  let { remote } = at('open', 'mcp.open.test')
  await remote.set(again.made.server, { name: 'Notes' })
  await assertRejects(
    () => remote.set(again.made.server, { name: 'mock' }),
    Error,
    'has the name mock',
  )
  let renamed = await remote.configure({ url: 'https://mcp.again.test/mcp' })
  assertEquals(renamed.name, 'Notes')
})

test("a server that takes only clients it knows signs in as the person's own, whose secret stays in the vault", async () => {
  let { g, host, person } = await setup()
  let d = door('sign-in', 'design.test')
  let registered = 0
  let fetcher: typeof fetch = (input, init) => {
    let req = new Request(input, init)
    if (new URL(req.url).pathname == '/register') registered++
    return d.fetcher(req)
  }
  let remote = remoteCommands(person, host, { fetch: fetcher })
  let made = await remote.configure({
    url: 'https://design.test/mcp',
    client_id: 'mine',
  })
  assertEquals([made.needs, registered], ['sign-in', 0])
  await remote.signsInAs(made.server, { id: 'mine', secret: 's3cret' })
  let [held] = await g.read(
    line`.connection.integration=${`mcp:${made.server}`}&*`,
  )
  let { url } = await begin(host, held.entity.eid)
  assertEquals(new URL(url).searchParams.get('client_id'), 'mine')
  let rows = JSON.stringify(await g.read(line`*`))
  assert(!rows.includes('s3cret'))
})

test('a server whose sign-in page fails for the person’s client says so, and names the service’s built integration', async () => {
  let { g, host, person } = await setup()
  await g.apply(
    await install(g.read, [{
      name: 'design',
      title: 'Design',
      site: 'https://www.design.test',
      authorize: 'https://www.design.test/oauth/authorize',
      token: 'https://api.design.test/token',
      hosts: ['api.design.test'],
    }]),
    { trusted: true },
  )
  let d = door('sign-in', 'mcp.design.test')
  // The server's own login answers 500 to any client it does not list.
  let fetcher: typeof fetch = (input, init) => {
    let req = new Request(input, init)
    return new URL(req.url).pathname == '/authorize'
      ? Promise.resolve(new Response('Internal Server Error', { status: 500 }))
      : d.fetcher(req)
  }
  let remote = remoteCommands(person, host, { fetch: fetcher })
  let made = await remote.configure({
    name: 'Design',
    url: 'https://mcp.design.test/mcp',
    client_id: 'mine',
  })
  await remote.signsInAs(made.server, { id: 'mine', secret: 's' })
  let [held] = await g.read(
    line`.connection.integration=${`mcp:${made.server}`}&*`,
  )
  let { url } = await begin(host, held.entity.eid)
  let e = await assertRejects(() =>
    opens({ ...host, fetch: fetcher }, held.entity.eid, url)
  )
  assertStringIncludes(String(e), 'login.test answers 500')
  assertStringIncludes(String(e), 'Design in the list of services')
})
