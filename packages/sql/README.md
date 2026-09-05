# @yaks/sql

Compile a [`@yaks/query`](../query) AST against a [`@yaks/vocab`](../vocab)
schema into a **SQL string and bound params**, through a dialect-agnostic
relational IR. A SQLite dialect ships with the package.

`@yaks/query` parses a query string to an AST; `@yaks/vocab` describes a
component vocabulary; this package binds the two and lowers them to SQL for a
dialect. A value is **always a bound param**, never a concatenated literal.

## The pipeline

```ts
import { compile } from '@yaks/sql'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab([kernel, work])
let { sql, params } = compile(parse('.status=open&.priority>=1'), vocab)
// sql: 'select "entity"."eid" as eid from "entity" left join … where …'
// params: [1]
```

Two passes over a dialect-agnostic relational IR:

- **`bind(ast, vocab, opts)` → `Rel`** — route every path through the vocab,
  coerce every value by its column's category, build the joins, turn each
  directive into a projection, a bound, or an ordering.
- **`render(rel)` → `{ sql, params }`** — the dialect turns the IR into SQL
  text.

`compile` is their composition.

## The IR is the seam

The IR (`ir.ts`) is Arel-shaped and carries the statement as data, so a new
backend (D1, Postgres) is another **renderer over the same value** — the
structure never changes, only the leaf column lowerings behind a `Dialect`
(`sqlite.ts`) and, for a non-`?` placeholder dialect, a renumber of the params.

## Computed columns

A column a vocabulary marks `persist: false` has no stored value — its formula
belongs to the application, not the schema. Supply those through the **derived
hook** (`derived.ts`): a `Derived` map from `comp.prop` to the SQL expression
that reads it. A registered expression compiles a computed column through the
index instead of a JS scan.

```ts
import type { Derived } from '@yaks/sql'

let derived: Derived = {
  'order.total': {
    tag: 'number',
    expr: (owner) =>
      `(select coalesce(sum("line"."amount"), 0) from "line"` +
      ` where "line"."order" = ${owner})`,
  },
}
compile(ast, vocab, { derived })
```

## The extension seam

Some clauses need machinery this package does not own — a full-text term needs a
search index, `.near` needs vectors, `.edges` needs a link table. Each of those
lives in its own package, and each contributes one thing: how ITS clause becomes
a condition over this IR.

An **`Extension`** (`extend.ts`) is that contribution, registered the way a
plugin contributes a vocabulary — a named object passed to `compile`:

```ts
import { compile, type Extension, raw } from '@yaks/sql'

let shelves: Extension = {
  name: 'shelves',
  compile: {
    // one entry per clause kind it claims; `null` declines
    text: (clause, site) =>
      clause.kind == 'text'
        ? raw({
          sql: `${site.owner} in (select entity from "shelf" where label = ?)`,
          params: [clause.value],
        })
        : null,
  },
}
compile(ast, vocab, { extend: [shelves] })
```

The contract, whole:

- A compiler takes the clause and a **`Site`** — the bound `vocab`, the
  `dialect`, `now`, `owner` (the SQL naming this row's integer id), and
  `join(comp)`, which pulls a component table into the statement as a LEFT join
  and answers its owner column.
- It returns a `Cond` (build one with `raw`/`and`/`or`/`not` from `ir.ts`), or
  `null` to **decline** — the binder then compiles the clause itself, or refuses
  it as `Unsupported`.
- Extensions run in registration order, first non-null wins, and always **before
  the built-in** compilation, so one may replace a built-in lowering as well as
  supply a missing one.
- Claiming a directive kind that would otherwise decline (`near`, `edges`,
  `reaches`) makes it compile as a filter instead of throwing.
- An extension may also spell an **ordering** the vocabulary has no column for —
  a relevance, a similarity — through an `order(value, site)` hook. It is handed
  the `.order=` value with any leading `-` stripped and answers the `ORDER BY`
  expression, or `null` to let the value route to a column as usual. The
  expression carries no bound params (the IR's `ORDER BY` holds none), so a
  ranking lowers to an expression over values it can spell safely — the integer
  ids it already resolved, or a joined column. `site.owner` names the row the
  expression speaks about: a `.after` cursor asks the same hook a second time
  with the ANCHOR's owner id, so a ranking is pageable without a second seam.

## Ordering and paging

`.order=` sorts by a column (a leading `-` descending) or by an extension's
ranking, and `"entity"."num" desc` breaks its ties, so the order is total.

A `.limit`/`.after` window pages **within** that order — a window says how much
of a sequence to answer with, never which sequence. With no `.order=` the
sequence is newest-first by spine num, as it always was.

`.after=<num>` names the entity to continue past, the same spelling however the
answer is ordered. It compiles to a **keyset** on the anchor's own place in the
order: the anchor's value is read back through a correlated subselect and
compared against each row's, with the spine num breaking ties. Three fallbacks
fall out of that shape rather than being cased — an anchor that no longer
matches the query still has an order value to page from, one with no value pages
by its num alone, and one that no entity has leaves the guard true, which is the
first page. `@yaks/match` answers the same rule in memory, and its
`parity_test.ts` pins the agreement.

## Honest coverage

The common query path is exact: predicates (every operator), any-of lists,
ranges, time phrases, boolean composition, reference-deref paths, reverse hops,
full-text terms, the `.kind` scope, presence/absence, ordering,
`.limit`/`.after` windows, `.count`/`.distinct`/`.tally` aggregates, `.fields`
and `*` projections, the `.refs=` backlink union, and the `.eid=`/`.num=`
identity predicate.

Advanced directives it cannot yet reach throw **`Unsupported`** rather than
answer almost-right — a caller catches it to fall back to a JS matcher or to
report the gap. The current gaps are the `.edges`/`.reaches` graph walks, and
the `.near` KNN unless a vector package claims it — `@yaks/embedding` does,
ordering included (`bind.ts` has the exact list).

## Naming entities

`.eid=` and `.num=` NAME entities rather than filter them, so their operand list
is a set and compiles to one lookup on the spine. A human id is an operand too —
`@yaks/id` reads `B-7` as the entity numbered 7, the letter being display and
the number identity — so one grammar fetches a named set and filters it.

```
.eid=a3f1               "entity"."eid" in (?)
.eid=a3f1,b7c2          "entity"."eid" in (?, ?)
.num=3,4                "entity"."num" in (?, ?)
.eid=B-7                "entity"."num" in (?)
```

`@yaks/match` answers the same predicate as a set lookup, so a client can fetch
named entities from a database or from bundles it already holds.

## Reverse hops

A reference column is a name on the far side too: with a `review` component
whose `book` column points at a book, `@yaks/vocab` derives the association
`.reviews`, and this package compiles it as a correlated `EXISTS` (or `count`)
over that column — an index search per candidate, never a widening join.

```
.reviews!          the books that have a review
.reviews=          the books that have none
.reviews>=5        five or more reviews
.reviews.stars=5   a review of five stars exists
```

A child filter rides the same compiler over the child row, so a clause that
declines there declines the whole hop; a child predicate naming the spine
declines too, since inside the subquery that name is the correlation to the
outer row.

## Compatibility

Pure TypeScript with no runtime dependency beyond a `@yaks/query` AST, a
`@yaks/vocab` schema, and `@yaks/id` for reading a human id. Runs on **Deno**
and **Node** (via JSR / npm).
