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

## Honest coverage

The common query path is exact: predicates (every operator), any-of lists,
ranges, time phrases, boolean composition, reference-deref paths, reverse hops,
full-text terms, the `.kind` scope, presence/absence, ordering,
`.limit`/`.after` windows, `.count`/`.distinct`/`.tally` aggregates, `.fields`
projections, and the `.refs=` backlink union.

Advanced directives it cannot yet reach throw **`Unsupported`** rather than
answer almost-right — a caller catches it to fall back to a JS matcher or to
report the gap. The current gaps are the `.near` KNN and the `.edges`/`.reaches`
graph walks (`bind.ts` has the exact list).

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

Pure TypeScript with no runtime dependency beyond a `@yaks/query` AST and a
`@yaks/vocab` schema. Runs on **Deno** and **Node** (via JSR / npm).
