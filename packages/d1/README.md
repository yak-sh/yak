# @yaks/d1

A [@yaks/graph](https://jsr.io/@yaks/graph) **storage adapter** backed by
Cloudflare **D1**.

## Install

```sh
deno add jsr:@yaks/d1
# or: npx jsr add @yaks/d1
```

## What it is

D1 is a serverless SQLite exposed only over an async API, so this adapter is
**async end to end**: every read and write returns a promise. It composes the
yaks query → vocabulary → SQL stack over a D1 binding to satisfy the `Storage`
seam:

- **read** — a query in, matching entities out as whole bundles;
- **write** — a change patched into rows, with the death cascade a delete
  implies.

## Where it sits

It is one of three interchangeable storage adapters, all implementing the same
`Storage` seam from [@yaks/graph](https://jsr.io/@yaks/graph):

- **@yaks/d1** — Cloudflare D1, async (this package);
- **[@yaks/durable-object](https://jsr.io/@yaks/durable-object)** — a Durable
  Object's embedded, synchronous SQLite;
- **[@yaks/sqlite](https://jsr.io/@yaks/sqlite)** — an in-process SQLite.

The seam is async-or-sync: this adapter returns promises, a synchronous one does
not, and a graph stays portable across them.

## The interface

The package exports the shape it satisfies: the minimal `D1Like` binding it
needs and `openStore(db, vocab) → Storage`. The implementation lands with the
package.
