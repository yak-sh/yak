# @yaks/domains

Domains a person buys through their space. A registry offers a name and its
price; a paid checkout writes an order; the order is registered, attached to the
space or app it serves, and its DNS written, so the person sets nothing up; and
it renews while the space's plan pays.

The core is data and decisions. Everything that reaches outside goes through
`Ports`, which the host fills: a `Registry` (@yaks/cloudflare/registrar is one),
the graph the order lives in, whether a space pays, how a name is attached to a
place, where a zone's records are written, and how a payment is refunded.
yaks.app fills them in workers/yak `facets/domains-effects.ts`.

## Vocabulary (`./vocab`)

- `domain_order{name, space, serves, checkout, cents, live}`: a domain a space
  paid for, written once per checkout (`ordered`); `live` is false for a sandbox
  payment, which registers nothing.
- `domain_registered{at, expires}`: the registry holds it and it is attached.
- `domain_refused{at, why}`: it could not be registered (a sandbox payment, a
  name another checkout bought first, or the registry's refusal); the payment is
  owed back.
- `domain_refunded{at, refund}`: the payment was returned whole.
- `register_domain`: the effect that works an order through `fulfil`.
- `renew_domains`: the effect that runs `renew` when a space's `plan` changes.

## Exports (`.`)

- `ordered(eid, checkout, order)`: the order's bundle, guarded by `$was` so a
  payment told twice orders once.
- `fulfil(ports, eid)`: reads the registration first, so a retried order never
  registers twice; registers where none was asked; throws `Waiting` (with its
  `retry`) while the registry's workflow runs, an hour apart once it needs a
  person; on success makes the zone, attaches the name and writes its records,
  then marks `domain_registered`. An order it can't register is marked
  `domain_refused`, refunded through the `refund` port and marked
  `domain_refunded`, once however often it runs.
- `renew(ports, space)`: renewal on for every registered name while the space
  pays, off once it doesn't.
- `sold(offer)`: an offer as it is sold here. The plan pays every renewal, so a
  name that renews above `RENEWS_AT_MOST` ($30) is not registrable.
- `offerLine(offer)` and `dollars(cents)`: a price as a person reads it.

```ts
import { offerLine } from '@yaks/domains'
offerLine({ name: 'ada.com', registrable: true, cents: 1117, renews: 1117 })
// 'ada.com — $11.17 for the first year'
```
