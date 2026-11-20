import type { Bundle } from '@yaks/graph'
import { meta } from './meta.ts'
// The mover's sweep door (sweep.ts) over the platform in memory: the owner of
// the platform's space lists every store and reaches one at a time; nobody
// else does, and a name the directory does not hold wakes nothing.
import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import { appStore, directory, stamp } from './directory.ts'
import { KERNEL, metaOf } from './meta.ts'
import * as dirPart from './directory.ts'
import { sign } from './lib/token.ts'
import * as sweep from './sweep.ts'
import type { Grave } from '@yaks/platform/graves'
import type { Swept } from '@yaks/platform/mover'
import { platform } from './testing.ts'
import { builderOf } from './build-door.ts'
import { WAKE } from './door.ts'
import { within } from './defects.ts'
import * as identity from './identity.ts'

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
      { entity: { eid: JEFF }, person: {} },
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
  let [action] = await meta(scenario.env).query(
    '.admin_action.operation=move&*',
  )
  assertEquals(action.admin_action, {
    person: JEFF,
    operation: 'move',
    store: 'ada/notes.abc123',
    rehearse: true,
  })
  assertEquals((action.created as { by: string }).by, JEFF)
  assertEquals(typeof (action.created as { via: string }).via, 'string')
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
  assertEquals(
    (await door(ADA, '?space=ada', 'POST', sweep.OPERATOR_GRAPH_PATH, {
      q: '.task',
    })).status,
    403,
  )
})

test('the platform’s owner queries a space’s Operator store and trashes its rows', async () => {
  let { scenario, door } = await spaces()
  await using _ = scenario
  let ask = (body: unknown, space = 'ada') =>
    door(JEFF, `?space=${space}`, 'POST', sweep.OPERATOR_GRAPH_PATH, body)
  let made = await ask({
    bundles: [{ entity: { eid: '$t' }, task: {}, doc: { title: 'stray' } }],
  })
  let eid = made.body[0].entity.eid
  assertEquals((made.body[0].created as { by: string }).by, JEFF)
  let found = await ask({ q: '.doc.title=stray' })
  assertEquals(found.body.map((b: Bundle) => b.entity.eid), [eid])
  await ask({ bundles: [{ entity: { eid }, $delete: true }] })
  assertEquals((await ask({ q: '.doc.title=stray' })).body, [])
  let [action] = await meta(scenario.env).query(
    '.admin_action.operation=operator_apply&*',
  )
  assertEquals((action.created as { by: string }).by, JEFF)
  assertEquals(
    (await ask({ q: '.task' }, 'nobody')).body.error.code,
    'no_space',
  )
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
  let copied = await meta(env).query('.admin_action.operation=operator_copy&*')
  assertEquals(copied.length, 1)
  assertEquals((copied[0].admin_action as { space: string }).space, ada.eid)
  assertEquals((copied[0].created as { by: string }).by, JEFF)
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

test('closing and purging an account with an open Builder succeeds without defects', async () => {
  let { scenario, env, dir, ask, PROBE } = await accounts()
  await using _ = scenario
  let space = (await dir.space('probe'))!
  let opened = await builderOf(env, space.eid)(() =>
    new Request('https://builder' + WAKE, { headers: KERNEL })
  )
  assertEquals(opened.status, 204)
  await scenario.settled()
  let ctx = scenario.states.get(`builder ${space.eid}`)!
  await ctx.storage.setAlarm(Date.now() + 60_000)
  let reports: unknown[] = []
  await within(
    {
      ERRORS: { send: (rows) => Promise.resolve(void reports.push(rows)) },
    },
    { request: 'gateway fetch' },
    async () => {
      let closed = await ask(JEFF, 'probe@bot.yak.sh')
      assertEquals([closed.status, closed.body.trashed], [200, true])
      let cookie = await sign(
        { person: JEFF, space: null, exp: Date.now() + 60_000 },
        SECRET,
      )
      let purged = await identity.fetch(
        new Request(closed.body.purge, {
          method: 'POST',
          headers: { cookie: `yak_session=${cookie}` },
          body: new URLSearchParams({ confirm: PROBE }),
        }),
        env,
      )
      let page = await purged.text()
      assertEquals(purged.status, 200, page)
      assertStringIncludes(page, 'is erased from the trash')
      assertEquals(await dir.at(space.eid), null)
      assertEquals(ctx.pitr.aborts, 1)
      assertEquals(await ctx.storage.getAlarm(), null)
    },
  )
  assertEquals(reports, [])
})

test('closing a test account keeps its ownership while a number waits in the trash', async () => {
  let { scenario, env, dir, ask, PROBE } = await accounts()
  await using _ = scenario
  let space = (await dir.space('probe'))!
  await stamp(env, {
    entities: [{
      entity: { eid: crypto.randomUUID() },
      phone_line: {
        number: '+18335550100',
        via: 'telnyx',
        space: space.eid,
        monthly: 1,
      },
    }],
  })
  let answer = await ask(JEFF, 'probe@bot.yak.sh')
  assertEquals(answer.body.erased, false)
  assertEquals(answer.body.pending, true)
  assertEquals(await dir.emailAt(PROBE), 'probe@bot.yak.sh')
  assertEquals(await dir.owners(space), [PROBE])
  let marked = (await dir.at(space.eid))!.trashed
  assertEquals(!!marked, true)
  await ask(JEFF, 'probe@bot.yak.sh')
  assertEquals((await dir.at(space.eid))!.trashed, marked)
})

test('trashing a test account retains its spaces, seats and identity', async () => {
  let { scenario, dir, ask, PROBE, GUEST } = await accounts()
  await using _ = scenario
  let checked = await ask(JEFF, 'probe@bot.yak.sh', 'GET')
  assertEquals(checked.body, {
    address: 'probe@bot.yak.sh',
    erased: false,
    trashed: false,
    restored: false,
    spaces: ['probe'],
    seats: ['ada'],
  })
  assertEquals((await dir.space('probe'))?.slug, 'probe')
  let erased = await ask(JEFF, 'probe@bot.yak.sh')
  assertEquals(erased.body.trashed, true)
  assertEquals(!!(await dir.space('probe'))?.trashed, true)
  assertEquals(await dir.emailAt(PROBE), 'probe@bot.yak.sh')
  let ada = (await dir.space('ada'))!
  assertEquals((await dir.members(ada)).sort(), [ADA, PROBE].sort())
  assertEquals(await dir.emailAt(GUEST), 'guest@probe.invalid')
  assertEquals((await ask(JEFF, 'probe@bot.yak.sh')).status, 200)
  assertEquals(
    (await ask(JEFF, 'probe@bot.yak.sh', 'POST')).body.restored,
    true,
  )
  assertEquals(!!(await dir.at(PROBE))?.trashed, false)
})

// A space is never left without an owner: one whose last owner is a test
// account passes to whoever else sits in it, a person before a test account.
test('account trash preserves ownership until a confirmed purge', async () => {
  let { scenario, env, dir, ask, PROBE, GUEST } = await accounts()
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
  assertEquals(await dir.owners(probe), [PROBE])
  assertEquals((await dir.members(probe)).sort(), [PROBE, GUEST, ADA].sort())
})

test('account trash keeps a protected space and its owner', async () => {
  let { scenario, env, dir, ask, PROBE } = await accounts()
  await using _ = scenario
  let probe = (await dir.space('probe'))!
  await stamp(env, {
    entities: [{
      entity: { eid: probe.eid },
      space: { slug: 'checks', store: 'probe' },
    }],
  })
  await ask(JEFF, 'probe@bot.yak.sh')
  assertEquals(await dir.owners((await dir.space('checks'))!), [PROBE])
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
    assertEquals((await ask(JEFF, address, 'GET')).status, 200)
    let no = await ask(JEFF, address).catch((why) => why)
    assertEquals(no.code ?? no.body?.error?.code, 'access')
  }
  assertEquals(await dir.emailAt(ADA), 'ada@example.com')
  assertEquals((await ask(PROBE, 'probe@bot.yak.sh')).body.trashed, true)
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

test('the platform’s owner reads the directory’s graves, and what still tells of each', async () => {
  let { scenario, door, dir } = await spaces()
  await using _ = scenario
  let ada = (await dir.space('ada'))!
  let [notes] = await dir.apps(ada)
  let since = new Date().toISOString()
  let [second] = await dir.apply({
    entities: [{ entity: { eid: '$b' }, doc: { title: 'second' } }],
  })
  await dir.apply({
    entities: [
      { entity: { eid: notes.eid }, tombstone: {} },
      { entity: { eid: second.entity.eid }, tombstone: {} },
    ],
  }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
  // An erase forever purges what the trash and the journal kept of its app
  // (erase.ts), so its grave is an eid and a time alone.
  await dir.purgeTrashEntities([notes.eid])
  let read = (q: string) => door(JEFF, q, 'GET', sweep.GRAVES_PATH)
  let page = await read(`?since=${since}`)
  let told = (
    g: Grave,
  ) => [g.eid, g.by, g.held.doc ?? null, g.kept?.doc ?? null]
  assertEquals(
    page.body.graves.map(told).sort(),
    [
      [notes.eid, null, null, null],
      [second.entity.eid, ADA, { title: 'second' }, { title: 'second' }],
    ].sort(),
  )
  assertEquals(page.body.next, null)
  assertEquals(
    (await read(`?since=${new Date().toISOString()}`)).body.graves,
    [],
  )
  assertEquals((await read('?since=never')).body.error.code, 'window')
  assertEquals(
    (await door(ADA, `?since=${since}`, 'GET', sweep.GRAVES_PATH)).status,
    403,
  )
})

test('the platform’s owner reads which words an app borrows, and from whom, and nobody else does', async () => {
  let { scenario, door, dir } = await spaces()
  await using _ = scenario
  let { env } = scenario
  let BO = 'a0000000-0000-4000-8000-0000000000b0'
  let space = (await dir.space('ada'))!
  await stamp(env, {
    entities: [
      { entity: { eid: BO }, person: {} },
      {
        entity: { eid: '$board' },
        doc: { title: 'board' },
        app: {
          slug: 'board',
          space: space.eid,
          store: 'ada/board.abc123',
          access: 'public',
          worker: 'app-board',
        },
      },
      { entity: { eid: '$bo' }, grant: { app: '$board', person: BO } },
      { entity: { eid: '$ada' }, grant: { app: '$board', person: ADA } },
    ],
  })
  let board = (await dir.app(space, 'board'))!
  await appStore(env.STORE, space, board, env)('/uses', {
    method: 'POST',
    body: JSON.stringify({ note: 'notes' }),
  }, KERNEL)
  let ask = (who: string, app: string) =>
    door(who, `?app=${app}`, 'GET', sweep.USES_PATH)
  assertEquals((await ask(JEFF, 'ada/board')).body, {
    app: 'ada/board',
    access: 'public',
    worker: true,
    grantees: 1,
    uses: { note: 'notes' },
    homes: { notes: 'private' },
  })
  let notes = (await ask(JEFF, 'ada/notes')).body
  assertEquals([notes.access, notes.uses, notes.homes], ['private', {}, {}])
  assertEquals((await ask(JEFF, 'ada/nothing')).body.error.code, 'no_app')
  assertEquals((await ask(ADA, 'ada/board')).status, 403)
})
