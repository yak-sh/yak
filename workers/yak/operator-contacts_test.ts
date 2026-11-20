import { line } from '@yaks/query'
import { clock, test } from '@yaks/testing'
import type { Clock } from '@yaks/fp'
import { drain } from './operator-store.ts'
import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import type { Binding } from '@yaks/cloudflare-mail'
import type { Comp } from '@yaks/graph'
import type { Tool } from '@yaks/session'
import { parseHTML } from 'linkedom'
import { renderToString } from 'preact-render-to-string'
import { platform } from './directory-rows-probe.ts'
import { chatted, operatorMemory, operatorModel } from './operator-testing.ts'
import { operating, operatorContext } from './operator.ts'
import { confirmTextContact, contactAdd } from './operator-contacts.ts'
import { contactCard } from './operator-contact-card.ts'
import { alert, notificationSend } from './operator-alerts.ts'
import { notification } from './operator-updates.ts'
import { endpoints } from './endpoints.ts'
import { CONSENT } from './operator-texts.ts'
import { handleChannels, letterFor } from './operator-channels.ts'
import { operatorPost } from './metered.ts'
import { consentEid } from '@yaks/phone'
import { meta } from './meta.ts'
import { mac, mint, spend } from './signin.ts'
import { contactBackfill } from './contact-move.ts'
import { seenBy } from './operator-access.ts'

let setup = async (name: string, email?: string, time?: Clock) => {
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
  let store = operatorMemory(undefined, time ? { clock: time } : {}, {
    operator: operatorPost(env),
  })
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
  let confirm = async (id: string, number: string) => {
    let pending = await confirmTextContact(
      env,
      ctx,
      space,
      store,
      id,
      number,
      true,
    )
    if ('pending' in pending) {
      let code = sent.at(-1)!.text.match(/\d{6}/)![0]
      return confirmTextContact(env, ctx, space, store, id, number, true, code)
    }
    return pending
  }
  let add = contactAdd(env, ctx, space, store)
  // A code's letter is the Operator's, sent by its store's pool.
  let invoke = async (args: Record<string, unknown>) => {
    let out = JSON.parse(String(await add.run(args)))
    await drain(store)
    return out
  }
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
  // Whether a notification reached them by email: the letter carrying it
  // went.
  let mailed = async (eid: string) => {
    await drain(store)
    let [letter] = await store.g.get([letterFor(eid)])
    return !!letter?.delivered
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
    confirm,
    notify,
    mailed,
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
await sms.confirm(proposal.contact.id, '+12695550142')
let [consent] = await meta(sms.env).query(
  line`.entity.eid=${consentEid(sms.person)}`,
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
  assertEquals(smsAfter.length, 3)
  assertStringIncludes(smsAfter[2].text, 'The report is finished.')
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
await sms.confirm(next.contact.id, '+12695550143')
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
await drain(guest.store)
let guestQueued = await guest.notify('Your work is ready.')
let emailBefore = await guest.dir.emailAt(guest.person)
let code = String(guest.letters[0].subject).match(/\d{6}/)![0]
let pendingProofs = await meta(guest.env).query('.signin')
let [pendingContact] = await guest.store.g.read('.operator_contact')
let isolated = await Promise.all([
  {},
  { person: crypto.randomUUID(), space: guest.space.eid },
  { person: guest.person, space: crypto.randomUUID() },
].map((scope) =>
  spend(
    meta(guest.env),
    guest.env.SESSION_SECRET!,
    'new@example.net',
    code,
    scope,
  )
))
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
  code,
  source: supplied,
})
let emailAfter = await guest.dir.emailAt(guest.person)
let contactPerson = await guest.dir.personAt('new@example.net')
let replayed = await Promise.all(
  [{}, { person: guest.person, space: guest.space.eid }]
    .map((scope) =>
      spend(
        meta(guest.env),
        guest.env.SESSION_SECRET!,
        'new@example.net',
        code,
        scope,
      )
    ),
)
let afterProofs = await meta(guest.env).query('.signin')
let guestMailed = await guest.mailed(guestQueued.notification)
let guestLetters = [...guest.letters]
test('an anonymous person verifies email in the same conversation before completion reaches it', () => {
  assertEquals(emailBefore, null)
  assertEquals(guestQueued.reaches, 'pending contact confirmation')
  assertStringIncludes((injected as Error).message, 'type the six-digit code')
  assertEquals(emailAfter, 'new@example.net')
  assertEquals(contactPerson, guest.person)
  assertEquals([guestMailed, guestLetters.length], [true, 2])
  assertStringIncludes(String(guestLetters[1].text), 'Your work is ready.')
  // The code comes from the Operator, at the space's own address, and the
  // alert invites a reply.
  assertEquals(guestLetters[0].from, {
    name: guest.space.operator,
    email: 'contacts-guest@yaks.app',
  })
  assertStringIncludes(String(guestLetters[1].text), 'Reply to this email')
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
let [expiredNow] = await expiry.store.g.get([expired.entity.eid])
let expiryMailed = await expiry.mailed(expiryNote.notification)
test('resending an expired email code keeps the request and delivers a completion held before the resend', () => {
  assertEquals(!!expiredNow.verified, true)
  assertEquals(expiryMailed, true)
})

let hidden = await seenBy(sms.store, foreign.person).read('.operator_contact')
let foreignEntry = await foreign.entry('Email me at stolen@example.net')
let borrowed = await assertRejects(() =>
  sms.invoke({ address: 'stolen@example.net', source: foreignEntry })
)
test('contact proposals and consent sources stay with their person', () => {
  assertEquals(hidden, [])
  assertStringIncludes((borrowed as Error).message, 'own conversation')
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
let secondMailed = await two.mailed(secondNote.entity.eid)
test('the same pending email in another conversation has its own confirmation and held completion', () => {
  assertEquals(heldTwo, 2)
  assertEquals(secondMailed, true)
  assertEquals(two.letters.length, 3)
})

let parallel = await setup('parallel', 'old-parallel@example.com')
let parallelSource = await parallel.entry(
  'Text me at 269-555-0144 when you finish.',
)
let parallelTurns = 0
let phoneRead = Promise.withResolvers<void>()
let notificationFinished = Promise.withResolvers<void>()
let parallelReceipt: { reaches?: string } = {}
parallel.store.g.use({
  name: 'contact-race-intake',
  hooks: {
    effect: (bundles) => {
      for (let row of bundles) {
        let body = (row.content as Comp | undefined)?.body
        if (
          row.result && typeof body == 'string' &&
          body.includes('"notification"')
        ) {
          parallelReceipt = JSON.parse(body)
          notificationFinished.resolve()
        }
      }
      return bundles
    },
  },
})
let parallelDirectory = {
  ...parallel.dir,
  phoned: async (number: string) => {
    await phoneRead.promise
    return parallel.dir.phoned(number)
  },
}
let parallelOperator = operating(parallel.store, parallel.env, {
  directory: () => parallelDirectory,
  ...operatorModel((req) =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      cost: 0,
      items: parallelTurns++ == 0
        ? [
          {
            kind: 'call',
            id: crypto.randomUUID(),
            name: 'contact_add',
            args: JSON.stringify({
              address: '269-555-0144',
              source: parallelSource,
            }),
          },
          {
            kind: 'call',
            id: crypto.randomUUID(),
            name: 'notification_send',
            args: JSON.stringify({
              subject: 'Report finished',
              text: 'The simultaneous report is ready.',
            }),
          },
        ]
        : [{
          kind: 'assistant',
          text: 'Your completion waits for the inline confirmation.',
        }],
    })
  ),
})
handleChannels(parallelOperator, parallel.env)
let parallelRunning = chatted(parallelOperator, parallel.held, parallel.space, {
  say: 'Text me at 269-555-0144 when you finish.',
})
await notificationFinished.promise
phoneRead.resolve()
await parallelRunning
let [parallelProposal] = await parallel.store.g.read('.operator_contact')
let [parallelNote] = await parallel.store.g.read('.notification')
let parallelBefore = {
  letters: parallel.letters.length,
  texts: parallel.sent.length,
}
await parallel.confirm(parallelProposal.entity.eid, '+12695550144')
let [parallelDelivered] = await parallel.store.g.get([parallelNote.entity.eid])
test('ordinary Operator tools called in parallel hold completion for the inline contact confirmation', () => {
  assertEquals(parallelReceipt.reaches, 'pending contact confirmation')
  assertEquals(parallelBefore, { letters: 0, texts: 0 })
  assertEquals(!!parallelDelivered.delivered, true)
  assertStringIncludes(
    parallel.sent.at(-1)!.text,
    'The simultaneous report is ready.',
  )
})

let failureTime = clock(Date.now())
let failureClock: Clock = {
  ...failureTime,
  after: (ms, work) => {
    if (ms > 0) return failureTime.after(ms, work)
    let pending = true
    queueMicrotask(() => {
      if (pending) work()
    })
    return () => {
      pending = false
    }
  },
}
let failedParallel = await setup(
  'refused-parallel',
  'unchanged@example.net',
  failureClock,
)
let failureTurns = 0
let failureOperator = operating(failedParallel.store, failedParallel.env, {
  directory: () => failedParallel.dir,
  ...operatorModel((req) =>
    Promise.resolve({
      id: crypto.randomUUID(),
      model: req.model,
      cost: 0,
      items: failureTurns++ == 0
        ? [
          {
            kind: 'call',
            id: crypto.randomUUID(),
            name: 'contact_add',
            args: JSON.stringify({
              address: 'not-an-address',
              source: 'no-entry',
            }),
          },
          {
            kind: 'call',
            id: crypto.randomUUID(),
            name: 'notification_send',
            args: JSON.stringify({
              subject: 'Check finished',
              text: 'The job with a refused contact is done.',
            }),
          },
        ]
        : [{
          kind: 'assistant',
          text: 'The new contact was refused; your old contact stays.',
        }],
    })
  ),
})
handleChannels(failureOperator, failedParallel.env)
await chatted(failureOperator, failedParallel.held, failedParallel.space, {
  say: 'Finish the check.',
})
await failureTime.advance(10)
await drain(failedParallel.store)
let [failureNote] = await failedParallel.store.g.read('.notification')
let failureMailed = await failedParallel.mailed(failureNote.entity.eid)
test('a refused parallel contact creation releases the existing notification effect to the unchanged contact', () => {
  assertEquals(failureMailed, true)
  assertEquals(failedParallel.letters.length, 1)
  assertStringIncludes(
    String(failedParallel.letters[0].text),
    'The job with a refused contact is done.',
  )
})

test('an email contact proof opens only its person and space, is consumed, and never signs in', () => {
  assertEquals(pendingProofs.length, 1)
  assertEquals((pendingProofs[0].signin as Comp).person, guest.person)
  assertEquals((pendingProofs[0].signin as Comp).space, guest.space.eid)
  assertEquals((pendingContact.operator_contact as Comp).code, undefined)
  assertEquals((pendingContact.operator_contact as Comp).tries, undefined)
  assertEquals(isolated, [null, null, null])
  assertEquals(replayed, [null, null])
  assertEquals(afterProofs, [])
})

let legacy = await setup('legacy-code')
let legacyAddress = 'legacy-contact@example.org'
let legacySource = await legacy.entry(`Email me at ${legacyAddress}.`)
let legacyCode = await mint(
  meta(legacy.env),
  legacy.env.SESSION_SECRET!,
  legacyAddress,
)
let legacyContact = crypto.randomUUID()
await legacy.store.g.apply([{
  entity: { eid: legacyContact },
  operator_contact: {
    person: legacy.person,
    address: legacyAddress,
    session: legacy.session,
    source: legacySource,
    request: legacySource,
    code: await mac(legacyAddress, legacyCode!, legacy.env.SESSION_SECRET!),
    expires: new Date(Date.now() + 600000).toISOString(),
    tries: 2,
  },
}], { trusted: true })
let [firstMove] = await Promise.all([
  contactBackfill(legacy.store, legacy.env),
  contactBackfill(legacy.store, legacy.env),
])
let secondMove = await contactBackfill(legacy.store, legacy.env)
let [movedProof] = await meta(legacy.env).query('.signin')
let [movedContact] = await legacy.store.g.get([legacyContact])
let legacyLogin = await spend(
  meta(legacy.env),
  legacy.env.SESSION_SECRET!,
  legacyAddress,
  legacyCode!,
)
let legacyInput = await legacy.entry(legacyCode!)
await legacy.invoke({
  address: legacyAddress,
  code: legacyCode,
  source: legacyInput,
})

test('older pending contact codes move to one scoped proof without losing the request or digits', async () => {
  assertEquals([firstMove, secondMove], [false, false])
  let moved = movedContact.operator_contact as Comp
  assertEquals(moved.code, undefined)
  assertEquals(moved.tries, undefined)
  assertEquals(moved.request, legacySource)
  assertEquals((movedProof.signin as Comp).tries, 2)
  assertEquals(legacyLogin, null)
  assertEquals(await legacy.dir.emailAt(legacy.person), legacyAddress)
  assertEquals(await meta(legacy.env).query('.signin'), [])
})
