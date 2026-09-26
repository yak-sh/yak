import { assertEquals } from '@std/assert'
import { HEADER } from '@yaks/tunnel'
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
    let url = new URL(new Request(input, init).url)
    if (url.hostname != 'api.cloudflare.com') return was(input, init)
    let path = url.pathname.split('/acct')[1]
    made.push(`${init?.method} ${path}`)
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

// Ada owns `ada`; Jeff owns `yak`, the platform's own space.
let spaces = async (vars: Partial<Env> = TOKENS) => {
  let scenario = platform(SECRET, vars)
  let { env } = scenario
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
  await dir.apply({
    entities: [
      { entity: { eid: ADA }, person: {} },
      {
        entity: { eid: '$space' },
        doc: { title: 'ada' },
        space: { slug: 'ada' },
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

Deno.test('only the platform adopts a pair, since its ids name the platform’s resources', async () => {
  using cf = account()
  let { scenario, door, gateway } = await spaces()
  using _ = scenario
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

Deno.test('an adopted pair rotates only its gateway, and disconnecting leaves the tunnel alone', async () => {
  using cf = account()
  let { scenario, door, gateway } = await spaces()
  using _ = scenario
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

Deno.test('no gateway can be uploaded without the workers token, so no tunnel is made', async () => {
  let { scenario, door } = await spaces({ CF_ACCOUNT: 'acct' })
  using _ = scenario
  assertEquals((await door(JEFF, adopt)).body.error.code, 'no_token')
  assertEquals((await door(ADA, { space: 'ada' })).body.tunnel, null)
})

Deno.test('connect makes a pair and its gateway, answering the token once', async () => {
  using cf = account()
  let { scenario, door, gateway } = await spaces()
  using _ = scenario
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
  title: 'jeff',
  tier: null,
  plan: null,
  stripe: null,
  fee: 0,
  meter: null,
  told: false,
  trashed: null,
  slugs: [],
  tunnel: { id: T, service: S, adopted: true },
}
let mail: App = {
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
  seeded: null,
  trashed: null,
  theme: null,
}
let itself: Who = { person: mail.eid, role: 'editor' }

// The request an app's worker sends back through its binding, and what the
// gateway it lands at was handed; `gone` is a tunnel with no gateway yet. The
// namespace refuses a `get` without the caller its outbound Worker declares,
// the way Cloudflare's does.
let reach = async (
  over: { space?: Space; app?: App; who?: Who } = {},
  gone = false,
) => {
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
    if (gone) throw new Error(`Worker not found: ${n}`)
    return {
      fetch: (r: Request) => {
        handed.push(r)
        return Promise.resolve(new Response('from the machine'))
      },
    }
  }
  let res = await tunnel.reach({
    env: {
      DISPATCH: { get },
    } as unknown as Env,
    req: new Request(
      'https://jeff.yaks.app/mail/api/tunneled/mail/inbound?to=a',
      {
        method: 'POST',
        headers: {
          'x-yak-grant': 'the-app-grant',
          'x-yak-person': 'a-liar',
          [HEADER]: 'forged',
          cookie: 'theme=dark',
          'content-type': 'text/plain',
        },
        body: 'a letter',
      },
    ),
    path: '/tunneled/mail/inbound',
    space: over.space ?? tunneled,
    app: over.app ?? mail,
    who: over.who ?? itself,
    refuse: () => new Response(null, { status: 403 }),
    json: (status, code) => Response.json({ error: { code } }, { status }),
    visiting: () => Promise.resolve(null),
  })
  return { res: res!, handed, named }
}

let code = async (r: Response) => (await r.json()).error.code

Deno.test('only the app itself reaches the machine, and only an app built in the space', async () => {
  let visitor: Who = { person: 'p1', role: 'owner' }
  assertEquals(await code((await reach({ who: visitor })).res), 'not_the_app')
  let copy = { ...mail, installed: { from: 'x' } } as unknown as App
  assertEquals(await code((await reach({ app: copy })).res), 'installed')
  let alone = { ...tunneled, tunnel: null }
  assertEquals(await code((await reach({ space: alone })).res), 'no_tunnel')
})

Deno.test('the app’s request goes to its space’s gateway with the platform’s words taken off', async () => {
  let { res, handed, named } = await reach()
  assertEquals(await res.text(), 'from the machine')
  assertEquals(named, ['tunnel-s1'])
  let [r] = handed
  assertEquals(r.url, 'http://machine/mail/inbound?to=a')
  assertEquals(r.method, 'POST')
  assertEquals(await r.text(), 'a letter')
  assertEquals(r.headers.get('content-type'), 'text/plain')
  for (let h of ['x-yak-grant', 'x-yak-person', HEADER, 'cookie']) {
    assertEquals(r.headers.has(h), false, h)
  }
})

Deno.test('a tunnel with no gateway yet says so', async () => {
  let { res } = await reach({}, true)
  assertEquals(res.status, 503)
  assertEquals(await code(res), 'no_gateway')
})
