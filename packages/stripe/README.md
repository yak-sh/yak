# @yaks/stripe

Stripe's v1 API over `fetch`, with no SDK.
`ask({key, clock}, path, fields?, on?)` makes one call: a GET without `fields`,
otherwise a form-encoded POST (`form` nests keys as `a[b][c]`). `on` names a
connected account, sent as the `Stripe-Account` header, so the platform key acts
on that merchant's books. A call that did not get through, or that Stripe says
to retry (`Stripe-Should-Retry`), is asked again under one `Idempotency-Key`,
`TRIES` times in all, waiting on the lent clock. A refusal throws `StripeError`,
whose message is Stripe's own sentence and whose `code` tells one refusal from
another.

The host lends the key and the clock. Nothing reads the environment.

`@yaks/stripe/testing` has `signed(secret, raw, at)`, the `Stripe-Signature`
header Stripe puts on a webhook, for a test that delivers one. @yaks/hook's
`refusal('stripe', …)` verifies it.

[Stripe API reference](https://docs.stripe.com/api)
