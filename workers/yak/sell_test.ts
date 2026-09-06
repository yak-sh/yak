// Selling, at its seams (sell.ts, T-34523): the account we ask Stripe for, the
// fee arithmetic, the seller row derived off an account object, and the one
// word the page, the tool and the checkout door all read.
//
// The CONTROLLER PROPERTIES are pinned here in full, and that is the point of
// this file. They are four sentences about who is responsible for what — who
// pays Stripe's fee, who carries a lost dispute, who gets a dashboard, who
// collects the identity documents — and every one of them is a promise made to
// a seller on the terms page and a liability decision for the platform. A diff
// that moves one is a diff that has to say so out loud.
import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
  assertThrows,
} from '@std/assert'
import { moved } from './billing.ts'
import {
  account,
  backAt,
  cart,
  fee,
  feeOf,
  held,
  link,
  MARK,
  META,
  orderEid,
  orderOf,
  packed,
  priced,
  type Product,
  quoted,
  rate,
  receipt,
  sellerOf,
  selling,
  session,
  unpacked,
} from './sell.ts'
import type { Space } from './directory.ts'

let space = (over: Partial<Space> = {}): Space => ({
  eid: 'e-space',
  slug: 'ada',
  title: 'Ada',
  tier: null,
  plan: null,
  stripe: null,
  fee: 0,
  meter: null,
  told: false,
  trashed: null,
  ...over,
})

Deno.test('the account is the charge-merchants-directly model, in full', () => {
  assertEquals(account(space(), 'ada@example.com'), {
    controller: {
      // The merchant pays Stripe's processing fee out of their own charge.
      fees: { payer: 'account' },
      // Stripe carries a lost dispute, not this platform.
      losses: { payments: 'stripe' },
      // The merchant reads their money in their OWN Stripe dashboard —
      // `full`, not `express`: Stripe refuses the cut-down one beside a
      // merchant who pays their own fees.
      stripe_dashboard: { type: 'full' },
      // Stripe collects the identity requirements. We never see one.
      requirement_collection: 'stripe',
    },
    email: 'ada@example.com',
    metadata: { space: 'e-space', slug: 'ada' },
  })
})

// Neither word is sent, and both absences are decisions. `capabilities` is
// required only for an account with no Stripe-hosted dashboard; ours have one,
// so Stripe requests the payment capabilities itself — and `transfers` is a
// destination charge's capability, which a direct charge never uses. `type` is
// the deprecated spelling of the four properties above, and the two ways of
// saying one thing are not both passed.
Deno.test('the account asks for no capabilities and names no type', () => {
  let made = account(space(), '') as Record<string, unknown>
  assertEquals('capabilities' in made, false)
  assertEquals('type' in made, false)
})

// An address we do not have is LEFT OUT rather than sent empty: an empty
// `email` is not the same ask as no email at all, and Stripe's form asks for
// one either way.
Deno.test('an account with no address for the seller sends none', () => {
  assertEquals('email' in account(space(), ''), false)
})

Deno.test('the onboarding link comes back to the space page, both ways', () => {
  assertEquals(link(space(), 'acct_1'), {
    account: 'acct_1',
    type: 'account_onboarding',
    return_url: 'https://ada.yaks.app/',
    refresh_url: 'https://ada.yaks.app/',
  })
})

Deno.test('the fee is basis points, rounded down, and never the whole sale', () => {
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

Deno.test('the rate reads the way a person says it', () => {
  assertEquals(rate(0), '0%')
  assertEquals(rate(250), '2.5%')
  assertEquals(rate(1000), '10%')
})

// The rate is a SETTING on the platform's own space row (T-34554), so it is
// asked of `yak` and of no other space — a seller's row saying 500 would be a
// seller choosing what they pay us.
Deno.test('the fee is read off the platform’s own space row', async () => {
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

// The pricing page is a FILE. The live rate is spliced into its one marked
// element on the way out, and the number in the file is what a crawler reading
// the repo sees and what serves when the directory will not answer.
Deno.test('the pricing page is quoted the rate that is set', () => {
  let page = `<p>We take <span class="Fee">0%</span> of each sale.</p>`
  assertStringIncludes(quoted(page, 250), 'We take <span class="Fee">2.5%<')
  assertEquals(quoted(page, 0), page)
  // A page that lost its mark is served as it is, never mangled.
  assertEquals(
    quoted('<p>We take nothing.</p>', 250),
    '<p>We take nothing.</p>',
  )
  assertEquals(quoted(`<span class="Fee">0%`, 250), `<span class="Fee">0%`)
  // And the file itself carries the mark, or the splice would quietly do
  // nothing on the page it exists for.
  assertStringIncludes(
    Deno.readTextFileSync(new URL('./public/pricing.html', import.meta.url)),
    MARK,
  )
})

Deno.test('the seller row is the account object, flags and all', () => {
  assertEquals(
    sellerOf({ id: 'acct_1', charges_enabled: true, details_submitted: true }),
    { account: 'acct_1', charges_enabled: true, details_submitted: true },
  )
  // A flag Stripe did not send is FALSE, not "unchanged": the account object
  // arrives whole on every `account.updated`, so an absent capability is an
  // absent capability — and a reader that guessed otherwise would leave a
  // seller marked ready after Stripe stopped them.
  assertEquals(sellerOf({ id: 'acct_1' }), {
    account: 'acct_1',
    charges_enabled: false,
    details_submitted: false,
  })
})

Deno.test('a redelivered account.updated moves no column at all', () => {
  let now = held(space({
    stripe: { account: 'acct_1', chargesEnabled: true, detailsSubmitted: true },
  }))
  let next = sellerOf({
    id: 'acct_1',
    charges_enabled: true,
    details_submitted: true,
  })
  assertEquals(moved(now, next), {})
  // And the one that DID change is the only column written.
  assertEquals(moved(now, { ...next, charges_enabled: false }), {
    charges_enabled: false,
  })
  // Nothing held yet: every column is new.
  assertEquals(moved(held(space()), next), next)
})

Deno.test('ready is charges_enabled and nothing else', () => {
  assertEquals(selling(space()), 'none')
  assertEquals(
    selling(space({
      stripe: {
        account: 'acct_1',
        chargesEnabled: false,
        detailsSubmitted: false,
      },
    })),
    'setup',
  )
  // The form is finished and Stripe is still verifying: NOT ready. Taking a
  // customer's money in that window is a payment that fails at the till.
  assertEquals(
    selling(space({
      stripe: {
        account: 'acct_1',
        chargesEnabled: false,
        detailsSubmitted: true,
      },
    })),
    'setup',
  )
  assertEquals(
    selling(space({
      stripe: {
        account: 'acct_1',
        chargesEnabled: true,
        detailsSubmitted: true,
      },
    })),
    'ready',
  )
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

Deno.test('a cart is read off the wire, or refused in words', () => {
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

Deno.test('the cart is priced off the store, never off the wire', () => {
  let out = priced(shelf, [
    { product: TEE, qty: 2, options: 'M' },
    { product: MUG, qty: 1 },
  ])
  // Stripe's inline `price_data`, and the variant appended to the name the
  // buyer reads on Stripe's own page.
  assertEquals(out.lines, [
    {
      price_data: {
        currency: 'usd',
        product_data: { name: 'Everyday Tee (M)' },
        unit_amount: 2800,
      },
      quantity: 2,
    },
    {
      price_data: {
        currency: 'usd',
        product_data: { name: 'Mug' },
        unit_amount: 1250,
      },
      quantity: 1,
    },
  ])
  assertEquals(out.total, 2800 * 2 + 1250)
})

Deno.test('a product this app has not got, or has not priced, is refused', () => {
  // An eid off another app, or one somebody made up.
  assertThrows(
    () => priced(shelf, [{ product: MUG.replace('2', '9'), qty: 1 }]),
    Error,
    'no product',
  )
  // A row the seller has not finished. Free is not a price.
  assertThrows(
    () => priced(shelf, [{ product: FREE, qty: 1 }]),
    Error,
    'Sticker has no price',
  )
})

// Stripe takes 500 characters per metadata value and the items ride one, so the
// door says how many lines fit rather than handing Stripe something it will cut
// in half.
Deno.test('a cart too big for one metadata value is refused by size', () => {
  let many = Array.from({ length: 40 }, () => ({ product: TEE, qty: 1 }))
  assert(packed(many).length > META)
  assertThrows(() => priced(shelf, many), Error, 'too many different things')
  // And a cart that fits is not.
  let few = Array.from({ length: 5 }, () => ({ product: TEE, qty: 1 }))
  assert(packed(few).length <= META)
  assertEquals(priced(shelf, few).lines.length, 5)
})

Deno.test('the packed items keep the product, the count and the variant', () => {
  assertEquals(
    packed([{ product: TEE, qty: 2, options: 'M' }, { product: MUG, qty: 1 }]),
    '[{"p":"11111111111141118111111111111111","q":2,"o":"M"},' +
      '{"p":"22222222222242228222222222222222","q":1}]',
  )
})

// The buyer comes back INSIDE the app, always. This door is callable by a guest
// on an open app, so an absolute URL off the wire would let a stranger have
// yaks.app's own checkout hand buyers to a page they wrote.
Deno.test('success and cancel resolve inside the app, and never outside it', () => {
  let root = 'https://ada.yaks.app/shop/'
  assertEquals(backAt(root, undefined), root)
  assertEquals(backAt(root, ''), root)
  // The braces survive: Stripe substitutes the session id for that exact
  // literal, and a percent-encoded one is a string it does not recognise —
  // which would land the buyer on a page that never learns which order it is.
  assertEquals(
    backAt(root, '?ordered={CHECKOUT_SESSION_ID}'),
    'https://ada.yaks.app/shop/?ordered={CHECKOUT_SESSION_ID}',
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
  root: 'https://ada.yaks.app/shop/',
  lines: [{ price_data: {}, quantity: 1 }],
  total: 10_000,
  packed: '[{"p":"x","q":1}]',
  bps: 0,
  success: 'https://ada.yaks.app/shop/?ok',
  cancel: 'https://ada.yaks.app/shop/',
}

Deno.test('the session is a payment, with the cart in numbered line items', () => {
  let made = session({ ...asked, email: 'ana@example.com' })
  assertEquals(made.mode, 'payment')
  // Stripe's form encoding numbers a list by its keys, and billing.ts `form`
  // walks an object — so the lines go out as `line_items[0][…]`.
  assertEquals(made.line_items, { 0: asked.lines[0] })
  assertEquals(made.customer_email, 'ana@example.com')
  assertEquals(made.success_url, asked.success)
  assertEquals(made.cancel_url, asked.cancel)
  // The two words the webhook routes by, and the cart.
  assertEquals(made.metadata, {
    space: 'e-space',
    app: 'shop',
    items: asked.packed,
    // And the rate THIS sale was charged at, so the order the webhook files
    // minutes later says what was taken rather than what is set by then.
    fee: '0',
  })
  // The SAME metadata on the PaymentIntent, and that is not a duplicate: a
  // refund arrives as a charge, which inherits the intent's metadata and knows
  // nothing of the session — so without this a refund could not be attributed.
  assertEquals(made.payment_intent_data.metadata, made.metadata)
  // No address given is no `customer_email` at all, so Stripe asks for one.
  assertEquals('customer_email' in session(asked), false)
})

// With no rate set the platform takes nothing — and Stripe requires a POSITIVE
// application fee, so a fee of nothing has to be NO FEE rather than a zero.
Deno.test('the fee rides payment_intent_data, and is absent when it is zero', () => {
  assertEquals(
    'application_fee_amount' in session(asked).payment_intent_data,
    false,
  )
  // What it looks like once the owner sets a number. There is no top-level
  // spelling of this parameter on a Checkout Session, so under
  // `payment_intent_data` is not a choice.
  let made = session({ ...asked, bps: 250 })
  assertEquals(made.payment_intent_data.application_fee_amount, 250)
  assertEquals(made.metadata.fee, '250')
})

// The rate is a SETTING (T-34554), so it can move between the checkout and the
// event that files the order. What the order records is what was TAKEN, which
// is the rate the session carries and never the rate in force now.
Deno.test('an order is charged the rate its session carried', () => {
  let paid = (fee: Record<string, string>) =>
    orderOf(
      { id: 'cs_1', amount_total: 10_000, metadata: fee },
      'acct_1',
    ).fee_cents
  assertEquals(paid({ fee: '250' }), 250)
  assertEquals(paid({ fee: '0' }), 0)
  // A session made before the rate was a column carries none, and those sales
  // were charged nothing.
  assertEquals(paid({}), 0)
  // Junk in the metadata takes nothing, rather than NaN cents.
  assertEquals(paid({ fee: 'lots' }), 0)
})

// ---- the order the webhook writes (T-34526) --------------------------------

// THE IDEMPOTENCE, and it is the whole of it: the order's entity is DERIVED
// from Stripe's session id, so a second delivery of `checkout.session.completed`
// addresses the row the first one wrote instead of minting a second order.
// There is no remembered-event list to keep correct.
Deno.test('an order is written at an eid derived from its session', () => {
  assertEquals(orderEid('cs_test_1'), orderEid('cs_test_1'))
  assert(orderEid('cs_test_1') != orderEid('cs_test_2'))
  // Shaped as a uuid, because that is what a store's eids are — VERSION 8,
  // the one reserved for an id derived from a name rather than drawn at
  // random, which is exactly what this is (src/edge.ts `edgeEid` again).
  assertMatch(
    orderEid('cs_test_1'),
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )
})

Deno.test('the cart survives the round trip through Stripe metadata', () => {
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

let sess = {
  id: 'cs_test_1',
  payment_intent: 'pi_1',
  payment_status: 'paid',
  amount_total: 6850,
  currency: 'usd',
  customer_email: 'prefilled@example.com',
  customer_details: { email: 'ana@example.com' },
  metadata: { space: 'e-space', app: 'shop', items: '[{"p":"x","q":1}]' },
}

Deno.test('the order row is what one completed session says', () => {
  assertEquals(orderOf(sess, 'acct_seller'), {
    session: 'cs_test_1',
    intent: 'pi_1',
    account: 'acct_seller',
    items: '[{"p":"x","q":1}]',
    total_cents: 6850,
    fee_cents: 0,
    // What they TYPED on Stripe's page, not the prefill the door sent: the
    // receipt has to go where they said, and `customer_email` is only what we
    // suggested.
    email: 'ana@example.com',
    status: 'paid',
  })
  // No details at all, and the prefill is the fallback rather than nothing.
  assertEquals(
    orderOf({ ...sess, customer_details: {} }, 'acct_seller').email,
    'prefilled@example.com',
  )
  // An expanded PaymentIntent reads the same as a bare id.
  assertEquals(
    orderOf({ ...sess, payment_intent: { id: 'pi_1' } }, 'a').intent,
    'pi_1',
  )
})

// A redelivery derives the identical row, so `moved` finds nothing and the
// store is never written to at all.
Deno.test('the same completed session twice moves no column', () => {
  let one = orderOf(sess, 'acct_seller')
  assertEquals(moved(one, orderOf(sess, 'acct_seller')), {})
  assertEquals(moved(one, { ...one, status: 'refunded' }), {
    status: 'refunded',
  })
})

Deno.test('the buyer is told what they bought and what it cost', () => {
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
  // It says where a reply goes, because a reply DOES go somewhere: an app's
  // own address takes mail back into its store.
  assertStringIncludes(letter.body, 'reaches the seller')
})
