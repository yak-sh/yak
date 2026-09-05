# @yaks/fts

Full-text search over a [@yaks/graph](https://jsr.io/@yaks/graph), on **any**
text property.

## Install

```sh
deno add jsr:@yaks/fts
# or: npx jsr add @yaks/fts
```

## What goes here

Search here is not welded to one "document" component. This package indexes
whichever component properties a vocabulary marks as text — a title, a body, a
comment, an app's own prose — and answers a search over them through one seam.
It is backed by SQLite's FTS5, kept in step with the base rows by triggers, and
ranks matches with a highlighted snippet.

A search is expressed as a text predicate in the yaks query grammar, so a search
box mixes words and filters on one line (see
[@yaks/query](https://jsr.io/@yaks/query)). This package supplies the text half;
a [@yaks/vocab](https://jsr.io/@yaks/vocab) schema says which properties are
indexed, and a [Storage](https://jsr.io/@yaks/graph) adapter holds the index.
For meaning-nearest results alongside literal matches, pair it with
[@yaks/embedding](https://jsr.io/@yaks/embedding).

## The interface

It exports the shape it satisfies: `Field`, `Hit`, and a `Search` seam
(`fields`, `find`). The implementation lands with the package.
