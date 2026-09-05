# @yaks/embedding

Semantic search for a [@yaks/graph](https://jsr.io/@yaks/graph): meaning-nearest
entities, beside the literal matches full-text gives.

## Install

```sh
deno add jsr:@yaks/embedding
# or: npx jsr add @yaks/embedding
```

## What goes here

This package embeds any text property a vocabulary marks, stores the vectors
beside the rows, and answers a `.near=<entity>` query by ranking the graph by
cosine similarity to that entity's vector. It is generic over the text property,
exactly as [@yaks/fts](https://jsr.io/@yaks/fts) is — a title, a body, or an
app's own prose can all have neighbours — and the two compose: keyword recall
from FTS, semantic recall from here.

The embedder is pluggable (a local model, a hosted API); this package owns the
sweep that keeps vectors current, the `.near` ranking, and the duplicate hint
that falls out of it. A [Storage](https://jsr.io/@yaks/graph) adapter holds the
vectors.

## The interface

It exports the shape it satisfies: `Embedder`, `Near`, and a `Semantic` seam
(`sweep`, `near`). The implementation lands with the package.
