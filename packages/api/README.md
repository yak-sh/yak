# @yaks/api

The transport in front of a [@yaks/graph](https://jsr.io/@yaks/graph), as a
plain request handler that runs in any JavaScript environment.

Three routes, no framework, no environment: a `Request` goes in and a `Response`
comes out. Point it at a graph and you have a server.

- **`POST /apply`** — a batch of bundles in, the batch as applied out, one
  bundle per entity (@yaks/graph `composed`). Add `?check=1` to rehearse it:
  every phase runs and the transaction rolls back, so nothing is written and no
  effect observes it, while a refusal is still a refusal. That is how one batch
  is spread over several graphs — ask them all, then commit.
- **`GET /query?q=…`** (or `POST /query`) — a query line in, bundles out.
- **`/ws`** — subscriptions: a saved query whose answer is pushed again whenever
  a committed batch changes it.

## Install

```sh
deno add jsr:@yaks/api
# or: npx jsr add @yaks/api
```

## Use

```ts
import { api } from '@yaks/api'

let handler = api({ graph, authenticate })

Deno.serve(handler) // …or hand it to any fetch-style host
```

The examples below are a bookshop: books with a price and a status, reviews
about them, and members who buy them.

```sh
curl -X POST localhost:8000/apply -d '[
  { "entity": { "eid": "b1" },
    "doc":  { "title": "The Left Hand of Spring" },
    "book": { "price": 12, "status": "shelved" } }
]'

curl 'localhost:8000/query?q=.status=shelved%26.price<20'
```

A **bundle** is one entity, whole: its identity under `entity`, every component
it wears under that component's name. `/apply` takes a JSON array of them (a
`Change`) and answers with the array `apply()` returned — one bundle per entity,
the patches as they landed plus everything the graph synthesized: the `num` it
minted, the `created` stamp it wrote, a tombstone for anything that died.

## The door is where trust lives

A bundle can say anything, including whose name is on it. So the handler throws
away the `$actor` a client sent and replaces it with the identity your
`authenticate` returns for that request:

```ts
let authenticate = (request: Request) => {
  let token = request.headers.get('authorization')
  return token ? { eid: memberFor(token) } : null
}
```

It runs on **every** request — a read, a write and a socket upgrade alike — so a
door that gates reads gates them here. Return `null` and the batch lands
unattributed; throw `Unauthorized` and the request is answered with a 401.

Nothing else about a request is trusted either: which columns a caller may
write, whether a precondition still holds, and what a delete takes with it are
all [@yaks/graph](https://jsr.io/@yaks/graph)'s to decide, not this package's.

## Subscriptions

A subscription is a **saved query**. You open one over the socket, the server
answers with the set it selects right now, and from then on pushes what changed
— including what LEFT, which no client can work out for itself, because it never
sees the entity that stopped matching.

```ts
socket.send(
  JSON.stringify({ subscribe: '.status=shelved&.price<20', id: 'cheap' }),
)

// ← { id: 'cheap', bundles: [ { entity: { eid: 'b1', num: 3 }, doc: {…}, book: {…} } ] }
// …someone marks b1 sold:
// ← { id: 'cheap', bundles: [], gone: ['b1'] }
```

The whole protocol is four lines:

```text
→ { subscribe: "<query>" | true, id: "<id>" }   open one (true = every batch)
→ { unsubscribe: "<id>" }                       close one
← { id, bundles: Bundle[], gone?: Eid[] }       the set, then every change to it
← { id, refused: { error, message, … } }        that subscription was refused
```

`bundles` are whole entities that are now in the set; `gone` names the ones that
left it, whether they were deleted or merely stopped matching. `subscribe: true`
asks for the raw feed instead: every committed batch, exactly as `/apply`
returned it, with no membership of its own.

**No write crosses the socket.** A batch is applied with `POST /apply`, and the
socket is how everyone — including the writer — hears about it. That is one door
for writes, and it is the door that knows who is writing.

Subscriptions are re-evaluated on the graph's own `effect` phase, so a batch a
host applies directly reaches subscribers just like one that arrived over HTTP.
Each commit reads the touched entities once, then judges them two ways:

- **incrementally**, when the query asks only about each entity itself —
  [@yaks/match](https://jsr.io/@yaks/match)'s `filter` re-tests the changed
  bundles, and the query is never run again however large its set is;
- **by re-reading**, when the query hops through a reference, orders, or windows
  with `.limit`. Those answers are properties of the whole set: adding a cheaper
  book can push another out of `.price<20&.limit=1` without touching it. Those
  subscriptions run their query again and report the difference.

Which mode a subscription is in is decided once, when it opens.

## Refusals

Every door answers a thrown error with the same body: the error's own name, its
message, and whatever fields it carried. A precondition that lost a race still
names the column and what the graph holds now, so a client can merge onto it
instead of guessing.

```json
{
  "error": "Stale",
  "message": "book.price of b1 has moved since it was read",
  "eid": "b1",
  "comp": "book",
  "column": "price",
  "current": 12
}
```

| status | when                                                           |
| ------ | -------------------------------------------------------------- |
| 400    | `Refused` (a column the vocabulary does not know), bad JSON    |
| 400    | `Unsupported` (a query this graph cannot compile)              |
| 401    | `Unauthorized` — thrown by your `authenticate`                 |
| 404    | no route                                                       |
| 405    | the wrong method, or `/ws` without an upgrade                  |
| 409    | `Stale` — a `$was` precondition no longer holds                |
| 500    | anything nobody named: a bug in the server, not in the request |

The table is `STATUS`, keyed by the error's `name`, so an error from your own
plugin joins it by naming itself.

## Hosting

Everything here is standard `Request`, `Response` and `WebSocket` — except the
WebSocket upgrade, which no standard covers. That one step is injected.

**Deno** — the default, nothing to pass:

```ts
Deno.serve(api({ graph, authenticate }))
```

**Cloudflare Workers** — a `WebSocketPair`
([@yaks/workers](https://jsr.io/@yaks/workers) wraps this for you):

```ts
let upgrade = (request: Request) => {
  let [client, server] = Object.values(new WebSocketPair())
  server.accept()
  return {
    socket: server,
    response: new Response(null, { status: 101, webSocket: client }),
  }
}

export default { fetch: api({ graph, authenticate, upgrade }) }
```

**Node** — serve the handler through any fetch-style adapter, and pass an
`upgrade` built on your WebSocket library. The handler itself is unchanged.

## Compatibility

**Deno, Node, Bun, and Cloudflare Workers.** The package imports no platform
API: it type-checks under `lib: ["dom", "esnext"]` with no `Deno` types in the
compile at all, and the one file that knows a runtime (`deno.ts`) looks the
global up rather than importing it, so it loads anywhere and throws only if you
call it off Deno. Its dependencies are the sibling packages: `@yaks/graph`,
`@yaks/match`, `@yaks/query` and `@yaks/vocab`.

## The family

A query string is parsed by [@yaks/query](https://jsr.io/@yaks/query); a
vocabulary is described with [@yaks/vocab](https://jsr.io/@yaks/vocab);
[@yaks/graph](https://jsr.io/@yaks/graph) owns the bundle wire and `apply()`;
[@yaks/sqlite](https://jsr.io/@yaks/sqlite) (or `@yaks/d1`, or
`@yaks/durable-object`) owns the bytes; and
[@yaks/match](https://jsr.io/@yaks/match) answers the same query grammar over
bundles in memory, which is what makes a subscription cheap. This package is the
door in front of all of it.

## License

Apache-2.0
