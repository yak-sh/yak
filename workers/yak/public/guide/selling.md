# Selling things

An app can take money, and taking it is one call. The seller connects a Stripe
account of their own to their space, once. After that any app in that space can
post a cart to `./api/pay/checkout`, and the door answers the address of a
Stripe payment page to send the buyer to. When the money moves, an `order` row
appears in that app's store and the buyer gets a letter from the app's own
address.

There is no key to set, no webhook to receive and no `worker.js` to write. The
charge is made ON the seller's Stripe account, in the seller's name — this
platform passes the ask along and takes a fee out of it, the way an app store
does; what that fee is, is on the <https://yaks.app/pricing> page. The rest
settles into the seller's own balance, on their own payout schedule, and refunds
and disputes are theirs to handle in their own Stripe dashboard.

Back to the map: <https://yaks.app/guide.md>

## What never happens

**A card number never reaches this platform, and never reaches your app.** The
page where somebody types one is Stripe's own, at `checkout.stripe.com`. Your
app sends a list of products and gets back a link; afterwards it learns an
amount, an email address and a session id, and nothing else about the payment.

That is not a convention you keep — it is the reason the shape is this way. A
form on your own page that collects a card is a form you are then responsible
for, under rules this platform cannot help you meet. If you find yourself
writing an `<input>` for a card number, the design has gone wrong.

Two more, and both are load-bearing:

- **A page never posts a price.** It posts which product and how many; the door
  reads `price_cents` off the row itself. A price posted from a browser is a
  price the buyer can edit, and the whole of the defence is that the number
  never travels.
- **No order is written by the page**, and none by the address Stripe sends the
  buyer back to. A buyer who closes that tab has still paid. The order is
  written when Stripe says the money moved, and by nothing else.

## The seller connects an account

Once per SPACE, not per app: `space_sell`, or the button on the space's own
page. It opens Stripe's own onboarding — their business details, their bank
account — and hands them back when it is done. Stripe decides when they are
ready, and the space knows it as `stripe.charges_enabled`.

Until then the checkout door refuses by name, so a page can say "this shop is
not open yet" instead of failing at the moment somebody tries to buy. Nothing
about the app has to change when they finish; the same page starts working.

What the seller keeps: their account, their money, their customer relationship,
their refunds. What they never do: paste a secret key anywhere. There is no
`app_secret_set` in this recipe.

## What the app sells

A product is an entity like any other: `doc` for the words, and `product` for
the rest. **`product` is one of the platform's own words** — like `task` and
`comment` — so every app already has it and no `vocab.json` declares it. It has
to be the platform's: the checkout door reads `price_cents` off this row, and a
word the platform charges money against is a word the platform defines.

    product { price_cents, sizes, stock, image }

`sizes` is the variants you offer, comma separated, and what a page turns into
the `options` on a cart line. `stock` is your own count — nothing on the
platform decrements it.

    { "entity": { "eid": "$tee" },
      "alias": { "name": "shirt:everyday-charcoal" },
      "doc": { "title": "Everyday Tee — Charcoal",
               "body": "Heavyweight cotton, boxy cut." },
      "product": { "price_cents": 2800, "sizes": "S, M, L, XL",
                   "stock": 24, "image": "tee-charcoal.svg" } }

`price_cents` is whole cents, always. `2800` is $28.00, and a price written as
`28` is a shop selling shirts for twenty-eight cents. The `alias` is what makes
a seed file safe to load twice (<https://yaks.app/guide/store.md>).

The page draws them out of the store like anything else:

    import { subscribe } from './api/client.js'

    subscribe('.product!&.doc?', draw)

## The checkout door

    POST ./api/pay/checkout
    { "items": [ { "product": "<eid>", "qty": 2, "options": "M" } ],
      "email": "ana@example.com",
      "success": "?ordered={CHECKOUT_SESSION_ID}",
      "cancel": "" }

    → 200 { "url": "https://checkout.stripe.com/c/pay/cs_test_…" }

Same origin, under the app's own `/api/`, so a page reaches it with an ordinary
`fetch` and an app's `worker.js` reaches it through `env.STORE`. It is callable
by a GUEST — the person buying has no account here and never will — which is the
whole point of it being the platform's door and not something an app has to be
trusted with.

- **`items`** is what to sell: the product's eid, how many, and `options` for a
  variant — a size, a colour — which is appended to the line the buyer reads on
  Stripe's page. The door reads the title and the price off each row. A product
  it cannot find, or one priced at zero, is refused before Stripe is asked. An
  order runs to about ten different lines: the cart rides one Stripe metadata
  value on its way to the webhook, and those hold 500 characters. A bigger cart
  is refused saying how many fit, rather than truncated.
- **`email`** is optional and only fills the field in for them.
- **`success`** and **`cancel`** are relative to the app's own root, so nothing
  in your page spells the app's name and an installed copy sends its buyers back
  to itself. `{CHECKOUT_SESSION_ID}` is a literal Stripe substitutes for the
  session id on the way back. Leave both out and the app's root is used.

From a page, the whole of it:

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

A refusal comes back the way every refusal here does —
`{"error": {"code": …, "message": …}}` — so showing `out.error.message` gives
the person the sentence rather than a status code. The one worth handling by
name is the space that has not connected an account yet.

## What lands when they pay

Stripe tells the platform, and the platform writes one row into the app's own
store:

    order { session, account, items, total_cents, fee_cents, email, status }

`order` is one of the platform's own words, so every app already has it and no
`vocab.json` declares it. `status` is `paid`, and becomes `refunded` or
`disputed` if it ever does. The buyer gets a confirmation from the app's own
address, `<space>.<app>@yaks.app`, with the items and the total on it
(<https://yaks.app/guide/mail.md>), and a reply to it lands back in the app's
store as mail the seller can read.

It is a row, so the seller's own view is a query:

    import { me, query } from './api/client.js'

    let mine = await me()
    if (mine.writes) draw(await query('.order!&.doc?'))

`.order.status=paid`, `.order.total_cents>=5000`, a bare word for full text —
the whole filter line works on them (<https://yaks.app/guide/querying.md>). From
an agent's side it is the same line through `graph_query`, so "what sold this
week" is one call with no page open.

**Who else can read them is the app's `access`, not the page's `if`.** An order
carries a buyer's email address, and an app anyone can read is an app where
anyone can read the orders. If that is not wanted, set the app `private` and let
a `worker.js` hand the product list to strangers — the shape is the RSVP pattern
in <https://yaks.app/guide/code.md>.

## Trying it before it is real

Stripe's test mode is a whole parallel world: the seller onboards a test
account, and card `4242 4242 4242 4242` with any future expiry pays with it. Buy
something from the deployed app and watch the order land in the store and the
letter go out. Nothing about the app changes between test and live — the key is
the platform's, and which mode it is in is the platform's business.

A whole shop written out — storefront with sizes and a cart, seeded products,
the seller's order list, `AGENTS.md`, no `vocab.json` at all and not one line of
Stripe code — is in this repository at `workers/yak/examples/shop/`. Copy it and
change the shirts.

## What is underneath, in one paragraph

Direct charges on a Stripe Connect connected account. The platform's own key
makes the Checkout Session, addressed to the seller's account, with an
application fee on it; the charge lives on the seller's account, so their name
is on the statement, they pay Stripe's processing fee, and they own the refund
and the dispute. Nothing in that paragraph is something an app has to know or
can change — it is here because somebody will ask.

## What is not here

Subscriptions and recurring charges, shipping rates and tax calculation,
discount codes, and refunding from inside an app: a refund is made in the
seller's own Stripe dashboard, and the `order` row follows it. Say so plainly
rather than building a button that does not work.
