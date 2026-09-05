# @yaks/fts

Full-text search over a [@yaks/graph](https://jsr.io/@yaks/graph), on **any**
text property.

## Install

```sh
deno add jsr:@yaks/fts
# or: npx jsr add @yaks/fts
```

## What goes here

Search here is not welded to one "document" component. A vocabulary declares
components; some of their columns hold prose — a book's title, a review's
paragraph, a shop's own description — and this package indexes whichever of them
you choose, then answers a search across all of them at once. It is backed by
SQLite's FTS5, kept in step with the rows by triggers, and ranks matches with a
marked snippet.

## The four pieces

```ts
import { fields, find, schema, search } from '@yaks/fts'
import { compile } from '@yaks/sql'
import { parse } from '@yaks/query'

// 1. which properties are searchable
let text = fields(shop) // [{comp: 'book', prop: 'title'}, …]

// 2. the index, and the triggers that keep it current
for (let stmt of schema(text)) db.exec(stmt)

// 3. bare words compile to an FTS match, so words and filters mix on one line
let { sql, params } = compile(parse('hobbit .price<20'), shop, {
  extend: [search(text)],
})

// 4. ranked hits, each with a snippet
let hits = find(db, text, 'hobbit')
// [{ entity: 'bk_31', rank: -1.9, snippet: 'A \x01hobbit\x02 leaves home…' }]
```

Each piece stands alone: index without querying through `@yaks/sql`, or compile
a query without ever calling `find`.

- **`fields(vocab, pick?)`** reads the text properties off a
  [@yaks/vocab](https://jsr.io/@yaks/vocab) schema. The default takes every
  stored text column; a `pick` narrows it (titles only, say).
- **`schema(fields)`** emits one FTS5 index per component — external-content, so
  the prose is never stored twice — plus the three triggers that follow the
  table. **`heal(db, fields)`** checks each index against its table and rebuilds
  one that drifted.
- **`search(fields)`** is the [@yaks/sql](https://jsr.io/@yaks/sql) extension:
  it claims the `text` clause and compiles it to a `match` over every index.
  What a person typed is always spelled as a quoted phrase, so match syntax in a
  search box is text, not grammar; a trailing `*` is the one piece of grammar
  they can reach.
- **`find(db, fields, text, opts)`** ranks the matches by relevance (FTS5's bm25
  — lower is closer) and marks each hit with `\x01`…`\x02` rather than markup,
  so a renderer chooses its own emphasis without trusting the content. Pass
  `opts.screen` — a statement compiled by `@yaks/sql` — and the words rank only
  what the filters already allow. `hits()` is the same statement without a
  driver, for an async engine.

## What it assumes

The storage layout `@yaks/sql`'s SQLite dialect reads and
[@yaks/sqlite](https://jsr.io/@yaks/sqlite) builds: an `entity` spine of integer
ids, one table per component keyed by an `entity` owner, and a `tombstone` table
naming the dead. Index rowids line up with spine ids, so a match needs no join.
`@yaks/sqlite` already ships this index for a `doc` component and spells it the
same way, so installing both is idempotent.

Ranking is relevance alone. Blending in recency or popularity is an
application's policy, applied to what comes back.

For meaning-nearest results beside these literal matches, pair it with
`@yaks/embedding`.

## Compatibility

Pure TypeScript over a caller-supplied SQLite handle (two functions: run a
statement, run a statement for effect). Runs on **Deno** and **Node** (via JSR /
npm). Requires an SQLite build with FTS5, which is the default in nearly all of
them.
