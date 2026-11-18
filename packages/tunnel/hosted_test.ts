import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { Gateways } from './cloudflare.ts'
import type { Told } from './effects.ts'
import { BY, CALLER, HEADER, WITH } from './gateway.ts'
import {
  barred,
  door,
  type Held,
  type Kept,
  machine,
  owners,
  reach,
  type Reaching,
  type Relay,
  type Tunnel,
} from './hosted.ts'

let T = '11111111-2222-4333-8444-555555555555'
let S = '66666666-7777-4888-8999-aaaaaaaaaaaa'
let ADA = 'ada-person'
let JEFF = 'jeff-person'

// The account and the gateways, answered here: every call is kept as
// `METHOD /path` after the account, or `put name service` and `remove name`.
let platform = (over: { account?: boolean; gateways?: boolean } = {}) => {
  let made: string[] = []
  let gateways: Gateways = {
    put: (name, service) =>
      Promise.resolve(void made.push(`put ${name} ${service}`)),
    remove: (name) => Promise.resolve(void made.push(`remove ${name}`)),
  }
  let account = {
    account: 'acct',
    token: 'tok',
    fetch: (url: string, init: RequestInit) => {
      let path = new URL(url).pathname.split('/acct')[1]
      made.push(`${init.method} ${path}`)
      let result = path.endsWith('/cfd_tunnel')
        ? { id: T, token: 'the-token' }
        : path.startsWith('/cfd_tunnel/')
        ? { id: T, token: 'a-new-token' }
        : path.startsWith('/connectivity')
        ? { service_id: S }
        : {}
      return Promise.resolve(Response.json({ success: true, result }))
    },
  }
  // Ada owns `ada`; Jeff owns the platform.
  let space: Kept = {
    eid: 'e1',
    slug: 'ada',
    tunnel: null,
    owner: false,
    platform: false,
  }
  let heard: [string, Told][] = []
  let host = {
    account: over.account == false ? null : account,
    gateways: over.gateways == false ? null : gateways,
    who: () => Promise.resolve(asker),
    find: (slug: string, person: string | null) =>
      Promise.resolve(
        slug == 'ada'
          ? { ...space, owner: person == ADA, platform: person == JEFF }
          : null,
      ),
    write: (_: string, row: Tunnel | null) =>
      Promise.resolve(void (space.tunnel = row)),
    trash: (_: string, at: string | null) =>
      Promise.resolve(void (space.tunnelTrashed = at)),
    purge: () => Promise.resolve('A confirmation letter was sent.'),
    tell: (person: string, told: Told) => {
      heard.push([person, told])
      return Promise.resolve(
        told.conversation == 'held' ? { space: 'ada', request: 'r' } : null,
      )
    },
  }
  let asker: string | null = null
  let ask = async (who: string | null, fields: Record<string, string>) => {
    asker = who
    let r = await door(
      fields.do
        ? new Request('https://p/api/tunnel', {
          method: 'POST',
          body: new URLSearchParams(fields),
        })
        : new Request(`https://p/api/tunnel?space=${fields.space}`),
      host,
    )
    let body = await r.json()
    return { status: r.status, body, code: body.error?.code }
  }
  return { ask, made, space, heard, gateways }
}

let adopt = { space: 'ada', do: 'adopt', tunnel: T, service: S }
let connect = { space: 'ada', do: 'connect', port: '5173' }

test('the door refuses what nobody may do, by its code', async () => {
  let { ask, made } = platform()
  let codes = [
    [null, { space: 'ada' }],
    [ADA, { space: 'bob' }],
    [ADA, adopt],
    [JEFF, { ...adopt, service: 'x' }],
    [JEFF, connect],
    [ADA, { ...connect, port: '0' }],
    [ADA, { space: 'ada', do: 'rotate' }],
    [ADA, { space: 'ada', do: 'grow' }],
  ] as const
  let got = []
  for (let [who, f] of codes) got.push((await ask(who, f)).code)
  assertEquals(
    got,
    [
      'not_owner',
      'no_space',
      'not_platform',
      'bad_ids',
      'not_owner',
      'bad_port',
      'no_tunnel',
      'bad_do',
    ],
  )
  assertEquals(made, [])
})

test('connect makes a pair and its gateway, answering the token once', async () => {
  let { ask, made } = platform()
  let got = (await ask(ADA, connect)).body
  assertEquals(got, {
    space: 'ada',
    tunnel: { id: T, service: S, adopted: false },
    token: 'the-token',
  })
  assertEquals((await ask(ADA, { space: 'ada' })).body.token, undefined)
  assertEquals((await ask(ADA, connect)).code, 'has_tunnel')
  assertEquals(
    (await ask(ADA, { space: 'ada', do: 'rotate' })).body.token,
    'a-new-token',
  )
  assertEquals(
    (await ask(ADA, { space: 'ada', do: 'disconnect' })).body.tunnel,
    null,
  )
  assertEquals(made, [
    'POST /cfd_tunnel',
    'POST /connectivity/directory/services',
    `put tunnel-e1 ${S}`,
    `PATCH /cfd_tunnel/${T}`,
    `put tunnel-e1 ${S}`,
    'remove tunnel-e1',
  ])
})

test('disconnect retains the pair and names, blocks access, and restores the same pair', async () => {
  let { ask, made, space } = platform()
  await ask(ADA, connect)
  made.length = 0
  await ask(ADA, { space: 'ada', do: 'disconnect' })
  assertEquals(space.tunnel, { id: T, service: S, adopted: false })
  assertEquals(typeof space.tunnelTrashed, 'string')
  assertEquals(barred(space, { slug: 'app' })?.code, 'no_tunnel')
  assertEquals((await ask(ADA, connect)).code, 'has_tunnel')
  assertEquals((await ask(JEFF, adopt)).code, 'has_tunnel')
  assertEquals((await ask(ADA, { space: 'ada', do: 'rotate' })).code, 'trashed')
  assertEquals((await ask(ADA, { space: 'ada' })).body.tunnel, null)
  assertEquals(
    (await ask(ADA, { space: 'ada', do: 'restore' })).body.tunnel,
    space.tunnel,
  )
  assertEquals(space.tunnelTrashed, null)
  assertEquals(barred(space, { slug: 'app' }), null)
  assertEquals(made, ['remove tunnel-e1', `put tunnel-e1 ${S}`])
})

test('purge only asks its person to confirm a tunnel already in the trash', async () => {
  let { ask, made, space } = platform()
  await ask(ADA, connect)
  assertEquals(
    (await ask(ADA, { space: 'ada', do: 'purge' })).code,
    'not_trashed',
  )
  await ask(ADA, { space: 'ada', do: 'disconnect' })
  made.length = 0
  assertEquals(
    (await ask(ADA, { space: 'ada', do: 'purge' })).body.message,
    'A confirmation letter was sent.',
  )
  assertEquals(made, [])
  assertEquals(space.tunnel?.id, T)
})

test('a pair whose gateway cannot be put is taken down again', async () => {
  let f = platform()
  f.gateways.put = () => Promise.reject(new Error('no upload'))
  await assertRejects(() => f.ask(ADA, connect), Error, 'no upload')
  assertEquals(f.space.tunnel, null)
  assertEquals(f.made.slice(2), [
    'remove tunnel-e1',
    `DELETE /connectivity/directory/services/${S}`,
    `DELETE /cfd_tunnel/${T}`,
  ])
})

test('an adopted pair rotates only its gateway, and disconnecting leaves the tunnel alone', async () => {
  let { ask, made } = platform({ account: false })
  assertEquals((await ask(JEFF, adopt)).body.tunnel, {
    id: T,
    service: S,
    adopted: true,
  })
  assertEquals((await ask(JEFF, adopt)).status, 200)
  assertEquals((await ask(JEFF, { ...adopt, tunnel: S })).code, 'has_tunnel')
  assertEquals(
    (await ask(ADA, { space: 'ada', do: 'rotate' })).body.token,
    undefined,
  )
  assertEquals(
    (await ask(ADA, { space: 'ada', do: 'disconnect' })).body.tunnel,
    null,
  )
  assertEquals(made, [
    `put tunnel-e1 ${S}`,
    `put tunnel-e1 ${S}`,
    `put tunnel-e1 ${S}`,
    'remove tunnel-e1',
  ])
})

test('without the tokens nothing is made', async () => {
  assertEquals(
    (await platform({ gateways: false }).ask(JEFF, adopt)).code,
    'no_token',
  )
  assertEquals(
    (await platform({ account: false }).ask(ADA, connect)).code,
    'no_token',
  )
  assertEquals(
    (await platform({ gateways: false }).ask(ADA, connect)).code,
    'no_token',
  )
})

test('a knock is heard from whoever signed in, when it names itself and says something', async () => {
  let { ask, heard } = platform()
  let knock = { do: 'tell', conversation: 'held', key: 'k1', text: 'T-7 done' }
  assertEquals((await ask(null, knock)).code, 'not_owner')
  assertEquals((await ask(ADA, { ...knock, text: ' ' })).code, 'bad_tell')
  assertEquals((await ask(ADA, knock)).body, { space: 'ada', request: 'r' })
  assertEquals(
    (await ask(ADA, { ...knock, conversation: 'c2' })).code,
    'no_conversation',
  )
  await ask(ADA, { ...knock, about: T })
  await ask(ADA, { ...knock, about: 'not an eid' })
  assertEquals(heard.map(([who, t]) => [who, t.about]), [
    [ADA, undefined],
    [ADA, undefined],
    [ADA, T],
    [ADA, undefined],
  ])
})

// ── Through the tunnel ───────────────────────────────────────────────────────

let tunneled: Held = {
  slug: 'jeff',
  tunnel: { id: T, service: S, adopted: true },
}

// A gateway that keeps what it was handed: `gone` has none, `off` reaches no
// machine.
let gateway = (state: 'up' | 'gone' | 'off' = 'up') => {
  let handed: Request[] = []
  let relay: Relay = (r) => {
    handed.push(r)
    return state == 'gone'
      ? Promise.resolve(null)
      : state == 'off'
      ? Promise.reject(new Error('the tunnel is down'))
      : Promise.resolve(new Response('from the machine'))
  }
  return { relay, handed }
}

// What a caller's request says that is not the machine's business, and what
// it may not say for itself.
let WORDS = {
  'x-yak-grant': 'the-app-grant',
  'x-yak-person': 'a-liar',
  [HEADER]: 'forged',
  [CALLER]: 'operator',
  [BY]: 'a-liar',
  [WITH]: 'a-liar',
  'x-via': 'a-forged-conversation',
  cookie: 'theme=dark',
}
let letter = () =>
  new Request('https://jeff.yaks.app/mail/api/tunneled/mail/inbound?to=a', {
    method: 'POST',
    headers: { ...WORDS, 'content-type': 'text/plain' },
    body: 'a letter',
  })
let mail: Reaching = { slug: 'mail' }

let code = async (
  r: Response | null,
) => [r!.status, (await r!.json()).error.code]

test('only the app itself reaches the machine, and only an app built in a space with a tunnel', async () => {
  let { relay, handed } = gateway()
  let at = { space: tunneled, app: mail, itself: true }
  let asks = (over: Partial<typeof at>) =>
    reach(letter(), '/tunneled/mail/inbound', { ...at, ...over }, relay)
  assertEquals(await code(await asks({ itself: false })), [403, 'not_the_app'])
  assertEquals(await code(await asks({ app: { slug: 'm', installed: {} } })), [
    403,
    'installed',
  ])
  assertEquals(
    await code(await asks({ space: { ...tunneled, tunnel: null } })),
    [404, 'no_tunnel'],
  )
  assertEquals(await reach(letter(), '/fetch/x', at, relay), null)
  assertEquals(handed, [])
})

test('an app’s request goes on as an app’s, with the platform’s words taken off', async () => {
  let { relay, handed } = gateway()
  let at = { space: tunneled, app: mail, itself: true }
  let res = await reach(letter(), '/tunneled/mail/inbound', at, relay)
  assertEquals(await res!.text(), 'from the machine')
  let [r] = handed
  assertEquals([r.url, r.method, await r.text()], [
    'http://machine/mail/inbound?to=a',
    'POST',
    'a letter',
  ])
  assertEquals(r.headers.get('content-type'), 'text/plain')
  assertEquals(r.headers.get(CALLER), 'app')
  for (let h in WORDS) if (h != CALLER) assertEquals(r.headers.has(h), false, h)
})

test('a request that reaches no machine is an answer, and its throw is reported', async () => {
  let reported: unknown[] = []
  let at = { space: tunneled, app: mail, itself: true }
  let asks = (state: 'gone' | 'off') =>
    reach(
      letter(),
      '/tunneled/x',
      at,
      gateway(state).relay,
      (e) => reported.push(e),
    )
  assertEquals(await code(await asks('gone')), [503, 'no_gateway'])
  assertEquals(await code(await asks('off')), [502, 'unreached'])
  assertEquals(reported.length, 1)
  let ends = (state: 'gone' | 'off', space = tunneled) =>
    machine(space, ADA, { caller: 'connector' }, gateway(state).relay)(
      'http://m/mcp',
    )
  assertEquals(await code(await ends('gone')), [503, 'no_gateway'])
  assertEquals(await code(await ends('off')), [502, 'unreached'])
  assertEquals(await code(await ends('off', { ...tunneled, tunnel: null })), [
    404,
    'no_tunnel',
  ])
})

test('the owner’s request says who asks for them, and nothing else of the platform’s', async () => {
  let { relay, handed } = gateway()
  let said = { method: 'POST', headers: WORDS, body: 'a call' }
  let talking = machine(tunneled, ADA, {
    caller: 'operator',
    space: 'e1',
    via: () => 'a-talk',
    own: true,
  }, relay)
  assertEquals(
    await (await talking('http://anywhere/mcp?x=1', said)).text(),
    'from the machine',
  )
  await machine(tunneled, ADA, { caller: 'connector' }, relay)(
    'http://anywhere/mcp',
    said,
  )
  let words = [CALLER, 'x-via', WITH, BY]
  assertEquals(
    handed.map((r) => [r.url, ...words.map((h) => r.headers.get(h))]),
    [
      ['http://machine/mcp?x=1', 'operator', 'a-talk', ADA, ADA],
      ['http://machine/mcp', 'connector', null, null, null],
    ],
  )
  assertEquals(await handed[0].text(), 'a call')
  for (let h in WORDS) {
    if (!words.includes(h)) assertEquals(handed[0].headers.has(h), false, h)
  }
})

test('only the owner reaches a machine, and their Operator only from its own space', () => {
  let cases = [
    ['owner', 'e1', { caller: 'connector' }, true],
    ['owner', 'e1', { caller: 'operator', space: 'e1' }, true],
    ['owner', 'e1', { caller: 'operator', space: 'e2' }, false],
    ['editor', 'e1', { caller: 'connector' }, false],
    [null, 'e1', { caller: 'connector' }, false],
  ] as const
  for (let [role, at, asking, may] of cases) {
    assertEquals(
      owners(role, at, asking),
      may,
      `${role} ${JSON.stringify(asking)}`,
    )
  }
})

test('an installed copy, or an app in a space with no tunnel, is barred', () => {
  assertEquals(barred(tunneled, mail), null)
  assertEquals(
    barred(tunneled, { slug: 'm', installed: { of: 'x' } })?.code,
    'installed',
  )
  assertEquals(barred({ ...tunneled, tunnel: null }, mail)?.code, 'no_tunnel')
})
