import { test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Item, Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { operatorContext } from './operator.ts'
import { mailSend, receive, rootOf, signedFor } from './operator-channels.ts'
import { conversationOf } from './operator-host.ts'
import { mailFrom } from './post.ts'
import { arrived } from './inbox.ts'
import type { Inbound } from './env.ts'

// A person asks their Operator to write to someone for them: a fork sends the
// letter from the Operator's own address with them copied, and the reply
// comes back into their one conversation (T-137908).
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

type Letter = Parameters<NonNullable<typeof env.MAIL>['send']>[0]
let letters: Letter[] = []
env.MAIL = {
  send: (letter) => {
    letters.push(letter)
    return Promise.resolve({ messageId: `sent-${letters.length}` })
  },
}

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
      ? reply('Dr Alvarez says Tuesday at 3 works.')
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
let request = await arrived(answer('alvarez-1', 'sent-1'), env)
await service.drain()
let [replied] = await store.g.get([request])
let asking = replied.operator_request as Record<string, unknown>
let root = await conversationOf(store, '/at', rootOf(eid, person))
let meter = (await dir.at(eid))!.meter!.emails
let afterReply = letters.length

// Writing back in the same thread.
let ctx = await operatorContext(env, held, space)
await mailSend(env, ctx, space, store).run({
  to: 'alvarez@clinic.example',
  name: 'Dr Alvarez',
  text: 'Thank you; Tuesday at 3 it is.',
  answering: request,
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

test("a reply to the letter comes back into the person's conversation as its writer's words, and is counted", () => {
  assertEquals(asking.person, person)
  assertEquals(asking.channel, 'letter')
  assertEquals(
    (replied.mail as Record<string, unknown>).reply_to,
    kept.entity.eid,
  )
  assertEquals(asking.session, rootOf(eid, person))
  assertStringIncludes(
    root.html,
    'By email from alvarez@clinic.example, replying to your letter',
  )
  assertStringIncludes(root.html, 'Tuesday at 3 works for us.')
  assertStringIncludes(root.html, 'Dr Alvarez says Tuesday at 3 works.')
  // Nothing went back to Dr Alvarez but what the Operator sent.
  assertEquals(afterReply, 1)
  assertEquals(meter, 2)
})

test('a letter answering the reply threads on it and keeps its subject', () => {
  assertEquals(followed.subject, 'Re: Checkup on Tuesday')
  assertEquals(followed.headers?.['In-Reply-To'], '<alvarez-1>')
  assertEquals(followed.cc, 'jeff@example.com')
})
