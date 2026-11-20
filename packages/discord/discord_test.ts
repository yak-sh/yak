// Discord's Gateway and replies, against frames as Discord sends them and a
// scripted REST endpoint, through @yaks/chat's generic holder.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { Said, Seated } from '@yaks/chat'
import { holder, type Wire } from '@yaks/chat/socket'
import { Unsent } from '@yaks/host/senders'
import { discord, everyone, gateway, INTENTS, NEEDED } from './mod.ts'

let ME = '900'
let wire = () => {
  let sent: unknown[] = []
  let w: Wire = { send: (t) => sent.push(JSON.parse(t)), close: () => {} }
  return { w, sent }
}
let ready = {
  op: 0,
  s: 1,
  t: 'READY',
  d: {
    session_id: 'sess',
    resume_gateway_url: 'wss://resume.discord.gg',
    user: { id: ME, username: 'yaks.app', bot: true },
  },
}
let message = (n: number, d: Record<string, unknown>) => ({
  op: 0,
  s: n,
  t: 'MESSAGE_CREATE',
  d: {
    id: `m${n}`,
    channel_id: 'room',
    guild_id: 'barn',
    author: { id: 'ann', username: 'ann_k', global_name: 'Ann' },
    content: 'hello',
    timestamp: '2026-11-20T05:40:00.000Z',
    mentions: [],
    ...d,
  },
})

let held = () => {
  let heard: Said[] = []
  let seated: Seated[] = []
  let h = holder(
    gateway('T0K'),
    (s) => heard.push(...s),
    (s) => seated.push(s),
  )
  return { h, heard, seated, ...wire() }
}
let say = (h: ReturnType<typeof held>['h'], w: Wire, f: unknown) =>
  h.frame(w, JSON.stringify(f))

test('hello identifies with the intents and starts beating', async () => {
  let { h, w, sent } = held()
  assertEquals(h.url(), 'wss://gateway.discord.gg/?v=10&encoding=json')
  assertEquals(await say(h, w, { op: 10, d: { heartbeat_interval: 41250 } }), {
    every: 41250,
  })
  assertEquals(sent, [{
    op: 2,
    d: {
      token: 'T0K',
      intents: INTENTS,
      properties: { os: 'linux', browser: 'yaks.app', device: 'yaks.app' },
    },
  }])
})

test('a mention, a reply, a direct message and a room message are heard as said; bots are not', async () => {
  let { h, w, heard } = held()
  await say(h, w, ready)
  await say(
    h,
    w,
    message(2, {
      content: `<@${ME}> what's on   tomorrow?`,
      mentions: [{ id: ME }],
      message_reference: { message_id: 'm0' },
    }),
  )
  await say(h, w, message(3, { guild_id: undefined, content: 'hi' }))
  await say(h, w, message(4, { content: 'just chatting' }))
  await say(
    h,
    w,
    message(5, {
      content: 'and Friday?',
      mentions: [{ id: ME }],
      referenced_message: { author: { id: ME } },
    }),
  )
  await say(h, w, message(8, { author: { id: 'b', username: 'b', bot: true } }))
  await say(h, w, message(6, { author: { id: ME, username: 'yaks.app' } }))
  assertEquals(
    heard.map((s) => [s.id, s.text, s.addressed, s.server, s.reply_to]),
    [
      ['m2', "what's on   tomorrow?", 'mention', 'barn', 'm0'],
      ['m3', 'hi', 'direct', undefined, undefined],
      ['m4', 'just chatting', undefined, 'barn', undefined],
      ['m5', 'and Friday?', 'reply', 'barn', undefined],
    ],
  )
  assertEquals(heard[0].author, { id: 'ann', name: 'Ann' })
})

test('the servers the bot is in: all of them when ready, then each it joins or leaves', async () => {
  let { h, w, seated } = held()
  let guild = (t: string, d: Record<string, unknown>) =>
    say(h, w, { op: 0, s: 2, t, d })
  await say(h, w, {
    ...ready,
    d: { ...ready.d, guilds: [{ id: 'barn', unavailable: true }] },
  })
  await guild('GUILD_CREATE', { id: 'mill', name: 'Mill' })
  await guild('GUILD_DELETE', { id: 'barn', unavailable: true })
  await guild('GUILD_DELETE', { id: 'mill' })
  assertEquals(seated, [{ all: ['barn'] }, { joined: 'mill' }, {
    left: 'mill',
  }])
})

test('an unanswered beat reconnects, and the new wire resumes where it was', async () => {
  let { h, w, sent } = held()
  await say(h, w, ready)
  await say(h, w, message(7, {}))
  assertEquals(h.beat(w), {})
  assertEquals(sent.pop(), { op: 1, d: 7 })
  assertEquals(h.beat(w), { again: true })
  assertEquals(h.url(), 'wss://resume.discord.gg/?v=10&encoding=json')
  await say(h, w, { op: 10, d: { heartbeat_interval: 41250 } })
  assertEquals(sent.pop(), {
    op: 6,
    d: { token: 'T0K', session_id: 'sess', seq: 7 },
  })
})

test('Discord asking for a beat gets one; reconnect and a dead session start again', async () => {
  let { h, w, sent } = held()
  await say(h, w, ready)
  await say(h, w, { op: 1 })
  assertEquals(sent.pop(), { op: 1, d: 1 })
  assertEquals(await say(h, w, { op: 7 }), { again: true })
  assertEquals(await say(h, w, { op: 9, d: false }), { again: true })
  assertEquals(h.url(), 'wss://gateway.discord.gg/?v=10&encoding=json')
  await say(h, w, { op: 10, d: { heartbeat_interval: 1 } })
  assertEquals((sent.pop() as { op: number }).op, 2)
})

test('a refused token or intent ends the socket with what to do', () => {
  let { h } = held()
  assertEquals(h.ended(1006), undefined)
  assertEquals(h.ended(4004), 'Discord refused the bot token. Give a new one.')
})

test('refused its privileged intents, the bot identifies afresh with the needed ones, then ends', async () => {
  let { h, w, sent } = held()
  await say(h, w, { op: 10, d: { heartbeat_interval: 1 } })
  await say(h, w, ready)
  assertEquals(h.ended(4014), undefined)
  assertEquals(h.url(), 'wss://gateway.discord.gg/?v=10&encoding=json')
  await say(h, w, { op: 10, d: { heartbeat_interval: 1 } })
  assertEquals(
    sent.map((f) => (f as { d: { intents: number } }).d.intents),
    [INTENTS, NEEDED],
  )
  assertEquals(
    h.ended(4014),
    'Turn on Message Content Intent under Bot in the Discord Developer Portal.',
  )
})

let rest = (status: number, body: unknown) => {
  let seen: { url: string; init: RequestInit }[] = []
  let f = (url: string, init: RequestInit) => {
    seen.push({ url, init })
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  }
  return { f: f as unknown as typeof fetch, seen }
}

test('send posts the reply as the bot, answering the message, pinging nobody', async () => {
  let { f, seen } = rest(200, { id: 'r1' })
  assertEquals(
    await discord.send(
      'T0K',
      { room: 'room', text: 'Done.', reply_to: 'm2' },
      f,
    ),
    { id: 'r1' },
  )
  assertEquals(
    seen[0].url,
    'https://discord.com/api/v10/channels/room/messages',
  )
  assertEquals(
    (seen[0].init.headers as Record<string, string>).authorization,
    'Bot T0K',
  )
  assertEquals(JSON.parse(String(seen[0].init.body)), {
    content: 'Done.',
    allowed_mentions: { parse: [] },
    message_reference: { message_id: 'm2', fail_if_not_exists: false },
  })
})

test('a rate limit is tried again after what Discord says; a refusal is thrown', async () => {
  let e = await assertRejects(
    () =>
      discord.send(
        'T',
        { room: 'r', text: 'x' },
        rest(429, { retry_after: 2.5 }).f,
      ),
    Unsent,
  )
  assertEquals(e.retry.after, 2500)
  await assertRejects(
    () =>
      discord.send(
        'T',
        { room: 'r', text: 'x' },
        rest(403, { message: 'Missing Access' }).f,
      ),
    Error,
    'Discord refused the reply: 403 Missing Access',
  )
})

test('typing shows the room the bot is working; a rate limit waits, a refusal is thrown', async () => {
  let { f, seen } = rest(200, {})
  await discord.working!.show('T0K', 'room', f)
  assertEquals(seen[0].url, 'https://discord.com/api/v10/channels/room/typing')
  assertEquals(seen[0].init.method, 'POST')
  assertEquals(
    (seen[0].init.headers as Record<string, string>).authorization,
    'Bot T0K',
  )
  await assertRejects(
    () => discord.working!.show('T', 'r', rest(429, {}).f),
    Unsent,
  )
  await assertRejects(
    () =>
      discord.working!.show(
        'T',
        'r',
        rest(403, { message: 'Missing Access' }).f,
      ),
    Error,
    'Discord refused to show typing: 403 Missing Access',
  )
})

test('the bot is named in a server as its nickname there, cut to 32 characters; a missing permission is refused', async () => {
  let { f, seen } = rest(200, { nick: 'Pip' })
  await discord.named!('T0K', 'barn', 'Pip', f)
  await discord.named!('T0K', 'barn', 'P'.repeat(40), f)
  assertEquals(
    seen.map((s) => [s.url, s.init.method, JSON.parse(String(s.init.body))]),
    [
      ['https://discord.com/api/v10/guilds/barn/members/@me', 'PATCH', {
        nick: 'Pip',
      }],
      ['https://discord.com/api/v10/guilds/barn/members/@me', 'PATCH', {
        nick: 'P'.repeat(32),
      }],
    ],
  )
  await assertRejects(
    () =>
      discord.named!(
        'T',
        'barn',
        'Pip',
        rest(403, { message: 'Missing Permissions' }).f,
      ),
    Error,
    'Discord refused to rename the bot in barn: 403 Missing Permissions',
  )
})

test('a room is known by its server, none for a direct one; one the bot cannot see is refused', async () => {
  let { f, seen } = rest(200, { id: 'room', guild_id: 'barn' })
  assertEquals(await discord.server!('T0K', 'room', f), 'barn')
  assertEquals(seen[0].url, 'https://discord.com/api/v10/channels/room')
  assertEquals(
    (seen[0].init.headers as Record<string, string>).authorization,
    'Bot T0K',
  )
  assertEquals(
    await discord.server!('T', 'dm', rest(200, { id: 'dm' }).f),
    undefined,
  )
  await assertRejects(() => discord.server!('T', 'r', rest(502, {}).f), Unsent)
  await assertRejects(
    () =>
      discord.server!('T', 'r', rest(404, { message: 'Unknown Channel' }).f),
    Error,
    'Discord refused to show room r: 404 Unknown Channel',
  )
})

test("rooms lists a server's text channels in Discord's order, as the bot", async () => {
  let { f, seen } = rest(200, [
    { id: 'c2', name: 'news', type: 5, position: 2 },
    { id: 'v', name: 'Lounge', type: 2, position: 0 },
    { id: 'c1', name: 'general', type: 0, position: 1 },
    { id: 'k', name: 'Text Channels', type: 4, position: 0 },
  ])
  assertEquals(await discord.rooms!('T0K', 'g1', f), [
    { id: 'c1', name: 'general' },
    { id: 'c2', name: 'news' },
  ])
  assertEquals(seen[0].url, 'https://discord.com/api/v10/guilds/g1/channels')
  assertEquals(
    (seen[0].init.headers as Record<string, string>).authorization,
    'Bot T0K',
  )
})

test('rooms is null for a server the bot is not in, or no longer', async () => {
  for (
    let [status, message] of [[403, 'Missing Access'], [404, 'Unknown Guild']]
  ) {
    assertEquals(
      await discord.rooms!('T', 'g1', rest(+status, { message }).f),
      null,
    )
  }
  await assertRejects(() => discord.rooms!('T', 'g1', rest(502, {}).f), Unsent)
})

test('about reads what a server is called and where its icon is, null where the bot is not in it', async () => {
  let { f, seen } = rest(200, { id: 'g1', name: 'Barn', icon: 'abc' })
  assertEquals(await discord.about!('T0K', 'g1', f), {
    name: 'Barn',
    icon: 'https://cdn.discordapp.com/icons/g1/abc.png?size=512',
  })
  assertEquals(
    await discord.about!('T', 'g1', rest(200, { name: 'Bare', icon: null }).f),
    { name: 'Bare' },
  )
  assertEquals(seen[0].url, 'https://discord.com/api/v10/guilds/g1')
  assertEquals(
    await discord.about!('T', 'g1', rest(403, { message: 'x' }).f),
    null,
  )
  await assertRejects(
    () => discord.about!('T', 'g1', rest(502, {}).f),
    Unsent,
  )
})

test('link opens a server, or a channel in it', () => {
  assertEquals(discord.link!('g1'), 'https://discord.com/channels/g1')
  assertEquals(discord.link!('g1', 'c1'), 'https://discord.com/channels/g1/c1')
})

test("recent reads a room back oldest first, bots' own included, none addressed", async () => {
  let message = (id: string, author: Record<string, unknown>) => ({
    id,
    channel_id: 'c1',
    author,
    content: `<@me> hi from ${id}`,
    timestamp: `2026-11-20T05:4${id}:00.000Z`,
    mentions: [{ id: 'me' }],
  })
  let { f, seen } = rest(200, [
    message('2', { id: 'me', username: 'kit', bot: true }),
    message('1', { id: 'u1', username: 'ann', global_name: 'Ann' }),
  ])
  let read = await discord.recent!('T0K', 'c1', { before: '9', limit: 500 }, f)
  assertEquals(read.map((s) => [s.id, s.author.name, s.addressed]), [
    ['1', 'Ann', undefined],
    ['2', 'kit', undefined],
  ])
  assertEquals(read[0].text, '<@me> hi from 1')
  assertEquals(
    seen[0].url,
    'https://discord.com/api/v10/channels/c1/messages?before=9&limit=100',
  )
  assertEquals(
    (seen[0].init.headers as Record<string, string>).authorization,
    'Bot T0K',
  )
  await assertRejects(
    () =>
      discord.recent!(
        'T',
        'c1',
        { before: '9', limit: 5 },
        rest(403, { message: 'Missing Access' }).f,
      ),
    Error,
    'Discord refused to read room c1: 403 Missing Access',
  )
})

// A REST endpoint answering each path it knows, 404 for any other.
let routes = (answers: Record<string, unknown>) => {
  let seen: string[] = []
  let f = (url: string) => {
    let path = url.replace('https://discord.com/api/v10', '')
    seen.push(path)
    return Promise.resolve(
      path in answers
        ? Response.json(answers[path])
        : Response.json({ message: 'Unknown' }, { status: 404 }),
    )
  }
  return { f: f as unknown as typeof fetch, seen }
}

let VIEW = String(1 << 10)
let guild = (everyone: string) => ({
  id: 'g1',
  name: 'Barn',
  icon: 'a_abc',
  roles: [
    { id: 'g1', name: '@everyone', permissions: everyone, position: 0 },
    { id: 'r1', name: 'Mod', permissions: '0', position: 2 },
    { id: 'r2', name: 'Artist', permissions: '0', position: 1 },
  ],
})

test('everyone: the @everyone role sees a channel unless its overwrite denies it', () => {
  let c = (o?: { allow: string; deny: string }) => ({
    id: 'c',
    type: 0,
    ...o ? { permission_overwrites: [{ id: 'g1', ...o }] } : {},
  })
  assertEquals(everyone(guild(VIEW), c()), true)
  assertEquals(everyone(guild(VIEW), c({ allow: '0', deny: VIEW })), false)
  assertEquals(everyone(guild('0'), c()), false)
  assertEquals(everyone(guild('0'), c({ allow: VIEW, deny: '0' })), true)
  assertEquals(
    everyone(guild(String(1 << 3)), c({ allow: '0', deny: VIEW })),
    true,
  )
})

test('open: a channel as everyone sees it, a thread as its channel, never a private thread or a direct room', async () => {
  let { f } = routes({
    '/guilds/g1': guild(VIEW),
    '/channels/hall': { id: 'hall', type: 0, guild_id: 'g1' },
    '/channels/mods': {
      id: 'mods',
      type: 0,
      guild_id: 'g1',
      permission_overwrites: [{ id: 'g1', allow: '0', deny: VIEW }],
    },
    '/channels/t1': { id: 't1', type: 11, guild_id: 'g1', parent_id: 'mods' },
    '/channels/t2': { id: 't2', type: 12, guild_id: 'g1', parent_id: 'hall' },
    '/channels/dm': { id: 'dm', type: 1 },
  })
  let open = (room: string) => discord.open!('T', room, f)
  assertEquals(
    await Promise.all(['hall', 'mods', 't1', 't2', 'dm'].map(open)),
    [true, false, false, false, false],
  )
})

test('basics: the server and its icon, the room and its topic, and who is talking with their roles', async () => {
  let { f } = routes({
    '/channels/hall': {
      id: 'hall',
      type: 0,
      guild_id: 'g1',
      name: 'hall',
      topic: 'hay',
    },
    '/guilds/g1': guild(VIEW),
    '/guilds/g1/members/ann': {
      user: { id: 'ann', username: 'ann_k', global_name: 'Ann' },
      nick: 'Annie',
      roles: ['r2', 'r1'],
    },
    '/guilds/g1/members/bo': { user: { id: 'bo', username: 'bo' }, roles: [] },
  })
  assertEquals(await discord.basics!('T', 'hall', ['ann', 'bo', 'gone'], f), {
    server: {
      id: 'g1',
      name: 'Barn',
      icon: 'https://cdn.discordapp.com/icons/g1/a_abc.gif?size=512',
    },
    room: { id: 'hall', name: 'hall', topic: 'hay' },
    people: [
      { id: 'ann', name: 'Annie', roles: ['Mod', 'Artist'] },
      { id: 'bo', name: 'bo', roles: [] },
    ],
  })
  assertEquals(
    await discord.basics!(
      'T',
      'dm',
      ['ann'],
      routes({ '/channels/dm': { id: 'dm', type: 1 } }).f,
    ),
    { room: { id: 'dm' }, people: [] },
  )
})

test('api reads, as the bot, what a member could see, and never the servers the bot is in', () => {
  let { api } = discord
  assertEquals(api!.scheme, 'Bot')
  for (
    let path of [
      '/guilds/{server}',
      '/channels/{room}/messages/pins',
      '/guilds/{server}/roles',
    ]
  ) {
    assertEquals(api!.reads.includes(path), true, path)
  }
  assertEquals(api!.reads.some((r) => r.startsWith('/users/@me')), false)
})
