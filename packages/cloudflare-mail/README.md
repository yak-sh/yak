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
