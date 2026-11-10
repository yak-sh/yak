import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { mint } from '@yaks/graph'
import { CALLER, HEADER, WITH } from '@yaks/tunnel'
import { derivedEid } from '@yaks/graph/identity'
import { rootOf } from './operator-root.ts'
import type { App, Space } from './directory.ts'
import { directory, stamp } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { sign } from './lib/token.ts'
import type { Who } from './session.ts'
import { platform } from './testing.ts'
import * as tunnel from './tunnel.ts'

let SECRET = 'a probe secret'
let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let JEFF = 'a0000000-0000-4000-8000-00000000000f'
let T = '11111111-2222-4333-8444-555555555555'
let S = '66666666-7777-4888-8999-aaaaaaaaaaaa'
let TOKENS = {
  CF_ACCOUNT: 'acct',
  CF_WORKERS_TOKEN: 'w',
  CF_TUNNEL_TOKEN: 'cf',
}

// The account API, answered here: every call is kept as `METHOD /path` after
// the account, and answered the way Cloudflare answers it.
let account = () => {
  let was = globalThis.fetch
  let made: string[] = []
  globalThis.fetch = ((input: string | Request, init?: RequestInit) => {
    let r = new Request(input, init)
    let url = new URL(r.url)
    if (url.hostname != 'api.cloudflare.com') return was(r)
    let path = url.pathname.split('/acct')[1]
    made.push(`${r.method} ${path}`)
    let result = path.endsWith('/cfd_tunnel')
      ? { id: T, token: 'the-token' }
      : path.startsWith('/cfd_tunnel/')
      ? { id: T, token: 'a-new-token' }
      : path.startsWith('/connectivity')
      ? { service_id: S }
      : {}
    return Promise.resolve(Response.json({ success: true, result }))
  }) as typeof fetch
  return { made, [Symbol.dispose]: () => globalThis.fetch = was }
}

let as = async (person: string) =>
  `yak_session=${await sign(
    { person, space: null, exp: Date.now() + 60_000 },
    SECRET,
  )}`

// Ada owns `ada`; the owner owns `yak`, the platform's own space.
let spaces = async (vars: Partial<Env> = TOKENS) => {
  let scenario = platform(SECRET, vars)
  let { env } = scenario
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) })
  await dir.apply({
    entities: [
      { entity: { eid: ADA }, person: {} },
      {
        entity: { eid: '$space' },
        doc: { title: 'ada' },
        space: { slug: 'ada', store: 'ada' },
      },
      {
        entity: { eid: '$seat' },
        member: { space: '$space', person: ADA, role: 'owner' },
      },
    ],
  }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
  await stamp(env, {
    entities: [{
      entity: { eid: '$seat' },
      member: {
        space: (await dir.space('yak'))!.eid,
        person: JEFF,
        role: 'owner',
      },
    }],
  })
  let gateway = `/workers/dispatch/namespaces/yak-apps/scripts/tunnel-${
    (await dir.space('ada'))!.eid
  }`
  let door = async (who: string | null, fields: Record<string, string>) => {
    let cookie = who ? await as(who) : ''
    let r = await tunnel.fetch(
      fields.do
        ? new Request('https://yaks.app/api/tunnel', {
          method: 'POST',
          headers: { cookie },
          body: new URLSearchParams(fields),
        })
        : new Request(`https://yaks.app/api/tunnel?space=${fields.space}`, {
          headers: { cookie },
        }),
      env,
    )
    return { status: r.status, body: await r.json() }
  }
  return { scenario, door, gateway }
}

let adopt = { space: 'ada', do: 'adopt', tunnel: T, service: S }

let scene = async () => {
  let cf = account()
  let f = await spaces()
  await f.scenario.settled()
  cf.made.length = 0
  return { ...f, ...cf }
}

test('only the platform adopts a pair, since its ids name the platform’s resources', async () => {
  using cf = await scene()
  let { scenario, door, gateway } = cf
  await using _ = scenario
  assertEquals((await door(ADA, adopt)).body.error.code, 'not_platform')
  assertEquals((await door(null, adopt)).status, 403)
  assertEquals((await door(JEFF, { ...adopt, service: 'x' })).status, 400)
  let adopted = await door(JEFF, adopt)
  assertEquals(adopted.body.tunnel, { id: T, service: S, adopted: true })
  assertEquals((await door(ADA, { space: 'ada' })).body, {
    space: 'ada',
    tunnel: { id: T, service: S, adopted: true },
  })
  assertEquals(cf.made, [`PUT ${gateway}`])
})

test('an adopted pair rotates only its gateway, and disconnecting leaves the tunnel alone', async () => {
  using cf = await scene()
  let { scenario, door, gateway } = cf
  await using _ = scenario
  await door(JEFF, adopt)
  let rotated = (await door(ADA, { space: 'ada', do: 'rotate' })).body
  assertEquals(rotated.token, undefined)
  assertEquals((await door(ADA, { space: 'ada', do: 'disconnect' })).body, {
    space: 'ada',
    tunnel: null,
  })
  assertEquals(cf.made, [
    `PUT ${gateway}`,
    `PUT ${gateway}`,
    `DELETE ${gateway}`,
  ])
})

test('no gateway can be uploaded without the workers token, so no tunnel is made', async () => {
  let { scenario, door } = await spaces({ CF_ACCOUNT: 'acct' })
  await using _ = scenario
  assertEquals((await door(JEFF, adopt)).body.error.code, 'no_token')
  assertEquals((await door(ADA, { space: 'ada' })).body.tunnel, null)
})

test('connect makes a pair and its gateway, answering the token once', async () => {
  using cf = await scene()
  let { scenario, door, gateway } = cf
  await using _ = scenario
  let connect = { space: 'ada', do: 'connect', port: '5173' }
  let made = (await door(ADA, connect)).body
  assertEquals(made.tunnel, { id: T, service: S, adopted: false })
  assertEquals(made.token, 'the-token')
  let read = (await door(ADA, { space: 'ada' })).body
  assertEquals(read.token, undefined)
  assertEquals((await door(ADA, connect)).status, 409)
  let rotated = (await door(ADA, { space: 'ada', do: 'rotate' })).body
  assertEquals(rotated.token, 'a-new-token')
  await door(ADA, { space: 'ada', do: 'disconnect' })
  assertEquals(cf.made, [
    'POST /cfd_tunnel',
    'POST /connectivity/directory/services',
    `PUT ${gateway}`,
    `PATCH /cfd_tunnel/${T}`,
    `PUT ${gateway}`,
    `DELETE ${gateway}`,
    `DELETE /connectivity/directory/services/${S}`,
    `DELETE /cfd_tunnel/${T}`,
  ])
})

// ── The door an app's worker reaches the machine through ────────────────────

let tunneled: Space = {
  eid: 's1',
  slug: 'jeff',
  store: 'jeff',
  title: 'jeff',
  operator: 'Wren',
  tier: null,
  plan: null,
  seller: null,
  fee: 0,
  budget: null,
  meter: null,
  told: false,
  trashed: null,
  slugs: [],
  tunnel: { id: T, service: S, adopted: true },
}
let mail: App = {
  policy: 0,
  eid: 'a1',
  slug: 'mail',
  space: 's1',
  version: 1,
  title: 'mail',
  access: 'private',
  store: 'jeff/mail',
  slugs: ['jeff/mail'],
  home: false,
  first: [],
  meter: null,
  published: null,
  installed: null,
  gallery: null,
  screenshot: null,
  seeded: null,
  trashed: null,
  theme: null,
}
let itself: Who = { person: mail.eid, role: 'editor' }

// The apps' namespace with a gateway in it, and what that gateway was handed;
// `gone` is a tunnel with no gateway yet, and `off` a machine that does not
// answer. The namespace refuses a `get` without the caller its outbound Worker
// declares, the way Cloudflare's does.
let gateway = (state: 'up' | 'gone' | 'off' = 'up') => {
  let handed: Request[] = []
  let named: string[] = []
  let get = (
    n: string,
    _args?: unknown,
    options?: { outbound?: { CALLER?: unknown } },
  ) => {
    named.push(n)
    if (!options?.outbound?.CALLER) {
      throw new TypeError('Missing one or more required arguments to worker.')
    }
    if (door.state == 'gone') throw new Error(`Worker not found: ${n}`)
    return {
      fetch: (r: Request) => {
        handed.push(r)
        return door.state == 'off'
          ? Promise.reject(new Error('the tunnel is down'))
          : Promise.resolve(new Response('from the machine'))
      },
    }
  }
  let DISPATCH = { get } as unknown as Env['DISPATCH']
  let door = { DISPATCH, handed, named, state }
  return door
}

// What a caller's request says that is not the machine's business, and what
// it may not say for itself.
let WORDS = {
  'x-yak-grant': 'the-app-grant',
  'x-yak-person': 'a-liar',
  [HEADER]: 'forged',
  [CALLER]: 'operator',
  'x-via': 'a-forged-conversation',
  cookie: 'theme=dark',
}

// The request an app's worker sends back through its binding.
let reach = async (
  over: { space?: Space; app?: App; who?: Who } = {},
  gone = false,
) => {
  let { DISPATCH, handed, named } = gateway(gone ? 'gone' : 'up')
  let res = await tunnel.reach({
    env: { DISPATCH } as unknown as Env,
    req: new Request(
      'https://jeff.yaks.app/mail/api/tunneled/mail/inbound?to=a',
      {
        method: 'POST',
        headers: { ...WORDS, 'content-type': 'text/plain' },
        body: 'a letter',
      },
    ),
    path: '/tunneled/mail/inbound',
    space: over.space ?? tunneled,
    app: over.app ?? mail,
    who: over.who ?? itself,
    refuse: () => Promise.resolve(new Response(null, { status: 403 })),
    json: (status, code) => Response.json({ error: { code } }, { status }),
  })
  return { res: res!, handed, named }
}

let code = async (r: Response) => (await r.json()).error.code

test('only the app itself reaches the machine, and only an app built in the space', async () => {
  let visitor: Who = { person: 'p1', role: 'owner' }
  assertEquals(await code((await reach({ who: visitor })).res), 'not_the_app')
  let copy = { ...mail, installed: { from: 'x' } } as unknown as App
  assertEquals(await code((await reach({ app: copy })).res), 'installed')
  let alone = { ...tunneled, tunnel: null }
  assertEquals(await code((await reach({ space: alone })).res), 'no_tunnel')
})

test('the app’s request goes to its space’s gateway as an app’s, with the platform’s words taken off', async () => {
  let { res, handed, named } = await reach()
  assertEquals(await res.text(), 'from the machine')
  assertEquals(named, ['tunnel-s1'])
  let [r] = handed
  assertEquals(r.url, 'http://machine/mail/inbound?to=a')
  assertEquals(r.method, 'POST')
  assertEquals(await r.text(), 'a letter')
  assertEquals(r.headers.get('content-type'), 'text/plain')
  // Whatever it said of itself, the platform says it is an app's worker.
  assertEquals(r.headers.get(CALLER), 'app')
  for (let h in WORDS) {
    if (h != CALLER) assertEquals(r.headers.has(h), false, h)
  }
})

test('a tunnel with no gateway yet says so', async () => {
  let { res } = await reach({}, true)
  assertEquals(res.status, 503)
  assertEquals(await code(res), 'no_gateway')
})

// ── The machine as its space's owner reaches it ─────────────────────────────

let BOB = 'a0000000-0000-4000-8000-0000000000b0'

// Ada's space with a tunnel and Bob writing in it, behind a gateway.
let door = gateway()
let home = await spaces({ DISPATCH: door.DISPATCH })
let { env } = home.scenario
let ada = (await directory({
  fetch: (r: Request) => dirPart.fetch(r, env),
}).space('ada'))!
let wears = (tunnel: object | null) =>
  stamp(env, { entities: [{ entity: { eid: ada.eid }, tunnel }] })
await wears({ id: T, service: S, adopted: true })
await stamp(env, {
  entities: [{
    entity: { eid: '$seat' },
    member: { space: ada.eid, person: BOB, role: 'editor' },
  }],
})

test('the owner’s request goes to the gateway saying who asks for them, and nothing else of the platform’s', async () => {
  let said = { method: 'POST', headers: WORDS, body: 'a call' }
  let talking = await tunnel.machine(env, ada.eid, ADA, {
    caller: 'operator',
    space: ada.eid,
    via: () => 'a-talk',
  })
  let res = await talking!('http://anywhere/mcp?x=1', said)
  assertEquals(await res.text(), 'from the machine')
  let alone = await tunnel.machine(env, ada.eid, ADA)
  await alone!('http://anywhere/mcp', said)
  assertEquals(door.named, [`tunnel-${ada.eid}`, `tunnel-${ada.eid}`])
  // Their Operator, in its conversation; with nothing said, their connector,
  // whatever the request says of itself.
  assertEquals(
    door.handed.map((r) => [
      r.url,
      r.headers.get(CALLER),
      r.headers.get('x-via'),
      r.headers.get(WITH),
    ]),
    [
      ['http://machine/mcp?x=1', 'operator', 'a-talk', ADA],
      ['http://machine/mcp', 'connector', null, null],
    ],
  )
  assertEquals(await door.handed[0].text(), 'a call')
  for (let h in WORDS) {
    if (h != 'x-via' && h != CALLER && h != WITH) {
      assertEquals(door.handed[0].headers.has(h), false, h)
    }
  }
})

test('nobody but the owner is answered a space’s machine', async () => {
  let asked = door.named.length
  for (let person of [BOB, JEFF, mint(), '']) {
    assertEquals(await tunnel.machine(env, ada.eid, person), null, person)
  }
  assertEquals(await tunnel.machine(env, mint(), ADA), null)
  assertEquals(door.named.length, asked)
})

test('a machine its owner cannot reach is an answer, never a throw', async () => {
  let ending = async () => {
    let res = await (await tunnel.machine(env, ada.eid, ADA))!('http://m/mcp')
    return [res.status, await code(res)]
  }
  door.state = 'gone'
  assertEquals(await ending(), [503, 'no_gateway'])
  door.state = 'off'
  assertEquals(await ending(), [502, 'unreached'])
  await wears(null)
  assertEquals(await ending(), [404, 'no_tunnel'])
})

// ── The machine telling its owner's Operator ────────────────────────────────

// A session of Ada's Operator that works for her conversation.
let HELPER = mint()

// Ada's space with a tunnel, and what its Operator was asked to take in.
let telling = async () => {
  let asked: Request[] = []
  let f = await spaces({
    BUILDER: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (r: Request) => {
          if (new URL(r.url).pathname == '/operator/read') {
            let { task } = await r.json()
            return Response.json({}, { status: task == HELPER ? 200 : 404 })
          }
          asked.push(r)
          return Response.json({ request: 'r' }, { status: 202 })
        },
      }),
    } as unknown as Env['BUILDER'],
  })
  let { env } = f.scenario
  let ada = (await directory({
    fetch: (r: Request) => dirPart.fetch(r, env),
  }).space('ada'))!
  let wears = (tunnel: object | null) =>
    stamp(env, { entities: [{ entity: { eid: ada.eid }, tunnel }] })
  await wears({ id: T, service: S, adopted: true })
  let tell = (who: string | null, more: Record<string, string> = {}) =>
    f.door(who, {
      do: 'tell',
      conversation: rootOf(ada.eid, ADA),
      key: 'k1',
      text: 'T-7 completed by TaskMaster: Give the Worker a token',
      ...more,
    })
  return { ...f, ada, asked, tell, wears }
}

test("the machine's word is a request on its owner's Operator's machine channel, one for each knock", async () => {
  let t = await telling()
  await using _ = t.scenario
  assertEquals((await t.tell(ADA)).body, { space: 'ada', request: 'r' })
  // A session working for her conversation is found where it is held, and
  // what a knock is about rides with its request.
  let task = mint()
  assertEquals(
    (await t.tell(ADA, { conversation: HELPER, about: task })).status,
    200,
  )
  let [first, again] = await Promise.all(t.asked.map((r) => r.json()))
  assertEquals(new URL(t.asked[0].url).pathname, '/operator/receive')
  assertEquals(t.asked[0].headers.get('x-yak-person'), ADA)
  assertEquals(first, {
    say: 'T-7 completed by TaskMaster: Give the Worker a token',
    request: { channel: 'machine' },
    options: { id: derivedEid(`operator-machine|${t.ada.eid}|k1`) },
  })
  assertEquals(again.options, first.options)
  assertEquals(again.request, { channel: 'machine', about: task })
})

test('only the owner of a space with a tunnel tells its Operator, and only something', async () => {
  let t = await telling()
  await using _ = t.scenario
  assertEquals((await t.tell(null)).status, 403)
  assertEquals((await t.tell(JEFF)).body.error.code, 'no_conversation')
  assertEquals((await t.tell(ADA, { text: ' ' })).status, 400)
  assertEquals(
    (await t.tell(ADA, { conversation: mint() })).body.error.code,
    'no_conversation',
  )
  await t.wears(null)
  assertEquals((await t.tell(ADA)).body.error.code, 'no_conversation')
  assertEquals(t.asked, [])
})
