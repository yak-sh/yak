# shop — a store that takes money, with no keys and no code

A storefront with sizes and a cart, its products in the app's own store, and one
call to the platform's checkout door. There is no `worker.js` here and no
secret: the seller connects their own Stripe account to the space once, and
every charge is made on that account, in their name, settling into their
balance.

The whole shape is written up at <https://yaks.app/guide/selling.md>.

## Deploying it

    app_new(slug: 'shop', title: 'The Shop')
    app_files(app: 'shop', files: [ … every file in this folder … ])
    app_deploy(app: 'shop')

Then, once per space and not per app, the seller connects Stripe — `space_sell`,
or the button on their space page — and finishes Stripe's onboarding. Until they
have, the Pay button says so instead of charging anybody.

The first deploy plants `product` from `vocab.json` and writes the three shirts
in `seed/` into the store, once.

## The files

| file         | what it is                                             |
| ------------ | ------------------------------------------------------ |
| `index.html` | the storefront: products, sizes, cart, seller's orders |
| `cart.js`    | the cart as a vocabulary — no DOM, no prices           |
| `vocab.json` | `product`                                              |
| `seed/`      | three shirts, written once per store                   |
| `tee-*.svg`  | the pictures those shirts point at                     |
| `AGENTS.md`  | how to add a product, and what not to change           |

`order` is not declared here: it is the platform's own word, written by the
platform when Stripe says a payment landed.

## A note on who can read an order

An order carries the buyer's email address, and an app anyone can read is an app
where anyone can read the orders. If that is not wanted, set the app `private`
and let a `worker.js` serve the product list to strangers — the shape is in
<https://yaks.app/guide/code.md> under the RSVP pattern.
