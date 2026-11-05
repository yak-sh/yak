import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { Unsent } from '@yaks/host/senders'
import { arrivalEid, Blocked, consentEid, Denied, phoneDoc } from '@yaks/phone'
import { effects } from '@yaks/phone/effects'
import { routes } from '@yaks/phone/routes'
import { faults } from '@yaks/api'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { docDoc } from '@yaks/doc'
import { mailDoc } from '@yaks/mail'
import { effects as pool } from '@yaks/effects'
import { heard, pinnacle, provider } from './mod.ts'

let FROM = '+12695550100', TO = '+12695550142'
let at = '2026-11-05T12:00:00Z'
let input = { to: TO, text: 'Tuesday works.' }
let posted: Request[] = []
let response = () => Response.json({ messageId: 'msg_1' })
let fake: typeof fetch = (url, init) => {
  posted.push(new Request(url, init))
  return Promise.resolve(response())
}
let sender = pinnacle({ key: 'test-key', number: FROM, fetch: fake })

test('Pinnacle SMS and RCS use documented requests and return phone receipts', async () => {
  posted.length = 0
  assertEquals(await sender.send(input), { id: 'msg_1', from: FROM })
  assertEquals(await sender.send({ ...input, agent: 'agent_ours' }), {
    id: 'msg_1',
    from: FROM,
  })
  assertEquals(posted.map((r) => new URL(r.url).pathname), [
    '/messages/send/sms',
    '/messages/send/rcs',
  ])
  assertEquals(posted[0].headers.get('PINNACLE-API-KEY'), 'test-key')
  assertEquals(await posted[0].json(), { from: FROM, ...input })
  assertEquals(await posted[1].json(), {
    ...input,
    from: 'agent_ours',
    fallback: { from: FROM, text: input.text },
  })
})

test('Pinnacle distinguishes rejected credentials, retryable sends and unexpected refusals', async () => {
  for (
    let [status, kind] of [
      [401, Denied],
      [403, Denied],
      [429, Unsent],
      [503, Unsent],
      [400, Error],
      [402, Error],
    ] as const
  ) {
    response = () => Response.json({ error: 'Refused' }, { status })
    let error = await assertRejects(() => sender.send(input), kind)
    assertEquals(error instanceof Blocked, false)
  }
  response = () => Response.json({ messageId: 'msg_1' })
  let offline = pinnacle({
    key: 'k',
    number: FROM,
    fetch: () => Promise.reject(new Error('offline')),
  })
  await assertRejects(() => offline.send(input), Unsent)
})

let event = (text: string, id = 'msg_in', extra = {}) => ({
  type: 'MESSAGE.RECEIVED',
  direction: 'INBOUND',
  status: 'RECEIVED',
  conversation: { id: 'conv_1', from: TO, to: FROM },
  sentAt: at,
  message: { type: 'SMS', id, text, ...extra },
})

test('Pinnacle normalizes SMS, MMS and RCS replies without exposing its conversation shape', () => {
  assertEquals(heard(event('Hi')).arrival, {
    id: 'msg_in',
    from: TO,
    to: FROM,
    text: 'Hi',
    at,
    rcs: false,
    media: [],
  })
  assertEquals(
    heard(
      event('', 'mms', {
        type: 'MMS',
        mediaUrls: ['https://files.example/photo.jpg'],
      }),
    ).arrival?.media,
    [{ url: 'https://files.example/photo.jpg', type: '' }],
  )
  assertEquals(
    heard(
      event('', 'rcs', {
        type: 'RCS_BUTTON_DATA',
        text: undefined,
        button: { raw: { title: 'Publish it', payload: 'publish' } },
      }),
    ).arrival?.text,
    'Publish it',
  )
  assertEquals(
    heard(event('Hi', 'rcs', { type: 'RCS_TEXT' })).arrival?.rcs,
    true,
  )
  assertEquals(heard({ ...event('Hi'), direction: 'OUTBOUND' }), {})
})

test('only terminal Pinnacle outcomes settle sends, and fallback updates name the original receipt', () => {
  let status = (status: string, extra = {}) =>
    heard({
      ...event('Hi'),
      type: 'MESSAGE.STATUS',
      direction: 'OUTBOUND',
      status,
      ...extra,
    })
  for (let state of ['QUEUED', 'PENDING', 'SENT', 'FALLBACK_SENT']) {
    assertEquals(status(state), {})
  }
  assertEquals(status('DELIVERED'), { outcome: { id: 'msg_in' } })
  assertEquals(
    status('DELIVERY_FAILED', { originalMessageId: 'msg_original' }).outcome,
    {
      id: 'msg_original',
      failed: {
        code: 'DELIVERY_FAILED',
        reason: 'Pinnacle reported DELIVERY_FAILED for a text.',
        blocked: false,
      },
    },
  )
})

let vocab = loadVocab([phoneDoc, docDoc, mailDoc])
let g = graph({ vocab, storage: ram(vocab) })
await g.apply([
  { entity: { eid: 'ana' }, phone: { number: TO } },
  {
    entity: { eid: consentEid('ana') },
    sms_consent: { person: 'ana', consent: 'Yes', at },
  },
  { entity: { eid: 'sent' }, text: { via: 'pinnacle', message_id: 'same' } },
  { entity: { eid: 'other' }, text: { via: 'telnyx', message_id: 'same' } },
])
let load = () => Promise.resolve({ provider })
let [door] = routes({ graph: g }, {
  door: { via: 'pinnacle', key: 'pss_test' },
}, load)
let request = (body: unknown, secret?: string) =>
  new Request('https://box.example/pinnacle/webhook', {
    method: 'POST',
    body: typeof body == 'string' ? body : JSON.stringify(body),
    headers: secret ? { 'PINNACLE-SIGNING-SECRET': secret } : {},
  })

test('Pinnacle authenticates before parsing, deduplicates inbound messages and shares consent handling', async () => {
  let reported: unknown[] = []
  let off = faults((e) => reported.push(e))
  try {
    assertEquals((await door.handle(request('not JSON'))).status, 400)
    assertEquals((await door.handle(request('not JSON', 'wrong'))).status, 400)
    assertEquals(reported.length, 1)
    for (let text of ['STOP', 'STOP']) {
      assertEquals(
        (await door.handle(request(event(text), 'pss_test'))).status,
        200,
      )
    }
    assertEquals((await g.read('.sms_consent')).length, 0)
    assertEquals(
      (await g.read('.text.via=pinnacle&.text.message_id=msg_in')).length,
      1,
    )
    let [row] = await g.get([arrivalEid('msg_in', 'pinnacle')])
    assertEquals(row.doc, { body: 'STOP' })
    await door.handle(request(event('START', 'msg_start'), 'pss_test'))
    assertEquals((await g.get([consentEid('ana')]))[0].sms_consent, {
      person: 'ana',
      consent: 'START',
      at,
    })
    await door.handle(
      request({
        ...event(''),
        type: 'MESSAGE.STATUS',
        direction: 'OUTBOUND',
        status: 'DELIVERY_FAILED',
        message: { id: 'same' },
      }, 'pss_test'),
    )
    assertEquals(!!(await g.get(['sent']))[0].bounced, true)
    assertEquals((await g.get(['other']))[0].bounced, undefined)
  } finally {
    off()
  }
})

let selected = graph({ vocab, storage: ram(vocab) })
let fx = pool(vocab, { write: (b) => selected.apply(b, { trusted: true }) })
selected.use(fx)
fx.handle(
  effects(null, {
    sender: { via: 'pinnacle', key: 'test', number: FROM, fetch: fake },
  }, load),
)
await selected.apply([
  { entity: { eid: 'ana' }, phone: { number: TO } },
  {
    entity: { eid: consentEid('ana') },
    sms_consent: { person: 'ana', consent: 'Yes', at },
  },
])

test('choosing Pinnacle by sender.via sends through the shared text effect and records its receipt', async () => {
  await selected.apply([{
    entity: { eid: 'outbound' },
    text: {},
    doc: { body: 'Hi' },
    deliver: { to: 'ana' },
  }])
  let [row] = await selected.get(['outbound'])
  assertEquals(row.text, {
    to: TO,
    from: FROM,
    message_id: 'msg_1',
    via: 'pinnacle',
  })
  assertEquals(!!row.delivered, true)
})
