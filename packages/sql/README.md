# @yaks/sql

Compiles a query into a SQL statement and the parameters to bind to it. The
query comes in as a [@yaks/query](../query/README.md) AST; the schema it is
compiled against is a [@yaks/vocab](../vocab/README.md) vocabulary. This package
never opens a database and never executes a statement — it only produces the
text and the parameters.

```sh
deno add jsr:@yaks/sql
```

## Terms used here

- **entity table** — the one table every entity has a row in. Its columns are
  the integer primary key `id`, the public `eid`, the sequence number `num`, and
  `archetype`. In the code it is called the spine, and `Dialect.spine` is the
  SQL that names it.
- **component table** — one table per component, named for the component. Its
  `entity` column holds the owner's integer `id`, and its other columns are the
  component's own. Reading a component column means LEFT JOINing that table, so
  "the column is NULL" and "the component is absent" are the same answer.
- **reference column** — a column that points at another entity. It stores the
  referent's integer `id`, so comparing it to an `eid` costs one lookup in the
  entity table and then an integer comparison.
- **presence test** — a predicate that asks only whether an entity has a
  component at all (`.task`, `.doc!`, `!.claim`), rather than comparing one of
  its columns. The AST field that marks one is called `facet`.

A deleted entity keeps its row in the entity table, because its integer `id`
must never be reused, but it is listed in the `tombstone` table. Every statement
this package compiles excludes tombstoned entities.

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

There are two passes, both over a relational intermediate representation that
holds no SQL text:

- `bind(ast, vocab, opts)` returns a `Rel`. It routes every path through the
  vocabulary, coerces every value according to its column's type, collects the
  joins, and turns each directive into a projected column, a LIMIT, or an ORDER
  BY.
- `render(rel)` returns `{ sql, params }`. This is where the dialect turns the
  representation into SQL text.

`compile` is the two composed.

## Matching on the archetype column

An entity's archetype records which set of component tables it has rows in. Pass
`opts.archetypes` and a presence test compiles to `entity.archetype in (…)`
instead of joining the component table it names. `archetypeSet(cache, ids)`
builds that function from an `Archetypes` cache (`@yaks/archetype`), which maps
a presence test to archetype eids, plus a map from those eids to the integer ids
this database file uses.

The same matching covers presence tests combined with AND/OR/NOT, a presence
test on the far side of a reference (`.session.claim!`), a presence test on the
child row inside a reverse hop, and `.kind=`, which expands to the named kind
being present and every kind that sorts before it being absent. Predicates that
compare a value still join their own table: a component row whose columns are
all NULL is still present, so the archetype cannot answer a value comparison.

The caller must supply a catalog that is current and complete for each plan.
Returning `undefined` declines — the compiler falls back to joins — and
returning `[]` means no archetype matches. Without this option, or against a
dialect with no `archetype` expression, nothing changes: presence still compiles
to a join. `@yaks/sqlite` builds the catalog lazily for any vocabulary that uses
archetypes.

## The intermediate representation

`ir.ts` holds a SELECT statement as data: the projected columns, the joins, a
boolean condition tree, grouping, ordering and the row limit. The names come
from Arel — project, join, where, group, order, take, distinct — so anyone who
has used Arel or ActiveRecord already knows what they do.

Because the representation carries no SQL text, a second backend (D1, Postgres)
is another renderer over the same value: the structure does not change, only how
leaf column expressions are lowered (a `Dialect`, see `sqlite.ts`) and, for a
backend whose placeholders are not `?`, a renumbering of the parameters on the
way out.

## Computed columns

A column the vocabulary marks `computed: true` has no stored value — its formula
belongs to the application, not to the schema. Supply those formulas through the
derived hook (`derived.ts`): a `Derived` map from `comp.prop` to the SQL
expression that reads the value. Registering an expression is what lets a
computed column be filtered in SQL, through an index, instead of scanning every
row in JavaScript.

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

A qualified path names its component as much as its column, so by default such a
read is NULL for an entity that does not have that component — the same answer a
stored column gives through its LEFT JOIN — no matter which rows the expression
itself reads. Set `worn: false` for the exception: an expression that is meant
to return a value even for an entity without the component, such as an
`updated.at` that falls back to `created.at`.

## Extensions

Some clauses need machinery this package does not own: a full-text term needs a
search index, `.near` needs vectors, `.edges` needs a link table. Each of those
lives in its own package, and each has one thing to contribute here — how its
own clause becomes a condition over this representation.

An `Extension` (`extend.ts`) is that contribution. It is registered the way a
plugin contributes a vocabulary: a named object passed to `compile`.

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

The whole contract:

- A clause compiler is called with the clause and a `Site`: the vocabulary being
  compiled against, the `dialect`, `now`, `owner` (the SQL naming this row's
  integer id), and `join(comp)`, which pulls a component table into the
  statement as a LEFT JOIN and returns its owner column.
- It returns a `Cond` (build one with `raw`/`and`/`or`/`not` from `ir.ts`), or
  `null` to decline, in which case the binder compiles the clause itself or
  refuses it by throwing `Unsupported`.
- Extensions run in registration order, the first non-null result wins, and all
  of them run before the built-in compilation — so an extension can replace a
  built-in lowering as well as supply a missing one.
- Claiming a directive kind that would otherwise be refused (`near`, `edges`,
  `reaches`) makes it compile as a filter rather than throw.
- An extension can also supply an ORDER BY the vocabulary has no column for — a
  relevance score, a similarity — through an `order(value, site)` hook. It is
  handed the `.order=` value with any leading `-` already stripped, and returns
  the ORDER BY expression or `null` to let the value route to a column as usual.
  The expression carries no bound parameters, because the ORDER BY in this
  representation holds none, so a ranking has to lower to an expression over
  values it can write into the SQL safely: the integer ids it already resolved,
  or a joined column. `site.owner` names the row the expression is about, and a
  `.after` cursor calls the same hook a second time with the anchor row's owner
  id — which is how a ranking can be paged without a second extension API.
- One call to `bind` is one query. An extension that has to remember something
  between its two hooks — the set of neighbours a `.near` resolved, so the
  ordering can rank by it — declares a `begin(screen)` hook. The binder calls it
  before any clause of a new query compiles, which is what lets an extension
  registered once, at startup, and used for every query afterwards, answer each
  query from that query alone.
- `screen()` returns the statement selecting the eids that the rest of the query
  admits: every other clause, with this extension's own clauses left out and the
  directives that shape an answer rather than narrow it (order, limit,
  projection) left out too. It returns `null` when there is nothing else in the
  query. An extension that ranks needs this, because a ranking cut to a limit
  before the other clauses have filtered is a ranking of the wrong set — the
  eight nearest entities of any kind, intersected with "and is a memory", is
  usually nothing. Filter, then rank, then cut. It is a function rather than a
  value because compiling it costs something an extension that does not rank
  should not have to pay.

## Ordering and paging

`.order=` sorts by a column (a leading `-` makes it descending) or by an
extension's ranking. `"entity"."num" desc` breaks ties, so the order is total.

A `.limit`/`.after` window pages within that order: a window states how much of
a sequence to return, never which sequence. With no `.order=` the sequence is
newest first by entity `num`, as it has always been.

`.after=<num>` names the entity to continue past, written the same way however
the results are ordered. It compiles to a keyset condition on the anchor
entity's own place in the order: the anchor's value is read back through a
correlated subselect and compared against each row's, with the entity `num`
breaking ties. Three fallbacks follow from that shape rather than being special
cases — an anchor that no longer matches the query still has an order value to
page from, one with no value pages by its `num` alone, and one that names no
entity at all leaves the condition true, which is the first page. `@yaks/match`
applies the same rule in memory, and its `parity_test.ts` pins the two together.

## What it compiles, and what it refuses

The common query path compiles exactly: predicates (every operator), any-of
lists, ranges, time phrases, boolean composition, paths that dereference a
reference column, reverse hops, full-text terms, the `.kind` scope, presence and
absence, ordering, `.limit`/`.after` windows, the `.count`/`.distinct`/`.tally`
aggregates, `.fields` and `*` projections, the `.refs=` backlink union, and the
`.eid=`/`.num=` identity predicate.

The `.refs=` backlink union obeys the same compound SELECT limit the death
cascade does (see below): its terms are grouped by table, cut into unions of
`ARMS` terms, and the groups combined with OR — so a vocabulary with more
reference columns than one compound SELECT can carry is still asked in one
statement.

Anything outside that path throws `Unsupported` rather than return an
almost-right answer; a caller catches it to fall back to a JavaScript matcher or
to report the gap. What is missing today is the `.edges` rider and the
edge-typed walk (`.cites->p1`), both claimed by `@yaks/edge`, and the `.near`
nearest-neighbour search unless a vector package claims it — `@yaks/embedding`
does, ordering included. `bind.ts` lists them exactly.

## Naming entities

`.eid=` and `.num=` name entities rather than filter them, so the right-hand
side is a set and compiles to one lookup on the entity table. A human-readable
id is an operand too: `@yaks/id` reads `B-7` as the entity numbered 7, where the
letter is for display and the number is the identity. One grammar therefore
fetches a named set and filters it.

```
.eid=a3f1               "entity"."eid" in (?)
.eid=a3f1,b7c2          "entity"."eid" in (?, ?)
.num=3,4                "entity"."num" in (?, ?)
.eid=B-7                "entity"."num" in (?)
```

`@yaks/match` evaluates the same predicate as a set lookup, so a client can
fetch named entities either from a database or from bundles it already holds.

## Reverse hops

A reference column is also a name on the far side. Given a `review` component
whose `book` column points at a book, `@yaks/vocab` derives the association
`.reviews`, and this package compiles it as a correlated `EXISTS` (or `count`)
over that column — one index search per candidate row, never a join that widens
the result.

```
.reviews!          the books that have a review
.reviews=          the books that have none
.reviews>=5        five or more reviews
.reviews.stars=5   a review of five stars exists
```

A filter on the child row runs through the same clause compiler, so a clause
that declines inside the subquery declines the whole hop. A child predicate
naming entity metadata declines as well, because inside the subquery that name
refers to the correlation with the outer row.

## The transitive walk

`.fork.from->S-7` follows a reference column transitively: one recursive CTE
(`walk.ts`), seeded at the target and stepped along the reference, capped at the
depth the query gives. All the binder supplies is the step — a relation of
`"from"`/`"to"` owner ids, one hop wide.

A path may be a chain of reference columns, and then the step is the composed
relation: each hop joined to the one before it, `from` being the first
component's owner and `to` the last hop's referent. `.fork.from.session->S-1` —
the sessions whose fork lineage reaches session 1 — steps

```sql
select "fork"."entity" as "from", "__w1"."session" as "to"
from "fork" join "entry" as "__w1" on "__w1"."entity" = "fork"."from"
```

so one rung of the CTE crosses the whole chain. Every hop must be a reference
column; a hop that is not one, and a path naming a relation (which belongs to
`@yaks/edge`), throws `Unsupported` rather than return an empty result.
`@yaks/match` composes the same chain in memory, and `parity_test.ts` pins the
two together.

## The death cascade

One thing here is not a query. A reference column declares in the vocabulary
what happens to it when the entity it points at is deleted, and `@yaks/graph`
decides all of it — but "who is deleted along with these, and who has to drop a
reference to them" is a transitive question, and walking it costs one read per
rung. `cascade.ts` compiles it into a statement instead:

```ts
import { doomSql, looseSql, narrow } from '@yaks/sql'

// with recursive __doom(id, depth) as (
//   select "entity"."id", 0 from "entity" where "entity"."eid" in (?)
//   union select "review"."entity", min(__doom."depth" + 1, 32)
//     from "review", __doom where "review"."product" = __doom."id" and …
// ) select eid, num, min(depth) …
doomSql(vocab, ['p1']) //  every entity deleted, with the rung it fell on
looseSql(vocab, ['p1']) // the survivors' detach/release columns into it
```

The rung count stops at 32 instead of climbing further, which is what makes a
cycle among reference columns terminate; the set of entities is complete at any
depth. Storage backends answer `Tx.doom` with these statements (`@yaks/sqlite`,
`@yaks/d1`); a backend that cannot compile them is walked by `@yaks/graph`
instead.

Both functions return a list of statements. Every backward term is a term of one
compound SELECT, and workerd — the runtime under a Durable Object and under D1 —
allows five of them (SQLite's own default is 500). So a table's death columns
are combined with OR into a single term, and the terms are cut into statements
of `ARMS` terms each. A vocabulary `narrow(vocab)` enough to fit in one
statement is answered whole, and `looseSql` restates the closure inside itself
so both can be sent in one batch. A wider vocabulary is asked in rounds: each
statement is transitive within its own tables, so the caller re-asks with
whatever the last round turned up until nothing new comes back, and then hands
`looseSql` a set that is already closed.

## Compatibility

Pure TypeScript, with no runtime dependency beyond a `@yaks/query` AST, a
`@yaks/vocab` schema, and `@yaks/id` for reading a human-readable id. Runs on
Deno and on Node (via JSR / npm).
