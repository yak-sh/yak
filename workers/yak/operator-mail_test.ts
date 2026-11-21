import { line } from '@yaks/query'
import { short } from '@yaks/id'
import { test } from '@yaks/testing'
import type { Binding } from '@yaks/cloudflare-mail'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import type { Item, Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { operatorContext } from './operator.ts'
import { mailSend, owedRows, receive } from './operator-channels.ts'
import { signedFor } from '@yaks/platform/letters'
import { rootOf } from './operator-root.ts'
import { conversationOf, operatorReply } from './operator-host.ts'
import { mailFrom } from '@yaks/platform/host'
import { arrived, reading, Refused } from './inbox.ts'
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

// The id the letter to Dr Alvarez went out with; Jeff's alert of the tap it
// waited for went out first.
let asked1 = () =>
  `sent-${letters.findIndex((l) => /alvarez/i.test(String(l.to))) + 1}`

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
    let items = said(req, /They tapped Approve/)
      ? reply('I sent Dr Alvarez the email and will tell you what they say.')
      : forked
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
      : said(req, /Sounds good, thanks/)
      ? reply('Glad it works.')
      : said(req, /By email from bea/)
      ? reply('It is a list Jeff keeps; you could read it.')
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
// Mail to someone new waits for the person's tap.
let waited = letters.filter((l) => l.to != 'jeff@example.com').length
await service.approve()
await service.drain()
let sent = letters.find((l) => /alvarez/i.test(String(l.to)))!
let SENT = asked1()
let kept = (await store.g.read('.operator_letter&*'))
  .find((l) => /alvarez/i.test(String((l.mail as { to?: string }).to)))!
let [fork] = await store.g.read(line`.spawned.parent=${rootOf(eid, person)}`)
let ofFork = await conversationOf(store, '/at', fork.entity.eid)

// Dr Alvarez answers only the Operator, the way Reply does.
let from = mailFrom('jeff', null, env)
let answer = (
  id: string,
  answers: string,
  writer = 'Dr Alvarez <Alvarez@Clinic.example>',
  words = 'Tuesday at 3 works for us.',
): Inbound => {
  let headers = new Headers({
    From: writer,
    To: from,
    Subject: 'Re: Checkup on Tuesday',
    'Message-ID': `<${id}>`,
    'In-Reply-To': `<${answers}>`,
    References: `<${answers}>`,
    'Content-Type': 'text/plain',
    'Authentication-Results': `mx.cloudflare.net; dmarc=pass header.from=${
      writer.match(/@([^>]+)>/)![1].toLowerCase()
    }; dkim=pass`,
  })
  return {
    from: writer.match(/<(.+)>/)![1].toLowerCase(),
    to: from,
    headers,
    raw: new Response(
      [...headers].map(([k, v]) => `${k}: ${v}`).join('\r\n') +
        '\r\n\r\n' + words,
    ).body!,
    setReject: () => {},
  }
}
let request = await arrived(
  await reading(answer('alvarez-1', SENT), env),
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
await service.drain()
let followed = letters.at(-1)!

test("a fork's letter to someone new waits for the person's tap, then goes from the Operator's own address to its recipient, with the person copied and signed as their assistant", () => {
  assertEquals(waited, 0)
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
    name: `${space.operator} for Jeff Peterson`,
    to: 'alvarez@clinic.example',
    cc: 'jeff@example.com',
    at: (kept.mail as { at: string }).at,
    message_id: SENT,
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
  // The approval alert, the letter, the approval follow-up, the reply,
  // its answer, Jeff's alert about the reply, and his alert that the turn
  // he asked from the chat and left ended.
  let followedApproval = letters.find((l) =>
    l.to == 'jeff@example.com' && l.subject == 'Follow-up to your answer'
  )
  assert(followedApproval)
  assertStringIncludes(followedApproval.text!, 'I sent Dr Alvarez the email')
  let alert = letters.find((l) =>
    l.to == 'jeff@example.com' &&
    l.subject == 'alvarez@clinic.example replied to the letter you sent them'
  )
  assert(alert)
  assertStringIncludes(alert.text!, 'Tuesday at 3 works for us.')
  assert(
    letters.some((l) =>
      l.to == 'jeff@example.com' && l.subject?.startsWith('Reply to “Ask Dr')
    ),
  )
  assertEquals(meter, 7)
})

test('a letter answering the reply threads on it and keeps its subject', () => {
  assertEquals(followed.subject, 'Re: Checkup on Tuesday')
  assertEquals(followed.headers?.['In-Reply-To'], '<alvarez-1>')
  assertEquals(followed.cc, 'jeff@example.com')
})

await store.g.apply([{
  entity: { eid: crypto.randomUUID() },
  operator_letter: { person },
  mail: { to: 'outsider@example.com', message_id: 'sent-outsider' },
}], { trusted: true })

for (
  let [name, vouched, from, bot, thread] of [
    [
      'no authentication verdict',
      undefined,
      'alvarez@clinic.example',
      false,
      SENT,
    ],
    ['DKIM without DMARC', false, 'alvarez@clinic.example', false, SENT],
    [
      'another authenticated address',
      true,
      'outsider@example.com',
      false,
      SENT,
    ],
    [
      'an unauthenticated machine',
      false,
      'alvarez@clinic.example',
      true,
      SENT,
    ],
    [
      'a machine at another address',
      true,
      'outsider@example.com',
      true,
      SENT,
    ],
    [
      'a newer letter to another recipient',
      true,
      'alvarez@clinic.example',
      false,
      'sent-outsider',
    ],
  ] as const
) {
  let mail = {
    ...await reading(answer(crypto.randomUUID(), SENT), env),
    vouched,
  }
  let headers = new Headers({
    From: from,
    'In-Reply-To': `<${thread}>`,
    References: `<${SENT}>`,
    ...(bot ? { 'Auto-Submitted': 'auto-replied' } : {}),
  })
  mail.headers = headers
  test(`a reply with ${name} has no Operator side effects`, async () => {
    let before = {
      graph: await store.g.read('*'),
      turns: asked.length,
      letters: letters.length,
      person: await dir.personAt(from),
    }
    await assertRejects(
      () => arrived(mail, env),
      Refused,
      'authenticated reply',
    )
    assertEquals({
      graph: await store.g.read('*'),
      turns: asked.length,
      letters: letters.length,
      person: await dir.personAt(from),
    }, before)
  })
}

test('the Operator intake refuses a reply from another letter recipient before recording it', async () => {
  let before = await store.g.read('*')
  let armed = 0
  let response = await operatorReply(
    { store },
    eid,
    '/operator/replied',
    {
      thread: [SENT],
      request: { address: 'outsider@example.com' },
      say: 'Forged words',
    },
    () => {
      armed++
      return undefined
    },
    writer,
  )
  assertEquals(response.status, 403)
  assertEquals(await store.g.read('*'), before)
  assertEquals(armed, 0)
})

let autoReply = {
  ...await reading(answer('alvarez-auto', SENT), env),
  text: 'The clinic is closed this afternoon.',
  headers: new Headers({
    From: 'alvarez@clinic.example',
    'In-Reply-To': `<${SENT}>`,
    'Auto-Submitted': 'auto-replied',
  }),
}
test('an authenticated machine at the recipient address tells the member without being answered', async () => {
  let turns = asked.length, mailed = letters.length
  await arrived(autoReply, env)
  await service.drain()
  assertEquals(asked.length, turns)
  assertEquals(letters.slice(mailed).map((l) => l.to), ['jeff@example.com'])
  let note = await conversationOf(store, '/at', rootOf(eid, person))
  assertStringIncludes(note.html, autoReply.text)
})

// An invitation the Operator wrote for Jeff (invite.ts `send`): its reader's
// question is answered knowing what accepting gives them, and that Jeff
// already has their words, which their own permissions could never read.
await store.g.apply(
  owedRows(env, space, {
    to: 'bea@example.com',
    person,
    subject: 'Jeff invited you',
    body: 'Jeff invited you to see Packing List (jeff.yaks.app/packing).',
    invite: {
      invite: crypto.randomUUID(),
      place: 'Packing List (jeff.yaks.app/packing)',
      role: 'viewer',
    },
  }),
  { trusted: true },
)
await service.drain()
let invitation = letters.findLast((l) => l.to == 'bea@example.com')!
let beaAsked = asked.length
let beaReply = await arrived(
  await reading(
    answer(
      'bea-1',
      `sent-${letters.indexOf(invitation) + 1}`,
      'Bea <bea@example.com>',
      'What is the Packing List, and what could I do with it?',
    ),
    env,
  ),
  env,
)
await service.drain()
let beaTurns = asked.slice(beaAsked)

test("an invitee's reply is answered once, knowing the place and role the invitation gives and that the inviter has their words", () => {
  assertEquals(beaTurns.length, 1)
  let framed = JSON.stringify(beaTurns[0].items)
  for (
    let words of [
      'a viewer of Packing List (jeff.yaks.app/packing)',
      'read everything in it, and change nothing',
      'already has their words',
      `Their reply is letter ${short(beaReply)}`,
    ]
  ) assertStringIncludes(framed, words)
  let answers = letters.filter((l) =>
    l.to == 'bea@example.com' && l.subject?.startsWith('Re:')
  )
  assertEquals(answers.length, 1)
})

// Jeff answers the alert that quoted Dr Alvarez's reply, and his mail client
// quotes the alert below his words (T-1855). The turn hears his words as his,
// and the quoted letter, which the Operator wrote and kept, not as his.
let alert = letters.find((l) =>
  l.to == 'jeff@example.com' && /replied to the letter/.test(l.subject ?? '')
)!
let jeffAsked = asked.length
await arrived(
  await reading(
    answer(
      'jeff-ok',
      `sent-${letters.indexOf(alert) + 1}`,
      'Jeff Peterson <jeff@example.com>',
      `Sounds good, thanks.\n\nOn Fri, Nov 21, 2026 at 9:00 AM ${space.operator} <${from}> wrote:\n` +
        alert.text!.split('\n').map((l) => `> ${l}`).join('\n'),
    ),
    env,
  ),
  env,
)
await service.drain()
let jeffTurn = asked.slice(jeffAsked)[0]

test("a member's reply to the Operator's letter is heard as their words, without the letter it quotes", () => {
  let heard = jeffTurn.items.findLast((i) => i.kind == 'user')
  assert(heard?.kind == 'user')
  assertStringIncludes(heard.text, 'Sounds good, thanks.')
  assertEquals(heard.text.includes('Tuesday at 3 works for us.'), false)
  assertEquals(heard.text.includes('wrote:'), false)
})
