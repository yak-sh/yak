# @yaks/resend

Resend sending, signed delivery receipts, and receiving through the portable
mail boundary from `@yaks/host`. Letters and their delivery outcomes belong to
`@yaks/mail`; provider email ids remain here.

`resend({token, base?, fetch?, tags?})` returns a `Sender`. Supply a separate
`sending_access` key per service. Resend restricts a key to one domain or to
none, so restrict it only for a service that sends from a single domain; the box
sends from bot.yak.sh and yaks.app, and its key is unrestricted. A refused key
(401, 403) rejects as `Unsent`, so its letters wait for a repaired key instead
of bouncing. The envelope supplies the sender's address, including a customer's
verified custom domain. There is no fixed platform domain.

`Message.id` is the caller's letter UUID. It travels as the `yak_letter` tag;
`event(request, webhookSecret)` verifies Resend's signed, fresh webhook, and
`receipt(event)` returns that UUID and the RFC Message-ID. The send response's
API email id is never returned as a thread id. `@yaks/mail/routes` offers a
receipt endpoint for a graph; a host can route the same verified receipt into
its own graph door. Receipt writes are idempotent and retry when their letter
has not yet committed.

`received({token, base?, fetch?}, emailId)` retrieves incoming message content
and attachments, and returns one neutral `Incoming` per recipient. Download URLs
receive no API credential. A sending-only key cannot retrieve mail; Resend
offers no receiving-only API permission, so a host limited to scoped keys keeps
receiving elsewhere. `verified` comes from the API's trusted, From-aligned DKIM
or DMARC verdict; supplied message headers cannot establish authorship. See
[receiving authentication](https://resend.com/docs/api-reference/emails/retrieve-received-email)
and
[API key permissions](https://resend.com/docs/api-reference/api-keys/create-api-key).

```ts
import { receipt } from '@yaks/resend'
import { equal } from '@yaks/testing'

equal(
  receipt({
    type: 'email.sent',
    data: {
      email_id: 'provider-only',
      message_id: '<thread@example.com>',
      tags: { yak_letter: '21491aa7-e2c1-4631-8465-0414f7195261' },
    },
  }),
  { letter: '21491aa7-e2c1-4631-8465-0414f7195261', id: 'thread@example.com' },
)
```
