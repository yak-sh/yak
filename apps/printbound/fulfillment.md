# Print fulfillment

The app declares `prepare`, `document_status`, `document_file`, `quote`,
`purchase`, `order_status` and `cancel` commands. Each worker call uses the
platform's verified person, instrument and originating app. Customers receive
their selected document, quote or order; the service uses its own private graph
and Lulu connection.

Preparation returns a private document UUID immediately and advances durable
checkpoints through bounded scheduled commands. `document_status` returns a
manifest only after all pages and PDFs pass inspection. Failed source reads
retain completed checkpoints; reconnecting can renew tickets for the same
immutable artwork. Quotes bind that UUID, document revision, quantity, full
destination with shipping phone, shipping level, subtotal, tax and total. The
platform issues the immutable quote and creates the PrintBound checkout; a
caller cannot replace its price or destination. Expired unpaid quotes stop
scheduling work. A verified platform payment restarts its order even if the
callback arrives after expiry.

A paid order stores a durable `print_submission{at,reference,attempt}` before
its first supplier submission. Exactly matching provider receipts are recovered
through Lulu's paginated search API. A failed or incomplete lookup is never
absence. A lost submit response keeps the intent until lookup finds the job;
search absence alone never triggers another POST because `external_id` is a
reference, not a documented idempotency promise. The internal owner command
`print_reconcile` authorizes one retry after the operator investigates and
confirms provider absence.

`print_step` is a bounded scheduled command backed by graph `call` and `wake`
rows. It checks platform payment facts before the first print submission, renews
private artifact URLs immediately before submission, records provider receipts,
and continues after process interruption without depending on a page being open.
An external refund or dispute blocks a new print submission. Already accepted
print jobs remain observable, cancellable and refundable as merchant obligations
even after the originating service connection is revoked. No new purchase
authority comes from an old paid receipt.

Provider status is preserved verbatim: `CREATED` and `UNPAID` do not mean that a
book entered production. Cancellation is confirmed by the provider before
requesting a refund. Rejected files remain in the receipt while their buyer is
refunded. Refund requests use one stable UUID and the platform's durable
merchant refund API; a pending refund keeps its work without being reported as a
failed payment. Unexpected provider failures are reported through the platform's
report endpoint and remain recoverable.

A new preview space is configured with
`print_service{preview:true,font:<private licensed font SHA>,product:"text",margin:0,contact:<merchant email>}`.
Preview purchases and printer receipts are simulated and clearly identified in
the storefront. They use no Lulu account, payment provider, mail or domain
change. The persistent fixture printer advances through unpaid, delayed
production, production and shipment observations. Live operation separately
requires authorized merchant and Lulu accounts, credential connections, account
funding and a physical proof. No generated PDF, image or font is stored in Git.

The adapter follows Lulu's
[official API contract](https://api.lulu.com/api-docs/openapi-specs/openapi_public.yml),
including exact-reference reconciliation, shipping quantities, cost totals and
`PUT /print-jobs/{id}/status/` cancellation.
