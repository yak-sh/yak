// A seller's immutable document quote, persisted before any payment is asked.
import type { Paid, Quote, Sale } from '@yaks/host/payments'
import { sha256 } from '@yaks/graph/sha256'
import type { Meta } from './meta.ts'
import { refuse as refusal } from './tool.ts'

let refuse = (message: string): never => {
  throw refusal('quote', message)
}

export type Quoted = {
  entity: { eid: string }
  service_quote: { snapshot: string; hash: string }
}

let sorted = (value: unknown): unknown =>
  value && typeof value == 'object'
    ? Array.isArray(value) ? value.map(sorted) : Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, sorted(value)]),
    )
    : value

export let snapshot = (quote: Quote): string => JSON.stringify(sorted(quote))
export let quoteHash = (quote: Quote): string => sha256(snapshot(quote))
let cents = (n: number) => Number.isSafeInteger(n) && n >= 0
let eid = (s: string) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(s)

/** Checks the seller's complete quote, never a price posted by the buyer. */
export let validQuote = (q: Quote): Quote => {
  if (!q || ![q.id, q.buyer, q.source, q.seller, q.document].every(eid)) {
    refuse('a quote must identify its buyer, source, seller and document')
  }
  if (!q.name || !q.specification || !/^[0-9a-f]{64}$/i.test(q.revision)) {
    refuse('a quote must name the document revision and print specification')
  }
  if (!Number.isSafeInteger(q.quantity) || q.quantity < 1) {
    refuse('invalid quantity')
  }
  if (!/^[a-z]{3}$/.test(q.currency)) refuse('invalid quote currency')
  let a = q.destination?.address
  if (
    !q.destination?.name || !a?.line1 || !a.city || !a.postal_code ||
    !/^[A-Z]{2}$/.test(a.country)
  ) refuse('a verified delivery address is required')
  if (
    !q.shipping?.id || !q.shipping.name ||
    ![q.subtotal, q.shipping.cents, q.tax, q.total].every(cents) ||
    q.total <= 0 || q.total != q.subtotal + q.shipping.cents + q.tax
  ) {
    refuse('quote total must include its subtotal, shipping and tax')
  }
  if (!Number.isFinite(Date.parse(q.expires))) refuse('invalid quote expiry')
  return q
}

/** Called by trusted service code with its kernel store door. Reusing an id
 * with different facts fails; a retry with the same facts changes nothing. */
export let issueQuote = async (store: Meta, quote: Quote): Promise<Quote> => {
  validQuote(quote)
  let hash = quoteHash(quote)
  let [old] = await store.query(`.entity.eid=${quote.id}`) as Quoted[]
  if (old) {
    if (old.service_quote?.hash != hash) {
      refuse('a quote cannot be changed; issue a new quote')
    }
    return quote
  }
  await store.apply([{
    entity: { eid: quote.id },
    service_quote: { snapshot: snapshot(quote), hash },
    sale_access: { buyer: quote.buyer },
    $was: { service_quote: { hash: null } },
  }])
  return quote
}

export let readQuote = async (store: Meta, id: string): Promise<Quote> => {
  if (!eid(id)) refuse('invalid quote identity')
  let [row] = await store.query(`.entity.eid=${id}`) as Quoted[]
  if (!row?.service_quote) refuse('quote not found; request a new quote')
  let q = validQuote(JSON.parse(row.service_quote.snapshot))
  if (q.id != id || quoteHash(q) != row.service_quote.hash) {
    throw new Error('stored quote does not match its immutable snapshot')
  }
  return q
}

/** The caller may buy only the verified destination and quantity. Stripe's
 * hosted checkout requires at least thirty minutes remaining on its expiry. */
export let checkedQuote = (
  q: Quote,
  who: { buyer?: string | null; source?: string; seller: string },
  asked: { quantity?: unknown; destination?: unknown },
  now: number,
): Quote => {
  validQuote(q)
  if (
    q.buyer != who.buyer || q.source != who.source || q.seller != who.seller
  ) {
    refuse('this quote belongs to another buyer, source or seller')
  }
  let remaining = Date.parse(q.expires) - now
  if (remaining < 30 * 60_000 || remaining > 24 * 60 * 60_000) {
    refuse('quote expired or too close to expiry; request a new quote')
  }
  if (
    (asked.quantity != null && asked.quantity !== q.quantity) ||
    (asked.destination != null && JSON.stringify(sorted(asked.destination)) !=
        JSON.stringify(sorted(q.destination)))
  ) {
    refuse('destination or quantity changed; request a new quote')
  }
  return q
}

export let quotedSale = (
  q: Quote,
  at: {
    space: string
    app: string
    bps: number
    done: string
    cancel: string
    email?: string
  },
): Sale => ({
  key: q.id,
  lines: [
    { name: `${q.name} × ${q.quantity}`, cents: q.subtotal, qty: 1 },
    ...(q.tax ? [{ name: 'Tax', cents: q.tax, qty: 1 }] : []),
  ],
  currency: q.currency,
  fee: Math.min(q.total, Math.max(0, Math.floor(q.total * at.bps / 10_000))),
  destination: q.destination,
  shipping: { name: q.shipping.name, cents: q.shipping.cents },
  expires: q.expires,
  done: at.done,
  cancel: at.cancel,
  ...(at.email ? { email: at.email } : {}),
  tags: {
    space: at.space,
    app: at.app,
    fee: String(at.bps),
    quote: q.id,
    quote_hash: quoteHash(q),
    buyer: q.buyer,
    source: q.source,
  },
})

/** Paid events may be delivered after expiry: the provider already enforced
 * the checkout deadline. Amount and snapshot must still agree exactly. */
export let quotedOrder = (q: Quote, paid: Paid) => {
  if (
    paid.tags.quote != q.id || paid.tags.quote_hash != quoteHash(q) ||
    paid.total != q.total || paid.currency != q.currency
  ) {
    throw new Error(
      'paid checkout does not match its quoted document and total',
    )
  }
  return {
    quote: q.id,
    document: q.document,
    revision: q.revision,
    specification: q.specification,
    buyer: q.buyer,
    source: q.source,
    quantity: q.quantity,
    currency: q.currency,
    shipping_cents: q.shipping.cents,
    tax_cents: q.tax,
  }
}
