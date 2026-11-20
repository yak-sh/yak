/// <reference lib="deno.ns" />
// A space's Operator's object (build.ts), on the stand-in: its doors, its
// wake and its wipe, and the old builder door that forwards a line into the
// person's conversation.
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import * as apps from './apps.ts'
import { Builder } from './build.ts'
import { builderOf, type Held, NOBODY, OWED, seated } from './build-door.ts'
import { WAKE } from './door.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { ai, modelPage, platform, state, type Turn } from './testing.ts'
import { test, until } from '@yaks/testing'
import { line } from '@yaks/query'
import { sign } from './lib/token.ts'
import { manage } from './manage.ts'
import { operatorStore } from './operator-store.ts'
import { endpoints } from './endpoints.ts'
import { redone } from './defects.ts'
import { restarting } from './running.ts'
import { draftEid } from '@yaks/draft'
import { chatPath } from '@yaks/platform/routes'
import { trashSpace } from './erase.ts'
import { discord } from '@yaks/discord'
import { PASS } from '@yaks/session/turn'
import { arrived } from './chat.ts'

let SECRET = 'a probe secret'
let ADA = 'a0000000-0000-4000-8000-0000000000ad'

// A signed-in person, as the browser carries them — what the form POST below
// arrives with, since the door with no script reads the cookie like every
// other page (serving_test.ts says it the same way).
let as = async (person: string) =>
  `yak_session=${await sign(
    { person, space: null, exp: Date.now() + 60_000 },
    SECRET,
  )}`

let dirOf = (env: Env) =>
  directory({ fetch: (r: Request) => dirPart.fetch(r, env) })

// A space with Ada in it, and her Operator's object, which the kernel reaches
// as the space's BUILDER.
let seeded = async (script: Turn[] = []) => {
  let { env, states } = platform(SECRET, {
    AI: ai(script) as Env['AI'],
    MODEL_FETCH: () =>
      Promise.resolve(
        modelPage(0.15, 0.5),
      ),
  })
  let dir = dirOf(env)
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
  let space = (await dir.space('ada'))!
  let ctx = state()
  let object = new Builder(ctx, env)
  return {
    env,
    space,
    ctx,
    states,
    object,
    held: { person: ADA, role: 'owner', space: space.eid } as Held,
    // The kernel's way to the object, for a test that goes through a door.
    bound: () => {
      env.BUILDER = {
        idFromName: (name) => name,
        get: () => ({ fetch: (req: Request) => object.fetch(req) }),
      }
    },
  }
}

// A page drawn before the New app screen asked the Operator posts its line
// to the space's old builder door (M-37853): it is said in Ada's
// conversation as a request for a new app, and she is sent there.
test('a line posted to the old builder door goes to the Operator as a new app', async () => {
  let o = await seeded()
  o.bound()
  let form = new FormData()
  form.set('say', 'a recipe box please')
  let out = await apps.fetch(
    new Request('https://ada.yaks.app/api/build', {
      method: 'POST',
      body: form,
      headers: { cookie: await as(ADA) },
    }),
    o.env,
  )
  assertEquals(out.status, 303)
  let to = new URL(out.headers.get('location')!)
  let request = to.pathname.split('/').at(-1)!
  assertEquals(to.pathname, chatPath('ada', request))
  let store = await operatorStore(o.ctx.storage)
  let [asked] = await store.g.read(line`.entity.eid=${request}&*`)
  assertEquals(asked.doc, {
    title: 'a recipe box please',
    body: 'a recipe box please',
  })
  let { new_app, page } = asked.operator_request as Record<string, unknown>
  assertEquals([new_app, page], [true, 'https://yaks.app/manage/ada/new'])
})

test('the inline contact form reaches the Builder’s contact confirmation command', async () => {
  let o = await seeded()
  let session = crypto.randomUUID(),
    source = crypto.randomUUID(),
    contact = crypto.randomUUID(),
    number = '+12695550142'
  let store = await operatorStore(o.ctx.storage)
  await store.g.apply([
    {
      entity: { eid: session },
      session: {},
      operator_session: { person: ADA, space: o.space.eid, conversation: true },
    },
    {
      entity: { eid: source },
      entry: { session },
      content: { body: `Text me at ${number} when done.` },
    },
    {
      entity: { eid: contact },
      operator_contact: { person: ADA, address: number, source, session },
    },
  ], { trusted: true })
  o.bound()
  let sent: unknown[] = []
  let phone = endpoints(globalThis).open(async (req) => {
    let path = new URL(req.url).pathname
    if (path == '/messaging_profiles') {
      return Response.json({ data: [{ id: 'profile' }] })
    }
    if (path.endsWith('/phone_numbers')) {
      return Response.json({ data: [{ phone_number: '+18885550100' }] })
    }
    sent.push(await req.json())
    return Response.json({ data: { id: crypto.randomUUID() } })
  })
  Object.assign(o.env, {
    PHONE_SENDER: { via: 'telnyx' },
    TELNYX_API: phone.url,
    TELNYX_API_KEY: 'key',
  })
  let post = async (code = '') => {
    let body = new FormData()
    body.set('contact', contact)
    body.set('number', number)
    body.set('agreed', 'yes')
    if (code) body.set('code', code)
    let response = await manage(
      new Request('https://yaks.app/manage/ada/operator?texts=1', {
        method: 'POST',
        headers: { cookie: await as(ADA), origin: 'https://yaks.app' },
        body,
      }),
      o.env,
    )
    return [response.status, await response.json()]
  }
  let [status, proof] = await post()
  assertEquals([status, proof.pending], [200, true])
  assertEquals((await dirOf(o.env).texting(ADA))?.number, undefined)
  let [code] = String((sent[0] as { text: string }).text).match(/\d{6}/)!
  assertEquals(await post(code), [200, { confirmed: number }])
  assertEquals((await dirOf(o.env).texting(ADA))?.number, number)
  assertEquals(sent.length, 2)
})

test('the old builder door refuses a stranger, and takes only a post', async () => {
  let { env } = await seeded()
  let r = await apps.fetch(
    new Request('https://ada.yaks.app/api/build', { method: 'POST' }),
    env,
  )
  assertEquals(r.status, 401)
  let said = await r.json() as { error: { code: string; message: string } }
  assertEquals(said.error.code, 'not_a_writer')
  assertEquals(said.error.message, NOBODY)
  let socket = await apps.fetch(
    new Request('https://ada.yaks.app/api/build', {
      headers: { upgrade: 'websocket' },
    }),
    env,
  )
  assertEquals(socket.status, 405)
})

// An object's directory reads, the `held`th of them kept from answering
// until let go: a seat read still under way.
let holding = (o: { env: Env }, held: number) => {
  let gate = Promise.withResolvers<void>()
  let reads = 0
  let { STORE } = o.env
  o.env.STORE = {
    ...STORE,
    idFromName: (name) => STORE.idFromName(name),
    get: (id) => {
      let stub = STORE.get(id)
      return {
        ...stub,
        fetch: async (req: Request) => {
          if (reads++ == held) await gate.promise
          return stub.fetch(req)
        },
      } as typeof stub
    },
  }
  return {
    asked: () => reads > held,
    reads: () => reads,
    go: () => gate.resolve(),
  }
}

let asking =
  (o: Awaited<ReturnType<typeof seeded>>, said: string[] = []) =>
  async (path: string) => {
    let r = await o.object.fetch(
      new Request(`https://builder/operator/${path}`, {
        method: 'POST',
        headers: { 'x-space-eid': o.space.eid, 'x-yak-person': ADA },
        body: '{}',
      }),
    )
    await r.body?.cancel()
    said.push(path)
  }

test('a new incarnation makes its store while a seat read is under way', async () => {
  let o = await seeded()
  // What its storage ran before the seat read answered, and in all.
  let ran = 0
  let { sql } = o.ctx.storage
  let exec = sql.exec.bind(sql)
  sql.exec = (...args) => (ran++, exec(...args))
  let seat = holding(o, 0)
  let read = asking(o)('conversation')
  await until(() => seat.asked())
  let held = ran
  seat.go()
  await read
  assert(held > (ran - held) / 2, `${held} of ${ran} ran before the seat`)
})

// What a new incarnation owes (a step a deploy reset under its reply) is taken
// up on a wake, which nobody waits on, never behind an answer somebody does:
// the runtime sends an answer on in turns of the object's event loop.
let posted = (o: Awaited<ReturnType<typeof seeded>>, path: string) =>
  o.object.fetch(
    new Request(`https://builder${path}`, {
      method: 'POST',
      headers: path == WAKE
        ? { 'x-yak-kernel': '1' }
        : { 'x-space-eid': o.space.eid, 'x-yak-person': ADA },
      body: '{}',
    }),
  )

let armed = async (o: { ctx: ReturnType<typeof state> }) =>
  (await o.ctx.storage.getAlarm()) != null

test('an alarm from before the Builder was named clears itself when its space is trashed', async () => {
  let o = await seeded()
  await (await posted(o, '/operator/conversation')).text()
  await trashSpace(o.env, dirOf(o.env), o.space, o.held)
  await o.ctx.storage.setAlarm(Date.now())
  await o.object.alarm()
  assertEquals(await armed(o), false)
  assertEquals(o.ctx.pending.size, 0)
})

test('an alarm delivered after a space is erased does not open the Builder store', async () => {
  let { env } = platform(SECRET)
  let ctx = Object.assign(state('', false), {
    id: { name: crypto.randomUUID() },
  })
  using storage = ctx.storage
  let object = new Builder(ctx, env)
  await storage.setAlarm(Date.now())
  await object.alarm()
  assertEquals(await armed({ ctx }), false)
  assertEquals(ctx.pending.size, 0)
  assertEquals(
    [...storage.sql.exec('select name from sqlite_master')]
      .some((row) => row.name == 'entity'),
    false,
  )
})

// What the wiped incarnation opened knew the file before it was emptied, so
// the object restarts rather than read tables that are gone (T-222): once
// the kernel has its answer, never under the wipe that asked, and what the
// work under way fails with is a reset, which the instance reports none of.
test('a wiped Builder drops its alarm and restarts, and the next incarnation finds nothing', async () => {
  let o = await seeded()
  await (await posted(o, '/operator/conversation')).text()
  await Promise.all(o.ctx.pending)
  let failed: boolean[] = [], abort = o.ctx.abort
  o.ctx.abort = (why?: string) => {
    failed.push(redone(new Error(why), () => restarting(o.ctx)))
    abort()
  }
  let wiped = await o.object.fetch(
    new Request('https://builder/wipe', {
      method: 'POST',
      headers: { 'x-yak-kernel': '1' },
    }),
  )
  await new Promise((go) => setTimeout(go, 1))
  let before = o.ctx.pitr.aborts
  assertEquals(
    [await wiped.json(), before, await armed(o), o.ctx.pitr.aborts, failed],
    [{ ok: true }, 0, false, 1, [true]],
  )
  let tables = [...o.ctx.storage.sql.exec('select name from sqlite_master')]
    .map((r) => String(r.name)).filter((n) => !/^(_cf_|sqlite_)/.test(n))
  assertEquals(tables, [])
})

// A space's Operator is put back to a moment as an app's store is
// (bookmarks.ts, recover.ts): the kernel's alone, the bookmark it is told to
// wake at, and the restart that wakes it there.
test("a space's Operator is put back at the kernel's word alone", async () => {
  let o = await seeded()
  let at = (path: string, init: RequestInit = {}, kernel = true) =>
    o.object.fetch(
      new Request(`https://builder${path}`, {
        ...init,
        headers: kernel ? { 'x-yak-kernel': '1' } : {},
      }),
    )
  assertEquals((await at('/restore', {}, false)).status, 403)
  let { from, to } = await (await at('/restore?at=' + new Date().toISOString()))
    .json()
  assert(from && to, 'no bookmarks')
  let put = await at('/restore', {
    method: 'POST',
    body: JSON.stringify({ bookmark: to }),
  })
  assertEquals(await put.json(), { undo: `undo-${to}` })
  assertEquals(o.ctx.pitr.restore, to)
  await (await at('/restart', { method: 'POST' })).body?.cancel()
  assertEquals(o.ctx.pitr.aborts, 1)
})

test('a new incarnation says it owes work in its answers, and takes the work up on a wake', async () => {
  let o = await seeded()
  let read = await posted(o, '/operator/conversation')
  await read.text()
  await Promise.all(o.ctx.pending)
  let before = await armed(o)
  let woke = await posted(o, WAKE)
  let after = await posted(o, '/operator/conversation')
  await after.text()
  assertEquals(
    [read.headers.has(OWED), before, woke.status, await armed(o)],
    [true, false, 204, true],
  )
  assertEquals(after.headers.has(OWED), false)
})

test('a wake beside an answer still under way leaves the work to the wake behind that answer', async () => {
  let o = await seeded()
  let seat = holding(o, 0)
  let read = posted(o, '/operator/conversation')
  await until(() => seat.asked())
  await (await posted(o, WAKE)).body?.cancel()
  let beside = await armed(o)
  seat.go()
  let answer = await read
  await answer.text()
  await posted(o, WAKE)
  assertEquals([beside, answer.headers.has(OWED), await armed(o)], [
    false,
    true,
    true,
  ])
})

test('the door wakes a space’s object behind an answer that says it owes work', async () => {
  let o = await seeded()
  let answer = await builderOf(o.env, o.space.eid)(() =>
    new Request('https://builder/operator/conversation', {
      method: 'POST',
      headers: { 'x-space-eid': o.space.eid, 'x-yak-person': ADA },
      body: '{}',
    })
  )
  assertEquals(answer.status, 200)
  let ctx = [...o.states].find(([name]) => name.startsWith('builder '))![1]
  await until(() => armed({ ctx }))
})

test('a wake is the kernel’s alone', async () => {
  let o = await seeded()
  let r = await o.object.fetch(new Request(`https://builder${WAKE}`))
  assertEquals(r.status, 403)
  await r.body?.cancel()
})

// Its first request, before anything has made the Operator: the write owes
// the Operator's run all the same.
test('a request a new incarnation receives before it has made its Operator is carried out', async () => {
  let o = await seeded([{ text: 'Done.' }])
  let model = o.env.AI as unknown as ReturnType<typeof ai>
  let r = await o.object.fetch(
    new Request('https://builder/operator/receive', {
      method: 'POST',
      headers: { 'x-space-eid': o.space.eid, 'x-yak-person': ADA },
      body: JSON.stringify({ say: 'hello', request: { channel: 'web' } }),
    }),
  )
  assertEquals(r.status, 202)
  await r.body?.cancel()
  while (o.ctx.pending.size) await Promise.all(o.ctx.pending)
  assertEquals(model.asked.length, 1)
})

// A write holds an object's answer until storage confirms it.
test('a new incarnation answers a chat page writing nothing first', async () => {
  let o = await seeded()
  o.env.CF_VERSION_METADATA = { id: 'v1', timestamp: '2026-11-07T00:00:00Z' }
  await asking(o)('conversation')
  while (o.ctx.pending.size) await Promise.all(o.ctx.pending)
  let wrote: string[] = []
  let { sql } = o.ctx.storage
  let exec = sql.exec.bind(sql)
  sql.exec = (query, ...args) => {
    if (!/^\s*(select|pragma)/i.test(query)) wrote.push(query)
    return exec(query, ...args)
  }
  let again = new Builder(o.ctx, o.env)
  let answer = await again.fetch(
    new Request('https://builder/operator/conversation', {
      method: 'POST',
      headers: { 'x-space-eid': o.space.eid, 'x-yak-person': ADA },
      body: '{}',
    }),
  )
  await answer.text()
  assertEquals(wrote, [])
})

test('an object takes the space and seat the kernel read, and reads them itself only for a caller that read none', async () => {
  let o = await seeded()
  let seat = holding(o, Infinity)
  let ask = async (headers: Record<string, string>) => {
    let r = await o.object.fetch(
      new Request('https://builder/operator/conversation', {
        method: 'POST',
        headers: {
          'x-space-eid': o.space.eid,
          'x-yak-person': ADA,
          ...headers,
        },
        body: '{}',
      }),
    )
    await r.body?.cancel()
    return [r.status, seat.reads()]
  }
  assertEquals([
    await ask(seated(o.space, { person: ADA, role: 'owner' })),
    await ask(seated(o.space, { person: ADA, role: 'viewer' })),
    await ask({}),
  ], [[200, 0], [403, 0], [200, 1]])
})

// The Operator page's own doors onto its store (operator-api.ts), through the
// kernel as the person signed in: what one member writes there, another who
// shares the space never reads.
test('the Operator page reads and writes its store through the kernel as the person signed in', async () => {
  let o = await seeded()
  let BEA = crypto.randomUUID()
  await dirOf(o.env).apply({
    entities: [
      { entity: { eid: BEA }, person: {} },
      {
        entity: { eid: crypto.randomUUID() },
        member: { space: o.space.eid, person: BEA, role: 'editor' },
      },
    ],
  }, { 'x-yak-person': ADA, 'x-yak-role': 'owner' })
  o.env.BUILDER = {
    idFromName: (name) => name,
    get: () => ({ fetch: (req: Request) => o.object.fetch(req) }),
  }
  let door = async (person: string, path: string, init: RequestInit = {}) =>
    await manage(
      new Request(`https://yaks.app/manage/ada/operator/${path}`, {
        ...init,
        headers: { cookie: await as(person), origin: 'https://yaks.app' },
      }),
      o.env,
    )
  let eid = draftEid(ADA, 'operator')
  let wrote = await door(ADA, 'apply', {
    method: 'POST',
    body: JSON.stringify([{
      entity: { eid },
      draft: { by: ADA, place: 'operator', text: 'Plan the bake sale' },
      typed: { over: '' },
    }]),
  })
  let drafts = async (person: string) =>
    (await (await door(person, 'query?q=.draft')).json() as {
      draft: { text: string }
    }[]).map((b) => b.draft.text)
  assertEquals(wrote.status, 200)
  await wrote.body?.cancel()
  assertEquals(await drafts(ADA), ['Plan the bake sale'])
  assertEquals(await drafts(BEA), [])
})

// A message heard on Discord (chat.ts `arrived`), from someone with no seat:
// the kernel brings it, it is the next words of their own conversation, said
// after where it came from, and the Operator's answer is a message to post in
// the same room, answering it, through the bot that heard it.
test('a Discord mention from a guest is heard, and answered in its room', async () => {
  let o = await seeded([{ text: 'It opens at nine.' }])
  let guest = 'c0000000-0000-4000-8000-0000000000c1'
  await dirOf(o.env).apply({
    entities: [{ entity: { eid: guest }, person: {} }],
  }, { 'x-yak-kernel': '1' })
  let connection = crypto.randomUUID()
  let said = {
    id: '1310000000000000001',
    room: '1310000000000000777',
    server: '81384788765712384',
    author: { id: '4242', name: 'Ann' },
    text: 'when does the barn open?',
    at: '2026-11-20T05:40:00.000Z',
    addressed: 'mention',
  }
  let post = () =>
    o.object.fetch(
      new Request('https://builder/operator/chat', {
        method: 'POST',
        headers: {
          'x-yak-kernel': '1',
          'x-space-eid': o.space.eid,
          'x-yak-person': guest,
        },
        body: JSON.stringify({ via: 'discord', connection, said }),
      }),
    )
  let r = await post()
  assertEquals(r.status, 202)
  await r.body?.cancel()
  while (o.ctx.pending.size) await Promise.all(o.ctx.pending)
  let model = o.env.AI as unknown as ReturnType<typeof ai>
  assertEquals(model.asked.length, 1)
  assertStringIncludes(
    JSON.stringify(model.asked[0]),
    'On Discord, naming you, from Ann: when does the barn open?',
  )
  let store = await operatorStore(o.ctx.storage)
  let [answer] = await store.g.read(
    line`.chat_message.connection=${connection}&.deliver&*`,
  )
  assertEquals(answer?.chat_message, {
    via: 'discord',
    connection,
    reply_to: said.id,
  })
  assertEquals((answer.doc as { body: string }).body, 'It opens at nine.')
  let [room] = await store.g.get([(answer.deliver as { to: string }).to])
  assertEquals((room.chat_room as { id: string }).id, said.room)
  // Brought again, it is the same message, and nothing more is asked.
  let again = await post()
  assertEquals(again.status, 200)
  await again.body?.cancel()
  assertEquals(model.asked.length, 1)
})

// The room a space chose for its Operator to hear in full (chat.ts `choose`,
// `arrived`): everything said there is heard in the room's one
// conversation, each line kept as its writer's, and framed as not said to
// it; it answers what is for it and passes the rest, which posts nothing.
// Unaddressed words in any other room are not its, nor once the choice is
// taken back.
test('in the room a space chose, the Operator hears everyone and answers only what is for it', async () => {
  let o = await seeded([{ text: 'It opens at nine.' }, { text: PASS }])
  o.bound()
  let connection = crypto.randomUUID()
  let [SERVER, BARN, ELSEWHERE] = ['81384788765712384', '1310777', '1310888']
  await dirOf(o.env).apply({
    entities: [{
      entity: { eid: connection },
      connection: {
        integration: 'discord',
        owner: o.space.eid,
        account: SERVER,
        status: 'connected',
      },
    }],
  }, { 'x-yak-kernel': '1' })
  // Chosen on the Operator's settings page, as its owner.
  let choose = async (room: string) => {
    let form = new FormData()
    form.set('connection', connection)
    form.set('room', room)
    let r = await manage(
      new Request('https://yaks.app/manage/ada/operator?chat=1', {
        method: 'POST',
        body: form,
        headers: { cookie: await as(ADA), origin: 'https://yaks.app' },
      }),
      o.env,
    )
    assertEquals(r.status, 303)
  }
  await choose(BARN)
  let n = 0
  let say = async (room: string, name: string, text: string) => {
    await arrived(o.env, discord, {
      id: `13100000000000000${++n}`,
      room,
      server: SERVER,
      author: { id: name, name },
      text,
      at: '2026-11-20T05:40:00.000Z',
    })
    while (o.ctx.pending.size) await Promise.all(o.ctx.pending)
  }
  await say(BARN, 'Ann', 'does anyone know when the barn opens?')
  await say(BARN, 'Bo', "I'll bring pie")
  await say(ELSEWHERE, 'Cy', 'when does the barn open?')
  await choose('')
  await say(BARN, 'Di', 'hello?')
  let model = o.env.AI as unknown as ReturnType<typeof ai>
  let asked = model.asked.map((a) => JSON.stringify(a))
  assertEquals(asked.length, 2)
  assertStringIncludes(
    asked[0],
    'On Discord, in a room you hear but were not addressed in, from Ann: does anyone know',
  )
  assertStringIncludes(asked[0], 'These words were not said to you.')
  let store = await operatorStore(o.ctx.storage)
  let words = await store.g.read(
    '.entry.session&.intake&.fields=entry.session,created.by',
  )
  let by = words.map((b) => (b.created as { by: string }).by)
  assertEquals(
    new Set(words.map((b) => (b.entry as { session: string }).session)).size,
    1,
  )
  assertEquals(new Set(by).size, 2)
  assert(!by.includes(ADA))
  let posted = await store.g.read(
    line`.chat_message.connection=${connection}&.deliver&*`,
  )
  assertEquals(
    posted.map((b) => (b.doc as { body: string }).body),
    ['It opens at nine.'],
  )
})
