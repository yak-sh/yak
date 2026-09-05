# @yaks/journal

The memory of a [@yaks/graph](https://jsr.io/@yaks/graph): who wrote what, when,
and how to walk it forwards or backwards.

## Install

```sh
deno add jsr:@yaks/journal
# or: npx jsr add @yaks/journal
```

## What goes here

Every change committed through the graph's `apply()` passes through a **journal
phase** that records an attributed entry — the change, its author, and the
moment. From that one log everything else is derived:

- **history** — the entries touching an entity, newest first;
- **undo** — the inverse change that reverts an entry;
- **cursors** — a per-reader marker into the log, so a client resumes where it
  left off;
- **deltas** — the entries since a cursor, the feed a live client replays;
- **effect-feed** — the same stream an effect worker consumes at-most-once.

The package owns the recording and these derivations; it does not own the store
— it writes through whatever [Storage](https://jsr.io/@yaks/graph) the graph is
bound to, and pairs with [@yaks/effects](https://jsr.io/@yaks/effects), which
consumes the feed.

## The interface

It exports the shape it satisfies: `Entry`, `Attribution`, `Cursor`, and a
`Journal` seam (`record`, `history`, `invert`, `since`). The implementation
lands with the package.
