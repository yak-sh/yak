import { equal, test } from '@yaks/testing'
import { assertRejects } from '@std/assert'
import { platform } from './directory-rows-probe.ts'
import { endpoints } from './endpoints.ts'
import { consentPhone, provePhone } from './phone-contact.ts'
import { meta } from './meta.ts'
import { codeText, LIFE, lodge, mint, spend, TRIES } from './signin.ts'
import { costOf } from './text-spend.ts'
import { consentEid } from '@yaks/phone'
import { REPLIES } from './operator-texts.ts'

let setup = async (name: string, old?: string) => {
  let { env, dir } = platform('phone-proof-' + name)
  let person = crypto.randomUUID(), space = crypto.randomUUID()
  await dir.apply({
    entities: [
      {
        entity: { eid: person },
        person: {},
        ...(old ? { phone: { number: old } } : {}),
      },
      { entity: { eid: space }, space: { slug: name, store: name } },
      {
        entity: { eid: crypto.randomUUID() },
        member: { person, space, role: 'owner' },
      },
    ],
  }, { 'x-yak-person': person })
  let sent: { to: string; text: string }[] = []
  let transport = endpoints(globalThis).open(async (req) => {
    let path = new URL(req.url).pathname
    if (path == '/messaging_profiles') {
      return Response.json({ data: [{ id: 'profile' }] })
    }
    if (path.endsWith('/phone_numbers')) {
      return Response.json({ data: [{ phone_number: '+18885550100' }] })
    }
    sent.push(await req.json())
    return Response.json({ data: { id: crypto.randomUUID() } })
  })
  Object.assign(env, {
    PHONE_SENDER: { via: 'telnyx' },
    TELNYX_API: transport.url,
    TELNYX_API_KEY: 'key',
  })
  let held = (await dir.at(space))!
  let proof = (number: string, code = '') =>
    provePhone(env, person, held, number, true, code)
  let code = () => sent.at(-1)!.text.match(/\d{6}/)![0]
  return { env, dir, person, space: held, sent, proof, code }
}

let change = await setup('change', '+12695550140')
await meta(change.env).apply([{
  entity: { eid: consentEid(change.person) },
  sms_consent: {
    person: change.person,
    consent: 'Earlier consent',
    at: '2026-01-01T00:00:00Z',
    space: change.space.eid,
  },
}], { 'x-yak-kernel': '1' })
let pending = await change.proof('269-555-0141')
let before = await change.dir.phoneAt(change.person)
let noConsent = await change.dir.texting(change.person)
let code = change.code()
let bad = code == '000000' ? '000001' : '000000'
let wrong = await assertRejects(() => change.proof('269-555-0141', bad))
let login = await spend(
  meta(change.env),
  change.env.SESSION_SECRET!,
  '+12695550141',
  code,
)
await change.proof('269-555-0141', code)
await consentPhone(change.env, change.person, change.space, '+12695550141')
await consentPhone(change.env, change.person, change.space, '+12695550141')
let paid = (await change.dir.at(change.space.eid))!.meter!.texts

test('a replacement number requires its texted code, preserves the old number until proof, and charges code and one welcome', () => {
  equal(pending?.pending, true)
  equal(before, '+12695550140')
  equal(noConsent?.number, '+12695550140')
  equal(login, null)
  equal(change.sent.map((s) => s.text), [codeText(code), REPLIES.welcome])
  equal(paid, costOf(codeText(code)) + costOf(REPLIES.welcome))
  equal((wrong as Error).message.includes('code'), true)
})

test('successful proof attaches the number to the same person', async () => {
  equal(await change.dir.phoned('+12695550141'), change.person)
  equal(await change.dir.phoned('+12695550140'), null)
})

let existing = await setup('existing', '+12695550142')
let unchanged = await existing.proof('269-555-0142')
await consentPhone(
  existing.env,
  existing.person,
  existing.space,
  '+12695550142',
)
test('someone already wearing a number keeps it and can consent without a new code', () => {
  equal(unchanged, null)
  equal(existing.sent.map((s) => s.text), [REPLIES.welcome])
})

let foreign = crypto.randomUUID()
await existing.dir.apply({
  entities: [{
    entity: { eid: foreign },
    person: {},
    phone: { number: '+12695550143' },
  }],
}, { 'x-yak-person': existing.person })
let sentBefore = existing.sent.length
await assertRejects(() => existing.proof('269-555-0143'))
test('a number held by another account receives no verification or welcome', () =>
  equal(existing.sent.length, sentBefore))

let scope = await setup('scope')
await scope.proof('269-555-0144')
let scopedCode = scope.code()
let store = meta(scope.env)
let unrelated = scopedCode == '000000' ? '000001' : '000000'
await lodge(store, scope.env.SESSION_SECRET!, '+12695550144', {
  code: unrelated,
  expires: new Date(Date.now() + LIFE).toISOString(),
})
await assertRejects(() => scope.proof('269-555-0144', unrelated!))
let other = crypto.randomUUID()
await scope.dir.apply({ entities: [{ entity: { eid: other }, person: {} }] }, {
  'x-yak-person': scope.person,
})
let borrowed = await spend(
  store,
  scope.env.SESSION_SECRET!,
  '+12695550144',
  scopedCode,
  { person: other, space: scope.space.eid },
)
let elsewhere = await spend(
  store,
  scope.env.SESSION_SECRET!,
  '+12695550144',
  scopedCode,
  { person: scope.person, space: crypto.randomUUID() },
)
await scope.proof('269-555-0144', scopedCode)
await scope.dir.apply({
  entities: [{ entity: { eid: scope.person }, phone: null }],
}, { 'x-yak-person': scope.person })
let replay = await spend(
  store,
  scope.env.SESSION_SECRET!,
  '+12695550144',
  scopedCode,
  { person: scope.person, space: scope.space.eid },
)
test('contact proof is bound to person and space, cannot use a login code, and is consumed once', () => {
  equal(borrowed, null)
  equal(elsewhere, null)
  equal(replay, null)
})

let expiry = await setup('expiry')
await expiry.proof('269-555-0145')
let expiredCode = expiry.code()
let [row] = await meta(expiry.env).query('.signin')
await meta(expiry.env).apply([{
  entity: row.entity,
  signin: { expires: new Date(Date.now() - LIFE).toISOString() },
}], { 'x-yak-kernel': '1' })
await assertRejects(() => expiry.proof('269-555-0145', expiredCode))
test('an expired texted code leaves the person without the proposed number', async () =>
  equal(await expiry.dir.phoneAt(expiry.person), null))

let race = await setup('race')
await race.proof('269-555-0146')
let raceCode = race.code(), rival = crypto.randomUUID()
await race.dir.apply({ entities: [{ entity: { eid: rival }, person: {} }] }, {
  'x-yak-person': race.person,
})
let rivalCode = await mint(
  meta(race.env),
  race.env.SESSION_SECRET!,
  '+12695550146',
  '',
  { person: rival, space: race.space.eid },
)
let results = await Promise.allSettled([
  spend(meta(race.env), race.env.SESSION_SECRET!, '+12695550146', raceCode, {
    person: race.person,
    space: race.space.eid,
  }),
  spend(meta(race.env), race.env.SESSION_SECRET!, '+12695550146', rivalCode!, {
    person: rival,
    space: race.space.eid,
  }),
])
test('simultaneous proven claims cannot give one number to two accounts', async () => {
  equal(results.filter((r) => r.status == 'fulfilled').length, 1)
  equal(
    (await meta(race.env).query('.person .phone.number="+12695550146"')).length,
    1,
  )
})

let route = crypto.randomUUID()
await existing.dir.apply({
  entities: [{
    entity: { eid: route },
    space: { slug: 'elsewhere', store: 'elsewhere' },
  }],
}, { 'x-yak-person': existing.person })
let destination = (await existing.dir.at(route))!
let source = crypto.randomUUID()
await consentPhone(
  existing.env,
  existing.person,
  destination,
  '+12695550142',
  source,
)
let [routed] = await meta(existing.env).query(
  `.entity.eid=${consentEid(existing.person)}`,
)
test('agreeing an existing number updates its chosen space and consent source without another welcome', () => {
  equal((routed.sms_consent as { space: string }).space, route)
  equal((routed.sms_consent as { source: string }).source, source)
  equal(existing.sent.length, sentBefore)
})

let exhausted = await setup('exhausted')
await exhausted.proof('269-555-0147')
let exhaustedCode = exhausted.code()
let incorrect = exhaustedCode == '000000' ? '000001' : '000000'
for (let i = 0; i < TRIES; i++) {
  await assertRejects(() => exhausted.proof('269-555-0147', incorrect))
}
await assertRejects(() => exhausted.proof('269-555-0147', exhaustedCode))
test('five wrong guesses exhaust a phone proof even when the correct digits arrive later', async () =>
  equal(await exhausted.dir.phoneAt(exhausted.person), null))
