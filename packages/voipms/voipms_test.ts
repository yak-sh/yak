import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { Unsent } from '@yaks/host/senders'
import { Blocked, Denied } from '@yaks/phone'
import { voipms } from './mod.ts'

// An account whose API answers every call with `said`, keeping what it was
// asked.
let account = (said: () => Response) => {
  let asked: URLSearchParams[] = []
  let line = voipms({
    user: 'jeff@example.com',
    key: 'pw',
    fetch: (url) => {
      asked.push(new URL(String(url)).searchParams)
      return Promise.resolve(said())
    },
  })
  return { line, asked }
}
let answering = (body: object) => () => Response.json(body)
let DIDS = {
  status: 'success',
  sms: 1,
  mms: 2,
  dids: [
    { did: '2695550199', sms_enabled: '0' },
    { did: '2695550100', sms_enabled: '1' },
  ],
}

test('a text goes from the first number that texts, as SMS up to 160 characters and MMS past it', async () => {
  let { line, asked } = account(answering(DIDS))
  assertEquals(await line.send({ to: '+12695550142', text: 'Hi' }), { id: '1' })
  assertEquals(await line.send({ to: '+12695550142', text: 'x'.repeat(161) }), {
    id: '2',
  })
  assertEquals(
    asked.map((q) => [q.get('method'), q.get('did')]),
    [['getDIDsInfo', null], ['sendSMS', '2695550100'], [
      'sendMMS',
      '2695550100',
    ]],
  )
})

test("voip.ms's refusals are told apart: a limit is Blocked, a key it refuses Denied, a 5xx Unsent", async () => {
  for (
    let [said, error] of [
      [answering({ status: 'limit_reached' }), Blocked],
      [answering({ status: 'ip_not_enabled' }), Denied],
      [answering({ status: 'invalid_credentials' }), Denied],
      [() => new Response('', { status: 503 }), Unsent],
      [answering({ status: 'sms_failed', message: 'no' }), Error],
    ] as const
  ) {
    let { line } = account(said)
    await assertRejects(
      () => line.send({ to: '+12695550142', text: 'Hi', from: '+12695550100' }),
      error,
    )
  }
})
