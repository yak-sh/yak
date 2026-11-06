import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { Unsent } from '@yaks/host/senders'
import { Blocked, sender as configured } from '@yaks/phone'
import { heard, numbers, provider as telnyxProvider, telnyx } from './mod.ts'

let ANA = '+12695550142'
let OURS = '+12695550100'
let FREE = '+18885550100'

// Telnyx at its HTTP boundary: one profile, one number, and what was posted.
let posted: { path: string; body: Record<string, unknown> }[] = []
let refuse = ''
let telnyxAt = (input: RequestInfo | URL, init?: RequestInit) => {
  let url = new URL(String(input))
  let path = url.pathname.replace('/v2', '') + url.search
  if (path.startsWith('/messaging_profiles?')) {
    return Response.json({ data: [{ id: 'profile-1', name: 'yaks.app' }] })
  }
  if (path == '/messaging_profiles/profile-1/phone_numbers') {
    return Response.json({
      data: [{ phone_number: OURS }, { phone_number: FREE }],
    })
  }
  let body = JSON.parse(String(init?.body ?? '{}'))
  posted.push({ path, body })
  if (refuse) {
    return Response.json({ errors: [{ code: refuse, title: 'No' }] }, {
      status: refuse == '50000' ? 503 : 400,
    })
  }
  return Response.json({ data: { id: `msg-${posted.length}` } })
}
let fake: typeof fetch = (input, init) => Promise.resolve(telnyxAt(input, init))
let sender = telnyx({ key: 'k', profile: 'yaks.app', fetch: fake })

test("telnyx sends from its profile's number, as RCS with an SMS fallback when given an agent", async () => {
  posted.length = 0
  refuse = ''
  let sms = await sender.send({ to: ANA, text: 'Hi' })
  let rcs = await sender.send({ to: ANA, text: 'Hi', agent: 'agent-1' })
  assertEquals([sms, rcs], [{ id: 'msg-1' }, { id: 'msg-2' }])
  assertEquals(posted[0], {
    path: '/messages',
    body: { from: OURS, to: ANA, text: 'Hi' },
  })
  assertEquals(posted[1].path, '/messages/rcs')
  assertEquals(posted[1].body.agent_id, 'agent-1')
  assertEquals(posted[1].body.sms_fallback, { from: OURS, text: 'Hi' })
  posted.length = 0
  await telnyx({ key: 'k', profile: 'yaks.app', tollFree: true, fetch: fake })
    .send({ to: ANA, text: 'Hi' })
  assertEquals(posted[0].body.from, FREE)
})

test('a sender says the number people text to reach it', async () => {
  let free = telnyx({
    key: 'k',
    profile: 'yaks.app',
    tollFree: true,
    fetch: fake,
  })
  assertEquals(await free.from?.(), FREE)
  assertEquals(await sender.from?.(), OURS)
  let pinned = { via: 'telnyx', key: 'k', profile: 'yaks.app', number: ANA }
  assertEquals(await configured(pinned, telnyxProvider).from?.(), ANA)
})

test('telnyx refuses an unregistered number as Blocked, a 5xx as Unsent, else an error', async () => {
  for (
    let [code, kind] of [
      ['40010', Blocked],
      ['40300', Blocked],
      ['50000', Unsent],
      ['10002', Error],
    ] as const
  ) {
    refuse = code
    await assertRejects(() => sender.send({ to: ANA, text: 'Hi' }), kind)
  }
  refuse = ''
})

test('an RCS reply and a tapped suggestion read as texts that came as RCS', () => {
  let rcs = (body: unknown) =>
    heard({
      data: {
        event_type: 'message.received',
        payload: {
          id: 'r1',
          type: 'RCS',
          body,
          from: { phone_number: ANA },
          to: [{ agent_id: 'agent-1' }],
        },
      },
    }).arrival
  assertEquals(rcs({ text: 'Yes' })?.text, 'Yes')
  assertEquals(rcs({ text: 'Yes' })?.to, 'agent-1')
  assertEquals(rcs({ text: 'Yes' })?.rcs, true)
  assertEquals(
    rcs({ suggestion_response: { text: 'Publish it', postback_data: 'p' } })
      ?.text,
    'Publish it',
  )
})

test('a finalized failure names its code and whether a carrier blocked it', () => {
  let finalized = (code: string) =>
    heard({
      data: {
        event_type: 'message.finalized',
        payload: {
          id: 'm9',
          to: [{ phone_number: ANA, status: 'delivery_failed' }],
          errors: [{ code, title: 'Failed' }],
        },
      },
    }).outcome?.failed
  assertEquals(finalized('40010')?.blocked, true)
  assertEquals(finalized('40002')?.blocked, false)
})

// Telnyx's numbers at its HTTP boundary: two on offer, one held, and every
// call made, method and path.
let calls: string[] = []
let bodies: Record<string, unknown>[] = []
let shop: typeof fetch = (input, init) => {
  let url = new URL(String(input))
  let path = decodeURIComponent(url.pathname.replace('/v2', '') + url.search)
  calls.push(`${init?.method} ${path}`)
  if (init?.body) bodies.push(JSON.parse(String(init.body)))
  let cost = {
    upfront_cost: '1.00000',
    monthly_cost: '1.00000',
    currency: 'USD',
  }
  let at = url.pathname.replace('/v2', '')
  let answer = at == '/available_phone_numbers'
    ? {
      data: [FREE, '+18885550199'].map((phone_number) => ({
        phone_number,
        cost_information: cost,
        features: [{ name: 'sms' }, { name: 'voice' }],
      })),
    }
    : at == '/messaging_profiles'
    ? { data: [{ id: 'profile-1' }] }
    : at == '/number_orders'
    ? { data: { id: 'order-1', status: 'pending' } }
    : at == '/phone_numbers' && init?.method == 'GET'
    ? { data: [{ id: 'number-1' }] }
    : at.startsWith('/messaging_tollfree')
    ? {
      id: 'tfv-1',
      verificationStatus: init?.method == 'POST'
        ? 'In Progress'
        : 'Waiting For Customer',
      reason: init?.method == 'POST' ? null : 'Add an opt-in picture',
      phoneNumbers: [{ phoneNumber: FREE }],
    }
    : {}
  return Promise.resolve(Response.json(answer))
}

test('telnyx numbers find, buy onto the profile, release and verify', async () => {
  let n = numbers({ key: 'k', profile: 'yaks.app', fetch: shop })
  let church = {
    number: FREE,
    business: {
      name: 'Locust Grove Church',
      website: 'https://locustgrove.yaks.app',
      address: {
        street: '1 Main St',
        city: 'Sturgis',
        state: 'MI',
        zip: '49091',
      },
      entity: 'non_profit' as const,
      registration: { number: '12-3456789', type: 'EIN', country: 'US' },
    },
    contact: { first: 'Ann', last: 'Lee', email: 'ann@x.org', phone: ANA },
    useCase: 'Religious Services',
    summary: 'Service times and prayer requests to members who opted in.',
    sample: 'Locust Grove: Service is at 10am Sunday. Reply STOP to opt out.',
    volume: '1,000',
    optIn: 'Members sign up on a paper card.',
    optInImages: ['https://x.org/card.png'],
    reseller: 'yaks.app',
  }
  assertEquals(await n.find({ tollFree: true, number: FREE }), [{
    number: FREE,
    upfront: 1,
    monthly: 1,
    currency: 'USD',
    sms: true,
    voice: true,
  }])
  assertEquals(await n.buy(FREE), {
    number: FREE,
    order: 'order-1',
    status: 'pending',
  })
  await n.release(FREE)
  assertEquals(await n.verify(church), {
    id: 'tfv-1',
    number: FREE,
    status: 'pending',
    said: 'In Progress',
  })
  assertEquals(await n.verification('tfv-1'), {
    id: 'tfv-1',
    number: FREE,
    status: 'needed',
    said: 'Waiting For Customer',
    reason: 'Add an opt-in picture',
  })
  assertEquals(calls, [
    'GET /available_phone_numbers?filter[country_code]=US&filter[features][]=sms&filter[limit]=5&filter[phone_number_type]=toll_free&filter[phone_number][starts_with]=+18885550100',
    'GET /messaging_profiles?filter[name][eq]=yaks.app',
    'POST /number_orders',
    `GET /phone_numbers?filter[phone_number]=${FREE}`,
    'DELETE /phone_numbers/number-1',
    'POST /messaging_tollfree/verification/requests',
    'GET /messaging_tollfree/verification/requests/tfv-1',
  ])
  assertEquals(bodies[0], {
    phone_numbers: [{ phone_number: FREE }],
    messaging_profile_id: 'profile-1',
  })
  assertEquals(bodies[1], {
    businessName: 'Locust Grove Church',
    corporateWebsite: 'https://locustgrove.yaks.app',
    businessAddr1: '1 Main St',
    businessCity: 'Sturgis',
    businessState: 'MI',
    businessZip: '49091',
    entityType: 'NON_PROFIT',
    businessRegistrationNumber: '12-3456789',
    businessRegistrationType: 'EIN',
    businessRegistrationCountry: 'US',
    businessContactFirstName: 'Ann',
    businessContactLastName: 'Lee',
    businessContactEmail: 'ann@x.org',
    businessContactPhone: ANA,
    messageVolume: '1,000',
    phoneNumbers: [{ phoneNumber: FREE }],
    useCase: 'Religious Services',
    useCaseSummary:
      'Service times and prayer requests to members who opted in.',
    productionMessageContent:
      'Locust Grove: Service is at 10am Sunday. Reply STOP to opt out.',
    optInWorkflow: 'Members sign up on a paper card.',
    optInWorkflowImageURLs: [{ url: 'https://x.org/card.png' }],
    additionalInformation: '',
    isvReseller: 'yaks.app',
  })
})
