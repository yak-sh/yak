# @yaks/api

The transport in front of a [@yaks/graph](https://jsr.io/@yaks/graph), as a
plain request handler that runs in any JavaScript environment.

## Install

```sh
deno add jsr:@yaks/api
# or: npx jsr add @yaks/api
```

## What goes here

Given a [Storage](https://jsr.io/@yaks/graph), this package answers the three
routes a client needs and nothing more:

- **POST `/apply`** — a change in, the applied result out;
- **GET `/query`** — a query in, matching bundles out;
- **`/ws`** — a WebSocket that streams committed changes, so open clients
  converge.

It is written to the web-standard `Request`/`Response` types, so it hosts
unchanged on Deno, Node, or a Cloudflare Worker — the environment adapter is a
thin wrapper. It holds no environment specifics and no routing framework: it
_is_ the route table.

## Where it sits

Serve it on Cloudflare with [@yaks/workers](https://jsr.io/@yaks/workers), over
storage from [@yaks/durable-object](https://jsr.io/@yaks/durable-object) or
[@yaks/d1](https://jsr.io/@yaks/d1).

## The interface

It exports the shape it satisfies: `Handler`, `Upgrade`, `Options`, and the
`api` factory that builds a handler for a store. The implementation lands with
the package.
