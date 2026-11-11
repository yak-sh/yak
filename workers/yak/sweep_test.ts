// The mover's sweep door (sweep.ts) over the platform in memory: the owner of
// the platform's space lists every store and reaches one at a time; nobody
// else does, and a name the directory does not hold wakes nothing.
import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import { appStore, directory, stamp } from './directory.ts'
import { KERNEL, metaOf } from './meta.ts'
import * as dirPart from './directory.ts'
import { sign } from './lib/token.ts'
import * as sweep from './sweep.ts'
import type { Swept } from '@yaks/platform/mover'
import { platform } from './testing.ts'
import { builderOf } from './build-door.ts'
import { WAKE } from './door.ts'

let SECRET = 'a probe secret'
let ADA = 'a0000000-0000-4000-8000-0000000000ad'
let JEFF = 'a0000000-0000-4000-8000-00000000000f'

// Ada owns `ada`, which holds one app; Jeff owns `yak`, the platform's own.
let AS_ADA = { ...KERNEL, 'x-yak-person': ADA, 'x-yak-role': 'owner' }

let spaces = async () => {
  let scenario = platform(SECRET)
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
  let door = async (
    who: string,
    query = '',
    method = 'GET',
    path = sweep.PATH,
    body?: unknown,
  ) => {
    let cookie = `yak_session=${await sign(
      { person: who, space: null, exp: Date.now() + 60_000 },
      SECRET,
    )}`
    let r = await sweep.fetch(
      new Request(`https://yaks.app${path}${query}`, {
        method,
        headers: { cookie },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    )
    return { status: r.status, body: await r.json() }
  }
  return { scenario, door, dir }
}

test('the platform’s owner sweeps every store, one at a time', async () => {
  let { scenario, door } = await spaces()
  await using _ = scenario
  let listed = await door(JEFF)
  let handles = listed.body.map((s: Swept) => s.store)
  assertEquals(handles, [...new Set(handles)])
  assertEquals(
    listed.body.map((s: Swept) => s.at).filter((at: string) =>
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
  assertEquals((await door(ADA, '', 'GET', sweep.OPERATOR_PATH)).status, 403)
})

test('the platform’s owner reads a space’s Operator store out, a table at a time', async () => {
  let { scenario, dir } = await spaces()
  await using _ = scenario
  let { env } = scenario
  let ada = (await dir.space('ada'))!
  // A wake makes the Operator's store, which a copy then reads.
  await builderOf(env, ada.eid)(() =>
    new Request('https://builder' + WAKE, {
      method: 'POST',
      headers: { 'x-yak-kernel': '1' },
    })
  )
  let cookie = `yak_session=${await sign(
    { person: JEFF, space: null, exp: Date.now() + 60_000 },
    SECRET,
  )}`
  let ask = async (query: string, body?: unknown) => {
    let r = await sweep.fetch(
      new Request(`https://yaks.app${sweep.OPERATOR_PATH}${query}`, {
        method: body ? 'POST' : 'GET',
        headers: { cookie },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env,
    )
    return { status: r.status, body: await r.json() }
  }
  let listed = (await ask('')).body as { eid: string; slug: string }[]
  assertEquals(listed.find((s) => s.slug == 'ada')?.eid, ada.eid)
  let { plan } = (await ask(`?space=${ada.eid}`, {})).body
  let entity = plan.tables.find((t: { name: string }) => t.name == 'entity')
  let read = (await ask(`?space=${ada.eid}`, { table: 'entity' })).body
  assertEquals(Array.isArray(read.rows), true)
  assertEquals(
    read.rows.every((r: unknown[]) => r.length == entity.cols.length + 1),
    true,
  )
  assertEquals((await ask('?space=nobody', {})).body.error.code, 'no_space')
})

test('the platform’s owner reads an app’s store out, a table at a time, and nobody else does', async () => {
  let { scenario, door } = await spaces()
  await using _ = scenario
  let ask = (who: string, query: string, body?: unknown) =>
    door(who, query, body ? 'POST' : 'GET', sweep.STORE_COPY_PATH, body)
  let listed = (await ask(JEFF, '')).body as Swept[]
  assertEquals(
    listed.find((s) => s.at == 'ada/notes')?.store,
    'ada/notes.abc123',
  )
  assertEquals(listed.some((s) => s.at == 'git' || s.at == 'directory'), false)
  let { plan } = (await ask(JEFF, '?store=ada/notes.abc123', {})).body
  let entity = plan.tables.find((t: { name: string }) => t.name == 'entity')
  let read = (await ask(JEFF, '?store=ada/notes.abc123', { table: 'entity' }))
    .body
  assertEquals(
    read.rows.every((r: unknown[]) => r.length == entity.cols.length + 1),
    true,
  )
  let refused = async (query: string, body: unknown) =>
    (await ask(JEFF, query, body)).body.error.code
  assertEquals(await refused('?store=ada/nothing', {}), 'no_store')
  assertEquals(await refused('?store=yak/git', { table: 'entity' }), 'no_store')
  assertEquals(
    await refused('?store=ada/notes.abc123', { table: 'nothing' }),
    'no_table',
  )
  assertEquals(await refused('?store=ada/nothing', { table: 'x' }), 'no_table')
  assertEquals((await ask(ADA, '')).status, 403)
})

// Three test accounts and a person: `probe` alone in its own space and seated
// in Ada's, with a grant on her app; `guest` an editor in `probe`'s space.
let accounts = async () => {
  let { scenario } = await spaces()
  let { env } = scenario
  let dir = directory({ fetch: (r: Request) => dirPart.fetch(r, env) })
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

// A space is never left without an owner: one whose last owner is a test
// account passes to whoever else sits in it, a person before a test account.
test('erasing a test account hands a space it owns on to the person left in it', async () => {
  let { scenario, env, dir, ask, GUEST } = await accounts()
  await using _ = scenario
  let probe = (await dir.space('probe'))!
  await stamp(env, {
    entities: [{
      entity: { eid: '$ada' },
      member: { space: probe.eid, person: ADA, role: 'editor' },
    }],
  })
  let checked = await ask(JEFF, 'probe@bot.yak.sh', 'GET')
  assertEquals(checked.body.spaces, [])
  assertEquals(checked.body.seats.sort(), ['ada', 'probe'])
  await ask(JEFF, 'probe@bot.yak.sh')
  assertEquals(await dir.owners(probe), [ADA])
  assertEquals((await dir.members(probe)).sort(), [GUEST, ADA].sort())
})

test('erasing a test account hands a space it owns on to a test account left in a kept space', async () => {
  let { scenario, env, dir, ask, GUEST } = await accounts()
  await using _ = scenario
  let probe = (await dir.space('probe'))!
  await stamp(env, {
    entities: [{
      entity: { eid: probe.eid },
      space: { slug: 'checks', store: 'probe' },
    }],
  })
  await ask(JEFF, 'probe@bot.yak.sh')
  assertEquals(await dir.owners((await dir.space('checks'))!), [GUEST])
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

test('an app’s store moves to a new object, and the directory names it there', async () => {
  let { scenario, door, dir } = await spaces()
  await using _ = scenario
  let { env, states } = scenario
  let space = (await dir.space('ada'))!
  let notes = async () =>
    metaOf(
      appStore(env.STORE, space, (await dir.app(space, 'notes'))!),
      AS_ADA,
    )
  let titles = async () =>
    (await (await notes()).query('.doc')).map((b) =>
      String((b.doc as { title?: string })?.title)
    ).sort()
  let move = (query: string) =>
    door(JEFF, `?store=ada/notes.abc123&${query}`, 'POST', sweep.RELOCATE_PATH)
  await (await notes()).apply([{
    entity: { eid: '$a' },
    doc: { title: 'before' },
  }], KERNEL)
  assertEquals(await titles(), ['before'])
  assertEquals((await move('prepare=ada/notes.near')).status, 200)
  await (await notes()).apply([{
    entity: { eid: '$b' },
    doc: { title: 'during' },
  }], KERNEL)
  let moved = await move('to=ada/notes.near')
  assertEquals(moved.status, 200, JSON.stringify(moved.body))
  assertEquals([moved.body.to, moved.body.forgot], ['ada/notes.near', true])

  assertEquals((await dir.app(space, 'notes'))!.store, 'ada/notes.near')
  assertEquals(await titles(), ['before', 'during'])
  // A caller still holding the old handle is handed on to the new object, and
  // the old one keeps none of what was written.
  let old = metaOf(
    appStore(env.STORE, space, {
      ...(await dir.app(space, 'notes'))!,
      store: 'ada/notes.abc123',
    }),
    KERNEL,
  )
  await old.apply([{ entity: { eid: '$c' }, doc: { title: 'late' } }], KERNEL)
  assertEquals(await titles(), ['before', 'during', 'late'])
  assertEquals(
    await states.get('ada/notes.abc123')!.storage.get('relocated'),
    'ada/notes.near',
  )
  assertEquals(
    await states.get('ada/notes.abc123')!.storage.get('name'),
    undefined,
  )

  // The old handle is no app's store any more, so nothing moves it again.
  assertEquals((await move('to=ada/notes.near')).status, 404)
  assertEquals(
    (await door(ADA, '?store=ada/notes.near&to=x', 'POST', sweep.RELOCATE_PATH))
      .status,
    403,
  )
})
