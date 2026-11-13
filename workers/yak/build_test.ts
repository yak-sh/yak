/// <reference lib="deno.ns" />
// The builder's object (T-34240), on the stand-in: a scripted Workers AI
// binding instead of a model, and everything else the code that runs in
// production — the loop, the platform's own tools, the directory, the Store.
//
// What is proved here is the wire. A page joins and hears the conversation; a
// line it sends becomes a build, and the build arrives as frames in the order
// they happened, ending with the app's address; a page that reloads hears the
// same sequence again; a second line during a build is kept and answered
// once it ends; and a socket nobody is on the end of never opens.
//
// The one thing the stand-in cannot do is the 101 upgrade — `WebSocketPair`
// and a 101 `Response` are the runtime's, not the web's — so a socket is
// driven the way the runtime drives a hibernated one, through `joined` and
// `webSocketMessage` (graph_test.ts does the same for the Store).
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { Wire } from '@yaks/durable-object'
import * as apps from './apps.ts'
import { Builder } from './build.ts'
import {
  builderOf,
  type Frame,
  type Held,
  NOBODY,
  NOT_A_WRITER,
  OWED,
  saying,
  seated,
} from './build-door.ts'
import { bounded } from '@yaks/durable-object/ceiling'
import { WAKE } from './door.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { ai, modelPage, platform, state, type Turn } from './testing.ts'
import { test, until } from '@yaks/testing'
import { sign } from './lib/token.ts'
import { manage } from './manage.ts'
import { operatorStore } from './operator-store.ts'
import { endpoints } from './endpoints.ts'

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

// The three turns that make somebody a recipe box, said the way the Workers AI
// binding answers them.
let MAKES_ONE: Turn[] = [
  {
    text: 'Making it now.',
    calls: [{
      name: 'app_new',
      arguments: { slug: 'recipes', title: 'Recipes' },
    }],
  },
  {
    calls: [{
      name: 'app_files',
      arguments: {
        app: 'recipes',
        files: [{ path: 'index.html', content: '<h1>Lemon cake</h1>' }],
      },
    }],
  },
  { calls: [{ name: 'app_deploy', arguments: { app: 'recipes' } }] },
  { text: 'It is ready.' },
]

let dirOf = (env: Env) =>
  directory({ fetch: (r: Request) => dirPart.fetch(r, env) })

// A space with Ada in it, and her builder's object.
let seeded = async (script: Turn[] = []) => {
  let { env, states } = platform(SECRET, {
    AI: ai(script) as Env['AI'],
    BUILDER_MODEL_FREE: '@cf/test/free',
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
  return {
    env,
    space,
    ctx,
    states,
    object: new Builder(ctx, env),
    held: { person: ADA, role: 'owner', space: space.eid } as Held,
  }
}

// A hibernatable socket, faked: the frames it was sent, and the attachment
// that is its only memory across an eviction.
let wire = () => {
  let sent: Frame[] = []
  let held: unknown = null
  return {
    sent,
    readyState: 1,
    send: (data: string) => void sent.push(JSON.parse(data)),
    serializeAttachment: (v: unknown) => {
      held = JSON.parse(JSON.stringify(v))
    },
    deserializeAttachment: () => held,
  }
}

// A socket the object is serving, joined the way the handshake joins one.
let joined = (
  o: { object: Builder; ctx: { live: Wire[] }; held: Held },
) => {
  let ws = wire()
  o.ctx.live.push(ws)
  o.object.joined(ws, o.held)
  return ws
}

// The frame kinds in order, so a test says the sequence rather than the shapes.
let kinds = (sent: Frame[]) =>
  sent.map((f) =>
    'said' in f
      ? `said:${f.said}`
      : 'tool' in f
      ? `tool:${f.tool}`
      : 'ran' in f
      ? `ran:${f.ran}`
      : 'built' in f
      ? 'built'
      : 'done' in f
      ? 'done'
      : 'busy' in f
      ? 'busy'
      : 'ready'
  )

// A whole build: three tools, a worker upload, and — since T-34950 — the
// commit a deploy mints in the git object store, which is another object
// waking up. The budget is only here so a stall fails instead of hanging, so
// it is wide enough to hold the act on a loaded box rather than tight enough
// to time it.
let settled = (ws: { sent: Frame[] }) =>
  until(() => ws.sent.some((f) => 'done' in f), {
    timeout: 10_000,
    label: () => `the build never finished: ${kinds(ws.sent).join(', ')}`,
  })

test('a page joins, says one line, and watches the build happen', async () => {
  let o = await seeded(MAKES_ONE)
  let ws = joined(o)
  // Nothing has been said here yet: the replay is empty and the page is told
  // it is up to date.
  assertEquals(ws.sent, [{ ready: true, building: false }])

  o.object.webSocketMessage(ws, JSON.stringify({ say: 'a recipe box please' }))
  await settled(ws)

  assertEquals(kinds(ws.sent), [
    'ready',
    'said:person',
    'said:builder',
    'tool:app_new',
    'ran:app_new',
    'tool:app_files',
    'ran:app_files',
    'tool:app_deploy',
    'ran:app_deploy',
    'built',
    'said:builder',
    'done',
  ])
  // Each tool said one line about itself, not a paragraph.
  let ran = ws.sent.filter((f) => 'ran' in f) as { line: string; ok: boolean }[]
  for (let f of ran) {
    assert(f.ok && f.line.length > 0 && !f.line.includes('\n'))
  }
  // And the address is the one the deploy answered with.
  let built = ws.sent.find((f) => 'built' in f) as { built: string }
  assertEquals(built.built, 'https://ada.yaks.app/recipes/')
  let done = ws.sent.find((f) => 'done' in f) as { done: string }
  assertEquals(done.done, 'It is ready.')

  // The app the conversation made serves its page at that address.
  let page = await apps.fetch(new Request(built.built), o.env)
  assertEquals(page.status, 200)
  assertStringIncludes(await page.text(), 'Lemon cake')
})

test('a page that reloads hears the whole conversation again', async () => {
  let o = await seeded(MAKES_ONE)
  let first = joined(o)
  o.object.webSocketMessage(first, JSON.stringify({ say: 'a recipe box' }))
  await settled(first)

  // The same object, a new socket: everything that was said, in order, then
  // the mark that the replay is over.
  let again = joined(o)
  assertEquals(kinds(again.sent), [
    'said:person',
    'said:builder',
    'tool:app_new',
    'ran:app_new',
    'tool:app_files',
    'ran:app_files',
    'tool:app_deploy',
    'ran:app_deploy',
    'built',
    'said:builder',
    'ready',
  ])
  assertEquals(again.sent.at(-1), { ready: true, building: false })

  // An evicted object holds the same conversation: it is in its own SQLite,
  // not its memory.
  let woken = new Builder(o.ctx, o.env)
  let third = wire()
  woken.joined(third, o.held)
  assertEquals(kinds(third.sent), kinds(again.sent))
})

test('a second line during a build is kept, and answered once it ends', async () => {
  let o = await seeded([...MAKES_ONE, { text: 'A garden too.' }])
  let ws = joined(o)
  let building = o.object.say(o.held, 'a recipe box')
  o.object.webSocketMessage(ws, JSON.stringify({ say: 'and a garden one' }))
  assertEquals(kinds(ws.sent).slice(-2), ['said:person', 'busy'])
  await building
  while (o.ctx.pending.size) await Promise.all(o.ctx.pending)
  let said = o.object.said().map((l) => l.text)
  assertEquals(said.slice(-2), ['and a garden one', 'A garden too.'])
  let told = ws.sent.filter((f) => 'said' in f && f.text == 'and a garden one')
  assertEquals(told.length, 1)
})

// Ada's object over storage as a new one has it, on a window of a second
// the case moves, and the rows it may write in it, spent (@yaks/durable-object
// `bounded`); then an alarm the runtime rings, and what it left running.
let paused = async () => {
  let o = await seeded([{ text: 'Sure.' }])
  let ctx = state('', false)
  let at = { t: 0 }
  let ceiling = bounded(ctx.storage, {
    now: () => at.t,
    refuse: true,
    windows: [{ ms: 1_000, read: 1e6, written: 10 }],
  })
  let stop = () =>
    ceiling.count({
      shape: () => 's',
      rowsRead: 0,
      rowsWritten: 11,
      returned: 0,
    })
  let object = new Builder(ctx, o.env)
  let ring = async (t: number) => {
    at.t = t
    await object.alarm()
    while (ctx.pending.size) await Promise.all(ctx.pending)
  }
  let lines = () => object.said().map((l) => l.text)
  return { ...o, ctx, object, stop, ring, lines }
}

let idle = await paused()
test('an alarm with no line kept takes none up', async () => {
  await idle.ring(0)
  assertEquals(idle.lines(), [])
})

let kept = await paused()
test('a line said to a stopped Builder is kept, and answered once the window ends', async () => {
  let o = kept
  let ws = joined(o)
  o.stop()
  o.object.webSocketMessage(ws, JSON.stringify({ say: 'a recipe box' }))
  assertEquals(kinds(ws.sent), ['ready', 'said:person', 'busy'])
  await o.ring(500)
  assertEquals([kinds(ws.sent).length, o.lines()], [3, []])
  await o.ring(1_000)
  assertEquals(kinds(ws.sent).slice(3), ['said:builder', 'done'])
  assertEquals(o.lines(), ['a recipe box', 'Sure.'])
})

let tipped = await paused()
test('a line the window stops as it is heard is kept too', async () => {
  let o = tipped
  let said = o.object.say(o.held, 'a recipe box')
  o.stop()
  assertEquals(kinds(await said), ['said:person', 'busy'])
  await o.ring(1_000)
  assertEquals(o.lines(), ['a recipe box', 'Sure.'])
})

let answered = await paused()
test('a reply made as the window passes is kept with the line it answers', async () => {
  let o = answered
  let model = o.env.AI as unknown as { run: (...a: unknown[]) => unknown }
  let run = model.run
  model.run = (...a) => (o.stop(), run(...a))
  let end = await o.object.say(o.held, 'a recipe box')
  assertEquals([end, o.lines()], [[{ done: 'Sure.' }], [
    'a recipe box',
    'Sure.',
  ]])
})

let formed = await paused()
test('a form posted to a stopped Builder is answered the line it kept', async () => {
  let o = formed
  o.stop()
  let r = await o.object.fetch(saying(o.held, 'a recipe box'))
  let { frames } = await r.json() as { frames: Frame[] }
  assertEquals([r.status, kinds(frames)], [200, ['said:person', 'busy']])
})

test('a socket with nobody on it never opens', async () => {
  let { object } = await seeded()
  let upgrade = { upgrade: 'websocket', 'x-space-eid': 'a-space' }
  let refused = async (headers: Record<string, string>) => {
    let r = await object.fetch(
      new Request('http://builder/ws', { headers: { ...upgrade, ...headers } }),
    )
    let said = await r.json() as { error: string; message: string }
    return { status: r.status, ...said }
  }

  // Nobody at all, and somebody who may read this space but not write in it.
  assertEquals(await refused({}), {
    status: 401,
    error: 'Refused',
    message: NOBODY,
  })
  assertEquals(
    await refused({ 'x-yak-person': ADA, 'x-yak-role': 'viewer' }),
    { status: 403, error: 'Refused', message: NOT_A_WRITER },
  )
  // And a request that is not an upgrade at all is not this door.
  let plain = await object.fetch(
    new Request('http://builder/ws', { headers: { 'x-yak-person': ADA } }),
  )
  assertEquals(plain.status, 426)
})

// The page with no script (T-34242): the same conversation, said once. A form
// POST to the same address waits for the round and is answered a page — the
// transcript, each tool as a row, and the address the build ended at.
test('a form posted with no script is answered the conversation', async () => {
  let { env } = await seeded(MAKES_ONE)
  let form = new FormData()
  form.set('say', 'a recipe box please')
  let out = await apps.fetch(
    new Request('https://ada.yaks.app/api/build', {
      method: 'POST',
      body: form,
      headers: { cookie: await as(ADA) },
    }),
    env,
  )
  assertEquals(out.status, 200)
  let page = await out.text()
  // The person's line, the builder's, the tools it ran, and the address —
  // everything the socket would have streamed, drawn into the page.
  assertStringIncludes(page, 'a recipe box please')
  assertStringIncludes(page, 'It is ready.')
  assertStringIncludes(page, 'app_deploy')
  assertStringIncludes(page, 'https://ada.yaks.app/recipes/')
  // And the form again, so the next line goes the same way.
  assertStringIncludes(page, 'action="/api/build"')

  // The app the posted line made is serving.
  let live = await apps.fetch(
    new Request('https://ada.yaks.app/recipes/'),
    env,
  )
  assertEquals(live.status, 200)
  assertStringIncludes(await live.text(), 'Lemon cake')
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
  o.env.BUILDER = {
    idFromName: (name) => name,
    get: () => ({ fetch: (req: Request) => o.object.fetch(req) }),
  }
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
  let body = new FormData()
  body.set('contact', contact)
  body.set('number', number)
  body.set('agreed', 'yes')
  let response = await manage(
    new Request('https://yaks.app/manage/ada/operator?texts=1', {
      method: 'POST',
      headers: { cookie: await as(ADA), origin: 'https://yaks.app' },
      body,
    }),
    o.env,
  )
  assertEquals(response.status, 200)
  assertEquals(await response.json(), { confirmed: number })
  assertEquals((await dirOf(o.env).texting(ADA))?.number, number)
  assertEquals(sent.length, 1)
})

test('the door refuses a stranger before it reaches the object', async () => {
  let { env } = await seeded()
  let r = await apps.fetch(
    new Request('https://ada.yaks.app/api/build', {
      headers: { upgrade: 'websocket' },
    }),
    env,
  )
  assertEquals(r.status, 401)
  let said = await r.json() as { error: { code: string; message: string } }
  assertEquals(said.error.code, 'not_a_writer')
  assertEquals(said.error.message, NOBODY)
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
