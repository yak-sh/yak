# @yaks/client

A client-side graph: in-memory storage, reactive queries, optional
synchronization with a server, and persistence in the browser. `client()`
assembles the graph, RAM, match and sync packages into one object, which an
application uses to write bundles and watch query results.

For bundle structure, write phases, and what a storage adapter is responsible
for, see the [graph architecture](../graph/ARCHITECTURE.md).

## Install

```sh
deno add jsr:@yaks/client
# or: npx jsr add @yaks/client
```

## Use

The examples are a shared recipe box: recipes with a course and a serving count,
notes about them, cooks who wrote them, and a draft of what this cook is typing.

```ts
import { client } from '@yaks/client'
import { loadVocab } from '@yaks/vocab'

let recipeBox = {
  $defs: {
    doc: { type: 'object', properties: { title: { type: 'string' } } },
    recipe: {
      type: 'object',
      properties: { serves: { type: 'number' }, course: { type: 'string' } },
    },
  },
}
let vocab = loadVocab(recipeBox)
let box = client(vocab, [], { url: 'https://recipes.example' })

box.mutate([{
  entity: { eid: crypto.randomUUID() },
  doc: { title: 'Dal' },
  recipe: { serves: 4, course: 'dinner' },
}])
```

`client(vocab, plugins, opts)` takes a vocabulary, your plugins, and options. It
returns the graph, the synchronization client, the watches, and these four
shorthands:

```ts
box.watch('.course=dinner') // a live result (below)
box.read('.course=dinner') // the result now, synchronously
box.ent('r1') // one entity, whole, by id
box.mutate([...]) // apply changes locally, then POST them
```

Everything it built stays reachable — `box.graph` is an ordinary graph, with
`apply()`, `read()` and `use()` on it. This package adds no layer over them.

## A query is a value

```ts
let dinners = box.watch('.course=dinner&.serves>4')

dinners.value // → the bundles, now (possibly from the cache)
dinners.ready // → the current subscription has answered
let stop = dinners.subscribe((bundles) => paint(bundles)) // → the next ones
stop() // stop this listener only
dinners.close() // close this handle; the last handle stops the shared watch
```

A watch re-evaluates on the graph's own `effect` phase, so it sees every
committed transaction — the ones this page wrote and the ones the server pushed.
How it re-evaluates depends on the query:

- A query that asks only about each entity itself (`.course=dinner&.serves>4`)
  is tested one bundle at a time by [@yaks/match](https://jsr.io/@yaks/match)'s
  `filter`, against the entities the transaction changed. Nothing else is read,
  however many entities the page holds. The result keeps **first-match order**,
  with a new match appended at the end.
- A query whose result is a property of the whole set — it follows a reference,
  orders, limits or counts — is **run again** and compared. `.order=title`
  therefore both defines the order and puts the watch in this mode.

Listeners are called when the result or the readiness changes. An unrelated
write does not call them.

### With a server

When the client has a `url`, opening a watch also opens the **server's**
subscription for that query. Identical query text with identical effective
options (`now`, `remote`, `evaluate`) shares one local evaluation and one server
subscription. Each call returns an independent handle: closing one removes only
its listeners; the last close drops the shared subscription. `client.close()`
closes every handle. The query text is never normalized. Pass
`{ remote: false }` for a watch over data that is already local.

`watch.ready` is false until the server's first result has been applied, even
when cached rows are already on screen. An empty result makes it true as well.
It returns to false on a disconnect or a refused subscription, and becomes true
again once the reconnect has been answered. `subscribe` is called on readiness
changes even when `value` has not changed. A local-only watch becomes ready
after its first read; that is separate from `client.ready`, which is the promise
for loading this browser's own stored components. Await that promise before
opening a local watch that has to include restored drafts.

### With signals

`watch()` depends on no framework: `value` plus `subscribe` is the whole of it.
Pass `client` a signal factory and both `value` and `ready` become signal reads
instead, which is all a signals-based renderer needs to track them. Nothing is
imported — the factory is yours:

```tsx
import { signal } from '@preact/signals'

let box = client(vocab, [], { url, signal })
let dinners = box.watch('.course=dinner')

// Inside a component: reading `.value` subscribes the component to it.
let Dinners = () => <ul>{dinners.value.map((b) => <Recipe bundle={b} />)}</ul>
```

### With React

`subscribe` and `value` are exactly `useSyncExternalStore`'s two halves:

```tsx
let useWatch = (query: string) => {
  let watch = useMemo(() => box.watch(query), [query])
  useEffect(() => () => watch.close(), [watch])
  return useSyncExternalStore(watch.subscribe, () => watch.value)
}
```

The snapshot is a new array only when the result changed, so React re-renders
when the result changes and not otherwise. To track loading separately, use
`useSyncExternalStore(watch.subscribe, () => watch.ready)` as well.

## Two keywords, one apply()

A client holds state the server owns, state this browser owns, and state that
disappears with the tab. Which is which is declared by the component itself, in
[@yaks/vocab](https://jsr.io/@yaks/vocab)'s `sync` and `durable` keywords:

```json
{
  "$defs": {
    "draft": {
      "type": "object",
      "sync": "none",
      "properties": { "text": { "type": "string" } }
    }
  }
}
```

- **`sync: server`** (the default) belongs to the server. @yaks/sync POSTs it
  and applies what comes back.
- **`sync: none` with `durable: forever`** belongs to this browser. It is
  written through to IndexedDB after each commit and loaded back at start-up — a
  draft survives a reload, and it is never sent to the server.
- **`sync: none` otherwise** disappears with the tab: held in the graph, written
  down nowhere.

All three go through the same `apply()`. What this browser stored is back in the
graph by the time `ready` resolves:

```ts
let box = client(vocab, [], { url })
await box.ready
box.ent('r1') // the draft is here again
```

What is written through is the entity's whole set of browser-owned components,
read back from the store after the commit — so a patch merges the way every
other patch does, a component that was removed is removed from IndexedDB too,
and a deleted entity is dropped from it.

### Where it is stored

`idb()` is the default in a browser: one database, one object store keyed by
eid. Give each application its own database name, and pass an IndexedDB when the
global one is not the one you want:

```ts
import { client, idb } from '@yaks/client'

let box = client(vocab, [], { url, vault: idb({ name: 'recipes' }) })
```

`vault: false` stores nothing. `stash()` is a vault in memory — what a test
uses, and what a page can fall back to when the browser refuses storage. An
application with its own storage implements the four functions of `Vault`
(`load`, `save`, `drop`, `clear`) and passes that.

A vault is deliberately **not** a `Storage`: a Storage evaluates queries, and
queries here are already evaluated against the map @yaks/ram holds. What was
missing is durability, so the interface is the four things durability needs. It
lives here until a second implementation makes a package of its own worth
publishing.

## Options

| option              | default                        | what it is                             |
| ------------------- | ------------------------------ | -------------------------------------- |
| `url`               | none — a local-only graph      | the server's base URL                  |
| `fetch` / `connect` | the globals                    | how @yaks/sync POSTs and opens sockets |
| `timer`             | `setTimeout`                   | how a reconnect is scheduled           |
| `headers`           | none                           | headers added to every `POST /apply`   |
| `wait` / `most`     | 250 / 30_000                   | the reconnect backoff, in ms           |
| `report`            | a console warning              | where a refusal or failure is reported |
| `vault`             | `idb()` where a browser has it | where this browser's state is stored   |
| `signal`            | a plain object                 | the factory each `value` is held in    |
| `mint`              | `crypto.randomUUID()`          | how an eid is made for an alias        |

## Compatibility

**Browser, Deno, Node, Bun, and Cloudflare Workers.** The package imports no
runtime-specific API: `fetch`, `WebSocket` and `indexedDB` are all read from
options (the globals are only the default), and it type-checks under
`lib: ["dom", "esnext"]` with no `Deno` types in the compile at all. A runtime
with no IndexedDB simply stores nothing unless it is passed a vault. Its
dependencies are the sibling packages listed below.

Outside a browser, what this package is for is the assembly and the watches: a
worker, a test, or a CLI holding a working set gets the same live queries.

## The working set, and restoring the server's rows

By default the client keeps **20,000 rows that no open subscription covers**
(`retention: n` changes the limit; `0` keeps none of them). A local-only graph
never evicts the only copy of data written locally. The members of an open
subscription, and rows with a local write the server has not acknowledged, do
not count against that limit and are never evicted to meet it. Identical watches
still share one subscription; different subscriptions can hold the same row. One
query reporting an entity as `gone` removes it from that query's result without
taking the row away from another subscription that holds it.

`ent()` and `read()` mark the rows they touch as recently used. Enumerating
storage and refreshing a watch do not, and marking a row never changes a query's
order or first-match order. Reopening a query claims its cached rows before the
first frame arrives. Cached values can be rendered, but `ready` stays false. The
server's first frame reconciles whatever is missing, including rows that were
retained for a different query. A frame carrying a whole query result replaces
fields absent from it; a raw feed stays a patch. Neither path overwrites a
browser-owned or in-memory component. A subscription result cannot overwrite a
local write the server has not acknowledged; the response to the POST reconciles
it. A transport failure with an unknown outcome keeps the row pinned: it is
**not** an acknowledgement. A durable outbox and a retry policy belong to the
application.

Eviction is not deletion: it writes no tombstone, cascades to nothing, POSTs
nothing, and erases no drafts. RAM removes the server-synchronized data and
notifies the watches. The compact eid and entity-number reservations survive
eviction, so restoring an eid does not create a new entity; deletions stay
permanent. The limit bounds only those uncovered rows: not rows a subscription
covers, not rows with a pending write, not browser-owned or in-memory data, and
not those identity reservations. Because eviction is a cache operation and not a
committed transaction, an application maintaining its own derived indexes must
use `cache.onRows` (below) rather than treating an eviction as a user deletion.

The server's rows are stored separately from the browser's own `Vault`:

```ts
import { client, idb, wireIdb } from '@yaks/client'

let box = client(vocab, [], {
  url,
  vault: idb({ name: 'recipes-local' }),
  wireVault: wireIdb({ name: 'recipes-wire' }),
  retention: 20_000,
})
await box.setEpoch(authoritativeBootEpoch)
```

An epoch you have already validated can instead be passed as `opts.epoch`; then
`client.ready` waits for both the browser's own state and the server's rows to
be restored. Without a validated epoch there are **no disk reads or writes at
all** for the server's rows. Never pass an epoch read back from disk as proof of
the server's current epoch. `setEpoch()` also asks the open subscriptions for
fresh results and marks them not ready. Negotiating the epoch, and any boot
messages specific to your application, are the application's job.

`wireIdb()` defaults to a **separate** `yaks-wire` database; `idb()` defaults to
`yaks`. Use distinct names. `wireVault: false` turns off disk storage for the
server's rows without turning it off for this browser's drafts. `wireStash()` is
the in-memory implementation of the same three-function `WireVault` interface. A
mismatched epoch atomically clears the server's rows and nothing else. Saves and
deletes check the epoch inside their own transaction, so a tab still on the
previous epoch cannot bring its rows back. On disk, the newest rows written are
kept up to the limit, including rows a subscription covers; in memory, rows are
evicted least-recently-read first. Reads walk bounded index cursors, and data
left over from an earlier, larger budget is deleted by key rather than read in
with `getAll()`.

What is restored from disk is there so the page has something to show, not proof
that anything is current. Rows already in memory, and writes made while the
database was opening, win over it; any answer that arrived over the socket in
the meantime — even an empty one — cancels a restore that finishes late. A newer
epoch, or closing the client, cancels an older restore. Loading the browser's
own vault likewise cannot overwrite an edit made while it was loading.
`await box.cache.idle()` waits for the queued disk writes, and
`box.cache.size()` reports how many uncovered rows are held in memory.

The Tasks frontend adapter, protocol and epoch negotiation, a durable outbox and
refusal ledger, closer query parity and the scratch-probe CDP comparisons are a
later phase of the integration; this package does not yet replace `src/live.ts`.

### Letting the server decide membership

A partial cache cannot prove what a server query selects. RAM's text matcher is
not SQLite FTS, and a reference the query follows, a column it orders by, or a
semantic vector may never have been sent to the browser at all. So a watch can
opt out of parsing, evaluating or pre-filling the query locally:

```ts
let hits = box.watch('café', { evaluate: 'server' })
```

The query text is opaque on this path. The server has to validate it and send
ordinary bundle frames, or a refusal. Membership and order come only from those
frames: a frame carrying the whole result replaces both, while a frame carrying
only changes updates the members already held without re-sorting them — so a
change in ranking has to be sent as a whole result. A local edit to an entity
already in the result updates it immediately but cannot change membership, and
an unrelated local write cannot insert itself into a ranked server result.
Entity data still lives only in memory, and another subscription reporting an
entity as `gone` cannot remove a row this one holds. `ready`, sharing by
reference count, independent closing, and the behaviour on reconnect and refusal
are the same as for any other remote watch. The evaluation mode is part of the
key watches are shared under. Server evaluation requires a remote watch:
`remote: false`, or a client with no URL, is refused rather than quietly
reinterpreted.

This is **not yet a full rich-query protocol**. `Watch.value` is still bundles,
not a map of aggregates or a semantic score. Which columns a subscription
covers, peer coverage, `tally` and window metadata, and persisting the
membership of an ordered query all need the adapter work described in
[the Tasks migration audit](../../docs/CLIENT_MIGRATION.md). In particular, a
server-evaluated watch starts empty when it is newly opened, even when retained
or restored rows exist: a standing watch keeps its last result while
disconnected (`ready=false`), but closing and reopening one does not guess a
result from the rows it still has. Do not read this mode as a claim that
reopening before the first frame is at parity.

`box.cache.onRows(eids => ...)` is called when entity data changed, including
eviction from memory, an epoch mismatch, and a restore from disk. Read each
current row with `box.ent(eid)` to update indexes your application derives; a
missing row means not loaded, not deleted. The callback runs synchronously after
the change, returns a function that unsubscribes it, and is cleared when the
client closes. It is where an application observes these changes, not a second
place to cache them, and it must not write to the graph. Code using @yaks/sync
directly can turn off local ownership pre-filling with
`wire.subscribe(query, id, { prime: false })`; ordinary subscriptions keep it.

## Related packages

[@yaks/graph](https://jsr.io/@yaks/graph) defines the bundles and `apply()`;
[@yaks/ram](https://jsr.io/@yaks/ram) is the map this keeps them in;
[@yaks/match](https://jsr.io/@yaks/match) tests a bundle against a query;
[@yaks/query](https://jsr.io/@yaks/query) is the query grammar both sides use;
[@yaks/sync](https://jsr.io/@yaks/sync) is the HTTP and WebSocket connection to
the server, and defines the `sync` keyword that decides what goes over it.

## License

Apache-2.0
