# @yaks/edge

Links between entities in a [@yaks/graph](https://jsr.io/@yaks/graph), modelled
as a **component**.

## Install

```sh
deno add jsr:@yaks/edge
# or: npx jsr add @yaks/edge
```

## What goes here

A relationship here is not a foreign-key column; it is an `edge` component —
`{ from, to }`, optionally typed — carried by an entity like any other
component. Because an edge is a component, it patches, tombstones, and travels
over the graph wire exactly like the rest of the model: no special table, no
special write.

```ts
import type { Edge } from '@yaks/edge'

let link: Edge = { from: 'post-1', to: 'author-9', type: 'author' }
```

The package owns that component and the traversal built on it: an entity's
neighbours one hop away, and the set reachable within a bounded depth. It
contributes `edge` as a plugin and evaluates nothing itself — a
[Storage](https://jsr.io/@yaks/graph) adapter answers the underlying reads.

## The interface

It exports the shape it satisfies: `Edge`, `Hop`, a `Traversal` seam
(`neighbours`, `reach`), and the `plugin` factory. The implementation lands with
the package.
