import { assertEquals } from '@std/assert'
import { author, inbound, messageId, type Received } from './inbound.ts'

let got = (headers: Record<string, string>, from = 'bounces@relay.example') =>
  ({
    from,
    to: 'club@books.example',
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
  }) as Received

Deno.test('author: the From header, not the envelope bounce address', () => {
  assertEquals(
    author(got({ from: 'Ana <ana@books.example>' })),
    'ana@books.example',
  )
  assertEquals(author(got({ from: 'ana@books.example' })), 'ana@books.example')
  assertEquals(author(got({})), 'bounces@relay.example')
})

Deno.test('messageId: unbracketed, or empty', () => {
  assertEquals(
    messageId(got({ 'message-id': '<a1@x.example>' })),
    'a1@x.example',
  )
  assertEquals(messageId(got({})), '')
})

Deno.test('inbound: one letter, as it arrived', () => {
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
    mail: {
      from: 'ana@books.example',
      to: 'club@books.example',
      subject: 'Is there soup?',
      body: 'Asking for a friend.',
      at: '2026-09-05T12:00:00.000Z',
      message_id: 'a1@x.example',
      target: 'club',
    },
  }])
})

Deno.test('inbound: a letter with no subject still has one, and never asks to go', () => {
  let [b] = inbound(got({}), { eid: 'e-2', at: 'now' })
  assertEquals((b.mail as Record<string, unknown>).subject, '(no subject)')
  assertEquals(b.deliver, undefined)
})
