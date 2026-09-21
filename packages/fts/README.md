# @yaks/fts

Full-text search over a yaks graph, using SQLite's FTS5. The package generates
the SQL that creates and maintains the indexes, and it plugs text matching into
the queries `@yaks/sql` compiles.

## Install

```sh
deno add jsr:@yaks/fts
# or: npx jsr add @yaks/fts
```

## What gets indexed

Search is not limited to a single "document" component. A vocabulary declares
components, and some of their columns hold prose — a book's title, a review's
paragraph, a shop's own description. Each such column is marked `"search": true`
in the vocabulary. This package creates an index for every marked column and
searches all of them at once. The indexes are SQLite FTS5 virtual tables, kept
up to date by triggers on the component tables, and results come back ranked
with a snippet that marks each match.

## The four pieces

```ts
import { fields, find, schema, search } from '@yaks/fts'
import { compile } from '@yaks/sql'
import { parse } from '@yaks/query'

// 1. which columns the vocabulary marked searchable ("search": true)
let text = fields(shop) // [{comp: 'book', prop: 'title'}, …]

// 2. the indexes, and the triggers that keep them current
for (let stmt of schema(text)) db.exec(stmt)

// 3. bare words compile to an FTS5 match, so words and filters
//    mix in one query
let { sql, params } = compile(parse('hobbit .price<20'), shop, {
  extend: [search(text)],
})

// 4. ranked results, each with a snippet
let hits = find(db, text, 'hobbit')
// [{ entity: 'bk_31', rank: -1.9, snippet: 'A \x01hobbit\x02 leaves home…' }]
```

Each piece works on its own: you can create the indexes without ever querying
through `@yaks/sql`, or compile a query without ever calling `find`.

One index per component is the whole design, and it is also why nothing here
reads across components. A letter's envelope is text on the `mail` component and
is indexed in `mail_fts`; a search across every index finds the letter by its
address without the document index having to carry an `addr` column joined in
from the letter. An application that wants to rank an address above prose writes
its own statement over the per-index subqueries that `hits()` builds.

- **`fields(vocab, pick?)`** reads the searchable columns off a
  [@yaks/vocab](https://jsr.io/@yaks/vocab) schema: the ones marked
  `{"note": {"type": "string", "search": true}}`. Deciding which prose is worth
  finding belongs to the vocabulary, so a text column nobody marked is stored
  and readable but never indexed, and a vocabulary that marks none has nothing
  to search — there is no fallback that indexes every text column. A `pick`
  function narrows the selection further (titles only, say).
- **`schema(fields, text?)`** returns the statements that create one FTS5 index
  per component — external-content indexes, so the prose is never stored twice —
  plus the three triggers that keep each one in step with its table. The `text`
  argument names the columns that do not hold their own text: `@yaks/blob`
  stores a SHA-256 in place of a body, and `schema(fields, blobText(vocab))`
  resolves that in both trigger bodies and in the `<comp>_text` view the index
  reads its content back through, so the index holds prose rather than hashes.
  **`heal(db, fields, {deep})`** checks each index against its table —
  membership is counted in the index's own `_docsize` shadow table, because
  counting rows in an external-content index only re-reads the table it mirrors
  — and rebuilds any index that has drifted. Passing `deep: true` also runs
  FTS5's own whole-index integrity check, which reads both shadow tables in full
  and so belongs to a maintenance pass rather than to start-up.
  **`adopt(db, fields, text?)`** is for a database that already has search
  objects, created by hand or by an earlier version of this package: it makes
  them match what `schema` returns. An index whose columns already match is kept
  along with its indexed terms, one that differs is dropped, created again and
  rebuilt, any trigger writing into an index that is not one of this package's
  three is dropped (an external-content index has exactly three writers; a
  fourth double-counts every row), and `heal` runs last. Calling it a second
  time changes nothing.
- **`search(fields)`** is the [@yaks/sql](https://jsr.io/@yaks/sql) extension:
  it handles the `text` clause and compiles it to a `match` against every index.
  Every word is quoted, so FTS5 match syntax typed into a search box is treated
  as text rather than as syntax. A bare word matches as a prefix (`research`
  finds `researching` — the tokenizer does not stem), several words are ANDed
  together and ranked, `"a quoted run"` stays one phrase and is matched exactly,
  and a trailing `*` is the one piece of match syntax a person can use.
- **`find(db, fields, text, opts)`** ranks the matches by relevance (FTS5's
  bm25, where a lower number is a closer match) and wraps each match in `\x01`…
  `\x02` rather than in markup, so a renderer can choose its own emphasis
  without having to trust the content. Pass `opts.screen` — a statement compiled
  by `@yaks/sql` — and only rows the filters already allow are ranked. `hits()`
  returns the same statement without running it, for an async database engine.

## What it assumes

The storage layout that `@yaks/sql`'s SQLite dialect reads and
[@yaks/sqlite](https://jsr.io/@yaks/sqlite) creates: an `entity` table of
integer ids, one table per component keyed by an `entity` owner column, and a
`tombstone` table listing deleted entities. An index's rowids are those same
entity ids, so a match needs no join. `@yaks/sqlite` already creates this index
for the `doc` component, with the same names, so installing both is idempotent.

Ranking is by relevance alone. Mixing in recency or popularity is an
application's policy, applied to the results it gets back.

For nearest-meaning results alongside these literal matches, pair this package
with `@yaks/embedding`.

## Compatibility

Pure TypeScript over a SQLite handle the caller supplies (two functions: run a
statement and return rows, run a statement for its effect). Runs on **Deno** and
**Node** (via JSR / npm). Requires a SQLite build with FTS5 compiled in, which
is the default in nearly all of them.
