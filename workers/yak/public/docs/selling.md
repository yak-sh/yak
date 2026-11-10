---
doc:
  title: Payments
guide:
  slug: selling
  brief: accepting payments in an app through Stripe Checkout
  description: >-
    Accepting payments with Stripe: how a seller connects their own Stripe
    account to a space (Stripe Connect), the product component, the
    ./api/pay/checkout endpoint a page posts a cart to and what it returns, why
    a page never posts a price, the order row and the buyer's confirmation
    email written when the payment completes, refunds and disputes, who can
    read an order, test mode, and why a card number never reaches your app.
---

# Payments

Apps on the Plus plan can accept payments through Stripe, the **payment
provider** yaks.app uses. The seller connects their own Stripe account to their
space, once. After that any app in that space can post a cart to
`./api/pay/checkout`, and that endpoint returns the URL of a Stripe payment page
to send the buyer to. When the payment completes, an `order` row is written to
that app's store and the buyer receives an email from the app's own address.

The app sets no API key, receives no webhook and needs no `worker.js`. The
charge is made _on_ the seller's Stripe account, in the seller's name: the
platform creates the charge and takes a fee from it, the way an app store does;
the fee is listed on <https://yaks.app/pricing>. The rest settles into the
seller's own Stripe balance, on their own payout schedule, and the seller
handles refunds and disputes in their own Stripe dashboard.

Back to the map: <https://yaks.app/docs.md>

## Security guarantees

**A card number never reaches this platform, and never reaches your app.** The
buyer types it on Stripe's own page, at `checkout.stripe.com`. Your app sends a
list of products and receives a URL; after the payment it receives an amount, an
email address and a session id, and nothing else about the payment.

Checkout is designed this way on purpose. A form on your own page that collects
a card number makes you responsible for that card data, under rules this
platform cannot help you meet. Do not write an `<input>` for a card number.

Two more rules follow from the same design:

- **A page never posts a price.** It posts which product and how many; the
  endpoint reads `price_cents` from the `product` row itself. A price posted
  from a browser is a price the buyer can edit, so the price is never sent from
  the browser at all.
- **No order is written by the page**, and none by the success URL Stripe
  redirects the buyer to. A buyer who closes that tab has still paid. The order
  is written only when Stripe reports to the platform that the payment
  completed.

Both rules hold under every `access` mode. On an `open` app a visitor can add
rows of their own, but only the owner and editors can write a `product`, and
only the platform can write an `order`'s properties.

## Connecting a Stripe account

Connecting an account and creating new checkout sessions require the Plus plan.
After a downgrade, existing orders, refunds and disputes still update, and the
Stripe account stays connected. See <https://yaks.app/pricing> for plans.

The seller connects once per space, not per app: with the `space_sell` tool, or
the button on the space's own page. Either opens Stripe's own onboarding, where
the seller enters their business details and bank account, and returns them to
yaks.app when it is finished. Stripe decides when the account may accept
charges, and the space records that as `seller.ready`.

Until then the checkout endpoint refuses with `409` and the code `not_selling`,
so a page can show "this shop is not open yet" instead of failing when somebody
tries to buy. The app does not need to change when onboarding finishes; the same
page starts accepting payments.

The seller keeps their account, their money, their customer relationship and
their refunds. The seller never pastes a secret key anywhere, and payments need
no `store_connection_need`.

## Products: the `product` component

A product is an ordinary entity: `doc` for its title and description, and
`product` for the rest. **`product` is one of the platform's own components**,
like `task` and `comment`, so every app already has it and no `vocab.json`
declares it. It is the platform's because the checkout endpoint reads
`price_cents` from this row, and the platform defines every component it charges
money against.

    product { price_cents, sizes, stock, image }

`sizes` lists the variants you offer, comma separated; a page turns one of them
into the `options` of a cart line. `stock` is a count the app keeps itself:
nothing on the platform decrements it.

    { "entity": { "eid": "$tee" },
      "alias": { "name": "shirt:everyday-charcoal" },
      "doc": { "title": "Everyday Tee — Charcoal",
               "body": "Heavyweight cotton, boxy cut." },
      "product": { "price_cents": 2800, "sizes": "S, M, L, XL",
                   "stock": 24, "image": "tee-charcoal.svg" } }

`price_cents` is always a whole number of cents. `2800` is $28.00; a price
written as `28` sells the shirt for $0.28. The `alias` makes a seed file safe to
load twice (<https://yaks.app/docs/store.md>).

A page reads products from the store like any other rows:

    import { subscribe } from './api/client.js'

    subscribe('.product&?doc', draw)

## The checkout endpoint

    POST ./api/pay/checkout
    { "items": [ { "product": "<eid>", "qty": 2, "options": "M" } ],
      "email": "ana@example.com",
      "success": "?ordered={CHECKOUT_SESSION_ID}",
      "cancel": "" }

    → 200 { "url": "https://checkout.stripe.com/c/pay/cs_test_…" }

The endpoint is on the app's own origin, under its `/api/`, so a page calls it
with an ordinary `fetch` and an app's `worker.js` calls it through `env.STORE`.
A guest can call it: the buyer has no yaks.app account and never needs one. That
is why checkout is a platform endpoint and not code an app has to be trusted
with.

- **`items`** lists what to sell: the product's eid, the quantity, and `options`
  for a variant (a size, a colour), which is appended to the line the buyer
  reads on Stripe's page. The endpoint reads the title and the price from each
  row. A product it cannot find, or one priced at zero, is refused before Stripe
  is called. An order holds about ten different lines at most: the cart is sent
  to the webhook as one Stripe metadata value, and a metadata value holds 500
  characters. A larger cart is refused, with how many lines fit, rather than
  truncated.
- **`email`** is optional and only prefills the email field on Stripe's page.
- **`success`** and **`cancel`** are relative to the app's own root, so nothing
  in your page hard-codes the app's name and an installed copy redirects its
  buyers back to itself. `{CHECKOUT_SESSION_ID}` is a literal that Stripe
  replaces with the session id when it redirects. If both are omitted, the app's
  root is used.

The complete call from a page:

    let r = await fetch('./api/pay/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: cart.map((l) => ({ product: l.product, qty: l.qty,
                                  options: l.options })),
        success: '?ordered={CHECKOUT_SESSION_ID}',
      }),
    })
    let out = await r.json()
    if (!r.ok) return say(out.error.message)
    location.href = out.url

A refusal has the same shape as every refusal on yaks.app,
`{"error": {"code": …, "message": …}}`, so showing `out.error.message` gives the
person an explanation rather than a status code. The one refusal worth handling
by its code is a space that has not connected a Stripe account yet.

## Orders: the `order` component

When the payment completes, Stripe notifies the platform, and the platform
writes one row into the app's own store:

    order { session, account, items, total_cents, fee_cents, email, status }

`order` is one of the platform's own components, so every app already has it and
no `vocab.json` declares it. Only the platform writes its properties: no page,
member or visitor can write one, and the owner may delete an order row. `status`
starts as `paid` and then follows the charge: `partially_refunded` or `refunded`
when the seller gives money back, `disputed` while a buyer's dispute is open,
then `paid` again if the seller wins the dispute or `lost` if the buyer's bank
reverses the charge. The buyer receives a confirmation email from the app's own
address, `<space>.<app>@yaks.app`, listing the items and the total
(<https://yaks.app/docs/mail.md>), and a reply to it is stored in the app's
store as mail the seller can read.

An order is a row, so the seller's order list is a query:

    import { me, query } from './api/client.js'

    let mine = await me()
    if (mine.writes) draw(await query('.order&?doc'))

The whole query syntax works on orders (<https://yaks.app/docs/querying.md>):
`.order.status=paid`, `.order.total_cents>=5000`, or a bare word for full-text
search. An agent runs the same query through `graph_query`, so "what sold this
week" is one call with no page open.

## Customer privacy

Orders, quotes and receipt mail are private to the seller's editors and owners,
including when the app's catalog is public. A visitor's graph queries cannot
read those rows. The platform records the verified buyer or guest browser at
checkout; an email address or a payment session id grants no access.

`GET ./api/pay/orders/<order-eid>` returns the buyer's own receipt: its title,
items, total and payment status, with document quote details when applicable. It
also accepts the quote eid returned by checkout. A guest uses the browser that
started checkout; a signed-in buyer can use another signed-in browser. Another
customer or a visitor without that authority receives `404`. Provider account
and payment identifiers remain on the seller's graph.

### Private artifacts

A worker that has checked its customer's authority can store private print files
through `env.APP`:

    await env.APP.fetch('/pay/artifacts?buyer=' + person + '&via=' + via, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf', 'x-yak-name': 'interior.pdf' },
      body: pdfBytes,
    })

The response includes `{eid, attachment, url, mime, bytes}`. `person` and `via`
come from the platform's authenticated request headers, never browser input. At
least one is required; omit `buyer` for a guest. The upload endpoint requires
seller editor authority, which `env.APP` supplies. It stores the artifact and
its customer entitlement together, without publishing an ordinary blob URL.
Identical files can belong to several customers independently.

`GET ./api/pay/artifacts/<eid>` reads the file for its customer or the seller.

Scheduled work handling a customer's supplied file restricts its seller
authority explicitly:

    let subject = new URLSearchParams({subject: 'customer'})
    if (customer.person) subject.set('buyer', customer.person)
    if (customer.via) subject.set('via', customer.via)
    await env.APP.fetch('/pay/artifacts/' + sha + '?' + subject)

The subject comes from the original verified customer, retained with the work.
This read uses the existing artifact entitlement check even though `env.APP`
holds seller authority. A person-bound file needs that person; a guest file
needs its browser instrument. At least `buyer` or `via` is required. Only the
seller app or a seller editor may select a restricted subject; ordinary clients
continue using their own inferred identity. The same restriction works on
`/link`. Trusted seller configuration, such as a licensed font, uses the
ordinary seller read without a subject.

`POST ./api/pay/artifacts/<eid>/link` returns `{url, expires}`: a signed URL
allowing a provider to fetch that exact artifact in that app for fifteen
minutes. Renewing a link checks the current customer entitlement again. Receipt
and artifact responses use `Cache-Control: private, no-store`.

## Document quotes

A service worker issues a physical-service quote through
`env.APP.fetch('/pay/quotes', {method: 'POST', body: JSON.stringify(quote)})`.
The `Quote` type in `@yaks/host/payments` names the complete contract: buyer,
originating app (`source`), seller, document identity and revision,
specification, quantity, currency, destination, shipping choice, subtotal, tax,
total and expiry. All amounts are integers in the currency's smallest unit, such
as cents. The subtotal covers the complete quantity. Only the seller's worker or
an editor can issue a quote. Its identity cannot be reused for different facts.

The buyer posts `{quote: quote.id, success, cancel}` to `/api/pay/checkout`. The
platform reads the saved quote; prices in the request have no effect. Changing
the quantity or destination requires another quote. A quote needs at least
thirty minutes remaining to open a hosted checkout, and its expiry cannot exceed
twenty-four hours. Checkout fixes the delivery address, shipping and tax, and
returns `{url, quote, source, receipt}`. The buyer's authenticated identity must
match the quote. A seller worker can open the same unpaid checkout through its
app binding. Opening a checkout does not charge the customer.

The checkout request is saved before contacting the provider. Retrying it keeps
the same fee, address and return URLs. On payment, the order records
`order{quote, document, revision, specification, buyer, source, quantity,
currency, shipping_cents, tax_cents, ...}`.
The `receipt` URL accepts the order or quote identity and returns the verified
buyer's receipt without provider account or payment identifiers. Payment uses
the seller's merchant account and never moves a space's included usage budget.

## Merchant refunds

The seller's worker or an editor posts to `/pay/refunds` through `env.APP`:

    {request: refundId, order: orderId, amount: cents, reason: explanation}

Both identities are UUIDs. Keep `request` fixed when retrying the same refund.
Omit `amount` for the remaining payment, or supply a positive amount for a
partial refund. The platform records `refund_request{order, amount, reason}`
before an effect asks the provider. It returns HTTP 202 with
`{refund, status: 'requested'}`. `GET /pay/refunds/<refund>` returns the
merchant's request; its computed `refund_request.status` is `requested`,
`processing`, `refunded` or `failed`.

Recovery reuses the same provider request and checks for a previous refund even
if the provider's temporary retry key has expired. Partial and full refunds
reverse the platform's application fee in proportion where one was collected.
Refunds made in the seller's provider dashboard also update the order and
reconcile that fee. A provider failure remains recorded and is reported to the
platform tracker.

## Testing with Stripe test mode

Stripe's test mode is separate from live mode: the seller onboards a test
account, and card `4242 4242 4242 4242` with any future expiry date pays with
it. Buy something from the deployed app and check that the order row appears in
the store and the confirmation email is sent. The app does not change between
test and live mode: the Stripe key is the platform's, and the platform decides
which mode it runs in.

A complete shop is in this repository at `workers/yak/examples/shop/`: a
storefront with sizes and a cart, seeded products, the seller's order list and
`NOTES.md`, with no `vocab.json` and no Stripe code. Copy it and replace the
products.

## How it works: Stripe Connect direct charges

Payments are direct charges on a Stripe Connect connected account. The
platform's own key creates the Checkout Session, addressed to the seller's
account, with an application fee on it. The charge is on the seller's account,
so the seller's name is on the buyer's statement, the seller pays Stripe's
processing fee, and the seller handles the refund and the dispute. An app does
not need to know any of this and cannot change it; it is documented here for
reference.

## Not supported

Subscriptions and recurring charges, discount codes, and automatic shipping rate
or tax calculation. Physical services supply provider-confirmed shipping and tax
in their immutable quote.
