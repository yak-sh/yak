# @yaks/api

HTTP and WebSocket access to a [@yaks/graph](../graph/README.md) graph. Use it
to serve an existing graph as a fetch-style request handler: a `Request` goes
in, a `Response` comes out. Your application supplies authentication, storage,
and the server runtime. Everything here is standard `Request`, `Response` and
`WebSocket`, apart from the WebSocket upgrade, which differs per runtime and is
passed in.

Three endpoints:

- **`POST /apply`** — the request body is a JSON array of bundles, applied in
  one transaction; the response body is that array as applied, one bundle per
  entity (@yaks/graph `composed`). Add `?check=1` to run every phase and then
  roll the transaction back, so nothing is written and no effect observes it,
  while a refusal is still a refusal. A check reserves nothing and gives you no
  transaction across several graphs: a write sent afterwards can still fail.
- **`GET /query?q=…`** (or `POST /query`) — a query string in, the bundles it
  selects out. A query that REDUCES the selection instead of naming its members
  returns a value: `.count!` returns `{"count":n}`, `.distinct=col` returns
  `{"distinct":[…]}`, `.tally=col` returns `{"tally":{…}}`.
- **`/ws`** — subscriptions: a saved query whose result is pushed again whenever
  a committed transaction changes it.

`/apply` also accepts an import too large to parse or commit in one go — see
[Importing one bundle per line](#importing-one-bundle-per-line).

## Install

```sh
deno add jsr:@yaks/api
# or: npx jsr add @yaks/api
```

## Use

```ts
import { api } from '@yaks/api'

let handler = api({ graph, authenticate })

Deno.serve(handler) // …or pass it to any fetch-style server
```

The examples below use a bookshop: books with a price and a status, reviews
about them, and members who buy them.

```sh
curl -X POST localhost:8000/apply -d '[
  { "entity": { "eid": "b1" },
    "doc":  { "title": "The Left Hand of Spring" },
    "book": { "price": 12, "status": "shelved" } }
]'

curl 'localhost:8000/query?q=.status=shelved%26.price<20'
```

A **bundle** is one entity, whole: its identity under `entity`, and each of its
components under that component's name. `/apply` accepts a JSON array of them (a
`Change`) and responds with the array `apply()` returned — one bundle per
entity: the patches as they were written, plus everything the graph added on its
own, such as the `num` it minted, the `created` stamp it wrote, and a tombstone
for any entity a cascading delete took with it.

## Importing one bundle per line

A 10 MB import uses the same endpoint with a different content type. Send
`application/x-ndjson` and the body is read as a stream, one bundle per line
(blank lines skipped), applied **50 at a time** through the same `apply()`, so
neither the request body nor the response body is ever whole in memory:

```sh
curl -X POST localhost:8000/apply \
  -H 'content-type: application/x-ndjson' \
  --data-binary @rows.ndjson
```

The response is NDJSON too: the composed bundles, one JSON object per line,
written as each chunk commits rather than all at the end. The status is 200
whatever happens — the first bundles have already been sent long before a later
line can be refused — so a refusal is instead the **last line of the body**, and
it is what `apply()` threw plus two numbers:

```json
{
  "error": "Refused",
  "message": "unknown column: book.colour",
  "line": 137,
  "committed": 100
}
```

`line` is the 1-based line the offending bundle was on, and `committed` how many
bundles were written before it; nothing after that line is read. A chunk is one
transaction, so the error the graph throws names the chunk rather than a line —
the line is found by re-applying the refused chunk with one bundle left out at a
time (with `check`, so each attempt rolls back), which costs nothing until
something has already gone wrong.

**An alias resolves within its own chunk and nowhere else.** A bundle naming
`$x` and the bundle that mints it have to fall in the same run of 50 lines,
because that run is the whole array the graph is ever shown. Order the file so
each entity is minted beside the ones that refer to it, or send the references
as a second import once the eids are known.

## Authentication and write attribution

A client can put anything in the JSON it posts, including whose name is on it.
So the handler discards the `$actor` the client sent and replaces it with the
actor your `authenticate` returns for that request — `by` the identity it acts
for, and `via` whatever it came through, where you know one:

```ts
let authenticate = (request: Request) => {
  let token = request.headers.get('authorization')
  return token ? { by: memberFor(token) } : null
}
```

It runs on **every** request — a read, a write and a WebSocket upgrade alike —
so an `authenticate` written for reads applies here as well. Return `null` and
the write is stored unattributed; throw `Unauthorized` and the request is
answered with a 401.

Nothing else about a request is trusted either: which columns a caller may
write, whether a precondition still holds, and what a delete takes with it are
all [@yaks/graph](https://jsr.io/@yaks/graph)'s to decide, not this package's.

## Subscriptions

A subscription is a **saved query**. You open one over the WebSocket, the server
responds with the set the query selects right now, and from then on pushes what
changed — including what LEFT the set, which no client can work out for itself,
because it never sees the entity that stopped matching.

```ts
socket.send(
  JSON.stringify({ subscribe: '.status=shelved&.price<20', id: 'cheap' }),
)

// ← { id: 'cheap', bundles: [ { entity: { eid: 'b1', num: 3 }, doc: {…}, book: {…} } ] }
// …someone marks b1 sold:
// ← { id: 'cheap', bundles: [], gone: ['b1'] }
```

The protocol is these messages:

```text
→ { subscribe: "<query>" | true, id: "<id>" }   open one (true = every commit)
→ { unsubscribe: "<id>" }                       close one
→ { relay: Bundle[] }                           forward peer values (below)
← { id, bundles: Bundle[], gone?: Eid[] }       the set, then every change to it
← { id, relay: Bundle[] }                       peer values from another client
← { id, refused: { error, message, … } }        that subscription was refused
```

`bundles` are whole entities that are now in the set; `gone` names the ones that
left it, whether they were deleted or merely stopped matching. `subscribe: true`
asks for the raw feed instead: every committed transaction, exactly as `/apply`
returned it, with no membership set of its own.

**No durable write crosses the socket.** Changes are applied with `POST /apply`,
and the socket is how everyone — including the writer — learns about them. The
one exception is a `relay` message, which carries components the vocabulary
marks `sync: peers` — a cursor, a caret, a presence dot. Those are forwarded to
the other subscribers watching the same entities and are never stored: the
connection that sent one is what holds it, which is why it cannot go through
`/apply`, a separate request with no connection to name. A value clears when its
writer clears it, when that connection closes, or when the duration the
vocabulary gave it (`durable: "5s"`) runs out.

Subscriptions are re-evaluated on the graph's own `effect` phase, so a write the
application makes directly against the graph reaches subscribers just like one
that arrived over HTTP. Each commit reads the changed entities once, then tests
them one of two ways:

- **incrementally**, when the query asks only about each entity itself —
  [@yaks/match](https://jsr.io/@yaks/match)'s `filter` re-tests the changed
  bundles, and the query is never run again however large its set is;
- **by running the query again**, when the query hops through a reference,
  orders, or limits with `.limit`. Those results are properties of the whole
  set: adding a cheaper book can push another out of `.price<20&.limit=1`
  without changing it. Those subscriptions run the query again and send the
  difference.

Which mode a subscription uses is decided once, when it opens.

### Queries that depend on entities outside their result

Some query results depend on entities that are not in the result set. A
session's computed status, for example, can depend on its transcript entries.
Pass `subscriptions(graph, { invalidate(query, applied) })`: when the callback
returns true, that subscription runs its query again and its full current set is
sent, along with the eids that left. The callback is an explicit dependency
policy, not automatic dependency analysis — use it narrowly, or unrelated
commits will send full sets.

## Refusals

Every endpoint answers a thrown error with the same body: the error's own name,
its message, and whatever fields it carried. A precondition that lost a race
still names the column and what the graph holds now, so a client can merge onto
that instead of guessing.

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

| status | when                                                          |
| ------ | ------------------------------------------------------------- |
| 400    | `Refused` (a column the vocabulary does not define), bad JSON |
| 400    | `Unsupported` (a query this graph cannot compile)             |
| 401    | `Unauthorized` — thrown by your `authenticate`                |
| 404    | no route                                                      |
| 405    | the wrong HTTP method, or `/ws` without an upgrade            |
| 409    | `Stale` — a `$was` precondition no longer holds               |
| 500    | anything unlisted: a bug in the server, not in the request    |

The table is `STATUS`, keyed by the error's `name`, so an error from your own
plugin joins it by setting its `name`.

## Serving it

Everything here is standard `Request`, `Response` and `WebSocket` — except the
WebSocket upgrade, which no web standard covers. That one step is passed in.

**Deno** — the default, nothing to pass:

```ts
Deno.serve(api({ graph, authenticate }))
```

**Cloudflare Workers** — a `WebSocketPair`
([@yaks/workerd](https://jsr.io/@yaks/workerd) wraps this for you):

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

**Deno, Node, Bun, and Cloudflare Workers.** The package imports no
runtime-specific API: it type-checks under `lib: ["dom", "esnext"]` with no
`Deno` types in the compile at all, and the one file that knows a runtime
(`deno.ts`) looks the global up instead of importing it, so it loads anywhere
and throws only if you call it off Deno. Its dependencies are the sibling
packages: `@yaks/graph`, `@yaks/match`, `@yaks/query` and `@yaks/vocab`.

## The related packages

A query string is parsed by [@yaks/query](https://jsr.io/@yaks/query); a
vocabulary is described with [@yaks/vocab](https://jsr.io/@yaks/vocab);
[@yaks/graph](https://jsr.io/@yaks/graph) defines the bundle format and
`apply()`; [@yaks/sqlite](https://jsr.io/@yaks/sqlite) (or `@yaks/d1`, or
`@yaks/durable-object`) stores the rows; and
[@yaks/match](https://jsr.io/@yaks/match) evaluates the same query grammar
against bundles in memory, which is what makes a subscription cheap. This
package is the HTTP and WebSocket interface to all of it.

## License

Apache-2.0
