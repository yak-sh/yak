// yaks.app's chat platforms (chat.ts) at a space's Operator settings: Discord
// is offered once yaks.app keeps its Discord bot, and each button posts to
// the connections page that sends its owner on to Discord. And a space's
// apps hear and answer on its Discord connection.

import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
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
import { arrived, choose, offers, PLATFORMS, type Server } from './chat.ts'
import { chatCard } from './operator-page.ts'

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
        "room lobby is not in its connection's server",
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
