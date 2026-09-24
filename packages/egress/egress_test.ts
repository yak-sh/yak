// The egress over a graph in memory with a vault in memory, and a network that
// answers what each test scripts: where a credential goes in its sentinel's
// place, who and what is refused, and the one retry after a refresh.

import { assertEquals, assertRejects } from '@std/assert'
import { type Comp, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab, type VocabDoc } from '@yaks/vocab'
import { edgeDoc, edgeKeywords, edges, link } from '@yaks/edge'
import { ramVault, sealing, secrets, secretsDoc, SENTINEL } from '@yaks/secrets'
import { effects } from '@yaks/effects'
import {
  connect,
  connectionsDoc,
  type Ctx,
  type Integration,
  need,
  resolve,
  USES,
} from '@yaks/connections'
import { type Caller, forward, Refused } from './mod.ts'

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

let BUILT: Record<string, Integration> = {
  calendar: {
    name: 'calendar',
    authorize: 'https://auth.example/authorize',
    token: 'https://auth.example/token',
    hosts: ['api.example'],
  },
  texts: { name: 'texts', hosts: ['api.texts.example'] },
  notes: { name: 'notes', hosts: ['api.notes.example'] },
}

// The network: every request it is sent, and the replies each test scripts.
let seen: Request[] = []
let replies: Response[] = []
let answering = (...r: [number, unknown?][]) => {
  seen = []
  replies = r.map(([status, body]) =>
    new Response(JSON.stringify(body ?? {}), { status })
  )
}
let net = (input: RequestInfo | URL, init?: RequestInit) => {
  seen.push(new Request(input, init))
  return Promise.resolve(replies.shift() ?? new Response('{}'))
}

let vocab = loadVocab(
  [here, edgeDoc, secretsDoc, connectionsDoc],
  [edgeKeywords],
)
let vault = ramVault()
let fx = effects(vocab, { write: (b) => g.apply(b, { trusted: true }) })
let g = graph({
  storage: ram(vocab),
  vocab,
  plugins: [secrets(vault), edges(vocab), fx],
})
fx.on('secret', sealing(vault))
let c: Ctx = {
  graph: g,
  vault,
  built: BUILT,
  client: () => ({ id: 'yaks' }),
  fetch: net,
}
await g.apply(
  ['space', 'app', 'widget', 'other', 'ann', 'bob'].map((eid) => ({
    entity: { eid },
    [eid == 'space' ? 'space' : eid.length == 3 ? 'person' : 'app']: {},
  })),
)
let needs = async (integration: string, owner = 'space', each = false) =>
  (await g.apply(
    await need(g.read, { owner, app: 'app', integration, each }, BUILT),
  )).find((b) => b.connection)!.entity.eid

// `app` uses a key and a calendar grant; `widget` uses the same key, open to
// anyone; `other` uses nothing.
let texts = await needs('texts')
await connect(c, texts, { key: 'sk-live' })
await g.apply([{ ...link('widget', USES, texts), [USES]: { anyone: true } }])
let calendar = await needs('calendar')
let [held] = await g.read(`.eid=${calendar}`)
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

Deno.test('a key goes out in its sentinel’s place wherever the app put it, with every other byte as it was', async () => {
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

let refused: [string, Caller, string][] = [
  ['a caller holding nothing', { ...ann, person: null }, `?k=${KEY}`],
  ['another app', { app: 'other', level: 'owner', person: null }, `?k=${KEY}`],
  ['another person’s own', { ...viewer, person: 'bob' }, `?k=${ANN}`],
  ['a person’s own, for nobody', { ...viewer, level: 'owner' }, `?k=${ANN}`],
  ['an unknown sentinel', viewer, `?k=${SENTINEL}${'A'.repeat(43)}`],
  ['a host not named', viewer, `https://api.example/?k=${KEY}`],
  ['plain http', viewer, `http://api.texts.example/?k=${KEY}`],
  ['another port', viewer, `https://api.texts.example:8443/?k=${KEY}`],
]
for (let [why, caller, url] of refused) {
  Deno.test(`refused: ${why}`, async () => {
    answering()
    let req = new Request(new URL(url, 'https://api.texts.example/'))
    await assertRejects(() => forward(c, caller, req), Refused)
    assertEquals(seen, [])
  })
}

Deno.test('a key the app opened to anyone goes out for a caller holding nothing', async () => {
  answering([200])
  let res = await forward(
    c,
    { app: 'widget', level: null, person: null },
    new Request(`https://api.texts.example/?k=${KEY}`),
  )
  assertEquals(res.status, 200)
  assertEquals(seen[0].url, 'https://api.texts.example/?k=sk-live')
})

Deno.test('a person’s own key goes out for them, whatever they hold on the app', async () => {
  answering([200])
  let res = await forward(
    c,
    ann,
    new Request(`https://api.notes.example/?k=${ANN}`),
  )
  assertEquals(res.status, 200)
  assertEquals(seen[0].url, 'https://api.notes.example/?k=ann-key')
})

Deno.test('a request carrying no sentinel goes out as it came', async () => {
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

// A call for the calendar, whose grant's access token the warm-up left at A1.
let events = () =>
  forward(
    c,
    viewer,
    new Request('https://api.example/events', {
      headers: { authorization: `Bearer ${GRANT}` },
    }),
  )

Deno.test(
  'an access token the service refuses is refreshed, and the call made once more',
  async () => {
    answering([401], [200, { access_token: 'A2' }], [200])
    assertEquals((await events()).status, 200)
    assertEquals(
      seen.map((r) => r.headers.get('authorization') ?? r.url),
      ['Bearer A1', 'https://auth.example/token', 'Bearer A2'],
    )
  },
)

Deno.test('a refreshed token the service refuses too is its answer', async () => {
  answering([401], [200, { access_token: 'A3' }], [401])
  assertEquals((await events()).status, 401)
  assertEquals(seen.length, 3)
})
