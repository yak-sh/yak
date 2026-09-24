// Connections over a graph in memory with a vault in memory: what a need makes,
// where a key and a grant go, what an app is handed, and what a disconnect or a
// deleted owner leaves behind.

import { assert, assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { edgeDoc, edgeKeywords, edges } from '@yaks/edge'
import {
  isHandle,
  ramVault,
  reveal,
  sealing,
  secretEid,
  secrets,
  secretsDoc,
  sentinelOf,
} from '@yaks/secrets'
import { effects } from '@yaks/effects'
import {
  begin,
  connect,
  connectionsDoc,
  type Ctx,
  disconnect,
  type Integration,
  integrationEid,
  list,
  need,
  refresh,
  resolve,
} from './mod.ts'
import { runs } from './tools.ts'

let here: VocabDoc = {
  $defs: {
    entity: {
      component: true,
      type: 'object',
      wire: false,
      properties: { num: { type: 'number', stamped: true } },
    },
    space: { component: true, type: 'object', properties: {} },
    app: { component: true, type: 'object', properties: {} },
  },
}

let CALENDAR: Integration = {
  name: 'calendar',
  authorize: 'https://auth.example/authorize',
  token: 'https://auth.example/token',
  scopes: ['events'],
  hosts: ['api.example'],
}
let TEXTS: Integration = { name: 'texts', hosts: ['api.texts.example'] }
let BUILT = { calendar: CALENDAR, texts: TEXTS }
let REDIRECT = 'https://yourname.yaks.app/_yaks/connections/back'
let NOW = 1_000_000

let vocab = loadVocab(
  [here, edgeDoc, secretsDoc, connectionsDoc],
  [edgeKeywords],
)

// A token endpoint answering each request with the next scripted reply, as
// little of a Response as the OAuth client reads.
let endpoint = (...replies: [number, unknown][]) => {
  let seen: URLSearchParams[] = []
  let fetch = (_: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new URLSearchParams(String(init?.body)))
    let [status, body] = replies.shift() ?? [500, {}]
    let ok = status >= 200 && status < 300
    return Promise.resolve({ ok, status, json: () => Promise.resolve(body) })
  }
  return { fetch: fetch as unknown as typeof globalThis.fetch, seen }
}

let setup = async (...replies: [number, unknown][]) => {
  let vault = ramVault()
  let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [secrets(vault), edges(vocab), fx],
  })
  fx.on('secret', sealing(vault))
  await g.apply([
    { entity: { eid: 'space' }, space: {} },
    { entity: { eid: 'app' }, app: {} },
    { entity: { eid: 'other' }, app: {} },
  ])
  let e = endpoint(...replies)
  let c: Ctx = {
    graph: g,
    vault,
    built: BUILT,
    client: (i) =>
      i.name == 'calendar' ? { id: 'yaks', secret: 's' } : undefined,
    redirect: REDIRECT,
    fetch: e.fetch,
    now: () => NOW,
  }
  // Make what `need` asks for, and answer the connection it made.
  let needs = async (asked: Partial<Parameters<typeof need>[1]> = {}) => {
    let made = await g.apply(
      await need(g.read, {
        owner: 'space',
        app: 'app',
        integration: 'calendar',
        ...asked,
      }, BUILT),
    )
    return made.find((b) => b.connection)!.entity.eid
  }
  return { g, vault, c, needs, seen: e.seen }
}

// A test over the 1ms budget runs with the heavy tier, under TASKS_SLOW.
let slow = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, fn, ignore: !Deno.env.get('TASKS_SLOW') })

let at = async (g: { read: Ctx['graph']['read'] }, eid: string) =>
  (await g.read(`.eid=${eid}`))[0] as Bundle | undefined

let of = (b: Bundle | undefined, name: string) => (b?.[name] ?? {}) as Comp

// The first graph a process writes through these plugins, its first HMAC and
// digest, and the first URL it parses cost their start-up once (about 10ms);
// paid here, so no test is charged for it.
let warm = await setup()
await connect(warm.c, await warm.needs({ integration: 'texts' }), { key: 'k' })
await sentinelOf(warm.vault, 'none')
await crypto.subtle.digest('SHA-256', new Uint8Array())
new URL('https://warm.example/?a=b').searchParams.set('c', 'd')

slow(
  'need: a connection with no credential, linked from the app, and asked again is the same one',
  async () => {
    let { g, c, needs } = await setup()
    let eid = await needs({ scopes: ['events.read'] })
    let b = await at(g, eid)
    assertEquals(of(b, 'connection'), {
      integration: 'calendar',
      owner: 'space',
      scopes: ['events.read'],
      status: 'needed',
    })
    assertEquals(of(b, 'secret').value, undefined)
    assertEquals(await resolve(c, 'app', 'calendar'), undefined)
    let again = await need(g.read, {
      owner: 'space',
      app: 'app',
      integration: 'calendar',
    }, BUILT)
    assertEquals(again, [{ entity: { eid } }])
    await g.apply(again)
    assertEquals((await g.read('.connection')).length, 1)
  },
)

slow(
  'need: a key for an unbuilt service names its hosts, which no later need may change',
  async () => {
    let { g, needs } = await setup()
    await needs({ integration: 'weather', hosts: ['api.weather.example'] })
    assertEquals(of(await at(g, integrationEid('weather')), 'integration'), {
      name: 'weather',
      hosts: ['api.weather.example'],
    })
    await needs({
      app: 'other',
      integration: 'weather',
      hosts: ['api.weather.example'],
    })
    for (
      let asked of [
        { app: 'other', integration: 'weather', hosts: ['evil.example'] },
        { integration: 'calendar', hosts: ['evil.example'] },
        { integration: 'nothing' },
      ]
    ) {
      await assertRejects(() =>
        need(g.read, { owner: 'space', app: 'app', ...asked }, BUILT)
      )
    }
  },
)

slow(
  'connect: a pasted key goes to the vault, and the app is handed its sentinel',
  async () => {
    let { g, vault, c, needs } = await setup()
    let eid = await needs({ integration: 'texts' })
    await connect(c, eid, { key: 'sk-live' }, 'shop@example.com')
    let b = await at(g, eid)
    let name = String(of(b, 'secret').name)
    assert(isHandle(String(of(b, 'secret').value)))
    assertEquals(of(b, 'connection').status, 'connected')
    assertEquals(of(b, 'connection').account, 'shop@example.com')
    assertEquals(await reveal(vault, name), 'sk-live')
    assertEquals(await resolve(c, 'app', 'texts'), {
      connection: b!,
      link: (await g.read('.uses'))[0],
      sentinel: (await sentinelOf(vault, name))!,
    })
    let signs = await needs()
    await assertRejects(() => connect(c, signs, { key: 'k' }))
    await assertRejects(() => begin(c, eid))
  },
)

slow(
  'begin and connect: a sign-in keeps its grant behind the connection’s own handle',
  async () => {
    let { g, vault, c, needs, seen } = await setup([200, {
      access_token: 'A1',
      refresh_token: 'R1',
      expires_in: 3600,
    }])
    let eid = await needs({ scopes: ['events.read'] })
    let { url, attempt } = await begin(c, eid)
    assertEquals(new URL(url).searchParams.get('scope'), 'events.read')
    await connect(c, eid, {
      attempt,
      callback: `${REDIRECT}?code=C&state=${attempt.state}`,
    })
    let b = await at(g, eid)
    assertEquals(seen[0].get('code'), 'C')
    assertEquals(of(b, 'connection').status, 'connected')
    assertEquals(
      JSON.parse((await reveal(vault, String(of(b, 'secret').name)))!),
      { access_token: 'A1', refresh_token: 'R1', expires_at: NOW + 3_600_000 },
    )
  },
)

slow(
  'refresh: a new token behind the same handle; a refused grant is broken, a failed wire is not',
  async () => {
    let { g, c, needs } = await setup(
      [200, { access_token: 'A2' }],
      [502, 'oops'],
      [400, { error: 'invalid_grant' }],
    )
    let eid = await needs()
    let name = String(of(await at(g, eid), 'secret').name)
    await g.apply([{
      entity: { eid: secretEid(name) },
      secret: { name, value: '{"access_token":"A1","refresh_token":"R1"}' },
    }])
    let handle = of(await at(g, eid), 'secret').value
    assertEquals(await refresh(c, eid, 'A1'), 'A2')
    assertEquals(of(await at(g, eid), 'secret').value, handle)
    await assertRejects(() => refresh(c, eid, 'A2'))
    assertEquals(of(await at(g, eid), 'connection').status, 'needed')
    await assertRejects(() => refresh(c, eid, 'A2'))
    assertEquals(of(await at(g, eid), 'connection').status, 'broken')
  },
)

slow(
  'disconnect: the credential is forgotten, and an app that used it needs a new one',
  async () => {
    let { g, vault, c, needs } = await setup()
    let used = await needs({ integration: 'texts' })
    await connect(c, used, { key: 'sk-live' })
    await disconnect(c, used)
    assertEquals(await at(g, used), undefined)
    assertEquals(vault.all(), [])
    let [now] = await g.read('.connection')
    assertEquals(of(now, 'connection').status, 'needed')
    assertEquals(
      (await list(g.read, 'space')).map((b) => b.edge ?? b.connection),
      [
        of(now, 'connection'),
        { from: 'app', to: now.entity.eid },
      ],
    )
    let alone = await needs({ app: undefined, integration: 'texts' })
    await disconnect(c, alone)
    assertEquals((await g.read('.connection')).length, 1)
  },
)

Deno.test('a deleted owner takes its connections, and their credentials', async () => {
  let { g, vault, c, needs } = await setup()
  await connect(c, await needs({ integration: 'texts' }), { key: 'sk-live' })
  await g.apply([{ entity: { eid: 'space' }, tombstone: {} }])
  assertEquals(await g.read('.connection'), [])
  assertEquals(vault.all(), [])
})

slow(
  'the tools: need writes nothing secret, and list answers the owner’s',
  async () => {
    let { g } = await setup()
    let run = Object.fromEntries(
      loadTools([connectionsDoc], runs()).map((t) => [t.name, t.run]),
    )
    let ctx = (args: Record<string, unknown>) => ({
      graph: g,
      actor: null,
      read: g.read,
      args,
      call: 'call',
    })
    let made = await run.connection_need(
      [],
      ctx({ app: 'app', owner: 'space', integration: 'weather', hosts: ['h'] }),
    )
    await g.apply(made)
    let listed = await run.connection_list([], ctx({ owner: 'space' }))
    assertEquals(listed.map((b) => Object.keys(b.connection ?? b.edge ?? {})), [
      ['integration', 'owner', 'status'],
      ['from', 'to'],
    ])
    assertEquals(await run.connection_list([], ctx({ owner: 'app' })), [])
  },
)
