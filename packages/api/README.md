# @yaks/api

HTTP and WebSocket access to a [@yaks/graph](../graph/README.md) graph. `api()`
returns a fetch-style handler: a `Request` goes in and a `Response` comes out.
Your application supplies the graph, authentication policy, and server runtime.

A **bundle** is one entity's components as a JSON object, with its identity in
`entity.eid`. A **batch** is a list of changes applied in one transaction. The
JSON `/apply` endpoint accepts a batch of bundles; queries return bundles.

This package creates no database or component tables. Persistent data belongs to
the graph's storage adapter. Subscription membership and peer values are kept in
memory by the handler's subscription registry.

## Install

```sh
deno add jsr:@yaks/api
# or: npx jsr add @yaks/api
```

## Use

Given an application module that exports an initialized graph and an
`Authenticate` callback:

```ts ignore
import { api } from '@yaks/api'
import { authenticate, graph } from './shop.ts'

let handler = api({ graph, authenticate })
Deno.serve({ port: 8000 }, handler)
```

Keep the handler for subsequent requests so its subscription registry is reused.
The following requests assume the graph's vocabulary declares `doc.title`,
`book.price`, and `book.status`:

```sh
curl http://localhost:8000/apply \
  -H 'content-type: application/json' \
  -d '[{"entity":{"eid":"b1"},"doc":{"title":"Dune"},"book":{"price":12,"status":"shelved"}}]'

curl -G http://localhost:8000/query \
  --data-urlencode 'q=.status=shelved&.price<20'
```

| Endpoint         | Request                    | Response                                |
| ---------------- | -------------------------- | --------------------------------------- |
| `POST /apply`    | JSON array of bundles      | The bundles as applied, one per entity  |
| `GET /query?q=…` | URL-encoded query          | Selected bundles, or an aggregate value |
| `POST /query`    | JSON string or `{"q":"…"}` | Same as GET                             |
| `/ws`            | WebSocket upgrade          | Subscription messages                   |

The `/apply` result contains the patches and what the graph generated, including
assigned entity numbers, timestamps, and cascading deletions where the graph is
configured to produce them. It is not a read of every component on each entity.
Add `?check=1` to validate and roll back the transaction before commit; effects
do not run. This reserves nothing, and a later write can still fail. It does not
provide a transaction across multiple graphs.

Queries use [@yaks/query](../query/README.md). Aggregate queries return values
instead of bundles: `.count` returns `{"count":n}`, `.distinct=prop` returns
`{"distinct":[…]}`, and `.tally=prop` returns `{"tally":{…}}`. The storage
adapter must support the requested query.

## Exports

All exports are available from `@yaks/api`:

| Exports                                                         | Purpose                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `api`, `Options`, `Handler`                                     | Build and type the request handler                                                    |
| `Route`, `routed`                                               | Describe and match application routes by method and exact path or trailing `*` prefix |
| `Filter`                                                        | A check a plugin puts in front of every route, refusing a request by throwing         |
| `Authenticate`, `signed`                                        | Identify a caller and replace client-supplied write attribution                       |
| `ask`, `write`, `pour`, `CHUNK`                                 | Query, JSON write, and streaming import handlers; import chunk size                   |
| `subscriptions`, `Subs`, `Ask`, `Frame`, `Sink`                 | Manage subscriptions and their messages                                               |
| `attach`, `receive`, `sink`, `Socket`, `Upgrade`, `denoUpgrade` | Connect the subscription protocol to sockets                                          |
| `denoListen`, `Listen`, `Listener`, `Addr`                      | Bind a port on Deno, which is what the `serve` tool listens with                      |
| `json`, `refusal`, `refuse`, `Refusal`, `Unauthorized`          | Construct JSON responses and translate errors                                         |
| `timed`                                                         | A client `fetch` that says one line per response, with the `Server-Timing` it carried |

`Route` and `routed` help an application compose additional routes; `api()`
itself only serves the three paths above.

## Importing one bundle per line

Send `application/x-ndjson` to import a stream of bundles. Blank lines are
skipped; each group of 50 bundles is applied in its own transaction. The
implementation also accepts content types containing `ndjson`.

```sh
curl http://localhost:8000/apply \
  -H 'content-type: application/x-ndjson' \
  --data-binary @rows.ndjson
```

The response is NDJSON, emitted as each group completes. It includes applied
bundles corresponding to input entities; additional entities produced by plugins
or cascading deletes are omitted. Request and response bodies are streamed
rather than accumulated in full.

Once streaming starts, the HTTP status is 200, including when a later line
fails. An error is the last response line:

```json
{
  "error": "Refused",
  "message": "unknown property: book.colour",
  "line": 137,
  "committed": 100
}
```

`line` is a 1-based input line number. `committed` counts input bundles in
successful earlier groups. The failed group is rolled back, but earlier groups
remain committed. For an apply error, the handler tests the failed group with
one bundle omitted at a time, using rollback-only checks. If no single omission
makes the group succeed, it reports the group's first line. Therefore the
reported line is not always the only offending line, and the group may already
have been read past it. Processing stops after the error.

With `?check=1`, every group is rolled back and `committed` counts bundles that
passed the check, not stored bundles. Later groups cannot depend on entities
that earlier check-only groups would have created.

A `$name` alias resolves only within its group of 50 bundles. Keep an entity and
its alias references in the same group, or use known entity IDs for references
across groups.

## Authentication and write attribution

`authenticate(request)` runs on every request, including reads and WebSocket
upgrades. It returns an actor such as `{ by: memberId, via: sessionId }`, or
`null`. The API replaces each submitted `$actor` with that result before
applying changes. `by` identifies the entity responsible for the write; optional
`via` records the entity through which it was made.

Omitting authentication or returning `null` permits unattributed requests. Throw
`Unauthorized` to return HTTP 401. Authentication alone does not define which
entities or properties a caller may access; the application and graph plugins
supply the relevant authorization policy. The graph validates changes and
preconditions.

## Subscriptions

A query subscription first receives its current result, then updates after graph
commits. Those are the graph's own commits, and, in a host whose config lists
@yaks/journal, every commit another process or thread makes to the same store
(`host.feed`, @yaks/journal's `feed`): a `yak` command run beside `yak serve`
reaches an open tab too. Open a socket to `/ws` and send:

```ts ignore
socket.send(
  JSON.stringify({ subscribe: '.status=shelved&.price<20', id: 'cheap' }),
)
// Initial response: { id: 'cheap', bundles: [...], transientReset: [...] }
// If b1 stops matching: { id: 'cheap', bundles: [], gone: ['b1'] }
```

```text
→ { subscribe: "<query>" | true, id: "<id>" }
→ { unsubscribe: "<id>" }
→ { relay: Bundle[] }
← { id, bundles: Bundle[], gone?: Eid[] }
← { id, count: n } | { id, distinct: […] } | { id, tally: {…} }
← { id, relay: Bundle[] }
← { id, transient: TransientFrame[] }
← { id, refused: { error, message, … } }
```

Query updates contain current bundles for matching entities and `gone` IDs for
entities that were deleted or stopped matching. A refreshed query can return its
whole current set. An aggregate query (`.count`, `.distinct=prop`,
`.tally=prop`) is answered with its value in the shape `/query` answers it,
first when it opens and again after a commit that changes it; it carries no
bundles. `subscribe: true` selects the committed-change feed, with no initial
snapshot: each message contains the combined transaction changes, like the JSON
`/apply` result.

Initial query messages also contain `transientReset` IDs and may include
`transient` snapshots or existing peer values. `transient` messages carry
nonpersistent property updates from the graph; their frame type is defined by
[@yaks/graph](../graph/README.md).

Durable writes use HTTP `/apply`. Socket `relay` messages carry components
marked `sync: peers`, such as cursor position or typing status. They are
validated and forwarded to other subscribers watching those entities without
entering storage. Raw subscribers receive all relays. An entity that joins a
subscription's set arrives with the values peers are already relaying for it, as
a subscription that opens does. The relay holds one value per entity and
component, under the connection that last wrote it, and never sends a connection
what it holds itself. Values clear when a writer clears them, the connection
holding them closes, or the vocabulary's duration, such as `durable: "5s"`,
expires; a clear is sent as a component set to `null`.

The registry observes the graph's `effect` phase, including writes made directly
by the application. For queries that can be tested one entity at a time,
[@yaks/match](../match/README.md) rechecks changed entities. Queries involving
references, ordering, limits, or other unsupported incremental conditions run
again. The strategy is selected when the subscription opens.

### Queries that depend on entities outside their result

For dependencies the query itself does not express, create a registry with
`subscriptions(graph, { invalidate })` and pass it as `api({ graph, subs })`.
`invalidate(query, applied)` returning `true` causes that subscription to read
and send its full current result and IDs that left. This is an
application-supplied dependency rule; it does not discover dependencies
automatically.

## Refusals

Errors contain the thrown error's name as `error`, its `message`, and additional
fields other than its stack. For example, a failed `$was` precondition reports
the property and its current value:

```json
{
  "error": "Stale",
  "message": "book.price of b1 has moved since it was read",
  "eid": "b1",
  "comp": "book",
  "prop": "price",
  "current": 12
}
```

| Status | Cause                                                              |
| ------ | ------------------------------------------------------------------ |
| 400    | `Refused`, `Unsupported`, `SyntaxError`, `Unknown`, or `Ambiguous` |
| 401    | `Unauthorized`                                                     |
| 403    | `Denied`                                                           |
| 404    | `NotFound` or an unknown route                                     |
| 405    | Wrong HTTP method or `/ws` without an upgrade header               |
| 409    | `Stale`                                                            |
| 500    | An error name not in `STATUS`                                      |

HTTP errors use these statuses. Subscription errors are socket messages, and
streaming import errors use the final NDJSON line described above. The
error-name mapping is @yaks/graph's `STATUS`, the same table the tool runner
reads to tell a refusal from a defect.

## The plugin: the handler, and the `serve` tool

This package is also the plugin that makes a host answer HTTP at all.
[`routes.ts`](./routes.ts) exports `handler`, which the host calls once its
graph is open and `host.routes` holds every listed plugin's routes: what comes
back is those routes beside `/apply`, `/query` and `/ws`, and it becomes
`host.handler`. The route that names a path most closely answers it: an exact
path over a prefix, a longer prefix over a shorter, and plugin order between
equals. The three doors are exact paths, so a plugin's catch-all (`/*`) answers
only what nothing else claims. In front of all of it stand the plugins' filters
(`host.filters`): each sees every request first, and one that throws answers the
request with that refusal, so nothing behind it runs. A config that does not
list this package composes a host with no handler, and the routes the other
plugins would have added are never asked for ([@yaks/cli](../cli/README.md)).
`/mcp` is one of those routes, contributed by [@yaks/mcp](../mcp/README.md) when
a config lists that package too.

[`vocab.json`](./vocab.json) declares one tool, `serve`, and
[`tools.ts`](./tools.ts) implements it: it binds a TCP port and answers with
that handler. So a config listing `@yaks/api` is a config whose graph can be
served, and `yak serve` is that tool being called like any other.

```json
{
  "db": "graph.db",
  "plugins": ["@yaks/api", "@yaks/mcp", "@yaks/task"],
  "port": 8787
}
```

```sh
yak serve --config yak.json          # the configured port
yak serve --config yak.json --port 0 # an arbitrary free one
```

The port and interface come from the call's `port` and `hostname` arguments,
then from the config's, then from `PORT` (8787) and `HOSTNAME` (`127.0.0.1`).
The server answers every request it is given, so it listens on this machine
alone unless a config names a wider interface, such as `"hostname": "0.0.0.0"`.

The call is the record of the server. The runner writes the call row and marks
it `running` before the tool starts, and writes the result when the tool returns
— which is when the server stops. So a server that is up is a call still marked
`running`, a server that has stopped is a result saying where it listened and
for how long, and a process killed while serving leaves a call marked `running`
whose process never recorded an exit, which is the state that keeps another
runner from starting a second server in its place. Because nothing is printed
until the call returns, the tool writes the address to standard error as soon as
the port is bound.

While it listens, the tool also takes over the host's duties — the effect sweep
and each plugin's `./service` — in their long-running form, and first finishes
any tool calls a previous process was killed in the middle of.

## Serving it yourself

Deno's WebSocket upgrade is the default. In Cloudflare Workers, pass
`workerUpgrade` from [@yaks/workerd](../workerd/README.md), or use that
package's `worker()` entrypoint. For Node or Bun, use a fetch-style server
adapter and an `upgrade` callback implemented with the runtime's WebSocket
library. An upgrade returns `{ socket, response }`.

## Compatibility

The handler uses standard `Request`, `Response`, and socket interfaces and is
intended for Deno, Node, Bun, and Cloudflare Workers. The package type-checks
with `dom` and `esnext` libraries. `denoUpgrade` and `denoListen` look up Deno
at call time and throw outside Deno; other runtimes must provide their own
upgrade callback, and a runtime that binds its own port has no use for the
`serve` tool.

## The related packages

[@yaks/graph](../graph/README.md) defines entities, changes, and write
processing; [@yaks/vocab](../vocab/README.md) defines component schemas;
[@yaks/query](../query/README.md) defines query syntax; and
[@yaks/match](../match/README.md) evaluates queries in memory. Storage adapters
such as [@yaks/sqlite](../sqlite/README.md), [@yaks/d1](../d1/README.md), and
[@yaks/durable-object](../durable-object/README.md) persist the data.

## License

Apache-2.0
