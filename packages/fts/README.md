# @yaks/fts

Full-text search over graph component tables using SQLite FTS5. The package
creates search indexes and maintenance triggers, extends `@yaks/sql` queries
with text matching, and returns ranked results with snippets. It uses a database
connection supplied by the application and opens no storage itself.

## Install

```sh
deno add jsr:@yaks/fts
# or: npx jsr add @yaks/fts
```

## What gets indexed

Mark searchable string properties with `search: true` in the vocabulary:

```json
{
  "$defs": {
    "book": {
      "component": true,
      "type": "object",
      "kind": true,
      "properties": {
        "title": { "type": "string", "search": true },
        "blurb": { "type": "string", "search": true },
        "price": { "type": "number" }
      }
    }
  }
}
```

`fields(vocab)` selects marked, stored scalar text properties. It excludes
computed properties, references and numbers. Unmarked properties remain readable
but are not indexed. A vocabulary with no searchable properties produces no
indexes or results. An optional `pick(prop)` replaces the default selection
predicate; combine it with `searched(prop)` when narrowing the default.

There is **one index per component**, containing all its selected properties.
For example, `book_fts` contains both `title` and `blurb`. Each is an
external-content FTS5 table: the index stores terms while the original text
remains in the component table. Insert, update and delete triggers keep it
current.

A component can also name text its entities are found by on another component,
with a `search` list: `entry` says `"search": ["content.body"]`. That makes
`entry_fts`, which indexes `content.body` for entities carrying `entry` and for
no other entity carrying `content` (tool results, process output). It reads its
text through the `entry_text` view, which joins the two tables, and two more
triggers on `entry` index text already written when an entity becomes an entry
and remove it when it stops being one. Whichever row a transaction writes second
does the indexing, so the order of a bundle's components does not matter.

## The four pieces

This example assumes `vocab` is loaded from the schema above with the graph's
base vocabulary, and `db` is a synchronous driver with `query(sql, params)` and
`exec(sql)`. Create the graph's component tables before these indexes.

```ts
import { fields, find, heal, schema, search } from '@yaks/fts'
import { compile } from '@yaks/sql'
import { parse } from '@yaks/query'

let text = fields(vocab)
for (let statement of schema(text)) db.query(statement)
heal(db, text) // populate indexes if the component tables already had rows

let screen = compile(parse('.book.price<20'), vocab)
let hits = find(db, text, 'hobbit', { screen, limit: 10 })
// Each hit: { entity: 'book-1', rank: -1.9, snippet: 'A \x01hobbit\x02…' }

let statement = compile(parse('hobbit .book.price<20'), vocab, {
  extend: [search(text)],
})
```

The pieces can be used independently:

- `fields(vocab, pick?)` selects properties.
- `schema(fields, reads?)` returns SQL statements to create the indexes and
  triggers. It does not populate indexes from existing rows; call `heal()` or
  use `adopt()` for an existing database.
- `search(fields, db?)` compiles text clauses into FTS5 membership conditions.
  Pass it through the adapter's `extend` option to enable text clauses in
  ordinary storage reads. Given the database's driver it also orders by
  relevance: `.order=search` puts the closest match first and `.order=-search`
  the weakest, ranking once per query among the rows the rest of it admits. The
  best `RANKED` (1000) are put in order and any past them follow.
- `find(db, fields, text, options?)` executes a ranked search. `hits()` returns
  the same `{ sql, params }` statement without executing it, for use with an
  asynchronous database. It returns `null` when there are no search terms or
  indexes; `find()` returns `[]` in those cases.

## Matching and ranking

Words match prefixes: `research` can match `researching`. Quoted phrases remain
phrases, and a trailing `*` requests a prefix. Other FTS5 operators are quoted
as text. The default tokenizer does not stem words.

The SQL extension ANDs separate text clauses; each clause can match a different
component index on the same entity. Ranked `find()`/`hits()` searches require
all terms to match within one component index. Results across indexes are
merged, with one result per entity using its best index score and corresponding
snippet.

FTS5 `bm25` supplies the rank, where lower numbers are better matches. No
recency or popularity weighting is added. `limit` defaults to 20 and snippet
`context` defaults to 10 words. An optional `screen` is SQL selecting the
permitted eids, such as the statement returned by `compile()` above. Ranking
reads only the index; a snippet is cut afterwards, for the rows returned,
because FTS5 reads a row's whole text back to cut one.

Snippets mark matches with `OPEN` (`\x01`) and `CLOSE` (`\x02`), not HTML.
Renderers must escape the text and add their own highlighting.

## Text stored outside the component row

A blob-backed property stores an address in its component table. Supply
`blobRead(vocab)` from `@yaks/blob` as `schema()`'s second argument to index the
resolved text:

```ts
import { blobRead } from '@yaks/blob'
import { adopt } from '@yaks/fts'

adopt(db, text, blobRead(vocab))
```

The generated `<comp>_text` view resolves content for snippets and rebuilds. The
triggers resolve both old and new values, so direct SQL writes and graph writes
index the same text. A shared `@yaks/sql` read override must supply
`text(stored)`; a read override with only `expr(owner)` is rejected because a
delete trigger must resolve the old value after the component row changes.

## Maintaining existing indexes

`heal(db, fields, { deep? })` compares component row counts with the FTS index's
`_docsize` table and rebuilds inconsistent indexes. Counting the
external-content index itself would only count its source rows. The default
count check cannot detect every form of corruption. `deep: true` adds FTS5's
full integrity check, which is more expensive and suits maintenance runs. The
return value lists rebuilt indexes; a failed rebuild throws.

`adopt(db, fields, reads?, options?)` brings an existing database into the
generated layout. It preserves indexes whose columns and content source match,
recreates and rebuilds mismatched indexes, updates changed text views, removes
other triggers referencing these indexes, and calls `heal()` last. It returns
`{ recut, dropped, healed }`. A second call with the same configuration makes no
changes. Review custom triggers before adopting existing indexes.

## What it assumes

The SQLite layout used by `@yaks/sql` and `@yaks/sqlite`: `entity.id` is an
integer primary key, `entity.eid` is the public ID, component tables have an
`entity` owner column, and `tombstone` identifies deleted entities. FTS rowids
are the integer owner IDs. Ranked searches exclude tombstoned entities.

`@yaks/sqlite` can create a compatible `doc_fts` index. The generated statements
use `if not exists`; use `adopt()` when an existing index's configuration
differs. For vector similarity ranking, see
[@yaks/embedding](../embedding/README.md).

## Exports

The root module is the only export path. It exports field selection (`fields`,
`searched`, `indexes`, `indexName`, `textName`), DDL and maintenance (`schema`,
`heal`, `adopt`), query integration (`search`), ranked search (`find`, `hits`),
text conversion (`term`, `match`, `OPEN`, `CLOSE`), and their supporting types,
including `Field`, `Hit` and `SearchOpts`. The `Driver` it runs on is
`@yaks/sql`'s.

## Compatibility

Requires SQLite with FTS5. The package has no runtime-specific storage binding;
the supplied driver determines which runtime it can run in. `find`, `heal` and
`adopt` require synchronous driver methods; generated SQL can be executed
through an asynchronous adapter.
