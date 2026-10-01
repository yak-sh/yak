// Usage warnings through their pure decision and the hourly meter door.
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from '@std/assert'
import { type Usage, warning } from './usage-alert.ts'
import { GRAPHQL, sweep } from './usage.ts'
import { platform } from './testing.ts'
import { meta } from './meta.ts'

let at = (hour: number) =>
  new Date(`2026-09-28T${String(hour).padStart(2, '0')}:00:00Z`)
let usage = (hour: number, values: Partial<Usage> = {}): Usage => ({
  month: '2026-09',
  at: at(hour).toISOString(),
  requests: 0,
  rows_read: 0,
  duration: 0,
  ...values,
})

test('account warning rises once per threshold and rearms after a rate spike', () => {
  let first = warning(null, usage(10, { rows_read: 20e9 }), null)
  assertStringIncludes(
    first.body,
    '20,000,000,000 of 25,000,000,000 included (near)',
  )
  assertEquals(
    warning(
      usage(10, { rows_read: 20e9 }),
      usage(10, { rows_read: 20e9 }),
      first.next,
    ).body,
    '',
  )
  let over = warning(
    usage(10, { rows_read: 20e9 }),
    usage(11, { rows_read: 25e9 }),
    first.next,
  )
  assertStringIncludes(over.body, '(over)')
  assertStringIncludes(over.body, 'Recent rate projects')
  assertEquals(
    warning(usage(11), usage(12, { rows_read: 25e9 }), over.next).body,
    '',
  )
  let quiet = warning(usage(11), usage(12), over.next)
  assertEquals(quiet.next.rate, '')
  assertStringIncludes(
    warning(usage(12), usage(13, { rows_read: 2e9 }), quiet.next).body,
    'Recent rate projects',
  )
  assert(
    warning(null, { ...usage(1), month: '2026-10', rows_read: 20e9 }, over.next)
      .body,
  )
  let requests = warning(null, usage(10, { requests: 800_000 }), null)
  assertStringIncludes(requests.body, '800,000 raw')
  assertStringIncludes(requests.body, 'early-warning proxy')
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
    if (url == GRAPHQL) {
      return Promise.resolve(Response.json({
        data: {
          viewer: {
            accounts: [{
              durableObjectsInvocationsAdaptiveGroups: [],
              durableObjectsPeriodicGroups: [],
              accountInvocations: [{ sum: { requests: 100 } }],
              accountPeriodic: [{ sum: { rowsRead: total, duration: 100 } }],
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
    await assertRejects(() => sweep(p.env, at(10)), Error, 'mail failed')
    assertEquals(
      (await meta(p.env).query('.entity.eid=yak-meter'))[0].account_alert,
      undefined,
    )
    await sweep(p.env, at(10))
    await sweep(p.env, at(10))
    assertEquals(sent.length, 1)
    assertEquals(sent[0].to, ['task@bot.yak.sh', 'hello@yaks.app'])
    assertStringIncludes(sent[0].text, 'DO rows read')
    total = 25e9
    await sweep(p.env, at(11))
    assertEquals(sent.length, 2)
    let [row] = await meta(p.env).query('.entity.eid=yak-meter')
    assertEquals((row.account_alert as { rows_read: string }).rows_read, 'over')
  } finally {
    globalThis.fetch = was
  }
})
