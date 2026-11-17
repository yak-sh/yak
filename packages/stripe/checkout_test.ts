import { equal, test } from '@yaks/testing'
import { stub } from '@std/testing/mock'
import { plans } from './plans.ts'

type Session = {
  id: string
  customer: string
  status: string
  mode: string
  client_reference_id: string
  metadata: Record<string, string>
  url: string
}
let checkout = {
  payer: 'cus_test',
  tier: 'plus',
  per: 'month' as const,
  done: 'https://yes',
  cancel: 'https://no',
  reference: 'space',
  tags: { space: 'space' },
}
let fixture = () => {
  let sessions: Session[] = []
  let keys = new Map<string, Session>()
  let fetch = stub(
    globalThis,
    'fetch',
    (url: string | URL | Request, init?: RequestInit) => {
      let at = new URL(String(url))
      if ((init?.method ?? 'GET') == 'GET') {
        let start = sessions.findIndex((session) =>
          session.id == at.searchParams.get('starting_after')
        ) + 1
        return Promise.resolve(
          Response.json({
            data: sessions.slice(start, start + 1),
            has_more: sessions.length > start + 1,
          }),
        )
      }
      if (at.pathname.endsWith('/expire')) {
        sessions.find((session) => at.pathname.includes(session.id))!.status =
          'expired'
        return Promise.resolve(Response.json({}))
      }
      let key = (init?.headers as Record<string, string>)['idempotency-key']
      let session = keys.get(key)
      if (!session) {
        let body = new URLSearchParams(String(init?.body))
        let id = `cs_${sessions.length}`
        session = {
          id,
          customer: body.get('customer')!,
          status: 'open',
          mode: body.get('mode')!,
          client_reference_id: body.get('client_reference_id')!,
          metadata: Object.fromEntries(
            [...body].filter(([key]) => key.startsWith('metadata[')).map((
              [key, value],
            ) => [key.slice(9, -1), value]),
          ),
          url: `https://checkout/${id}`,
        }
        keys.set(key, session)
        sessions.unshift(session)
      }
      return Promise.resolve(Response.json(session))
    },
  )
  let lent = plans({
    key: 'sk_test_probe',
    prices: { plus: { month: 'price_plus' }, pro: { month: 'price_pro' } },
  })
  return { lent, sessions, [Symbol.dispose]: () => fetch.restore() }
}

test('repeated plan checkout returns the one payable session', async () => {
  using f = fixture()
  let first = await f.lent.checkout(checkout)
  equal(await f.lent.checkout(checkout), first)
  equal(f.sessions.length, 1)
})

test('changing a checkout expires the earlier choice before opening another', async () => {
  using f = fixture()
  let first = await f.lent.checkout(checkout)
  let second = await f.lent.checkout({ ...checkout, tier: 'pro' })
  equal(first == second, false)
  equal(f.sessions.map((session) => session.status), ['open', 'expired'])
  equal(await f.lent.checkout({ ...checkout, tier: 'pro' }), second)
})

test('concurrent checkout requests create one session', async () => {
  using f = fixture()
  let urls = await Promise.all([
    f.lent.checkout(checkout),
    f.lent.checkout(checkout),
  ])
  equal(urls[0], urls[1])
  equal(f.sessions.length, 1)
})

test('a closed checkout permits a new attempt, and pagination preserves other purchases', async () => {
  using f = fixture()
  await f.lent.checkout(checkout)
  f.sessions[0].status = 'complete'
  let second = await f.lent.checkout(checkout)
  let purchase = { ...f.sessions[0], id: 'cs_credit', mode: 'payment' }
  let other = {
    ...f.sessions[0],
    id: 'cs_other',
    client_reference_id: 'another-space',
  }
  f.sessions.unshift(purchase, other)
  equal(await f.lent.checkout(checkout), second)
  equal([purchase.status, other.status], ['open', 'open'])
  equal(f.sessions.length, 4)
})
