// What @yaks/chat does with a message heard on any platform: the rows that
// keep it, how it is said to whoever answers, and an answer cut to fit.

import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { type Bundle, type Comp, graph } from '@yaks/graph'
import { effects as registry } from '@yaks/effects'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc, docs } from '@yaks/doc'
import { mailDoc } from '@yaks/mail'
import { type Chatter, Unsent } from '@yaks/host/senders'
import { chatDoc } from './vocab.ts'
import { effects } from './effects.ts'
import {
  accountEid,
  type Addressed,
  chain,
  confined,
  framing,
  kept,
  linked,
  mentioned,
  messageEid,
  notice,
  pieces,
  reading,
  recounted,
  roomEid,
  type Said,
  setting,
  showing,
  since,
  within,
} from './mod.ts'

let said: Said = {
  id: 'm1',
  room: 'general',
  server: 'barn',
  author: { id: 'ann', name: 'Ann' },
  text: 'hello',
  at: '2026-11-20T05:40:00.000Z',
  addressed: 'mention',
}

test('kept: the room, who said it, and the message naming both', () => {
  let [room, author, message] = kept('discord', said)
  assertEquals(room, {
    entity: { eid: roomEid('discord', 'general') },
    chat_room: { via: 'discord', id: 'general', server: 'barn' },
  })
  assertEquals(author.chat_account, { via: 'discord', id: 'ann', name: 'Ann' })
  assertEquals(message.entity.eid, messageEid('discord', 'm1'))
  assertEquals(message.chat_message, {
    via: 'discord',
    room: room.entity.eid,
    author: accountEid('discord', 'ann'),
    message_id: 'm1',
    at: said.at,
    addressed: 'mention',
  })
  assertEquals(message.doc, { body: 'hello' })
  // One platform's ids never meet another's.
  assertEquals(messageEid('slack', 'm1') == message.entity.eid, false)
  // Heard by a connection's bot, it names the connection an answer goes by.
  let heard = kept('discord', said, 'c1')[2].chat_message as Comp
  assertEquals(heard.connection, 'c1')
})

test('confined: a post goes only into a room of the servers its connection serves', async () => {
  let posted: string[] = []
  let chatter = confined({
    post: (chat) => (posted.push(chat.room), Promise.resolve({ id: 'r' })),
  }, {
    serves: (c) =>
      Promise.resolve({ ours: ['barn'], own: ['barn', 'mill'] }[c] ?? []),
    server: ({ room }) =>
      Promise.resolve({ general: 'barn', lobby: 'mill' }[room]),
  })
  let post = (connection: string, room: string) =>
    chatter.post({ connection, room, text: 'hi' })
  assertEquals(await post('ours', 'general'), { id: 'r' })
  await assertRejects(() => post('ours', 'lobby'), Error, 'not in its')
  await assertRejects(() => post('ours', 'dm'), Error, 'not in its')
  await assertRejects(() => post('theirs', 'general'), Error, 'no server')
  assertEquals(await post('own', 'lobby'), { id: 'r' })
  assertEquals(posted, ['general', 'lobby'])
})

test('within: a room is read only in a server its connection serves', async () => {
  let at = { connection: 'c1', room: 'general' }
  let asked = 0
  let where = (server?: string) => () => (asked++, Promise.resolve(server))
  assertEquals(await within(at, ['barn', 'mill'], where('mill')), 'mill')
  await assertRejects(
    () => within(at, ['barn'], where('mill')),
    Error,
    'not in its',
  )
  await assertRejects(() => within(at, ['barn'], where()), Error, 'not in its')
  await assertRejects(() => within(at, [], where('barn')), Error, 'no server')
  assertEquals(asked, 3)
})

test("a room read back: what came after the bot's last answer, a line each", () => {
  let line = (
    id: string,
    name: string,
    text: string,
    more: Partial<Said> = {},
  ): Said => ({
    ...said,
    ...more,
    id,
    author: { id: name, name },
    text,
    at: `2026-11-20T05:4${id}:09.000Z`,
  })
  let room = [
    line('1', 'Ann', 'who brings pie?'),
    line('2', 'Kit', 'Bo does.', { reply_to: '1' }),
    line('3', 'Bo', 'and cider'),
  ]
  assertEquals(since(room, '2').map((s) => s.id), ['3'])
  assertEquals(since(room, 'gone').length, 3)
  assertEquals(since(room).length, 3)
  assertEquals(
    recounted(room, new Set(['2'])),
    '[2026-11-20 05:41] (message 1) Ann: who brings pie?\n' +
      '[2026-11-20 05:42] (message 2, replying to 1) you: Bo does.\n' +
      '[2026-11-20 05:43] (message 3) Bo: and cider',
  )
  assertEquals(
    recounted(room.slice(0, 1), new Set(), new Map([['Ann', 'Ann (owner)']])),
    '[2026-11-20 05:41] (message 1) Ann (owner): who brings pie?',
  )
})

test('framing says the platform, how it was said to the bot, and who wrote it', () => {
  let said = (addressed?: Addressed) =>
    framing({ title: 'Discord' }, { name: 'Ann', addressed })
  assertEquals(
    [said('mention'), said('reply'), said('direct'), said()],
    [
      'On Discord, naming you, from Ann: ',
      'On Discord, replying in a thread with you, from Ann: ',
      'On Discord, directly, from Ann: ',
      'On Discord, in a room you hear but were not addressed in, from Ann: ',
    ],
  )
  assertEquals(
    framing({ title: 'Discord' }, {
      name: 'Ann',
      addressed: 'reply',
      at: { room: '7', name: 'general', message: '42', reply_to: '41' },
    }),
    'On Discord in #general (room 7, message 42, replying to 41), replying in a thread with you, from Ann: ',
  )
  assertEquals(
    framing({ title: 'Discord' }, {
      name: 'Ann',
      at: { room: '7', direct: true, message: '42' },
    }),
    'On Discord in direct messages (room 7, message 42), which you hear but were not addressed in, from Ann: ',
  )
})

test('pieces cut at a paragraph, a line, a space, or hard', () => {
  for (
    let [text, limit, want] of [
      ['short', 10, ['short']],
      ['one two\n\nthree four', 12, ['one two', 'three four']],
      ['aaa bbb\nccc ddd', 10, ['aaa bbb', 'ccc ddd']],
      ['aaa bbb ccc', 8, ['aaa bbb', 'ccc']],
      ['abcdefghij', 4, ['abcd', 'efgh', 'ij']],
      ['  ', 4, []],
    ] as [string, number, string[]][]
  ) assertEquals(pieces(text, limit), want, text)
})

// An Operator's reply as Discord was sent it, a page linked by the model and
// cited again with no words.
let CITED =
  'Both use the same read and write model as tasks. ([raw.githubusercontent.com](https://raw.githubusercontent.com/yak-sh/yak/main/packages/README.md)) [](<https://raw.githubusercontent.com/yak-sh/yak/main/packages/README.md>)'

test('a link is written once, by its words or else its address alone', () => {
  let md = (words: string, url: string) => words ? `[${words}](${url})` : url
  for (
    let [text, want, form] of [
      [
        CITED,
        'Both use the same read and write model as tasks. (raw.githubusercontent.com (https://raw.githubusercontent.com/yak-sh/yak/main/packages/README.md))',
      ],
      ['See https://a.com/x.', 'See https://a.com/x.'],
      ['(see https://a.com/x(1)), then', '(see https://a.com/x(1)), then'],
      [
        '[](https://a.com) and <https://b.com>',
        'https://a.com and https://b.com',
      ],
      ['[https://a.com](https://a.com/z)', 'https://a.com/z', md],
      [
        '[guide](https://a.com) [guide](https://a.com)',
        '[guide](https://a.com) [guide](https://a.com)',
        md,
      ],
      ['https://a.com then [](https://a.com/)', 'https://a.com then', md],
      [
        '`[](https://a.com)` [x](T-12) [y](mailto:a@b.c)',
        '`[](https://a.com)` [x](T-12) [y](mailto:a@b.c)',
        md,
      ],
    ] as [string, string, Parameters<typeof linked>[1]?][]
  ) assertEquals(linked(text, form), want, text)
})

// The Operator naming someone in its reply mentions them, so they are
// notified (T-2379): the first time each is named, by any name they go by.
test('a reply names each person once as a mention, never in code or a link', () => {
  let people = [
    { name: 'Matt', account: '7' },
    { name: 'Matthew Doe', account: '7' },
    { name: 'Bo', account: '8' },
    { name: 'Ann', account: '9' },
  ]
  let at = (a: string) => `<@${a}>`
  for (
    let [text, want] of [
      ['Matt, it is live.', '<@7>, it is live.'],
      ['matt and Matt', '<@7> and Matt'],
      ['Matthew Doe, then Matt.', '<@7>, then Matt.'],
      ['Mattress, Bo, @Matt', 'Mattress, Bo, @Matt'],
      [
        '`Ann` [Ann](https://a.com/Ann) <https://a.com/Ann>, ann!',
        '`Ann` [Ann](https://a.com/Ann) <https://a.com/Ann>, <@9>!',
      ],
      ['Nobody here.', 'Nobody here.'],
    ]
  ) assertEquals(mentioned(text, people, at), want, text)
})

// A graph that keeps chat messages and posts them through `chatter`.
let rig = (chatter?: Chatter) => {
  let vocab = loadVocab([docDoc, mailDoc, chatDoc])
  let fx = registry(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g = graph({ storage: ram(vocab), vocab, plugins: [fx, docs()] })
  fx.handle(effects(chatter ? { chatters: { discord: chatter } } : null))
  return g
}
let room = kept('discord', said)[0]
let CONN = '0b1c2d3e-0000-4000-8000-00000000c0de'
let conn = { entity: { eid: CONN }, doc: { title: 'Discord: the barn' } }
let reply = (eid: string, more: Record<string, unknown> = {}): Bundle => ({
  entity: { eid },
  chat_message: {
    via: 'discord',
    connection: CONN,
    reply_to: 'm1',
    ...more,
  },
  doc: { body: 'Done.' },
  deliver: { to: room.entity.eid },
})
// A failed post is reported by the effects runner (to the console here),
// never thrown back at the write that asked for it.
let one = async (g: ReturnType<typeof rig>, eid: string) =>
  (await g.get([eid]))[0] as Record<string, Record<string, unknown>>

test('chat_post: a reply is posted in its room by its connection, once', async () => {
  let posted: unknown[] = []
  let g = rig({
    post: (chat) => {
      posted.push(chat)
      return Promise.resolve({ id: 'r1' })
    },
  })
  let eid = crypto.randomUUID()
  await g.apply([conn, room, reply(eid)])
  assertEquals(posted, [{
    connection: CONN,
    room: 'general',
    text: 'Done.',
    reply_to: 'm1',
  }])
  let row = await one(g, eid)
  assertEquals(row.chat_message.message_id, 'r1')
  assertEquals(!!row.delivered, true)
})

test('chat_post: a private message posts a notice pinging its one reader, never its words; buttons go with a public one', async () => {
  let posted: Record<string, unknown>[] = []
  let g = rig({
    post: (chat) => {
      posted.push(chat)
      return Promise.resolve({ id: 'r1' })
    },
  })
  let secret = crypto.randomUUID(), open = crypto.randomUUID()
  let controls = [{ id: 'approve:a', label: 'Approve' }]
  await g.apply([conn, room, {
    ...reply(secret, { controls }),
    chat_private: { to: 'ann' },
  }, reply(open, { controls })])
  assertEquals(posted, [{
    connection: CONN,
    room: 'general',
    ...notice(secret, 'ann'),
    reply_to: 'm1',
  }, {
    connection: CONN,
    room: 'general',
    text: 'Done.',
    controls,
    reply_to: 'm1',
  }])
  assertEquals(JSON.stringify(posted[0]).includes('Done.'), false)
})

test('chat_post: a refusal bounces with its reason; a platform that never took it is tried again', async () => {
  let g = rig({ post: () => Promise.reject(new Error('Missing Access')) })
  let eid = crypto.randomUUID()
  await g.apply([conn, room, reply(eid)])
  assertEquals((await one(g, eid)).bounced.reason, 'Missing Access')

  let busy = rig({ post: () => Promise.reject(new Unsent('429', 1000)) })
  let again = crypto.randomUUID()
  await busy.apply([conn, room, reply(again)])
  let row = await one(busy, again)
  assertEquals([row.deliver.tried, row.deliver.waiting, row.bounced], [
    undefined,
    '429',
    undefined,
  ])
})

test('chat_post: with nothing lent for its platform, a reply waits and says why', async () => {
  let g = rig()
  let eid = crypto.randomUUID()
  await g.apply([conn, room, reply(eid)])
  assertEquals(
    (await one(g, eid)).deliver.waiting,
    'waiting for a chatter: nothing lends discord',
  )
})

test('showing: shown at once and each beat while the work goes on, never past most', async () => {
  let run = async (
    beats: boolean[],
    show = () => Promise.resolve(),
    most?: number,
  ) => {
    let shown = 0, waited: number[] = []
    await showing(
      { every: 8000, show: () => (shown++, show()) },
      () => Promise.resolve(beats.shift() ?? false),
      { most, wait: (ms) => (waited.push(ms), Promise.resolve()) },
    )
    return { shown, waited }
  }
  assertEquals(await run([true, true, false]), {
    shown: 2,
    waited: [8000, 8000],
  })
  assertEquals(await run([false]), { shown: 0, waited: [] })
  assertEquals((await run([true, true, true], undefined, 16000)).shown, 2)
  assertEquals(
    (await run([true, true, false], () => Promise.reject(new Unsent('busy'))))
      .shown,
    2,
  )
  await assertRejects(
    () => run([true, true], () => Promise.reject(new Error('Missing Access'))),
    Error,
    'Missing Access',
  )
})

test('chain: up the replies to the first, oldest first, stopping at a cap, a loop or an unread one', async () => {
  let up = (links: Record<string, string | undefined>, cap?: number) =>
    chain(
      { reply_to: 'c' },
      (id) =>
        Promise.resolve(
          id in links
            ? { ...said, id, ...links[id] ? { reply_to: links[id] } : {} }
            : undefined,
        ),
      cap,
    ).then((l) => l.map((s) => s.id))
  assertEquals(await up({ c: 'b', b: 'a', a: undefined }), ['a', 'b', 'c'])
  assertEquals(await up({ c: 'b', b: 'a', a: undefined }, 2), ['b', 'c'])
  assertEquals(await up({ c: 'b', b: 'c' }), ['b', 'c'])
  assertEquals(await up({ c: 'b' }), ['c'])
})

test('reading: the ids a path binds by the first read it matches, none for any other', () => {
  let api = {
    reads: [
      '/guilds/{server}',
      '/channels/{room}/messages/{message}',
      '/users/{user}',
    ],
  }
  let cases: [string, Record<string, string> | undefined][] = [
    ['/guilds/1', { server: '1' }],
    ['guilds/1/', { server: '1' }],
    ['/channels/2/messages/3', { room: '2', message: '3' }],
    ['/users/%40me', { user: '@me' }],
    ['/guilds/1/bans', undefined],
    ['/channels/2/messages', undefined],
    ['/guilds/..', undefined],
    ['/applications/1', undefined],
  ]
  for (let [path, ids] of cases) assertEquals(reading(api, path), ids, path)
})

test('setting: the server and its icon, the room and topic, and who is talking with their roles', () => {
  let b = {
    server: { id: 'g1', name: 'Barn', icon: 'https://cdn/i.png' },
    room: { id: 'c1', name: 'hall', topic: 'hay' },
    people: [
      { id: 'ann', name: 'Annie', roles: ['Mod'] },
      { id: 'bo', name: 'bo', roles: [] },
    ],
  }
  assertEquals(
    setting({ title: 'Discord' }, b, new Map([['ann', 'Ann (verified)']])),
    'Where this is: the Discord server “Barn” (id g1; its icon is https://cdn/i.png), in #hall (id c1), whose topic is “hay”.\n' +
      'Talking here, with their roles in the server: Ann (verified), id ann: Mod; bo, id bo: no roles.',
  )
  assertEquals(
    setting({ title: 'Discord' }, { room: { id: 'd' }, people: [] }),
    'Where this is: Discord, in a room (id d).',
  )
})
