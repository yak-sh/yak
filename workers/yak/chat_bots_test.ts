// A bot a space brought (the `discord-bot` integration, its pasted token)
// listens in an object of its own (chat.ts `Listening`, `connection:<eid>`),
// over storage in memory and a stand-in Gateway: pasting the key starts it,
// it speaks to the Gateway with that token, a mention it hears in any server
// is the next words to that space's Operator, the servers it is in are kept
// on its connection for its apps and its space's room choice, a final close
// reaches the tracker in Discord's words, and disconnecting or deleting it
// stops it.

import { assert, assertEquals } from '@std/assert'
import { test } from '@yaks/testing'
import type { Bundle } from '@yaks/graph'
import { line } from '@yaks/query'
import type { D1Like } from '@yaks/d1'
import type { Socket } from '@yaks/chat/listen'
import { d1 } from '../../packages/d1/testing.ts'
import { connecting } from './connections.ts'
import { directory, over } from './directory.ts'
import { platform } from './testing.ts'
import { KERNEL, meta } from './meta.ts'
import { within } from './defects.ts'
import { choose, Listening, offers, serves } from './chat.ts'

let KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
let TOKEN = 'MTA.own.bot'
let ME = '1300000000000000001'

let setup = async () => {
  let p = platform('a probe secret', {
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: KEY,
  })
  let at = meta(p.env)
  let person = crypto.randomUUID()
  await at.apply([
    { entity: { eid: person }, person: {} },
    {
      entity: { eid: '$space' },
      doc: { title: 'ada' },
      space: { slug: 'ada', store: 'ada' },
    },
    {
      entity: { eid: '$seat' },
      member: { space: '$space', person, role: 'owner' },
    },
  ], { 'x-yak-person': person, 'x-yak-role': 'owner' })
  let space = (await directory({ fetch: over(at) }).space('ada'))!
  let post = (fields: Record<string, string>) => {
    let form = new FormData()
    for (let [k, v] of Object.entries(fields)) form.set(k, v)
    return connecting(
      new Request('https://yaks.app/manage/connections?space=ada'),
      p.env,
      space,
      { person, role: 'owner' },
      form,
    )
  }

  // The stand-in Gateway: each socket opened, what was sent on it, and its
  // events to fire.
  type Wire = {
    url: string
    sent: { op: number; d?: { token?: string } }[]
    fire: Record<string, (e: { data?: unknown; code?: number }) => void>
    closed?: number
  }
  let wires: Wire[] = []
  let open = (url: string) => {
    let w: Wire = { url, sent: [], fire: {} }
    wires.push(w)
    return Promise.resolve<Socket>({
      send: (t) => w.sent.push(JSON.parse(t)),
      close: (code) => w.closed = code,
      addEventListener: (type, fn) => w.fire[type] = fn,
    })
  }
  let frame = (f: unknown) =>
    wires.at(-1)!.fire.message({ data: JSON.stringify(f) })

  // Each bot's object, by name, with what it keeps and when it wakes next.
  type Held = {
    object: Listening
    kept: Map<string, unknown>
    alarm: number | null
  }
  let objects = new Map<string, Held>()
  let objectAt = (name: string) => {
    let had = objects.get(name)
    if (had) return had
    let kept = new Map<string, unknown>()
    let o = { kept, alarm: null } as unknown as Held
    o.object = new Listening(
      {
        storage: {
          get: <T>(k: string) => Promise.resolve(kept.get(k) as T),
          put: (k, v) => Promise.resolve(void kept.set(k, v)),
          setAlarm: (t) => Promise.resolve(void (o.alarm = t)),
          deleteAlarm: () => Promise.resolve(void (o.alarm = null)),
          deleteAll: () => Promise.resolve(kept.clear()),
        },
      },
      p.env,
      open,
    )
    objects.set(name, o)
    return o
  }
  // A call into an object, as the runtime enters one
  // (facets/kernel-worker.ts `Chats`).
  let call = <T>(run: () => Promise<T>) => within(p.env, {}, run)
  p.env.CHATS = {
    idFromName: (name) => name,
    get: (name) => {
      let { object } = objectAt(name as string)
      return {
        listen: (bot) => call(() => object.listen(bot)),
        stop: () => call(() => object.stop()),
      }
    },
  }

  // What the space's object is asked, and what the tracker is told.
  let asked: { space: string | null; body: Record<string, unknown> }[] = []
  p.env.BUILDER = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (req: Request) => {
        asked.push({
          space: req.headers.get('x-space-eid'),
          body: await req.json(),
        })
        return new Response(null, { status: 202 })
      },
    }),
  } as never
  let told: string[] = []
  p.env.ERRORS = {
    send: (rows: Bundle[]) =>
      Promise.resolve(void told.push(JSON.stringify(rows))),
  } as never
  let settled = async (done: () => boolean) => {
    for (let i = 0; i < 400 && !done(); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }
  }

  let said = await post({
    do: 'add',
    integration: 'discord-bot',
    key: TOKEN,
  })
  let [c] = await at.query('.connection.integration=discord-bot')
  let connection = c.entity.eid
  let held = objectAt(`connection:${connection}`)
  return {
    p,
    at,
    person,
    space,
    post,
    said,
    connection,
    held,
    wires,
    frame,
    asked,
    told,
    call,
    settled,
  }
}

test('a pasted bot listens with its own token, and what it hears is its space’s', async () => {
  let s = await setup()
  assertEquals(s.said, {
    say: 'Saved. The key is kept safe and never shown again.',
    no: false,
  })
  assertEquals(Object.fromEntries(s.held.kept), {
    via: 'discord',
    connection: s.connection,
  })
  assert(s.held.alarm != null)
  await s.call(() => s.held.object.alarm())
  s.frame({ op: 10, d: { heartbeat_interval: 3_600_000 } })
  s.frame({
    op: 0,
    t: 'READY',
    s: 1,
    d: {
      session_id: 'session',
      resume_gateway_url: 'wss://resume.test',
      user: { id: ME, username: 'Kit' },
    },
  })
  s.frame({
    op: 0,
    t: 'MESSAGE_CREATE',
    s: 2,
    d: {
      id: '1310000000000000001',
      channel_id: '1310000000000000777',
      guild_id: '81384788765712384',
      author: { id: '4242', username: 'ann' },
      content: `<@${ME}> when does the barn open?`,
      timestamp: '2026-11-20T05:40:00.000Z',
      mentions: [{ id: ME }],
    },
  })
  await s.settled(() => s.asked.length > 0)
  assertEquals(s.wires[0].sent[0].d?.token, TOKEN)
  let [one] = s.asked
  assertEquals(one.space, s.space.eid)
  assertEquals(
    [
      one.body.via,
      one.body.connection,
      (one.body.said as { text: string }).text,
    ],
    ['discord', s.connection, 'when does the barn open?'],
  )
  // Disconnected, it closes its socket and forgets itself.
  await s.post({ do: 'disconnect', connection: s.connection })
  assertEquals(
    [s.wires[0].closed, s.held.kept.size, s.held.alarm],
    [4000, 0, null],
  )
})

test('a final close reaches the tracker in Discord’s words, and pasting the key again tries again', async () => {
  let s = await setup()
  await s.call(() => s.held.object.alarm())
  s.wires[0].fire.close({ code: 4014 })
  await s.settled(() => s.told.length > 0)
  assert(
    s.told.some((t) => t.includes('Turn on Message Content Intent')),
    s.told.join('\n'),
  )
  await s.call(() => s.held.object.alarm())
  assertEquals(s.wires.length, 1)
  await s.post({ do: 'key', connection: s.connection, key: TOKEN })
  await s.call(() => s.held.object.alarm())
  assertEquals(s.wires.length, 2)
  await s.call(() => s.held.object.stop())
})

test('a pasted bot whose connection is deleted stops at its next alarm', async () => {
  let s = await setup()
  await s.call(() => s.held.object.alarm())
  await s.at.apply([{ entity: { eid: s.connection }, tombstone: {} }], KERNEL)
  await s.call(() => s.held.object.alarm())
  assertEquals(
    [s.wires[0].closed, s.held.kept.size, s.held.alarm],
    [4000, 0, null],
  )
})

// Discord's REST as a pasted bot sees it: each server's one text channel.
let channels: typeof fetch = (input) => {
  let [, server] = String(input).match(/guilds\/(\w+)\/channels$/) ?? []
  return Promise.resolve(
    server
      ? Response.json([{ id: `${server}-general`, name: 'general', type: 0 }])
      : new Response('no network', { status: 599 }),
  )
}

test('the servers a pasted bot is in are kept on its connection, and its space chooses a room among them to hear in full', async () => {
  let s = await setup()
  await s.call(() => s.held.object.alarm())
  s.frame({ op: 10, d: { heartbeat_interval: 3_600_000 } })
  s.frame({
    op: 0,
    t: 'READY',
    s: 1,
    d: {
      session_id: 'session',
      resume_gateway_url: 'wss://resume.test',
      user: { id: ME, username: 'Kit' },
      guilds: [{ id: 'barn', unavailable: true }],
    },
  })
  s.frame({ op: 0, t: 'GUILD_CREATE', s: 2, d: { id: 'mill' } })
  let kept = async () => {
    let [c] = await s.at.query(line`.entity.eid=${s.connection}&*`)
    return serves(c)
  }
  for (let i = 0; i < 400 && (await kept()).length < 2; i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
  assertEquals(await kept(), ['barn', 'mill'])

  let was = globalThis.fetch
  globalThis.fetch = channels
  try {
    let [{ servers }] = await offers(s.p.env, s.space.eid)
    assertEquals(
      servers.map((v) => [v.connection, v.own, v.rooms?.map((r) => r.id)]),
      [[s.connection, true, ['barn-general', 'mill-general']]],
    )
  } finally {
    globalThis.fetch = was
  }
  await choose(
    s.p.env,
    { person: s.person, role: 'owner' },
    s.space.eid,
    s.connection,
    'mill-general',
  )
  s.frame({
    op: 0,
    t: 'MESSAGE_CREATE',
    s: 3,
    d: {
      id: '1310000000000000002',
      channel_id: 'mill-general',
      guild_id: 'mill',
      author: { id: '4242', username: 'ann' },
      content: 'the mill is quiet today',
      timestamp: '2026-11-20T05:41:00.000Z',
    },
  })
  await s.settled(() => s.asked.length > 0)
  assertEquals(
    s.asked.map((a) => [a.space, (a.body.said as { text: string }).text]),
    [[s.space.eid, 'the mill is quiet today']],
  )
  assert(s.asked[0].body.writer)
  await s.call(() => s.held.object.stop())
})

test('a connection serves the server yaks.app’s bot was added to, or every one a pasted bot is in', () => {
  let c = (connection: object, more = {}) =>
    ({ entity: { eid: 'c' }, connection, ...more }) as Bundle
  assertEquals(
    [
      serves(c({ account: 'barn' })),
      serves(c({}, { chat_serves: { servers: ['barn', 'mill'] } })),
      serves(c({})),
    ],
    [['barn'], ['barn', 'mill'], []],
  )
})
