// Linking a person's Discord account (T-2345): adding yaks.app's bot to a
// server links whoever added it in the same sign-in, and any member links
// their own from Profile (connections.ts `linkOwn`). Discord is faked at the
// fetch it is called through: its token door answers the server the bot was
// added to, and `/users/@me` the person who signed in.

import { afterAll, test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import type { D1Like } from '@yaks/d1'
import { registration } from '@yaks/connections'
import { line } from '@yaks/query'
import { d1 } from '../../packages/d1/testing.ts'
import { platform, signedInAs } from './testing.ts'
import { directoryOf } from './directory.ts'
import {
  CALLBACK,
  callback,
  connecting,
  ctxOf,
  linkOwn,
} from './connections.ts'
import { KERNEL, meta } from './meta.ts'

let { env } = platform('discord-link', {
  VAULT: d1() as unknown as D1Like,
  VAULT_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))),
})
let dir = directoryOf(env.STORE)
let ann = crypto.randomUUID(), bob = crypto.randomUUID()
let barn = crypto.randomUUID()
await dir.apply({
  entities: [
    ...[ann, bob].map((eid) => ({ entity: { eid }, person: {} })),
    { entity: { eid: barn }, space: { slug: 'barn', store: 'barn' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person: ann, space: barn, role: 'owner' },
    },
  ],
}, { 'x-yak-person': ann, 'x-yak-role': 'owner' })
await meta(env).apply(
  [registration('discord', { id: 'app', secret: 's', bot: 'BOT' })],
  KERNEL,
)
let space = (await dir.at(barn))!

// Who Discord says signed in, and the scopes each sign-in asked for.
let me = { id: '', global_name: '' }
let scopes: string[] = []
let real = globalThis.fetch
afterAll(() => globalThis.fetch = real)
globalThis.fetch = (input, init) => {
  let r = new Request(input, init)
  let url = new URL(r.url)
  if (url.host != 'discord.com') return real(r)
  if (url.pathname == '/api/oauth2/token') {
    return Promise.resolve(Response.json({
      access_token: 'A1',
      refresh_token: 'R1',
      scope: 'bot identify',
      guild: { id: '81384788765712384', name: 'Yak Barn' },
    }))
  }
  if (url.pathname == '/api/users/@me') {
    return Promise.resolve(Response.json(me))
  }
  return Promise.resolve(Response.json({}))
}

// Sent to Discord by `person`, then back from it as `who` in their browser.
let back = async (went: Response, who: typeof me, person: string) => {
  let to = new URL(went.headers.get('location') ?? 'x:')
  scopes.push(to.searchParams.get('scope') ?? '')
  me = who
  return callback({
    env,
    req: new Request(
      `https://yaks.app${CALLBACK}?code=C&state=${
        to.searchParams.get('state')
      }`,
      { headers: { cookie: await signedInAs(env, person) } },
    ),
    path: CALLBACK,
    space: null,
  })
}

// Each person's Discord accounts, as [account, title].
let linked = async (person: string) =>
  (await ctxOf(env).graph.read(line`.connection.owner=${person}&*`))
    .map((b) => b.connection as Record<string, string>)
    .filter((c) =>
      c.integration == 'discord-account' && c.status == 'connected'
    )
    .map((c) => [c.account, c.title])

test('adding the bot to a server links the Discord account of whoever added it', async () => {
  let form = new FormData()
  form.set('do', 'add')
  form.set('integration', 'discord')
  let went = await connecting(
    new Request('https://yaks.app/manage/barn/connections?enable=discord'),
    env,
    space,
    { person: ann, role: 'owner' },
    form,
  ) as Response
  await back(went, { id: '4242', global_name: 'Ann' }, ann)
  assertEquals(scopes.pop(), 'bot identify')
  assertEquals(await linked(ann), [['4242', 'Ann']])
})

test('a member who did not add the bot links their own account from Profile', async () => {
  let went = await linkOwn(
    new Request('https://yaks.app/manage/profile'),
    env,
    { person: bob, role: 'owner' },
    space,
    'discord-account',
    'https://yaks.app/manage/profile',
  )
  await back(went, { id: '5151', global_name: 'Bob' }, bob)
  assertEquals(scopes.pop(), 'identify')
  assertEquals(await linked(bob), [['5151', 'Bob']])
})
