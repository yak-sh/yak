// What the mail words DO when somebody types them: the marks reading and
// answering leave, the far side a reply is aimed at, and the check.

import { test } from '@yaks/testing'
import { assert, assertEquals, assertRejects } from '@std/assert'
import {
  type Actor,
  type Bundle,
  type Comp,
  type Graph,
  mint,
} from '@yaks/graph'
import { clubhouse } from './testing.ts'
import type { Options } from './options.ts'
import { reSubject, runs } from './tools.ts'

let call = mint()

let ask = (
  g: Graph,
  tool: string,
  args: Record<string, unknown> = {},
  actor: Actor | null = null,
  options: Options = {},
): Promise<Bundle[]> =>
  Promise.resolve(
    runs(undefined, { domain: 'books.example', ...options })[tool](
      {
        entity: { eid: call },
        call: { args },
        ...(actor ? { created: actor } : {}),
      },
      g,
    ),
  ) as Promise<Bundle[]>

// A tool asked, and its answer landed — what the runner does for a writing
// tool, said once so a test reads the graph afterwards.
let did = async (
  g: Graph,
  tool: string,
  args: Record<string, unknown> = {},
  actor: Actor | null = null,
): Promise<Bundle[]> => await g.apply(await ask(g, tool, args, actor))

let comp = (b: Bundle | undefined, name: string): Comp =>
  (b?.[name] ?? {}) as Comp

let prose = (answer: Bundle[]): string =>
  answer.map((b) => comp(b, 'content').body).filter(Boolean).join('\n')

// A club with an address book: Ana reads the club's mail at its own desk.
let club = async () => {
  let rig = clubhouse()
  await rig.g.apply([
    { entity: { eid: 'ana' }, person: { name: 'Ana' } },
    {
      entity: { eid: 'desk' },
      email: { address: 'hello@books.example' },
    },
  ])
  return rig
}

// One letter that arrived: a Message-ID is what makes it one.
let arrival = (eid: string, o: Record<string, unknown> = {}) => ({
  entity: { eid },
  doc: { title: 'Potluck Friday', body: 'Bring a dish.' },
  mail: {
    from: 'stranger@elsewhere.example',
    to: 'hello@books.example',
    at: '2026-09-01T10:00:00.000Z',
    message_id: `${eid}@elsewhere.example`,
    target: 'desk',
    ...o,
  },
})

test('reading a letter marks it, and shows its thread', async () => {
  let { g } = await club()
  await g.apply([
    arrival('a1'),
    {
      entity: { eid: 'a2' },
      doc: { title: 'Re: Potluck Friday' },
      mail: {
        from: 'hello@books.example',
        at: '2026-09-02T10:00:00.000Z',
        reply_to: 'a1',
      },
      deliver: { to: 'ana' },
    },
  ])
  let answer = await ask(g, 'mail_show', { letter: 'a1' })
  let said = prose(answer)
  assert(said.includes('# Potluck Friday'), said)
  assert(said.includes('from stranger@elsewhere.example'), said)
  assert(said.includes('Bring a dish.'), said)
  assert(said.includes('## Thread'), said)
  assert(said.includes('▶'), said)
  // The mark is a patch on the letter, not a note on the side.
  await g.apply(answer)
  let [letter] = await g.read('.mail.message_id=a1@elsewhere.example&*')
  assert(letter.opened, 'reading is the mark')
  await assertRejects(
    () => ask(g, 'mail_show', { letter: 'ana' }),
    Error,
    'not a letter',
  )
})

test('reading and answering mark the letter and the first of its thread, afresh each time', async () => {
  let { g } = await club()
  let stamp = (minute: number) => `2026-10-02T12:0${minute}:00.000Z`
  await g.apply([arrival('root'), arrival('reply', { reply_to: 'root' })])
  let marks = async (name: string) =>
    (await g.get(['root', 'reply'])).map((b) => comp(b, name).at)
  for (let minute of [1, 2]) {
    await g.apply(await ask(g, 'mail_show', { letter: 'reply' }), {
      now: stamp(minute),
    })
    assertEquals(await marks('opened'), [stamp(minute), stamp(minute)])
  }
  await g.apply(await ask(g, 'mail_reply', { letter: 'reply', body: 'Yes' }), {
    now: stamp(3),
  })
  assertEquals(await marks('archived'), [stamp(3), stamp(3)])
})

test('a reply to an arrival goes to its author, from the desk it came to', async () => {
  let { g, post } = await club()
  await g.apply([arrival('a1')])
  let landed = await did(g, 'mail_reply', {
    letter: 'a1',
    body: 'We will be there.',
  })
  let reply = landed.find((b) => comp(b, 'mail').reply_to == 'a1')!
  assertEquals(comp(reply, 'doc').title, 'Re: Potluck Friday')
  assertEquals(comp(reply, 'mail').from, 'hello@books.example')
  // The author had no row here, so the address book grew one.
  let [made] = await g.read('.email.address=stranger@elsewhere.example&*')
  assertEquals(comp(reply, 'deliver').to, made.entity.eid)
  // The configured sender carried it, threaded on what arrived.
  assertEquals(post.last()?.to, 'stranger@elsewhere.example')
  assertEquals(post.last()?.replyTo, 'a1@elsewhere.example')
  // Answering puts the arrival away, and the answer is not filed back to us.
  assertEquals(comp(reply, 'mail').target, undefined)
  assert(comp((await g.get(['a1']))[0], 'archived').at, 'answered is away')
})

test('a reply to your own letter goes to whom you wrote it', async () => {
  let { g } = await club()
  await g.apply([
    { entity: { eid: 'ana' }, email: { address: 'ana@books.example' } },
    {
      entity: { eid: 'a1' },
      doc: { title: 'You are in' },
      mail: { from: 'hello@books.example' },
      deliver: { to: 'ana' },
    },
  ])
  let landed = await did(g, 'mail_reply', { letter: 'a1', body: 'Thanks!' })
  let reply = landed.find((b) => comp(b, 'mail').reply_to == 'a1')!
  assertEquals(comp(reply, 'deliver').to, 'ana')
  assertEquals(comp(reply, 'mail').from, 'hello@books.example')
  // Nothing was put away: our own letter left nothing waiting.
  assertEquals(landed.find((b) => b.entity.eid == 'a1'), undefined)
})

test('a letter nobody can answer is refused rather than misdelivered', async () => {
  let { g } = await club()
  await g.apply([{
    entity: { eid: 'a1' },
    doc: { title: 'Orphan' },
    mail: { to: 'hello@books.example', message_id: 'm1' },
  }])
  // No `from` on an arrival: the near miss is our own desk, so this refuses.
  await assertRejects(
    () => ask(g, 'mail_reply', { letter: 'a1', body: 'hi' }),
    Error,
    'names nobody to answer',
  )
})

test('sending mints the address it is for, and goes', async () => {
  let { g, post } = await club()
  await did(g, 'mail_send', {
    to: 'Nina@Elsewhere.Example',
    subject: 'Thursday',
    body: 'We meet at seven.',
    from: 'hello@books.example',
    about: 'ana',
  }, { by: 'desk' })
  let [letter] = await g.read('.mail.target=ana&*')
  assertEquals(comp(letter, 'doc').title, 'Thursday')
  // Somebody else's namespace passes through untouched: only this graph's own
  // domain is canonicalized (./addr.ts).
  assertEquals(post.last()?.to, 'Nina@Elsewhere.Example')
  assertEquals(post.last()?.subject, 'Thursday')
})

test('who is asking supplies the from address, and its absence is loud', async () => {
  let { g, post } = await club()
  await did(g, 'mail_send', {
    to: 'nina@elsewhere.example',
    subject: 'Hello',
    body: 'Hi.',
  }, { by: 'desk' })
  assertEquals(post.last()?.from, 'hello@books.example')
  await assertRejects(
    () =>
      ask(g, 'mail_send', {
        to: 'nina@elsewhere.example',
        subject: 'Hello',
        body: 'Hi.',
      }, { by: 'ana' }),
    Error,
    'a letter needs a from address',
  )
})

test('a letter to somebody already in the book reuses their row', async () => {
  let { g } = await club()
  await did(g, 'mail_send', {
    to: 'hello@books.example',
    subject: 'Note to self',
    body: '.',
    from: 'hello@books.example',
  })
  let [letter] = await g.read('.deliver.to=desk&*')
  assertEquals(comp(letter, 'doc').title, 'Note to self')
})

test('Re: piles no higher than one', () => {
  assertEquals(reSubject('Potluck'), 'Re: Potluck')
  assertEquals(reSubject('Re: re: Fwd: Potluck'), 'Re: Potluck')
})

// ---- the check ----

let checkup = async (g: Graph, options: Options = {}) => {
  let [said] = await ask(g, 'mail_check', {}, null, options)
  return {
    body: String(comp(said, 'content').body),
    level: comp(said, 'finding').level,
    source: comp(said, 'output').source,
  }
}

let posted = async (mail: Record<string, unknown>) => {
  let { g } = clubhouse()
  await g.apply([{ entity: { eid: 'e1' }, mail, doc: { title: 'hello' } }])
  return g
}

test('a letter that arrived with a sender is nothing to report', async () => {
  let said = await checkup(
    await posted({ from: 'ana@books.example', message_id: '<a@x>' }),
  )
  assertEquals(said.level, undefined)
  assert(said.body.endsWith('— nothing to report'), said.body)
  assertEquals(said.source, call)
})

test('a letter that arrived with no sender is a fail', async () => {
  let said = await checkup(await posted({ message_id: '<a@x>' }))
  assertEquals(said.level, 'fail')
  assert(said.body.includes('arrived with no sender'), said.body)
})

test('a letter nobody received is not the check’s business', async () => {
  // No Message-ID: composed here, and ./send.ts is what refuses it a sender.
  let said = await checkup(await posted({ to: 'ana@books.example' }))
  assertEquals(said.level, undefined)
})

test('a sender this host cannot build is what the check says out loud', async () => {
  // Missing config never stops the boot (./effects.ts), so the check is where
  // a graph whose letters are going nowhere finds out.
  let said = await checkup(await posted({ to: 'ana@books.example' }), {
    sender: { via: 'cloudflare', account: 'a', token: undefined as never },
  })
  assertEquals(said.level, 'warn')
  assert(said.body.includes('waiting for credentials'), said.body)
  // one that can be built is nothing to report
  let fine = await checkup(await posted({ to: 'ana@books.example' }), {
    sender: { via: 'stash' },
  })
  assertEquals(fine.level, undefined)
})
