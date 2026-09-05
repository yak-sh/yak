/// <reference lib="deno.ns" />
// The builder's object (T-34240), on the stand-in: a scripted Workers AI
// binding instead of a model, and everything else the code that runs in
// production — the loop, the platform's own tools, the directory, the Store.
//
// What is proved here is the wire. A page joins and hears the conversation; a
// line it sends becomes a build, and the build arrives as frames in the order
// they happened, ending with the app's address; a page that reloads hears the
// same sequence again; a second line during a build is told to wait; and a
// socket nobody is on the end of never opens.
//
// The one thing the stand-in cannot do is the 101 upgrade — `WebSocketPair`
// and a 101 `Response` are the runtime's, not the web's — so a socket is
// driven the way the runtime drives a hibernated one, through `joined` and
// `webSocketMessage` (graph_test.ts does the same for the Store).
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { Wire } from '@yaks/durable-object'
import * as apps from './apps.ts'
import {
  Builder,
  type Frame,
  type Held,
  NOBODY,
  NOT_A_WRITER,
} from './build.ts'
import { directory } from './directory.ts'
import * as dirPart from './directory.ts'
import type { Env } from './env.ts'
import { ai, platform, state, type Turn } from './harness.ts'
import { until } from '../../src/testing.ts'

let SECRET = 'a probe secret'
let ADA = 'a0000000-0000-4000-8000-0000000000ad'

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
  directory({ fetch: (r: Request) => dirPart.fetch(r, env) }, true)

// A space with Ada in it, and her builder's object.
let seeded = async (script: Turn[] = []) => {
  let { env } = platform(SECRET, { AI: ai(script) as Env['AI'] })
  let dir = dirOf(env)
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
  let space = (await dir.space('ada'))!
  let ctx = state()
  return {
    env,
    space,
    ctx,
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

let settled = (ws: { sent: Frame[] }) =>
  until(() => ws.sent.some((f) => 'done' in f), {
    label: () => `the build never finished: ${kinds(ws.sent).join(', ')}`,
  })

Deno.test('a page joins, says one line, and watches the build happen', async () => {
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

Deno.test('a page that reloads hears the whole conversation again', async () => {
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

Deno.test('a second line during a build is told to wait', async () => {
  let o = await seeded(MAKES_ONE)
  let ws = joined(o)
  let building = o.object.say(o.held, 'a recipe box')
  o.object.webSocketMessage(ws, JSON.stringify({ say: 'and a garden one' }))

  assertEquals(ws.sent.filter((f) => 'busy' in f).length, 1)
  await building
  await settled(ws)
  // The second line was never said into the conversation, so nothing of it is
  // in the replay.
  let again = joined(o)
  let said = again.sent.filter((f) => 'said' in f) as { text: string }[]
  assert(!said.some((f) => f.text.includes('garden')))
})

Deno.test('a socket with nobody on it never opens', async () => {
  let { object } = await seeded()
  let upgrade = { upgrade: 'websocket', 'x-space-eid': 'a-space' }
  let refused = async (headers: Record<string, string>) => {
    let r = object.fetch(
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
  let plain = object.fetch(
    new Request('http://builder/ws', { headers: { 'x-yak-person': ADA } }),
  )
  assertEquals(plain.status, 426)
})

Deno.test('the door refuses a stranger before it reaches the object', async () => {
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
