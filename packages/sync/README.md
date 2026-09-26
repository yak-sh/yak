# @yaks/sync

Synchronizes a local [@yaks/graph](../graph/README.md) with a server
implementing [@yaks/api](../api/README.md). It registers a graph plugin that
sends writes to `POST /apply`, opens query subscriptions on `/ws`, and applies
server responses to the local graph. Use it when a UI needs local reads and live
server updates.

A **bundle** is one entity's components as a JSON object, including its identity
under `entity`. A **batch** is a list of changes applied in one transaction;
here it is an array of bundle patches passed to `apply()`.

This package stores connection, subscription, and pending-request state in
memory. Entity data lives in the graph's storage adapter. It provides neither
persistent storage nor a durable queue for offline writes. Components can
declare local-only state; retaining that state across restarts is the caller's
responsibility. See the [graph architecture](../graph/ARCHITECTURE.md) for the
write pipeline and storage interfaces.

## Install

```sh
deno add jsr:@yaks/sync jsr:@yaks/graph jsr:@yaks/ram jsr:@yaks/vocab
# Node projects can use: npx jsr add @yaks/sync @yaks/graph @yaks/ram @yaks/vocab
```

## Use

The server and client must load compatible component definitions. This example
expects an API server at `https://recipes.example`:

```ts
import { graph } from '@yaks/graph'
import { loadVocab } from '@yaks/vocab'
import { ram } from '@yaks/ram'
import { sync } from '@yaks/sync'

const vocab = loadVocab({
  $defs: {
    recipe: {
      type: 'object',
      component: true,
      properties: {
        title: { type: 'string' },
        serves: { type: 'number' },
        course: { type: 'string' },
      },
    },
  },
})
const g = graph({ storage: ram(vocab, { adopt: true }), vocab })
g.install()
const link = sync(g, {
  url: 'https://recipes.example',
  report: (trouble) => console.error(trouble),
})
const id = link.subscribe('.recipe.course=dinner&.recipe.serves>4')

await g.apply([{
  entity: { eid: crypto.randomUUID() },
  recipe: { title: 'Dal', serves: 6, course: 'dinner' },
}])
console.log(await g.read('.recipe'))
await link.idle() // wait for the queued HTTP requests to settle
link.unsubscribe(id)
link.close()
```

With synchronous storage and hooks, `g.apply()` commits locally and returns
synchronously; `await g.apply()` does not wait for the server's response.
`adopt: true` lets RAM accept server number corrections for existing entities.
RAM numbering is off by default: use `{ number: true, adopt: true }` if new
incoming entities must adopt supplied numbers on their first patch, accepting
that local creations will receive provisional numbers.

## Writes are optimistic

A batch without deletions commits locally before the HTTP request completes.
Requests are sent serially in local commit order. The outcome is handled as
follows:

- **Applied:** server patches, including assigned numbers, stamps, and
  tombstones, are applied locally with `trusted: true`. They are marked to
  prevent the plugin from sending them back. A response is a set of applied
  patches, not a complete snapshot of every affected entity.
- **Refused:** an HTTP error response causes the plugin to apply inverse patches
  from the state recorded before the local write. These restore touched
  properties, clear previously absent values, and remove newly introduced
  components. The `report` callback receives the refusal, sent batch, and
  whether it reverted local data.
- **Unreachable:** a failed request is reported with `reverted: false`. The
  local change remains because the server may have applied it before the
  connection failed. There is no automatic HTTP retry or guarantee that a later
  response will resolve this uncertain outcome.

A batch containing any deletion waits for the server before applying locally:
the local tier keeps no inverse for a deletion. The whole batch is held,
including its other patches. A refusal therefore has nothing local to revert.
The server's response supplies the tombstones for an accepted deletion.

The plugin's inverse patches operate on the touched properties; they do not
provide a general conflict-resolution algorithm for overlapping optimistic
edits.

## Three kinds of state, one apply()

The vocabulary keywords `sync` and `durable` describe where component updates
are sent and how they should be retained:

```json
{
  "$defs": {
    "recipe": {
      "type": "object",
      "component": true,
      "properties": { "serves": { "type": "number" } }
    },
    "draft": {
      "type": "object",
      "component": true,
      "sync": "none",
      "properties": { "text": { "type": "string" } }
    }
  }
}
```

| `sync`               | Delivery                                                                        |
| -------------------- | ------------------------------------------------------------------------------- |
| `"server"` (default) | Sent through `POST /apply` for the server to store.                             |
| `"peers"`            | Sent over the WebSocket for the server to relay as connection-associated state. |
| `"none"`             | Kept in the local graph; never sent by this plugin.                             |

| `durable`             | Intended lifetime                                                        |
| --------------------- | ------------------------------------------------------------------------ |
| `"forever"` (default) | Persistent storage on the server, or local persistence for `sync: none`. |
| `"connection"`        | Memory associated with the writing connection.                           |
| `"5s"`, `"2m"`        | Connection-associated memory with an expiry timer renewed on each write. |

A `sync: peers` component can also declare `pace`, how often it is sent:

```json
{
  "presence": {
    "type": "object",
    "component": true,
    "sync": "peers",
    "durable": "connection",
    "pace": "100ms",
    "properties": { "x": { "type": "number" }, "z": { "type": "number" } }
  }
}
```

A page that moves something every frame can write it every frame: the local
graph takes each write at once, and the plugin sends the latest value per entity
at most once a pace. The first write after a quiet spell is sent at once, the
writes inside a pace fold into one patch sent when it runs out, so the last
value always arrives, and a clear (the component set to `null`) is sent at once,
taking the folded patch with it. Values one message carried are paced together,
so their next values also share a message.

`syncOf(vocab, name)` and `durableOf(vocab, name)` read these keywords.
`local(vocab, name)` returns `'vault'` for local-only persistent state,
`'memory'` for other local-only state, and `null` for state sent to the server.
Here `'vault'` is an API value meaning caller-provided local persistence; the
helper does not implement it or enforce expiry timers.

One `apply()` can contain both a recipe and its local draft. Both commit in the
same local transaction, but only the recipe is posted. Outgoing data contains
only caller-supplied patches and writable properties. Computed properties,
server stamps, and patches generated by local cascading or provenance rules are
excluded; the server computes its own results. `outward` selects `sync: server`
components and preserves `$was` checks and deletion requests. Peer updates use
the socket without those checks or deletion requests.

## Reading is a subscription

`subscribe(query)` sends `{"subscribe": "<query>", "id": "s1"}` over `/ws`. The
server sends an initial answer followed by updates; the plugin applies them to
the graph for local reads. Until the initial answer arrives, a local read can
return cached or incomplete data.

`subscribe(true)` requests the raw stream of committed patches instead of a
query result. `ready(id)` indicates whether an answer has been successfully
applied on the current connection. `onReady(fn)` reports readiness changes,
including an empty initial answer; it does not call the listener immediately.
`refresh(id)` resends a subscription, or all subscriptions when no id is given.

A frame's `gone` list names entities that left its result set. The plugin
removes those entities' synchronized components while retaining their identity
and any `sync: none` components. It preserves entities still held by another
active subscription. Removal from a result set is not a deletion: only an
incoming `tombstone` deletes an entity. Retained local components can still
match local queries.

A frame's `relay` list carries the `sync: peers` values other connections are
sending for entities in its set: somebody's cursor. They land in the graph as
patches on those entities, so a local query finds a peer's cursor beside the
entity it points at. A value its writer cleared, or whose writer's connection
closed, arrives as the component set to `null`. The first frame after a
(re)subscribe carries every value the set holds, and a peer value it leaves out
is cleared, except what this page is saying itself: the server never tells a
connection its own values. A stored row never carries a `sync: peers` component,
so a snapshot leaves them alone.

The server holds a relayed value under the connection that last said it, so the
plugin keeps what this page is saying and says it again on every new connection,
before it subscribes. The new connection takes each value over: peers hear it
again, and the old connection's close, whenever the server hears it, clears none
of it.

For bounded retention or partial query results, supply a `replica` policy; see
below. The standalone plugin applies incoming bundles as patches. Replacing
omitted properties from complete snapshots requires the exported `snapshot`
helper or a replica that uses it.

## Reconnecting

The socket reconnects with a delay that doubles from 250 ms to 30 seconds and
resets when it opens. `wait` and `most` customize these limits. One reconnect
timer is scheduled per connection manager.

All subscriptions are resent after reconnecting. Their first successful frames
are treated as complete replacement result sets. The connection manager compares
new membership with the previous set and adds missing entities to `gone`,
including entities that left while disconnected. Readiness resets on a new
connection; old cached rows do not make a subscription ready.

## Both transports are injected

`fetch` accepts a `Request` and returns a `Response` or promise, so an
`@yaks/api` handler can be used directly in a test. `connect` accepts a socket
URL and returns the package's `Socket` interface. Defaults use global `fetch`
and `WebSocket`; `timer`, which times reconnects and paces, defaults to
`setTimeout`.

```ts ignore
const link = sync(g, {
  url: 'https://recipes.example',
  fetch: (request) => myHandler(request),
  connect: (url) => new MySocket(url),
  timer: (fn, ms) => setTimeout(fn, ms),
  headers: { authorization: `Bearer ${token}` },
})
```

This example assumes the application supplies `g`, `myHandler`, `MySocket`, and
`token`. `headers` applies to HTTP writes only. Socket authentication belongs to
the supplied connection mechanism or the server's session handling.

## API

`sync(graph, options)` registers a plugin and returns a `Sync` object:

| Member                         | Purpose                                                                     |
| ------------------------------ | --------------------------------------------------------------------------- |
| `plugin`                       | The registered graph plugin.                                                |
| `subscribe(query, id?, opts?)` | Register a subscription and return its id.                                  |
| `unsubscribe(id)`              | Remove a subscription.                                                      |
| `refresh(id?)`                 | Request a fresh answer for one or all subscriptions.                        |
| `ready(id)`                    | Check whether an answer has been applied on this connection.                |
| `onReady(fn)`                  | Add a readiness listener and return its removal function.                   |
| `open()`                       | Open the socket without adding a subscription.                              |
| `connected()`                  | Check whether the socket is currently open.                                 |
| `idle()`                       | Wait for the currently queued HTTP writes to settle, including failures.    |
| `close()`                      | Close the socket, stop reconnecting, and clear subscriptions and listeners. |

`close()` does not abort queued HTTP writes or unregister the graph plugin.
Finish pending work before discarding the graph. `idle()` does not imply that
every write succeeded, and a browser unload does not guarantee time to await it.

A `replica` option supplies `subscribe`, `unsubscribe`, `land`, and `protect`
methods to manage retained entities, subscription ownership, and pending-write
protection. It is required for frames carrying `coverage` or `peerCoverage`
(component/property scope), `peers` (additional related-entity data), or
`peerGone` (departures from that additional data). The
[@yaks/client](../client/README.md) package composes this policy for client
state.

The root module also exports these lower-level helpers and their public types;
there are no sub-module exports:

- State selection: `syncOf`, `durableOf`, `local`, `outbound`, `stored`, and
  `outward`.
- HTTP reconciliation: `post` and `inverse`.
- Incoming frames: `land`, `strip`, `snapshot`, and `hear` (a frame's relayed
  values).
- Sockets: `wire` and `backoff`.
- Internal request/response marks: `asked`, `asking`, `before`, `clean`, `echo`,
  `echoed`, `ECHO`, and `SENT`; `replicate` applies what a server sent the way
  every one of these paths does.
- Partial-result scope: `covers` and `delivered`, with the `Coverage` type.
- Worker messages: `portLink`, described below.

## Compatibility

The package targets browsers and server JavaScript runtimes with web transport
APIs, including Deno, Node, Bun, and Cloudflare Workers. Inject `fetch` or
`connect` when the runtime does not provide a compatible default. It is checked
with `lib: ["dom", "esnext"]` and no Deno types. Runtime dependencies are
`@yaks/graph` and `@yaks/vocab`.

## Related packages

[@yaks/graph](../graph/README.md) defines graph writes;
[@yaks/ram](../ram/README.md) supplies local in-memory storage;
[@yaks/api](../api/README.md) implements the server protocol;
[@yaks/query](../query/README.md) defines subscription query syntax.

## License

Apache-2.0

## Workers and MessagePorts

`portLink(port, options)` sends requests and subscription frames over a `Worker`
or `MessagePort` using structured-clone messages. Both ends use the same helper.
The receiver supplies an explicit `receive(method, value)` handler for supported
operations. It can send subscription frames from the API's `subscriptions`
registry; the client can apply them with `land`:

```ts ignore
import { land, portLink } from '@yaks/sync'

const client = portLink(worker, {
  frame: (frame) => {
    void land(localGraph, frame)
  },
})
await client.request('subscribe', ['books', '.book'])
```

This fragment assumes an existing `worker`, `localGraph`, and a server handler
for `subscribe`. The helper does not provide authorization, optimistic writes,
reconnection, or subscription ownership. Direct `land` calls remove synchronized
components for `gone` entities; the caller must protect entities still held by
overlapping subscriptions.

Requests time out after 30 seconds by default, with at most 256 outstanding
requests. Configure these using `timeout` and `maxPending`. A timeout rejects
the caller but does not cancel an operation already running at the other end.
`close()` removes listeners and rejects pending requests without closing or
terminating the caller-owned port. `stats` counts sent messages, received
messages, and subscription frames. Frame streams do not implement credit-based
backpressure.

### Request deadlines

Override the timeout per request when an operation can take longer:

```ts ignore
await client.request('close', undefined, { timeout: null })
```

`null` disables that request's deadline. Link closure, detected disconnection,
and worker errors still reject it. This allows graceful shutdown to finish
without changing the deadlines on ordinary requests.
