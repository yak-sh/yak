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

`@yaks/stripe/graph` lends Stripe as a payment provider (`payments`, from
`@yaks/host/payments`) named `stripe`, with `name: 'Stripe'`, its `plans`, its
`shops` and its `doors`, built from the options a config gives it: `key`,
`clock`, `prices`, each tier's price ids by `month` and `year`, and `doors`,
each webhook door's signing secret by its name.

```json
{
  "use": "@yaks/stripe",
  "with": {
    "key": { "secret": "STRIPE_KEY" },
    "prices": {
      "plus": { "month": "price_plus" },
      "organization": { "month": "price_org", "year": "price_org_year" }
    },
    "doors": {
      "webhook": { "secret": "STRIPE_WEBHOOK_SECRET" },
      "connect": { "secret": "STRIPE_CONNECT_WEBHOOK_SECRET" }
    }
  }
}
```

## Plans

`plans(options)` (`@yaks/stripe/plans`) sells a party its plan. A payer is a
customer. Checkout is a subscription session under Managed Payments, which
Stripe sells as merchant of record, so it sends none of the parameters Stripe
controls there; the tags ride the session's and the subscription's `metadata`,
the reference its `client_reference_id`, and time given free a `trial_end` no
sooner than two days away. The portal is a billing portal session. A
subscription reads its tier off its item's price (the first tier listing it,
else the first tier), its period end off the item or the subscription, whichever
the API version sends, and its standing off its status: `active` and `trialing`
pay, `past_due` owes, `canceled` and `incomplete_expired` have ended, and the
rest have lapsed. Postponing sets the trial to end later, prorating nothing.
`changed(options)(event)` reads a verified event as a subscription changed: a
`customer.subscription.*` event carries its subscription, and a checkout session
or an invoice names one, read on asking; one Stripe does not hold reads as
`null`.

## Shops

`shops(options)` (`@yaks/stripe/shops`), lent beside the plans, sells on Connect
accounts under the "charge merchants directly" model. An account is opened with
its four controller properties written out (the account pays Stripe's fees,
Stripe carries lost disputes, a full dashboard, Stripe collects the
requirements) and the tags as metadata; `charges_enabled` reads as `ready` and
`details_submitted` as `submitted`. Onboarding is an `account_onboarding`
Account Link returning and refreshing to the same address. A checkout is a
payment-mode session on the account (`Stripe-Account`), its lines inline
`price_data`, the fee `payment_intent_data[application_fee_amount]` (none when
0), and the tags on both the session and its PaymentIntent, so a refund's charge
carries them. `shopped(options)(event)` reads `account.updated`,
`account.application.deauthorized`, `checkout.session.completed`,
`charge.refunded` and `charge.dispute.created` or `.closed`; a dispute's charge
is read back on the account, since a dispute carries no metadata.

## Doors

`doors(options)` (`@yaks/stripe/doors`) are Stripe's two webhook endpoints,
which a host serves at `/stripe/<name>`: `webhook`, events from the platform's
own account, read by `changed`, and `connect`, events from connected accounts,
read by `shopped`. Stripe signs each endpoint's events with its own `whsec_…`,
so each door verifies the raw body with its own secret (@yaks/hook's
`refusal('stripe', …)`) and answers `{heard}` or `{refused, ours}`, `ours` where
a well-formed signature did not match, which is what a wrong secret looks like.
A door with no secret answers `undefined`.

`@yaks/stripe/testing` stands in for Stripe in a test: `signed(secret, raw, at)`
is the `Stripe-Signature` header Stripe puts on a webhook,
`delivered(post,
path, secret, type, object, on?, at?)` posts a signed event
through `post` and answers the door's body, and `fakeSub(metadata, over?)` is a
subscription shaped as `read` reads one.

[Stripe API reference](https://docs.stripe.com/api)
