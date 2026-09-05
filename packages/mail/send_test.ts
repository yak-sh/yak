import { assert, assertEquals } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { clubhouse } from './harness.ts'
import { message } from './send.ts'

let ana = 'p-ana'
let letter = 'e-potluck'

// A club with one member who has an address on file.
let seeded = async (refuse?: string) => {
  let club = clubhouse(refuse)
  await club.g.apply([{
    entity: { eid: ana },
    person: { name: 'Ana' },
    email: { address: 'ana@books.example' },
  }])
  return club
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let read = async (g: { read: (q: string) => unknown }, eid: string) =>
  ((await g.read(`.eid=${eid}`)) as Bundle[])[0]

Deno.test('a letter that asks to go, goes — and says so', async () => {
  let { g, post } = await seeded()
  await g.apply([{
    entity: { eid: letter },
    mail: {
      from: 'hello@books.example',
      subject: 'Potluck Friday',
      body: 'Bring a dish. [Sign up](https://books.example/p)',
    },
    deliver: { to: ana },
  }])
  assertEquals(post.sent.length, 1)
  assertEquals(post.last()?.to, 'ana@books.example')
  assertEquals(post.last()?.subject, 'Potluck Friday')
  assertEquals(
    post.last()?.text,
    'Bring a dish. Sign up (https://books.example/p)',
  )
  assert(post.last()?.html.includes('<a href="https://books.example/p">'))
  let sent = await read(g, letter)
  assertEquals(comp(sent, 'delivered'), {
    at: '2026-09-05T12:00:00.000Z',
    via: 'stash-1',
  })
  // the envelope, denormalized onto the letter
  assertEquals(comp(sent, 'mail')?.to, 'ana@books.example')
  assertEquals(comp(sent, 'bounced'), undefined)
})

Deno.test('a letter with no ask is kept, not sent', async () => {
  let { g, post } = await seeded()
  await g.apply([{
    entity: { eid: letter },
    mail: { from: 'hello@books.example', subject: 'A draft', body: 'later' },
  }])
  assertEquals(post.sent.length, 0)
  assertEquals(comp(await read(g, letter), 'delivered'), undefined)
})

Deno.test('a recipient with no address bounces, and says whose fault it is', async () => {
  let { g, post } = await seeded()
  await g.apply([{ entity: { eid: 'p-bo' }, person: { name: 'Bo' } }])
  await g.apply([{
    entity: { eid: letter },
    mail: { from: 'hello@books.example', subject: 'hi', body: 'hi' },
    deliver: { to: 'p-bo' },
  }])
  assertEquals(post.sent.length, 0)
  assertEquals(comp(await read(g, letter), 'bounced'), {
    at: '2026-09-05T12:00:00.000Z',
    reason: 'no address on file for p-bo',
  })
})

Deno.test('a letter with no sender bounces before the transport is troubled', async () => {
  let { g, post } = await seeded()
  await g.apply([{
    entity: { eid: letter },
    mail: { subject: 'hi', body: 'hi' },
    deliver: { to: ana },
  }])
  assertEquals(post.sent.length, 0)
  assertEquals(
    comp(await read(g, letter), 'bounced')?.reason,
    'the letter has no from address',
  )
})

Deno.test('a transport that refuses writes the reason it gave', async () => {
  let { g } = await seeded('no route to host')
  await g.apply([{
    entity: { eid: letter },
    mail: { from: 'hello@books.example', subject: 'hi', body: 'hi' },
    deliver: { to: ana },
  }])
  assertEquals(
    comp(await read(g, letter), 'bounced')?.reason,
    'no route to host',
  )
})

Deno.test('a reply threads on what the answered letter went out as', async () => {
  let { g, post } = await seeded()
  await g.apply([{
    entity: { eid: letter },
    mail: { from: 'hello@books.example', subject: 'hi', body: 'hi' },
    deliver: { to: ana },
  }])
  await g.apply([{
    entity: { eid: 'e-reply' },
    mail: {
      from: 'hello@books.example',
      subject: 'Re: hi',
      body: 'again',
      reply_to: letter,
    },
    deliver: { to: ana },
  }])
  assertEquals(post.last()?.replyTo, 'stash-1')
})

Deno.test('the address is canonical however it was written', async () => {
  let { g } = await seeded()
  await g.apply([{
    entity: { eid: 'p-cy' },
    person: { name: 'Cy' },
    email: { address: 'Cy_Rus@Books.Example' },
  }])
  assertEquals(
    comp(await read(g, 'p-cy'), 'email')?.address,
    'cyrus@books.example',
  )
})

Deno.test('message: the composition, without a transport anywhere', () => {
  assertEquals(
    message(
      { from: 'a@x.example', subject: 'S', body: '**b**' },
      'b@y.example',
    ),
    {
      from: 'a@x.example',
      to: 'b@y.example',
      subject: 'S',
      text: 'b',
      html: '<p><strong>b</strong></p>',
    },
  )
})
