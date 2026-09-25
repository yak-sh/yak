# @yaks/client

Create an in-memory graph with reactive queries, an optional server connection,
and optional IndexedDB persistence. Applications write and read **bundles**: one
entity's components as a JSON object. `client()` combines `@yaks/graph`,
`@yaks/ram`, `@yaks/match`, and `@yaks/sync`, and provides the storage and watch
lifecycle around them.

The graph holds entity data in RAM. Separate persistence interfaces store
browser-owned components and cached server data. See the
[graph architecture](../graph/ARCHITECTURE.md) for bundle structure and how
changes pass through the graph.

## Install

```sh
deno add jsr:@yaks/client
# or: npx jsr add @yaks/client
```

## Exports

All exports come from `@yaks/client`:

| Export                           | Purpose                                                                   |
| -------------------------------- | ------------------------------------------------------------------------- |
| `client`                         | Assemble the graph, storage, watches, and optional synchronization.       |
| `watches`                        | Add reactive queries to an existing graph.                                |
| `idb`, `stash`                   | IndexedDB and in-memory implementations of `Vault` for local components.  |
| `keep`, `localComps`             | Connect a `Vault` to a graph, or select the components it stores.         |
| `wireIdb`, `wireStash`           | IndexedDB and in-memory implementations of `WireVault` for server data.   |
| `retention`                      | Add cache retention to an existing graph, RAM store, and watch registry.  |
| `RETENTION_ROWS`, `ANSWER_BYTES` | Default cache budgets: 20,000 rows and 1,000,000 bytes of query metadata. |

The module also exports `Client`, `ClientOpts`, `ClientWatchOpts`, `Watch`,
`Watches`, `WatchOpts`, `WatchesOpts`, `Hold`, `Make`, `Vault`, `Saved`, `Kept`,
`IdbOpts`, `Retained`, `WireVault`, and `SavedAnswer` types.

## Use

This local-only example defines two components, creates a recipe, and watches
matching entities. A **batch** is a list of changes applied in one transaction;
the array passed to `mutate` is one batch.

```ts
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
    recipe: {
      component: true,
      type: 'object',
      properties: { serves: { type: 'number' }, course: { type: 'string' } },
    },
  },
})
let box = client(vocab, [], { vault: false })
let eid = crypto.randomUUID()
await box.mutate([{
  entity: { eid },
  doc: { title: 'Dal' },
  recipe: { serves: 4, course: 'dinner' },
}])
let dinners = box.watch('.course=dinner')
console.log(dinners.value.length) // 1
console.log(box.ent(eid)?.doc) // { title: 'Dal' }
dinners.close()
box.close()
```

`client(vocab, plugins?, opts?)` returns these application methods:

| Method or property    | Behavior                                                              |
| --------------------- | --------------------------------------------------------------------- |
| `watch(query, opts?)` | Return a live query result.                                           |
| `read(query, opts?)`  | Read matching bundles synchronously from RAM.                         |
| `ent(eid)`            | Read one cached entity, or `undefined` when it is absent from memory. |
| `mutate(change)`      | Call the graph's `apply()`; returns bundles or a promise of bundles.  |
| `ready`               | Wait for local persistence and any configured epoch restore.          |
| `setEpoch(epoch)`     | Validate the server cache epoch and refresh remote subscriptions.     |
| `close()`             | Close all watches, the connection, and cache activity.                |

The returned `graph`, `store`, `watches`, `cache`, and optional `wire`
connection remain available. A deleted entity read by `ent()` carries a
`tombstone` component; an entity absent from this client's cache is not evidence
of deletion.

To connect to a server implementing `@yaks/sync`, supply its base `url` and use
the same vocabulary on both ends:

```ts
let remote = client(vocab, [], { url: 'https://recipes.example' })
```

Server-synchronized edits normally apply locally before `POST /apply` completes.
Deletions wait for the server because graph deletion is permanent. Server
refusals can revert optimistic edits and are reported through `opts.report`.
Components declared `sync: none` stay local; `sync: peers` components are
relayed through the WebSocket. See [@yaks/sync](https://jsr.io/@yaks/sync) for
transport and failure behavior.

## Reactive queries

A watch exposes `value` (the current bundle array), `ready`,
`subscribe(listener)`, and `close()`:

```ts
let dinners = remote.watch('.course=dinner&.serves>4')
console.log(dinners.value, dinners.ready)
let stop = dinners.subscribe((bundles) => console.log(bundles))
stop() // Remove this listener.
dinners.close() // Release this watch handle.
```

Subscriptions report later result or readiness changes; read `value` for the
initial result. Local evaluation runs after committed graph changes, including
server updates. Queries about one entity's own values test only changed
entities. These results keep their initial order and append new matches. Queries
that follow references, order, limit, or aggregate run again against the store.
State an order explicitly, for example `.order=title`, when order matters.
Unrelated writes do not notify listeners.

### With a server

A watch opens a server subscription when the client has a URL, unless
`{ remote: false }` is passed. Identical query text and effective `now`,
`remote`, and `evaluate` options share local evaluation and the remote
subscription. Text is not normalized. Each caller gets an independent handle;
the last handle to close releases the shared subscription. `client.close()`
closes all handles.

For remote watches, `ready` remains false until the first server result has been
applied, even when cached rows are visible. An empty result also makes it true.
Disconnects and refusals make it false; a successful result after reconnecting
makes it true again. Readiness changes notify listeners even if `value` stays
the same.

A local watch becomes ready after its initial graph read. This differs from
`client.ready`, which waits for stored local components and any restore started
by `opts.epoch`. Await `client.ready` before opening a local watch that must
include restored drafts.

### With signals

Pass a signal factory to make `value` and `ready` reactive reads. For example,
with `@preact/signals`:

```ts
import { signal } from '@preact/signals'

let reactive = client(vocab, [], { signal })
let dinners = reactive.watch('.course=dinner')
```

A Preact component that reads `dinners.value` or `dinners.ready` then subscribes
to that signal. The application closes the watch when it is no longer needed. No
rendering framework is imported by this package.

### With React

For a watch whose lifetime is managed by the application, React's
`useSyncExternalStore` can subscribe to it:

```tsx
import { useSyncExternalStore } from 'react'
import type { Watch } from '@yaks/client'

function Count({ watch }: { watch: Watch }) {
  let bundles = useSyncExternalStore(watch.subscribe, () => watch.value)
  let ready = useSyncExternalStore(watch.subscribe, () => watch.ready)
  return <span>{ready ? bundles.length : 'Loading…'}</span>
}
```

The snapshot array stays stable between result updates. Keep the watch stable
across component renders and close it when its owner disposes it.

## Component storage

A component's `sync` and `durable` vocabulary keywords determine its storage:

| Declaration                                         | Storage and synchronization                                    |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `sync: server` (default)                            | Sent to the server; eligible for the local server-data cache.  |
| `sync: none`, `durable: forever` (default lifetime) | Persisted through the local `Vault`; never sent.               |
| `sync: none`, another lifetime                      | Held in memory, without local persistence.                     |
| `sync: peers`                                       | Relayed over the WebSocket; requires a non-permanent lifetime. |

For example, add this component to the vocabulary to persist a local draft:

```json
{
  "$defs": {
    "draft": {
      "component": true,
      "type": "object",
      "sync": "none",
      "durable": "forever",
      "properties": { "text": { "type": "string" } }
    }
  }
}
```

All components use the same graph write API. After a commit, the local `Vault`
stores the entity's complete set of persistent local components, read from the
graph. Patches therefore preserve other fields, removed components disappear
from persistence, and deleted entities are dropped. Loading stored data does not
overwrite edits or deletions made while loading was in progress.

### Where it is stored

In environments with IndexedDB, `idb()` is the default local `Vault`. Its
configuration accepts `name`, `store`, and an `indexedDB` implementation. The
default database is `yaks`, with an object store named `local`, keyed by entity
id. Use an application-specific name:

```ts
import { idb } from '@yaks/client'

let persistent = client(vocab, [], { vault: idb({ name: 'recipes-local' }) })
await persistent.ready
```

`vault: false` disables local persistence. `stash()` provides the same interface
in memory for tests or an application-selected fallback; it does not survive a
process restart. Custom `Vault` implementations provide `load`, `save`, `drop`,
and `clear`. The vault only persists records; queries run against the RAM store.

## Options

| Option               | Default                    | Purpose                                                                                  |
| -------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| `url`                | none                       | Server base URL; omitted for a local-only graph.                                         |
| `fetch`, `connect`   | global fetch and WebSocket | HTTP requests and socket creation.                                                       |
| `timer`              | `setTimeout`               | Reconnect and deferred cache-write scheduling.                                           |
| `headers`            | none                       | Headers added to `POST /apply`.                                                          |
| `wait`, `most`       | 250, 30,000 ms             | Initial and maximum reconnect delay.                                                     |
| `report`             | console warning            | Receive synchronization and server-cache failures.                                       |
| `vault`              | `idb()` when available     | Persistence for local components, or `false`.                                            |
| `wireVault`          | `wireIdb()` when available | Persistence for server data, or `false`.                                                 |
| `epoch`              | none                       | Validated server epoch for restoring server data.                                        |
| `retention`          | 20,000                     | Maximum inactive server rows retained.                                                   |
| `answerBytes`        | 1,000,000                  | Encoded byte budget for retained server query metadata.                                  |
| `retainUnownedProps` | false                      | Keep previously read fields for display after their subscription ends.                   |
| `signal`             | plain object               | Factory for watch `value` and `ready` containers.                                        |
| `mint`               | random UUID                | Id generator for entities created through aliases.                                       |
| `provenance`         | graph default              | Policy for `created` and `updated` attribution; return `null` to leave it to the server. |

## Compatibility

Browser, Deno, Node, Bun, and Cloudflare Workers. The package uses standard web
APIs and type-checks with `lib: ["dom", "esnext"]` without Deno types. Fetch,
socket creation, timers, and persistence can be supplied by the caller.
Environments without IndexedDB have no persistence unless given a vault.

## Server cache and restoration

By default, the client retains up to 20,000 server rows that no open
subscription covers. `retention: 0` keeps none of those inactive rows. Open
subscriptions and unacknowledged local writes protect their rows from eviction
and do not count against this limit. Local-only graphs do not evict the sole
copy of locally written data.

`ent()` and `read()` mark returned rows as recently used. Storage enumeration
and watch refreshes do not. The least recently read inactive rows are evicted
first, without changing query order. Eviction removes server data from RAM and
notifies watches. It sends no deletion, creates no tombstone, triggers no
cascade, and preserves local drafts and identity reservations. The row limit
does not bound active rows, pending writes, local components, or identity
reservations.

Subscriptions can share rows and cover different properties. A query reporting
an entity as `gone` removes its own membership without removing another
subscription's data. Query snapshots replace fields within their declared
coverage; raw change feeds apply patches. Other subscriptions' covered fields,
local components, and unacknowledged writes are preserved. A transport failure
with an unknown outcome keeps pending writes protected; it is not an
acknowledgement. Durable queuing and retry policy remain application concerns.

### Restoring server data

Server persistence is separate from the local component vault:

```ts
import { wireIdb } from '@yaks/client'

let cached = client(vocab, [], {
  url: 'https://recipes.example',
  vault: idb({ name: 'recipes-local' }),
  wireVault: wireIdb({ name: 'recipes-server' }),
  retention: 20_000,
})
// After obtaining the server's current epoch, call cached.setEpoch(epoch).
```

An **epoch** is the server-supplied identifier for the dataset version whose
cached state remains valid. Pass a validated epoch as `opts.epoch`, or call
`await cached.setEpoch(epoch)` after obtaining it. The latter also refreshes
open subscriptions and makes them not ready. Epoch negotiation belongs to the
application; a value read from disk alone does not validate the current server
state. Until an epoch is supplied, server persistence performs no reads or
writes. With `opts.epoch`, `client.ready` waits for that restore too.

`wireIdb()` defaults to the separate `yaks-wire` database. Its name must differ
from the local vault's database. `wireVault: false` disables server persistence
without disabling drafts. `wireStash()` is its in-memory equivalent. Custom
`WireVault` implementations provide `load`, `save`, and `drop`, with optional
`loadAnswers` and `saveAnswers` for query metadata.

An epoch mismatch clears persisted server rows and query metadata atomically.
Saves and drops check the epoch in their transaction, preventing a late write
from a tab on an older epoch. Disk storage keeps the newest written rows up to
the row limit, including rows covered by subscriptions. IndexedDB restoration
uses bounded index cursors and removes excess old records by key.

Restored rows can be displayed while subscriptions are not ready. Rows already
in memory and edits made while loading take precedence. Any intervening server
result, including an empty result, cancels a late restore. A newer epoch or
closing the client also cancels an older restore.

`await cached.cache.idle()` waits for queued server-persistence writes.
`cached.cache.size()` counts inactive rows in memory, and
`cached.cache.answerBytes()` reports retained query metadata size.

### Letting the server decide membership

A partial client cache cannot always evaluate a query correctly: referenced
entities, sort fields, or semantic vectors may be missing, and the RAM text
matcher differs from SQLite FTS. Use server evaluation for these queries:

```ts
let hits = cached.watch('café', { evaluate: 'server' })
```

The query text is not parsed or evaluated locally. The server validates it and
sends results or a refusal. Result membership and order come from server frames.
A full replacement establishes both; later changes update members without
re-sorting existing entries. A ranking change therefore requires a replacement
result. Local edits update existing members immediately but cannot add unrelated
entities to a server-ranked result.

Server evaluation requires a remote watch: it rejects `remote: false` and
clients without a URL. Sharing, independent handle cleanup, readiness,
reconnects, and refusals work as for other remote watches.

The client retains ordered membership and property coverage for server-evaluated
queries under the exact watch key. A reopened watch can restore these results
from memory or, under the same validated epoch, from its `WireVault`. It uses
only retained rows and fields; it never infers matches from unrelated cached
entities. `ready` stays false until the server answers. Without retained query
metadata, a newly opened server-evaluated watch starts empty. A disconnected
standing watch keeps its last value.

Query metadata has a separate `answerBytes` budget, including query text, ids,
and coverage. Older entries are discarded when needed. A result larger than the
whole budget is not retained; its active watch is not truncated.

### Property coverage and cache notifications

`cache.loaded(eid, component, property?)` reports whether an open subscription
covers that field. A false result means the client has no coverage for it, not
that it was deleted. A covered field may be absent because the server confirmed
its absence. Additional referenced entities supplied with a result remain
available through `ent()` without becoming query members.

`retainUnownedProps: true` keeps previously read fields available for display
after their covering subscription ends, within the row budget. They are not
reported as loaded. A new covering result, deletion, or epoch change still
reconciles them. Restored coverage is restricted to fields present in memory.
`Watch.value` remains a bundle array; it does not expose aggregate or window
metadata. Application integration is described in [@yaks/web](../web/README.md).

`cache.onRows(eids => ...)` observes entity changes, including commits,
eviction, epoch changes, and disk restoration. Read the current row with
`ent(eid)` to update application indexes. A missing row is not proof of
deletion. The callback runs synchronously, must not write to the graph, and
returns an unsubscribe function; closing the client clears callbacks. Observe
eviction through this API because it is a cache change, not a graph transaction.

For applications using `@yaks/sync` directly,
`wire.subscribe(query, id, { prime: false })` disables locally evaluated initial
membership. Ordinary subscriptions keep that behavior enabled.

## Related packages

- [@yaks/graph](../graph/README.md): bundles, transactions, and plugins.
- [@yaks/ram](../ram/README.md): in-memory entity storage and queries.
- [@yaks/match](https://jsr.io/@yaks/match): per-bundle query matching.
- [@yaks/query](../query/README.md): query syntax.
- [@yaks/sync](https://jsr.io/@yaks/sync): HTTP and WebSocket synchronization.

## Verification

From the repository root, `deno test packages/client/` checks local and remote
watches, persistence, cache limits, query coverage, and restoration with both
in-memory and simulated IndexedDB storage.

## License

Apache-2.0
