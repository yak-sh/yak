// Usage warnings through their pure decision and the hourly meter door.
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { type Hour, type Usage, warning } from './usage-alert.ts'
import { API } from '@yaks/cloudflare/analytics'
import { sweep } from './usage.ts'
import { platform } from './testing.ts'
import { meta } from './meta.ts'

let at = (hour: number) =>
  new Date(`2026-09-28T${String(hour).padStart(2, '0')}:00:00Z`)
let counts = {
  requests: 0,
  rows_read: 0,
  rows_written: 0,
  duration: 0,
  workers: 0,
  cpu: 0,
}
let usage = (hour: number, values: Partial<Usage> = {}): Usage => ({
  month: '2026-09',
  at: at(hour).toISOString(),
  ...counts,
  ...values,
})
let hourly = (hour: number, values: Partial<Hour> = {}): Hour => ({
  since: at(hour - 2).toISOString(),
  until: at(hour - 1).toISOString(),
  ...counts,
  ...values,
})

test('account warning rises once per threshold and rearms after a rate spike', () => {
  let first = warning(usage(10, { rows_read: 20e9 }), hourly(10), null)
  assertStringIncludes(
    first.body,
    '20,000,000,000 of 25,000,000,000 included (near)',
  )
  assertEquals(
    warning(
      usage(10, { rows_read: 20e9 }),
      hourly(10),
      first.next,
    ).body,
    '',
  )
  let over = warning(
    usage(11, { rows_read: 25e9 }),
    hourly(11, { rows_read: 5e9 }),
    first.next,
  )
  assertStringIncludes(over.body, '(over)')
  assertStringIncludes(over.body, 'Recent rate projects')
  assertEquals(
    warning(
      usage(12, { rows_read: 25e9 }),
      hourly(12, { rows_read: 5e9 }),
      over.next,
    ).body,
    '',
  )
  let quiet = warning(usage(12), hourly(12), over.next)
  assertEquals(quiet.next.rate, '')
  assertStringIncludes(
    warning(usage(13), hourly(13, { rows_read: 2e9 }), quiet.next).body,
    'Recent rate projects',
  )
  assert(
    warning({ ...usage(1), month: '2026-10', rows_read: 20e9 }, null, over.next)
      .body,
  )
  let requests = warning(usage(10, { requests: 800_000 }), null, null)
  assertStringIncludes(requests.body, '800,000 raw')
  assertStringIncludes(requests.body, 'early-warning proxy')
})

test('a storm of rows written is a letter, priced a thousand times a row read', () => {
  let storm = warning(usage(11), hourly(11, { rows_written: 5e6 }), null)
  assertStringIncludes(storm.body, 'Recent rate projects up to $120/day')
  assertStringIncludes(
    storm.body,
    `hour from ${at(9).toISOString()} to ${at(10).toISOString()}`,
  )
  assertEquals(
    warning(usage(11), hourly(11, { rows_read: 5e6 }), null).body,
    '',
  )
  assertStringIncludes(
    warning(usage(10, { rows_written: 40e6 }), null, null).body,
    'DO rows written: 40,000,000 of 50,000,000 included (near)',
  )
  assertEquals(
    warning(usage(11, { rows_written: 30e6 }), null, null).body,
    '',
  )
})

test('a spike of visits through the Workers is a letter before it is money', () => {
  let near = warning(usage(10, { workers: 8_000_000 }), null, null)
  assertStringIncludes(near.body, 'Workers requests: 8,000,000 of 10,000,000')
  let spike = warning(
    usage(11, { workers: 12_000_000, cpu: 20_000_000 }),
    hourly(11, { workers: 4_000_000, cpu: 20_000_000 }),
    near.next,
  )
  assertStringIncludes(spike.body, 'Workers requests: 12,000,000')
  assertStringIncludes(spike.body, 'Recent rate projects up to $')
  assertEquals(
    warning(usage(11, { workers: 8_000_000 }), null, near.next).body,
    '',
  )
})

test('hourly account alert is mailed once and kept on the wake row', async () => {
  let p = platform('account usage alert', {
    CF_ACCOUNT: 'account',
    CF_ANALYTICS_TOKEN: 'read-only',
    MAIL_TOKEN: 'test',
    MAIL_API: 'https://mail.invalid',
  })
  await meta(p.env).query('.entity.eid=yak-meter')
  let sent: { to: string[]; text: string }[] = []
  let total = 20e9
  let fail = true
  let was = globalThis.fetch
  globalThis.fetch = (url, init) => {
    if (url == `${API}/graphql`) {
      let { variables } = JSON.parse(String(init?.body))
      let until = Date.parse(variables.until)
      assertEquals(Date.parse(variables.hourUntil), until - 3_600_000)
      assertEquals(Date.parse(variables.hourSince), until - 2 * 3_600_000)
      return Promise.resolve(Response.json({
        data: {
          viewer: {
            accounts: [{
              durableObjectsInvocationsAdaptiveGroups: [],
              durableObjectsPeriodicGroups: [],
              accountInvocations: [{ sum: { requests: 100 } }],
              accountPeriodic: [{ sum: { rowsRead: total, duration: 100 } }],
              hourInvocations: [{
                dimensions: { type: 'hibernation' },
                sum: { requests: 40e6 },
              }],
              hourPeriodic: [{ sum: { inboundWebsocketMsgCount: 20e6 } }],
              hourWorkers: [],
            }],
          },
        },
      }))
    }
    let letter = JSON.parse(String(init?.body))
    if (fail) {
      fail = false
      return Promise.resolve(new Response('mail unavailable', { status: 503 }))
    }
    sent.push(letter)
    return Promise.resolve(Response.json({ success: true }))
  }
  try {
    await assertRejects(
      () => sweep(p.env, at(10)),
      Error,
      'send failed (HTTP 503)',
    )
    assertEquals(
      (await meta(p.env).query('.entity.eid=yak-meter'))[0].account_alert,
      undefined,
    )
    await sweep(p.env, at(10))
    await sweep(p.env, at(10))
    assertEquals(sent.length, 1)
    assertEquals(sent[0].to, ['hello@yaks.app'])
    assertStringIncludes(sent[0].text, 'DO rows read')
    total = 25e9
    await sweep(p.env, at(11))
    assertEquals(sent.length, 2)
    let [row] = await meta(p.env).query('.entity.eid=yak-meter')
    assertEquals((row.account_alert as { rows_read: string }).rows_read, 'over')
    total = 20e9
    await sweep(p.env, at(12))
    total = 25e9
    await sweep(p.env, at(13))
    assertEquals(sent.length, 2)
    assert(
      sent.every((letter) => !letter.text.includes('Recent rate projects')),
    )
  } finally {
    globalThis.fetch = was
  }
})
