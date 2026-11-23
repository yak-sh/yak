/**
 * What the back office reads off a shop's rows, as pure functions: an order's
 * money, its lines, who bought it, what is left to refund, the other words its
 * entity carries, and the shop's customers as the people on its orders. The
 * rows are the platform's `product`, `order` and `refund_request`
 * (https://yaks.app/docs/selling.md).
 *
 * @module
 */
import { unpacked } from '@yaks/host/payments'

/** Cents as money, in the order's currency (USD when it names none). */
/// money(2800) -> '$28.00'
/// money(-150, 'usd') -> '-$1.50'
/// money(null) -> ''
export let money = (cents, currency = 'usd') =>
  cents == null ? '' : new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: String(currency || 'usd').toUpperCase(),
  }).format(cents / 100)

/** Money typed in a field as whole cents; null for nothing or not money. */
/// cents('12.5') -> 1250
/// cents('$1,200') -> 120000
/// cents('') -> null
/// cents('twelve') -> null
export let cents = (text) => {
  let plain = String(text ?? '').replace(/[$,\s]/g, '')
  if (!plain || !/^\d*(\.\d{0,2})?$/.test(plain)) return null
  return Math.round(Number(plain) * 100)
}

/** What has not been refunded of an order yet, in cents. */
/// left({ order: { total_cents: 5000, refunded_cents: 1200 } }) -> 3800
/// left({ order: { total_cents: 5000 } }) -> 5000
export let left = (row) =>
  Math.max(
    0,
    (row.order?.total_cents ?? 0) - (row.order?.refunded_cents ?? 0),
  )

/** Who bought an order: the key the customer is listed by, and their name. */
/// buyer({ order: { email: 'Ana@Example.com' } }) -> { key: 'ana@example.com', name: 'Ana@Example.com' }
/// buyer({ order: { buyer: { eid: 'u1', name: 'Ana' } } }) -> { key: 'u1', name: 'Ana' }
/// buyer({ order: {} }) -> { key: '', name: 'Somebody' }
export let buyer = (row) => {
  let o = row.order ?? {}
  let person = o.buyer && typeof o.buyer == 'object' ? o.buyer : null
  let key = o.email ? String(o.email).toLowerCase() : person?.eid ??
    (typeof o.buyer == 'string' ? o.buyer : '')
  return { key, name: o.email || person?.name || 'Somebody' }
}

/** The shop's customers: everyone on its orders, by email (or the person a
 * quote was for), with how many orders, what they spent and their newest
 * order, the biggest spender first. */
/// let sold = (email, total_cents, at, refunded_cents) => ({ order: { email, total_cents, refunded_cents }, created: { at } })
/// customers([sold('a@x', 100, '2026-11-01'), sold('A@x', 300, '2026-11-03', 50), sold('b@x', 900, '2026-11-02')]).map((c) => [c.key, c.orders, c.spent, c.last])
///   -> [['b@x', 1, 900, '2026-11-02'], ['a@x', 2, 350, '2026-11-03']]
export let customers = (rows) => {
  let by = new Map()
  for (let row of rows) {
    let { key, name } = buyer(row)
    if (!key) continue
    let c = by.get(key) ?? { key, name, orders: 0, spent: 0, last: '' }
    c.orders++
    c.spent += (row.order?.total_cents ?? 0) - (row.order?.refunded_cents ?? 0)
    let at = row.created?.at ?? ''
    if (at > c.last) c.last = at
    by.set(key, c)
  }
  return [...by.values()].sort((a, b) =>
    b.spent - a.spent || (a.key < b.key ? -1 : 1)
  )
}

/** An order's lines: the cart it was bought with, each named by its product
 * where the shop still has it, or a quoted document's quantity. */
/// lines({ order: { items: '[{"p":"0f8fad5bd9cb469fa16570867728950e","q":2,"o":"M"}]' } }, [{ entity: { eid: '0f8fad5b-d9cb-469f-a165-70867728950e' }, doc: { title: 'Tee' }, product: { price_cents: 2800 } }])
///   -> [{ name: 'Tee (M)', qty: 2, cents: 5600, product: '0f8fad5b-d9cb-469f-a165-70867728950e' }]
/// lines({ order: { quote: 'q1', quantity: 3, document: 'd1' } }, [])
///   -> [{ name: 'Printed document', qty: 3, cents: null, product: null }]
export let lines = (row, products = []) => {
  let o = row.order ?? {}
  let items = unpacked(o.items)
  if (!items.length && o.quote) {
    return [{
      name: 'Printed document',
      qty: o.quantity ?? 1,
      cents: null,
      product: null,
    }]
  }
  let by = new Map(products.map((p) => [p.entity.eid, p]))
  return items.map((i) => {
    let p = by.get(i.product)
    let name = p?.doc?.title || 'A product no longer listed'
    let price = p?.product?.price_cents
    return {
      name: i.options ? `${name} (${i.options})` : name,
      qty: i.qty,
      cents: price == null ? null : price * i.qty,
      product: i.product,
    }
  })
}

// What every row carries, and what the back office shows of an order itself.
let OWN = new Set([
  'entity',
  'doc',
  'order',
  'created',
  'updated',
  'alias',
  'tombstone',
])

/** The other words on an order's entity, with their declarations: what the
 * shop's own app keeps beside the sale (a print job's receipt, a shipping
 * note). Each is `{name, def, held}`; a word the store does not declare is
 * left out. */
/// others({ entity: { eid: 'o' }, order: {}, print_receipt: { status: 'SHIPPED' }, $was: {} }, { print_receipt: { properties: { status: { type: 'string' } } } })
///   -> [{ name: 'print_receipt', def: { properties: { status: { type: 'string' } } }, held: { status: 'SHIPPED' } }]
export let others = (row, defs = {}) =>
  Object.entries(row)
    .filter(([name, held]) =>
      !OWN.has(name) && !name.startsWith('$') && defs[name] &&
      held && typeof held == 'object'
    )
    .map(([name, held]) => ({ name, def: defs[name], held }))

/** The states an order's other words say, for its line in a list: each
 * word's `status` property, else the word itself when it is a mark that holds
 * nothing but when. */
/// states([{ name: 'print_receipt', def: { title: 'Print receipt' }, held: { status: 'SHIPPED' } }, { name: 'print_cancelled', def: { properties: { at: {} } }, held: { at: 'x' } }, { name: 'print_order', def: { properties: { quote: {} } }, held: { quote: 'q' } }])
///   -> ['Print receipt: SHIPPED', 'Print cancelled']
export let states = (words) =>
  words.flatMap(({ name, def, held }) => {
    let label = def.title || spoken(name)
    if (typeof held.status == 'string' && held.status) {
      return [`${label}: ${held.status}`]
    }
    let props = Object.keys(def.properties ?? {})
    return props.every((p) => p == 'at' || p == 'by' || p == 'via')
      ? [label]
      : []
  })

let spoken = (word) => {
  let text = word.replaceAll('_', ' ')
  return text[0].toUpperCase() + text.slice(1)
}

/** An order's status as a person reads it. */
/// said('partially_refunded') -> 'Partly refunded'
/// said(undefined) -> 'Paid'
export let said = (status) =>
  ({
    paid: 'Paid',
    partially_refunded: 'Partly refunded',
    refunded: 'Refunded',
    disputed: 'Disputed',
    lost: 'Lost to a dispute',
  })[status ?? 'paid'] ?? spoken(String(status))

/** The stores the page can run, from `./api/env`: each binding whose value is
 * a store's address (store_attach), `STORE` first. */
/// stores({ STORE: '/printbound/api/', KEY: 'yak_sentinel_x', SHOP: '/shop/api/' })
///   -> [['STORE', '/printbound/api/'], ['SHOP', '/shop/api/']]
export let stores = (env) =>
  Object.entries(env ?? {})
    .filter(([, v]) => typeof v == 'string' && /^\/[^/]+\/api\/$/.test(v))
    .sort(([a], [b]) => (b == 'STORE') - (a == 'STORE'))
