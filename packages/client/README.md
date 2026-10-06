# @yaks/client

Assembles a browser graph with server synchronization, reactive queries, and
IndexedDB persistence for local components and retained server data.

A **client** combines an in-memory [graph](../graph/README.md#data-model) with
optional synchronization and persistence (`Client`). It reads and writes
[bundles](../graph/README.md#data-model) using a shared
[vocabulary](../vocab/README.md#vocabulary).

A **watch** holds a [query](../query/README.md#query-model)'s current bundle
array and notifies listeners when it changes (`Watch`). A **watch registry**
creates and closes the watches on one graph (`Watches`).

A **vault** persists this browser's components independently of the server
(`Vault`). A **cache** tracks retained server data, subscription membership, and
[coverage](../graph/README.md#projections) around the in-memory graph
(`Retained`). A **wire vault** persists the cache's server data separately from
local components (`WireVault`).

## Install

```sh
deno add jsr:@yaks/client
# or: npx jsr add @yaks/client
```

## Use

This local client creates a recipe and watches matching entities. `mutate()`
applies a [batch](../graph/README.md#data-model) through the graph.

```ts
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

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
let dinners = box.watch('.recipe.course=dinner')
equal(dinners.value.length, 1)
equal(dinners.ready, true)
equal(box.ent(eid)?.doc, { title: 'Dal' })
equal(box.read('.recipe').length, 1)
let changes = 0
let stop = dinners.subscribe(() => changes++)
await box.mutate([{ entity: { eid }, recipe: { serves: 6 } }])
equal(changes, 1)
stop()
dinners.close()
box.close()
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

`client(vocab, plugins?, opts?)` returns these application methods:

| Method or property    | Behavior                                                              |
| --------------------- | --------------------------------------------------------------------- |
| `watch(query, opts?)` | Return a live query result.                                           |
| `read(query, opts?)`  | Read a query once, synchronously: the rows a watch on it would hold.  |
| `ent(eid)`            | Read one cached entity, or `undefined` when it is absent from memory. |
| `mutate(bundles)`     | Call the graph's `apply()`; returns bundles or a promise of bundles.  |
| `ready`               | Wait for local persistence and any configured epoch restore.          |
| `setEpoch(epoch)`     | Validate the server cache epoch and refresh remote subscriptions.     |
| `close()`             | Close all watches, the connection, and cache activity.                |

The returned `graph`, `watches`, `cache`, and optional `wire` connection remain
available. A deleted entity read by `ent()` carries a `tombstone` component; an
entity absent from this client's cache is not evidence of deletion.

To connect to a server implementing `@yaks/sync`, supply its base `url` and use
the same vocabulary on both ends. This example requires a running server and is
excluded from local tests.

```ts ignore
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const remote = client(loadVocab({ $defs: {} }), [], {
  url: 'https://recipes.example',
  vault: false,
})
equal(remote.wire !== undefined, true)
remote.close()
```

Server-synchronized edits normally apply locally before `POST /apply` completes.
Deletions wait for the server: the local tier keeps no inverse for one. Server
refusals can revert optimistic edits and are reported through `opts.report`.
Components declared `sync: none` stay local; `sync: peers` components are
relayed through the WebSocket. See [@yaks/sync](../sync/README.md) for transport
and failure behavior.

With a server connection, `mutate()` also accepts `alias: {name}` when the
vocabulary declares `alias`. A name may belong to an entity absent from the
page's cache, so this write waits for the server's resolved eid and then lands
its returned bundles locally. Browser-owned fields in the same batch follow that
eid and stay off the wire. The returned promise resolves to the applied bundles
or rejects on refusal or transport failure. A local-only client needs the
`@yaks/key` and `@yaks/alias` graph plugins to write names.

## Rules

The page's graph runs the vocabulary's
[declared rules](../graph/README.md#rules-over-more-than-one-entity) on the
page's own copy, which holds only what the page subscribed to:

- A rule whose writes are all `sync: none` components is the page's own. It runs
  on every batch, including what the server sends, and may refuse. A server
  never runs one.
- A rule the server runs too runs here only when its declaration says
  `optimistic: true`, and only on the page's own writes. What it adds shows at
  once; what it refuses throws from `mutate()` before anything is sent. When the
  server answers, what it added to server-kept components is undone in the same
  batch that lands the server's result, so the server's answer replaces it. When
  the server refuses, the write is undone with everything its rules added.
- Any other rule is the server's alone; its result arrives with the server's
  answer.

A client with no server is the whole graph, and runs every rule.

```ts
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      type: 'object',
      properties: {
        title: { type: 'string' },
      },
    },
    shelf: {
      component: true,
      type: 'object',
      properties: {
        aisle: { type: 'string' },
      },
    },
    shelve: {
      rule: true,
      optimistic: true,
      match: '.doc, +!shelf, +shelf.aisle=Z',
    },
  },
})
const box = client(vocab, [], { vault: false })
await box.mutate([{ entity: { eid: 'book' }, doc: { title: 'Dune' } }])
equal(box.ent('book')?.shelf, { aisle: 'Z' })
box.close()
```

A rule-created entity's id is derived from the rule and what it matched, so the
page's result and the server's name the same entity.

## Reactive queries

A watch exposes `value` (the current bundle array), `ready`,
`subscribe(listener)`, and `close()`:

Use `watches()` to add a watch registry to an existing graph:

```ts
import { watches } from '@yaks/client'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    note: {
      component: true,
      type: 'object',
      properties: { text: { type: 'string' } },
    },
  },
})
const g = graph({ vocab, storage: ram(vocab) })
const seen = watches(g)
const notes = seen.watch('.note .order=note.text')
await g.apply([{ entity: { eid: 'n' }, note: { text: 'hello' } }])
equal(notes.value.map((b) => b.note), [{ text: 'hello' }])
notes.close()
equal(seen.size(), 0)
seen.close()
```

An aggregate query (`.count`, `.tally=prop`, `.distinct=prop`) answers a value
instead of rows. A server watch carries it as `reduced`, in the shape `/query`
answers with (`{count}`, `{tally}` or `{distinct}`), undefined until the server
has answered; its `value` stays empty:

For a connected client, open `.task .tally=task.status` with
`{ evaluate: 'server' }` and read `watch.reduced` after `watch.ready` becomes
true. For example, the answer can be `{ tally: { done: 12, open: 3 } }`.

A server watch the server refused says why in `refused` (the refusal's message),
and is not ready, until the server answers it again.

Subscriptions report later result or readiness changes; read `value` for the
initial result. Local evaluation runs after committed graph changes, including
server updates. Queries about one entity's own values test only changed
entities. These results keep their initial order and append new matches. Queries
that follow references, order, limit, or aggregate run again against the store.
State an order explicitly, for example `.order=doc.title`, when order matters.
Unrelated writes do not notify listeners, and neither does a write that leaves
every entity it names as it was. A stamp the write adds is a change: in a graph
that stamps `updated`, writing the same values again still notifies.

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

A **holder** is an object with a replaceable `value` (`Hold`). A **signal
factory** creates holders (`Make`); pass one to make watch `value` and `ready`
reactive reads:

```ts
import { client, type Make } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const held: { value: unknown }[] = []
const signal: Make = (value) => {
  const holder = { value }
  held.push(holder)
  return holder
}
const box = client(loadVocab({ $defs: {} }), [], { signal, vault: false })
const all = box.watch('*')
equal(all.value, [])
equal(all.ready, true)
equal(held.some((holder) => holder.value === all.value), true)
equal(held.some((holder) => holder.value === all.ready), true)
box.close()
```

Pass `signal` from `@preact/signals` to use its reactive holders. A Preact
component that reads `dinners.value` or `dinners.ready` then subscribes to that
signal. The application closes the watch when it is no longer needed. No
rendering framework is imported by this package.

### With React

For a watch whose lifetime is managed by the application, React's
`useSyncExternalStore` can subscribe to it:

The React example requires a React application and is excluded from local tests.

```tsx ignore
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

| Declaration                                          | Storage and synchronization                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `sync: server` (default)                             | Sent to the server; eligible for the local server-data cache.                                                                   |
| `sync: none`, `durable: forever` (default lifetime)  | Persisted through the local `Vault`; never sent.                                                                                |
| `sync: none`, another lifetime                       | Held in memory, without local persistence.                                                                                      |
| `sync: peers`                                        | Relayed over the WebSocket, once per `pace` if it declares one.                                                                 |
| `sync: peers`, `durable: forever`, `save: ".player"` | Relayed as above; server saves the latest value when its stored entity matches the query. Saved snapshots restore it on reload. |

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
default database is `yaks`, with an object store named `local`, keyed by eid.
Use an application-specific name with `vault: idb({ name: 'recipes-local' })` in
`ClientOpts`.

`vault: false` disables local persistence. `stash()` provides the same interface
in memory for tests or an application-selected fallback; it does not survive a
process restart. Custom `Vault` implementations provide `load`, `save`, `drop`,
and `clear`. The vault only persists component values; queries run against the
RAM store.

A **saved entity** carries the persistence shape (`Saved`), such as
`{ eid: 'n', comps: { draft: { text: 'hello' } } }`. Both vault interfaces use
this shape; the vault selects local components, and the wire vault selects
server components.

This example uses an IndexedDB implementation in memory so it runs outside a
browser too. `keep()` attaches a vault to a graph; `client()` normally does that
for you. `localComps()` selects exactly the components the vault persists.

```ts
import { idb, keep, localComps, stash } from '@yaks/client'
import { IDBFactory } from 'npm:fake-indexeddb@^6.2.2'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    draft: {
      component: true,
      type: 'object',
      sync: 'none',
      durable: 'forever',
      properties: { text: { type: 'string' } },
    },
  },
})
const vault = idb({ name: 'draft-example', indexedDB: new IDBFactory() })
const g = graph({ vocab, storage: ram(vocab) })
await keep(g, vault).ready
await g.apply([{ entity: { eid: 'n' }, draft: { text: 'hello' } }])
const saved = await vault.load()
equal(saved[0].comps, { draft: { text: 'hello' } })
equal(localComps((await g.get(['n']))[0], vocab), saved[0].comps)
const memory = stash(saved)
equal(await memory.load(), saved)
await memory.drop(['n'])
equal(await memory.load(), [])
await vault.clear()
equal(await vault.load(), [])
```

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
coverage; raw batch feeds apply patches. Other subscriptions' covered fields,
local components, and unacknowledged writes are preserved. A `.fields`
projection covers only the properties it names, so it never clears one it did
not read; the entities its paths reach are held while it reaches them, and its
watch's `value` lists them after the selected ones, as `read()` does. A
transport failure with an unknown outcome keeps pending writes protected; it is
not an acknowledgement. Durable queuing and retry policy remain application
concerns.

### Restoring server data

Server persistence uses the wire vault. Configure
`vault: idb({ name: 'recipes-local' })` and
`wireVault: wireIdb({ name: 'recipes-server' })` in `ClientOpts`, then call
`setEpoch()` with the server's validated epoch.

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

The wire vault implements bounded persistence without a connection. A **saved
answer** stores a server query key, ordered membership, and coverage, without
component values (`SavedAnswer`).

```ts
import { type SavedAnswer, wireIdb, wireStash } from '@yaks/client'
import { IDBFactory } from 'npm:fake-indexeddb@^6.2.2'
import { equal } from '@yaks/testing'

const answer: SavedAnswer = {
  key: 'query-key',
  members: [['n', true]],
  peers: [],
}
for (
  const vault of [
    wireStash(),
    wireIdb({
      name: 'wire-example',
      indexedDB: new IDBFactory(),
    }),
  ]
) {
  equal(await vault.load('boot', 1), [])
  await vault.save('boot', [{ eid: 'n', comps: { doc: { title: 'Café' } } }], 1)
  equal((await vault.load('boot', 1)).map((r) => r.eid), ['n'])
  await vault.saveAnswers!('boot', [answer], 1_000)
  equal(await vault.loadAnswers!('boot', 1_000), [answer])
  equal(await vault.load('next', 1), [])
  equal(await vault.loadAnswers!('next', 1_000), [])
}
```

To attach a cache to an existing graph, use `retention()`. This checks coverage,
row notifications, and eviction after a subscription closes:

```ts
import { retention, watches } from '@yaks/client'
import { graph } from '@yaks/graph'
import { ram } from '@yaks/ram'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      type: 'object',
      properties: { title: { type: 'string' } },
    },
  },
})
const store = ram(vocab)
const g = graph({ vocab, storage: store })
const seen = watches(g)
const cache = retention(g, store, seen, { limit: 0 })
let changed = 0
const stop = cache.onRows(() => changed++)
cache.subscribe('s', '.doc', { prime: false })
await cache.land({
  id: 's',
  bundles: [
    { entity: { eid: 'n' }, doc: { title: 'Café' } },
  ],
})
equal(cache.loaded('n', 'doc', 'title'), true)
equal(cache.answer('s').map((b) => b.entity.eid), ['n'])
cache.unsubscribe('s')
equal(store.read('.doc'), [])
equal(changed > 0, true)
stop()
cache.close()
seen.close()
```

### Letting the server decide membership

A partial client cache cannot always evaluate a query correctly: referenced
entities, sort fields, or semantic vectors may be missing, and the RAM text
matcher differs from SQLite FTS. Use server evaluation for these queries:

The following uses an in-memory socket to supply server results without a
network. An application normally supplies only `url`, using the browser's
WebSocket and fetch implementations.

```ts
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const events = new EventTarget()
const sent: { id: string }[] = []
const socket = {
  readyState: 1,
  send: (data: string) => sent.push(JSON.parse(data)),
  close: () => {},
  addEventListener: events.addEventListener.bind(events),
}
const box = client(
  loadVocab({
    $defs: {
      doc: {
        component: true,
        type: 'object',
        properties: { title: { type: 'string' } },
      },
    },
  }),
  [],
  {
    url: 'https://example.test',
    connect: () => socket,
    fetch: () => Response.json([]),
    vault: false,
    wireVault: false,
  },
)
const hits = box.watch('café', { evaluate: 'server' })
equal(hits.ready, false)
const id = sent[0].id
const frame = (data: object) =>
  events.dispatchEvent(
    new MessageEvent('message', { data: JSON.stringify({ id, ...data }) }),
  )
frame({
  reset: true,
  bundles: [{ entity: { eid: 'n' }, doc: { title: 'Café' } }],
})
equal(hits.value.map((b) => b.entity.eid), ['n'])
equal(hits.ready, true)
const shared = box.watch('café', { evaluate: 'server' })
equal(shared.value, hits.value)
shared.close()
frame({ refused: { message: 'unavailable' } })
equal(hits.refused, 'unavailable')
equal(hits.ready, false)
const count = box.watch('.doc .count', { evaluate: 'server' })
events.dispatchEvent(
  new MessageEvent('message', {
    data: JSON.stringify({
      id: sent.at(-1)!.id,
      count: 1,
    }),
  }),
)
equal(count.reduced, { count: 1 })
equal(count.value, [])
box.close()
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
`Watch.value` remains a bundle array; it does not expose window metadata.
Application integration is described in [@yaks/web](../web/README.md) and
[@yaks/inspect](../inspect/README.md).

`cache.onRows(eids => ...)` observes entity changes, including commits,
eviction, epoch changes, and disk restoration. Read the current row with
`ent(eid)` to update application indexes. A missing row is not proof of
deletion. The callback runs synchronously, must not write to the graph, and
returns an unsubscribe function; closing the client clears callbacks. Observe
eviction through this API because it is a cache change, not a graph transaction.

For applications using `@yaks/sync` directly,
`wire.subscribe(query, id, { prime: false })` disables locally evaluated initial
membership. Ordinary subscriptions keep that behavior enabled.

## Limits

Queries run against [RAM](../ram/README.md), which does not implement every
SQLite query feature. Use server evaluation when a query needs data absent from
the cache or the server's ranking. The application supplies a validated epoch
and manages durable offline write queuing; [@yaks/sync](../sync/README.md)
provides the transport and failure behavior.

## Related packages

- [@yaks/graph](../graph/README.md): bundles, transactions, and plugins.
- [@yaks/ram](../ram/README.md): in-memory entity storage and queries.
- [@yaks/match](../match/README.md): per-bundle query matching.
- [@yaks/query](../query/README.md): query syntax.
- [@yaks/sync](../sync/README.md): HTTP and WebSocket synchronization.

## Verification

From the repository root, `deno task test packages/client` checks local and
remote watches, persistence, cache limits, query coverage, and restoration with
both in-memory and simulated IndexedDB storage.

## License

Apache-2.0

## Named server watches

`@yaks/client/named` gives a host names for server-evaluated watches. Watches on
the same query share one wire; a landed frame is reported with every name
holding it. The host supplies its vocabulary, socket and optional wire vault, so
the client knows no application's kinds, status or storage identity.

```ts
import { namedClient, quiet } from '@yaks/client/named'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'
const replica = namedClient({
  vocab: loadVocab([]),
  url: 'http://example.invalid',
  connect: quiet,
  changed: () => {},
  ready: () => {},
  frame: () => {},
})
equal(replica.active(), 0)
```

Application patch formats are adapted to bundles by the application; `patch` and
`receive` accept the graph and sync interfaces, not an app's data shape.
