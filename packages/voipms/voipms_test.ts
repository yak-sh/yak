import { test } from '@yaks/testing'
import { assertEquals, assertRejects } from '@std/assert'
import { Unsent } from '@yaks/host/senders'
import { Blocked, Denied } from '@yaks/phone'
import { numbers, voipms } from './mod.ts'

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

test('a number whose sub-account voip.ms will not make is given back', async () => {
  let asked: string[] = []
  let shop = numbers({
    user: 'u',
    key: 'k',
    fetch: (url) => {
      let method = new URL(String(url)).searchParams.get('method')!
      asked.push(method)
      return Promise.resolve(Response.json(
        method == 'createSubAccount'
          ? { status: 'invalid_callerid' }
          : { status: 'success', accounts: [] },
      ))
    },
  })
  await assertRejects(() => shop.buy('+12695550100'), Error, 'invalid_callerid')
  assertEquals(asked, [
    'getDIDsInfo',
    'orderDID',
    'createSubAccount',
    'getSubAccounts',
    'cancelDID',
  ])
})

test('buying a number already held on the sub-account made for it completes it, quoted at its month alone', async () => {
  let asked: string[] = []
  let said: Record<string, object> = {
    searchDIDsUSA: { dids: [] },
    getDIDsInfo: {
      dids: [{
        did: '2695550100',
        description: 'BATTLE CRK, MI',
        routing: 'account:100_y2695550100',
      }],
    },
    getDIDsUSA: {
      dids: [{
        did: '2695550199',
        perminute_setup: '0.40',
        perminute_monthly: '1.10',
      }],
    },
  }
  let shop = numbers({
    user: 'u',
    key: 'k',
    fetch: (url) => {
      let method = new URL(String(url)).searchParams.get('method')!
      asked.push(method)
      return Promise.resolve(
        Response.json({ status: 'success', ...said[method] }),
      )
    },
  })
  let [offer] = await shop.find({ number: '+12695550100' })
  assertEquals([offer.upfront, offer.monthly, offer.place], [
    0,
    1.1,
    'BATTLE CRK, MI',
  ])
  assertEquals((await shop.buy('+12695550100')).status, 'held')
  assertEquals(asked.includes('orderDID'), false)
})
