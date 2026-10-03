# @yaks/sql

Build SQL as data and compile [query ASTs](../query/README.md#query-model)
against a [vocabulary](../vocab/README.md#vocabulary). Render the result as
SQLite text with bound parameters, or pass it to a driver. The package opens no
database; [@yaks/sqlite](../sqlite/README.md) supplies the storage adapter.

A **node** is a plain object with a `t` tag describing SQL, such as
`{ t: 'col', name: 'title' }`. An **expression** (`Expr`) is a node used as a
column value, condition or argument. A **statement** (`Stmt`) is a node an
engine can execute: a select, write or schema operation. A **parameter**
(`Param`) is a value bound to a statement's `?` placeholder.

**Raw** is SQL text with its parameters in order, made by this package:
`{ t: 'raw', sql: 'select ?', params: ['Dune'], … }`. `Compiled` is a type alias
for `Raw`. Callers build nodes; only this package constructs `Raw`, which can
also be embedded in another node.

## Compile a query

```sh
deno add jsr:@yaks/sql jsr:@yaks/query jsr:@yaks/vocab
```

```ts
import { bind, compile, render } from '@yaks/sql'
import { parse } from '@yaks/query'
import { equal } from '@yaks/testing'
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
let ast = parse('.task.status=open .task.priority>=1')
let compiled = compile(ast, vocab)
equal(compiled.params, ['open', 1])
equal(render(bind(ast, vocab)).sql, compiled.sql)
```

`bind` resolves [paths](../query/README.md#query-model), coerces values to their
declared types, collects joins and returns a `Select`. `render` returns `Raw`;
`compile` calls both. Send `sql` and `params` together to the engine.
`BindOpts.now` fixes the moment relative time literals resolve against.

## Exports

All exports use the single import path `@yaks/sql`.

| Part                  | Exports                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Query compilation     | `compile`, `bind`, `BindOpts`, `Compiled`, `screen`, `tallied`, `Unsupported`, `whole`                                      |
| SQL nodes             | `Expr`, `Query`, `Stmt`, `Select`, `Insert`, `Update`, `Delete`, schema-operation types, `Raw`, `Param`, and their builders |
| Rendering             | `render`, `shape`, `isRaw`                                                                                                  |
| Drivers               | `Driver`, `Row`, `effect`, `scan`, `tally`                                                                                  |
| Property reads        | `Tag`, `tagOf`, `held`, `field`, `Derived`, `DerivedProp`, `ladders`, `derivedOf`, `worn`                                   |
| Computed components   | `Backing`, `Backings`, `eidOf`, `idOf`, `eidAt`                                                                             |
| Clause compilation    | `Extension`, `Compile`, `Site`, `OrderBy`, `Begin`, `Screen`                                                                |
| Presence optimization | `ArchetypeSet`, `Matching`, `archetypeSet`                                                                                  |
| Rule compilation      | `rule`, `Plan`, `On`, `At`, `Gone`                                                                                          |
| Reference lookups     | `identity`, `Identity`, `walk`                                                                                              |
| Deletion lookups      | `doomSql`, `looseSql`, `narrow`, `DEEP`                                                                                     |
| Compound statements   | `Arm`, `arms`, `cut`, `ARMS`, `STOCK`                                                                                       |

[mod.ts](./mod.ts) lists every node type and builder.

## Build and render nodes

Builders such as `col`, `val`, `eq` and `select` make nodes. Queries support
joins, common table expressions, grouping, windows, compounds and subqueries.
Writes support upserts and `returning`. Schema operations include tables,
indexes, views, virtual tables, triggers, alterations, drops and pragmas;
transaction operations and `explain query plan` are statements too.

```ts
import {
  among,
  col,
  each,
  eq,
  insert,
  render,
  select,
  shape,
  table,
  val,
} from '@yaks/sql'
import { equal } from '@yaks/testing'

let read = render(select({
  cols: [col('title')],
  from: table('book'),
  where: eq(col('author'), val("O'Brien")),
}))
equal(read.sql, 'select "title" from "book" where "author" = ?')
equal(read.params, ["O'Brien"])
equal(render(insert('book', { title: 'Dune' })).params, ['Dune'])

// A set of any length uses one parameter.
equal(render(among(col('id'), each([1, 2, 3]))).params, ['[1,2,3]'])

let schema = render({
  t: 'create table',
  name: 'book',
  cols: [{ name: 'title', type: 'text', default: val("O'Brien") }],
})
equal(schema.sql, `create table "book" ("title" text default 'O''Brien')`)
equal(schema.params, [])
equal(shape(schema), 'create table "book" ("title" text default ?)')
```

Compose queries from nodes without writing SQL text:

```ts
import {
  as,
  col,
  eq,
  fn,
  join,
  lit,
  over,
  render,
  select,
  sub,
  table,
  unionAll,
  val,
} from '@yaks/sql'
import { equal } from '@yaks/testing'

let titles = select({ cols: [col('title')], from: table('book') })
let query = select({
  with: [{
    name: 'titles',
    q: unionAll(titles, select({ cols: [val('Untitled')] })),
  }],
  cols: [
    col('title', 'titles'),
    as(over(fn('row_number'), undefined, [col('title', 'titles')]), 'position'),
  ],
  from: table('titles'),
  joins: [
    join(table('book'), eq(col('title', 'book'), col('title', 'titles'))),
  ],
  where: eq(col('title', 'titles'), sub(select({ cols: [val('Dune')] }))),
})
equal(render(query).params, ['Untitled', 'Dune'])
equal(render(query).sql.includes('row_number() over'), true)
equal(
  render(select({ cols: [lit(1)], from: { t: 'from', q: titles } })).params,
  [],
)
```

Writes are nodes too; upserts bind their update values after their inserted
values:

```ts
import { col, eq, insert, render, val } from '@yaks/sql'
import { equal } from '@yaks/testing'

let write = {
  ...insert('book', { title: 'Dune' }),
  upsert: [{ on: [col('title')], set: { title: val('Dune Messiah') } }],
  returning: [col('title')],
}
equal(render(write).params, ['Dune', 'Dune Messiah'])
equal(
  render({
    t: 'update',
    table: 'book',
    set: { title: val('Dune') },
    where: eq(col('id'), val(7)),
  }).params,
  ['Dune', 7],
)
equal(
  render({ t: 'delete', from: 'book', where: eq(col('id'), val(7)) }).params,
  [7],
)
```

Schema nodes inline values that SQLite stores for later execution. Transaction
nodes name the engine's transaction operations:

```ts
import { col, insert, render, select, type Stmt, table, val } from '@yaks/sql'
import { equal } from '@yaks/testing'

let statements: Stmt[] = [
  { t: 'create index', name: 'by_title', on: 'book', cols: [col('title')] },
  { t: 'create view', name: 'titles', q: select({ cols: [val('Dune')] }) },
  { t: 'create virtual table', name: 'search', using: 'fts5', args: ['title'] },
  {
    t: 'create trigger',
    name: 'added',
    timing: 'after',
    event: 'insert',
    on: 'book',
    body: [insert('log', { message: 'added' })],
  },
  { t: 'alter table', table: 'book', add: { name: 'author', type: 'text' } },
  { t: 'drop', kind: 'view', name: 'titles', ifExists: true },
  { t: 'pragma', name: 'journal_mode', value: 'wal' },
  { t: 'explain query plan', of: select({ from: table('book') }) },
]
equal(
  statements.map((statement) => render(statement).params),
  statements.map(() => []),
)
equal(render(statements[1]).sql, `create view "titles" as select 'Dune'`)
equal(render(statements[3]).sql.includes("values ('added')"), true)
equal(render({ t: 'begin', mode: 'immediate' }).sql, 'begin immediate')
equal(render({ t: 'savepoint', name: 'write' }).sql, 'savepoint "write"')
equal(render({ t: 'rollback', to: 'write' }).sql, 'rollback to "write"')
equal(render({ t: 'release', name: 'write' }).sql, 'release "write"')
equal(render({ t: 'commit' }).sql, 'commit')
```

Identifiers are quoted. Function, type, pragma and module names are checked;
operators come from a fixed list. `val` binds a parameter except where SQLite
stores SQL to execute later (triggers, views, defaults, checks and partial index
conditions); there it renders a quoted literal. `lit` always renders a literal.
AND and OR nest in halves when large to avoid SQLite's expression depth limit.
`shape` masks literals as well as leaving parameter placeholders visible, while
keeping identifiers for diagnosis. Treat built nodes as immutable: rendering
caches parameter-free parts.

## Driver

A **driver** (`Driver`) is the synchronous boundary that executes statements.
Its `query` returns **rows** (`Row`), objects keyed by column name. An optional
`run` returns the number of rows changed, excluding triggers. `effect` uses
`run` when available and otherwise `query`; `scan` selects rows and `tally`
counts them.

This example supplies a driver that records the rendered statement. A storage
adapter supplies the engine connection.

```ts
import { type Driver, effect, insert, render, scan, tally } from '@yaks/sql'
import { equal } from '@yaks/testing'

let sent: string[] = []
let driver: Driver = {
  query: (statement) => {
    sent.push(render(statement).sql)
    return statement.t == 'select' && statement.cols?.[0]?.t == 'as'
      ? [{ n: 2 }]
      : [{ title: 'Dune' }]
  },
}
effect(driver, insert('book', { title: 'Dune' }))
equal(scan(driver, 'book', undefined, ['title']), [{ title: 'Dune' }])
equal(tally(driver, 'book'), 2)
equal(sent[0], 'insert into "book" ("title") values (?)')
```

Optional driver capabilities include `tx` for synchronous transactions,
`extension` for native SQL extensions, `template` for reusable empty schemas,
`file` for a database file needing a write lock before reads, and `arms` for the
engine's compound-select allowance. Async engines wrap execution at their own
boundary.

## SQLite layout and value types

The compiler targets the layout maintained by
[@yaks/sqlite](../sqlite/README.md): the `entity` table holds integer `id`,
string [eid](../graph/README.md#data-model), optional `num` and `archetype`.
Each stored [component](../graph/README.md#data-model) has a table with an
integer `entity` owner column. [References](../vocab/README.md#vocabulary) store
the target's integer id; reads project it to an eid. Deleted entities keep their
identity row and are listed in `tombstone`; compiled queries exclude them. A
presence predicate tests for a component row, including one whose properties are
all NULL.

A **Tag** is the type used to coerce comparisons: a vocabulary
[scalar](../vocab/README.md#the-format), `enum` or `eid`. `tagOf` derives it
from a loaded property. `held` converts boolean operands to their stored form.
`field` maps a property named `entity` to `$entity`, reserving the table's
`entity` column for its owner.

```ts
import { field, held, tagOf, tallied } from '@yaks/sql'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    task: {
      component: true,
      properties: { done: { type: 'boolean' } },
    },
  },
})
equal(tagOf(vocab.prop('task', 'done')!), 'bool')
equal(held('true', 'bool'), '1')
equal(field('entity'), '$entity')
equal(
  ['number', 'text', 'bool'].map((tag) =>
    tallied(tag as 'number' | 'text' | 'bool')
  ),
  ['number', 'text', null],
)
```

## Derived properties

A **derived property** (`DerivedProp`) supplies an expression for reading a
property, keyed by `component.property` in a **Derived** map. It reads a
computed property or overrides a stored property's read. `expr(owner)` receives
the expression naming the entity's integer id. `tag` controls comparisons;
`values` supplies enum members and `deps` adds component joins.

```ts
import { compile, type Derived, lit, worn } from '@yaks/sql'
import { parse } from '@yaks/query'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    task: {
      component: true,
      properties: { rank: { type: 'number', computed: true } },
    },
  },
})
let derived: Derived = { 'task.rank': { tag: 'number', expr: () => lit(10) } }
equal(compile(parse('.task.rank>=5'), vocab, { derived }).params, [5])
equal(worn(vocab, derived)('task', 'rank'), true)
equal(worn(vocab)('task', 'rank'), false)
```

A derived property reads NULL without its component unless `worn: false` lets it
answer without the component. `text(stored)` optionally reads a replaced value
directly, for example when maintaining full-text indexes from old and new
trigger values.

A vocabulary [ladder](../vocab/README.md#kinds-and-status) needs no caller
entry: `ladders` builds its status expression. `derivedOf` combines those
expressions with the caller's map, whose entries win.

```ts
import { derivedOf, ladders, lit } from '@yaks/sql'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    job: { component: true, status: { failed: 'failed', default: 'pending' } },
    failed: { component: true },
  },
})
equal(ladders(vocab)['job.status'].values, ['failed', 'pending'])
let override = { tag: 'enum' as const, expr: () => lit('pending') }
equal(derivedOf(vocab, { 'job.status': override })['job.status'], override)
```

## Computed components

A **backing** (`Backing`) supplies the rows of a component declared
`computed: true`, as a select with one row per entity, an integer `entity`
column and a column per property. `Backings` is keyed by component name. These
entities have no row in the entity table. The **spine** is the source a query
selects its entities from: the entity table, or the backing's rows when the
query requires that computed component.

```ts
import {
  as,
  type Backings,
  col,
  compile,
  eidOf,
  idOf,
  select,
  table,
} from '@yaks/sql'
import { parse } from '@yaks/query'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    event: {
      component: true,
      computed: true,
      properties: { value: { type: 'number' } },
    },
  },
})
let tag = '3f1c9e0d7b5a4c2e8f6d1b3a5c7e9f0a'
let backed: Backings = {
  event: {
    rows: select({
      cols: [as(col('id'), 'entity'), col('value')],
      from: table('events'),
    }),
    tag,
  },
}
equal(compile(parse('.event.value>=2'), vocab, { backed }).params, [2])
equal(eidOf(tag, 42), '0000002a' + tag)
equal(idOf(tag, eidOf(tag, 42)), 42)
equal(idOf(tag, 'unrelated'), null)
```

The store supplies `tag`, a 32-character hex suffix identifying the store and
component. `eidOf` prefixes the integer id in at least eight hex digits; `idOf`
reads it back and `eidAt` builds that read as an expression. Reference paths
into backings follow their integer ids. A backed spine has no numbers,
archetypes or tombstones; its entities carry only its computed component. Other
components' predicates are answered without joining across the two id spaces.
Missing backings or tags are refused.

## Clause compilation

An **Extension** is a named contribution that compiles another package's
[clauses](../query/README.md#query-model). A **Site** gives it the vocabulary,
current time, `owner` expression, `join(comp)` to add a LEFT JOIN, and
`from(comp, as)` to read the component's source under an alias. A clause
compiler returns an expression or `null` to decline. Extensions run before
built-in compilation, in registration order; the first answer wins.

```ts
import {
  among,
  col,
  compile,
  eq,
  type Extension,
  select,
  table,
  val,
} from '@yaks/sql'
import { parse } from '@yaks/query'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

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
equal(compile(parse('poetry'), loadVocab({}), { extend: [labels] }).params, [
  'poetry',
])
```

`order(value, site)` optionally handles `.order=` values that name no property.
It receives the value without a leading `-`. Its expression renders with
literals, and the hook runs again for an `.after` anchor's owner.

A **screen** (`Screen`) is a lazy statement selecting the integer `id` of each
entity admitted by the other filters, without ordering, limits or projections.
`begin(screen)` runs once per bind and lets a reused Extension reset its state.
The screen excludes that Extension's clauses and returns `null` when there are
no remaining filters. Ranking among these ids before limiting preserves the
other filters. The exported `screen` builds this statement for a whole query.

```ts
import { compile, type Extension, lit, screen } from '@yaks/sql'
import { parse } from '@yaks/query'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      properties: { title: { type: 'string' } },
    },
  },
})
let candidates: unknown[] = []
let ranking: Extension = {
  name: 'ranking',
  begin: (screen) => {
    candidates.push(screen()?.params ?? null)
  },
  compile: { text: () => lit(true) },
  order: (value, site) => value == 'rank' ? site.owner : null,
}
compile(parse('poetry .doc.title=Dune .order=rank .limit=2'), vocab, {
  extend: [ranking],
})
equal(candidates, [['Dune']])
equal(screen(parse('.doc.title=Dune .limit=2'), vocab)?.params, ['Dune'])
equal(screen(parse('.limit=2'), vocab), null)
```

## Presence optimization

An **ArchetypeSet** resolves a vocabulary
[presence](../vocab/README.md#routing-and-references) test to the integer ids of
matching [archetypes](../archetype/README.md). `archetypeSet` combines a cache's
`matching` with the caller's current eid-to-integer-id map.

```ts
import { Archetypes } from '@yaks/archetype'
import { archetypeSet, compile } from '@yaks/sql'
import { parse } from '@yaks/query'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

let cache = new Archetypes()
let descriptor = cache.intern(['task'])
let archetypes = archetypeSet(cache, new Map([[descriptor.eid, 7]]))
let vocab = loadVocab({ $defs: { task: { component: true } } })
equal(compile(parse('.task'), vocab, { archetypes }).params, ['[7]'])
```

The resolver must describe a complete, current catalog. `undefined` declines;
`[]` means nothing matches. Presence can then read `entity.archetype` instead of
a component table, including boolean combinations, reference paths, reverse
associations and `.kind`. Value comparisons still read their columns. Without a
resolver, presence reads the component's owner ids.

## Ordering, paging and aggregates

[Directives](../query/README.md#directives) control projections, aggregates and
windows. `.order=book.price` is ascending and a leading `-` makes it descending.
Paths can follow references. Explicit ordering uses descending entity number and
then integer id to break ties. Without explicit ordering, a `.limit` or `.after`
window reads newest first; a complete result reads oldest first. Unnumbered
entities use integer id alone.

```ts
import { compile } from '@yaks/sql'
import { parse } from '@yaks/query'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      properties: { price: { type: 'number' } },
    },
  },
})
equal(compile(parse('.book .order=book.price .limit=2'), vocab).params, [2])
equal(
  compile(parse('.book .after=b1 .fields=book.price .limit=2'), vocab).params,
  [2],
)
equal(compile(parse('.book .count'), vocab).sql.includes('count(*) as n'), true)
equal(
  compile(parse('.book .tally=book.price'), vocab).sql.includes('group by'),
  true,
)
equal(
  compile(parse('.book .distinct=book.price'), vocab).sql.includes('as value'),
  true,
)
```

`.after` reads the anchor's order value even if it no longer matches the
filters. NULL sorts first ascending and last descending; ties include NULL
values. With explicit ordering, a missing anchor starts at the first page.
Numeric cursors require a vocabulary declaring `entity.num`; an eid cursor also
works without numbering.

`.count` returns `value: ''` and `n`. `.distinct` returns `value`, and `.tally`
returns `value` and `n` per group. `tallied` permits numbers as numbers and
text, enum or eid as text; other types are refused. Reference aggregates group
by the stored integer and read each group's eid once. Absent values and empty
text are dropped.

## Identity, references and walks

An **Identity** is an operand list split into `eids` and entity `nums`.
`identity` uses [@yaks/id](../id/README.md) to read display ids such as `B-7` as
entity number 7. Identity lists and scalar equality lists use one JSON parameter
per set, regardless of length.

```ts
import { compile, identity } from '@yaks/sql'
import { parse } from '@yaks/query'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    entity: {
      component: true,
      properties: { num: { type: 'number' } },
    },
  },
})
equal(identity('eid', 'b1,B-7'), { eids: ['b1'], nums: [7] })
equal(compile(parse('.entity.eid=b1,b2'), vocab).params, ['["b1","b2"]'])
equal(compile(parse('.entity.num=3,4'), vocab).params, ['[3,4]'])
```

[Reverse associations](../vocab/README.md#routing-and-references) compile to
correlated EXISTS or count subqueries, which preserve one outer row per entity.
`.refs=<eid>` finds backlinks across reference properties, grouping columns by
table and cutting compound selects to fit the engine limit.
[Walks](../query/README.md#walks-and-qualifiers) compile reference chains to a
recursive common table expression. The exported `walk` accepts a one-step query
projecting `from` and `to` integer ids; edge packages supply their own step.

```ts
import { compile } from '@yaks/sql'
import { parse } from '@yaks/query'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    book: { component: true },
    review: {
      component: true,
      properties: {
        book: { type: 'string', ref: 'book' },
        stars: { type: 'number' },
      },
    },
    fork: {
      component: true,
      properties: { from: { type: 'string', ref: 'entity' } },
    },
  },
})
equal(compile(parse('.reviews>=5'), vocab).params, [5])
equal(compile(parse('.reviews.review.stars=5'), vocab).params, [5])
equal(compile(parse('.review.book.book'), vocab).sql.includes('"__pl"'), true)
equal(compile(parse('.refs=b1'), vocab).params, ['b1', 'b1'])
equal(compile(parse('.fork.from[<=3]->b1'), vocab).params, ['b1', 3])
```

A walk with no explicit depth bound deduplicates on integer id to terminate
cycles and limits results to the query package's `WALK_LIMIT`. An explicit depth
bound includes depth in the recursion. Every step of a chained path traverses
the whole chain; every hop must be a reference.

## Rule compilation

A **Plan** is the shape `rule` accepts for a
[multi-entity match](../query/README.md#multi-entity-matches): patterns with
filters, gates, variable bindings and whether they only make entities. It is
structurally compatible with [@yaks/graph](../graph/README.md)'s `Match`. `rule`
produces one select with `e0`, `e1`, … for matched eids and `v_<name>` for
variables. Shared variables equate stored integer ids or scalar values; mixing
those two forms is refused.

```ts
import { render, rule } from '@yaks/sql'
import { parse } from '@yaks/query'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    task: {
      component: true,
      properties: { priority: { type: 'number' } },
    },
  },
})
let statement = rule(
  {
    patterns: [{
      entity: 'task',
      filter: parse('.task.priority=1'),
      gates: [],
      binds: [],
      makes: false,
    }],
  },
  vocab,
  {},
  { touched: [7] },
)
equal(render(statement).params, [1, '[7]'])
equal(statement.distinct, true)
```

`On.at` maps component names to tables or overlay sources; `On.gone` names the
removed-owner source for `-comp`. `On.touched` requires at least one pattern to
match an integer id the batch touched. Omit it to read the whole committed
graph. Collections are evaluated by the storage adapter. Multi-hop variable
bindings are not routed through their full path yet.

## Deletion lookups and compound statements

`doomSql` selects entities deleted by reference
[death declarations](../vocab/README.md#routing-and-references), including the
seed, with `eid`, `num` and `depth`. `looseSql` selects surviving references
with `comp`, `prop`, `eid` and `ord` for the graph to detach or release. These
functions return lists of statements; the graph decides the writes.

An **Arm** groups one component table and its reference property names as
`[comp, props]`. `arms` groups them and `cut` splits them into groups.

```ts
import { arms, cut, doomSql, looseSql, narrow } from '@yaks/sql'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

let vocab = loadVocab({
  $defs: {
    note: {
      component: true,
      properties: {
        about: { type: 'string', ref: 'entity', death: 'cascade' },
        related: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
  },
})
equal(narrow(vocab), true)
equal(doomSql(vocab, ['p1'])[0].params, ['["p1"]'])
equal(looseSql(vocab, ['p1'])[0].params, ['["p1"]', 'note', 'related'])
equal(arms([['note', 'about'], ['note', 'related']]), [['note', [
  'about',
  'related',
]]])
equal(cut([1, 2, 3], 2), [[1, 2], [3]])
```

`ARMS` is 4, leaving one term for a recursive seed under workerd's five-term
compound-select limit. `STOCK` is 400 for embedded engines with a larger
allowance. Cascade depth saturates at `DEEP` (32) to terminate cycles; the
reachable set is not depth-limited.

If `narrow(vocab)` is true, each closure fits in one statement and `looseSql`
repeats it so both lookups can run together. For wider vocabularies, execute
`doomSql` in rounds seeded with all eids found until no new ones appear, then
pass that closed set to `looseSql`.

## Limits

`Unsupported` names a feature this compiler cannot answer exactly, with the
refusing package in `by`. Unknown names use the vocabulary's `Unknown` error.

```ts
import { compile, Unsupported } from '@yaks/sql'
import { parse } from '@yaks/query'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

try {
  compile(parse('poetry'), loadVocab({}))
  throw new Error('expected a refusal')
} catch (error) {
  equal(error instanceof Unsupported, true)
}
```

Text terms need [@yaks/fts](../fts/README.md) or another Extension; `.near`
needs [@yaks/embedding](../embedding/README.md); `.edges` and edge-typed walks
need [@yaks/edge](../edge/README.md). Nested reverse associations and reverse
child predicates reading entity metadata are unsupported. JSON-valued properties
permit presence tests but not comparisons, ordering or projection. Some scalar
comparisons also decline when SQLite cannot match their semantics, such as
non-ASCII containment. [bind.ts](./bind.ts) states the restrictions.

The package is pure TypeScript and uses `@yaks/query`, `@yaks/vocab` and
`@yaks/id`. Execution requires a compatible driver and the expected layout;
[@yaks/match](../match/README.md) evaluates queries over bundles in memory.
