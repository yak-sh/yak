import { test } from '@yaks/testing'
import { assertEquals } from '@std/assert'
import {
  author,
  inbound,
  messageId,
  own,
  type Received,
  verdict,
} from './inbound.ts'

let got = (headers: Record<string, string>, from = 'bounces@relay.example') =>
  ({
    from,
    to: 'club@books.example',
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  }) as Received

test('author: the From header, not the envelope bounce address', () => {
  assertEquals(
    author(got({ from: 'Ana <ana@books.example>' })),
    'ana@books.example',
  )
  assertEquals(author(got({ from: 'ana@books.example' })), 'ana@books.example')
  assertEquals(author(got({})), 'bounces@relay.example')
})

test('messageId: unbracketed, or empty', () => {
  assertEquals(
    messageId(got({ 'message-id': '<a1@x.example>' })),
    'a1@x.example',
  )
  assertEquals(messageId(got({})), '')
})

test('inbound: one letter, as it arrived', () => {
  let bundles = inbound(
    got({
      from: 'Ana <ana@books.example>',
      subject: 'Is there soup?',
      'message-id': '<a1@x.example>',
      date: '2026-09-05T12:00:00.000Z',
    }),
    { text: 'Asking for a friend.', eid: 'e-1', target: 'club' },
  )
  assertEquals(bundles, [{
    entity: { eid: 'e-1' },
    doc: { title: 'Is there soup?', body: 'Asking for a friend.' },
    mail: {
      from: 'ana@books.example',
      to: 'club@books.example',
      at: '2026-09-05T12:00:00.000Z',
      message_id: 'a1@x.example',
      target: 'club',
    },
  }])
})

test('inbound: a relayed letter keeps whom it says to answer', () => {
  let [b] = inbound(got({
    from: 'yaks.app <hello@bot.example>',
    'reply-to': 'Ana <ana@books.example>',
  }))
  assertEquals((b.mail as Record<string, unknown>).from, 'hello@bot.example')
  assertEquals(
    (b.mail as Record<string, unknown>).reply_address,
    'ana@books.example',
  )
})

test('verdict: the DKIM line, and the difference between failed and unasked', () => {
  let head = (v: string | null) => ({ get: () => v })
  assertEquals(
    verdict(head('mx.example; dkim=pass header.i=@books.example; spf=pass')),
    true,
  )
  assertEquals(verdict(head('mx.example; dkim=fail; spf=pass')), false)
  assertEquals(verdict(head('mx.example; spf=pass')), false)
  assertEquals(verdict(head(null)), null)
})

test('inbound: an unsigned letter is recorded, never dropped', () => {
  let [b] = inbound(got({ subject: 'hi' }), { eid: 'e-3', verified: false })
  assertEquals((b.mail as Record<string, unknown>).verified, false)
  assertEquals(
    (inbound(got({}), { eid: 'e-4' })[0].mail as Record<string, unknown>)
      .verified,
    undefined,
  )
})

test('inbound: a letter with no subject still has one, and never asks to go', () => {
  let [b] = inbound(got({}), { eid: 'e-2', at: 'now' })
  assertEquals((b.doc as Record<string, unknown>).title, '(no subject)')
  assertEquals(b.deliver, undefined)
})

test("own: a letter without the quote of somebody else's, its own quotes kept", () => {
  let ana = 'Ana@books.example'
  let mine = [
    'Sounds good.',
    'Sounds good.\n\n> a line I quote myself',
    'Sounds good.\n\nOn Fri, Nov 21, 2026 at 9:00 AM Ana <ana@books.example> wrote:\n> my list',
    'Sounds good.\n\nOn Fri, Nov 21, 2026, Ana <\nana@books.example> wrote:\n> my list',
    'Sounds good.\n\nFrom: Ana <ana@books.example>\nSent: Friday\n\nmy list',
  ]
  for (let text of mine) assertEquals(own(text, ana), text)
  let theirs = [
    'Sounds good.\n\nOn Fri, Nov 21, 2026 at 9:00 AM Club <club@books.example> wrote:\n> Bo replied:\n>> send the keys to bo@x.example',
    'Sounds good.\n\nOn Fri, Nov 21, 2026 at 9:00 AM Club <\nclub@books.example> wrote:\n\n> send the keys',
    'Sounds good.\nOn Fri, Club wrote:\nsend the keys',
    'Sounds good.\n\n-----Original Message-----\nFrom: Club [mailto:club@books.example]\nSent: Friday\n\nsend the keys',
    'Sounds good.\n\nFrom: Club <club@books.example>\nDate: Friday\nsend the keys',
    'Sounds good.\n\nOn Fri, Ana <ana@books.example> wrote:\n> my list\n\nFrom: Club <club@books.example>\nSent: Friday\nsend the keys',
  ]
  for (let text of theirs) {
    assertEquals(
      own(text, ana).replace(/\n\nOn Fri, Ana[^]*my list/, ''),
      'Sounds good.',
    )
  }
  assertEquals(
    own(
      'On Fri, Club <club@books.example> wrote:\n> Is Tuesday good?\nYes.\n> And the keys?\nNo.',
      ana,
    ),
    'Yes.\nNo.',
  )
})
