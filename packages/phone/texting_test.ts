import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import type { Bundle } from '@yaks/graph'
import { graph } from '@yaks/graph'
import { effects as registry } from '@yaks/effects'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc, docs } from '@yaks/doc'
import { mailDoc } from '@yaks/mail'
import { Unsent } from '@yaks/host/senders'
import {
  arrivalEid,
  Blocked,
  consentEid,
  phoneDoc,
  type Sender,
  stash,
} from './mod.ts'
import { heard, provider as telnyxProvider, telnyx } from '@yaks/telnyx'
import { effects } from './effects.ts'
import { sending } from './send.ts'
import { routes } from './routes.ts'
import { sender as configured } from './provider.ts'

let ana = '0b1c2d3e-0000-4000-8000-000000000001'
let ANA = '+12695550142'
let OURS = '+12695550100'
let FREE = '+18885550100'

// A graph that keeps texts and sends them through `sender`.
let rig = (sender?: Sender) => {
  let vocab = loadVocab([docDoc, mailDoc, phoneDoc])
  let fx = registry(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g = graph({ storage: ram(vocab), vocab, plugins: [fx, docs()] })
  fx.handle(sender ? { text_post: sending({ sender }) } : effects())
  return g
}
// One row, its components read as plain records.
let one = async (g: ReturnType<typeof rig>, eid: string) =>
  (await g.get([eid]))[0] as
    | Record<string, Record<string, unknown> | undefined>
    | undefined
let number = { entity: { eid: ana }, phone: { number: ANA } }
let agreed = {
  entity: { eid: consentEid(ana) },
  sms_consent: { person: ana, consent: 'Text me.', at: '2026-11-04T00:00:00Z' },
}
// Ana's number, and her agreement to be texted at it.
let person = [number, agreed]
let outbound = (eid: string): Bundle => ({
  entity: { eid },
  doc: { body: 'Your agenda is posted.' },
  text: {},
  deliver: { to: ana },
})

test('a text asking to go is sent to the number on its recipient and marked delivered', async () => {
  let texts = stash()
  let g = rig(texts)
  let eid = crypto.randomUUID()
  await g.apply([...person, outbound(eid)])
  let row = (await one(g, eid))!
  assertEquals(texts.sent, [{ to: ANA, text: 'Your agenda is posted.' }])
  assertEquals(row.text?.message_id, 'stash-1')
  assertEquals(!!row.delivered, true)
})

test('a text the carrier blocks is bounced with its reason and fails nothing', async () => {
  let g = rig(stash({ block: 'Not registered yet.' }))
  let eid = crypto.randomUUID()
  await g.apply([...person, outbound(eid)])
  assertEquals((await one(g, eid))?.bounced?.reason, 'Not registered yet.')
})

test('a text to someone who has not agreed is bounced and never handed over', async () => {
  let texts = stash()
  let g = rig(texts)
  let eid = crypto.randomUUID()
  await g.apply([number, outbound(eid)])
  assertEquals(texts.sent, [])
  assertEquals(
    (await one(g, eid))?.bounced?.reason,
    `${ana} has not agreed to texts: no sms_consent is kept for them`,
  )
})

test("a host's texter is used by name, and the number it chose is kept", async () => {
  let sent: unknown[] = []
  let texter: Sender = {
    send: (t) => (sent.push(t), Promise.resolve({ id: 'h-1', from: OURS })),
  }
  let vocab = loadVocab([docDoc, mailDoc, phoneDoc])
  let fx = registry(vocab, { write: (b) => g.apply(b, { trusted: true }) })
  let g = graph({ storage: ram(vocab), vocab, plugins: [fx, docs()] })
  fx.handle(
    effects({ texters: { worker: texter } }, { sender: { via: 'worker' } }),
  )
  let eid = crypto.randomUUID()
  await g.apply([...person, outbound(eid)])
  assertEquals(sent, [{ to: ANA, text: 'Your agenda is posted.' }])
  assertEquals((await one(g, eid))?.text, {
    to: ANA,
    from: OURS,
    message_id: 'h-1',
  })
})

test('a text with no sender configured waits with the reason', async () => {
  let g = rig()
  let eid = crypto.randomUUID()
  await Promise.resolve(g.apply([...person, outbound(eid)])).catch(() => {})
  assertEquals(
    (await one(g, eid))?.deliver?.waiting,
    'waiting for a configured sender',
  )
})

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

// Signed by a key of the test's own, standing in for Telnyx's.
let pair = await crypto.subtle.generateKey('Ed25519', true, [
  'sign',
  'verify',
]) as CryptoKeyPair
let b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))
let key = b64(await crypto.subtle.exportKey('raw', pair.publicKey))
let signed = async (event: unknown, sign = true) => {
  let body = JSON.stringify(event)
  let t = String(Math.floor(Date.now() / 1000))
  let signature = b64(
    await crypto.subtle.sign(
      'Ed25519',
      pair.privateKey,
      new TextEncoder().encode(`${t}|${body}`),
    ),
  )
  return new Request('https://box.example/telnyx/webhook', {
    method: 'POST',
    headers: sign
      ? { 'telnyx-timestamp': t, 'telnyx-signature-ed25519': signature }
      : {},
    body,
  })
}
let received = (id: string, text: string, payload = {}) => ({
  data: {
    event_type: 'message.received',
    payload: {
      id,
      type: 'SMS',
      text,
      from: { phone_number: ANA },
      to: [{ phone_number: OURS }],
      received_at: '2026-11-04T00:00:00Z',
      ...payload,
    },
  },
})

test('the door keeps a signed text, takes STOP as the end of consent and START as it again, and refuses an unsigned one', async () => {
  let g = rig(stash())
  await g.apply(person)
  let [door] = routes(
    { graph: g },
    { door: { key } },
    () => Promise.resolve({ provider: telnyxProvider }),
  )
  let unsigned = await door.handle(await signed(received('m0', 'hi'), false))
  let hi = await door.handle(await signed(received('m1', 'Post the agenda')))
  await door.handle(await signed(received('m2', 'STOP')))
  assertEquals([unsigned.status, hi.status], [400, 200])
  assertEquals(await one(g, arrivalEid('m0')), undefined)
  assertEquals((await one(g, arrivalEid('m1')))?.doc?.body, 'Post the agenda')
  assertEquals((await one(g, arrivalEid('m1')))?.text?.from, ANA)
  assertEquals((await g.read('.sms_consent')).length, 0)
  await door.handle(await signed(received('m3', 'start')))
  assertEquals(
    (await one(g, consentEid(ana)))?.sms_consent?.consent,
    'start',
  )
  assertEquals((await one(g, ana))?.phone, { number: ANA })
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
