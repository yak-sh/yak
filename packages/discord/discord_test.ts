// Discord's Gateway and replies, against frames as Discord sends them and a
// scripted REST endpoint, through @yaks/chat's generic holder.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { Said } from '@yaks/chat'
import { holder, type Wire } from '@yaks/chat/socket'
import { Unsent } from '@yaks/host/senders'
import { discord, gateway, INTENTS } from './mod.ts'

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
  let h = holder(gateway('T0K'), (s) => heard.push(...s))
  return { h, heard, ...wire() }
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
