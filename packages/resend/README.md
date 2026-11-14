# @yaks/resend

Resend sending, signed delivery receipts, and receiving through the portable
mail boundary from `@yaks/host`. Letters and their delivery outcomes belong to
`@yaks/mail`; provider email ids remain here.

`resend({token, base?, fetch?, tags?})` returns a `Sender`. Supply a separate
`sending_access` key per service. Resend restricts a key to one domain or to
none, so restrict it only for a service that sends from a single domain; the box
sends from bot.yak.sh and yaks.app, and its key is unrestricted. A refused key
(401, 403) rejects as `Unsent`, so its letters wait for a repaired key instead
of bouncing. A validation refusal (400, 422) that names a reader, as Resend
answers a letter to example.com, rejects as `Undeliverable`: the letter bounces
with Resend's message as its reason. Any other refusal rejects with the status
and Resend's error name, never its body. The envelope supplies the sender's
address, including a customer's verified custom domain. There is no fixed
platform domain.

`Message.id` is the caller's letter UUID. It travels as the `yak_letter` tag;
`event(request, webhookSecret)` verifies Resend's signed, fresh webhook, and
`receipt(event)` returns that UUID and the RFC Message-ID. The send response's
API email id is never returned as a thread id. A host can route the same
verified receipt into its own graph door. Receipt writes are idempotent and
retry when their letter has not yet committed.

## As a plugin

Listed in a config, the package lends its host the sender named `resend`
(`./graph`), which `@yaks/mail` selects with `sender: {"via": "resend"}`. Its
options are the sender's: `token`, and `base`, `fetch` and `tags`. The sender
reads them at every letter, so a token set after start-up is used for the next
one, and until there is a token a letter waits. With `receipts`, it also answers
the webhook Resend posts delivery receipts to (`./routes`, default
`POST /mail/resend`), verifies the endpoint's signature, and fills
`mail.message_id` on the letter it names. A receipt counts only where it carries
every one of the sender's `tags`, so several hosts can share one Resend account.
A host that routes receipts itself, such as a Worker, asks the graph facet for
the notices named `resend` instead: they verify a request with the same
`receipts.secret` and answer the receipt and the letter's tags.

```json
{
  "use": "@yaks/resend",
  "with": {
    "token": { "secret": "RESEND_TOKEN" },
    "tags": { "yak_host": "box" },
    "receipts": { "secret": { "secret": "RESEND_WEBHOOK_SECRET" } },
    "domains": { "token": { "secret": "RESEND_DOMAINS_TOKEN" } }
  }
}
```

## Mail domains

`domains({token, base?, fetch?})` lends `@yaks/host`'s `MailDomains` over
Resend's Domains API: `setup(name)` adds a domain with sending and receiving
both on, or turns on whichever an existing one lacks; `read(name)` answers its
records, each fully qualified with whether Resend has `arrived` it, and starts
Resend's check when some record has not arrived and none is being checked;
`remove(name)` deletes it. A caller names a domain only by its name: Resend's id
is looked up at each call and never returned. Managing domains needs a
`full_access` key; a sending key is refused. As a plugin, the graph facet lends
these as the mail domains named `resend`, with the key from `domains.token` read
at each call, and `base` and `fetch` shared with the sender. `./testing` holds
`domainsApi()`, a stand-in for the API that names its records the way Resend
does.

`received({token, base?, fetch?}, emailId)` retrieves incoming message content
and attachments, and returns one neutral `Incoming` per recipient its To, Cc and
Bcc name or Resend received it for. Download URLs receive no API credential. A
sending-only key cannot retrieve mail; Resend offers no receiving-only API
permission, so a host limited to scoped keys keeps receiving elsewhere.
`verified` is the API's trusted DKIM verdict, which passes only for the From
domain's signature, and `vouched` its DMARC pass; supplied message headers
cannot establish authorship. With `receiving: {token}` among its options, the
`resend` notices answer a signed `email.received` with the `letters` it carried,
read with that key; without it, the event is acknowledged unread. See
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
