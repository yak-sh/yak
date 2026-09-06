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
import { assert, assertEquals, assertThrows } from '@std/assert'
import { moved } from './billing.ts'
import {
  account,
  backAt,
  cart,
  fee,
  held,
  link,
  META,
  packed,
  priced,
  type Product,
  rate,
  sellerOf,
  selling,
  session,
} from './sell.ts'
import type { Space } from './directory.ts'

let space = (over: Partial<Space> = {}): Space => ({
  eid: 'e-space',
  slug: 'ada',
  title: 'Ada',
  tier: null,
  plan: null,
  stripe: null,
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
  // The owner has not set a rate, so nothing is taken.
  assertEquals(fee(10_000), 0)
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
  // What it looks like once the owner sets a number: `fee` is the arithmetic,
  // pinned above, and this is where it lands. There is no top-level spelling of
  // this parameter on a Checkout Session, so under `payment_intent_data` is not
  // a choice.
  assertEquals(fee(asked.total, 250), 250)
})
