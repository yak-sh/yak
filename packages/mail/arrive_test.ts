import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp, Eid } from '@yaks/graph'
import { arrived, type Book, known, named, routed, wearer } from './arrive.ts'
import type { Received } from './inbound.ts'
import { clubhouse } from './harness.ts'

let ana = 'p-ana'
let pile = 'p-triage'
let domain = 'books.example'

// The club, with one member in the address book and one letter already filed.
let seeded = async () => {
  let club = clubhouse()
  await club.g.apply([
    {
      entity: { eid: ana },
      person: { name: 'Ana' },
      email: { address: 'ana@books.example' },
    },
    { entity: { eid: pile }, space: { name: 'Triage' } },
    {
      entity: { eid: 'e-first' },
      doc: { title: 'Is there soup?', body: 'asking' },
      mail: { from: 'ana@books.example', message_id: 'a1@x.example' },
    },
  ])
  return club
}

// A message as an edge hands one over: headers by name, everything else read
// out of them.
let got = (
  headers: Record<string, string>,
  to = 'club@books.example',
  from = 'bounces@relay.example',
): Received => ({
  from,
  to,
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
})

let comp = (b: Bundle | undefined, name: string) => b?.[name] as Comp

// The graph with an id door that answers — what @yaks/id contributes to a host
// that composes it, said here so this package's tests need no dependency on it.
let knowing = (graph: Book, ids: Record<string, Eid>): Book => ({
  ...graph,
  address: (asked: string[]) =>
    new Map(asked.flatMap((id) => ids[id] ? [[id, ids[id]] as const] : [])),
})

Deno.test('wearer: the address book, read backwards', async () => {
  let { g } = await seeded()
  assertEquals(await wearer(g, 'ana@books.example'), ana)
  // Canonical at your own domain, so a spelling Cloudflare would bounce still
  // finds its owner; a stranger is nobody at all.
  assertEquals(await wearer(g, 'A_na@Books.Example', domain), ana)
  assertEquals(await wearer(g, 'bo@elsewhere.com', domain), null)
})

Deno.test('known: the letter a Message-ID names', async () => {
  let { g } = await seeded()
  assertEquals(await known(g, 'a1@x.example'), 'e-first')
  assertEquals(await known(g, 'nobody@x.example'), null)
  // No id is not an id nobody has: it must never match the letters carrying none.
  assertEquals(await known(g, ''), null)
})

Deno.test('named: the id grammar is the address grammar', async () => {
  let { g } = await seeded()
  let book = knowing(g, { 'S-31': 'sess-31' })
  assertEquals(await named(book, 'S-31@books.example', domain), 'sess-31')
  // Somebody else's domain is somebody else's namespace.
  assertEquals(await named(book, 'S-31@elsewhere.com', domain), null)
  assertEquals(await named(book, 'S-99@books.example', domain), null)
})

Deno.test('routed: the book wins, the id grammar catches the rest', async () => {
  let { g } = await seeded()
  let book = knowing(g, { 'S-31': 'sess-31' })
  assertEquals(await routed(book, 'ana@books.example', domain), ana)
  assertEquals(await routed(book, 'S-31@books.example', domain), 'sess-31')
  assertEquals(await routed(book, 'club@books.example', domain), null)
})

Deno.test('arrived: a letter, with both lookups answered', async () => {
  let { g } = await seeded()
  let receive = arrived({ graph: g, domain, triage: pile })
  let batch = await receive(
    got({
      from: 'Ana <ana@books.example>',
      subject: 'Re: Is there soup?',
      'message-id': '<a2@x.example>',
      'in-reply-to': '<a1@x.example>',
      date: '2026-09-05T12:00:00.000Z',
      'authentication-results': 'mx.example; dkim=pass',
    }, 'ana@books.example'),
    { text: 'there is soup' },
  )
  assertEquals(batch.length, 1)
  let mail = comp(batch[0], 'mail')
  assertEquals(mail.target, ana)
  assertEquals(mail.reply_to, 'e-first')
  assertEquals(mail.verified, true)
  assertEquals(mail.from, 'ana@books.example')
  assertEquals(comp(batch[0], 'doc').body, 'there is soup')
  // Signed by the author the book knows, never by whoever runs the box.
  assertEquals(batch[0].$actor, { by: ana })
})

Deno.test('arrived: a stranger writes unattributed, to the triage pile', async () => {
  let { g } = await seeded()
  let receive = arrived({ graph: g, domain, triage: pile })
  let batch = await receive(got({ from: 'bo@elsewhere.com', subject: 'hello' }))
  assertEquals(comp(batch[0], 'mail').target, pile)
  assertEquals(batch[0].$actor, undefined)
  // Nobody checked is not a check that failed.
  assertEquals(comp(batch[0], 'mail').verified, undefined)
})

Deno.test('arrived: the same Message-ID lands once', async () => {
  let { g } = await seeded()
  let receive = arrived({ graph: g, domain })
  let m = got({ subject: 'Is there soup?', 'message-id': '<a1@x.example>' })
  assertEquals(await receive(m), [])
  // And a letter with no Message-ID at all is still a letter.
  assert((await receive(got({ subject: 'no id' }))).length == 1)
})

Deno.test('arrived: what it records is what an arrival is — no ask to send', async () => {
  let { g } = await seeded()
  let batch = await arrived({ graph: g, domain })(
    got({ from: 'ana@books.example', subject: 'hi' }, 'ana@books.example'),
  )
  await g.apply(batch)
  let letter = ((await g.read('.mail.message_id=')) as Bundle[])
    .find((b) => comp(b, 'doc')?.title == 'hi')
  assert(letter)
  assertEquals(letter.deliver, undefined)
  assertEquals(letter.delivered, undefined)
  assertEquals(letter.bounced, undefined)
})
