# @yaks/hook

Defines a graph component for recording incoming webhook requests: their source,
event name, original HTTP body and headers, and signature-verification result.
It does not expose an HTTP endpoint or verify signatures itself.

## Stored data

`hook{source, event, payload, method, path, headers, verified}` stores:

- `source` and `event`: the sender and its event name.
- `payload` and `headers`: the original body and headers as strings, not parsed
  objects. Both declare `store: "blob"`; load [@yaks/blob](../blob) to store
  their text by content hash, or leave it unloaded for ordinary text columns.
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

The root import exports `hookDoc`, a JSON Schema document. `@yaks/hook/vocab`
also exports `docs: [hookDoc]` for plugin loaders.

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

Deno, Node and browsers. This package exports JSON declarations, with no runtime
calls or storage implementation.
