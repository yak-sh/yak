// yaks.app's chat platforms (chat.ts) at a space's Operator settings: Discord
// is offered once yaks.app keeps its Discord bot, and each button posts to
// the connections page that sends its owner on to Discord. And a space's
// apps hear and answer on its Discord connection.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { test } from '@yaks/testing'
import { renderToString } from 'preact-render-to-string'
import { accountEid, roomEid, type Said } from '@yaks/chat'
import { registration } from '@yaks/connections'
import { link } from '@yaks/edge'
import type { Bundle } from '@yaks/graph'
import { type Line, line } from '@yaks/query'
import type { D1Like } from '@yaks/d1'
import { d1 } from '../../packages/d1/testing.ts'
import { platform } from './directory-rows-probe.ts'
import { platform as hosted } from './testing.ts'
import { type App, appStore, directory, over } from './directory.ts'
import { KERNEL, meta, metaOf } from './meta.ts'
import {
  arrived,
  choose,
  connected,
  offers,
  PLATFORMS,
  reached,
  recent,
  renamed,
  type Server,
} from './chat.ts'
import { chatCard } from './operator-page.ts'
import { chatRows } from './connections.ts'

let OWNER = crypto.randomUUID()

let KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)))
let SPACE = crypto.randomUUID()
let AT = '/manage/ana/operator'
let { env } = platform('a probe secret', {
  VAULT: d1() as unknown as D1Like,
  VAULT_KEY: KEY,
})
let names = async () =>
  (await offers(env, SPACE)).map((
    o,
  ) => [o.platform.name, o.bot.name, o.user?.name, o.servers])

let botless = await names()
await meta(env).apply(
  [registration('discord', { id: 'app', secret: 's', bot: 'BOT' })],
  KERNEL,
)
let kept = await names()
let card = renderToString(
  chatCard(AT, '/manage/ana/connections', 'Kit', await offers(env, SPACE))[0],
)

test('Discord is offered once yaks.app keeps its bot, with the account a person links there', () => {
  assertEquals(botless, [])
  assertEquals(kept, [['discord', 'discord', 'discord-account', []]])
})

test('each button posts to the connections page, naming the integration still in testing', () => {
  assertStringIncludes(
    card,
    `method="post" action="/manage/ana/connections?enable=discord"`,
  )
  assertStringIncludes(
    card,
    `method="post" action="/manage/ana/connections?enable=discord-account"`,
  )
  assertStringIncludes(card, 'name="integration" value="discord"')
  assertStringIncludes(card, 'Add Kit to a Discord server you manage.')
  assertStringIncludes(card, 'Add to Discord')
  assertStringIncludes(card, 'Connect my Discord account')
  assertStringIncludes(card, `name="back" value="${AT}"`)
  assertEquals(card.includes('?chat=1'), false)
})

// A server the space added the bot to, as `offers` gives it.
let server = (rooms: [string, string][] | null, hears?: string): Server => ({
  connection: 'c1',
  rooms: rooms?.map(([id, name]) => ({
    id,
    name,
    eid: roomEid('discord', id),
  })) ?? null,
  ...hears ? { hears: roomEid('discord', hears) } : {},
})
let drawn = async (...servers: Server[]) =>
  renderToString(
    chatCard(AT, '/manage/ana/connections', 'Kit', [{
      ...(await offers(env, SPACE))[0],
      servers,
    }])[0],
  )

test("each server's channels are offered to hear in full, the chosen one picked", async () => {
  let card = await drawn(server([['1', 'general'], ['2', 'barn']], '2'))
  assertStringIncludes(card, `method="post" action="${AT}?chat=1"`)
  assertStringIncludes(card, 'name="connection" value="c1"')
  assertStringIncludes(card, '<option value>None, only what is said to it')
  assertStringIncludes(card, '<option value="1">#general</option>')
  assertStringIncludes(card, '<option value="2" selected>#barn</option>')
  assertStringIncludes(
    await drawn(server(null)),
    "Discord did not list this server's channels just now.",
  )
})

test('a server the bot is no longer in says so, with a button that adds it again', async () => {
  let away = await drawn({ ...server(null), away: true })
  assertStringIncludes(away, 'Kit is no longer in this Discord server.')
  assertStringIncludes(away, 'Add to Discord again')
  assertEquals(away.includes('?chat=1'), false)
  assertStringIncludes(
    await drawn({ ...server(null), away: true, own: true }),
    'Your own Discord bot is no longer in this server.',
  )
})

// Two spaces and the Discord connections they hold, yaks.app's own bot added
// to the barn, on a platform that keeps its bot.
let spaces = async () => {
  let p = hosted('a probe secret', {
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: KEY,
  })
  let at = meta(p.env)
  let dir = directory({ fetch: over(at) })
  await at.apply([
    registration('discord', { id: 'app', secret: 's', bot: 'BOT' }),
    { entity: { eid: '$a' }, space: { slug: 'ada', store: 'ada' } },
    { entity: { eid: '$b' }, space: { slug: 'bo', store: 'bo' } },
  ], KERNEL)
  let [ada, bo] = [(await dir.space('ada'))!, (await dir.space('bo'))!]
  let held = async (space: { eid: string }, account: string) =>
    (await at.apply([{
      entity: { eid: crypto.randomUUID() },
      connection: {
        integration: 'discord',
        owner: space.eid,
        account,
        status: 'connected',
      },
    }], KERNEL))[0].entity.eid
  let status = async (eid: string) => {
    let [c] = await at.query(line`.entity.eid=${eid}&.connection&*`)
    return c ? (c.connection as { status: string }).status : 'gone'
  }
  return { p, ada, bo, held, status }
}

test('a server the bot was removed from is offered again, not reported', async () => {
  let { p, ada, held } = await spaces()
  let eid = await held(ada, 'barn')
  let was = globalThis.fetch
  globalThis.fetch = () =>
    Promise.resolve(Response.json({ message: 'Missing Access', code: 50001 }, {
      status: 403,
    }))
  try {
    let [{ servers }] = await offers(p.env, ada.eid)
    assertEquals(servers.map((s) => [s.connection, s.rooms, s.away]), [
      [eid, null, true],
    ])
  } finally {
    globalThis.fetch = was
  }
})

test('a space is reached in each server its bot serves, named and in the room it hears as kept when they were set, asking Discord nothing on the way; one with none offers Discord', async () => {
  let { p, ada, bo, held } = await spaces()
  let barn = await held(ada, 'barn'), mill = await held(ada, 'mill')
  let answers: Record<string, unknown> = {
    'guilds/barn': { name: 'Barn' },
    'guilds/barn/channels': [{ id: 'c1', name: 'general', type: 0 }],
    'channels/c1': { guild_id: 'barn' },
  }
  let was = globalThis.fetch
  globalThis.fetch = (input) => {
    let path = String(input).replace('https://discord.com/api/v10/', '')
    return Promise.resolve(
      path in answers
        ? Response.json(answers[path])
        : Response.json({ message: 'Missing Access' }, { status: 403 }),
    )
  }
  let rows = (space: { eid: string }) =>
    chatRows(directory({ fetch: over(meta(p.env)) }), space.eid)
  try {
    await connected(p.env, barn)
    await connected(p.env, mill)
    await choose(p.env, { person: OWNER, role: 'owner' }, ada.eid, barn, 'c1')
    globalThis.fetch = (input) =>
      Promise.reject(new Error(`Discord was asked: ${input}`))
    // Each wears Discord's own mark, from its integration.
    let marked = async (space: { eid: string }) => {
      let { places, unset } = await reached(p.env, await rows(space))
      let bare = <T extends { logo?: string }>({ logo, ...rest }: T) => {
        assert(logo?.startsWith('<svg'))
        return rest
      }
      return { places: places.map(bare), unset: unset.map(bare) }
    }
    assertEquals(await marked(ada), {
      places: [{
        platform: 'Discord',
        server: 'Barn',
        room: 'general',
        href: 'https://discord.com/channels/barn/c1',
      }, { platform: 'Discord', href: 'https://discord.com/channels/mill' }],
      unset: [],
    })
    assertEquals(await marked(bo), {
      places: [],
      unset: [{ platform: 'Discord', integration: 'discord', testing: true }],
    })
  } finally {
    globalThis.fetch = was
  }
})

test("yaks.app's bot added to a server from another space moves it there whole", async () => {
  let { p, ada, bo, held, status } = await spaces()
  let mine = await held(ada, 'barn'), mill = await held(ada, 'mill')
  let theirs = await held(bo, 'barn')
  await connected(p.env, theirs)
  assertEquals(
    await Promise.all([mine, mill, theirs].map(status)),
    ['gone', 'connected', 'connected'],
  )
})

test('a space chooses a room only on a chat connection it holds', async () => {
  await assertRejects(
    () =>
      choose(
        env,
        { person: crypto.randomUUID(), role: 'owner' },
        SPACE,
        crypto.randomUUID(),
        '1',
      ),
    Error,
    'This space holds no such chat connection.',
  )
})

// Discord as the bot sees it: `general` is a room of the barn, `lobby` of
// the mill, and every call made is noted.
let discordApi = (asked: string[]): typeof fetch => (input, init) => {
  let url = String(input instanceof Request ? input.url : input)
  let path = url.replace('https://discord.com/api/v10/', '')
  if (path == url) return Promise.reject(new Error(`no network: ${url}`))
  asked.push(`${init?.method ?? 'GET'} ${path}`)
  let room = path.split('/')[1]
  if (path.includes('/messages?')) {
    return Promise.resolve(Response.json([{
      id: 'm0',
      channel_id: room,
      author: { id: 'bo', username: 'Bo' },
      content: 'pie at nine',
      timestamp: '2026-11-20T05:39:00.000Z',
    }]))
  }
  return Promise.resolve(Response.json(
    path.endsWith('/messages')
      ? { id: 'p1' }
      : { id: room, guild_id: room == 'lobby' ? 'mill' : 'barn' },
  ))
}

// A space's apps on its Discord connection (chat.ts `arrived`,
// `appChatters`): what the bot hears in the connection's server lands in each
// app that uses it, and what an app writes to a room is posted by that bot
// into that server alone, whatever the app's own rows say of a room.
test('an app that uses the connection hears its server, and answers only into it', async () => {
  let p = hosted('a probe secret', {
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: KEY,
  })
  let at = meta(p.env)
  let dir = directory({ fetch: over(at) })
  await at.apply([
    registration('discord', { id: 'app', secret: 's', bot: 'BOT' }),
    { entity: { eid: '$space' }, space: { slug: 'ada', store: 'ada' } },
  ], KERNEL)
  let space = (await dir.space('ada'))!
  let app = (slug: string) => ({
    entity: { eid: `$${slug}` },
    app: { slug, space: space.eid, version: 0, access: 'public' },
  })
  let ours = crypto.randomUUID(), another = crypto.randomUUID()
  let connection = (eid: string, owner: string) => ({
    entity: { eid },
    connection: {
      integration: 'discord',
      owner,
      account: 'barn',
      status: 'connected',
    },
  })
  await at.apply([app('notes'), app('quiet')], KERNEL)
  let notes = (await dir.app(space, 'notes'))!
  let quiet = (await dir.app(space, 'quiet'))!
  await at.apply([
    connection(ours, space.eid),
    connection(another, crypto.randomUUID()),
    link(notes.eid, 'uses', ours),
  ] as Bundle[], KERNEL)
  let store = (of: App) =>
    metaOf(appStore(p.env.STORE, space, of, p.env), KERNEL)
  let rows = (of: App, q: Line) => store(of).query(q, { trusted: true })
  let said = (id: string, server: string): Said => ({
    id,
    room: 'general',
    server,
    author: { id: 'ann', name: 'Ann' },
    text: 'the barn opens at nine',
    at: '2026-11-20T05:40:00.000Z',
  })
  let discord = PLATFORMS.get('discord')!
  await arrived(p.env, discord, said('m1', 'barn'))
  await arrived(p.env, discord, said('m2', 'mill'))
  let heard = await rows(notes, line`.chat_message&*`)
  assertEquals(heard.map((b) => [b.chat_message, b.doc]), [[{
    via: 'discord',
    room: roomEid('discord', 'general'),
    author: accountEid('discord', 'ann'),
    message_id: 'm1',
    at: '2026-11-20T05:40:00.000Z',
    connection: ours,
  }, { body: 'the barn opens at nine' }]])
  assertEquals(await rows(quiet, line`.chat_message`), [])

  let asked: string[] = []
  let was = globalThis.fetch
  globalThis.fetch = discordApi(asked)
  try {
    let lobby = roomEid('discord', 'lobby')
    let reply = (to: string, via = ours) => ({
      entity: { eid: crypto.randomUUID() },
      chat_message: { via: 'discord', connection: via, reply_to: 'm1' },
      doc: { body: 'See you there.' },
      deliver: { to },
    })
    let general = roomEid('discord', 'general')
    let posted = reply(general), elsewhere = reply(lobby)
    let borrowed = reply(general, another)
    await store(notes).apply([
      // The app's own row says the lobby is in the barn: Discord decides.
      {
        entity: { eid: lobby },
        chat_room: { via: 'discord', id: 'lobby', server: 'barn' },
      },
      posted,
      elsewhere,
      borrowed,
    ])
    await p.settled()
    let outcome = async (b: Bundle) => {
      let [row] = await rows(notes, line`.entity.eid=${b.entity.eid}&*`)
      return row.delivered
        ? 'delivered'
        : String((row.bounced as { reason: string }).reason)
    }
    assertEquals(
      await Promise.all([posted, elsewhere, borrowed].map(outcome)),
      [
        'delivered',
        "room lobby is not in its connection's servers",
        `connection ${another} posts into no server here`,
      ],
    )
    assertEquals(asked.sort(), [
      'GET channels/general',
      'GET channels/lobby',
      'POST channels/general/messages',
    ])
  } finally {
    globalThis.fetch = was
  }
})

// What the Operator reads back of a room (chat.ts `recent`): by the bot that
// speaks for the connection, and only in a server that connection serves.
test("a room is read back by its connection's bot, only in the servers it serves", async () => {
  let p = hosted('a probe secret', {
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: KEY,
  })
  let ours = crypto.randomUUID(), gone = crypto.randomUUID()
  let connection = (eid: string, status: string) => ({
    entity: { eid },
    connection: {
      integration: 'discord',
      owner: crypto.randomUUID(),
      account: 'barn',
      status,
    },
  })
  await meta(p.env).apply([
    registration('discord', { id: 'app', secret: 's', bot: 'BOT' }),
    connection(ours, 'connected'),
    connection(gone, 'broken'),
  ], KERNEL)
  let asked: string[] = []
  let was = globalThis.fetch
  globalThis.fetch = discordApi(asked)
  try {
    let page = { before: 'm1', limit: 30 }
    let read = (connection: string, room: string, server?: string) =>
      recent(p.env, 'discord', { connection, room, server }, page)
    assertEquals(
      (await read(ours, 'general', 'barn')).map((s) => [s.id, s.server]),
      [['m0', 'barn']],
    )
    await assertRejects(() => read(ours, 'lobby'), Error, 'not in its')
    await assertRejects(() => read(gone, 'general', 'barn'), Error, 'no server')
    assertEquals(asked, [
      'GET channels/general/messages?before=m1&limit=30',
      'GET channels/lobby',
    ])
  } finally {
    globalThis.fetch = was
  }
})

// yaks.app's bot goes by the Operator's name in each server a space added it
// to (chat.ts `connected`, `renamed`): its nickname there, set by the bot
// that speaks for the connection, and set again when the Operator is
// renamed; a connection that is not connected names nothing.
test("yaks.app's bot goes by its space's Operator's name in the server it was added to, and again once renamed", async () => {
  let p = hosted('a probe secret', {
    VAULT: d1() as unknown as D1Like,
    VAULT_KEY: KEY,
  })
  let at = meta(p.env)
  let dir = directory({ fetch: over(at) })
  await at.apply([
    registration('discord', { id: 'app', secret: 's', bot: 'BOT' }),
    {
      entity: { eid: '$space' },
      space: { slug: 'ada', store: 'ada' },
      operator: { name: 'Pip' },
    },
  ], KERNEL)
  let space = (await dir.space('ada'))!
  let ours = crypto.randomUUID(), gone = crypto.randomUUID()
  let connection = (eid: string, account: string, status: string) => ({
    entity: { eid },
    connection: { integration: 'discord', owner: space.eid, account, status },
  })
  await at.apply([
    connection(ours, 'barn', 'connected'),
    connection(gone, 'mill', 'broken'),
  ], KERNEL)
  let asked: string[] = []
  let was = globalThis.fetch
  globalThis.fetch = (input, init) => {
    let h = init?.headers as Record<string, string>
    asked.push(
      `${init?.method} ${String(input)} ${h.authorization} ${init?.body}`,
    )
    return Promise.resolve(Response.json({}))
  }
  try {
    await connected(p.env, ours)
    await connected(p.env, gone)
    await at.apply([{ entity: { eid: space.eid }, operator: { name: 'Wren' } }])
    await renamed(p.env, space.eid)
    let patch =
      'PATCH https://discord.com/api/v10/guilds/barn/members/@me Bot BOT'
    assertEquals(asked.filter((a) => a.startsWith('PATCH')), [
      `${patch} {"nick":"Pip"}`,
      `${patch} {"nick":"Wren"}`,
    ])
  } finally {
    globalThis.fetch = was
  }
})
