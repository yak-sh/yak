// Refunds are durable merchant requests; the effect may restart after its
// provider accepted a request but before its answer was recorded.
import type { Bundle } from '@yaks/graph'
import type { Refunded, Shops } from '@yaks/host/payments'
import type { Meta } from './meta.ts'
import { refuse } from './tool.ts'
import type { Stored } from './graph.ts'
import { shops } from './payments.ts'
import type { Handler } from '@yaks/effects'
import { caught } from './defects.ts'

export type RefundRow = Bundle & {
  refund_request: {
    order: string
    amount: number
    reason?: string
    status?: string
  }
  refund_sent?: { reference: string; amount: number }
  completed?: { at: string }
  refund_failed?: { at: string; reason: string }
}
export type SaleRow = Bundle & {
  order: {
    intent: string
    account: string
    total_cents: number
    fee_cents: number
    refunded_cents?: number
  }
  sale_access?: { buyer?: string | null; via?: string | null }
}
export type RefundAsk = {
  request: string
  order: string
  amount?: number
  reason?: string
}
let uuid = (s: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s)
let get = async <T extends Bundle>(
  store: Meta,
  id: string,
): Promise<T | undefined> =>
  (await store.query(`.entity.eid=${id}`))[0] as T | undefined

/** The merchant supplies the request identity, so replaying a failed service
 * call addresses the same refund, even after a process replacement. */
export let requestRefund = async (store: Meta, ask: RefundAsk, now: string) => {
  if (!uuid(ask.request) || !uuid(ask.order)) {
    throw refuse('refund', 'refund and order identities are required')
  }
  let old = await get<RefundRow>(store, ask.request)
  if (old) {
    if (
      old.refund_request?.order != ask.order ||
      (ask.amount != null && old.refund_request.amount != ask.amount) ||
      (old.refund_request.reason ?? '') != (ask.reason ?? '')
    ) {
      throw refuse(
        'refund',
        'a refund request cannot change; use a new identity',
      )
    }
    if (!old.completed && !old.refund_sent && !old.refund_failed) {
      await store.apply([{
        entity: { eid: ask.request },
        refund_retry: { at: now },
      }])
    }
    return ask.request
  }
  let sale = await get<SaleRow>(store, ask.order)
  if (!sale?.order?.intent || !sale.order.account) {
    throw refuse('refund', 'paid order not found')
  }
  let pending = await store.query(
    `.refund_request.order=${ask.order}`,
  ) as RefundRow[]
  let completed = pending.filter((r) => r.completed)
    .reduce((n, r) => n + r.refund_request.amount, 0)
  let reserved = pending.filter((r) => !r.completed && !r.refund_failed)
    .reduce((n, r) => n + r.refund_request.amount, 0)
  let remaining = sale.order.total_cents -
    Math.max(completed, sale.order.refunded_cents ?? 0) - reserved
  let amount = ask.amount ?? remaining
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > remaining) {
    throw refuse(
      'refund',
      'refund amount must be within the unrefunded payment',
    )
  }
  await store.apply([{
    entity: { eid: ask.request },
    refund_request: { order: ask.order, amount, reason: ask.reason ?? '' },
    sale_access: sale.sale_access ?? {},
    $was: { refund_request: { order: null } },
  }])
  return ask.request
}

/** A provider event and a restarted effect write the same result. Completion
 * wins over an older pending event. */
export let recordRefund = async (
  store: Meta,
  request: string,
  refund: Refunded,
  now: string,
  report: (error: Error) => void = (error) => {
    throw error
  },
): Promise<void> => {
  if (!uuid(request)) return
  let row = await get<RefundRow>(store, request)
  if (!row?.refund_request) return
  let sale = await get<SaleRow>(store, row.refund_request.order)
  if (
    sale?.order?.intent != refund.payment ||
    row.refund_request.amount != refund.amount
  ) {
    throw new Error('provider refund does not match its merchant request')
  }
  if (row.completed) return
  if (row.refund_sent && row.refund_sent.reference != refund.id) {
    throw new Error('refund identity changed')
  }
  if (refund.status == 'failed' || refund.status == 'canceled') {
    if (row.refund_failed?.reason == refund.status) return
    await store.apply([{
      entity: { eid: request },
      refund_sent: { reference: refund.id, amount: refund.amount },
      refund_failed: { at: now, reason: refund.status },
    }])
    report(new Error(`merchant refund ${refund.id} ${refund.status}`))
    return
  }
  await store.apply([{
    entity: { eid: request },
    refund_sent: { reference: refund.id, amount: refund.amount },
    ...(refund.status == 'succeeded'
      ? { completed: { at: now }, refund_failed: null }
      : {}),
  }])
}

export let recoverRefund = async (
  store: Meta,
  lent: Pick<Shops, 'refund'>,
  request: string,
  tags: Record<string, string>,
  now: string,
): Promise<void> => {
  let row = await get<RefundRow>(store, request)
  if (
    !row?.refund_request || row.completed || row.refund_sent ||
    row.refund_failed
  ) return
  let sale = await get<SaleRow>(store, row.refund_request.order)
  if (!sale?.order?.intent || !sale.order.account) {
    throw new Error('refund lost its paid order')
  }
  let refund = await lent.refund(sale.order.account, {
    key: request,
    payment: sale.order.intent,
    amount: row.refund_request.amount,
    fee: sale.order.fee_cents > 0,
    tags,
  })
  await recordRefund(store, request, refund, now)
}

/** The pool records and retries this work; every attempt uses the same
 * provider key. Its failures are also reported at this catch. */
export let refundSale =
  (at: Pick<Stored, 'graph' | 'app' | 'env'>): Handler => async (event) => {
    if (!at.app) return
    let { directoryOf } = await import('./directory.ts')
    if (!at.env.STORE) throw new Error('refund effect has no directory')
    let found = await directoryOf(at.env.STORE).appAt(at.app)
    if (!found) throw new Error('refund effect lost its merchant app')
    let store: Meta = {
      query: async (q) => await at.graph.read(q),
      apply: async (bs) => await at.graph.apply(bs, { trusted: true }),
    }
    try {
      await recoverRefund(store, await shops(at.env), event.entity.eid, {
        app: found.app.slug,
        space: found.space.eid,
      }, new Date().toISOString())
    } catch (error) {
      caught(error, { request: 'refund sale', app: at.app })
      throw error
    }
  }
