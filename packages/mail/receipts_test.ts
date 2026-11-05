import { equal, test } from '@yaks/testing'
import { receipts } from './receipts.ts'
let secret = 'whsec_' + btoa('a shared endpoint key for testing')
let at = 1_800_000_000
let letter = '21491aa7-e2c1-4631-8465-0414f7195261'
let body = JSON.stringify({
  type: 'email.sent',
  data: {
    email_id: 'provider-only',
    message_id: '<thread@example.com>',
    tags: { yak_letter: letter, yak_host: 'box' },
  },
})
let encoder = new TextEncoder()
let key = await crypto.subtle.importKey(
  'raw',
  encoder.encode('a shared endpoint key for testing'),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
)
let signed = async (raw = body, time = at) => {
  let signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`event-id.${time}.${raw}`),
  )
  return new Request('https://mail.example/mail/resend', {
    method: 'POST',
    body: raw,
    headers: {
      'svix-id': 'event-id',
      'svix-timestamp': String(time),
      'svix-signature': 'v1,' +
        btoa(String.fromCharCode(...new Uint8Array(signature))),
    },
  })
}

test('a receipt route retries an early delivery and updates the same letter once', async () => {
  let record: import('@yaks/graph').Bundle | undefined
  let writes = 0, reports: unknown[] = []
  let handle = receipts({
    graph: {
      get: () => Promise.resolve(record ? [record] : []),
      apply: (bundles) => {
        writes++
        record = {
          entity: { eid: letter },
          mail: { message_id: 'thread@example.com' },
        }
        return Promise.resolve(bundles)
      },
    },
    report: (error) => {
      reports.push(error)
    },
  }, { secret, tags: { yak_host: 'box' } })[0].handle
  let send = async () =>
    handle(await signed(body, Math.floor(Date.now() / 1000)))
  equal((await send()).status, 503)
  record = { entity: { eid: letter }, mail: { from: 'hello@example.com' } }
  equal((await send()).status, 200)
  equal((await send()).status, 200)
  equal(record.mail, { message_id: 'thread@example.com' })
  equal(writes, 1)
  equal(reports.length, 1)
})
