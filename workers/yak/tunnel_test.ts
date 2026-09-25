import { assertEquals } from '@std/assert'
import { directory, stamp } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { sign } from './lib/token.ts'
import { platform } from './testing.ts'
import * as tunnel from './tunnel.ts'

let SECRET = 'a probe secret'
let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let JEFF = 'a0000000-0000-4000-8000-00000000000f'
let T = '11111111-2222-4333-8444-555555555555'
let S = '66666666-7777-4888-8999-aaaaaaaaaaaa'

let as = async (person: string) =>
  `yak_session=${await sign(
    { person, space: null, exp: Date.now() + 60_000 },
    SECRET,
  )}`

// Ada owns `ada`; Jeff owns `yak`, the platform's own space.
let spaces = async (vars: Partial<Env> = {}) => {
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
  return { scenario, door }
}

let adopt = { space: 'ada', do: 'adopt', tunnel: T, service: S }

Deno.test('only the platform adopts a pair, since its ids name the platform’s resources', async () => {
  let { scenario, door } = await spaces()
  using _ = scenario
  assertEquals((await door(ADA, adopt)).body.error.code, 'not_platform')
  assertEquals((await door(null, adopt)).status, 403)
  assertEquals((await door(JEFF, { ...adopt, service: 'x' })).status, 400)
  assertEquals((await door(JEFF, adopt)).status, 200)
  assertEquals((await door(ADA, { space: 'ada' })).body, {
    space: 'ada',
    tunnel: { id: T, service: S, adopted: true },
  })
})

Deno.test('disconnecting an adopted pair forgets it and leaves the tunnel alone', async () => {
  // No Cloudflare token: a call to the account would be refused, not made.
  let { scenario, door } = await spaces()
  using _ = scenario
  await door(JEFF, adopt)
  assertEquals((await door(ADA, { space: 'ada', do: 'rotate' })).status, 409)
  assertEquals((await door(ADA, { space: 'ada', do: 'disconnect' })).body, {
    space: 'ada',
    tunnel: null,
  })
})

Deno.test('connect makes a pair for the owner and answers its token once', async () => {
  let { scenario, door } = await spaces({ CF_ACCOUNT: 'acct' })
  using _ = scenario
  let connect = { space: 'ada', do: 'connect', port: '5173' }
  assertEquals((await door(ADA, connect)).body.error.code, 'no_token')
  let was = globalThis.fetch
  let made: string[] = []
  globalThis.fetch = ((input: string | Request, init?: RequestInit) => {
    let url = new URL(new Request(input, init).url)
    if (url.hostname != 'api.cloudflare.com') return was(input, init)
    let path = url.pathname
    made.push(`${init?.method} ${path.split('/acct')[1]}`)
    let result = path.endsWith('/cfd_tunnel')
      ? { id: T, token: 'the-token' }
      : { service_id: S }
    return Promise.resolve(Response.json({ success: true, result }))
  }) as typeof fetch
  try {
    let tokened = await spaces({ CF_ACCOUNT: 'acct', CF_TUNNEL_TOKEN: 'cf' })
    using __ = tokened.scenario
    assertEquals((await tokened.door(ADA, connect)).body, {
      space: 'ada',
      tunnel: { id: T, service: S, adopted: false },
      token: 'the-token',
    })
    assertEquals(
      (await tokened.door(ADA, { space: 'ada' })).body.token,
      undefined,
    )
    assertEquals((await tokened.door(ADA, connect)).status, 409)
    await tokened.door(ADA, { space: 'ada', do: 'disconnect' })
    assertEquals(made, [
      'POST /cfd_tunnel',
      'POST /connectivity/directory/services',
      `DELETE /connectivity/directory/services/${S}`,
      `DELETE /cfd_tunnel/${T}`,
    ])
  } finally {
    globalThis.fetch = was
  }
})
