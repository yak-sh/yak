# @yaks/sql

SQL, and the only place SQL text is written. Statements are values built from
this package's nodes and turned into text and bound parameters by `render`. Its
largest user compiles a [@yaks/query](../query/README.md) abstract syntax tree
(AST) against a [@yaks/vocab](../vocab/README.md) component schema. It opens no
database, executes no statements, and stores no data. The supplied SQLite
dialect targets the layout maintained by [@yaks/sqlite](../sqlite/README.md).

```sh
deno add jsr:@yaks/sql jsr:@yaks/query jsr:@yaks/vocab
```

## The pipeline

```ts
import { compile } from '@yaks/sql'
import { parse } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    task: {
      component: true,
      type: 'object',
      properties: {
        status: { type: 'string' },
        priority: { type: 'number' },
      },
    },
  },
})
let ast = parse('.status=open&.priority>=1')
let { sql, params } = compile(ast, vocab)
// Execute sql with params using your database driver.
```

`bind(ast, vocab, opts)` resolves paths, coerces values to their declared types,
collects joins, and builds a `Select`. `render(select)` returns the statement as
a `Raw`, `{ sql, params }`; `compile` calls both. Values belong in `params` in
their returned order.

## Terms used here

- **Entity table:** every entity has a row containing its integer primary key
  `id`, public string `eid`, optional human-readable number `num`, and
  `archetype` pointer.
- **Component table:** a table named for a component, with an integer `entity`
  owner column and the component's declared columns. A LEFT JOIN returns NULL
  for an absent component's columns. Presence checks distinguish a missing row
  from a row whose values are all NULL.
- **Reference column:** stores another entity's integer `id`. Comparing it to a
  public `eid` resolves that string through the entity table.
- **Presence test:** asks whether a component exists, such as `.task`, `.doc`,
  or `!claim`, without comparing a stored value.

Deleted entities retain their identity rows and appear in `tombstone`. Compiled
queries exclude these entities.

## Exports

The package has one import path, `@yaks/sql`. It exports:

- `compile`, `bind`, `BindOpts`, `Compiled`, and `Unsupported` for compilation;
- the statement nodes (`Select`, `Insert`, `CreateTable`, `Stmt`, `Expr`, …),
  their builders (`select`, `col`, `val`, `eq`, `and`, `among`, `when`, …), and
  `render`;
- `Tag`/`tagOf` for the supplied SQL layout;
- `Derived`/`DerivedProp` and `Extension`/`Site` for application expressions;
- `rule` and `Plan`/`On`/`At`/`Gone` for a rule's match as one statement;
- `archetypeSet` and its types for component-presence optimization;
- `doomSql`, `looseSql`, `narrow`, `DEEP`, and compound-query helpers including
  `ARMS` and `STOCK` for deletion planning;
- reference-walk and identity helpers, re-exported from `walk.ts` and
  `ident.ts`.

See [mod.ts](./mod.ts) for the complete re-export list.

## The AST

[ast.ts](./ast.ts) holds the nodes: expressions (columns, bound values,
literals, functions, operators, `in`, `exists`, `case`, subqueries, a trigger's
`raise`), queries (`select` with CTEs and joins, compounds such as `union all`,
`values`), writes with upserts and `returning`, and DDL (tables, indexes, views,
virtual tables, triggers, `alter`, `drop`, pragmas, transactions). Every node is
plain data.

[render.ts](./render.ts) writes one as SQLite text with `?` placeholders.
Identifiers are always quoted; function, type and pragma names are checked
against their grammar; operators come from a fixed list. A value is a bound
parameter, except where SQLite binds nothing (a trigger, a view, a default, a
check, an index's `where`), where it is written as a literal. AND and OR nest in
halves, so a long list never exceeds SQLite's depth limit.

`Raw` is the one node that carries text. Only this package makes one, and
`render` returns one, so a caller holds finished statements but cannot write
text of its own. The query binder still assembles its storage layout from text
behind the SQLite dialect ([sqlite.ts](./sqlite.ts)), which is internal.

## Matching on the archetype column

An archetype describes an entity's set of components. With `opts.archetypes`, a
presence test can compile to `entity.archetype in (…)` instead of a component
join. `archetypeSet(cache, ids)` constructs this resolver from an
`@yaks/archetype` cache and a map from descriptor eids to database integer ids.

This optimization handles AND/OR/NOT, presence through a reference or reverse
association, and `.kind=`. Kind matching requires the named kind and excludes
kinds preceding it in the vocabulary's ordering. Value comparisons still read
the relevant columns.

The resolver must describe a current, complete catalog for the query. Returning
`undefined` requests the ordinary join; returning `[]` means nothing matches.
Without a resolver or a dialect's `archetype` expression, compilation uses
joins. `@yaks/sqlite` loads the catalog lazily when its vocabulary includes
archetypes.

## Computed properties

A property declared `computed: true` has no stored value. Supply its SQL
expression in a `Derived` map keyed by `component.property`. A derived entry can
also override how a stored property is read. SQL can then filter the expression
without first loading every entity into JavaScript; index use depends on the
expression and database query plan.

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
// With order.total declared in your vocabulary:
// compile(ast, vocab, { derived })
```

`tag` controls comparison coercion; `values` supplies enum members; `deps` names
extra component joins. `text(stored)` optionally reads an old/new stored value
without looking up its owner, for example in full-text index triggers.

A qualified derived property returns NULL when its entity lacks that component
unless `worn: false` is set. Use that option for expressions intended to work
without the component, such as an update time that falls back to creation time.

## Extensions

An `Extension` supplies compilation for clauses owned by another package, such
as text search, vector search, or edges:

```ts
import { among, col, eq, type Extension, select, table, val } from '@yaks/sql'

let labels: Extension = {
  name: 'labels',
  compile: {
    text: (clause, site) =>
      clause.kind == 'text'
        ? among(
          site.owner,
          select({
            cols: [col('entity')],
            from: table('label'),
            where: eq(col('value'), val(clause.value)),
          }),
        )
        : null,
  },
}
// After creating a label table, pass { extend: [labels] } to compile().
```

Each clause compiler receives a `Site` containing the vocabulary, the current
time, and `owner`, the expression for the current entity's integer id.
`site.join(comp)` adds a LEFT JOIN and returns its owner column, and
`site.from(comp, as)` names a component's table as a source for a subquery. The
compiler returns an `Expr`, or `null` to decline. Extensions run in registration
order before built-in compilation; the first non-null answer wins. Claiming an
otherwise unsupported directive such as `near`, `edges`, or `reaches` makes it a
filter.

An optional `order(value, site)` handles ordering by values that do not name a
property. It receives the value without its leading `-` and returns an `Expr` or
`null`. An order expression is written with its values as literals. Pagination
calls this hook again for the cursor entity.

`begin(screen)` runs once at the start of each `bind` call, allowing a reused
extension to reset state shared by its clause and ordering hooks. Calling
`screen()` lazily compiles the other filters into a `Raw` statement selecting
eids, excluding this extension's clauses and ordering, limits, and projections.
It returns `null` when no other filters exist. Ranking extensions use this
candidate set before selecting the nearest or highest-ranked results; ranking
all entities first and filtering afterward would return the wrong subset.

## Ordering and paging

`.order=price` sorts ascending; `.order=-price` sorts descending. An extension
may supply the order expression. Explicit ordering uses entity `num` descending
as the tie-breaker. Without `.order=`, a `.limit` or `.after` window returns
newest numbers first; a complete result returns oldest numbers first.

`.after=<num>` identifies the entity to continue after. With explicit ordering,
the compiler reads its order value in a correlated subquery and compares that
value, then its number for equal values. NULL values sort first ascending and
last descending; the number breaks ties between NULL values too. An anchor that
no longer matches the filters can still define a position. With explicit
ordering, a nonexistent anchor starts at the first page; without it, `.after`
uses the numeric condition `entity.num < ?` directly. Number-based cursors
require entities with assigned numbers. Unnumbered entities do not gain a unique
tie-breaker from this expression. `@yaks/match` implements the corresponding
in-memory sorting and cursor comparison.

## What it compiles, and what it refuses

Supported constructs include property predicates, any-of lists, ranges, time
phrases, booleans, reference paths, reverse associations, `.kind`,
presence/absence, ordering, `.limit`/`.after`, `.count`/`.distinct`/`.tally`,
`.fields`, `*` projections, `.refs=`, and `.eid=`/`.num=`. Individual
combinations can still be unsupported; the binder throws `Unsupported` rather
than silently ignoring them. Callers may report the error or use another
evaluator.

Text terms require a search extension, such as `@yaks/fts`, or a custom text
compiler. `.edges` and edge-typed walks require `@yaks/edge`; `.near` requires a
vector extension such as `@yaks/embedding`, which also supplies ordering. See
[bind.ts](./bind.ts) for the precise restrictions.

The `.refs=` backlink query groups reference columns by table and splits
compound SELECTs into groups of `ARMS` terms, combining those groups with OR to
stay within the engine's compound-query limit.

## Naming entities

`.eid=` and `.num=` accept sets. `@yaks/id` also parses display ids such as
`B-7`: the letter is a label, and 7 is the entity number. A set binds as one
JSON parameter however long it is, since a host caps how many parameters one
statement binds (a Durable Object's SQLite takes 100).

```text
.eid=a3f1,b7c2  "entity"."eid" in (select value from json_each(?))  ["a3f1","b7c2"]
.num=3,4       "entity"."num" in (select value from json_each(?))  [3,4]
.eid=B-7       "entity"."num" in (select value from json_each(?))  [7]
```

`@yaks/match` applies the same identity predicates to a bundle: one entity's
components represented as a JSON object.

## Reverse hops

Given a `review.book` reference to a book, the vocabulary derives `.reviews` as
a reverse association. Compilation uses correlated `EXISTS` or `count`
subqueries, avoiding duplicate outer rows:

```text
.reviews         books with a review
!reviews         books without reviews
.reviews>=5       books with at least five reviews
.reviews.stars=5  books with a five-star review
```

Child filters use the same clause compiler. Unsupported child clauses reject the
whole association. Nested reverse associations and child predicates referring to
entity metadata are among the unsupported cases.

## The transitive walk

`.fork.from->S-7` follows references recursively using a common table expression
(CTE), up to the query's depth limit. The compiler supplies a one-step relation
with `from` and `to` integer owner ids.

A chained path such as `.fork.from.session->S-1` composes its reference joins
into that step:

```sql
select "fork"."entity" as "from", "__w1"."session" as "to"
from "fork" join "entry" as "__w1" on "__w1"."entity" = "fork"."from"
```

Each recursive step traverses the entire chain. Every hop must be a reference; a
scalar hop or an edge relation without its extension throws `Unsupported`.
`@yaks/match` evaluates the same reference chains in memory.

## The death cascade

Deletion planning is separate from query filtering. Reference properties declare
whether deleting their target also deletes the owner, removes its component, or
clears the reference. The graph decides which changes to apply; these helpers
compile the database lookups:

```ts
import { doomSql, looseSql } from '@yaks/sql'

// With your loaded vocabulary:
// doomSql(vocab, ['p1'])  // statements selecting entities to delete and depths
// looseSql(vocab, ['p1']) // statements selecting references to detach/release
```

Both return lists of statements. Cascade depth labels saturate at `DEEP` (32),
which terminates cycles without limiting the set of reachable entities.
`@yaks/sqlite` and `@yaks/d1` use these helpers for `Tx.doom`; other stores may
let `@yaks/graph` perform the traversal.

The compound-query helpers use `ARMS = 4`, leaving room for the seed term under
workerd's five-term limit. `STOCK = 400` is the larger allowance for an embedded
SQLite driver. Reference columns from one table share a term. If `narrow(vocab)`
is true, the closure fits in one statement and `looseSql` repeats it so both
lookups can run together. For wider schemas, callers execute the returned
statements in rounds until no new entities are found, then collect the affected
surviving references. The writes form a batch: a list of changes applied in one
transaction.

## Compatibility

Pure TypeScript, using `@yaks/query`, `@yaks/vocab`, and `@yaks/id`. The package
can run on Deno or Node via JSR/npm; execution still requires a compatible SQL
storage adapter.
