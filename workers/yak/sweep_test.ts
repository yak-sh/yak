// The mover's sweep door (sweep.ts) over the platform in memory: the owner of
// the platform's space lists every store and reaches one at a time; nobody
// else does, and a name the directory does not hold wakes nothing.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { directory, stamp } from './directory.ts'
import * as dirPart from './directory.ts'
import { sign } from './lib/token.ts'
import * as sweep from './sweep.ts'
import { platform } from './testing.ts'

let SECRET = 'a probe secret'
let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let JEFF = 'a0000000-0000-4000-8000-00000000000f'

// Ada owns `ada`, which holds one app; Jeff owns `yak`, the platform's own.
let spaces = async () => {
  let scenario = platform(SECRET)
  let { env } = scenario
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
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
      {
        entity: { eid: '$app' },
        doc: { title: 'notes' },
        app: { slug: 'notes', space: '$space', store: 'ada/notes.abc123' },
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
  let door = async (who: string, query = '', method = 'GET') => {
    let cookie = `yak_session=${await sign(
      { person: who, space: null, exp: Date.now() + 60_000 },
      SECRET,
    )}`
    let r = await sweep.fetch(
      new Request(`https://yaks.app${sweep.PATH}${query}`, {
        method,
        headers: { cookie },
      }),
      env,
    )
    return { status: r.status, body: await r.json() }
  }
  return { scenario, door }
}

test('the platform’s owner sweeps every store, one at a time', async () => {
  let { scenario, door } = await spaces()
  await using _ = scenario
  let listed = await door(JEFF)
  let handles = listed.body.map((s: sweep.Swept) => s.store)
  assertEquals(handles, [...new Set(handles)])
  assertEquals(
    listed.body.map((s: sweep.Swept) => s.at).filter((at: string) =>
      at == 'ada/notes' || at == 'git' || at == 'directory'
    ),
    ['ada/notes', 'git', 'directory'],
  )
  let rehearsed = await door(JEFF, '?store=ada/notes.abc123&rehearse=1', 'POST')
  assertEquals(rehearsed.body.store, 'ada/notes.abc123')
  assertEquals(
    (await door(JEFF, '?store=ada/nothing', 'POST')).body.error.code,
    'no_store',
  )
})

test('nobody else sweeps', async () => {
  let { scenario, door } = await spaces()
  await using _ = scenario
  assertEquals((await door(ADA)).status, 403)
  assertEquals(
    (await door(ADA, '?store=ada/notes.abc123&rehearse=1', 'POST')).status,
    403,
  )
})

// Three test accounts and a person: `probe` alone in its own space and seated
// in Ada's, with a grant on her app; `guest` an editor in `probe`'s space.
let accounts = async () => {
  let { scenario } = await spaces()
  let { env } = scenario
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)
  let PROBE = 'a0000000-0000-4000-8000-0000000000b1'
  let GUEST = 'a0000000-0000-4000-8000-0000000000b2'
  let demo = 'a0000000-0000-4000-8000-0000000000b3'
  let ada = (await dir.space('ada'))!
  let notes = (await dir.apps(ada))[0]
  await stamp(env, {
    entities: [
      { entity: { eid: ADA }, email: { address: 'ada@example.com' } },
      {
        entity: { eid: PROBE },
        person: {},
        email: { address: 'probe@bot.yak.sh' },
      },
      {
        entity: { eid: GUEST },
        person: {},
        email: { address: 'guest@probe.invalid' },
      },
      {
        entity: { eid: demo },
        person: {},
        email: { address: 'yourname@bot.yak.sh' },
      },
      {
        entity: { eid: '$space' },
        doc: { title: 'probe' },
        space: { slug: 'probe', store: 'probe' },
      },
      {
        entity: { eid: '$own' },
        member: { space: '$space', person: PROBE, role: 'owner' },
      },
      {
        entity: { eid: '$guest' },
        member: { space: '$space', person: GUEST, role: 'editor' },
      },
      {
        entity: { eid: '$there' },
        member: { space: ada.eid, person: PROBE, role: 'editor' },
      },
      {
        entity: { eid: '$grant' },
        grant: { app: notes.eid, person: PROBE, access: 'editor' },
      },
    ],
  })
  let token = (who: string) =>
    sign({ person: who, space: null, exp: Date.now() + 60_000 }, SECRET)
  let ask = async (who: string, address: string, method = 'DELETE') => {
    let r = await sweep.fetch(
      new Request(
        `https://yaks.app${sweep.ACCOUNT_PATH}?address=${
          encodeURIComponent(address)
        }`,
        { method, headers: { cookie: `yak_session=${await token(who)}` } },
      ),
      env,
    )
    return { status: r.status, body: await r.json() }
  }
  return { scenario, env, dir, ask, PROBE, GUEST }
}

test('erasing a test account takes its spaces, seats and grants, and keeps the rest', async () => {
  let { scenario, dir, ask, PROBE, GUEST } = await accounts()
  await using _ = scenario
  let checked = await ask(JEFF, 'probe@bot.yak.sh', 'GET')
  assertEquals(checked.body, {
    address: 'probe@bot.yak.sh',
    erased: false,
    spaces: ['probe'],
    seats: ['ada'],
  })
  assertEquals((await dir.space('probe'))?.slug, 'probe')
  let erased = await ask(JEFF, 'probe@bot.yak.sh')
  assertEquals(erased.body.erased, true)
  assertEquals(await dir.space('probe'), null)
  assertEquals(await dir.emailAt(PROBE), null)
  let ada = (await dir.space('ada'))!
  assertEquals(await dir.members(ada), [ADA])
  assertEquals(await dir.emailAt(GUEST), 'guest@probe.invalid')
  assertEquals((await ask(JEFF, 'probe@bot.yak.sh')).status, 404)
})

test('only the admin, or the account itself, erases it; never a person or fixture', async () => {
  let { scenario, dir, ask, PROBE } = await accounts()
  await using _ = scenario
  assertEquals((await ask(ADA, 'probe@bot.yak.sh')).status, 403)
  // Nobody but the admin learns who has an account.
  for (let address of ['nobody@bot.yak.sh', 'ada@example.com']) {
    assertEquals((await ask(PROBE, address)).status, 403)
  }
  assertEquals((await ask(PROBE, 'probe@bot.yak.sh', 'GET')).status, 403)
  for (let address of ['ada@example.com', 'yourname@bot.yak.sh']) {
    let no = await ask(JEFF, address).catch((why) => why)
    assertEquals(no.code ?? no.body?.error?.code, 'access')
  }
  assertEquals(await dir.emailAt(ADA), 'ada@example.com')
  assertEquals((await ask(PROBE, 'probe@bot.yak.sh')).body.erased, true)
})
