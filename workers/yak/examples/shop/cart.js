// The cart: a plain vocabulary over a list of lines, with no DOM in it, so
// the page below is only drawing and this is the part worth being sure of.
//
// A cart is this browser's alone until it is paid for — it is never written
// to the store. What the shop KNOWS lives in the store; what one visitor is
// still deciding lives here.

/** The sizes a product row offers, in the order the seller wrote them. */
export let sizes = (row) =>
  String(row.product?.sizes ?? '').split(',').map((s) => s.trim())
    .filter(Boolean)

/** Whole cents as money. */
export let money = (cents) => `$${((cents ?? 0) / 100).toFixed(2)}`

/**
 * One more of something, as a NEW cart. A line is a product and a size
 * together, so two sizes of one shirt are two lines and a second helping of
 * one of them is a bigger count on the line already there.
 *
 * Nothing here holds a price. The page shows one, off the row it drew; what
 * is bought at is read out of the store when the checkout door prices this.
 */
export let added = (cart, { product, options = '', qty = 1 }) => {
  let n = Math.max(1, Math.round(Number(qty) || 1))
  let had = cart.find((l) => l.product == product && l.options == options)
  return had
    ? cart.map((l) => (l == had ? { ...l, qty: l.qty + n } : l))
    : [...cart, { product, options, qty: n }]
}

/** A line taken out, by the pair that names it. */
export let dropped = (cart, { product, options = '' }) =>
  cart.filter((l) => !(l.product == product && l.options == options))

/**
 * What the checkout door is asked for: the products and how many, and the
 * size as `options`. The door reads the price off each `product` row itself,
 * which is why nothing about money is in this list — a price a page posts is
 * a price the buyer can edit.
 */
export let asked = (cart) =>
  cart.filter((l) => l.qty > 0).map((l) => ({
    product: l.product,
    qty: l.qty,
    ...(l.options ? { options: l.options } : {}),
  }))

/**
 * The cart as the page draws it: each line with the row it names and what it
 * comes to, and the total under them. A line whose product has gone off the
 * shelf is left out — the door would refuse it, and showing it is a promise
 * the shop cannot keep.
 */
export let shown = (cart, shelf) => {
  let lines = []
  for (let l of cart) {
    let row = shelf.get(l.product)
    if (!row) continue
    let cents = Number(row.product.price_cents ?? 0) * l.qty
    lines.push({
      ...l,
      row,
      cents,
      title: l.options ? `${row.doc.title} (${l.options})` : row.doc.title,
    })
  }
  return { lines, total: lines.reduce((n, l) => n + l.cents, 0) }
}
