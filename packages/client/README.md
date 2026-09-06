# @yaks/client

The **frontend tier** for a client [@yaks/graph](https://jsr.io/@yaks/graph):
one call assembles it, a query is a value that changes, and what belongs to this
browser is kept in IndexedDB.

The pieces already exist — a map to hold entities
([@yaks/ram](https://jsr.io/@yaks/ram)), a wire to a server
([@yaks/sync](https://jsr.io/@yaks/sync)), a query evaluator with no database
under it ([@yaks/match](https://jsr.io/@yaks/match)). This package is the three
things a page still has to add: the assembly, the reactivity, and somewhere
durable to put the state the server will never send back.

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

let vocab = loadVocab(recipeBox, [syncKeywords])
let box = client(vocab, [], { url: 'https://recipes.example' })

box.mutate([{
  entity: { eid: crypto.randomUUID() },
  doc: { title: 'Dal' },
  recipe: { serves: 4, course: 'dinner' },
}])
```

That is the whole setup. `client(vocab, plugins, opts)` takes the vocabulary you
share with the server, whatever plugins are yours, and the options below — and
gives back the graph, the wire, the watches and four calls a page makes all day:

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

dinners.value // → the bundles, now
let stop = dinners.subscribe((bundles) => paint(bundles)) // → the next ones
stop() // this listener only
dinners.close() // the whole watch
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

Either way the watch fires only when its own answer moved. An unrelated write
does not wake it.

### With a server

When the client has a `url`, opening a watch also opens the **server's**
subscription for that query, and closing it drops that too — so what the page is
looking at is what the server is sending. Pass `{ remote: false }` for a watch
over data that is already local.

### With signals

`watch()` is framework-free: `value` plus `subscribe` is all of it. Hand
`client` a signal factory and every `value` is a signal read instead, which is
all a signals-based renderer needs to track it. Nothing is imported — the
factory is yours:

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

The snapshot is a new array only when the answer moved, so React re-renders when
the answer changes and not otherwise.

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
  commit and loaded back at boot — a draft survives a reload, and no server ever
  hears about it.
- **`none`** dies with the tab: held in the graph, written down nowhere.

All three ride the same `apply()`. The local tier is back in the graph by the
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

## The family

[@yaks/graph](https://jsr.io/@yaks/graph) owns the bundles and `apply()`;
[@yaks/ram](https://jsr.io/@yaks/ram) is the map this keeps them in;
[@yaks/match](https://jsr.io/@yaks/match) judges a bundle against a query;
[@yaks/query](https://jsr.io/@yaks/query) is the grammar both sides speak;
[@yaks/sync](https://jsr.io/@yaks/sync) is the wire to the server, and the
`persist` keyword that says which state goes over it.

## License

Apache-2.0
