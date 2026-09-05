# @yaks/workers

The Cloudflare Workers adapter that serves [@yaks/api](https://jsr.io/@yaks/api)
from a Worker.

## Install

```sh
deno add jsr:@yaks/workers
# or: npx jsr add @yaks/workers
```

## What goes here

`@yaks/api` is written to web-standard `Request`/`Response` types and knows
nothing about any host. This package is the thin seam that binds it to the
Workers runtime:

- it reads the Worker `env` to reach a graph's storage — a Durable Object
  namespace ([@yaks/durable-object](https://jsr.io/@yaks/durable-object)) or a
  D1 binding ([@yaks/d1](https://jsr.io/@yaks/d1));
- it performs the Workers-native WebSocket upgrade for the `/ws` route;
- it exports the `fetch` entrypoint a Worker requires.

It holds only what is Cloudflare-specific; the routing and the graph logic stay
in the portable packages, so the same API also runs under Deno or Node behind a
different, equally thin adapter.

## The interface

It exports the shape it satisfies: `Env`, `Worker`, and the `worker` factory.
The implementation lands with the package.
