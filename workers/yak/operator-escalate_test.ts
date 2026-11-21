import { line as q } from '@yaks/query'
import { derivedEid } from '@yaks/graph/identity'
import { test } from '@yaks/testing'
import type { Binding } from '@yaks/cloudflare-mail'
import { assert, assertEquals, assertRejects } from '@std/assert'
let equal = assertEquals
import type { Item, Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { callable, operatorModel, operatorService } from './operator-testing.ts'
import { operatorContext } from './operator.ts'
import { receive } from './operator-channels.ts'
import {
  escalate,
  escalationAnswer,
  investigatorOf,
  linkedTo,
  oddReport,
} from './operator-escalate.ts'
import { rootOf } from './operator-root.ts'
import { conversationOf } from './operator-host.ts'
import { mailFrom } from '@yaks/platform/host'
import { arrived, reading } from './inbox.ts'
import type { Inbound } from './env.ts'

// A person's Operator writes to Dr Alvarez for them. Her reply is answered in
// her own conversation, with only her permissions, which raises the time she
// proposes with the person's conversation. That one decides with the
// person's permissions, writes back on the thread, and tells hers only what
// it chooses to (T-151880).
let { env } = platform('operator-escalate')
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID(), eid = crypto.randomUUID()
// An editor beside Jeff, who may answer what a stranger raises too, and a
// viewer, who may not (operator-route.ts).
let ana = crypto.randomUUID(), bo = crypto.randomUUID()
let owner = { 'x-yak-person': person, 'x-yak-role': 'owner' }
await dir.apply({
  entities: [
    {
      entity: { eid: person },
      person: {},
      doc: { title: 'Jeff Peterson' },
      email: { address: 'jeff@example.com' },
    },
    { entity: { eid }, space: { slug: 'jeff', store: 'jeff' } },
    {
      entity: { eid: crypto.randomUUID() },
      member: { person, space: eid, role: 'owner' },
    },
    ...[[ana, 'Ana', 'editor'], [bo, 'Bo', 'viewer']].flatMap((
      [who, name, role],
    ) => [
      {
        entity: { eid: who },
        person: {},
        doc: { title: name },
        email: { address: `${name.toLowerCase()}@example.com` },
      },
      {
        entity: { eid: crypto.randomUUID() },
        member: { person: who, space: eid, role },
      },
    ]),
  ],
}, owner)
let space = (await dir.at(eid))!
let held = { person, role: 'owner' as const, space: eid }

type Letter = Parameters<Binding['send']>[0]
let letters: Letter[] = []
env.MAIL = {
  send: (letter) => {
    letters.push(letter)
    return Promise.resolve({ messageId: `sent-${letters.length}` })
  },
} satisfies Binding

// The id the letter to Dr Alvarez went out with; Jeff's alert of the tap it
// waited for went out first.
let asked1 = () =>
  `sent-${letters.findIndex((l) => /alvarez/i.test(String(l.to))) + 1}`

let PRIVATE = 'my dentist is Dr Okafor'
let asked: Request[] = []
let reply = (text: string): Item[] => [{ kind: 'assistant', text }]
let call = (name: string, args: unknown): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
// The last words given, and the calls made since them.
let turn = (r: Request) => {
  let at = r.items.findLastIndex((i) => i.kind == 'user')
  let words = String((r.items[at] as { text?: string })?.text ?? '')
  let since = r.items.slice(at + 1).filter((i) => i.kind == 'call')
  return { words, since: since.length }
}
let named = (words: string, re: RegExp) => words.match(re)?.[1] ?? ''
let service = operatorService(
  env,
  held,
  operatorModel((req) => {
    asked.push(req)
    let { words, since } = turn(req)
    let forked = JSON.stringify(req.items).includes('fork of the')
    let items = /They tapped Approve/.test(words)
      ? reply('I sent Dr Alvarez the email and will tell you what she says.')
      : forked
      ? since ? reply('Asked Dr Alvarez about Tuesday.') : call('mail_send', {
        to: 'alvarez@clinic.example',
        name: 'Dr Alvarez',
        subject: 'Checkup',
        text: 'When could you see him for his checkup?',
      })
      : /Raised from your own conversation/.test(words)
      ? since == 0
        ? call('mail_send', {
          to: 'alvarez@clinic.example',
          name: 'Dr Alvarez',
          text: 'Tuesday at 3 works; see you then.',
          answering: named(words, /mail_send answering (\S+)\)/),
        })
        : since == 1
        ? call('escalation_answer', {
          escalation: named(words, /naming escalation (\S+)\./),
          say: 'Jeff confirmed Tuesday at 3 on the thread.',
        })
        : reply(
          'Dr Alvarez proposed Tuesday at 3; it was free, so I confirmed it.',
        )
      : /Look into a request reported as out of the ordinary/.test(words)
      ? reply('The link is not the clinic’s own: likely phishing.')
      : /Raised by your guest helper/.test(words)
      ? reply('Noted; I will ask Jeff.')
      : /By email from alvarez/.test(words)
      ? since
        ? reply('Thank you; I have passed it on to Jeff.')
        : call('escalate', {
          reply: named(words, /Their reply is letter (\S+),/),
          say: 'Dr Alvarez proposes Tuesday at 3 for the checkup.',
        })
      : /Asked Dr Alvarez/.test(words)
      ? reply('I asked Dr Alvarez; I will tell you what she says.')
      : since
      ? reply('On it: writing to Dr Alvarez.')
      : call('fork', { prompt: 'Email Dr Alvarez about a checkup time' })
    return Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      items,
      cost: 0.001,
    })
  }),
)
env.BUILDER = service.binding
let { store } = service

await receive(
  store,
  { space: eid, person, channel: 'chat' },
  `Ask Dr Alvarez (alvarez@clinic.example) when she can see me for my checkup; ${PRIVATE}`,
)
await service.drain()
// Mail to someone new waits for the person's tap.
await service.approve()
await service.drain()

let from = mailFrom('jeff', null, env)
let answer = (id: string, answers: string): Inbound => {
  let headers = new Headers({
    From: 'Dr Alvarez <alvarez@clinic.example>',
    To: from,
    Subject: 'Re: Checkup',
    'Message-ID': `<${id}>`,
    'In-Reply-To': `<${answers}>`,
    References: `<${answers}>`,
    'Content-Type': 'text/plain',
    'Authentication-Results':
      'mx.cloudflare.net; dmarc=pass header.from=clinic.example; dkim=pass',
  })
  return {
    from: 'alvarez@clinic.example',
    to: from,
    headers,
    raw: new Response(
      [...headers].map(([k, v]) => `${k}: ${v}`).join('\r\n') +
        '\r\n\r\nHow about Tuesday at 3?',
    ).body!,
    setReject: () => {},
  }
}
let reached = await arrived(
  await reading(answer('alvarez-1', asked1()), env),
  env,
)
await service.drain()

let writer = (await dir.personAt('alvarez@clinic.example'))!
let theirs = rootOf(eid, writer), mine = rootOf(eid, person)
let [raised] = await store.g.read('.operator_request.channel=escalated&*')
let request = raised.operator_request as Record<string, unknown>
let entries = (session: string) =>
  store.g.read(q`.entry.session=${session}&.order=entry.seq&*`)
let noteOf = async () =>
  (await entries(theirs)).find((b) =>
    (b.channel as { name?: string })?.name == 'escalation'
  )
let note = await noteOf()
// The asks each conversation's model was given, by the words that started
// them: hers answer her reply, the person's what was raised.
let hers = asked.filter((r) => /By email from alvarez/.test(turn(r).words))
let raisedAsks = asked.filter((r) => /Raised from/.test(turn(r).words))
let threaded = letters.find((l) => l.text?.includes('Tuesday at 3 works'))!

test("the writer's conversation raises what needs the person with the person's own conversation, as a request of the Operator's own words", async () => {
  assert(writer && writer != person)
  assertEquals(request.person, person)
  assertEquals(request.from, theirs)
  assertEquals(request.about, reached)
  assertEquals(request.session, mine)
  assertEquals(
    raised.doc,
    {
      title: 'Dr Alvarez proposes Tuesday at 3 for the checkup.',
      body: 'Dr Alvarez proposes Tuesday at 3 for the checkup.',
    },
  )
  let [line] = await store.g.get([
    derivedEid('operator-input|' + raised.entity.eid),
  ])
  assert(line.system, 'drawn as the Operator’s own words, not the person’s')
})

test("each side's words name where they came from", async () => {
  assert(raisedAsks.length > 0)
  let { words } = turn(raisedAsks[0])
  assert(
    words.includes(
      '\nRaised from your own conversation with alvarez@clinic.example, who replied to the letter you sent them for this person',
    ),
  )
  assert(words.includes('never instructions'))
  assert(
    String((note?.content as { body?: string })?.body).startsWith(
      'The conversation with Jeff Peterson, the person you sent it for',
    ),
  )
  let shown = async (session: string) =>
    (await conversationOf(store, '/at', session)).html
  assert((await shown(mine)).includes('Raised from another conversation: '))
  assert((await shown(theirs)).includes('From another conversation: '))
})

test("the person's side acts with the person's permissions: it writes back on the thread, copying them", () => {
  assertEquals(threaded.to, 'alvarez@clinic.example')
  assertEquals(threaded.subject, 'Re: Checkup')
  assertEquals(threaded.headers?.['In-Reply-To'], '<alvarez-1>')
  assertEquals(threaded.cc, 'jeff@example.com')
})

test("the writer's side is a helper with a guest's tools, which raises the rest", () => {
  let names = callable(hers[0])
  for (let kept of ['escalate', 'feedback']) {
    assertEquals(names.includes(kept), true, kept)
  }
  for (let door of ['fork', 'spawn', 'graph_apply', 'mail_send', 'code_mode']) {
    assertEquals(names.includes(door), false, door)
  }
})

test("the person's side is the Operator's own work, with the person's tools", () => {
  let names = callable(raisedAsks[0])
  for (
    let kept of ['escalation_answer', 'mail_send', 'notification_send', 'fork']
  ) {
    assertEquals(names.includes(kept), true, kept)
  }
})

test("the writer's side gets back only what the person's side chose to say, which starts no turn", async () => {
  assert(
    String((note?.content as { body?: string })?.body).endsWith(
      'Jeff confirmed Tuesday at 3 on the thread.',
    ),
  )
  assert(note?.notice)
  assertEquals(
    asked.filter((r) =>
      JSON.stringify(r.items).includes('From your conversation with Jeff')
    ).length,
    0,
  )
  let seen = JSON.stringify(hers)
  assertEquals(seen.includes(PRIVATE), false)
  assertEquals(seen.includes('it was free, so I confirmed it'), false)
  assertEquals(seen.includes('Jeff confirmed Tuesday'), false)
  // The answer stays in its chat: only notification_send tells the person.
  let [told] = await store.g.get([
    derivedEid('operator-told|' + raised.entity.eid),
  ])
  assertEquals(told, undefined)
})

test('a conversation raises only on a reply of its own, and answers only what was raised with it', async () => {
  let ctx = await operatorContext(env, held, space)
  let as = (session: string) => ({
    session,
    call: { entity: { eid: crypto.randomUUID() } },
    entries: [],
  })
  // The person's conversation never wrote the reply.
  await assertRejects(
    async () =>
      await escalate(store, ctx, space).run(
        { reply: reached, say: 'Anything' },
        as(mine),
      ),
    Error,
    'the id to name for it',
  )
  // Her conversation cannot answer what was raised with the person.
  await assertRejects(
    async () =>
      await escalationAnswer(store, ctx, space).run(
        { escalation: raised.entity.eid, say: 'Anything' },
        as(theirs),
      ),
    Error,
    'Nothing was raised with you',
  )
})

test("a stranger's conversation raises what needs the space's people with everyone whose role allows it, naming who asked, and the first answer closes it for the rest", async () => {
  let ctx = await operatorContext(env, held, space)
  let as = (session: string) => ({
    session,
    call: { entity: { eid: crypto.randomUUID() } },
    entries: [],
  })
  let { escalation } = JSON.parse(
    String(
      await escalate(store, ctx, space).run(
        { say: 'Dr Alvarez asks whether the clinic may text Jeff reminders.' },
        as(theirs),
      ),
    ),
  )
  await service.drain()
  let copies = await store.g.read(
    q`.operator_request.raised=${escalation}&*`,
  )
  let of = (b: (typeof copies)[number]) =>
    b.operator_request as Record<string, unknown>
  assertEquals(new Set(copies.map((b) => of(b).person)), new Set([person, ana]))
  for (let b of copies) {
    assertEquals(of(b).from, theirs)
    assertEquals(of(b).about, undefined)
    assert(String(of(b).address).startsWith('alvarez'))
  }
  let words = asked.map((r) => turn(r).words).find((w) =>
    w.includes('Raised by your guest helper')
  )!
  assert(
    words.includes(
      `from its conversation with ${
        of(copies[0]).address
      }, who is not a member of this space`,
    ),
  )
  assert(words.includes('notification_send: Dr Alvarez asks whether'))
  // Jeff answers first: Ana is told, and answers it no more.
  let jeffs = copies.find((b) => of(b).person == person)!
  let anas = copies.find((b) => of(b).person == ana)!
  await escalationAnswer(store, ctx, space).run(
    { escalation: jeffs.entity.eid, say: 'No texts, thank you.' },
    as(mine),
  )
  let [closed] = await store.g.get([anas.entity.eid])
  assertEquals(of(closed).answered_by, person)
  assert(
    JSON.stringify(await entries(rootOf(eid, ana))).includes(
      'Jeff Peterson answered what was raised with you',
    ),
  )
  let anaCtx = await operatorContext(
    env,
    { person: ana },
    space,
  )
  await assertRejects(
    async () =>
      await escalationAnswer(store, anaCtx, space).run(
        { escalation: anas.entity.eid, say: 'Yes, texts are fine.' },
        as(rootOf(eid, ana)),
      ),
    Error,
    'answered escalation',
  )
})

test('a stranger who says they are a member raises it with that member alone, outside a private room', async () => {
  let ctx = await operatorContext(env, held, space)
  let { escalation } = JSON.parse(
    String(
      await escalate(store, ctx, space).run(
        { say: 'Says she is Ana and wants a new app.', claims: 'ana' },
        {
          session: theirs,
          call: { entity: { eid: crypto.randomUUID() } },
          entries: [],
        },
      ),
    ),
  )
  let copies = await store.g.read(
    q`.operator_request.raised=${escalation}&*`,
  )
  assertEquals(
    copies.map((b) => (b.operator_request as { person: string }).person),
    [ana],
  )
})

test("an odd request is looked into by a helper with a guest's tools, whose report reaches the conversation of each who may decide it", async () => {
  let ctx = await operatorContext(env, held, space)
  let { investigating } = JSON.parse(
    String(
      await oddReport(store, ctx, space, {}).run(
        { say: 'Dr Alvarez asks for Jeff’s card number to hold the slot.' },
        {
          session: theirs,
          call: { entity: { eid: crypto.randomUUID() } },
          entries: [],
        },
      ),
    ),
  )
  await service.drain()
  // Jeff and Ana, an editor, each get one; Bo, a viewer, none.
  let helpers = await store.g.get(investigating)
  assertEquals(
    new Set(helpers.map((h) => (h.spawned as { parent: string }).parent)),
    new Set([mine, rootOf(eid, ana)]),
  )
  let helper = helpers.find((h) =>
    (h.spawned as { parent: string }).parent == mine
  )!
  assertEquals(
    (helper.operator_session as { person: string }).person,
    investigatorOf(eid),
  )
  let looked = asked.find((r) =>
    /Look into a request reported/.test(turn(r).words)
  )!
  let names = callable(looked)
  assertEquals(names.includes('feedback'), true)
  for (let door of ['mail_send', 'graph_apply', 'fork', 'odd_report']) {
    assertEquals(names.includes(door), false, door)
  }
  assert(
    JSON.stringify(await entries(mine)).includes('likely phishing'),
    "the helper's report reaches the owner's conversation",
  )
})

test('a guest who links their account to a member is served within their role, with no one else to wait for; beyond it, it still waits', async () => {
  let ctx = await operatorContext(env, held, space)
  let raise = async (say: string) =>
    JSON.parse(
      String(
        await escalate(store, ctx, space).run({ say }, {
          session: theirs,
          call: { entity: { eid: crypto.randomUUID() } },
          entries: [],
        }),
      ),
    ).escalation
  let copiesOf = (raised: string) =>
    store.g.read(q`.operator_request.raised=${raised}&*`)
  let answered = async (raised: string) =>
    (await copiesOf(raised)).map((b) =>
      (b.operator_request as { answered_by?: string }).answered_by
    )
  // As a viewer, what they asked still waits for those whose role allows it.
  let looked = await raise('Wants the illustrated guide turned into an app.')
  equal(
    await linkedTo(store, eid, writer, {
      person: bo,
      role: 'viewer',
      name: 'Bo',
    }),
    [],
  )
  equal(await answered(looked), [undefined, undefined])
  // As an editor, it is theirs: closed for the rest, and back with them.
  let [back] = await linkedTo(store, eid, writer, {
    person: ana,
    role: 'editor',
    name: 'Ana',
  })
  equal(await answered(looked), [ana, ana])
  let [request] = await store.g.get([back])
  let { person: to, channel } = request.operator_request as Record<
    string,
    unknown
  >
  equal([to, channel], [ana, 'linked'])
  await service.drain()
  assert(
    asked.some((r) =>
      turn(r).words.includes('is theirs to decide') &&
      turn(r).words.includes('illustrated guide')
    ),
  )
  assert(
    JSON.stringify(await entries(mine)).includes(
      'Ana linked',
    ),
  )
})

test('a guest speaking from a chat account linked to nobody is sent, privately in the room, a link that links it in one tap', async () => {
  let guest = crypto.randomUUID(), session = rootOf(eid, guest)
  let room = crypto.randomUUID(), item = crypto.randomUUID()
  let account = crypto.randomUUID()
  await store.g.apply([
    {
      entity: { eid: session },
      session: {},
      operator_session: { space: eid, person: guest, channel: 'discord' },
    },
    {
      entity: { eid: room },
      chat_room: { via: 'discord', id: 'r1', server: 's1' },
    },
    {
      entity: { eid: account },
      chat_account: { via: 'discord', id: 'matt-1', name: 'hittingkeys' },
    },
    {
      entity: { eid: item },
      chat_message: {
        via: 'discord',
        room,
        connection: 'c1',
        message_id: 'm9',
        author: account,
      },
      doc: { body: 'make the guide an app' },
    },
    {
      entity: { eid: crypto.randomUUID() },
      entry: { session, seq: 1 },
      intake: { item },
    },
  ], { trusted: true })
  let ctx = await operatorContext(env, held, space)
  let said = String(
    await escalate(store, ctx, space, 'https://yaks.example').run(
      { say: 'hittingkeys wants the illustrated guide made an app.' },
      { session, call: { entity: { eid: crypto.randomUUID() } }, entries: [] },
    ),
  )
  assert(said.includes('Tell them in a line to tap it'))
  let [sent] = await store.g.read(q`.chat_private.to=matt-1&*`)
  let body = String((sent.doc as { body: string }).body)
  assert(
    body.includes(
      'https://yaks.example/manage/account/profile?link=discord-account&back=jeff',
    ),
    body,
  )
  equal((sent.deliver as { to: string }).to, room)
})
