# The Shop

## Adding a product

One entity, two components. Give it an `alias` so writing it twice is a patch
rather than a second listing:

    graph_apply { app: 'shop', entities: [
      { entity: { eid: '$tee' },
        alias: { name: 'shirt:everyday-slate' },
        doc: { title: 'Everyday Tee — Slate',
               body: 'One line about the cloth and the cut.' },
        product: { price_cents: 2800, sizes: 'S, M, L, XL', stock: 12,
                   image: 'tee-slate.svg' } } ] }

- `price_cents` is whole cents in USD. 2800 is $28.00. Never write dollars, and
  never write a zero — the checkout door refuses a product with no price.
- `sizes` is one line, comma separated, in the order they should appear on the
  page: `S, M, L, XL`. Chest measurements are written the same way:
  `38, 40, 42`. Leave it empty for something that comes one way only, and the
  picker disappears.
- `stock` is how many are on the shelf. It is the ceiling on a single order and
  a `0` marks the card sold out. Nothing decrements it automatically — count
  down by hand when you post an order, or leave it high if you print to order.
- `image` is a file beside `index.html` (`app_files` with `base64`, then the
  bare filename) or the `url` an `upload()` answered. Square pictures; the card
  crops to one.

## What not to change

- **The page never posts a price.** It posts `{product, qty, options}` and the
  platform's checkout door reads `price_cents` off the row itself. A price a
  page posts is a price the buyer can edit — do not add one to `cart.js`.
- **Orders are written when Stripe says the money moved**, by the platform, not
  by this app. A buyer who closes the tab on the way back is still a buyer.
  Never write an `order` row from the page.
- This app holds no keys and needs no `worker.js`. If somebody asks where the
  Stripe secret goes, the answer is that there isn't one: the seller connects
  their Stripe account to the space once, and the platform charges on it.

## The order rows

`order` is the platform's own word, written by the platform's Connect webhook:
the Stripe session, the items, the total, the fee, the buyer's address and a
`status` of `paid`, `refunded` or `disputed`. Read them with `.order!&.doc?`.
Refunds are made in the seller's own Stripe dashboard; the status follows.

## Voice

Plain and short. Product bodies are one or two sentences about the thing, not
marketing. No exclamation marks.
