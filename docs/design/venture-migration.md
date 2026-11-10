# PrintBound and CrayonBloom migration

T-152801 and T-152802 implement the migration portion of D-152760. The import
modules take exported rows, verified identity mappings and copied assets. They
make no live-account calls. Rehearsal evidence and source access have different
scopes; neither authorizes a domain change or a paid print.

## Source inventory

The inspected repositories are bindery at
`10aaf7cbe0b54f548a3f014687388b55d4b8bc40` and coloring-book-maker at
`2250bce73af5d54072e271a067d5d2034a92ffb8`.

The PrintBound inventory on 2026-11-10 used the deployed Worker version
`12726a54-4fe7-4131-a812-e146b4192c34`, D1 `printbound-orders`
(`ca6bd147-fd2f-47d8-9898-e427fed7f871`), and D1 `printbound-waitlist`
(`f19a7f64-06a7-46ee-b4ab-9be5395ea1fc`). Version metadata confirms
`ORDERS_ENABLED=off`, `EMAIL_SENDING_ENABLED=off`,
`LULU_API_BASE_URL=https://api.sandbox.lulu.com`, the fulfillment queue and
private `printbound-pdfs` bucket bindings. Secret names were listed; no secret
values were read or transferred.

| Source rows                                                                     |                  Count | Evidence                                                      |
| ------------------------------------------------------------------------------- | ---------------------: | ------------------------------------------------------------- |
| orders, quotes, addresses                                                       |                 0 each | Current D1 export                                             |
| fulfilment_jobs, legal_hold_events                                              |                 0 each | Current D1 export                                             |
| account_link_sends, consumed_link_tokens, account_revocations, reorder_attempts |                 0 each | Current D1 export                                             |
| erasure_requests, orderable                                                     |                 0 each | Current D1 export                                             |
| activations                                                                     |                     41 | Current D1 export                                             |
| ops_alert_outbox                                                                |                     11 | 1 canary and 10 monitor failures, all undelivered             |
| canary_runs                                                                     |                  4,427 | Current D1 export; operational history                        |
| signups                                                                         |                     38 | Read-only waitlist count; zero suppressed, zero unsent guides |
| R2 objects                                                                      |                      0 | `wrangler r2 bucket info printbound-pdfs`; bucket size 0 B    |
| Cloudflare queue messages                                                       |                unknown | One source producer and consumer; metadata gives no backlog   |
| CrayonBloom source backup                                                       | 3,417 rows; 15 objects | Verified existing Railway backup; rehearsal below             |

The exported PrintBound schema lacks `drafts`, `stripe_delivery_verified`,
`free_draft_caps` and `global_free_draw_budget`. Their later migrations exist in
git but do not describe this deployed store. The importer reports these tables
as unavailable, without assigning them zero counts. The waitlist query reported
`changed_db=false` and `rows_written=0`.

All 38 source signup rows were copied through `printboundSignup` into an
in-process RAM graph: first run wrote 38, second run wrote 0 and reconciled 38
unchanged rows. An original source unsubscribe token resolved and changed
suppression only in that isolated graph. A disposable rehearsal steward owned
these staged records; this proves copy/capability continuity without claiming a
production customer-to-platform identity mapping. No source row or delivery was
changed, and no customer data was published.

The D1 export was _not_ a wholly read-only availability check.
`wrangler d1 export printbound-orders --remote --output <checkout>/.scratch/printbound-orders.sql`
started an export before displaying its warning that queries can be unavailable
during export; Wrangler accepted its own noninteractive prompt. Its download
failed because the destination directory was missing. The existing download was
then retrieved locally, without a second export. A subsequent `/health` request
returned HTTP 200 in 0.439 seconds. No outage was observed, but no request
overlapped the export, so a brief unavailable interval has not been ruled out.
The export is 792,664 bytes and is retained only in private ignored scratch. Use
bounded D1 reads for further inventory instead of repeating this export.

## CrayonBloom copied-data rehearsal

Railway read-only access was available on 2026-11-10. `railway status --json`
completed successfully; no source service, account, domain or variable changed.
The rehearsal reused the backup at
`/home/yaks/.yak/backups/railway/crayonbloom`, timestamp
`2026-11-10T05:18:02.796493+00:00`, rather than repeating extraction. The
22,173,521-byte `railway.dump` has SHA-256
`3bbeeab74febf4b31dad3433f603e328fb3d22febe9f5060755470d60bf632f8`. The backup
agent restored all 40 tables and compared their 3,417 rows with the source. This
rehearsal independently read that dump with `pg_restore`, parsed its COPY data,
and compared every extracted table count. Quoted PostgreSQL column identifiers
were decoded before projection.

The current storefront model and vocabulary accepted 256 customer/configuration
source rows into a disposable RAM graph. Every deterministic eid, source key,
private snapshot and staged owner was read back and compared. Counts were:

| Source and destination table                                                                                           |    Rows |
| ---------------------------------------------------------------------------------------------------------------------- | ------: |
| users, books                                                                                                           |  5 each |
| book_pages                                                                                                             |      72 |
| free_pages, styles, waitlist_signups                                                                                   | 11 each |
| support_requests                                                                                                       |      20 |
| generation_requests                                                                                                    |      32 |
| dot_shapes                                                                                                             |      35 |
| generation_jobs                                                                                                        |       3 |
| magic_links                                                                                                            |      18 |
| print_quotes                                                                                                           |       2 |
| active_storage_blobs, active_storage_attachments                                                                       | 15 each |
| active_storage_variant_records                                                                                         |       1 |
| orders, checkout_sessions, print_orders, free_page_grants, deletion_requests, moderation_cases, admin_notes, feedbacks |  0 each |

A second row replay wrote 0 and reconciled 256 unchanged rows. A synthetic
change to one book title wrote 1 and reconciled 255 unchanged rows. This was a
controlled delta against the copied snapshot, not a fresh live delta. The
complete proof took 1.28 seconds in one process. Operational tables, caches,
schedules, site settings and smoke history remain in the full backup; the app
import does not execute the 1,280 archived queue jobs or 1,278 recurring rows.

All 15 objects, totaling 24,865,460 bytes, were copied through the generic asset
boundary. Each source object's size and SHA-256 matched the backup inventory;
each ActiveStorage blob also matched its exported MD5 checksum. Destination
bytes were reopened and hashed. Repeating the copy wrote 0 objects. The original
11 free-printable token links resolved; 10 have artwork and their downloads
matched the copied hashes. An original unsubscribe link resolved. Two attached
book-page artworks remain current under the consumer's input fingerprint, and
two character sheets remain linked. Of 25 source pages marked ready, 19 have
deterministic activities and 4 other pages have no artwork attachment in this
backup; the import retains that source evidence without inventing artwork.

Five source users remained distinct under five simulated, vouched platform
principals. Unattributed rows were staged under separate private rehearsal
instruments. There are zero production principal bindings. Email is never an
identity proof. All 18 archived magic links are expired, 13 are already used;
there is no active source magic link to exercise from this snapshot.

The source-key interoperability check derived Rails purpose keys locally and
verified messages produced by the source's ActiveSupport 8.1.3.1. The source
account key was neither printed nor transmitted nor installed in an app.
Committed fixtures use a public fixture key. These checks prove the credential
format, purposes, expiry and copied-byte interface. They do not prove a held
customer browser session, production identity binding or hosted legacy route.

Retirement coordination is recorded on T-152787 and T-152811, with the retained
source project `22fffc0f-1037-4f9d-918e-068299df1336`. The retirement claim
session `a22444a6-4b9a-430e-a2bb-990bbb50e825` received preservation knock
`23c26d5e-712d-455d-ad1a-64163a0787bc`. Source retirement is not safe to
declare: production bindings, original customer sessions, provider-ledger
reconciliation, fresh source delta and destination handoff remain unverified.

## CrayonBloom production store

The production app is `crayonbloom/crayonbloom` (private, the space's front
page), with `coloring_runtime{preview: false, printer: ""}`, so no checkout or
print order can start. `bin/pg-export.ts` restores a custom-format dump in a
throwaway PostgreSQL container and writes every public table as JSON;
`bin/crayonbloom-load.ts` copies the 15 objects through the app's private
artifact door, then the 256 mapped rows under installation
`railway/crayonbloom/production`, rereads the store and fails unless every row
stands as written. Each source user is staged under a private instrument derived
from its row; no person is bound. A delta replay is the same two commands
against a fresh dump, run as a space member (the HTTP artifact door refuses the
platform admin):

    deno run -A bin/pg-export.ts <fresh railway.dump> <fresh.json>
    deno run -A bin/crayonbloom-load.ts <fresh.json> <backup dir> \
      --at=crayonbloom/crayonbloom --as=crayonbloom@bot.yak.sh

The backup directory supplies `bucket-inventory.json` and `objects/`.

## Import contracts

`bin/venture-import.ts` assigns UUIDs through `derivedEid`, namespaced by the
source installation and original table/key. Keep the installation name identical
between snapshot and delta imports. Composite keys are encoded unambiguously.
Every required table is explicit, including empty tables. Missing references,
duplicate keys and cross-customer book/order ownership are reported before copy.

`bin/printbound-import.ts` projects orders and drafts onto
`book_source{owner,via,author,markdown,dedication}` and `doc{title}`. Original
records stay in private `book_legacy{source,table,key,snapshot}` so rendered
source, picture-book inputs, payment evidence, legal holds and retention/erasure
history are retained. Historical `book_receipt{receipt}` contains
merchant/provider ids and the source's recorded status. It creates no active
print order, payment mark, submission intent, wake or mail job. Remaining source
tables have explicit inventory counts; their operational disposition is part of
cutover reconciliation.

`bin/crayonbloom-import.ts` maps books/pages onto the consumer's current
vocabulary. The consumer supplies its fingerprint function, so completed artwork
remains current without regenerating it. Original user ids distinguish guests;
verified owner/via mappings are required and email matching never grants access.
Source prompts, stories, consent evidence, suppression, reference art, PDFs,
Stripe/Lulu ids, refunds and job evidence remain in private
`legacy_record{source,table,key,snapshot,owner,via}`. Copies of attachments use
`legacy_asset{record,source_blob,role,blob,hash,mime}`. Historical purchases
remain historical; the import does not submit an owed job.

`bin/venture-assets.ts` accepts private attachment keys or public seed paths,
verifies source size/digest when supplied, hashes the bytes, copies by content
address, then reads and verifies the destination. Repeating it preserves the
source-path-to-blob mapping without another upload. No source asset is deleted.
CrayonBloom's copied-data rehearsal also reconciled all exported ActiveStorage
checksums against the preserved source bytes.

The copy boundary skips identical destination projections and verifies every
written projection by reading it back. It is for an isolated destination before
customer traffic. Do not replay a source snapshot over a destination receiving
customer edits; the final source/destination handoff needs one writer per
record.

## Existing links

PrintBound's compatibility door retains the old quote, shipping-address,
checkout and storybook tool names with an explicit sign-in and
document-preparation response. It keeps
`get_order_status(order_id, access_token)` and its MCP result envelope. A digest
of the original order/token pair identifies one imported receipt; it grants no
store membership. It returns only status, title, format and tracking, never
payment evidence or another customer's records. Historical progress reads do not
invoke active fulfillment.

CrayonBloom's compatibility helper preserves `/free_pages/:token`, numeric
`/orders/:id` under a verified mapped principal, and `/unsubscribe/:token`.
Unsubscribe changes suppression without sending mail. Existing Rails signed
sessions, guest/resume cookies, magic links and ActiveStorage signatures need
their signing-key continuity and verified principal binding at the
authentication boundary. `apps/crayonbloom/rails.ts` supplies the generic
purpose/expiry verifier; `legacyIdentity` requires both its source claim and a
vouched platform principal before calling a binding port. The optional asset
port serves copied bytes for verified ActiveStorage ids and existing printable
capabilities. These ports are inert unless a trusted host supplies them. The
fixture principal does not prove a deployed customer session. A domain change
cannot treat ordinary yaks.app sign-in as proof that an old guest cookie or
signed download still works.

## Cutover and rollback

1. Refresh the preserved CrayonBloom source checkpoint when handoff is ready;
   obtain PrintBound queue counts, both merchant/refund ledgers and outstanding
   provider receipts. Save source checkpoints privately. Reconcile the 11
   PrintBound alert rows without activating their deliveries.
2. Rehearse complete exports and all referenced bytes in isolated destination
   stores. Compare table/key/owner sets and content digests, then rerun to show
   unchanged destinations. Exercise old order, guest, account, printable,
   unsubscribe and signed-asset links against their original credentials.
3. Record one fulfillment writer for each outstanding order. Keep source jobs
   serving their existing provider ids until their handoff is explicit;
   importing a paid source row must never order it again. Reconcile refunds
   against the original merchant account. Do not move or close merchant history.
4. Before each separately approved domain change, capture a consistent source
   checkpoint and final delta. Preserve input arriving during the handoff in a
   durable journal, forward it to its selected writer and reconcile it before
   retiring source jobs. Keep source deployments, signing continuity and private
   buckets available. Do not disable drafts or discard edits to simplify
   copying.
5. Change only the approved domain's routing. Check original customer links,
   owner/guest access, asset bytes, outstanding orders and tracker failures
   through the destination. Keep the source checkpoint and the destination
   journal.
6. If the agent chooses rollback, restore that domain's prior routing,
   preserving both stores and stopping only the destination's newly assigned
   fulfillment work by its known job ids. Existing provider jobs continue to be
   reconciled by their assigned writer. Keep destination-created drafts
   reachable at the preview hostname and replay its recorded customer edits
   through the import mapping before declaring rollback reconciled. Delete
   neither store nor its assets.

Live Stripe/Lulu account connection, a capped paid proof, source-service changes
and each domain cutover remain separate owner decisions. PrintBound queue and
both provider ledgers, production principal binding, deployed customer-session
continuity and fresh final-delta/rollback rehearsal remain unverified; the two
migration tasks stay open.
