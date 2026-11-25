import type { OneTimeInvoice, RecurringAddOn } from '@yaks/host/payments'
import { ask, found, type Keyed, list } from './mod.ts'

export let invoiceMethods = {
  payment_method_types: ['card', 'us_bank_account'],
}

let product = 'prod_yaks_support_contract'

export let addOnPrice = async (at: Keyed, item: RecurringAddOn) => {
  if (!await found(at, `/v1/products/${product}`)) {
    await ask(
      at,
      '/v1/products',
      { id: product, name: item.name },
      undefined,
      'POST',
      product,
    )
  }
  return {
    price_data: {
      product,
      currency: 'usd',
      recurring: { interval: 'year' },
      unit_amount: item.cents,
    },
    metadata: { yaks_add_on: item.key },
  }
}

type Bill = {
  id: string
  status: string
  metadata?: Record<string, string>
  lines?: { data: { metadata?: Record<string, string> }[] }
}

/** A draft holds the line before Stripe finalizes and sends it. Each step
 * can be replayed, including after Stripe has expired its idempotency keys. */
export let invoiceOnce = async (at: Keyed, item: OneTimeInvoice) => {
  let invoice: Bill | undefined
  for await (
    let bill of list<Bill>(at, '/v1/invoices', { customer: item.payer })
  ) {
    if (bill.metadata?.yaks_once == item.key) {
      invoice = bill
      break
    }
  }
  let key = `invoice-once|${item.key}`
  if (!invoice) {
    invoice = await ask(
      at,
      '/v1/invoices',
      {
        customer: item.payer,
        collection_method: 'send_invoice',
        days_until_due: item.due,
        auto_advance: false,
        pending_invoice_items_behavior: 'exclude',
        payment_settings: invoiceMethods,
        metadata: { ...item.tags, yaks_once: item.key },
      },
      undefined,
      'POST',
      key,
    ) as unknown as Bill
  }
  if (invoice.status == 'draft') {
    if (
      !invoice.lines?.data.some((line) => line.metadata?.yaks_once == item.key)
    ) {
      await ask(
        at,
        '/v1/invoiceitems',
        {
          customer: item.payer,
          invoice: invoice.id,
          amount: item.cents,
          currency: 'usd',
          description: item.name,
          metadata: { yaks_once: item.key },
        },
        undefined,
        'POST',
        `${key}|line`,
      )
    }
    await ask(
      at,
      `/v1/invoices/${invoice.id}/finalize`,
      {
        auto_advance: true,
      },
      undefined,
      'POST',
      `${key}|finalize`,
    )
  }
  return invoice.id
}
