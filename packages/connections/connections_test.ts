// Connections over a graph in memory with a vault in memory: what a need makes,
// where a key and a grant go, what an app is handed, and what a disconnect or a
// deleted owner leaves behind.

import { test } from '@yaks/testing'
import { kernelDoc } from '@yaks/kernel'
import { provenanceDoc } from '@yaks/provenance'
import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  type Bundle,
  type Comp,
  graph,
  Refused,
  Stale,
  token,
} from '@yaks/graph'
import { loadTools } from '@yaks/graph/tools'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { provisionalDoc } from '@yaks/effects'
import { edgeDoc, edgeEid, edgeKeywords, edges } from '@yaks/edge'
import {
  isHandle,
  ramVault,
  reveal,
  secretEid,
  secrets,
  secretsDoc,
  sentinelOf,
} from '@yaks/secrets'
import {
  AccountError,
  accountOf,
  attach,
  begin,
  borrowed,
  carry,
  clientOf,
  connect,
  connectionsDoc,
  credential,
  type Ctx,
  disconnect,
  envOf,
  install,
  installed,
  type Integration,
  integrationEid,
  known,
  lend,
  list,
  listing,
  need,
  pick,
  recall,
  refresh,
  registration,
  resolve,
  set,
  through,
  using,
} from './mod.ts'
import { reply } from './graph.ts'
import { runs } from './tools.ts'
import { CallError } from '@yaks/tools/errors'

let here: VocabDoc = {
  $defs: {
    space: { component: true, type: 'object', properties: {} },
    app: { component: true, type: 'object', properties: {} },
  },
}

let CALENDAR: Integration = {
  name: 'calendar',
  authorize: 'https://auth.example/authorize',
  token: 'https://auth.example/token',
  scopes: ['events'],
  client: 'example',
  hosts: ['api.example'],
}
let TEXTS: Integration = { name: 'texts', hosts: ['api.texts.example'] }
let REDIRECT = 'https://yourname.yaks.app/_yaks/connections/back'
let NOW = 1_000_000

// A credential on its way to the vault wears @yaks/effects' `provisional`.
let vocab = loadVocab(
  [
    kernelDoc,
    provenanceDoc,
    here,
    edgeDoc,
    secretsDoc,
    provisionalDoc,
    connectionsDoc,
  ],
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
  let g = graph({
    storage: ram(vocab),
    vocab,
    plugins: [
      secrets(vault, (b) => g.apply(b, { trusted: true })),
      edges(vocab),
    ],
  })
  await g.apply([
    { entity: { eid: 'space' }, space: {} },
    { entity: { eid: 'app' }, app: {} },
    { entity: { eid: 'other' }, app: {} },
    { entity: { eid: 'ann' }, space: {} },
    { entity: { eid: 'bob' }, space: {} },
    registration('example', { id: 'yaks', secret: 's' }),
  ])
  // This package's own built integrations, and two more of the test's.
  for (let seeds of [undefined, [CALENDAR, TEXTS]]) {
    await g.apply(await install(g.read, seeds), { trusted: true })
  }
  let e = endpoint(...replies)
  let c: Ctx = {
    graph: g,
    vault,
    redirect: REDIRECT,
    fetch: e.fetch,
    now: () => NOW,
  }
  // Make what `need` asks for, and answer the connection it made or answered
  // with, which comes first.
  let needs = async (asked: Partial<Parameters<typeof need>[1]> = {}) => {
    let made = await g.apply(
      await need(g.read, {
        owner: 'space',
        app: 'app',
        integration: 'calendar',
        ...asked,
      }),
    )
    return made[0].entity.eid
  }
  return { g, vault, c, needs, seen: e.seen }
}

test('a space owner can attach a connected account in place of an unmet ask', async () => {
  let { g, c, needs, vault } = await setup()
  let connected = await needs({ app: undefined, integration: 'texts' })
  await connect(c, connected, { key: 'private-key' })
  let waiting = await needs({ integration: 'texts', binding: 'SMS' })
  assertEquals(
    (await attach(g.read, {
      owner: 'space',
      app: 'app',
      connection: connected,
    })).length,
    4,
  )
  await g.apply(
    await attach(g.read, {
      owner: 'space',
      app: 'app',
      connection: connected,
    }),
  )
  assertEquals(
    await using(g.read, {
      app: 'app',
      integration: 'texts',
    }).then((b) => b?.entity.eid),
    connected,
  )
  assertEquals(await g.read(`.entity.eid=${waiting}&.connection`), [])
  let [link] = await g.read('.edge.from=app&.uses&*')
  assertEquals(of(link, 'uses'), { binding: 'SMS' })
  assertEquals(
    await attach(g.read, {
      owner: 'space',
      app: 'app',
      connection: connected,
    }),
    [],
  )
  let sent = await envOf(c, 'app')
  assert(sent.SMS && sent.SMS != 'private-key')
  await g.apply(
    await attach(g.read, {
      owner: 'space',
      app: 'app',
      connection: connected,
      binding: 'TEXTS_KEY',
    }),
  )
  assertEquals(Object.keys(await envOf(c, 'app')), ['TEXTS_KEY'])
  assertEquals(
    await reveal(vault, String(of(await at(g, connected), 'secret').name)),
    'private-key',
  )
})

test('attachment requires the space connection and sufficient OAuth scopes', async () => {
  let { g, needs } = await setup()
  let connected = await needs({ app: undefined, scopes: ['events'] })
  await g.apply([{
    entity: { eid: connected },
    connection: { status: 'connected' },
  }])
  await assertRejects(() =>
    attach(g.read, {
      owner: 'ann',
      app: 'app',
      connection: connected,
    })
  )
  await needs({ scopes: ['events', 'contacts'] })
  await assertRejects(() =>
    attach(g.read, {
      owner: 'space',
      app: 'app',
      connection: connected,
    })
  )
})

test('attachment does not turn a direct-key request into an implicit grant', async () => {
  let { g, c, needs } = await setup()
  let connected = await needs({ app: undefined, integration: 'texts' })
  await connect(c, connected, { key: 'private-key' })
  await needs({ integration: 'texts', direct: true })
  await assertRejects(() =>
    attach(g.read, {
      owner: 'space',
      app: 'app',
      connection: connected,
    })
  )
  assertEquals(await envOf(c, 'app'), {})
})

let at = async (g: { read: Ctx['graph']['read'] }, eid: string) =>
  (await g.read(`.entity.eid=${eid}`))[0] as Bundle | undefined

let of = (b: Bundle | undefined, name: string) => (b?.[name] ?? {}) as Comp

// The names a vault keeps secrets under; the setup's OAuth client is always one.
let kept = (vault: ReturnType<typeof ramVault>) =>
  vault.all().map(([, s]) => s.name)
let CLIENTS = ['oauth_client example']

// The first graph a process writes through these plugins, its first HMAC and
// digest, and the first URL it parses cost their start-up once (about 10ms);
// paid here, so no test is charged for it.
let warm = await setup()
await connect(warm.c, await warm.needs({ integration: 'texts' }), { key: 'k' })
await sentinelOf(warm.vault, 'none')
await crypto.subtle.digest('SHA-256', new Uint8Array())
new URL('https://warm.example/?a=b').searchParams.set('c', 'd')

test(
  'install: each built integration whole and marked built, and nothing once all match',
  async () => {
    let { g } = await setup()
    let or = integrationEid('openrouter')
    assertEquals((await known(g.read, 'openrouter'))?.title, 'OpenRouter')
    assertEquals(await install(g.read), [])
    // Held otherwise: written whole again, and what the seed does not name is
    // cleared.
    await g.apply([{
      entity: { eid: or },
      integration: { hosts: ['evil.example'], issuer: 'https://evil.example' },
    }])
    await g.apply(await install(g.read), { trusted: true })
    let i = await known(g.read, 'openrouter')
    assertEquals([i?.hosts, i?.issuer ?? null, i?.built], [
      ['openrouter.ai'],
      null,
      true,
    ])
    let names = (await installed(g.read)).map((i) => i.name)
    assert(names.includes('openrouter'))
    assert(names.includes('calendar'))
    assert(names.includes('texts'))
  },
)

test(
  'only the host marks an integration built, and need never writes over one',
  async () => {
    let { g } = await setup()
    await assertRejects(
      async () =>
        await g.apply([{
          entity: { eid: integrationEid('mine') },
          integration: {
            name: 'mine',
            hosts: ['api.mine.example'],
            built: true,
          },
        }]),
      Refused,
      'integration.built is server-owned',
    )
    assertEquals(await known(g.read, 'mine'), undefined)
    let asked = await need(g.read, {
      owner: 'space',
      integration: 'late',
      hosts: ['api.late.example'],
    })
    await g.apply([{
      entity: { eid: integrationEid('late') },
      integration: { name: 'late', hosts: ['elsewhere.example'] },
    }])
    await assertRejects(async () => await g.apply(asked), Stale)
    assertEquals((await known(g.read, 'late'))?.hosts, ['elsewhere.example'])
  },
)

test(
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
    })
    assertEquals(again, [{
      entity: { eid },
      connection: { integration: 'calendar' },
    }])
    await g.apply(again)
    assertEquals((await g.read('.connection')).length, 1)
  },
)

test(
  'need: a key for an unbuilt service names its hosts, which no later need may change',
  async () => {
    let { g, needs } = await setup()
    await needs({ integration: 'weather', hosts: ['api.weather.example'] })
    assertEquals(of(await at(g, integrationEid('weather')), 'integration'), {
      name: 'weather',
      hosts: ['api.weather.example'],
      owner: 'space',
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
        need(g.read, { owner: 'space', app: 'app', ...asked })
      )
    }
    // A key handed to the app's code directly is never sent from here.
    await needs({ integration: 'SIGNING', direct: true })
    assertEquals(of(await at(g, integrationEid('SIGNING')), 'integration'), {
      name: 'SIGNING',
      hosts: [],
      owner: 'space',
    })
  },
)

// A custom integration made saying how to get its key, as its owner asked;
// a second, for its owner to change.
let ESV = { integration: 'esv', hosts: ['api.esv.org'] }
let SAID = 'Sign up at [api.esv.org](https://api.esv.org).'
let told = await setup()
await told.needs({ ...ESV, title: ' ESV API ', instructions: SAID })
let retold = await setup()
await retold.needs({ ...ESV, title: 'ESV API', instructions: SAID })
let esvOf = async (g: Ctx['graph']) =>
  of(await at(g, integrationEid('esv')), 'integration')

test('a custom integration is owned by whoever made it, and says how to get its key', async () => {
  assertEquals(await esvOf(told.g), {
    ...{ name: 'esv', hosts: ['api.esv.org'], owner: 'space' },
    title: 'ESV API',
    instructions: SAID,
  })
})

test('its owner changes what is said about it, and never where its key goes', async () => {
  let { g } = retold
  await g.apply(
    await set(
      g.read,
      {
        owner: 'space',
        integration: 'esv',
        title: '',
        site: 'https://esv.org',
        instructions: 'Make an API application.',
        hosts: ['evil.example'],
      } as Parameters<typeof set>[1],
    ),
  )
  assertEquals(await esvOf(g), {
    ...{ name: 'esv', hosts: ['api.esv.org'], owner: 'space' },
    site: 'https://esv.org',
    instructions: 'Make an API application.',
  })
})

test('nobody else changes it, nor a built one, and its site is an https address', async () => {
  let { g } = told
  for (
    let [asked, code] of [
      [{ owner: 'bob', integration: 'esv', instructions: 'mine' }, 'owner'],
      [
        { owner: 'space', integration: 'openrouter', title: 'x' },
        'integration',
      ],
      [{ owner: 'space', integration: 'esv', site: 'javascript:x' }, 'site'],
    ] as const
  ) {
    assertEquals(
      (await assertRejects(() => set(g.read, asked), CallError)).code,
      code,
    )
  }
  // Asking for it is anybody's; saying what it is, only its owner's.
  let e = await assertRejects(
    () => need(g.read, { owner: 'bob', integration: 'esv', title: 'mine' }),
    CallError,
  )
  assertEquals(e.code, 'owner')
})

// A custom integration to list, and one listed already, to take out.
let lists = await setup()
await lists.needs({ ...ESV, title: 'ESV API' })
let unlists = await setup()
await unlists.needs(ESV)
await unlists.g.apply(
  await set(unlists.g.read, {
    owner: 'space',
    integration: 'esv',
    listed: true,
  }),
)
// Listed, and then the space that made it was erased: its owner detaches.
let orphaned = await setup()
await orphaned.needs(ESV)
await orphaned.g.apply([
  ...await set(orphaned.g.read, {
    owner: 'space',
    integration: 'esv',
    listed: true,
  }),
  { entity: { eid: integrationEid('esv') }, integration: { owner: null } },
])
let names = (all: Integration[]) => all.map((i) => i.title || i.name)

test('the integration directory: every built one but those in testing, and each custom one its owner listed', async () => {
  let { g } = lists
  await g.apply(
    await set(g.read, { owner: 'space', integration: 'esv', listed: true }),
  )
  assertEquals(names(await listing(g.read)), [
    'calendar',
    'ESV API',
    'OpenAI',
    'OpenRouter',
    'texts',
  ])
  let [esv] = await listing(g.read, 'API.ESV.org esv')
  assert(esv.listed && esv.instructions == undefined)
})

test('its owner takes a listed one out, and listing it twice is once', async () => {
  let { g } = unlists
  assertEquals(
    await set(g.read, { owner: 'space', integration: 'esv', listed: true }),
    [],
  )
  await g.apply(
    await set(g.read, { owner: 'space', integration: 'esv', listed: false }),
  )
  assertEquals(names(await listing(g.read, 'esv')), [])
  let e = await assertRejects(
    () => set(g.read, { owner: 'bob', integration: 'esv', listed: true }),
    CallError,
  )
  assertEquals(e.code, 'owner')
})

test('a listed integration whose owner is gone leaves the directory, since nobody could take it out', async () => {
  assertEquals(names(await listing(orphaned.g.read, 'esv')), [])
})

test('a list, and an answer naming a connection, carry the integration it goes through', async () => {
  let { g } = told
  let instructions = (bundles: Bundle[]) =>
    bundles.flatMap((b) =>
      b.integration ? [of(b, 'integration').instructions] : []
    )
  let listed = await list(g.read, 'space')
  assertEquals(instructions(listed), [SAID])
  assertEquals(await through(g.read, listed), [])
  // Asked again, an ask is answered with the connection the app uses, which
  // the reply answers the integration of.
  let [asked] = await need(g.read, { owner: 'space', app: 'app', ...ESV })
  assertEquals(instructions(await reply({ graph: g })(asked, [asked], [])), [
    SAID,
  ])
})

test(
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
      link: (await g.read('.uses&*'))[0],
      sentinel: (await sentinelOf(vault, name))!,
    })
    let signs = await needs()
    await assertRejects(() => connect(c, signs, { key: 'k' }))
    await assertRejects(() => begin(c, eid))
  },
)

test(
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

test(
  'a sign-in answering a key needs no registered client, and the key is its credential',
  async () => {
    let { c, needs } = await setup([200, { key: 'sk-or' }])
    let eid = await needs({ integration: 'openrouter' })
    let { attempt } = await begin(c, eid)
    await connect(c, eid, { attempt, callback: `${REDIRECT}?code=C` })
    assertEquals(await credential(c, eid), 'sk-or')
  },
)

test(
  'an OAuth client is kept once, and a custom integration never signs in as a built one’s',
  async () => {
    let { g, vault } = warm
    let mine = { ...CALENDAR, name: 'mine', token: 'https://evil.example/t' }
    let calendar = (await known(g.read, 'calendar'))!
    assertEquals(await clientOf(vault, g.read, calendar), {
      id: 'yaks',
      secret: 's',
    })
    assertEquals(await clientOf(vault, g.read, mine), undefined)
    assertEquals(await clientOf(vault, g.read, TEXTS), undefined)
  },
)

test(
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

test(
  'disconnect: the credential is forgotten, and an app that used it needs a new one',
  async () => {
    let { g, vault, c, needs } = await setup()
    let used = await needs({ integration: 'texts' })
    await connect(c, used, { key: 'sk-live' })
    await disconnect(c, used)
    assertEquals(await at(g, used), undefined)
    assertEquals(kept(vault), CLIENTS)
    let [now] = await g.read('.connection')
    assertEquals(of(now, 'connection').status, 'needed')
    assertEquals(
      (await list(g.read, 'space')).map((b) =>
        b.edge ?? b.connection ?? of(b, 'integration').name
      ),
      [
        of(now, 'connection'),
        { from: 'app', to: now.entity.eid },
        'texts',
      ],
    )
    let alone = await needs({ app: undefined, integration: 'texts' })
    await disconnect(c, alone)
    assertEquals((await g.read('.connection')).length, 1)
  },
)

test(
  'each: every person connects their own, which only they are handed, and which a disconnect does not replace',
  async () => {
    let { g, vault, c, needs } = await setup()
    let asks = await needs({ integration: 'texts', each: true })
    assertEquals(await needs({ integration: 'texts', each: true }), asks)
    assertEquals(of((await g.read('.uses'))[0], 'uses'), {
      binding: 'TEXTS',
      each: true,
    })
    let own = async (who: string) => {
      let eid = await needs({ owner: who, integration: 'texts', each: true })
      await connect(c, eid, { key: `${who}-key` })
      return eid
    }
    let ann = await own('ann')
    await own('bob')
    assertEquals(
      await needs({ owner: 'ann', integration: 'texts', each: true }),
      ann,
    )
    let handed = async (who: string | null) => {
      let r = await resolve(c, 'app', 'texts', who)
      return r && reveal(vault, String(of(r.connection, 'secret').name))
    }
    assertEquals(
      [await handed('ann'), await handed('bob'), await handed(null)],
      ['ann-key', 'bob-key', undefined],
    )
    await needs({ integration: 'texts' })
    assertEquals(await handed(null), undefined)
    await disconnect(c, ann)
    assertEquals(await handed('ann'), undefined)
    assertEquals((await list(g.read, 'ann')).length, 0)
  },
)

// An app using a connected key it opened to anyone, an account each person
// connects (one person's own among them), and a key handed to it directly;
// copied into ann's space as `other`.
let used = async () => {
  let s = await setup()
  let texts = await s.needs({ integration: 'texts', binding: 'SMS' })
  await connect(s.c, texts, { key: 'sk-texts' })
  await s.g.apply([{
    entity: { eid: edgeEid('app', 'uses', texts) },
    uses: { anyone: true },
  }])
  await s.needs({ scopes: ['events.read'], each: true })
  await s.needs({ owner: 'bob', scopes: ['events.read'], each: true })
  await s.needs({
    integration: 'weather',
    hosts: ['api.weather.example'],
    direct: true,
  })
  return { ...s, copy: () => carry(s.g.read, COPY) }
}
let COPY = { source: 'app', app: 'other', owner: 'ann' }
let copying = await used()
// The same, once its copy asked, and after the app gained another.
let copied = await used()
await copied.g.apply(await copied.copy())
await copied.needs({ integration: 'openrouter' })

// Each connection asked for, and the link from the copy to it.
let asked = (bundles: Bundle[]) =>
  bundles.filter((b) => b.connection).map((b) => {
    let l = bundles.find((l) => of(l, 'edge').to == b.entity.eid)
    let { integration, owner, status, scopes } = of(b, 'connection')
    return [integration, owner, status, scopes, of(l, 'edge').from, l?.uses]
  }).sort()

test(
  'carry: a copy asks its own space for each connection its app uses, by the same name, as directly, and for each person',
  async () => {
    assertEquals(asked(await copying.copy()), [
      ['calendar', 'ann', 'needed', ['events.read'], 'other', {
        binding: 'CALENDAR',
        each: true,
      }],
      ['texts', 'ann', 'needed', undefined, 'other', { binding: 'SMS' }],
      ['weather', 'ann', 'needed', undefined, 'other', {
        binding: 'WEATHER',
        direct: true,
      }],
    ])
  },
)

test('carry: a copy already asking is asked again only for what its app gained', async () => {
  assertEquals(asked(await copied.copy()), [
    ['openrouter', 'ann', 'needed', undefined, 'other', {
      binding: 'OPENROUTER',
    }],
  ])
})

// The app of `used` lending its texts key at five calls a month, borrowed by
// two copies: `other` in ann's space and `third` in bob's.
let SPACES: Record<string, string> = { other: 'ann', third: 'bob' }
let owners = (apps: string[]) =>
  Promise.resolve(Object.fromEntries(apps.map((a) => [a, SPACES[a]])))
let lent = async () => {
  let s = await used()
  let texts = String(
    (await using(s.g.read, {
      app: 'app',
      integration: 'texts',
    }))?.entity.eid,
  )
  let lending = (cap: number | null, app = 'app', integration = 'texts') =>
    lend(s.g.read, { app, integration, cap }, owners).then((b) =>
      s.g.apply(b, { trusted: true })
    )
  await lending(5)
  await s.g.apply([{ entity: { eid: 'third' }, app: {} }])
  for (let [app, owner] of Object.entries(SPACES)) {
    await s.g.apply(await carry(s.g.read, { source: 'app', app, owner }), {
      trusted: true,
    })
  }
  return { ...s, texts, lending }
}

// Each case measures one connection verb; its graph and credentials stand
// before the case starts, as they do when the caller asks it.
let loans = await lent()
let sourceSentinel = (await resolve(loans.c, 'app', 'texts'))!.sentinel
let loanLink = (app: string, connection = loans.texts) =>
  edgeEid(app, 'uses', connection)
let needing = (bundles: Bundle[]) =>
  bundles.filter((b) => b.edge && b.uses).map((l) => {
    let c = of(
      bundles.find((b) => b.entity.eid == of(l, 'edge').to),
      'connection',
    )
    return [of(l, 'edge').from, c.owner, c.status, l.uses]
  }).sort()

test('carry: a connected lend gives a new copy its capped sentinel link', async () => {
  let out = await carry(loans.g.read, { ...COPY, app: 'fourth' })
  let loan = out.find((b) => of(b, 'uses').lender == 'app')!
  assertEquals(of(loan, 'edge'), { from: 'fourth', to: loans.texts })
  assertEquals(loan.uses, { binding: 'SMS', cap: 5, lender: 'app' })
})

test('envOf: a borrower is handed the lender’s sentinel', async () => {
  assertEquals((await envOf(loans.c, 'other')).SMS, sourceSentinel)
})

test('resolve: a second copy uses the same lent connection', async () => {
  assertEquals(
    (await resolve(loans.c, 'third', 'texts'))!.connection.entity.eid,
    loans.texts,
  )
})

let waiting = await used()
await waiting.needs({ integration: 'rain', hosts: ['api.rain.example'] })
await waiting.g.apply(
  await lend(
    waiting.g.read,
    { app: 'app', integration: 'rain', cap: 5 },
    owners,
  ),
  { trusted: true },
)
test('carry: an unconnected lend asks for a key in the copy’s own space', async () => {
  let asks = asked(await waiting.copy())
  assertEquals(asks.find((a) => a[0] == 'rain'), [
    'rain',
    'ann',
    'needed',
    undefined,
    'other',
    { binding: 'RAIN' },
  ])
  assert(asks.every((a) => a[1] == 'ann'))
})

for (
  let [label, cap, app, integration] of [
    ['a direct key', 5, 'app', 'weather'],
    ['each person’s own account', 5, 'app', 'calendar'],
    ['a borrowed key', 5, 'other', 'texts'],
    ['a zero cap', 0, 'app', 'texts'],
    ['a fractional cap', 2.5, 'app', 'texts'],
  ] as const
) {
  test(`lend refuses ${label}`, () =>
    assertRejects(
      () => lend(loans.g.read, { app, integration, cap }, owners),
      CallError,
    ))
}

test('lend: a new cap updates the source and every borrowing copy', async () => {
  let out = await lend(loans.g.read, {
    app: 'app',
    integration: 'texts',
    cap: 9,
  }, owners)
  assertEquals(out, [
    { entity: { eid: loanLink('app') }, uses: { lends: 9 } },
    ...['other', 'third'].map((app) => ({
      entity: { eid: loanLink(app) },
      uses: { cap: 9 },
    })),
  ])
})

test('recall: one copy asks in its own space and the other loan stands', async () => {
  let out = await recall(loans.g.read, {
    connection: loans.texts,
    app: 'other',
  }, owners)
  assertEquals(needing(out), [['other', 'ann', 'needed', { binding: 'SMS' }]])
  assert(out.some((b) => b.entity.eid == loanLink('other') && b.tombstone))
  assert(!out.some((b) => b.entity.eid == loanLink('third')))
})

test('lend: clearing the cap recalls every copy to its own space', async () => {
  let out = await lend(loans.g.read, {
    app: 'app',
    integration: 'texts',
    cap: null,
  }, owners)
  assertEquals(needing(out), [
    ['other', 'ann', 'needed', { binding: 'SMS' }],
    ['third', 'bob', 'needed', { binding: 'SMS' }],
  ])
  assertEquals(out[0], {
    entity: { eid: loanLink('app') },
    uses: { lends: null },
  })
})

let remembered = await lent()
await remembered.g.apply(
  await recall(remembered.g.read, {
    connection: remembered.texts,
    app: 'other',
  }, owners),
)
await remembered.lending(null)
await remembered.lending(5)
test('carry: a recalled copy keeps its own ask when its source lends again', async () => {
  assertEquals(await carry(remembered.g.read, COPY), [])
})

let ownCopy = await lent()
let mine = await ownCopy.needs({
  owner: 'ann',
  app: undefined,
  integration: 'texts',
})
await connect(ownCopy.c, mine, { key: 'ann-key' })
test('attach: a copy’s own key replaces its loan without deleting the lender’s', async () => {
  let out = await attach(ownCopy.g.read, {
    owner: 'ann',
    app: 'other',
    connection: mine,
  })
  assertEquals(out.find((b) => b.edge)?.uses, { binding: 'SMS' })
  assertEquals(of(out.find((b) => b.edge), 'edge'), { from: 'other', to: mine })
  assert(
    out.some((b) =>
      b.entity.eid == edgeEid('other', 'uses', ownCopy.texts) && b.tombstone
    ),
  )
  assert(!out.some((b) => b.entity.eid == ownCopy.texts))
})
let ownedCopy = await lent()
let ownedKey = await ownedCopy.needs({
  owner: 'ann',
  app: undefined,
  integration: 'texts',
})
await connect(ownedCopy.c, ownedKey, { key: 'ann-key' })
await ownedCopy.g.apply(
  await attach(ownedCopy.g.read, {
    owner: 'ann',
    app: 'other',
    connection: ownedKey,
  }),
)
test('disconnect refuses to guess a borrowing copy’s space', () =>
  assertRejects(() => disconnect(ownedCopy.c, ownedCopy.texts)))
test('disconnect: the lender and remaining borrower ask in their own spaces', async () => {
  let out = await disconnect(
    {
      ...ownedCopy.c,
      graph: { read: ownedCopy.g.read, apply: (b) => b },
    },
    ownedCopy.texts,
    owners,
  )
  assertEquals(needing(out), [
    ['app', 'space', 'needed', { binding: 'SMS', anyone: true, lends: 5 }],
    ['third', 'bob', 'needed', { binding: 'SMS' }],
  ])
  assert(
    !out.some((b) => b.entity.eid == ownedKey || of(b, 'edge').from == 'other'),
  )
})

test('borrowed: the space reads its loan without the lender’s secret', async () => {
  let got = await borrowed(loans.g.read, ['other'])
  assertEquals(
    got.map((b) => b.entity.eid).sort(),
    [loanLink('other'), integrationEid('texts'), loans.texts].sort(),
  )
  assertEquals(got.some((b) => b.secret), false)
})
test('borrowed: a lender holds no borrowed connection', async () => {
  assertEquals(await borrowed(loans.g.read, ['app']), [])
})

let changed = await lent()
let owned = (apps: string[]) =>
  Promise.resolve(
    Object.fromEntries(
      apps.map((app) => [app, app == 'fourth' ? 'ann' : SPACES[app]]),
    ),
  )
let lendingChanged = async (integration: string, cap: number | null) =>
  changed.g.apply(
    await lend(changed.g.read, { app: 'app', integration, cap }, owned),
    { trusted: true },
  )
let rain = await changed.needs({
  integration: 'rain',
  hosts: ['api.rain.example'],
})
await connect(changed.c, rain, { key: 'rain-key' })
await lendingChanged('rain', 3)
await changed.g.apply(await carry(changed.g.read, COPY), { trusted: true })
let replacement = await changed.needs({ app: undefined, integration: 'texts' })
await connect(changed.c, replacement, { key: 'replacement-key' })
await changed.g.apply(
  await attach(changed.g.read, {
    owner: 'space',
    app: 'app',
    connection: replacement,
  }),
)
await lendingChanged('texts', 7)
await changed.g.apply([{ entity: { eid: 'fourth' }, app: {} }])
await changed.g.apply(
  await carry(changed.g.read, { source: 'app', app: 'fourth', owner: 'ann' }),
  { trusted: true },
)
test('lend: cap changes reach old and new connections after source replacement', async () => {
  let out = await lend(changed.g.read, {
    app: 'app',
    integration: 'texts',
    cap: 9,
  }, owned)
  assertEquals(out, [
    {
      entity: { eid: edgeEid('app', 'uses', replacement) },
      uses: { lends: 9 },
    },
    ...[['other', changed.texts], ['third', changed.texts], [
      'fourth',
      replacement,
    ]].map(([app, connection]) => ({
      entity: { eid: edgeEid(app, 'uses', connection) },
      uses: { cap: 9 },
    })),
  ])
})
test('lend: recall reaches old and new connections without recalling another integration', async () => {
  let out = await lend(changed.g.read, {
    app: 'app',
    integration: 'texts',
    cap: null,
  }, owned)
  assertEquals(needing(out), [
    ['fourth', 'ann', 'needed', { binding: 'SMS' }],
    ['other', 'ann', 'needed', { binding: 'SMS' }],
    ['third', 'bob', 'needed', { binding: 'SMS' }],
  ])
  for (let app of ['other', 'fourth']) {
    assert(!out.some((b) => b.entity.eid == edgeEid(app, 'uses', rain)))
  }
})

for (let [app, owner] of [['app', 'space'], ['other', 'ann']]) {
  test(`need: ${app} cannot change a lent sentinel into a direct key`, () =>
    assertRejects(
      () =>
        need(loans.g.read, { app, owner, integration: 'texts', direct: true }),
      CallError,
    ))
}
let hostile = await lent()
await hostile.g.apply([{
  entity: { eid: edgeEid('other', 'uses', hostile.texts) },
  uses: { direct: true },
}], { trusted: true })
let hostileSentinel = (await resolve(hostile.c, 'app', 'texts'))!.sentinel
test('envOf: an old direct mark cannot release a borrowed key', async () => {
  assertEquals((await envOf(hostile.c, 'other')).SMS, hostileSentinel)
})

test(
  'envOf: what the app reads, by name: a sentinel, or the key itself where the link is direct',
  async () => {
    let { g, vault, c, needs } = await setup()
    let texts = await needs({ integration: 'texts' })
    let sky = await needs({
      integration: 'weather',
      hosts: ['api.weather.example'],
      binding: 'SKY',
      direct: true,
    })
    assertEquals(await envOf(c, 'app'), {})
    await connect(c, texts, { key: 'sk-texts' })
    await connect(c, sky, { key: 'sk-sky' })
    let name = String(of(await at(g, texts), 'secret').name)
    assertEquals(await envOf(c, 'app'), {
      TEXTS: (await sentinelOf(vault, name))!,
      SKY: 'sk-sky',
    })
    for (
      let asked of [
        { integration: 'calendar', direct: true },
        { integration: 'texts', binding: '1X' },
        { integration: 'texts', each: true, direct: true },
      ]
    ) {
      await assertRejects(() =>
        need(g.read, { owner: 'space', app: 'other', ...asked })
      )
    }
    // Renamed where it is asked for again, and kept across a disconnect.
    await g.apply(
      await need(g.read, {
        owner: 'space',
        app: 'app',
        integration: 'texts',
        binding: 'SMS',
      }),
    )
    await disconnect(c, sky)
    let named = (await g.read('.uses&*')).map((l) => of(l, 'uses'))
    assertEquals(
      named.sort((a, b) => String(a.binding).localeCompare(String(b.binding))),
      [{ binding: 'SKY', direct: true }, { binding: 'SMS' }],
    )
  },
)

test('a deleted owner takes its connections, and their credentials', async () => {
  let { g, vault, c, needs } = await setup()
  await connect(c, await needs({ integration: 'texts' }), { key: 'sk-live' })
  await g.apply([{ entity: { eid: 'space' }, tombstone: {} }])
  assertEquals(await g.read('.connection'), [])
  assertEquals(kept(vault), CLIENTS)
})

test(
  'the tools: need writes nothing secret, and list answers the owner’s',
  async () => {
    let { g } = await setup()
    let run = Object.fromEntries(
      loadTools([connectionsDoc], runs()).map((t) => [t.name, t.run]),
    )
    let asked = (args: Record<string, unknown>) => ({
      entity: { eid: 'call' },
      call: { args },
    })
    let made = await run.connection_need(
      asked({
        app: 'app',
        owner: 'space',
        integration: 'weather',
        hosts: ['h'],
      }),
      g,
    )
    await g.apply(made)
    let listed = await run.connection_list(asked({ owner: 'space' }), g)
    assertEquals(
      listed.map((b) =>
        Object.keys(b.connection ?? b.edge ?? b.integration ?? {})
      ),
      [['integration', 'owner', 'status'], ['from', 'to'], [
        'name',
        'hosts',
        'owner',
      ]],
    )
    assertEquals(await run.connection_list(asked({ owner: 'app' }), g), [])
  },
)

let identity = (email: string) =>
  `e30.${btoa(JSON.stringify({ email }))}.signature`

test('signing in patches the grant without replaying read decorations, and respects its guard', async () => {
  for (let stale of [false, true]) {
    let { g, c, needs } = await setup([200, { access_token: 'A' }])
    let eid = await needs()
    let created = (await at(g, eid))?.created
    c.graph = {
      apply: g.apply,
      read: async (q) =>
        (await g.read(q)).map((b) =>
          b.connection
            ? {
              ...b,
              kind: 'connection',
              created: { at: '2020-01-01' },
              $was: {
                connection: { status: token(of(b, 'connection').status) },
              },
            }
            : b
        ),
    }
    let { attempt } = await begin(c, eid)
    if (stale) {
      let fetcher = c.fetch!
      c.fetch = async (input, init) => {
        await g.apply([{ entity: { eid }, connection: { status: 'broken' } }])
        return fetcher(input, init)
      }
    }
    let finish = () =>
      connect(c, eid, {
        attempt,
        callback: `${REDIRECT}?state=${attempt.state}&code=one`,
      })
    if (stale) {
      await assertRejects(finish, Stale)
      assertEquals(of(await at(g, eid), 'connection').status, 'broken')
    } else {
      await finish()
      assertEquals(await credential(c, eid), 'A')
      assertEquals((await at(g, eid))?.created, created)
    }
  }
})

test('accountOf names an account from the exchange or the authenticated userinfo door', async () => {
  assertEquals(
    await accountOf(CALENDAR, { id_token: identity('Ann@Example.com') }),
    'ann@example.com',
  )
  let seen: string | null = null
  let fetcher = ((_url: RequestInfo | URL, init?: RequestInit) => {
    seen = new Headers(init?.headers).get('authorization')
    assertEquals(init?.redirect, 'manual')
    return Promise.resolve(Response.json({ email: 'bob@example.com' }))
  }) as typeof fetch
  assertEquals(
    await accountOf(
      { ...CALENDAR, userinfo: 'https://auth.example/userinfo' },
      { access_token: 'token' },
      fetcher,
    ),
    'bob@example.com',
  )
  assertEquals(seen, 'Bearer token')
})

test('signing in to another account preserves the held grant, and the same account renews it', async () => {
  let { g, c, needs } = await setup(
    [200, { access_token: 'A', id_token: identity('ann@example.com') }],
    [200, { access_token: 'B', id_token: identity('bob@example.com') }],
    [200, { access_token: 'C', id_token: identity('ann@example.com') }],
  )
  let first = await needs({ app: undefined })
  let finish = async (eid: string) => {
    let { attempt } = await begin(c, eid)
    return connect(c, eid, {
      attempt,
      callback: `${REDIRECT}?state=${attempt.state}&code=one`,
    })
  }
  await finish(first)
  await finish(first)
  assertEquals(await credential(c, first), 'A')
  let second = await pick(g.read, 'space', 'calendar', 'bob')
  assert(second)
  assertEquals(await credential(c, second.entity.eid), 'B')
  let transient = await needs({ app: undefined })
  await finish(transient)
  assertEquals(await credential(c, first), 'C')
  assertEquals((await g.read('.connection.owner=space')).length, 2)
  assertEquals((await g.read(`.entity.eid=${transient}`)).length, 0)
})

test('pick computes the own-address default then the oldest, and only explicit ambiguous names refuse', async () => {
  let { g, c } = await setup()
  let make = async (now: string) =>
    (await g.apply(
      await need(g.read, { owner: 'space', integration: 'texts' }),
      { now },
    ))[0].entity.eid
  let oldest = await make('2020-01-01T00:00:00Z')
  await connect(c, oldest, { key: 'A' }, 'ann@one.example')
  let newer = await make('2020-02-01T00:00:00Z')
  await connect(c, newer, { key: 'B' }, 'ann@two.example')
  // Pick's read door can be remote. Give it the provenance and person's
  // email a real host's vocabulary adds to the same bundles.
  let read = async (q: Parameters<typeof g.read>[0]) => {
    if (String(q) == '.entity.eid=space&*') {
      return [{
        entity: { eid: 'space' },
        email: { address: 'ann@two.example' },
      }]
    }
    return (await g.read(String(q).replace('&.order=created.at', ''))).map((
      b,
    ) => ({
      ...b,
      created: { at: b.entity.eid == oldest ? '2020-01-01' : '2020-02-01' },
    })).sort((a, b) => a.created.at.localeCompare(b.created.at))
  }
  assertEquals((await pick(read, 'space', 'texts'))?.entity.eid, newer)
  let chronological = async (q: Parameters<typeof g.read>[0]) =>
    String(q) == '.entity.eid=space&*' ? [] : await read(q)
  assertEquals(
    (await pick(chronological, 'space', 'texts'))?.entity.eid,
    oldest,
  )
  assertEquals(
    (await pick(g.read, 'space', 'texts', 'ann@two.example'))?.entity.eid,
    newer,
  )
  await assertRejects(() => pick(g.read, 'space', 'texts', 'ann'))
  await assertRejects(() => pick(g.read, 'space', 'texts', 'missing'))
  assertEquals(await pick(g.read, 'space', 'absent'), undefined)
})

// A refusal is useful without exposing any of the connection's other fields.
for (
  let [said, integration, accounts] of [
    ['missing', 'texts', ['ann@one.example', 'ann@two.example']],
    ['ann', 'texts', ['ann@one.example', 'ann@two.example']],
    ['missing', 'absent', []],
  ] as const
) {
  test(`pick lists only account addresses: ${integration}/${said}`, async () => {
    let { g, c } = await setup()
    for (let account of ['ann@one.example', 'ann@two.example']) {
      let eid = (await g.apply(
        await need(g.read, {
          owner: 'space',
          integration: 'texts',
        }),
      ))[0].entity.eid
      await connect(c, eid, { key: 'private-key' }, account)
    }
    let error = await assertRejects(
      () => pick(g.read, 'space', integration, said),
      AccountError,
    )
    assertEquals(
      error.message.split('; available accounts: ')[1],
      accounts.join(', ') || '(none)',
    )
  })
}
