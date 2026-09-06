# @yaks/sync

The **wire tier** for a client [@yaks/graph](https://jsr.io/@yaks/graph): a
plugin that carries a local graph's writes to a server, and the server's writes
back.

A graph in a page over [@yaks/ram](https://jsr.io/@yaks/ram) is a complete graph
— the same `apply()`, the same query grammar, the same bundles — it just has
nobody else in it. This package is the nobody else.

## Install

```sh
deno add jsr:@yaks/sync
# or: npx jsr add @yaks/sync
```

## Use

The examples are a shared recipe box: recipes with a course and a serving count,
notes about them, cooks who wrote them.

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { sync, syncKeywords } from '@yaks/sync'

let vocab = loadVocab(recipeBox, [syncKeywords])
let g = graph({ storage: ram(vocab, { adopt: true }), vocab })
let wire = sync(g, { url: 'https://recipes.example' })

wire.subscribe('.course=dinner&.serves>4')
```

That is the whole setup. From then on:

```ts
g.apply([{
  entity: { eid: crypto.randomUUID() },
  doc: { title: 'Dal' },
  recipe: { serves: 4, course: 'dinner' },
}])
// → the bundles, at once. No await: the page renders, and the server hears
//   about it on its own time.
```

`ram(vocab, { adopt: true })` is worth a word: a client store must take the
identity the server hands it rather than mint its own, so the `num` a recipe has
here is the `num` it has everywhere.

## Writes are optimistic

A write commits **locally first** — that is what makes a render instant — and is
then forwarded to the server's `POST /apply`. Three things can come back.

**Applied.** The server answers with the batch as IT applied it: the numbers it
minted, the stamps it wrote, a tombstone for every casualty of a delete. That
batch is applied back through the local graph, so a client ends up holding
exactly what a fresh read would return. It is marked on the way in, so the same
plugin that sent the write does not send its own echo back out.

**Refused.** The optimistic change is undone. Before the patches went in, the
plugin captured the image of each entity the batch was about to change; the
inverse of that batch restores every column it touched, clears the ones that
were not there, and drops the components it introduced. The refusal is then
reported, with the batch that caused it.

```ts
let wire = sync(g, {
  url: 'https://recipes.example',
  report: (t) => {
    if (t.refused) toast(t.refused.message) // and t.reverted says what happened
  },
})
```

**Unreachable.** Nothing is undone. A request that never got an answer may still
have landed, and a client that guesses wrong about that turns a network blip
into data loss. The trouble is reported with `reverted: false`, and the write
stands locally until the next one reconciles it.

One asymmetry, and it is the model's rather than this package's: **a refused
DELETE cannot be undone.** Death is final in a yaks graph — an eid is tombstoned
and can never be reused — so there is nothing to patch back. A client that
deletes something the server will not let it delete has to be rebuilt from the
server.

## Three tiers, one apply()

A client holds three kinds of state at once: what the server owns, what this
browser owns, and what dies with the tab. Which is which is declared **on the
component**, as a vocabulary keyword:

```json
{
  "$vocabulary": { "https://yaks.sh/vocab/sync": true },
  "$defs": {
    "recipe": {
      "type": "object",
      "properties": { "serves": { "type": "number" } }
    },
    "draft": {
      "type": "object",
      "persist": "local",
      "properties": { "text": { "type": "string" } }
    }
  }
}
```

| `persist` | what it means                                |
| --------- | -------------------------------------------- |
| `"wire"`  | synced to the server — **the default**       |
| `"local"` | kept by this client, never sent              |
| `"none"`  | ephemeral: held only while the process lives |

Register the keyword when you load the vocabulary
(`loadVocab(docs, [syncKeywords])`) and a component's tier is readable as
`tierOf(vocab, 'draft')`. All three tiers ride the same `apply()`: a batch that
writes a recipe and its unsaved draft in one call commits once, and only the
recipe crosses the wire.

What is sent is narrower than what was written, in three ways, and each is the
same idea — the server is not interested in the local graph's opinion of itself:

- only **wire-tier** components,
- only the columns a client may **write** (a `created` stamp is the server's),
- only the bundles a **caller asked for** — the casualties a local cascade found
  and the provenance a local stamp phase wrote are conclusions the server will
  reach again from the same patch.

## Reading is a subscription

`subscribe(query)` opens a saved query on the server's `/ws`. Its answer, and
every later change to it, is applied to the local graph — so a render reads the
local store and never awaits.

```ts
let id = wire.subscribe('.course=dinner')
g.read('.course=dinner') // → bundles, synchronously, from the local map
wire.unsubscribe(id)
```

`subscribe(true)` asks for the raw feed instead: every committed batch, exactly
as `/apply` returned it.

An entity that **leaves** the set arrives in a frame's `gone` list. The frame
cannot say whether it was deleted or merely stopped matching, so this package
takes its components off rather than tombstoning it: a component-less entity
matches no query — which is what leaving the set means — and it can come back
whole when it matches again, where a tombstone could never be lifted. A real
deletion still tombstones, because a real death arrives as a `tombstone`
component in the bundles.

## Reconnecting

A socket dies for reasons that have nothing to do with the client: a laptop lid,
a deploy, a proxy timeout. So:

- **one** reconnect timer per graph, with a delay that doubles from 250 ms to a
  30 s ceiling and resets the moment a socket opens — a second timer is how a
  server that is merely slow acquires a client that hammers it;
- every subscription goes back up on the new socket;
- the first frame of each is treated as a **reset**. The server holds membership
  per connection, so a fresh subscription answers with the set as it stands and
  says nothing about what left while the client was away. This package remembers
  each subscription's members itself, and reports whatever it held and did not
  hear again as gone.

## Both transports are injected

```ts
sync(g, {
  url: 'https://recipes.example',
  fetch: (request) => myHandler(request), // default: the global fetch
  connect: (url) => new MySocket(url), //    default: the global WebSocket
  timer: (fn, ms) => setTimeout(fn, ms), //   default: setTimeout
  headers: { authorization: `Bearer ${token}` },
})
```

`fetch` takes a `Request` and answers with a `Response`, which an
[@yaks/api](https://jsr.io/@yaks/api) handler does directly — so this package's
own tests run a client graph and a server graph in one process, with no network
and no sleeps, and so can yours.

## API

```ts
sync(graph, opts): Sync
```

registers the plugin on `graph` and returns:

- `plugin` — the `Plugin` it registered, for a caller who wants to look at it.
- `subscribe(query, id?): string` — open a subscription, and answer with its id.
- `unsubscribe(id): void` — close one.
- `open(): void` — open the socket without subscribing to anything.
- `connected(): boolean` — whether the socket is open right now.
- `idle(): Promise<void>` — resolves when every batch in flight has been
  answered. What to await before unloading a page, and what a test awaits.
- `close(): void` — close the socket and stop reconnecting.

The pieces are exported on their own, so a host with a different shape can use
them without `sync()`: `outward` and `inverse` (what a batch says to the server,
and how to take it back), `post` (send one batch and reconcile it), `land` and
`strip` (what a frame does to a graph), `wire` (the socket and its
subscriptions), and the marks `echo` / `asking` that keep the two directions
apart.

## Compatibility

**Browser, Deno, Node, Bun, and Cloudflare Workers.** The package imports no
platform API: `fetch` and `WebSocket` are looked up through the injected options
(the globals are only a default), and it type-checks under
`lib: ["dom", "esnext"]` with no `Deno` types in the compile at all. Its
dependencies are the sibling packages: `@yaks/graph` for the bundle wire and the
plugin seam, and `@yaks/vocab` for the tier keyword.

## The family

[@yaks/graph](https://jsr.io/@yaks/graph) owns the bundles and `apply()`;
[@yaks/ram](https://jsr.io/@yaks/ram) is the map the client keeps them in;
[@yaks/api](https://jsr.io/@yaks/api) is the door at the other end, and owns the
subscription model this package talks to;
[@yaks/query](https://jsr.io/@yaks/query) is the grammar a subscription is
written in. This package is the string between the two ends.

## License

Apache-2.0
