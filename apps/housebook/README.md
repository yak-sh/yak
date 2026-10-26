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
App files contain no house records. A person's records belong in the app store,
so publishing code must never require copying their house data into a seed.

To record a service visit, open an item and add a History entry. To keep a
receipt, add a document and upload it or paste its URL. To prepare a handover,
select the items to include and download the manual. Uploaded documents for
those items are embedded; external links retain their original addresses.
History is opt-in and contacts are excluded. House profile notes and shutoff
locations are included.

Reminders appear inside the app; no email or push notifications are sent. A
handover is a snapshot, not a transfer of the account or app ownership. It can
be opened offline and printed to PDF. Referenced external documents still need
an internet connection.

Run `deno task test apps/housebook` for recurrence and handover behavior.
