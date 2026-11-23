// A refund made once, on the platform's own account or a seller's (`on`):
// its request key rides the refund's metadata as well as the idempotency
// header, so a request asked again after Stripe forgot the header still
// finds the refund it made.
import type { Refund, Refunded } from '@yaks/host/payments'
import { ask, idOf, type Keyed } from './mod.ts'

/** A refund read from Stripe's create response or its verified event. */
export let refundedOf = (o: Record<string, unknown>): Refunded => ({
  id: String(o.id ?? ''),
  payment: idOf(o.payment_intent as string | { id?: string }),
  amount: Number(o.amount ?? 0),
  status: o.status == 'succeeded'
    ? 'succeeded'
    : o.status == 'failed'
    ? 'failed'
    : o.status == 'canceled'
    ? 'canceled'
    : 'pending',
  tags: { ...(o.metadata as Record<string, string> ?? {}) },
})

// Stripe retains idempotency keys for a day. The refund's own metadata keeps
// recovery safe after that window, including a lost create response.
let priorRefund = async (
  options: Keyed,
  on: string | undefined,
  request: Refund,
) => {
  let after = ''
  for (;;) {
    let query = new URLSearchParams({
      payment_intent: request.payment,
      limit: '100',
      ...(after ? { starting_after: after } : {}),
    })
    let page = await ask(options, `/v1/refunds?${query}`, undefined, on)
    if (!Array.isArray(page.data) || typeof page.has_more != 'boolean') {
      throw new Error('stripe returned an invalid refund list')
    }
    let rows = page.data as Record<string, unknown>[]
    let old = rows.find((r) =>
      (r.metadata as Record<string, string>)?.request == request.key
    )
    if (old) {
      let refund = refundedOf(old)
      if (
        refund.amount != request.amount || refund.payment != request.payment
      ) throw new Error('stripe refund request identity was reused')
      return refund
    }
    if (!page.has_more) return null
    let next = String(rows?.at(-1)?.id ?? '')
    if (!next || next == after) {
      throw new Error('stripe refund list did not advance')
    }
    after = next
  }
}

/** Refund `request` on the account `on` (the platform's own where none),
 * returning the application fee in proportion where it says `fee`. Asked
 * again with the same key and request, it refunds nothing twice. */
export let refund = async (
  options: Keyed,
  on: string | undefined,
  request: Refund,
): Promise<Refunded> => {
  let old = await priorRefund(options, on, request)
  if (old) return old
  let made = refundedOf(
    await ask(
      options,
      '/v1/refunds',
      {
        payment_intent: request.payment,
        amount: request.amount,
        ...(request.fee ? { refund_application_fee: true } : {}),
        metadata: { ...request.tags, request: request.key },
      },
      on,
      'POST',
      request.key,
    ),
  )
  if (!made.id) throw new Error('stripe made a refund with no id')
  return made
}
