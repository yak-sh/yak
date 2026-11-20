// What @yaks/chat does with a message heard on any platform: the rows that
// keep it, how it is said to whoever answers, and an answer cut to fit.

import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  accountEid,
  framing,
  kept,
  messageEid,
  pieces,
  roomEid,
  type Said,
} from './mod.ts'

let said: Said = {
  id: 'm1',
  room: 'general',
  server: 'barn',
  author: { id: 'ann', name: 'Ann' },
  text: 'hello',
  at: '2026-11-20T05:40:00.000Z',
  mentioned: true,
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
    mentioned: true,
  })
  assertEquals(message.doc, { body: 'hello' })
  // One platform's ids never meet another's.
  assertEquals(messageEid('slack', 'm1') == message.entity.eid, false)
})

test('framing says the platform, a direct message, and who wrote it', () => {
  assertEquals(framing({ title: 'Discord' }, said), 'On Discord, from Ann: ')
  assertEquals(
    framing({ title: 'Discord' }, { ...said, server: undefined }),
    'On Discord, directly, from Ann: ',
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
