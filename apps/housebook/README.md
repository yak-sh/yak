# Housebook

A private house manual and logbook on yaks.app. The manual keeps equipment,
finishes and systems; each item has specifications, documents, dated history and
maintenance reminders. Image attachments display inline and supply the item’s
card photo; an item without an image keeps its category icon. Completing a
reminder writes a logbook entry and advances its date in one transaction. The
electrical directory preserves circuit labels, including OFF markings.

The browser uses `./api/client.js` for storage, uploads, live subscriptions and
recoverable drafts. `model.js` holds date and input behavior; `editor.js` edits
records; `views.js` renders them; `export.js` makes a standalone handover file.
App files contain no personal house records. A person's records belong in the
app store, so publishing code must never require copying their house data into a
seed.

The public gallery copy lives at https://yourname.yaks.app/housebook/. The
fictional records and documents in `demo/` furnish that copy. Keep `demo/` in
the private source alongside its ordinary files. The platform applies its files
at the root of the gallery copy on every install and update, including the index
that enables the shared demo footer. The private app and ordinary installs use
the ordinary index and have no root seed file.

To record a service visit, open an item and add a History entry. To keep a
receipt, add a document and upload it or paste its direct download URL.
Housebook downloads the file into its private storage and keeps the source URL.
A failed download keeps the draft; a webpage is only a link when explicitly
marked Website reference. To prepare a handover, select the items to include and
download the manual. Saved documents for those items are embedded; website
references retain their original addresses. History is opt-in and contacts are
excluded. House profile notes and shutoff locations are included.

Reminders appear inside the app; no email or push notifications are sent. A
handover is a snapshot, not a transfer of the account or app ownership. It can
be opened offline and printed to PDF. Website references still need an internet
connection.

Run `deno task test apps/housebook` for recurrence and handover behavior.
