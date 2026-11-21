// Discord's Gateway and replies, against frames as Discord sends them and a
// scripted REST endpoint, through @yaks/chat's generic holder.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { Media, Present, Press, Said, Seated, Voice } from '@yaks/chat'
import { holder, type Wire } from '@yaks/chat/socket'
import { Unsent } from '@yaks/host/senders'
import { linked, Unreachable } from '@yaks/chat'
import { discord, everyone, gateway, INTENTS, links, NEEDED } from './mod.ts'

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
  let present: Present[] = []
  let pressed: Press[] = []
  let voices: Voice[] = []
  let media: Media[] = []
  let h = holder(gateway('T0K'), {
    heard: (s) => heard.push(...s),
    seated: (s) => seated.push(s),
    present: (p) => present.push(...p),
    pressed: (p) => pressed.push(...p),
    voices: (v) => voices.push(...v),
    media: (m) => media.push(m),
  })
  return { h, heard, seated, present, pressed, voices, media, ...wire() }
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

test('a reply to words that named the bot is said to it; an edit is heard only once it is an edit', async () => {
  let { h, w, heard } = held()
  await say(h, w, ready)
  await say(
    h,
    w,
    message(2, {
      content: 'and Friday?',
      referenced_message: { author: { id: 'bo' }, mentions: [{ id: ME }] },
    }),
  )
  let edit = (n: number, d: Record<string, unknown>) => ({
    ...message(n, d),
    t: 'MESSAGE_UPDATE',
  })
  // A link's preview filled in, then the words edited to name the bot.
  await say(h, w, edit(3, { id: 'm1' }))
  await say(
    h,
    w,
    edit(4, {
      id: 'm1',
      content: `hello <@${ME}>`,
      mentions: [{ id: ME }],
      edited_timestamp: '2026-11-20T05:41:00.000Z',
    }),
  )
  await say(
    h,
    w,
    edit(5, { id: 'm1', edited_timestamp: 'x', author: undefined }),
  )
  assertEquals(
    heard.map((s) => [s.id, s.text, s.addressed, s.edited]),
    [
      ['m2', 'and Friday?', 'reply', undefined],
      ['m1', 'hello', 'mention', true],
    ],
  )
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

test("who is about: a server's people as it is joined, then each change, never a bot", async () => {
  let { h, w, present } = held()
  let frame = (t: string, d: Record<string, unknown>) =>
    say(h, w, { op: 0, s: 3, t, d })
  await say(h, w, ready)
  await frame('GUILD_CREATE', {
    id: 'mill',
    presences: [
      { user: { id: 'ann' }, status: 'online' },
      { user: { id: 'bot', bot: true }, status: 'online' },
    ],
  })
  await frame('PRESENCE_UPDATE', { user: { id: 'ann' }, status: 'idle' })
  await frame('PRESENCE_UPDATE', { user: { id: 'bo' }, status: 'invisible' })
  assertEquals(present, [
    { account: 'ann', status: 'online' },
    { account: 'ann', status: 'idle' },
    { account: 'bo', status: 'offline' },
  ])
})

test("who is in voice rooms as a server arrives and as they move, the bot's own audio, and the frame that joins", async () => {
  let { h, w, voices, media } = held()
  let frame = (t: string, d: Record<string, unknown>) =>
    say(h, w, { op: 0, s: 4, t, d })
  await say(h, w, ready)
  await frame('GUILD_CREATE', {
    id: 'mill',
    voice_states: [
      { channel_id: 'loft', user_id: 'ann', session_id: 'a1' },
      {
        channel_id: 'loft',
        user_id: 'dj',
        session_id: 'd1',
        member: { user: { bot: true } },
      },
    ],
  })
  await frame('VOICE_STATE_UPDATE', {
    guild_id: 'mill',
    channel_id: 'loft',
    user_id: ME,
    session_id: 's1',
  })
  await frame('VOICE_STATE_UPDATE', {
    guild_id: 'mill',
    channel_id: null,
    user_id: 'ann',
    session_id: 'a1',
  })
  await frame('VOICE_SERVER_UPDATE', {
    guild_id: 'mill',
    token: 'vt',
    endpoint: null,
  })
  await frame('VOICE_SERVER_UPDATE', {
    guild_id: 'mill',
    token: 'vt',
    endpoint: 'c-ord.discord.media:443',
  })
  let v = (account: string, room: string | null, session: string) => ({
    server: 'mill',
    account,
    room,
    session,
  })
  assertEquals(voices, [
    v('ann', 'loft', 'a1'),
    { ...v('dj', 'loft', 'd1'), bot: true },
    { ...v(ME, 'loft', 's1'), me: true },
    v('ann', null, 'a1'),
  ])
  assertEquals(media, [{
    server: 'mill',
    endpoint: 'c-ord.discord.media:443',
    token: 'vt',
  }])
  assertEquals(discord.voice!.join('mill', null), {
    op: 4,
    d: {
      guild_id: 'mill',
      channel_id: null,
      self_mute: false,
      self_deaf: false,
    },
  })
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

test('a button pressed is a press, by its member, on its message; any other interaction is not', async () => {
  let { h, w, pressed } = held()
  await say(h, w, ready)
  let interaction = (n: number, d: Record<string, unknown>) => ({
    op: 0,
    s: n,
    t: 'INTERACTION_CREATE',
    d: {
      id: `i${n}`,
      application_id: 'app',
      type: 3,
      token: 'tok',
      data: { custom_id: 'private:row', component_type: 2 },
      guild_id: 'barn',
      channel_id: 'room',
      member: { user: { id: 'ann', username: 'ann_k' }, nick: 'Annie' },
      message: { id: 'm9' },
      ...d,
    },
  })
  await say(h, w, interaction(2, {}))
  await say(h, w, interaction(3, { type: 2 }))
  assertEquals(pressed, [{
    id: 'i2',
    token: 'tok',
    app: 'app',
    control: 'private:row',
    room: 'room',
    server: 'barn',
    message: 'm9',
    author: { id: 'ann', name: 'Annie' },
  }])
})

// Only the people a message mentions are notified: never everyone, here
// or a role, whatever its words say (T-2379).
test('a message notifies the people it mentions alone', async () => {
  let { f, seen } = rest(200, { id: 'r1' })
  await discord.send('T0K', {
    room: 'room',
    text: '<@7>, <@!8> and <@7>: @everyone @here <@&99>',
  }, f)
  assertEquals(
    JSON.parse(String(seen[0].init.body)).allowed_mentions,
    { parse: [], users: ['7', '8'] },
  )
})

test('a private notice names and pings its one reader alone, with its buttons', async () => {
  let { f, seen } = rest(200, { id: 'r1' })
  await discord.send('T0K', {
    room: 'room',
    text: 'For you alone.',
    ping: 'ann',
    controls: [{ id: 'private:row', label: 'Show me' }],
  }, f)
  assertEquals(JSON.parse(String(seen[0].init.body)), {
    content: '<@ann> For you alone.',
    allowed_mentions: { parse: [], users: ['ann'] },
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 2,
        label: 'Show me',
        custom_id: 'private:row',
      }],
    }],
  })
})

test('a press is held as an ephemeral answer at once, then answered in its place', async () => {
  let { f, seen } = rest(200, {})
  let press = {
    id: 'i2',
    token: 'tok',
    app: 'app',
    control: 'x',
    room: 'room',
    author: { id: 'ann', name: 'Ann' },
  }
  await discord.presses!.hold('T0K', press, f)
  await discord.presses!.answer('T0K', press, {
    text: 'Add bo?',
    controls: [{ id: 'approve:a', label: 'Approve' }],
  }, f)
  assertEquals(seen.map((s) => [s.init.method, s.url]), [
    ['POST', 'https://discord.com/api/v10/interactions/i2/tok/callback'],
    [
      'PATCH',
      'https://discord.com/api/v10/webhooks/app/tok/messages/@original',
    ],
  ])
  assertEquals(JSON.parse(String(seen[0].init.body)), {
    type: 5,
    data: { flags: 64 },
  })
  assertEquals(
    JSON.parse(String(seen[1].init.body)).components[0].components[0].custom_id,
    'approve:a',
  )
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

test("direct opens the person's direct room and posts there, pinging nobody", async () => {
  let seen: { url: string; body: unknown }[] = []
  let f = ((url: string, init: RequestInit) => {
    seen.push({ url, body: JSON.parse(String(init.body)) })
    let body = url.endsWith('/users/@me/channels') ? { id: 'dm' } : { id: 'm' }
    return Promise.resolve(new Response(JSON.stringify(body)))
  }) as unknown as typeof fetch
  assertEquals(await discord.direct!('T', 'u1', 'Hi.', f), { id: 'm' })
  assertEquals(seen, [
    {
      url: 'https://discord.com/api/v10/users/@me/channels',
      body: { recipient_id: 'u1' },
    },
    {
      url: 'https://discord.com/api/v10/channels/dm/messages',
      body: { content: 'Hi.', allowed_mentions: { parse: [] } },
    },
  ])
})

test('a person the bot may not write to directly is unreachable', async () => {
  let refusing = rest(403, { message: 'Cannot send messages to this user' })
  await assertRejects(
    () => discord.direct!('T', 'u1', 'Hi.', refusing.f),
    Unreachable,
    'Cannot send messages to this user',
  )
  await assertRejects(
    () => discord.direct!('T', 'u1', 'Hi.', rest(503, {}).f),
    Unsent,
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

test('a reply’s links reach Discord as one masked link each, never empty', () => {
  let readme =
    'https://raw.githubusercontent.com/yak-sh/yak/main/packages/README.md'
  // An Operator's reply as Discord was sent it, a page linked by the model
  // and cited again with no words.
  let cited =
    `Both use the same read and write model as tasks. ([raw.githubusercontent.com](${readme})) [](<${readme}>)`
  for (
    let [text, want] of [
      [
        cited,
        `Both use the same read and write model as tasks. ([raw.githubusercontent.com](${readme}))`,
      ],
      [
        '[the wiki](<https://w.org/Yak_(animal)>)',
        '[the wiki](https://w.org/Yak_%28animal%29)',
      ],
      [
        'Tap https://yaks.app/approve?t=a.b to approve.',
        'Tap https://yaks.app/approve?t=a.b to approve.',
      ],
    ]
  ) assertEquals(linked(text, links), want, text)
})
