import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Bundle, Comp } from '@yaks/graph'
import { effects } from '@yaks/effects'
import { club, clubhouse, committed, noon } from './testing.ts'
import { message } from './send.ts'
import { DELIVER, MAIL } from './comp.ts'
import { type Mailbox, mailbox } from './plugin.ts'
import { arrived } from './arrive.ts'
import { stash } from './stash.ts'
import { Unsent } from '@yaks/host/senders'

let ana = 'p-ana'
let letter = 'e-potluck'

// A club with one member who has an address on file.
let seeded = async (refuse?: string) => {
  let rig = clubhouse({ refuse })
  await rig.g.apply([{
    entity: { eid: ana },
    person: { name: 'Ana' },
    email: { address: 'ana@books.example' },
  }])
  return rig
}

let comp = (b: Bundle | undefined, name: string) =>
  b?.[name] as Comp | undefined

let read = async (g: { read: (q: string) => unknown }, eid: string) =>
  ((await g.read(`.entity.eid=${eid}`)) as Bundle[])[0]

// The club's people and a letter, asking to go as `ask` says, at the sending
// handler's boundary: the rows committed, and the handler the mail plugin
// gives the club's registry, rigged with `rig`. Each `go()` is one try at the
// letter, as the pool makes them.
let posting = (
  rig: Omit<Mailbox, 'effects'>,
  ask: Record<string, Comp> = { [DELIVER]: { to: ana } },
) => {
  let { tx, write } = committed([{
    entity: { eid: ana },
    email: { address: 'ana@books.example' },
  }, {
    entity: { eid: 'p-bo' },
    email: { address: 'bo@elsewhere.com' },
  }, {
    entity: { eid: letter },
    doc: { title: 'hi', body: 'hi' },
    mail: { from: 'hello@books.example' },
    ...ask,
  }])
  let fx = effects(club)
  mailbox({ now: noon, ...rig, effects: fx })
  let run = fx.slots().find((s) => s.id == 'mail_post')!.run!
  let event = { kind: 'created' as const, entity: { eid: letter }, name: MAIL }
  return {
    go: async () => void await run(event, tx, write),
    row: async () => (await tx.get([letter]))[0],
  }
}

// A settled letter, prepared once for readers of its envelope and outcome.
let sentClub = await seeded()
await sentClub.g.apply([{
  entity: { eid: letter },
  doc: {
    title: 'Potluck Friday',
    body: 'Bring a dish. [Sign up](https://books.example/p)',
  },
  mail: { from: 'hello@books.example' },
  deliver: { to: ana },
}])
test('a letter that asks to go, goes — and says so', async () => {
  let { g, post } = sentClub
  assertEquals(post.sent.length, 1)
  assertEquals(post.last()?.to, 'ana@books.example')
  assertEquals(post.last()?.subject, 'Potluck Friday')
  assertEquals(
    post.last()?.text,
    'Bring a dish. Sign up (https://books.example/p)',
  )
  assert(post.last()?.html.includes('<a href="https://books.example/p">'))
  let sent = await read(g, letter)
  assertEquals(comp(sent, 'delivered'), { at: '2026-09-05T12:00:00.000Z' })
  // the envelope, denormalized onto the letter, with the Message-ID it left
  // with: what a reply to it threads on
  assertEquals(comp(sent, 'mail')?.to, 'ana@books.example')
  assertEquals(comp(sent, 'mail')?.message_id, 'stash-1')
  assertEquals(comp(sent, 'bounced'), undefined)
})

test('a letter with no ask is kept, not sent', async () => {
  let post = stash()
  let { go, row } = posting({ sender: post }, {})
  await go()
  assertEquals(post.sent.length, 0)
  assertEquals(comp(await row(), 'delivered'), undefined)
})

let unaddressedClub = await seeded()
await unaddressedClub.g.apply([{
  entity: { eid: 'p-bo' },
  person: { name: 'Bo' },
}])
await unaddressedClub.g.apply([{
  entity: { eid: letter },
  doc: { title: 'hi', body: 'hi' },
  mail: { from: 'hello@books.example' },
  deliver: { to: 'p-bo' },
}])
test('a recipient with no address bounces, and says whose fault it is', async () => {
  let { g, post } = unaddressedClub
  assertEquals(post.sent.length, 0)
  assertEquals(comp(await read(g, letter), 'bounced'), {
    at: '2026-09-05T12:00:00.000Z',
    reason: 'no address on file for p-bo',
  })
})

test('a letter with no sender bounces before the transport is troubled', async () => {
  let { g, post } = await seeded()
  await g.apply([{
    entity: { eid: letter },
    doc: { title: 'hi', body: 'hi' },
    mail: {},
    deliver: { to: ana },
  }])
  assertEquals(post.sent.length, 0)
  assertEquals(
    comp(await read(g, letter), 'bounced')?.reason,
    'the letter has no from address',
  )
})

let refusedClub = await seeded('no route to host')
await refusedClub.g.apply([{
  entity: { eid: letter },
  doc: { title: 'hi', body: 'hi' },
  mail: { from: 'hello@books.example' },
  deliver: { to: ana },
}])
test('a transport that refuses writes the reason it gave', async () => {
  let { g } = refusedClub
  assertEquals(
    comp(await read(g, letter), 'bounced')?.reason,
    'no route to host',
  )
})

// A letter whose transport drops the first `drops` sends before they leave: a
// try that never left fails, so the pool hands the letter over again.
let dropping = (drops: number) => {
  let post = stash()
  return {
    post,
    ...posting({
      sender: {
        send: (m) =>
          drops-- > 0
            ? Promise.reject(new Unsent('not sent: tls handshake eof', 0))
            : post.send(m),
      },
    }),
  }
}

test('a letter that never left goes on the next try, not bounced', async () => {
  let { post, go, row } = dropping(1)
  await assertRejects(go, Unsent)
  await go()
  let sent = await row()
  assertEquals(post.sent.length, 1)
  assertEquals(comp(sent, 'delivered')?.at, '2026-09-05T12:00:00.000Z')
  assertEquals(comp(sent, 'bounced'), undefined)
  assertEquals(comp(sent, 'deliver')?.waiting ?? null, null)
})

test('a letter that never leaves waits, owed, for retry', async () => {
  let { post, go, row } = dropping(Infinity)
  await assertRejects(go, Unsent)
  let kept = await row()
  assertEquals(post.sent.length, 0)
  assertEquals(comp(kept, 'bounced'), undefined)
  assertEquals(comp(kept, 'deliver')?.tried ?? null, null)
  assertEquals(comp(kept, 'deliver')?.waiting, 'not sent: tls handshake eof')
})

test('a reply threads on what the answered letter went out as', async () => {
  let { g, post } = await seeded()
  await g.apply([{
    entity: { eid: letter },
    doc: { title: 'hi', body: 'hi' },
    mail: { from: 'hello@books.example' },
    deliver: { to: ana },
  }])
  await g.apply([{
    entity: { eid: 'e-reply' },
    doc: { title: 'Re: hi', body: 'again' },
    mail: { from: 'hello@books.example', reply_to: letter },
    deliver: { to: ana },
  }])
  assertEquals(post.last()?.replyTo, 'stash-1')
})

let threadedClub = await seeded()
await threadedClub.g.apply([{
  entity: { eid: letter },
  doc: { title: 'hi', body: 'hi' },
  mail: { from: 'hello@books.example' },
  deliver: { to: ana },
}])
test('an answer to a letter we sent threads onto it', async () => {
  let { g } = threadedClub
  let head: Record<string, string> = {
    'message-id': '<a2@x.example>',
    'in-reply-to': '<stash-1>',
  }
  let [answer] = await arrived({ graph: g })({
    from: 'ana@books.example',
    to: 'hello@books.example',
    headers: { get: (n) => head[n.toLowerCase()] ?? null },
  })
  assertEquals(comp(answer, 'mail')?.reply_to, letter)
})

// What the mail plugin makes of a batch before the graph takes it.
test('the address is canonical however it was written', async () => {
  let { normalize } = mailbox({ domain: 'books.example' }).hooks!
  let [cy] = await normalize!([{
    entity: { eid: 'p-cy' },
    person: { name: 'Cy' },
    email: { address: 'Cy_Rus@Books.Example' },
  }], committed([]).tx)
  assertEquals(comp(cy, 'email')?.address, 'cyrus@books.example')
})

test('message: the composition, without a transport anywhere', () => {
  assertEquals(
    message(
      {
        entity: { eid: 'e-1' },
        doc: { title: 'S', body: '**b**' },
        mail: { from: 'a@x.example' },
      },
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

// Local delivery: the domain is the graph's own namespace, so a letter to it
// has arrived by being written.
let inhouse = async (to: string) => {
  let post = stash()
  let { go, row } = posting({ sender: post, local: 'books.example' }, {
    [DELIVER]: { to },
  })
  await go()
  return { post, sent: await row() }
}

test('a letter to an address the graph owns never reaches the transport', async () => {
  let { post, sent } = await inhouse(ana)
  assertEquals(post.sent.length, 0)
  assertEquals(comp(sent, 'delivered'), { at: noon() })
  // The envelope is still denormalized: where it went is data, not a lookup.
  assertEquals(comp(sent, 'mail')?.to, 'ana@books.example')
})

test('a letter out of the house still rides the transport', async () => {
  let { post, sent } = await inhouse('p-bo')
  assertEquals(post.last()?.to, 'bo@elsewhere.com')
  assertEquals(comp(sent, 'mail')?.message_id, 'stash-1')
})
