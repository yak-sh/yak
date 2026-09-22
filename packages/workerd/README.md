# @yaks/workerd

Cloudflare Workers integration for [@yaks/api](../api/README.md). It provides a
Worker fetch entrypoint, WebSocket upgrades through `WebSocketPair`, request
authentication helpers, and request forwarding to Durable Objects. Applications
provide the graph, storage adapter, and authorization policy.

This package creates no database, component tables, or persistent records.
`worker()` caches API handlers in memory; each graph's storage adapter
determines where its data is kept. For example, [@yaks/d1](../d1/README.md) uses
D1 and [@yaks/durable-object](../durable-object/README.md) uses a Durable
Object's SQLite storage.

## Install

```sh
deno add jsr:@yaks/workerd
# or: npx jsr add @yaks/workerd
```

## Exports

All exports are available from `@yaks/workerd`:

| Exports                                         | Purpose                                                     |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `worker`, `Options`, `Worker`, `Env`, `Context` | Build and type a Worker fetch entrypoint                    |
| `door`, `Door`                                  | Build an authentication callback from a credential verifier |
| `cookies`, `bearer`                             | Read cookies or a bearer token from a request               |
| `workerUpgrade`, `Accepting`                    | Accept a Workers WebSocket and return the upgrade response  |
| `forward`, `Namespace`, `Stub`                  | Forward a request to a named Durable Object                 |

## Worker entrypoint

This example assumes `shop.ts` initializes a graph from the Worker's bindings
and verifies a token, returning an actor or `null`:

```ts
import { door, worker } from '@yaks/workerd'
import { memberFor, shopGraph } from './shop.ts'

type Env = { SHOP: unknown; SHOP_SECRET: string }

export default worker({
  api: async (env: Env) => ({
    graph: await shopGraph(env.SHOP),
    authenticate: door({
      cookie: 'shop_session',
      verify: (token) => memberFor(token, env.SHOP_SECRET),
      required: true,
    }),
  }),
})
```

This serves `POST /apply`, `GET|POST /query`, and `/ws` with the behavior and
errors described by [@yaks/api](../api/README.md). The `api` callback accepts
bindings and may return its options synchronously or asynchronously.

The handler is cached by the identity of the `env` object. Concurrent requests
using that object share initialization and the same subscription registry. A
different bindings object gets a different handler. Failed initialization is not
retained, so later requests can retry. This cache is local to a Worker isolate;
it does not coordinate subscriptions between isolates.

For a D1-backed application, the binding configuration might be:

```toml
# wrangler.toml
name = "shop"
main = "worker.ts"
compatibility_date = "2025-05-08"

[[d1_databases]]
binding = "SHOP"
database_name = "shop"
database_id = "replace-with-your-database-id"
```

`shopGraph` is application code that opens the corresponding storage adapter;
`worker()` does not open D1 or install a schema. Supply `SHOP_SECRET` through
your Worker's secret configuration.

## Request authentication

`door()` reads a configured cookie, or a bearer token when that cookie is
absent, and passes the credential and request to `verify`:

```ts
let authenticate = door({
  cookie: 'shop_session',
  verify: async (token, request) => {
    let member = await verifyToken(token, request)
    return member ? { by: member } : null
  },
  required: true,
})
```

`verifyToken` above is application code returning a member entity ID or `null`.
`verify` must return an actor such as `{ by: memberId, via: sessionId }`, or
`null`. The bearer token is not retried if a present cookie is empty or fails
verification. Omit `cookie` to read only the bearer token. Bearer scheme
matching is case-insensitive; cookie values are percent-decoded where possible.

With `required: true`, missing or rejected credentials result in HTTP 401.
Without it, requests with no verified actor are allowed and writes are
unattributed. `@yaks/api` invokes the callback for reads, writes, and socket
upgrades and replaces client-supplied `$actor` values with the verified actor.
The application and graph plugins still need to enforce authorization.

Use the separate `cookies(request)` and `bearer(request)` helpers to implement a
different credential-selection policy.

## WebSocket upgrades

`worker()` supplies `workerUpgrade` unless the API options include another
`upgrade`. When building a handler directly, pass it explicitly:

```ts
import { api } from '@yaks/api'
import { workerUpgrade } from '@yaks/workerd'

let handler = api({ graph, authenticate, upgrade: workerUpgrade })
```

It creates a `WebSocketPair`, accepts the server half, and returns
`{ socket, response }`, with HTTP 101 and the client half on the response. It
throws if the runtime does not provide `WebSocketPair`.

## When the graph lives in a Durable Object

A Durable Object can keep a graph's SQLite storage and subscriptions in one
instance. The outer Worker selects an object and forwards the request:

```ts
import { forward, type Namespace } from '@yaks/workerd'

type Env = { SHOPS: Namespace }

export default {
  fetch: (request: Request, env: Env) => {
    let shop = new URL(request.url).hostname.split('.')[0]
    return forward(env.SHOPS, shop, request)
  },
}
```

`forward(namespace, name, request)` calls `idFromName(name)`, gets the object's
stub, and passes the original request to `stub.fetch()`. It does not read the
body, change the path, or remove the upgrade header. The object implements its
own fetch handler, typically `api()` with `workerUpgrade` over its graph.

The application must implement and export the Durable Object class. A binding
for an application class named `Shop` might be:

```toml
# wrangler.toml
name = "shops"
main = "worker.ts"
compatibility_date = "2025-05-08"

[[durable_objects.bindings]]
name = "SHOPS"
class_name = "Shop"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Shop"]
```

The same name selects the same object within the namespace. Validate the
selected name and authorize the caller's access to that graph. A subdomain, path
segment, or client header identifies a destination; it does not prove access
rights.

## Compatibility

The WebSocket integration requires Cloudflare Workers APIs. Other interfaces are
structurally typed, so importing the package does not require a Cloudflare
global or package import. `conform.ts` checks those interfaces against
`@cloudflare/workers-types`. Runtime dependencies are `@yaks/api` and
`@yaks/graph`.

## Related packages

[@yaks/api](../api/README.md) defines routes, errors, and subscriptions;
[@yaks/graph](../graph/README.md) defines entities and write processing. Storage
adapters include [@yaks/durable-object](../durable-object/README.md),
[@yaks/d1](../d1/README.md), and [@yaks/ram](../ram/README.md). See the
[graph architecture](../graph/ARCHITECTURE.md) for adapter responsibilities.

## License

Apache-2.0
