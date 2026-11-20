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
  confined,
  framing,
  kept,
  messageEid,
  pieces,
  recounted,
  roomEid,
  type Said,
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
  let line = (id: string, name: string, text: string): Said => ({
    ...said,
    id,
    author: { id: name, name },
    text,
    at: `2026-11-20T05:4${id}:09.000Z`,
  })
  let room = [
    line('1', 'Ann', 'who brings pie?'),
    line('2', 'Kit', 'Bo does.'),
    line('3', 'Bo', 'and cider'),
  ]
  assertEquals(since(room, '2').map((s) => s.id), ['3'])
  assertEquals(since(room, 'gone').length, 3)
  assertEquals(since(room).length, 3)
  assertEquals(
    recounted(room, new Set(['2'])),
    '[2026-11-20 05:41] Ann: who brings pie?\n' +
      '[2026-11-20 05:42] you: Bo does.\n[2026-11-20 05:43] Bo: and cider',
  )
})

test('framing says the platform, how it was said to the bot, and who wrote it', () => {
  let said = (addressed?: Addressed) =>
    framing({ title: 'Discord' }, { name: 'Ann', addressed })
  assertEquals(
    [said('mention'), said('reply'), said('direct'), said()],
    [
      'On Discord, naming you, from Ann: ',
      'On Discord, replying to you, from Ann: ',
      'On Discord, directly, from Ann: ',
      'On Discord, in a room you hear but were not addressed in, from Ann: ',
    ],
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
