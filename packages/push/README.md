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

`pushAll(browsers, payload, vapid, send?)` pushes to several browsers at once.
Pass one payload or a function that chooses one for each subscription. It
answers which took it (`sent`), which are `gone`, and the first refusal of any
other, which a host retries or falls back from when none took it.

## Notifications

`@yaks/push/notice` draws a notification as a view of a row. A host's renderer
returns a small tree, the way a page's renderer returns elements: one
`Notification` with its `title`, its `tag`, where pressing it opens (`url`), its
`icon` and its `badge` (the small monochrome icon Android shows), holding its
body and an `Action` for each button. A button posts its `form` to `post` from
the service worker. `noticeOf(tree)` is the push surface's host: function
components are called, elements become their text, and a link is its label.

```ts
import { h } from 'preact'
import { noticeOf, Notification, said } from '@yaks/push/notice'

let notice = noticeOf(
  h(
    Notification,
    { title: 'Elihu replied', tag: 'row-eid', url: '/ana' },
    'Yes.',
  ),
)
said(notice!, 2) // the push that shows it, the installed icon counting 2
```

`said(notice, count?)` is the push that shows a notification, cut to what one
shows and to what a push carries. Browsers that support tag replacement replace
existing notifications with the same tag. `closing(tags, count?)` takes away the
notifications of `tags` once what they were about was read or answered.
`quietly(endpoint)` says whether a browser may be pushed one: Safari takes back
the subscription of a site whose push shows nothing. `refreshed` packages a
quiet fallback notification as a mutable declarative push. Safari can display it
even if the service worker fails. Older Safari reads the same payload as JSON.

## In the browser

`worker.js` is the service worker a host serves at its root: it shows a pushed
notification and sets the installed app's icon count, takes away the
notifications a closing names, opens a notification's `url` in a window of the
site already open when there is one, and posts a pressed button's form, opening
the notification instead when that fails. A Safari refresh closes the handled
notification and quietly re-shows one waiting notification with the same tag and
content. When the inbox is empty, it closes the old notifications and shows one
dismissal count. Fresh Safari alerts can pass a `check` URL to `said` so the
worker can remove older handled notifications. The worker explicitly closes the
old copy when re-showing a notification.
[WebKit issue 258922](https://bugs.webkit.org/show_bug.cgi?id=258922)

`@yaks/push/browser` is the page's half. `subscribe(key, { worker, waiting })`
asks the browser's permission, registers the worker (`/push.js` by default) and
subscribes with the site's public key, trying again while the browser's push
service refuses (`persist`); a reason the person can act on is `Unallowed`.
`badge(count)` sets the installed app's icon. `tidy(handled)` asks `handled`
which tags of the notifications this device shows were handled since and closes
those. A page calls it as it is seen to clear stale tagged notifications.

## Testing

`@yaks/push/testing`'s `browser(endpoint)` is a browser with keys of its own:
its `subscription` is what a page would post, and `opened(request)` checks the
VAPID token's signature and decrypts what a push service was handed for it,
answering the payload and the token's claims.

## Compatibility

Deno, Node, browsers and Workers: everything is Web Crypto and `fetch`.
