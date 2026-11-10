import { equal, test } from '@yaks/testing'
import { type Bundle, graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import type { Refund, Refunded, Shops } from '@yaks/host/payments'
import { appVocab } from './vocab.ts'
import type { Meta } from './meta.ts'
import {
  recordRefund,
  recoverRefund,
  type RefundRow,
  requestRefund,
} from './service-refunds.ts'

let id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let now = '2026-11-10T01:00:00Z'
let fixture = async (n: number) => {
  let vocab = appVocab(), g = graph({ vocab, storage: ram(vocab) })
  let store: Meta = {
    query: async (q) => await g.read(q),
    apply: async (bs) => await g.apply(bs, { trusted: true }),
  }
  await store.apply([{
    entity: { eid: id(n) },
    order: {
      intent: `pi_${n}`,
      account: `acct_${n}`,
      total_cents: 2700,
      fee_cents: 67,
      status: 'paid',
    },
    sale_access: { buyer: id(900) },
  }])
  let received: Refund[] = [],
    results = new Map<string, Refunded>(),
    accounts: string[] = []
  let provider: Pick<Shops, 'refund'> = {
    refund: (account, ask) => {
      accounts.push(account)
      received.push(ask)
      if (!results.has(ask.key)) {
        results.set(ask.key, {
          id: `re_${results.size + 1}`,
          payment: ask.payment,
          amount: ask.amount,
          status: 'succeeded',
          tags: { ...ask.tags, request: ask.key },
        })
      }
      return Promise.resolve(results.get(ask.key)!)
    },
  }
  let row = async (n: number) =>
    (await store.query(`.entity.eid=${id(n)}`))[0] as RefundRow
  return { store, provider, received, results, accounts, row }
}
let partial = await fixture(1)
await requestRefund(partial.store, {
  request: id(11),
  order: id(1),
  amount: 500,
  reason: 'printing failed',
}, now)
let lost = await fixture(2)
await requestRefund(lost.store, { request: id(21), order: id(2) }, now)
let pending = await fixture(3)
await requestRefund(pending.store, {
  request: id(31),
  order: id(3),
  amount: 100,
}, now)
let reject = async (fn: () => Promise<unknown>) => {
  let error: unknown
  try {
    await fn()
  } catch (e) {
    error = e
  }
  equal(error instanceof Error, true)
}

test('a merchant refunds part then the remaining payment, keeping the original account', async () => {
  await recoverRefund(partial.store, partial.provider, id(11), {}, now)
  await recoverRefund(partial.store, partial.provider, id(11), {}, now)
  equal(partial.received.length, 1)
  equal(partial.accounts, ['acct_1'])
  equal(partial.received[0].fee, true)
  equal((await partial.row(11)).refund_request.status, 'refunded')
  await requestRefund(partial.store, { request: id(12), order: id(1) }, now)
  equal((await partial.row(12)).refund_request.amount, 2200)
  await recoverRefund(partial.store, partial.provider, id(12), {}, now)
  equal(partial.received.map((r) => r.amount), [500, 2200])
  await reject(() =>
    requestRefund(
      partial.store,
      { request: id(13), order: id(1), amount: 1 },
      now,
    )
  )
})

test('losing a local completion retries the same provider refund without returning money twice', async () => {
  let fail = true
  let store = {
    ...lost.store,
    apply: (bs: Bundle[]) => {
      if (fail && bs.some((b) => b.refund_sent)) {
        fail = false
        throw new Error('storage interrupted')
      }
      return lost.store.apply(bs)
    },
  }
  await reject(() => recoverRefund(store, lost.provider, id(21), {}, now))
  await recoverRefund(store, lost.provider, id(21), {}, now)
  equal(lost.received.map((r) => r.key), [id(21), id(21)])
  equal(lost.results.size, 1)
  equal((await lost.row(21)).refund_request.status, 'refunded')
  await requestRefund(lost.store, { request: id(21), order: id(2) }, now)
  await reject(() =>
    requestRefund(
      lost.store,
      { request: id(21), order: id(2), amount: 100 },
      now,
    )
  )
})

test('asynchronous refund events complete a pending request and older events cannot undo it', async () => {
  let refund: Refunded = {
    id: 're_pending',
    payment: 'pi_3',
    amount: 100,
    status: 'pending',
    tags: {},
  }
  await recordRefund(pending.store, id(31), refund, now)
  equal((await pending.row(31)).refund_request.status, 'processing')
  await recordRefund(
    pending.store,
    id(31),
    { ...refund, status: 'succeeded' },
    now,
  )
  await recordRefund(pending.store, id(31), refund, now)
  equal((await pending.row(31)).refund_request.status, 'refunded')
  await requestRefund(pending.store, {
    request: id(32),
    order: id(3),
    amount: 100,
  }, now)
  await reject(() =>
    recordRefund(pending.store, id(32), {
      ...refund,
      id: 're_failed',
      status: 'failed',
    }, now)
  )
  equal((await pending.row(32)).refund_request.status, 'failed')
})
