import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import type { Item, Request } from '@yaks/model'
import { platform } from './directory-rows-probe.ts'
import { directoryOf, type Space } from './directory.ts'
import { operatorModel, operatorService } from './operator-testing.ts'
import { conversationOf } from './operator-host.ts'
import { rootOf } from './operator-channels.ts'
import { arrived, Refused } from './inbox.ts'
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

let request = await arrived(
  letter('Dana Reyes <Dana@Example.com>', { id: 'dana-1' }),
  env,
)
await drained()
let person = (await dir.personAt('dana@example.com'))!
let [seat] = await dir.seats(person, 'owner')
let space = seat.space as Space
let said = asked[0].items.at(-1)
let { html } = await conversationOf(
  services.get(space.eid)!.store,
  '/at',
  rootOf(space.eid, person),
)
let [reply] = letters

test('a letter to the sign-up address makes its sender a person with their own space and its Operator', async () => {
  assertEquals((await dir.known(person))?.name, 'Dana Reyes')
  assertEquals(space.slug, 'dana')
  assertEquals(seat.own, true)
  assertEquals(!!space.operator, true)
  assertEquals(services.size, 1)
  assertEquals(typeof request, 'string')
})

test('the letter is their first words to the Operator, marked as signing up, and it answers in the thread', () => {
  assertEquals(said?.kind, 'user')
  assertStringIncludes(
    said?.kind == 'user' ? said.text : '',
    'By email, signing up: Hi yaks.app, sign me up!',
  )
  assertStringIncludes(html, 'sign me up!')
  assertEquals(letters.length, 1)
  assertEquals(reply.to, 'dana@example.com')
  assertEquals(reply.subject, 'Re: Sign me up')
  assertEquals(reply.headers?.['In-Reply-To'], '<dana-1>')
  assertStringIncludes(reply.text!, 'What would you like to make first?')
  assertStringIncludes(reply.text!, space.operator!)
})

test('a second letter from them reaches the same space, with no second person', async () => {
  await arrived(letter('dana@example.com', { id: 'dana-2' }), env)
  await drained()
  assertEquals(await dir.personAt('dana@example.com'), person)
  assertEquals((await dir.seats(person, 'owner')).length, 1)
  assertEquals(services.size, 1)
  assertEquals(letters.length, 2)
})

test('a letter its domain does not vouch for, or from a machine, signs nobody up', async () => {
  for (
    let [from, vouched] of [
      ['eve@example.com', false],
      ['noreply@example.com', true],
    ] as const
  ) {
    await assertRejects(
      () => arrived(letter(from, { vouched }), env),
      Refused,
      'signed nobody up',
    )
    assertEquals(await dir.personAt(from), null)
  }
  assertEquals(services.size, 1)
})
