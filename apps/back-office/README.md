# Back office

A shop's orders, customers, products and refunds, for the people who run it. It
is an ordinary yaks app over another app's store: published from yaks.app's own
space (`yak/back-office`), installed into a seller's space, and attached to the
app that sells with
`store_attach(app: 'back-office', store: <shop>,
binding: 'STORE')`. It reads
`./api/env` for the shop's address (`STORE`, or the only store it is attached
to; `?shop=<binding>` picks among several) and runs `store(address)` there, as
whoever is using it with their own role in the shop. A sandboxed copy reaches
the shop the same way (docs/sharing.md, "Attaching an app to another app's
store").

What it shows is the platform's words every store has (docs/selling.md):

- **Orders**:
  `order{items, total_cents, email, status, quote, quantity,
  shipping_cents, tax_cents, refunded_cents, …}`,
  newest first, filtered by status. An order lists what it sold (`items`, read
  with @yaks/host/payments `unpacked`, named by its product) and every other
  word the shop's own app wrote on the same entity, labelled from the shop's
  `vocab.json`: PrintBound's `print_receipt{status, tracking}`, for one.
- **Refunds**: `refund_request{order, amount, reason}` rows of an order, and a
  form that posts to the shop's `./api/pay/refunds` through the client's `pay`,
  for an amount or all that is left. Only the shop's editors may.
- **Customers**: the people on orders, by email (or the person a quote was for),
  with their orders and what they spent.
- **Products**: `product{price_cents, sizes, stock, image}`, edited with the
  data editor's row form (@yaks/data-editor/form).

Orders, refunds and customers are the shop's editors' alone; anyone else is told
so.

| File             | What it holds                                                     |
| ---------------- | ----------------------------------------------------------------- |
| `main.js`        | the page's start: yaks.app's look, the attached shop, `open`      |
| `office.js`      | the pages, drawn over a shop's store                              |
| `shop.js`        | pure reads of a shop's rows: money, lines, customers, other words |
| `office_test.ts` | the pages driven over a store in memory                           |
