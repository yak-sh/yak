import { test } from '@yaks/testing'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import type { Binding } from '@yaks/cloudflare-mail'
import type { Comp } from '@yaks/graph'
import type { Tool } from '@yaks/session'
import { parseHTML } from 'linkedom'
import { renderToString } from 'preact-render-to-string'
import { platform } from './directory-rows-probe.ts'
import { operatorMemory, operatorModel } from './operator-testing.ts'
import { operating, operatorContext } from './operator.ts'
import { confirmTextContact, contactAdd } from './operator-contacts.ts'
import { contactCard } from './operator-contact-card.ts'
import { alert, notificationSend } from './operator-alerts.ts'
import { notification } from './operator-updates.ts'
import { endpoints } from './endpoints.ts'
import { CONSENT } from './operator-texts.ts'
import { consentEid } from '@yaks/phone'
import { Unsent } from '@yaks/mail'
import { meta } from './meta.ts'
import { seenBy } from './operator-access.ts'

let setup = async (name: string, email?: string) => {
  let { env, dir } = platform('contacts-' + name)
  let person = crypto.randomUUID(),
    spaceId = crypto.randomUUID(),
    session = crypto.randomUUID()
  await dir.apply({
    entities: [
      {
        entity: { eid: person },
        person: {},
        ...(!email ? { newcomer: { at: new Date().toISOString() } } : {}),
        ...(email ? { email: { address: email } } : {}),
      },
      {
        entity: { eid: spaceId },
        space: { slug: 'contacts-' + name, store: 'contacts-' + name },
      },
      {
        entity: { eid: crypto.randomUUID() },
        member: { person, space: spaceId, role: 'owner' },
      },
    ],
  }, { 'x-yak-person': person })
  let space = (await dir.at(spaceId))!
  let store = operatorMemory()
  await store.g.apply([{
    entity: { eid: session },
    session: {},
    operator_session: { person, space: spaceId, conversation: true },
  }], { trusted: true })
  let held = { person, space: spaceId, role: 'owner' as const }
  let ctx = await operatorContext(env, held, space, () => dir)
  let letters: Parameters<Binding['send']>[0][] = []
  env.MAIL_VIA = 'binding'
  env.MAIL = {
    send: (letter) => {
      letters.push(letter)
      return Promise.resolve({ messageId: crypto.randomUUID() })
    },
  } satisfies Binding
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
  let entry = async (body: string, who = session) => {
    let eid = crypto.randomUUID()
    await store.g.apply([{
      entity: { eid },
      entry: { session: who },
      content: { body },
    }], { trusted: true })
    return eid
  }
  let add = contactAdd(env, ctx, space, store)
  let invoke = async (args: Record<string, unknown>) =>
    JSON.parse(String(await add.run(args)))
  let notify = async (words: string) => {
    let tool = notificationSend(ctx, space, store)
    let out = JSON.parse(
      String(
        await tool.run(
          { text: words },
          { session } as Parameters<Tool['run']>[1],
        ),
      ),
    )
    await alert(env, store, out.notification)
    return out
  }
  return {
    env,
    dir,
    person,
    space,
    session,
    store,
    ctx,
    held,
    letters,
    sent,
    entry,
    invoke,
    notify,
  }
}

let sms = await setup('sms', 'old@example.com')
let smsSource = await sms.entry(
  'Text me at 269-555-0142 when you finish the report.',
)
let proposal = await sms.invoke({ address: '269-555-0142', source: smsSource })
let repeated = await sms.invoke({ address: '269-555-0142', source: smsSource })
let old = notification({
  to: sms.person,
  words: 'Old backlog',
  by: sms.space.eid,
})
await sms.store.g.apply([{
  ...old,
  $actor: { by: sms.space.eid, via: sms.session },
  created: { at: '2026-01-01T00:00:00Z', by: sms.space.eid, via: sms.session },
}], { trusted: true, stamp: false })
let queued = await sms.notify('The report is finished.')
let before = {
  sent: sms.sent.length,
  letters: sms.letters.length,
  phone: await sms.dir.phoneAt(sms.person),
}
let form =
  parseHTML(renderToString(contactCard(JSON.stringify(proposal))!)).document
let mismatch = await assertRejects(() =>
  confirmTextContact(
    sms.env,
    sms.ctx,
    sms.space,
    sms.store,
    proposal.contact.id,
    '+12695550143',
    true,
  )
)
let unticked = await assertRejects(() =>
  confirmTextContact(
    sms.env,
    sms.ctx,
    sms.space,
    sms.store,
    proposal.contact.id,
    '+12695550142',
    false,
  )
)
await confirmTextContact(
  sms.env,
  sms.ctx,
  sms.space,
  sms.store,
  proposal.contact.id,
  '+12695550142',
  true,
)
let [consent] = await meta(sms.env).query(
  `.entity.eid=${consentEid(sms.person)}`,
)
let read = await sms.invoke({})
let smsAfter = [...sms.sent]
let [oldAfter] = await sms.store.g.get([old.entity.eid])

test('a contact proposal asks for optional SMS consent and waits before texting completion', () => {
  assertEquals(repeated.contact.id, proposal.contact.id)
  assertEquals(before, { sent: 0, letters: 0, phone: null })
  assertEquals(queued.reaches, 'pending contact confirmation')
  assertEquals(
    form.querySelector('[name=agreed]')!.hasAttribute('checked'),
    false,
  )
  assertEquals(
    form.querySelector('[name=number]')!.getAttribute('value'),
    '+12695550142',
  )
  assertStringIncludes(form.querySelector('form')!.textContent!, CONSENT)
  assertStringIncludes((mismatch as Error).message, 'missing')
  assertStringIncludes((unticked as Error).message, 'Tick the box')
  assertEquals(read.phone, '+12695550142')
  assertEquals(read.email, 'old@example.com')
  assertEquals((consent.sms_consent as Comp).source, proposal.contact.id)
  assertEquals((consent.sms_consent as Comp).consent, CONSENT)
  assertEquals(smsAfter.length, 2)
  assertStringIncludes(smsAfter[1].text, 'The report is finished.')
  assertEquals(oldAfter.delivered, undefined)
})

let nextSource = await sms.entry('Text me instead at 269-555-0143.')
let next = await sms.invoke({ address: '269-555-0143', source: nextSource })
let still = await sms.dir.texting(sms.person)
let foreign = await setup('foreign')
let denied = await assertRejects(() =>
  confirmTextContact(
    sms.env,
    foreign.ctx,
    sms.space,
    sms.store,
    next.contact.id,
    '+12695550143',
    true,
  )
)
await confirmTextContact(
  sms.env,
  sms.ctx,
  sms.space,
  sms.store,
  next.contact.id,
  '+12695550143',
  true,
)
let changed = await sms.dir.texting(sms.person)
test('another number needs new consent and another person cannot confirm it', () => {
  assertEquals(still!.number, '+12695550142')
  assertEquals(changed!.number, '+12695550143')
  assertStringIncludes((denied as Error).message, 'missing')
})

let guest = await setup('guest')
let guestOperator = operating(guest.store, guest.env, {
  directory: () => guest.dir,
  ...operatorModel((req) =>
    Promise.resolve({
      id: 'reply',
      model: req.model,
      items: [],
      cost: 0,
    })
  ),
})
let guestTools = await guestOperator.tools(guest.held, guest.space)
let request = await guest.entry('Email me at new@example.net when you finish.')
await guestTools.run('contact_add', {
  address: 'new@example.net',
  source: request,
})
let guestQueued = await guest.notify('Your work is ready.')
let emailBefore = await guest.dir.emailAt(guest.person)
let code = String(guest.letters[0].subject).match(/\d{6}/)![0]
let wrongSource = await guest.entry('000000')
await assertRejects(() =>
  guest.invoke({
    address: 'new@example.net',
    code: '000000',
    source: wrongSource,
  })
)
let injected = await assertRejects(() =>
  guest.invoke({ address: 'new@example.net', code, source: request })
)
let supplied = await guest.entry(code)
await guestTools.run('contact_add', {
  address: 'new@example.net',
  code,
  source: supplied,
})
let emailAfter = await guest.dir.emailAt(guest.person)
let contactPerson = await guest.dir.personAt('new@example.net')
let guestLetters = [...guest.letters]
test('an anonymous person verifies email in the same conversation before completion reaches it', () => {
  assertEquals(emailBefore, null)
  assertEquals(guestQueued.reaches, 'pending contact confirmation')
  assertStringIncludes((injected as Error).message, 'type the six-digit code')
  assertEquals(emailAfter, 'new@example.net')
  assertEquals(contactPerson, guest.person)
  assertEquals(guestLetters.length, 2)
  assertStringIncludes(String(guestLetters[1].text), 'Your work is ready.')
})

let expiry = await setup('expiry')
let expirySource = await expiry.entry('Email me at later@example.org.')
await expiry.invoke({ address: 'later@example.org', source: expirySource })
let expiryNote = await expiry.notify('The later job is ready.')
let [expired] = await expiry.store.g.read('.operator_contact')
await expiry.store.g.apply([{
  entity: expired.entity,
  operator_contact: { expires: '2020-01-01T00:00:00Z' },
}], { trusted: true })
await expiry.invoke({ address: 'later@example.org', source: expirySource })
let expiryCode = String(expiry.letters.at(-1)!.subject).match(/\d{6}/)![0]
let expiryInput = await expiry.entry(expiryCode)
await expiry.invoke({
  address: 'later@example.org',
  code: expiryCode,
  source: expiryInput,
})
let [expiredNow, delivered] = await expiry.store.g.get([
  expired.entity.eid,
  expiryNote.notification,
])
test('resending an expired email code keeps the request and delivers a completion held before the resend', () => {
  assertEquals(!!expiredNow.verified, true)
  assertEquals(!!delivered.delivered, true)
})

let hidden = await seenBy(sms.store.g, foreign.person).read('.operator_contact')
let foreignEntry = await foreign.entry('Email me at stolen@example.net')
let borrowed = await assertRejects(() =>
  sms.invoke({ address: 'stolen@example.net', source: foreignEntry })
)
test('contact proposals and consent sources stay with their person', () => {
  assertEquals(hidden, [])
  assertStringIncludes((borrowed as Error).message, 'own conversation')
})

let retry = await setup('retry')
let retrySource = await retry.entry('Email me at retry@example.org.')
let failing = contactAdd(
  retry.env,
  retry.ctx,
  retry.space,
  retry.store,
  () => Promise.reject(new Unsent('The mail transport is offline.', 0)),
)
await assertRejects(
  () =>
    Promise.resolve(
      failing.run({ address: 'retry@example.org', source: retrySource }),
    ),
  Unsent,
)
let [unsent] = await retry.store.g.read('.operator_contact')
let retryNote = await retry.notify('The retry job is ready.')
await retry.invoke({ address: 'retry@example.org', source: retrySource })
let retryCode = String(retry.letters[0].subject).match(/\d{6}/)![0]
let retryInput = await retry.entry(retryCode)
await retry.invoke({
  address: 'retry@example.org',
  code: retryCode,
  source: retryInput,
})
let [retryDelivered] = await retry.store.g.get([retryNote.notification])
test('a definitely unsent verification email can be retried immediately without losing held completion', () => {
  assertEquals((unsent.operator_contact as Comp).code, undefined)
  assertEquals((unsent.operator_contact as Comp).expires, undefined)
  assertEquals(!!retryDelivered.delivered, true)
})

let two = await setup('two-chats', 'prior@example.com')
let firstRequest = await two.entry('Email me at shared@example.net.')
await two.invoke({ address: 'shared@example.net', source: firstRequest })
let secondSession = crypto.randomUUID()
await two.store.g.apply([{
  entity: { eid: secondSession },
  session: {},
  operator_session: { person: two.person, space: two.space.eid },
}], { trusted: true })
let secondRequest = await two.entry(
  'Email me at shared@example.net when done here.',
  secondSession,
)
await two.invoke({ address: 'shared@example.net', source: secondRequest })
let secondNote = notification({
  to: two.person,
  words: 'Second conversation is finished.',
  by: two.space.eid,
})
await two.store.g.apply([{
  ...secondNote,
  $actor: { by: two.space.eid, via: secondSession },
}], { trusted: true })
await alert(two.env, two.store, secondNote.entity.eid)
let heldTwo = two.letters.length
let secondCode = String(two.letters[1].subject).match(/\d{6}/)![0]
let secondAnswer = await two.entry(secondCode, secondSession)
await two.invoke({
  address: 'shared@example.net',
  code: secondCode,
  source: secondAnswer,
})
let [secondDelivered] = await two.store.g.get([secondNote.entity.eid])
test('the same pending email in another conversation has its own confirmation and held completion', () => {
  assertEquals(heldTwo, 2)
  assertEquals(!!secondDelivered.delivered, true)
  assertEquals(two.letters.length, 3)
})
