# @yaks/push

Web Push: what a browser hands a site when a person allows its notifications,
kept in the graph on that person, and a message pushed to it. Each message is
encrypted for that one browser (RFC 8291, `aes128gcm`) and signed with the
site's VAPID key (RFC 8292). Both happen here and nowhere else; the push service
the subscription names carries the message to the browser.

## Stored data

- `push_subscription{person, endpoint, p256dh, auth}` is one browser that
  allowed notifications for `person`: the push service's `endpoint` for it, and
  its P-256 public key and auth secret, base64url, as its
  `PushSubscription.toJSON()` gave them. Its eid is derived from `endpoint`
  (`subscriptionEid`), so a browser subscribing again is the same row. Deleting
  the person deletes it. A host deletes it when a push answers `gone`.

## Sending

```ts
import { publicKey, push, vapidKey } from '@yaks/push'

let vapid = { key: await vapidKey(), subject: 'mailto:hello@example.com' }
publicKey(vapid.key) // what the page passes to pushManager.subscribe
```

`vapidKey()` mints the site's private key as a JWK, which the site keeps secret;
`publicKey(key)` is the `applicationServerKey` a page subscribes with.
`push(subscription, payload, vapid, send?)` encrypts `payload` (at most `MOST`
bytes), signs a VAPID token for the endpoint's origin, good for twelve hours,
and posts it through `send` (`fetch` by default). It answers `sent` once the
service took it and `gone` when the service answered 404 or 410, so the
subscription is dead; any other answer throws `Unpushed` with its status.
Timeouts (408), rate limits (429) and service outages (5xx) carry `retry{after}`
in milliseconds, honoring `Retry-After` or defaulting to one second. A host can
use that refusal to retry or fall back to another channel without dropping the
subscription. `pushRequest` builds the same request without sending it, and
`isSubscription(value)` says whether a value a page posted is a subscription a
message can go to.

## Testing

`@yaks/push/testing`'s `browser(endpoint)` is a browser with keys of its own:
its `subscription` is what a page would post, and `opened(request)` checks the
VAPID token's signature and decrypts what a push service was handed for it,
answering the payload and the token's claims.

## Compatibility

Deno, Node, browsers and Workers: everything is Web Crypto and `fetch`.
