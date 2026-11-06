# @yaks/cloudflare-mail

Cloudflare's mail provider at the portable `@yaks/host` boundary. `cloudflare`
sends through the account's REST API; `bound` adapts the Workers Email Sending
binding. `received` decodes an Email Routing delivery's streamed MIME into a
neutral `Incoming`, preserving headers and attachment bytes. No graph, server,
credential lookup or fixed sending domain lives here.

`cloudflare({account, token, base?, fetch?})` implements `Sender`. `deliver`
accepts the provider's payload directly, and `payload` composes one from a
portable message. Only an HTTP 429 or a connection known never to have reached
the API permits another send. `bound` makes the same distinction for the
binding's rate-limit error. Both senders return RFC Message-IDs for threading.

Listed in a config, the package lends its host the sender named `cloudflare`
(`./graph`), which `@yaks/mail` selects with `sender: {"via": "cloudflare"}`.
Its options are `account` and `token`, and `base` and `fetch`; the sender reads
them at every letter, and until both are set a letter waits. A Worker lends it
what its runtime holds: options naming an Email Sending `binding` lend a second
sender, `binding`, that sends through it (a letter bounces where the deploy
holds none), and the arrival named `cloudflare` reads a letter Email Routing
handed the Worker's `email()` as an `Incoming`.

```json
{
  "use": "@yaks/cloudflare-mail",
  "with": {
    "account": { "secret": "CF_ACCOUNT_ID" },
    "token": { "secret": "CF_EMAIL_TOKEN" }
  }
}
```

```ts
import { payload } from '@yaks/cloudflare-mail'
import { equal } from '@yaks/testing'
equal(
  payload({
    from: 'hello@books.example',
    to: ['a@example.com', 'b@example.com'],
    subject: 'Thursday',
    text: 'At seven.',
    html: '<p>At seven.</p>',
  }).to,
  ['a@example.com', 'b@example.com'],
)
```
