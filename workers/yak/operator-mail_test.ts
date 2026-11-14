import { short } from '@yaks/id'
import { test } from '@yaks/testing'
import type { Binding } from '@yaks/cloudflare-mail'
import { assert, assertEquals, assertStringIncludes } from '@std/assert'
import type { Item, Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { operatorContext } from './operator.ts'
import { mailSend, receive, signedFor } from './operator-channels.ts'
import { rootOf } from './operator-root.ts'
import { conversationOf } from './operator-host.ts'
import { mailFrom } from './post.ts'
import { arrived, reading } from './inbox.ts'
import type { Inbound } from './env.ts'

// A person asks their Operator to write to someone for them: a fork sends the
// letter from the Operator's own address with them copied, and the reply is
// answered in its writer's own conversation, with only their permissions,
// and told in the person's (T-137908, D-151808).
let { env } = platform('operator-mail')
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

let asked: Request[] = []
let reply = (text: string): Item[] => [{ kind: 'assistant', text }]
let call = (name: string, args: unknown): Item[] => [{
  kind: 'call',
  id: crypto.randomUUID(),
  name,
  args: JSON.stringify(args),
}]
let said = (r: Request, words: RegExp) => {
  let last = r.items.at(-1)
  return last?.kind == 'user' && words.test(last.text)
}
let service = operatorService(
  env,
  held,
  operatorModel((req) => {
    asked.push(req)
    let forked = JSON.stringify(req.items).includes('fork of the')
    let last = req.items.at(-1)
    let items = forked
      ? last?.kind == 'result'
        ? reply('Asked Dr Alvarez about Tuesday at 3.')
        : call('mail_send', {
          to: 'Alvarez@Clinic.example',
          name: 'Dr Alvarez',
          subject: 'Checkup on Tuesday',
          text: 'Does Tuesday at 3 work for his checkup?',
        })
      : said(req, /By email from alvarez/)
      ? reply('Thank you; I will tell Jeff.')
      : said(req, /Asked Dr Alvarez/)
      ? reply('I asked Dr Alvarez; I will tell you what they say.')
      : last?.kind == 'result'
      ? reply('On it: writing to Dr Alvarez.')
      : call('fork', { prompt: 'Email Dr Alvarez about Tuesday at 3' })
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
  'Ask Dr Alvarez (alvarez@clinic.example) if Tuesday at 3 works for my checkup',
)
await service.drain()
let [sent] = letters
let [kept] = await store.g.read('.operator_letter&*')
let [fork] = await store.g.read(`.spawned.parent=${rootOf(eid, person)}`)
let ofFork = await conversationOf(store, '/at', fork.entity.eid)

// Dr Alvarez answers only the Operator, the way Reply does.
let from = mailFrom('jeff', null, env)
let answer = (id: string, answers: string): Inbound => {
  let headers = new Headers({
    From: 'Dr Alvarez <alvarez@clinic.example>',
    To: from,
    Subject: 'Re: Checkup on Tuesday',
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
        '\r\n\r\nTuesday at 3 works for us.',
    ).body!,
    setReject: () => {},
  }
}
let request = await arrived(
  await reading(answer('alvarez-1', 'sent-1'), env),
  env,
)
await service.drain()
let [replied] = await store.g.get([request])
let asking = replied.operator_request as Record<string, unknown>
let root = await conversationOf(store, '/at', rootOf(eid, person))
let writer = (await dir.personAt('alvarez@clinic.example'))!
let theirs = await conversationOf(store, '/at', rootOf(eid, writer))
let meter = (await dir.at(eid))!.meter!.emails
let answeredBack = letters.find((l) =>
  l.to == 'alvarez@clinic.example' && l.text?.includes('Thank you')
)!

// Writing back in the same thread.
let ctx = await operatorContext(env, held, space)
await mailSend(env, ctx, space, store).run({
  to: 'alvarez@clinic.example',
  name: 'Dr Alvarez',
  text: 'Thank you; Tuesday at 3 it is.',
  // As its framing names it: `(letter #abc123)`.
  answering: short(request),
})
let followed = letters.at(-1)!

test("a fork's letter goes from the Operator's own address to its recipient, with the person copied and signed as their assistant", () => {
  assertEquals(sent.from, {
    name: `${space.operator} for Jeff Peterson`,
    email: from,
  })
  assertEquals(sent.to, 'alvarez@clinic.example')
  assertEquals(sent.cc, 'jeff@example.com')
  assertEquals(sent.subject, 'Checkup on Tuesday')
  assertStringIncludes(sent.text!, 'Does Tuesday at 3 work for his checkup?')
  assertStringIncludes(sent.text!, signedFor(space, 'Jeff Peterson'))
  assertEquals(kept.mail, {
    from,
    to: 'alvarez@clinic.example',
    cc: 'jeff@example.com',
    at: (kept.mail as { at: string }).at,
    message_id: 'sent-1',
  })
  assertEquals((kept.operator_letter as { person: string }).person, person)
  assertStringIncludes(ofFork.html, 'Emailed Dr Alvarez')
})

test("a reply to the letter is answered in its writer's own conversation and in its thread, told in the person's, and counted", () => {
  assert(writer && writer != person)
  assertEquals(asking.person, writer)
  assertEquals(asking.channel, 'letter')
  assertEquals(asking.about, kept.entity.eid)
  assertEquals(
    (replied.mail as Record<string, unknown>).reply_to,
    kept.entity.eid,
  )
  assertEquals(asking.session, rootOf(eid, writer))
  assertStringIncludes(theirs.html, 'Tuesday at 3 works for us.')
  assertStringIncludes(theirs.html, 'Thank you; I will tell Jeff.')
  assertEquals(answeredBack.to, 'alvarez@clinic.example')
  assertEquals(answeredBack.subject, 'Re: Checkup on Tuesday')
  assertEquals(answeredBack.headers?.['In-Reply-To'], '<alvarez-1>')
  assertStringIncludes(answeredBack.text!, 'Thank you; I will tell Jeff.')
  assertEquals(answeredBack.cc, undefined)
  assertStringIncludes(
    root.html,
    'A reply to a letter: alvarez@clinic.example replied',
  )
  assertStringIncludes(root.html, 'Tuesday at 3 works for us.')
  assertEquals(root.html.includes('Thank you; I will tell Jeff.'), false)
  // The letter, its reply, the answer, and Jeff's alert of the reply.
  assertEquals(
    letters.filter((l) => l.to == 'jeff@example.com')
      .some((l) => l.text?.includes('replied to the letter you sent them')),
    true,
  )
  assertEquals(meter, 4)
})

test('a letter answering the reply threads on it and keeps its subject', () => {
  assertEquals(followed.subject, 'Re: Checkup on Tuesday')
  assertEquals(followed.headers?.['In-Reply-To'], '<alvarez-1>')
  assertEquals(followed.cc, 'jeff@example.com')
})
