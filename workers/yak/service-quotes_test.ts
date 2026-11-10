import { equal, test, throws } from '@yaks/testing'
import type { Paid, Quote } from '@yaks/host/payments'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { appVocab } from './vocab.ts'
import {
  checkedQuote,
  issueQuote,
  quotedOrder,
  quotedSale,
  readQuote,
} from './service-quotes.ts'
import type { Meta } from './meta.ts'

let now = Date.parse('2026-11-10T00:00:00Z')
let id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let quote: Quote = {
  id: id(1),
  buyer: id(2),
  source: id(3),
  seller: id(4),
  document: id(5),
  revision: 'a'.repeat(64),
  specification: 'paperback-letter',
  name: 'My book',
  quantity: 2,
  currency: 'usd',
  destination: {
    name: 'Ana',
    address: {
      line1: '1 Main St',
      city: 'Austin',
      postal_code: '78701',
      country: 'US',
    },
  },
  shipping: { id: 'ground', name: 'Ground', cents: 500 },
  subtotal: 2000,
  tax: 200,
  total: 2700,
  expires: '2026-11-10T01:00:00Z',
}
let who = { buyer: quote.buyer, source: quote.source, seller: quote.seller }
let vocab = appVocab()
let g = graph({ vocab, storage: ram(vocab) })
let store: Meta = {
  query: async (q) => await g.read(q),
  apply: async (bs) => await g.apply(bs, { trusted: true }),
}
await issueQuote(store, quote)

test('a physical quote binds the buyer, caller, document, destination and quantity', () => {
  equal(checkedQuote(quote, who, {}, now), quote)
  for (
    let changed of [
      { buyer: id(9) },
      { source: id(9) },
      { seller: id(9) },
    ]
  ) throws(() => checkedQuote(quote, { ...who, ...changed }, {}, now))
  for (
    let changed of [
      { quantity: 3 },
      { destination: { ...quote.destination, name: 'Someone else' } },
    ]
  ) throws(() => checkedQuote(quote, who, changed, now))
  throws(() => checkedQuote(quote, who, {}, now + 3600_000))
  throws(() => checkedQuote({ ...quote, total: 2600 }, who, {}, now))
})

test('a persisted quote retries unchanged and refuses a new price under its identity', async () => {
  equal(await readQuote(store, quote.id), quote)
  equal(await issueQuote(store, quote), quote)
  let caught = false
  try {
    await issueQuote(store, { ...quote, subtotal: 2200, total: 2900 })
  } catch {
    caught = true
  }
  equal(caught, true)
  equal((await readQuote(store, quote.id)).total, 2700)
})

let sale = quotedSale(quote, {
  space: id(6),
  app: 'printbound',
  bps: 250,
  done: 'https://seller/ok',
  cancel: 'https://seller/back',
})
let paid: Paid = {
  paid: true,
  status: 'paid',
  checkout: 'cs_quote',
  payment: 'pi_quote',
  total: quote.total,
  currency: quote.currency,
  email: 'ana@example.com',
  tags: sale.tags,
}

test('quoted checkout charges shipping and tax once, and its receipt points to the caller', () => {
  equal(
    sale.lines.reduce((n, l) => n + l.cents * l.qty, 0) + sale.shipping!.cents,
    quote.total,
  )
  equal(sale.fee, 67)
  equal(sale.destination, quote.destination)
  equal(sale.key, quote.id)
  let order = quotedOrder(quote, paid)
  equal([order.source, order.quote, order.document, order.revision], [
    quote.source,
    quote.id,
    quote.document,
    quote.revision,
  ])
  for (
    let changed of [
      { total: paid.total + 1 },
      { currency: 'eur' },
      { tags: { ...paid.tags, quote_hash: 'old' } },
    ]
  ) throws(() => quotedOrder(quote, { ...paid, ...changed }))
  equal(quotedOrder(quote, paid), order)
})
