// Selling, at its seams (sell.ts, T-34523): the fee arithmetic, the seller
// row a provider's account makes, the one word the page, the tool and the
// checkout door all read, and the cart priced and filed as an order. What the
// provider puts on its own wire is its package's (@yaks/stripe shops_test.ts).
import { test } from '@yaks/testing'
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import { moved } from './billing.ts'
import {
  backAt,
  backTo,
  cart,
  fee,
  feeOf,
  MARK,
  orderEid,
  orderOf,
  packed,
  priced,
  type Product,
  quoted,
  rate,
  receipt,
  sale,
  sellerOf,
  selling,
  unpacked,
} from './sell.ts'
import type { Paid } from '@yaks/host/payments'
import type { Space } from './directory.ts'
import { space as spaceOf } from './directory-fixture.ts'
import { page as drawn } from './site/mod.ts'

let space = (over: Partial<Space> = {}): Space =>
  spaceOf({
    eid: 'e-space',
    slug: 'ada',
    store: 'ada',
    title: 'Ada',
    tier: null,
    ...over,
  })

test('onboarding comes back to the space page', () => {
  assertEquals(backTo(space()), 'https://yaks.app/manage/ada/selling')
})

test('the fee is basis points, rounded down, and never the whole sale', () => {
  // No rate set is a rate of 0, and nothing is taken.
  assertEquals(fee(10_000, 0), 0)
  assertEquals(fee(1000, 250), 25)
  // Down, never up: the fee is never a cent more than the rate says.
  assertEquals(fee(999, 250), 24)
  assertEquals(fee(1, 250), 0)
  // Junk cannot make the platform take more than the sale, or take a negative.
  assertEquals(fee(1000, 1_000_000), 1000)
  assertEquals(fee(1000, -500), 0)
  assertEquals(fee(0, 250), 0)
})

test('the rate reads the way a person says it', () => {
  assertEquals(rate(0), '0%')
  assertEquals(rate(250), '2.5%')
  assertEquals(rate(1000), '10%')
})

// The rate is a setting on the platform's own space row (T-34554), so it is
// asked of `yak` and of no other space — a seller's row saying 500 would be a
// seller choosing what they pay us.
test('the fee is read off the platform’s own space row', async () => {
  let asked: string[] = []
  let dir = (fee: number | null) => ({
    space: (slug: string) => {
      asked.push(slug)
      return Promise.resolve(fee == null ? null : { fee } as Space)
    },
  })
  assertEquals(await feeOf(dir(250)), 250)
  assertEquals(asked, ['yak'])
  // Unset, and a directory with no platform row at all, both read as 0.
  assertEquals(await feeOf(dir(0)), 0)
  assertEquals(await feeOf(dir(null)), 0)
})

// The pricing page is a file. The live rate is spliced into its one marked
// element on the way out, and the number in the file is what a crawler reading
// the repo sees and what serves when the directory will not answer.
test('the pricing page is quoted the rate that is set', () => {
  let page = `<p>We take <span class="Fee">0%</span> of each sale.</p>`
  assertStringIncludes(quoted(page, 250), 'We take <span class="Fee">2.5%<')
  assertEquals(quoted(page, 0), page)
  // The mark is the span's class, whatever else the span carries.
  assertStringIncludes(
    quoted(`<span class="Fee" data-copy-slot="fee">0%</span>`, 250),
    `data-copy-slot="fee">2.5%</span>`,
  )
  // A page that lost its mark is served as it is, never mangled.
  assertEquals(
    quoted('<p>We take nothing.</p>', 250),
    '<p>We take nothing.</p>',
  )
  assertEquals(quoted(`<span class="Fee">0%`, 250), `<span class="Fee">0%`)
  // And the page itself carries the mark, or the splice would quietly do
  // nothing on the page it exists for.
  assertStringIncludes(drawn('pricing.html'), MARK)
})

let seller = (ready: boolean, submitted: boolean) =>
  sellerOf({ account: 'acct_1', ready, submitted })

test('the seller row names the provider config.ts lends', () => {
  assertEquals(seller(true, true), {
    via: 'stripe',
    account: 'acct_1',
    ready: true,
    submitted: true,
  })
})

test('a redelivered account.updated moves no property at all', () => {
  let now = space({ seller: seller(true, true) }).seller
  assertEquals(moved(now, seller(true, true)), {})
  assertEquals(moved(now, seller(false, true)), { ready: false })
  assertEquals(moved(space().seller, seller(true, true)), seller(true, true))
})

test('ready is charges_enabled and nothing else', () => {
  let at = (s: ReturnType<typeof seller> | null) =>
    selling(space({ seller: s }))
  assertEquals(at(null), 'none')
  assertEquals(at(seller(false, false)), 'setup')
  // The form is finished and Stripe is still verifying: not ready. Taking a
  // customer's money in that window is a payment that fails at the till.
  assertEquals(at(seller(false, true)), 'setup')
  assertEquals(at(seller(true, true)), 'ready')
})

// ---- the checkout door's seams (T-34525) -----------------------------------

let TEE = '11111111-1111-4111-8111-111111111111'
let MUG = '22222222-2222-4222-8222-222222222222'
let FREE = '33333333-3333-4333-8333-333333333333'

let shelf: Product[] = [
  {
    entity: { eid: TEE },
    doc: { title: 'Everyday Tee' },
    product: { price_cents: 2800 },
  },
  {
    entity: { eid: MUG },
    doc: { title: 'Mug' },
    product: { price_cents: 1250 },
  },
  { entity: { eid: FREE }, doc: { title: 'Sticker' }, product: {} },
]
// The cart priced off the shelf, for a provider whose tags take 500
// characters, as Stripe's metadata values do.
let TAG = 500
let price = (items: Parameters<typeof priced>[1]) => priced(shelf, items, TAG)

test('a cart is read off the wire, or refused in words', () => {
  assertEquals(cart({ items: [{ product: TEE, qty: '2', options: ' M ' }] }), [
    { product: TEE, qty: 2, options: 'M' },
  ])
  // `options` is left out when there is none, rather than sent empty.
  assertEquals(cart({ items: [{ product: TEE }] }), [{ product: TEE, qty: 1 }])
  for (
    let [body, says] of [
      [{}, 'items'],
      [{ items: [] }, 'items'],
      [{ items: [{ qty: 1 }] }, 'name a product'],
      [{ items: [{ product: TEE, qty: 0 }] }, 'at least one'],
      [{ items: [{ product: TEE, qty: -3 }] }, 'at least one'],
    ] as [unknown, string][]
  ) {
    assertThrows(() => cart(body), Error, says)
  }
})

test('the cart is priced off the store, never off the wire', () => {
  let out = price([
    { product: TEE, qty: 2, options: 'M' },
    { product: MUG, qty: 1 },
  ])
  // The variant appended to the name the buyer reads on the checkout page.
  assertEquals(out.lines, [
    { name: 'Everyday Tee (M)', cents: 2800, qty: 2 },
    { name: 'Mug', cents: 1250, qty: 1 },
  ])
  assertEquals(out.total, 2800 * 2 + 1250)
})

test('a product this app has not got, or has not priced, is refused', () => {
  // An eid off another app, or one somebody made up.
  assertThrows(
    () => price([{ product: MUG.replace('2', '9'), qty: 1 }]),
    Error,
    'no product',
  )
  // A row the seller has not finished. Free is not a price.
  assertThrows(
    () => price([{ product: FREE, qty: 1 }]),
    Error,
    'Sticker has no price',
  )
})

// The items ride one tag and the provider's tags take so many characters, so
// the door says how many lines fit rather than handing the provider something
// it will cut in half.
test('a cart too big for one metadata value is refused by size', () => {
  let many = Array.from({ length: 40 }, () => ({ product: TEE, qty: 1 }))
  assert(packed(many).length > TAG)
  assertThrows(() => price(many), Error, 'too many different things')
  // And a cart that fits is not.
  let few = Array.from({ length: 5 }, () => ({ product: TEE, qty: 1 }))
  assert(packed(few).length <= TAG)
  assertEquals(price(few).lines.length, 5)
})

test('the packed items keep the product, the count and the variant', () => {
  assertEquals(
    packed([{ product: TEE, qty: 2, options: 'M' }, { product: MUG, qty: 1 }]),
    '[{"p":"11111111111141118111111111111111","q":2,"o":"M"},' +
      '{"p":"22222222222242228222222222222222","q":1}]',
  )
})

// The buyer comes back inside the app, always. This door is callable by a guest
// on an open app, so an absolute URL off the wire would let a stranger have
// yaks.app's own checkout hand buyers to a page they wrote.
test('success and cancel resolve inside the app, and never outside it', () => {
  let root = 'https://ada.yaks.app/shop/'
  assertEquals(backAt(root, undefined), root)
  assertEquals(backAt(root, ''), root)
  assertEquals(
    backAt(root, '?ordered=1'),
    'https://ada.yaks.app/shop/?ordered=1',
  )
  assertEquals(backAt(root, 'thanks'), 'https://ada.yaks.app/shop/thanks')
  for (
    let away of [
      'https://evil.example/',
      '//evil.example/',
      'https://ada.yaks.app/other/',
      '/',
      '../',
    ]
  ) {
    assertThrows(() => backAt(root, away), Error, 'stay inside this app', away)
  }
})

let asked = {
  space: 'e-space',
  app: 'shop',
  lines: [{ name: 'Tee', cents: 10_000, qty: 1 }],
  total: 10_000,
  packed: '[{"p":"x","q":1}]',
  bps: 0,
  success: 'https://ada.yaks.app/shop/?ok',
  cancel: 'https://ada.yaks.app/shop/',
}

test('a sale carries the cart, the fee and the rate it was charged at', () => {
  let made = sale({ ...asked, email: 'ana@example.com' })
  assertEquals(made, {
    lines: asked.lines,
    currency: 'usd',
    fee: 0,
    email: 'ana@example.com',
    done: asked.success,
    cancel: asked.cancel,
    // The two words the webhook routes by, the cart, and the rate this sale
    // was charged at, so the order the webhook files minutes later says what
    // was taken rather than what is set by then.
    tags: { space: 'e-space', app: 'shop', items: asked.packed, fee: '0' },
  })
  // No address given is none at all, so the checkout asks for one.
  assertEquals('email' in sale(asked), false)
  let charged = sale({ ...asked, bps: 250 })
  assertEquals([charged.fee, charged.tags.fee], [250, '250'])
})

// A completed checkout, as the provider reads one.
let sess: Paid = {
  paid: true,
  status: 'paid',
  checkout: 'cs_test_1',
  payment: 'pi_1',
  total: 6850,
  email: 'ana@example.com',
  tags: { space: 'e-space', app: 'shop', items: '[{"p":"x","q":1}]' },
}

// The rate is a setting (T-34554), so it can move between the checkout and the
// event that files the order. What the order records is what was taken, which
// is the rate the session carries and never the rate in force now.
test('an order is charged the rate its session carried', () => {
  let paid = (tags: Record<string, string>) =>
    orderOf({ ...sess, total: 10_000, tags }, 'acct_1').fee_cents
  assertEquals(paid({ fee: '250' }), 250)
  assertEquals(paid({ fee: '0' }), 0)
  // A session made before the rate was a property carries none, and those sales
  // were charged nothing.
  assertEquals(paid({}), 0)
  // Junk in the metadata takes nothing, rather than NaN cents.
  assertEquals(paid({ fee: 'lots' }), 0)
})

// ---- the order the webhook writes (T-34526) --------------------------------

// The idempotence, and it is the whole of it: the order's entity is derived
// from Stripe's session id, so a second delivery of `checkout.session.completed`
// addresses the row the first one wrote instead of minting a second order.
// There is no remembered-event list to keep correct.
test('an order is written at an eid derived from its session', () => {
  assertEquals(orderEid('cs_test_1'), orderEid('cs_test_1'))
  assert(orderEid('cs_test_1') != orderEid('cs_test_2'))
  // Shaped as a uuid, because that is what a store's eids are — version 8,
  // the one reserved for an id derived from a name rather than drawn at
  // random, which is exactly what this is (src/edge.ts `edgeEid` again).
  assertMatch(
    orderEid('cs_test_1'),
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
})

test('the cart survives the round trip through Stripe metadata', () => {
  let items = [
    { product: TEE, qty: 2, options: 'M' },
    { product: MUG, qty: 1 },
  ]
  assertEquals(unpacked(packed(items)), items)
  // Junk is an empty cart, never a throw: an order whose label cannot be read
  // is still an order somebody paid for, and losing the money over the label
  // would be the worse mistake.
  for (let bad of ['', 'not json', '{}', 'null', undefined]) {
    assertEquals(unpacked(bad), [])
  }
})

test('the order row is what one completed checkout says', () => {
  assertEquals(orderOf(sess, 'acct_seller'), {
    session: 'cs_test_1',
    intent: 'pi_1',
    account: 'acct_seller',
    items: '[{"p":"x","q":1}]',
    total_cents: 6850,
    fee_cents: 0,
    email: 'ana@example.com',
    status: 'paid',
  })
})

// A redelivery derives the identical row, so `moved` finds nothing and the
// store is never written to at all.
test('the same completed session twice moves no property', () => {
  let one = orderOf(sess, 'acct_seller')
  assertEquals(moved(one, orderOf(sess, 'acct_seller')), {})
  assertEquals(moved(one, { ...one, status: 'refunded' }), {
    status: 'refunded',
  })
})

test('the buyer is told what they bought and what it cost', () => {
  let letter = receipt(
    'The Shop',
    orderOf(sess, 'acct_seller'),
    [{ product: TEE, qty: 2, options: 'M' }, { product: MUG, qty: 1 }],
    (p) => (p == TEE ? 'Everyday Tee' : 'Mug'),
  )
  assertEquals(letter.title, 'Your order from The Shop')
  assertStringIncludes(letter.body, '- Everyday Tee (M) × 2')
  assertStringIncludes(letter.body, '- Mug × 1')
  assertStringIncludes(letter.body, '**Total $68.50**')
  // It says where a reply goes, because a reply does go somewhere: an app's
  // own address takes mail back into its store.
  assertStringIncludes(letter.body, 'reaches the seller')
})
