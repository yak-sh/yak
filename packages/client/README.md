# @yaks/client

A client-side graph with in-memory storage, reactive queries, optional server
synchronization, and local persistence. `client()` composes the graph, RAM,
match, and sync packages; applications use one client API to write bundles and
watch query results.

For bundle structure, write phases, and adapter responsibilities, see the
[graph architecture](../graph/ARCHITECTURE.md).

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
import { syncKeywords } from '@yaks/sync'

let recipeBox = {
  $defs: {
    doc: { type: 'object', properties: { title: { type: 'string' } } },
    recipe: {
      type: 'object',
      properties: { serves: { type: 'number' }, course: { type: 'string' } },
    },
  },
}
let vocab = loadVocab(recipeBox, [syncKeywords])
let box = client(vocab, [], { url: 'https://recipes.example' })

box.mutate([{
  entity: { eid: crypto.randomUUID() },
  doc: { title: 'Dal' },
  recipe: { serves: 4, course: 'dinner' },
}])
```

`client(vocab, plugins, opts)` accepts a vocabulary, application plugins, and
options. It exposes the graph, synchronization client, watches, and these
convenience methods:

```ts
box.watch('.course=dinner') // a live answer (below)
box.read('.course=dinner') // one answer, now, synchronously
box.ent('r1') // one entity, whole, by id
box.mutate([...]) // a batch: locally at once, then forwarded
```

Everything it built stays reachable — `box.graph` is an ordinary graph, with
`apply()`, `read()` and `use()` on it. This package adds no layer over them.

## A query is a value

```ts
let dinners = box.watch('.course=dinner&.serves>4')

dinners.value // → the bundles, now (possibly cached)
dinners.ready // → the current subscription has answered
let stop = dinners.subscribe((bundles) => paint(bundles)) // → the next ones
stop() // this listener only
dinners.close() // this handle; the last handle stops the shared watch
```

A watch re-evaluates on the graph's own `effect` phase, so it hears every
committed batch — the ones this page wrote and the ones the server pushed. How
it answers depends on the query:

- A query that asks only about each entity itself (`.course=dinner&.serves>4`)
  is judged one bundle at a time by [@yaks/match](https://jsr.io/@yaks/match)'s
  `filter`, against the entities the batch touched. Nothing else is read,
  however many entities the page holds. The answer keeps **first-match order**,
  with a newcomer at the end.
- A query whose answer is a property of the whole set — it follows a reference,
  orders, windows or counts — is **read again** and compared. `.order=title`
  therefore both defines the order and puts the watch in this mode.

The watch fires when its result or readiness changes. An unrelated write does
not wake it.

### With a server

When the client has a `url`, opening a watch also opens the **server's**
subscription for that query. Identical query text and effective options (`now`,
`remote`) share one local evaluation and one server subscription. Each call
returns an independent handle: closing one removes only its listeners; the last
close drops the shared subscription. `client.close()` closes every handle. No
query-text normalization is performed. Pass `{ remote: false }` for a watch over
data that is already local.

`watch.ready` is false until the server's first answer is successfully applied,
even if cached rows can already paint. An empty answer makes it true too. It
returns to false on disconnect or subscription refusal, and becomes true again
after the reconnect answer. `subscribe` notifies on readiness changes even when
`value` has not changed. A local-only watch becomes ready after its initial
read; this is separate from `client.ready`, the promise for local-vault
hydration. Await that promise when opening a local watch that must include
restored drafts.

### With signals

`watch()` is framework-free: `value` plus `subscribe` is all of it. Hand
`client` a signal factory and both `value` and `ready` are signal reads instead,
which is all a signals-based renderer needs to track it. Nothing is imported —
the factory is yours:

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
when the result changes and not otherwise. To track loading independently, use
`useSyncExternalStore(watch.subscribe, () => watch.ready)` as well.

## Three tiers, one apply()

A client holds state the server owns, state this browser owns, and state that
dies with the tab. Which is which is declared on the component, as
[@yaks/sync](https://jsr.io/@yaks/sync)'s `persist` keyword:

```json
{
  "$defs": {
    "draft": {
      "type": "object",
      "persist": "local",
      "properties": { "text": { "type": "string" } }
    }
  }
}
```

- **`wire`** (the default) is the server's. @yaks/sync posts it and applies what
  comes back.
- **`local`** is this browser's. It is written through to IndexedDB after each
  commit and loaded back at boot — a draft survives a reload, and it is not sent
  to the server.
- **`none`** dies with the tab: held in the graph, written down nowhere.

All three use the same `apply()`. The local tier is back in the graph by the
time `ready` resolves:

```ts
let box = client(vocab, [], { url })
await box.ready
box.ent('r1') // the draft is here again
```

What is written through is the entity's whole local state, read back from the
store after the commit — so a patch merges the way every other patch does, a
dropped component is dropped from the vault too, and a dead entity leaves it.

### Where it is kept

`idb()` is the default in a browser: one database, one object store keyed by
eid. Name it per application, and hand in an IndexedDB where the global is not
the one you want:

```ts
import { client, idb } from '@yaks/client'

let box = client(vocab, [], { url, vault: idb({ name: 'recipes' }) })
```

`vault: false` keeps nothing. `stash()` is a vault in memory — what a test uses,
and what a page can fall back to where the browser refuses storage. A host with
its own store implements the four members of `Vault` (`load`, `save`, `drop`,
`clear`) and passes that.

A vault is deliberately **not** a `Storage`: storage answers queries, and the
queries are already answered by the map @yaks/ram holds. What was missing is
durability, so the interface is the four things durability needs. It lives here
until a second implementation makes it worth its own package.

## Options

| option              | default                        | what it is                           |
| ------------------- | ------------------------------ | ------------------------------------ |
| `url`               | none — a local-only graph      | the server's base URL                |
| `fetch` / `connect` | the globals                    | the two transports @yaks/sync uses   |
| `timer`             | `setTimeout`                   | how a reconnect is scheduled         |
| `headers`           | none                           | headers on every `POST /apply`       |
| `wait` / `most`     | 250 / 30_000                   | the reconnect backoff, in ms         |
| `report`            | a warning                      | where a refusal or failure surfaces  |
| `vault`             | `idb()` where a browser has it | where the local tier is kept         |
| `signal`            | a plain object                 | the factory each `value` is held in  |
| `mint`              | `crypto.randomUUID()`          | what names an entity minted by alias |

## Compatibility

**Browser, Deno, Node, Bun, and Cloudflare Workers.** The package imports no
platform API: `fetch`, `WebSocket` and `indexedDB` are all looked up through
options (the globals are only a default), and it type-checks under
`lib: ["dom", "esnext"]` with no `Deno` types in the compile at all. A runtime
with no IndexedDB simply keeps nothing unless it is handed a vault. Its
dependencies are the sibling packages listed below.

Outside a browser the interesting part is the assembly and the watches: a
worker, a test, or a CLI holding a working set gets the same live queries.

## Related packages

[@yaks/graph](https://jsr.io/@yaks/graph) owns the bundles and `apply()`;
[@yaks/ram](https://jsr.io/@yaks/ram) is the map this keeps them in;
[@yaks/match](https://jsr.io/@yaks/match) judges a bundle against a query;
[@yaks/query](https://jsr.io/@yaks/query) is the grammar both sides speak;
[@yaks/sync](https://jsr.io/@yaks/sync) is the wire to the server, and the
`persist` keyword that says which state goes over it.

## License

Apache-2.0

## Bounded working set and server-tier restore

The client retains **20,000 inactive wire rows** by default (`retention: n`
changes the bound; zero disables the inactive floor). Local-only graphs do not
evict their sole copy of locally written data. Active subscription members and
pending optimistic writes do not consume that budget and are never evicted to
meet it. Identical watches still share the phase-1 subscription; different
subscriptions share payload ownership. A query's `gone` removes it from that
answer without stripping another owner's row.

`ent()` and `read()` touch the inactive LRU. Storage enumeration and watch
refreshes do not touch it, and touching never changes query/first-match order.
Reopening a query pins its cached hits before the first frame. Cached values can
paint, but `ready` stays false. The authoritative first frame reconciles missing
hits, including hits retained from a different query. Whole query rows replace
absent wire fields; raw feeds remain patches. Neither path overwrites local or
`none` components. A subscription snapshot cannot overwrite a pending local
write; the post response reconciles it. An uncertain transport failure keeps its
pin: it is **not** an acknowledgement (a durable outbox/retry policy belongs to
the host).

Eviction is not graph deletion: it does not tombstone, cascade, send an outbound
write, or erase drafts. RAM physically removes wire-only payloads and notifies
watches. Compact eid/number reservations survive eviction, so restoring an eid
is not a new birth; genuine tombstones remain permanent. The inactive
**payload** bound does not bound active rows, pending writes, local/ephemeral
data, or these identity reservations. Eviction is a cache operation, not a
committed graph batch; hosts maintaining additional derived indexes must use the
cache boundary rather than treating it as a user deletion.

Wire disk state is separate from the local `Vault`:

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

An already validated epoch can instead be supplied as `opts.epoch`; then
`client.ready` waits for both local and wire restoration. Without a validated
epoch there are **no wire disk reads or writes**. Never pass a disk-stored epoch
as proof of the server's current epoch. `setEpoch()` also requests fresh answers
from existing subscriptions and invalidates their readiness. Epoch negotiation
and application-specific boot messages remain the host's responsibility.

`wireIdb()` defaults to a **separate** `yaks-wire` database; `idb()` defaults to
`yaks`. Use distinct names. `wireVault: false` disables wire durability without
disabling local drafts. `wireStash()` is the in-memory implementation of the
same three-method `WireVault` contract. A mismatch atomically clears only wire
rows. Writes/departures check the epoch in their transaction, so stale-tab
writes cannot revive a previous epoch. Disk keeps the newest written rows up to
the bound (including active rows); RAM separately uses read-touched LRU. Reads
use bounded ordered cursors, and oversized legacy data is pruned by key, not
loaded with `getAll()`.

Restoration is a non-authoritative paint floor. Existing RAM rows and writes
made while disk opens win over it; any intervening socket answer (even empty)
defeats the late restore. A newer epoch or client close cancels an older
restore. Local-vault hydration likewise cannot overwrite an edit made while
loading. `await box.cache.idle()` waits for queued disk writes, and
`box.cache.size()` reports inactive RAM payloads.

The Tasks frontend adapter, protocol/epoch negotiation, durable outbox/refusal
ledger, richer query parity and scratch-probe CDP comparisons are a subsequent
integration phase; this package does not yet replace `src/live.ts`.

### Server-evaluated membership

A partial cache cannot prove a server query's membership. In particular, RAM's
word matcher is not SQLite FTS, and a far reference, ordering column or semantic
vector may never have been delivered to the browser. Opt into a watch which
never parses, evaluates or primes the query locally:

```ts
let hits = box.watch('café', { evaluate: 'server' })
```

The query text is opaque to this path. The server must validate it and send
ordinary bundle frames (or a refusal). Membership and order come only from its
frames: a reset replaces both; deltas update standing members without sorting
them. A ranking change must therefore be delivered as a reset. A local edit to
an existing member updates its payload immediately but cannot change membership;
an unrelated optimistic write cannot insert itself into a ranked server answer.
Payloads still live only in RAM, and another subscription's `gone` cannot remove
an owned row. `ready`, ref-counted deduplication, independent disposal and
reconnect/refusal behavior are the same as for other remote watches. Evaluation
mode is part of the dedupe key. Server evaluation requires a remote watch;
`remote: false` or a client without a URL is refused rather than silently
reinterpreted.

This is **not yet a full rich-query protocol**. `Watch.value` is still bundles,
not an aggregate map or a semantic score. Projection coverage, peer riders,
tally/window metadata and persisted ordered query membership require the host
adapter work described in
[the Tasks migration audit](../../docs/CLIENT_MIGRATION.md). In particular,
server-evaluated watches start empty when newly opened, even if retained or
restored payloads exist. A standing watch keeps its last answer while
disconnected (`ready=false`), but closing and reopening does not guess a
semantic answer from payloads. Do not use this mode as a claim of completed
reopen-before-frame parity.

`box.cache.onRows(eids => ...)` observes payload changes, including RAM-only
retention eviction, epoch invalidation and hydration. Read each current row with
`box.ent(eid)` to update application-derived indexes; an absent payload means
unloaded, not deleted. The callback is synchronous after the payload change,
returns an unsubscribe function, and is cleared on client close. This is the
observation boundary for derived UI signals, not a second cache owner. The
callback should not mutate the graph. Low-level sync users can disable local
ownership priming with `wire.subscribe(query, id, { prime: false })`; ordinary
subscriptions retain the existing local priming behavior.
