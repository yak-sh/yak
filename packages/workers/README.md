# @yaks/workers

The Cloudflare adapter for [@yaks/api](https://jsr.io/@yaks/api): the three
things about serving a graph that belong to the Workers runtime, and nothing
else.

`@yaks/api` is a plain `Request` → `Response` handler. It has no idea where it
runs. This package is what makes it a Worker:

- **the socket** — `/ws` needs an upgrade, and no web standard covers one.
  Cloudflare's is a `WebSocketPair`.
- **the entrypoint** — a Worker exports `{ fetch }`, and its bindings arrive
  with the request rather than as an environment a module can read at import
  time.
- **the door** — who is writing, read off a Worker request: a session cookie, or
  a bearer token.

## Install

```sh
deno add jsr:@yaks/workers
# or: npx jsr add @yaks/workers
```

## A Worker in nine lines

The examples are a bookshop: books with a price and a status, reviews about
them, members who buy them.

```ts
import { door, worker } from '@yaks/workers'
import { shopGraph } from './shop.ts' // your graph, over your storage

export default worker({
  api: (env: { SHOP_SECRET: string }) => ({
    graph: shopGraph(env),
    authenticate: door({
      cookie: 'shop_session',
      verify: (token) => memberFor(token, env.SHOP_SECRET),
    }),
  }),
})
```

That serves `POST /apply`, `GET|POST /query` and `/ws` — the routes and the
refusals are [@yaks/api](https://jsr.io/@yaks/api)'s, unchanged.

`api` is called with the Worker's bindings and its answer is kept for the life
of the isolate, not rebuilt per request: an api built twice would mint a second
subscription registry, and the sockets already open would be listening to a
registry nobody applies through. Give it a graph and, if you want writes
attributed, a door.

```toml
# wrangler.toml
name = "shop"
main = "worker.ts"
compatibility_date = "2025-05-08"

[[d1_databases]]
binding = "SHOP"
database_name = "shop"
database_id = "…"
```

## The door

`door` reads the credential a request carries — the named cookie first, then an
`authorization: Bearer …` header — and hands it to your `verify`, which is the
only part that knows what a token means:

```ts
let authenticate = door({
  cookie: 'shop_session',
  verify: async (token) => {
    let person = await verifyJwt(token, env.SHOP_SECRET)
    return person ? { eid: person } : null
  },
  required: true, // a request naming nobody is answered 401
})
```

Without `required`, a request with no credential still reads and writes — its
batch simply lands with no actor on it. With it, an unnamed request is refused
before the graph sees it. Either way the door runs on **every** request, reads
and socket upgrades included, and the identity it returns is what signs the
batch: whatever `$actor` a client sent is thrown away.

`cookies(request)` and `bearer(request)` are exported on their own, for a door
that wants to decide differently.

## The socket

`worker()` wires `workerUpgrade` for you. Reach for it directly when you are
building the api yourself — inside a Durable Object, say:

```ts
import { api } from '@yaks/api'
import { workerUpgrade } from '@yaks/workers'

let handler = api({ graph, authenticate, upgrade: workerUpgrade })
```

It mints a `WebSocketPair`, accepts the half the server keeps, and answers 101
with the half the client gets. Off the Workers runtime it throws saying so.

## When the graph lives in a Durable Object

A Durable Object is one graph's home: single-threaded, strongly consistent, with
its own SQLite and its own open sockets
([@yaks/durable-object](https://jsr.io/@yaks/durable-object) is the storage
adapter for it). The Worker in front of it is then a switchboard rather than a
server — work out **which** graph the request is for, and hand the request over
unopened:

```ts
import { forward, type Namespace } from '@yaks/workers'

type Env = { SHOPS: Namespace }

export default {
  fetch: (request: Request, env: Env) =>
    // one graph per subdomain: ada.shop.example → the object named `ada`
    forward(env.SHOPS, new URL(request.url).hostname.split('.')[0], request),
}
```

The object at the other end runs `api()` over its own storage — it is the
server; this Worker is the route to it. Because the request crosses whole, its
method, path, body and `upgrade` header arrive intact, and the socket the object
answers with belongs to the client.

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

The name you forward by is the graph's identity, and the same name always
reaches the same object. Derive it from something the request cannot lie about —
a subdomain, a path segment you validate, a customer id you looked up — never
from a header a client sets.

## Compatibility

**Cloudflare Workers.** The package imports no Cloudflare package: every runtime
type it needs is written structurally — the slice of it this code uses — and
`WebSocketPair` is looked up on the global object rather than declared, so the
source type-checks and loads anywhere and throws only where a Worker's API is
missing. `conform.ts` holds those hand-written shapes against
`@cloudflare/workers-types` in a separate type-check, so they cannot drift from
the runtime they describe.

Its dependencies are the sibling packages: `@yaks/api` and `@yaks/graph`.

## The family

[@yaks/api](https://jsr.io/@yaks/api) owns the routes, the refusals and the
subscription model; [@yaks/graph](https://jsr.io/@yaks/graph) owns the bundle
wire and `apply()`; the bytes belong to a storage adapter —
[@yaks/durable-object](https://jsr.io/@yaks/durable-object) inside a Durable
Object, `@yaks/d1` over D1, [@yaks/memory](https://jsr.io/@yaks/memory) with
nothing underneath. This package is only the seam between them and Cloudflare.

## License

Apache-2.0
