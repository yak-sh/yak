# @yaks/hook

Defines a graph component for recording incoming webhook requests: their source,
event name, original HTTP body and headers, and signature-verification result;
`hooked()`, which turns a captured request into the bundles that record it; and
`checked()`/`refusal()`, which check a request's signature under a scheme and
secret the receiver supplies. It does not expose an HTTP endpoint or choose a
secret; [@yaks/mail](../mail/README.md) pulls requests from a mail edge's hook
paths and records them this way.

## Stored data

`hook{source, event, payload, method, path, headers, verified}` stores:

- `source` and `event`: the sender and its event name.
- `payload` and `headers`: the original body and headers as strings, not parsed
  objects. Both declare `store: "blob"`; load [@yaks/blob](../blob) to store
  their text by content hash, or leave it unloaded for ordinary text properties.
- `method` and `path`: the HTTP method and request path.
- `verified`: whether the receiving application verified the sender's signature.

All these properties are `stamped`: ordinary graph writes cannot set them. The
trusted receiving application must supply them through the graph's stamping
mechanism. An unsigned request can still be recorded with `verified: false`;
readers decide whether to trust it. Recording an event does not authorize it.

The old fields `spool_id`, `received_at`, and `sig_ok` are not in this schema.
Use graph provenance components for arrival timestamps; the signature result is
`verified`.

## Exports and use

The root import exports `hookDoc`, a JSON Schema document, and the recorder:

- `hooked(request, about?)` returns a `hook` bundle with a `doc` title naming
  the event, plus an `about` link when you pass the entity it is for. Apply it
  trusted, since every `hook` property is server-owned.
- `event(request)` names the event: the sender's `X-GitHub-Event` or
  `X-Event-Key` header, else a JSON body's `event`, `type` or `action`, else the
  method and path.
- `hookEid(request)` derives the entity id from `source` and the receiver's
  request `id`, so recording one request twice writes one entity.

`@yaks/hook/vocab` also exports `docs: [hookDoc]` for plugin loaders.

## Signatures

A scheme says how a sender signs. It is plain data, so a receiver can store it
beside the secret it goes with:

- `'stripe'`: the `Stripe-Signature` header, `t=<unix>,v1=<hex>`, an HMAC-SHA256
  of `<t>.<raw body>`. Every `v1` is tried, so a secret being rolled still
  verifies, and a timestamp more than `SKEW` seconds (300) from now is refused.
- `'github'`: the `X-Hub-Signature-256` header, `sha256=<hex>` of the body.
- `{header, prefix?, encoding?}`: an HMAC-SHA256 of the body in the named
  header, written as hex (the default) or base64, after an optional prefix.

The receiver passes the secret; this package never learns where it came from.

- `refusal(scheme, secret, body, headers, now?)` answers `''` when the signature
  holds and otherwise the reason, such as `'no Stripe-Signature
  header'` or
  `'the signature does not match'`. `headers` is anything with `get(name)`, such
  as a fetch `Headers`.
- `checked(request, scheme, secret, now?)` returns the captured request with
  `verified` set, ready for `hooked()`.

The body must be the raw text that arrived: a signature covers bytes, and a
parsed and re-serialized body is not what the sender signed. Every compare goes
through WebCrypto's `verify`, so it runs in constant time.

```ts
import { checked, hooked } from '@yaks/hook'

const request = { id, source: 'github', body, headers: JSON.stringify(sent) }
const bundles = hooked(await checked(request, 'github', secret))
```

```ts
import { hookDoc } from '@yaks/hook'
import { docDoc } from '@yaks/doc'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab([docDoc, hookDoc])
// Give vocab to your graph and storage adapter. Once your receiver has recorded
// requests, read them with: await g.read('.hook.verified=true')
```

An entity is a record identified by `entity.eid`. A component, such as `hook`,
is a named object stored on that record. `docDoc` provides the optional title
and body component and the display kind referenced by this vocabulary.

## Compatibility

Deno, Node, browsers and Workers. `hooked()` is pure: no runtime calls and no
storage implementation. The signature checks use WebCrypto.
