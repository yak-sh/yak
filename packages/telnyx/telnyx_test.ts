import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { Unsent } from '@yaks/host/senders'
import { Blocked, sender as configured } from '@yaks/phone'
import { heard, provider as telnyxProvider, telnyx } from './mod.ts'

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
