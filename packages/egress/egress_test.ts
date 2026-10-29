// The egress over a graph in memory with a vault in memory, and a network that
// answers what each test scripts: where a credential goes in its sentinel's
// place, who and what is refused, and the one retry after a refresh.

import { test } from '@yaks/testing'
import { parse } from '@yaks/query'
import { assertEquals, assertRejects } from '@std/assert'
import { type Comp, graph, type Query } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { provisionalDoc } from '@yaks/effects'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { ramVault, secrets, secretsDoc, SENTINEL } from '@yaks/secrets'
import {
  begin,
  connect,
  connectionsDoc,
  install,
  type Integration,
  need,
  registration,
  resolve,
  USES,
} from '@yaks/connections'
import {
  type Caller,
  Capped,
  counting,
  egressDoc,
  forward,
  granted,
  grants,
  type Host,
  monthOf,
  Refused,
  spent,
} from './mod.ts'

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
    person: { component: true, type: 'object', properties: {} },
  },
}

// The test's own built integrations, beside the package's (google-calendar).
let SEEDS: Integration[] = [
  {
    name: 'calendar',
    authorize: 'https://auth.example/authorize',
    token: 'https://auth.example/token',
    client: 'example',
    hosts: ['api.example'],
  },
  { name: 'texts', hosts: ['api.texts.example'] },
  { name: 'notes', hosts: ['api.notes.example'] },
]

// The network: every request it is sent, and the replies each test scripts.
// What the egress put off is the test's own, so a test that scripts its
// network starts with none left over.
let seen: Request[] = []
let replies: Response[] = []
let deferred: (() => Promise<unknown>)[] = []
let answering = (...r: [number, unknown?][]) => {
  seen = []
  deferred = []
  replies = r.map(([status, body]) =>
    new Response(body === null ? null : JSON.stringify(body ?? {}), { status })
  )
}
let net = (input: RequestInfo | URL, init?: RequestInit) => {
  seen.push(
    input instanceof Request && init === undefined
      ? input
      : new Request(input, init),
  )
  return Promise.resolve(replies.shift() ?? new Response('{}'))
}

// A credential on its way to the vault wears @yaks/effects' `provisional`.
let vocab = loadVocab(
  [here, edgeDoc, secretsDoc, provisionalDoc, connectionsDoc, egressDoc],
  [edgeKeywords],
)
let vault = ramVault()
let storage = ram(vocab)
let g = graph({
  storage,
  vocab,
  provenance: false,
  plugins: [
    secrets(vault, (b) => g.apply(b, { trusted: true }), vocab),
    edges(vocab),
    counting(),
  ],
})
// The host writes as itself, as yaks.app's kernel does: a call's count is
// server-owned. It puts off what the egress defers until a test asks, and
// keeps the clock the month is read from.
let clock = Date.UTC(2026, 9, 25)
let c: Host = {
  graph: { read: g.read, apply: (b) => g.apply(b, { trusted: true }) },
  vault,
  fetch: net,
  now: () => clock,
  defer: (work) => void deferred.push(work),
}
for (let seeds of [undefined, SEEDS]) {
  await g.apply(await install(g.read, seeds), { trusted: true })
}
await g.apply([
  ...['space', 'app', 'widget', 'other', 'ann', 'bob'].map((eid) => ({
    entity: { eid },
    [eid == 'space' ? 'space' : eid.length == 3 ? 'person' : 'app']: {},
  })),
  registration('google', { id: 'yaks-google', secret: 'shh' }),
  registration('example', { id: 'yaks' }),
])
let needs = async (integration: string, owner = 'space', each = false) =>
  (await g.apply(
    await need(g.read, { owner, app: 'app', integration, each }),
  )).find((b) => b.connection)!.entity.eid

// `app` uses a key and a calendar grant; `widget` uses the same key, open to
// anyone; `other` uses nothing.
let texts = await needs('texts')
await connect(c, texts, { key: 'sk-live' })
await g.apply([{ ...link('widget', USES, texts), [USES]: { anyone: true } }])
let calendar = await needs('calendar')
let [held] = await g.read(`.entity.eid=${calendar}`)
await g.apply([{
  entity: { eid: calendar },
  connection: { status: 'connected' },
  secret: {
    name: (held.secret as Comp).name,
    value: JSON.stringify({ access_token: 'A0', refresh_token: 'R1' }),
  },
}])
// `app` also asks each person for their own notes key: ann and bob each
// connected one, and the space's ask holds none.
await needs('notes', 'space', true)
for (let who of ['ann', 'bob']) {
  await connect(c, await needs('notes', who, true), { key: `${who}-key` })
}
let KEY = (await resolve(c, 'app', 'texts'))!.sentinel
let GRANT = (await resolve(c, 'app', 'calendar'))!.sentinel
let ANN = (await resolve(c, 'app', 'notes', 'ann'))!.sentinel

let viewer: Caller = { app: 'app', level: 'viewer', person: null }
let ann: Caller = { app: 'app', level: null, person: 'ann' }

let bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((p) =>
      typeof p == 'string' ? [...new TextEncoder().encode(p)] : p
    ),
  )

// Paid once here, so no test is charged for it: the first body, refusal and
// refresh a process makes, which leaves the grant's access token at A1.
answering([200], [200], [401], [200, { access_token: 'A1' }], [200])
await forward(
  c,
  viewer,
  new Request(`https://api.texts.example/?k=${KEY}`, {
    method: 'POST',
    body: bytes([0xff], KEY),
  }),
)
await forward(
  c,
  { app: 'other', level: null, person: null },
  new Request('https://x.example'),
)
await forward(
  c,
  viewer,
  new Request('https://api.example/', { headers: { authorization: GRANT } }),
)
await assertRejects(() =>
  forward(c, viewer, new Request(`https://evil.example/?k=${KEY}`))
)

test('a key goes out in its sentinel’s place wherever the app put it, with every other byte as it was', async () => {
  answering([200])
  await forward(
    c,
    viewer,
    new Request(`https://api.texts.example/send?key=${KEY}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'x-other': 'kept' },
      body: bytes([0xff, 0], `to=1&key=${KEY}`, [0xfe]),
    }),
  )
  let [out] = seen
  assertEquals(out.url, 'https://api.texts.example/send?key=sk-live')
  assertEquals(out.headers.get('authorization'), 'Bearer sk-live')
  assertEquals(out.headers.get('x-other'), 'kept')
  assertEquals(out.redirect, 'manual')
  assertEquals(
    new Uint8Array(await out.arrayBuffer()),
    bytes([0xff, 0], 'to=1&key=sk-live', [0xfe]),
  )
})

let unauthorized: [string, Caller, string][] = [
  ['a caller holding nothing', { ...ann, person: null }, `?k=${KEY}`],
  ['another app', { app: 'other', level: 'owner', person: null }, `?k=${KEY}`],
  ['another person’s own', { ...viewer, person: 'bob' }, `?k=${ANN}`],
  ['a person’s own, for nobody', { ...viewer, level: 'owner' }, `?k=${ANN}`],
  ['an unknown sentinel', viewer, `?k=${SENTINEL}${'A'.repeat(43)}`],
]
let refused: [string, Caller, string][] = [
  ...unauthorized,
  ['a host not named', viewer, `https://api.example/?k=${KEY}`],
  ['plain http', viewer, `http://api.texts.example/?k=${KEY}`],
  ['another port', viewer, `https://api.texts.example:8443/?k=${KEY}`],
]
for (let [why, caller, url] of refused) {
  test(`refused: ${why}`, async () => {
    answering()
    let req = new Request(new URL(url, 'https://api.texts.example/'))
    await assertRejects(() => forward(c, caller, req), Refused)
    assertEquals(seen, [])
  })
}

test('a key the app opened to anyone goes out for a caller holding nothing', async () => {
  answering([200])
  let res = await forward(
    c,
    { app: 'widget', level: null, person: null },
    new Request(`https://api.texts.example/?k=${KEY}`),
  )
  assertEquals(res.status, 200)
  assertEquals(seen[0].url, 'https://api.texts.example/?k=sk-live')
})

test('a person’s own key goes out for them, whatever they hold on the app', async () => {
  answering([200])
  let res = await forward(
    c,
    ann,
    new Request(`https://api.notes.example/?k=${ANN}`),
  )
  assertEquals(res.status, 200)
  assertEquals(seen[0].url, 'https://api.notes.example/?k=ann-key')
})

test('a request carrying no sentinel goes out as it came', async () => {
  answering([302])
  let res = await forward(
    c,
    { app: 'other', level: null, person: null },
    new Request('https://anywhere.example/a?b=c', { redirect: 'follow' }),
  )
  assertEquals(res.status, 302)
  assertEquals(seen[0].url, 'https://anywhere.example/a?b=c')
  assertEquals(seen[0].redirect, 'follow')
})

// The calls counted this month on the link from an app to a connection, once
// every count the egress put off has run.
let callsOn = async (app: string, connection: string) => {
  for (let work of deferred.splice(0)) await work()
  let [l] = await g.get([link(app, USES, connection).entity.eid])
  return spent(l, monthOf(clock))
}
// A call for the calendar, whose grant's access token the warm-up left at A1.
let calendarRequest = new Request('https://api.example/events', {
  headers: { authorization: `Bearer ${GRANT}` },
})
let events = () => forward(c, viewer, calendarRequest)

test('a vouched caller receives only the requested grants for direct execution', async () => {
  answering([200])
  let held = await grants(c, viewer, [KEY])
  assertEquals(held, [{
    sentinel: KEY,
    value: 'sk-live',
    hosts: ['api.texts.example'],
  }])
  assertEquals(seen, [])
  await granted(
    held,
    new Request('https://api.texts.example/', {
      headers: { authorization: KEY },
    }),
    net,
  )
  assertEquals(seen[0].headers.get('authorization'), 'sk-live')
})

for (let [why, caller, url] of unauthorized) {
  test(`grants refuse ${why}`, async () => {
    answering()
    let sentinel = new URL(url, 'https://api.texts.example/').searchParams
      .get('k')!
    await assertRejects(() => grants(c, caller, [sentinel]), Refused)
    assertEquals(seen, [])
  })
}

test('grants preserve a person’s own and an open connection’s authorization', async () => {
  assertEquals((await grants(c, ann, [ANN]))[0].value, 'ann-key')
  assertEquals(
    (await grants(c, { app: 'widget', level: null, person: null }, [KEY]))[0]
      .value,
    'sk-live',
  )
})

test(
  'an access token the service refuses is refreshed, and the call made once more',
  async () => {
    answering([401], [200, { access_token: 'A2' }], [200])
    assertEquals((await events()).status, 200)
    assertEquals(
      seen.map((r) => r.headers.get('authorization') ?? r.url),
      ['Bearer A1', 'https://auth.example/token', 'Bearer A2'],
    )
    assertEquals((await grants(c, viewer, [GRANT]))[0].value, 'A2')
  },
)

// This case checks retry exhaustion, not graph query normalization. Keep the
// real RAM reads, connections, vault and write hooks at the egress boundary.
let exhausted: Host = {
  ...c,
  graph: {
    ...c.graph,
    read: (query: Query) =>
      storage.read(typeof query == 'string' ? parse(query) : query),
  },
}
let refusedRefresh = [
  new Response(null, { status: 401 }),
  Response.json({ access_token: 'A3' }),
  new Response(null, { status: 401 }),
]
test('a refreshed token the service refuses too is its answer', async () => {
  seen = []
  replies = refusedRefresh
  assertEquals((await forward(exhausted, viewer, calendarRequest)).status, 401)
  assertEquals(seen.length, 3)
})

test(
  'Google Calendar as shipped: a person signs in, and the app lists their calendars through the egress',
  async () => {
    let signing = { ...c, redirect: 'https://yaks.app/connections/callback' }
    let gcal = await needs('google-calendar')
    let { url, attempt } = await begin(signing, gcal)
    let asked = new URL(url)
    assertEquals(
      [
        asked.origin + asked.pathname,
        ...[
          'client_id',
          'redirect_uri',
          'scope',
          'access_type',
          'prompt',
          'code_challenge_method',
        ].map((k) => asked.searchParams.get(k)),
      ],
      [
        'https://accounts.google.com/o/oauth2/v2/auth',
        'yaks-google',
        'https://yaks.app/connections/callback',
        'openid email https://www.googleapis.com/auth/calendar.events ' +
        'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
        'offline',
        'consent',
        'S256',
      ],
    )
    answering(
      [200, { access_token: 'G1', refresh_token: 'GR', expires_in: 3599 }],
      [200, { email: 'ann@example.com' }],
      [200, { items: [] }],
    )
    await connect(signing, gcal, {
      attempt,
      callback: `${signing.redirect}?code=C&state=${attempt.state}`,
    })
    let connected = (await resolve(c, 'app', 'google-calendar'))!
    assertEquals(
      (connected.connection.connection as Comp).account,
      'ann@example.com',
    )
    let sentinel = connected.sentinel
    let call = (at: string) =>
      forward(
        c,
        viewer,
        new Request(at, { headers: { authorization: `Bearer ${sentinel}` } }),
      )
    assertEquals(
      (await call(
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
      )).status,
      200,
    )
    assertEquals(seen.map((r) => [r.url, r.headers.get('authorization')]), [
      [
        'https://oauth2.googleapis.com/token',
        `Basic ${btoa('yaks-google:shh')}`,
      ],
      [
        'https://openidconnect.googleapis.com/v1/userinfo',
        'Bearer G1',
      ],
      [
        'https://www.googleapis.com/calendar/v3/users/me/calendarList',
        'Bearer G1',
      ],
    ])
    await assertRejects(
      () => call('https://gmail.googleapis.com/gmail/v1/users/me/messages'),
      Refused,
    )
  },
)

// An app using the texts key, its link as the egress would find it: its cap,
// and what it has made this month.
let seeded = async (app: string, uses: Comp = {}, calls?: Comp) => {
  await g.apply([
    { entity: { eid: app }, app: {} },
    { ...link(app, USES, texts), [USES]: uses, ...calls ? { calls } : {} },
  ], { trusted: true })
  return { app, level: 'viewer', person: null } satisfies Caller
}
let text = (by: Caller, to = 'api.texts.example') =>
  forward(c, by, new Request(`https://${to}/?k=${KEY}`))
let NOV = Date.UTC(2026, 10, 3)
let november = (count: number) => ({ month: '2026-11', count })
let counter = await seeded('counter', {}, november(4))
let turning = await seeded('turning', {}, november(7))
let refusing = await seeded('refusing', {}, november(3))
let full = await seeded('full', { cap: 2 }, november(2))
let room = await seeded('room', { cap: 2 }, november(1))
let lapsed = await seeded('lapsed', { cap: 2 }, { month: '2026-10', count: 2 })

test('each call out adds one to its link’s count for the month', async () => {
  clock = NOV
  answering([200])
  await text(counter)
  assertEquals(await callsOn('counter', texts), 5)
})

test('a grant lent is counted, and a new month starts the count over', async () => {
  clock = Date.UTC(2026, 11, 1)
  answering()
  await grants(c, turning, [KEY])
  assertEquals(await callsOn('turning', texts), 1)
})

test('a call refused is not counted', async () => {
  clock = NOV
  await assertRejects(() => text(refusing, 'evil.example'), Refused)
  assertEquals(await callsOn('refusing', texts), 3)
})

test('a link at its cap refuses calls, naming whose connection it is', async () => {
  clock = NOV
  answering()
  let no = await assertRejects(() => text(full), Capped)
  assertEquals([no.owner, no.integration, no.cap], ['space', 'texts', 2])
  await assertRejects(() => grants(c, full, [KEY]), Capped)
  assertEquals(seen, [])
})

test('a link below its cap, or at it only last month, calls out', async () => {
  clock = NOV
  answering([200], [200])
  assertEquals([(await text(room)).status, (await text(lapsed)).status], [
    200,
    200,
  ])
})
