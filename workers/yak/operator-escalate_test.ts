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
  copyOf,
  escalate,
  ESCALATION,
  escalationAnswer,
  investigatorOf,
  linkedTo,
  ODD_REPORTS,
  oddReport,
} from './operator-escalate.ts'
import { short } from '@yaks/id'
import { meta } from './meta.ts'
import { rootOf } from './operator-root.ts'
import { askOf, waiting } from './operator-approvals.ts'
import { conversationOf } from './operator-host.ts'
import { mailFrom } from '@yaks/platform/host'
import { arrived, reading } from './inbox.ts'
import { updatesOf, updating } from './operator-updates.ts'
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
// What her conversation raised waits in Jeff's Updates, and starts no turn
// until he takes it up there.
let [copy] = await store.g.read('.operator_escalation&*')
let waited = {
  turns: asked.filter((r) => /Raised from/.test(turn(r).words)).length,
  updates: await updatesOf(store, person, eid),
}
await updating(store, held, {
  choose: copy.entity.eid,
  choice: ESCALATION.take,
})
await service.drain()
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

// T-2523: a stranger's escalate starts no model turn with anyone; it is a
// decision in their Updates, and a turn starts when they answer it.
test('what is raised waits in the Updates of who may answer it, and starts no turn until they take it up', () => {
  equal(waited.turns, 0)
  let item = waited.updates.updates.find((u) => u.eid == copy.entity.eid)!
  assert(item.needs)
  equal(
    item.choices?.map((c) => c.label),
    [ESCALATION.take, ESCALATION.leave],
  )
  equal(item.from?.chat, mine)
  equal(raisedAsks.length > 0, true)
})

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
  let copies = await store.g.read(
    q`.operator_escalation.raised=${escalation}&*`,
  )
  let of = (b: (typeof copies)[number]) =>
    b.operator_escalation as Record<string, unknown>
  let to = (b: (typeof copies)[number]) =>
    (b.filed as { assignee: string }).assignee
  assertEquals(new Set(copies.map(to)), new Set([person, ana]))
  // Both take it up: each conversation is started by its own person.
  for (
    let [who, b] of [[held, copies.find((b) => to(b) == person)!], [{
      person: ana,
      space: eid,
    }, copies.find((b) => to(b) == ana)!]] as const
  ) {
    await updating(store, who, {
      choose: b.entity.eid,
      choice: ESCALATION.take,
    })
  }
  await service.drain()
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
  let jeffs = copies.find((b) => to(b) == person)!
  let anas = copies.find((b) => to(b) == ana)!
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
    q`.operator_escalation.raised=${escalation}&*`,
  )
  assertEquals(
    copies.map((b) => (b.filed as { assignee: string }).assignee),
    [ana],
  )
  // Her words on it in her Updates answer it, and start her conversation
  // with them.
  let anas = { person: ana, space: eid }
  await updating(store, anas, {
    reply: copies[0].entity.eid,
    say: 'Not me; ask Jeff.',
  })
  await service.drain()
  assert(
    asked.some((r) =>
      turn(r).words.includes('this person answered it: “Not me; ask Jeff.”')
    ),
  )
  await escalationAnswer(
    store,
    await operatorContext(env, { person: ana }, space),
    space,
  ).run({ escalation: copies[0].entity.eid, say: 'That was not Ana.' }, {
    session: rootOf(eid, ana),
    call: { entity: { eid: crypto.randomUUID() } },
    entries: [],
  })
})

// T-2523: a stranger raises one escalation at a time; more while it is open
// is added to it, never a new one.
test('a conversation has one escalation open at a time, and a repeat folds into it', async () => {
  let ctx = await operatorContext(env, held, space)
  let raise = async (say: string) => {
    let said = String(
      await escalate(store, ctx, space).run({ say }, {
        session: theirs,
        call: { entity: { eid: crypto.randomUUID() } },
        entries: [],
      }),
    )
    return JSON.parse(said.slice(0, said.indexOf('}') + 1))
  }
  let first = await raise('Asks for a refund.')
  let again = await raise('Asks again, louder.')
  equal(again, { escalation: first.escalation, folded: 2 })
  let copies = await store.g.read(
    q`.operator_escalation.raised=${first.escalation}&*`,
  )
  equal(copies.length, 2)
  for (let b of copies) {
    equal(
      (b.doc as { body: string }).body,
      'Asks for a refund.\n\nAsks again, louder.',
    )
  }
  equal(
    (await store.g.read(q`.operator_escalation.from=${theirs}&*`))
      .filter((b) =>
        !(b.operator_escalation as Record<string, unknown>).answered_by
      )
      .length,
    2,
  )
  // Taken up, what is added later is a note in that conversation, no turn.
  let jeffs = copyOf(first.escalation, person)
  await updating(store, held, { choose: jeffs, choice: ESCALATION.take })
  await service.drain()
  let turns = asked.length
  await raise('Asks a third time.')
  await service.drain()
  equal(asked.length, turns)
  assert(JSON.stringify(await entries(mine)).includes('Asks a third time.'))
  // Ana lets it go: it is closed for everyone, Jeff's conversation and the
  // writer's are told, and nothing starts.
  await updating(store, { person: ana, space: eid }, {
    choose: copyOf(first.escalation, ana),
    choice: ESCALATION.leave,
  })
  await service.drain()
  let closed = await store.g.read(
    q`.operator_escalation.raised=${first.escalation}&*`,
  )
  equal(
    closed.map((b) =>
      (b.operator_escalation as { answered_by?: string }).answered_by
    ),
    [ana, ana],
  )
  equal(asked.length, turns)
  assert(JSON.stringify(await entries(mine)).includes('Ana answered'))
  assert(JSON.stringify(await entries(theirs)).includes('They let it go'))
})

// T-2511: one report starts one investigation, held to one at a time and
// ODD_REPORTS a day from one conversation, so a stranger cannot start them
// faster than the space's people can read them. It reports to one decider's
// conversation, an owner's first, and the rest are told at once.
test("an odd request is looked into by one helper with a guest's tools, whose report reaches a decider's conversation, and the rest are told", async () => {
  let ctx = await operatorContext(env, { person: writer }, space)
  let report = async (say: string) =>
    await oddReport(store, ctx, space, {}).run({ say }, {
      session: theirs,
      call: { entity: { eid: crypto.randomUUID() } },
      entries: [],
    })
  let { investigating } = JSON.parse(String(
    await report('Dr Alvarez asks for Jeff’s card number to hold the slot.'),
  ))
  // One at a time: a second report while it runs is refused, naming it.
  await assertRejects(
    () => report('Dr Alvarez asks again.'),
    Error,
    short(investigating),
  )
  await service.drain()
  let [helper] = await store.g.get([investigating])
  equal((helper.spawned as { parent: string }).parent, mine)
  equal(helper.operator_session, {
    space: eid,
    person: investigatorOf(eid),
    channel: 'chat',
    visitor: writer,
  })
  // Ana, an editor, is told where it is looked into; Bo, a viewer, is not.
  assert(
    JSON.stringify(await entries(rootOf(eid, ana))).includes(
      short(investigating),
    ),
  )
  equal(
    (await store.g.read(q`.spawned.parent=${rootOf(eid, ana)}&*`)).length,
    0,
  )
  let looked = asked.find((r) =>
    /Look into a request reported/.test(turn(r).words)
  )!
  let names = callable(looked)
  equal(names.includes('feedback'), true)
  for (let door of ['mail_send', 'graph_apply', 'fork', 'odd_report']) {
    equal(names.includes(door), false, door)
  }
  assert(
    JSON.stringify(await entries(mine)).includes('likely phishing'),
    "the helper's report reaches the owner's conversation",
  )
  // Settled, the next may start, up to the day's count.
  for (let n = 1; n < ODD_REPORTS; n++) {
    await report(`Odd request ${n}.`)
    await service.drain()
  }
  await assertRejects(() => report('One more.'), Error, 'today')
})

// T-2511: a stranger's turns spend the visitors' share of the space's budget
// and count among their calls of the day; a member's do not.
test("a stranger's turns spend the visitors' share, and a member's do not", async () => {
  let tally = async (who: string) =>
    (await meta(env).query(
      q`.entity.eid=${derivedEid(`visitor-calls|${eid}|${who}`)}`,
    ))[0]?.visitor_calls as { calls?: number } | undefined
  assert(Number((await tally(writer))?.calls) > 0)
  equal(await tally(person), undefined)
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
    store.g.read(q`.operator_escalation.raised=${raised}&*`)
  let answered = async (raised: string) =>
    (await copiesOf(raised)).map((b) =>
      (b.operator_escalation as { answered_by?: string }).answered_by
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
  // Jeff took it up; Ana never did.
  await updating(store, held, {
    choose: copyOf(looked, person),
    choice: ESCALATION.take,
  })
  await service.drain()
  // Jeff's conversation, answering it, asked an approval Bo is asked too.
  let approval = crypto.randomUUID()
  await store.g.apply([{
    entity: { eid: rootOf(eid, bo) },
    session: {},
    operator_session: { space: eid, person: bo, channel: 'chat' },
  }], { trusted: true })
  await store.g.apply(
    await waiting(store, eid, approval, {
      person,
      session: mine,
      tool: 'app_new',
      args: {},
      say: 'Make the guide an app',
      expires: new Date(Date.now() + 60_000).toISOString(),
      approvers: [person, bo],
      raised: looked,
    }),
    { trusted: true },
  )
  // As an editor, it is theirs: closed for the rest, and back with them.
  let [back] = await linkedTo(store, eid, writer, {
    person: ana,
    role: 'editor',
    name: 'Ana',
  })
  equal(await answered(looked), [ana, ana])
  let open = await store.g.get([approval, askOf(approval, bo)])
  equal(open.map((b) => !!b.cancelled), [true, true])
  assert(
    JSON.stringify(await entries(rootOf(eid, bo))).includes(
      'went through as theirs',
    ),
  )
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
