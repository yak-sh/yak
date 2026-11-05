import { cleanup, test } from '@yaks/testing'
import { assertEquals, assertStringIncludes } from '@std/assert'
import type { Item, Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf, type Space } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { conversationOf } from './operator-host.ts'
import { rootOf, textSigned } from './operator-channels.ts'
import { arrived, Refused } from './inbox.ts'
import { arrived as textArrived, DISCLOSURE } from './operator-texts.ts'
import { endpoints } from './endpoints.ts'
import { codeOf } from './referral.ts'
import type { Env, Inbound } from './env.ts'

// A stranger signs up by sending one letter to the sign-up address
// (D-136811): its domain vouches for them, and they are a person with their
// own space, whose Operator answers in the letter's thread (T-138776).
let { env } = platform('signup')
let dir = directoryOf(env.STORE)

type Letter = Parameters<NonNullable<typeof env.MAIL>['send']>[0]
let letters: Letter[] = []
env.MAIL = {
  send: (letter) => {
    letters.push(letter)
    return Promise.resolve({ messageId: `sent-${letters.length}` })
  },
}

// The space's Operator is made by the letter, so its object starts with the
// first request it is sent, as the Builder object does.
let asked: Request[] = []
let services = new Map<string, ReturnType<typeof operatorService>>()
let serviceOf = (space: string, person: string) => {
  let held = services.get(space)
  if (!held) {
    services.set(
      space,
      held = operatorService(
        env,
        { person, role: 'owner', space },
        operatorModel((req) => {
          asked.push(req)
          let items: Item[] = [{
            kind: 'assistant',
            text: 'Welcome to yaks.app! What would you like to make first?',
          }]
          return Promise.resolve({
            id: crypto.randomUUID(),
            model: req.model,
            items,
            cost: 0.001,
          })
        }),
      ),
    )
  }
  return held
}
env.BUILDER = {
  idFromName: (name) => name,
  get: (name) => ({
    fetch: (req: globalThis.Request) =>
      serviceOf(String(name), req.headers.get('x-yak-person') ?? '').binding
        .get(name).fetch(req),
  }),
} as Env['BUILDER']
let drained = () => Promise.all([...services.values()].map((s) => s.drain()))

// A letter to the sign-up address, as Email Routing hands one over, its
// domain's verdict in the receiving MTA's header.
let letter = (
  from: string,
  { id = crypto.randomUUID() as string, vouched = true } = {},
): Inbound => {
  let address = from.match(/<(.+)>/)?.[1] ?? from
  let domain = address.split('@')[1]
  let headers = new Headers({
    From: from,
    To: 'signup@yaks.app',
    Subject: 'Sign me up',
    'Message-ID': `<${id}>`,
    'Content-Type': 'text/plain',
    'Authentication-Results': vouched
      ? `mx.cloudflare.net; dmarc=pass header.from=${domain}; dkim=pass`
      : `mx.cloudflare.net; dmarc=fail header.from=${domain}; dkim=fail`,
  })
  return {
    from: address,
    to: 'Signup@Yaks.App',
    headers,
    raw: new Response(
      [...headers].map(([k, v]) => `${k}: ${v}`).join('\r\n') +
        '\r\n\r\nHi yaks.app, sign me up! (invite from Jeff, k7q2)',
    ).body!,
    setReject: () => {},
  }
}

// Jeff, whose invite's code (referral.ts) every sign-up here carries.
let jeff = crypto.randomUUID()
await dir.stamp({
  entities: [{
    entity: { eid: jeff },
    person: {},
    email: { address: 'jeff@example.com' },
    doc: { title: 'Jeff' },
  }],
})
await codeOf(dir, jeff, () => 'k7q2')

let request = await arrived(
  letter('Dana Reyes <Dana@Example.com>', { id: 'dana-1' }),
  env,
)
await drained()
let person = (await dir.personAt('dana@example.com'))!
let [seat] = await dir.seats(person, 'owner')
let space = seat.space as Space
let said = asked.at(-1)!.items.at(-1)
let { html } = await conversationOf(
  services.get(space.eid)!.store,
  '/at',
  rootOf(space.eid, person),
)
let [reply] = letters.splice(0)

// Writing again, and two letters that make nobody.
await arrived(letter('dana@example.com', { id: 'dana-2' }), env)
await drained()
let again = {
  person: await dir.personAt('dana@example.com'),
  spaces: (await dir.seats(person, 'owner')).length,
  letters: letters.splice(0).length,
}
let refused = []
for (
  let [from, vouched] of [
    ['eve@example.com', false],
    ['noreply@example.com', true],
  ] as const
) {
  refused.push(
    await arrived(letter(from, { vouched }), env).catch((e) => e),
    await dir.personAt(from),
  )
}
let operators = services.size
let danaInvited = await dir.referral(person)

test('a letter to the sign-up address makes its sender a person with their own space and its Operator', async () => {
  assertEquals((await dir.known(person))?.name, 'Dana Reyes')
  assertEquals(space.slug, 'dana')
  assertEquals(seat.own, true)
  assertEquals(!!space.operator, true)
  assertEquals(typeof request, 'string')
})

test('the letter is their first words to the Operator, marked as signing up, and it answers in the thread', () => {
  assertEquals(said?.kind, 'user')
  assertStringIncludes(
    said?.kind == 'user' ? said.text : '',
    'By email, signing up: Hi yaks.app, sign me up!',
  )
  assertStringIncludes(html, 'sign me up!')
  assertEquals(reply.to, 'dana@example.com')
  assertEquals(reply.subject, 'Re: Sign me up')
  assertEquals(reply.headers?.['In-Reply-To'], '<dana-1>')
  assertStringIncludes(reply.text!, 'What would you like to make first?')
  assertStringIncludes(reply.text!, space.operator!)
})

test('a second letter from them reaches the same space, with no second person', () => {
  assertEquals(again, { person, spaces: 1, letters: 1 })
})

test('a letter that carries an invite credits whoever invited them', () => {
  assertEquals(danaInvited?.inviter, jeff)
})

test('a letter its domain does not vouch for, or from a machine, signs nobody up', () => {
  assertEquals(refused.map((r) => r instanceof Refused || r), [
    true,
    null,
    true,
    null,
  ])
  assertStringIncludes(refused[0].message, 'signed nobody up')
  assertEquals(operators, 1)
})

// A stranger signs up by texting the platform's number, once that is switched
// on (TEXT_SIGNUP): the text is their consent to be texted back, and the
// Operator's first answer carries the disclosure (T-136824).
let FREE = '+18885550100'
let texts: { from: string; to: string; text: string }[] = []
let telnyx = endpoints(globalThis).open(async (req) => {
  let path = new URL(req.url).pathname
  if (path == '/messaging_profiles') {
    return Response.json({ data: [{ id: 'profile-1' }] })
  }
  if (path.endsWith('/phone_numbers')) {
    return Response.json({ data: [{ phone_number: FREE }] })
  }
  let sent = await req.json()
  texts.push({ from: sent.from, to: sent.to, text: sent.text })
  return Response.json({ data: { id: `msg-${texts.length}` } })
})
cleanup(() => telnyx.stop())
Object.assign(env, { TELNYX_API: telnyx.url, TELNYX_API_KEY: 'a-key' })
let SAY = 'Hi yaks.app, sign me up! (invite from Jeff, k7q2)'
let texting = async (from: string, text: string, id: string = from + text) => {
  await textArrived(env, {
    id,
    from,
    to: FREE,
    text,
    at: '2026-11-05T15:00:00Z',
    rcs: false,
    media: [],
  })
  await drained()
}

let ANA = '+12695550177', ABROAD = '+447700900123'
await texting(ANA, SAY)
let unread = { person: await dir.phoned(ANA), texts: texts.length }
env.TEXT_SIGNUP = 'on'
await texting(ANA, SAY, 'ana-1')
await texting(ANA, SAY, 'ana-1')
let ana = (await dir.phoned(ANA))!
let agreed = await dir.texting(ana)
let anaSpace = (await dir.seats(ana, 'owner'))[0].space as Space
let anaAsked = asked.at(-1)!.items.at(-1)
let anaInvited = await dir.referral(ana)
let firstText = texts.splice(0)
await texting(ANA, 'Make me a recipe box')
let secondText = texts.splice(0)
await texting(ABROAD, SAY)

test('a stranger who texts is left unread until signing up by text is switched on, and a number abroad signs nobody up', async () => {
  assertEquals([unread.person ?? null, unread.texts], [null, 0])
  assertEquals(await dir.phoned(ABROAD), null)
})

test('a text from a number nobody wears makes a person wearing it, their consent in their words, and their own space', () => {
  assertEquals(anaInvited?.inviter, jeff)
  assertEquals(agreed?.number, ANA)
  assertEquals(agreed?.consent, SAY)
  assertStringIncludes(anaSpace.slug, 'space-')
  assertEquals(!!anaSpace.operator, true)
})

test('the Operator hears the text as signing up and answers it once, with STOP and HELP after its sign-off; later answers leave them off', () => {
  assertEquals(anaAsked?.kind, 'user')
  assertStringIncludes(
    anaAsked?.kind == 'user' ? anaAsked.text : '',
    `By text, signing up: ${SAY}`,
  )
  assertEquals(firstText, [{
    from: FREE,
    to: ANA,
    text: `Welcome to yaks.app! What would you like to make first?\n\n${
      textSigned(anaSpace)
    }\n${DISCLOSURE}`,
  }])
  assertEquals(secondText.length, 1)
  assertEquals(secondText[0].text.includes(DISCLOSURE), false)
})
