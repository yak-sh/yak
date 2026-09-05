# @yaks/durable-object

A [@yaks/graph](https://jsr.io/@yaks/graph) **storage adapter** backed by a
Cloudflare **Durable Object**: its embedded SQLite holds the graph, and its
WebSockets keep every connected client in sync.

## Install

```sh
deno add jsr:@yaks/durable-object
# or: npx jsr add @yaks/durable-object
```

## What it is

A Durable Object is a single, strongly-consistent home for one graph. Its
`SqlStorage` handle is a synchronous SQLite engine; its hibernatable WebSockets
are a natural live-sync fan-out. This adapter composes the yaks query →
vocabulary → SQL stack over that handle to satisfy the `Storage` seam:

- **read** — a query in, matching entities out as whole bundles;
- **write** — a change patched into rows, with the death cascade a delete
  implies;
- **live sync** — every committed change broadcast to the other sockets, so open
  tabs converge.

## Where it sits

It is one of three interchangeable storage adapters, all implementing the same
`Storage` seam from [@yaks/graph](https://jsr.io/@yaks/graph):

- **@yaks/durable-object** — a Durable Object's embedded SQLite (this package);
- **[@yaks/d1](https://jsr.io/@yaks/d1)** — Cloudflare D1, async;
- **[@yaks/sqlite](https://jsr.io/@yaks/sqlite)** — an in-process SQLite.

Because they share the seam, a graph is portable across them. Served in front of
a graph by [@yaks/api](https://jsr.io/@yaks/api) and its Workers adapter
[@yaks/workers](https://jsr.io/@yaks/workers).

## The interface

The package exports the shape it satisfies: the minimal `DurableSql` handle it
needs, a `LiveSync` fan-out, and `openStore(sql, vocab, live?) → Storage`. The
implementation lands with the package.
