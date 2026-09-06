/// <reference lib="deno.ns" />
// The shop example's own seam (T-34517): `cart.js`, the part of a store that
// is logic rather than drawing.
//
// It is worth pinning for one reason above the others — NOTHING IN THE CART
// HOLDS A PRICE. The page posts `{product, qty, options}` to the platform's
// checkout door and the door reads `price_cents` off the row itself, because
// a price a page posts is a price the buyer can edit. A regression here would
// look like a helpful refactor.
//
// The whole app deployed and served is in serving_test.ts.
import { assert, assertEquals } from '@std/assert'
import { added, asked, dropped, money, shown, sizes } from './shop/cart.js'

let TEE = 'a1'
let LONG = 'a2'

let row = (eid: string, title: string, cents: number, said = 'S, M, L') => ({
  entity: { eid },
  doc: { title },
  product: { price_cents: cents, sizes: said, stock: 4, image: null },
})

let shelf = new Map([
  [TEE, row(TEE, 'Everyday Tee', 2800)],
  [LONG, row(LONG, 'Long Sleeve', 3600, '')],
])

Deno.test('the cart reads the sizes the seller wrote, in her order', () => {
  assertEquals(sizes(shelf.get(TEE)!), ['S', 'M', 'L'])
  // No sizes at all is no picker, not one empty option.
  assertEquals(sizes(shelf.get(LONG)!), [])
  assertEquals(sizes({ product: { sizes: ' XL ,, L ' } }), ['XL', 'L'])
})

Deno.test('a line is a product AND a size', () => {
  let cart = added([], { product: TEE, options: 'M' })
  cart = added(cart, { product: TEE, options: 'L' })
  // Two sizes of one shirt are two lines...
  assertEquals(cart.map((l: { options: string }) => l.options), ['M', 'L'])
  // ...and a second helping of one of them is a bigger count on that line.
  cart = added(cart, { product: TEE, options: 'M', qty: 2 })
  assertEquals(cart.length, 2)
  assertEquals(cart[0], { product: TEE, options: 'M', qty: 3 })
  // A count is at least one, whatever the number input said.
  assertEquals(
    added([], { product: LONG, qty: 0 })[0].qty,
    1,
  )
  assertEquals(added([], { product: LONG, qty: 2.6 })[0].qty, 3)
  // And the cart is never mutated: the page redraws from what came back.
  let one = added([], { product: TEE, options: 'S' })
  assertEquals(added(one, { product: TEE, options: 'S' })[0].qty, 2)
  assertEquals(one[0].qty, 1)
})

Deno.test('a line comes out by the pair that names it', () => {
  let cart = added(added([], { product: TEE, options: 'M' }), {
    product: TEE,
    options: 'L',
  })
  assertEquals(dropped(cart, { product: TEE, options: 'M' }), [{
    product: TEE,
    options: 'L',
    qty: 1,
  }])
  // The same product at another size is a different line and stays.
  assertEquals(dropped(cart, { product: LONG, options: '' }).length, 2)
})

Deno.test('what the checkout door is asked for carries no money', () => {
  let cart = added(added([], { product: TEE, options: 'M', qty: 2 }), {
    product: LONG,
  })
  let want = asked(cart)
  assertEquals(want, [{ product: TEE, qty: 2, options: 'M' }, {
    product: LONG,
    qty: 1,
  }])
  // Not `price`, not `amount`, not `cents`, under any spelling: the door
  // prices this out of the store.
  assertEquals(/price|amount|cent/.test(JSON.stringify(want)), false)
  // A sizeless product sends no empty `options` to be appended to its name.
  assert(!('options' in want[1]))
})

Deno.test('the cart draws what the shop still sells', () => {
  let cart = added(added([], { product: TEE, options: 'M', qty: 2 }), {
    product: LONG,
  })
  let { lines, total } = shown(cart, shelf)
  assertEquals(lines.map((l: { title: string }) => l.title), [
    'Everyday Tee (M)',
    'Long Sleeve',
  ])
  assertEquals(total, 2800 * 2 + 3600)
  // A shirt taken off the shelf while somebody held it is left out rather
  // than drawn: the door would refuse it, and showing it is a promise the
  // shop cannot keep.
  assertEquals(shown(cart, new Map([[LONG, shelf.get(LONG)!]])).total, 3600)
  assertEquals(money(2800), '$28.00')
  assertEquals(money(null), '$0.00')
})
