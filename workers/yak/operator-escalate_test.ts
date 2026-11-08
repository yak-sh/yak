import { derivedEid } from '@yaks/graph/identity'
import { test } from '@yaks/testing'
import type { Binding } from '@yaks/cloudflare-mail'
import { assert, assertEquals, assertRejects } from '@std/assert'
import type { Item, Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { operatorContext } from './operator.ts'
import { receive } from './operator-channels.ts'
import { escalate, escalationAnswer } from './operator-escalate.ts'
import { rootOf } from './operator-root.ts'
import { conversationOf } from './operator-host.ts'
import { mailFrom } from './post.ts'
import { arrived } from './inbox.ts'
import type { Inbound } from './env.ts'

// A person's Operator writes to Dr Alvarez for them. Her reply is answered in
// her own conversation, with only her permissions, which raises the time she
// proposes with the person's conversation. That one decides with the
// person's permissions, writes back on the thread, and tells hers only what
// it chooses to (T-151880).
let { env } = platform('operator-escalate')
let dir = directoryOf(env.STORE)
let person = crypto.randomUUID(), eid = crypto.randomUUID()
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
    let items = forked
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
          answering: named(words, /\(letter (\S+)\)/),
        })
        : since == 1
        ? call('escalation_answer', {
          escalation: named(words, /naming escalation (\S+)\./),
          say: 'Jeff confirmed Tuesday at 3 on the thread.',
        })
        : reply(
          'Dr Alvarez proposed Tuesday at 3; it was free, so I confirmed it.',
        )
      : /By email from alvarez/.test(words)
      ? since
        ? reply('Thank you; I have passed it on to Jeff.')
        : call('escalate', {
          reply: named(words, /\(letter (\S+)\)/),
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
let reached = await arrived(answer('alvarez-1', 'sent-1'), env)
await service.drain()

let writer = (await dir.personAt('alvarez@clinic.example'))!
let theirs = rootOf(eid, writer), mine = rootOf(eid, person)
let [raised] = await store.g.read('.operator_request.channel=escalated&*')
let request = raised.operator_request as Record<string, unknown>
let entries = (session: string) =>
  store.g.read(`.entry.session=${session}&.order=entry.seq&*`)
let noteOf = async () =>
  (await entries(theirs)).find((b) =>
    (b.operator_channel as { channel?: string })?.channel == 'escalation'
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
      'From your conversation with Jeff Peterson, the person you sent it for',
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
  // The answer told in the person's Updates.
  let [told] = await store.g.get([
    derivedEid('operator-told|' + raised.entity.eid),
  ])
  assertEquals((told.deliver as { to: string }).to, person)
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
      await escalate(store, space).run(
        { reply: reached, say: 'Anything' },
        as(mine),
      ),
    Error,
    'There is no reply',
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
