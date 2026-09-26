# @yaks/query

A parser and a set of builders for the yaks query format, with no knowledge of
any schema. `parse()` turns a query string into a serializable abstract syntax
tree (AST); the builders construct the same tree from code. The parser checks
syntax only — not whether a property exists, and not whether a given backend can
answer the query. Use [@yaks/sql](../sql/README.md) to compile the tree to SQL,
or [@yaks/match](../match/README.md) to evaluate it over bundles in memory. A
bundle is one entity's components represented as a JSON object. This package
stores no entities and opens no database; its output is plain JSON data.

## Install

```sh
deno add jsr:@yaks/query
# or: npx jsr add @yaks/query
```

## Parse

```ts
import { parse } from '@yaks/query'

parse('.status=open .priority<=1 .team=frontend,backend')
// {
//   kind: 'and',
//   clauses: [
//     { kind: 'pred', path: ['status'],   op: '=',  value: { kind: 'scalar', raw: 'open' } },
//     { kind: 'pred', path: ['priority'], op: '<=', value: { kind: 'scalar', raw: '1' } },
//     { kind: 'pred', path: ['team'],     op: '=',
//       value: { kind: 'list', items: [ {kind:'scalar',raw:'frontend'}, {kind:'scalar',raw:'backend'} ] } },
//   ],
// }
```

A bare word is a full-text term over the document, and whitespace separates
terms, so one line from a search box can mix the two. A trailing `*` on a word
(`lemo*`) is a prefix term; a lone `*` as a whole token is the projection
directive below, not a term.

```ts
import { parse } from '@yaks/query'

parse('crash on save .updated.at=today')
// and( text('crash'), text('on'), text('save'), pred('updated.at', '=', scalar('today')) )
```

## Build

The builders produce the same shape, so `parse(x)` deep-equals the equivalent
builder calls:

```ts
import { and, eq, le, list, parse } from '@yaks/query'

let a = parse('.status=open .priority<=1 .team=frontend,backend')
let b = and(
  eq('status', 'open'),
  le('priority', 1),
  eq('team', list('frontend', 'backend')),
)
// a deep-equals b
```

The exported builders are:

| group         | exports                                                                             |
| ------------- | ----------------------------------------------------------------------------------- |
| predicates    | `eq ne contains lt le gt ge present absent want pred`                               |
| rule prefixes | `ensure gate mutable gone resource variable`                                        |
| values        | `scalar list range time text never`                                                 |
| composition   | `and or`                                                                            |
| traversal     | `walk`                                                                              |
| directives    | `order near refs hasRefs count distinct tally fields field every limit after edges` |
| accessors     | `clauses orderOf nearOf windowOf declared bare`                                     |

## The query format

### A token's shape decides what it is

A token's syntax determines whether it is a component clause or a full-text
term. Prefix characters and operators identify clauses; quoted strings and bare
words identify text terms. A malformed clause throws a syntax error instead of
being treated as search text.

A clause is `path [qualifiers]? operator value`. The bracket binds to the
**path** and is read before any operator, so `.requires[<=3]->item-42` is the
path `requires` with a depth cap, followed by the walk operator; a bracket after
the operator is part of the value (`.title~=x[1]`).

### Operators

| written                       | meaning                                           |
| ----------------------------- | ------------------------------------------------- |
| `.p=v`                        | equals                                            |
| `.p=a,b,c`                    | equals any one of them                            |
| `.p=1..5`                     | in the range, inclusive; `1...5` excludes the end |
| `.p!=v`                       | not equal                                         |
| `.p~=v`                       | contains — a literal substring, never a pattern   |
| `.p<v` `.p<=v` `.p>v` `.p>=v` | comparisons                                       |

Presence, absence and a request are prefixes, not operators: `.p`, `!p` and `?p`
(below). A path takes them just as a component does: `.recipe.cuisine` has a
cuisine, `!recipe.cuisine` has none.

### Component prefixes

A component name can carry a prefix character that declares what a rule does
with it:

| written  | AST node   | meaning                                                             |
| -------- | ---------- | ------------------------------------------------------------------- |
| `.comp`  | `pred` `!` | the entity has this component                                       |
| `!comp`  | `pred` `=` | the entity does not have it                                         |
| `?comp`  | `pred` `?` | request this component when present, without filtering              |
| `+comp`  | `ensure`   | add it before the rule runs                                         |
| `+!comp` | `gate`     | it has to be absent, and is then added — so the rule runs once      |
| `*comp`  | `mutable`  | the rule's write set                                                |
| `-comp`  | `gone`     | this write removed it from the entity                               |
| `#Name`  | `resource` | a singleton resource, capitalized to distinguish it from components |
| `$name`  | `var`      | a variable                                                          |

`*comp` also asserts that the component is present, so it needs no `.comp`
beside it; `+comp` and `+!comp` are how a rule writes a component that is not
there yet. A `+` or `*` prefix may also name a property and a value
(`+result.call=$call`), to assign a property as part of the rule. `+!comp`
accepts only a component name, not a property assignment.

The first three rows describe reads: presence, absence and requested output. The
other prefixes describe rule behavior. `declared(ast)` separates filters from
additions, assignments, resources and variables. Evaluators such as
`@yaks/match` reject rule instructions passed directly to them with
`Unsupported`.

`-comp` matches a component removed by the current write; `!comp` matches an
entity without that component. Evaluating removal therefore requires the write
history: for example, `@yaks/sqlite`'s `overlay()` records removals while a rule
evaluates pending changes. A post-commit effect can also inspect the committed
changes. An evaluator without removal data rejects `-comp`. A bare `-word` is
therefore a clause, not a text term.

### The walk

`.requires->item-42` selects the entities that reach `item-42` through
`requires` hops; `.requires<-item-42` walks the other way, selecting what
`item-42` reaches. `.requires[<=3]->item-42` caps the depth at three hops.

The path is a relation name, a reference property (`.fork.from->S-7`), or a
chain of reference properties (`.fork.from.session->S-1`, one step composed of
those hops, so walking it follows the fork lineage) — the vocabulary determines
which form applies. The target is a single entity, named by eid or by human id.
Under the standard evaluator contract, without a bracket a walk has no hop cap
and returns at most 10,000 nearest nodes other than its target; only an explicit
`[<=N]` adds a hop cap. It parses to a `walk` node:
`walk(field, dir, target, depth?)`.

### Qualifiers

A path may carry a bracket of comma-separated arguments: `<=3` (an operator and
a value), `key=value`, or a bare `word`. Each kind of clause declares which
qualifiers it accepts — the walk accepts one depth cap, `.edges` accepts one or
two bare words, and every other clause takes none. An unrecognized qualifier is
rejected with an error naming it (`.status[<=3]=open` throws).

### Separators, grouping and quoting

Between terms, whitespace, `&` and `,` all mean AND, and each term stands on its
own; `&` is the form that survives in a URL query string. `|` between terms is
OR, and it binds more loosely than the AND of adjacent terms, so
`.a=1 .b=2|.c=3` is `(a and b) or c`. Parentheses group: `.a=1 (.b=2|.c=3)` is
`a and (b or c)`. An empty alternative beside a `|` is refused.

Inside a value, `,` is the any-of operator. A list has no spaces and no empty
member: `.p=a,b` is one clause, and `.p=a, b` is refused rather than repaired. A
value containing a space is quoted — `.title~="two words"`,
`.status='open wip'`, with a backslash escaping inside the quotes — where the
unquoted `.title~=two words` is the filter `two` plus the search term `words`.

### The leading dot

Paths with operators can omit the leading `.`. It keeps a URL query string's
filters apart from its `page` and `per` parameters, and a rule that never
appears in a URL can leave it off: `comp.prop=1` is the same clause as
`.comp.prop=1`, while `"comp.prop=1"` in quotes is a text term. For a name with
no operator, the dot changes its meaning: with no operator, `.env` tests for the
component `env`, where `env` searches for the word.

### Directives

Reserved directives appear beside component predicates. Most control ordering,
projection, aggregation or pagination; `.refs` filters by references:

| written                | meaning                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `.order=hot`           | the order the answer comes back in                                                                                                        |
| `.near=42`             | rank by similarity to this entity                                                                                                         |
| `.refs=42`             | everything that references entity 42; `.refs` references anything, `!refs` references nothing                                             |
| `.count`               | how many rows match, instead of the rows                                                                                                  |
| `.distinct=prop`       | the distinct values of one property                                                                                                       |
| `.tally=prop`          | each value of one property with its count                                                                                                 |
| `.fields=pin.x,pin.z~` | the properties each row carries; a trailing `~` excludes changes to that property from subscription notifications                         |
| `*`                    | every component of each selected entity                                                                                                   |
| `.limit=200`           | at most this many rows                                                                                                                    |
| `.after=13882`         | continue past this entity                                                                                                                 |
| `.edges`               | the edges touching the answer; `.edges.peers=status,title` projects the far endpoint; `.edges[watches,author.team]` selects one edge type |

`.after=<num>` is the paging cursor: the entity number to continue past, and the
only cursor form there is (`.after=T-13882` is the same number written with its
display prefix). It deliberately does not depend on the ordering — an evaluator
works out where that entity sits in whatever order the query asked for, so a
caller does not need the ordered property's value to request the next page. This
parser only records which entity it names; working out where that entity sits is
evaluation (`@yaks/sql`, `@yaks/match`).

`.limit=0` answers no rows. `.order`, `.limit` and `.after` shape a list of
rows, so an aggregate ignores them: `.count&.limit=20` counts every match.

### Two more rules

- Each clause has one spelling. The forms it once had beside that one (`.p!`,
  `.p!=` and `.p=` with no value, `.p?`, and a prefix with a dot after it,
  `!.p`) are refused with a message naming the one it has.
- `parse(q, { text: false })` refuses bare-word text terms, so a rule or a saved
  filter fails on a stray word instead of quietly gaining a search term. A
  quoted term is still allowed — quoting is how a strict query asks for a word.
- Paths stay raw dotted segments: `.review.book.title~=magic` is three segments
  and nothing more. Routing them to a schema is a downstream job.
- The empty query selects nothing: an empty string, or one with no clauses,
  parses to `{ kind: 'and', clauses: [{ kind: 'never' }] }`.

## Time literals

Nothing about how a value is written makes it a time — `today` looks like any
other word, and `.team=today` is a plain string. Whether a field holds a time is
schema, so `parse` emits scalars and never a `time` node. The helpers below let
a schema-aware compiler interpret scalars in time properties:

```ts
import { isTimeLiteral, timeEdges, timeInstant, timeSpan } from '@yaks/query'

isTimeLiteral('1 hour ago') // true
timeSpan('1 hour ago') // { start, end, at? } | null; `at` is the moment named
timeInstant('in 5m') // one moment (a stretch like `today` gives its start)
timeEdges('>', '1 hour ago') // [[['>', an hour ago]]]: what `>` asks of a stamp
```

The `time(raw)` builder creates the explicit node that a promoted AST, or a
hand-written query, carries.

## What this package leaves to a schema-aware compiler

Schema-dependent interpretation belongs to a compiler such as `@yaks/sql`:

- **Field routing** — mapping a bare `.status` to the record type that owns it,
  and resolving alternate names for the same field to the right hop. Paths stay
  raw segments here.
- **Reference resolution** — turning an id or a name (`.author=alice`) into a
  reference id, and resolving the targets of `.refs` and of reverse unions.
- **Type coercion** — reading a scalar as a number, an enum, a boolean or a
  time, and promoting time-typed scalars through `timeSpan`.
- **Reverse associations** — `.reviews`, its cardinality (`.reviews>=5`), and
  the mid-bang all/none form (`.reviews!.rating!=5`) are named by pluralizing a
  record type that references this one, which is schema. Reverse forms without
  the bang parse as ordinary path predicates for the compiler to restructure.
  The mid-bang form carries `not: true`; nested quantifiers keep a child `where`
  clause. The binder refuses names that are not reverse associations. Builders
  may also put a conjunction in `where`. A builder-set `facet: true` keeps a
  trailing component name from being read as a same-named property.
- **Scopes** — `.kind=book` parses as an ordinary predicate; expanding it into
  the presence and absence clauses that kind implies needs the schema's kind
  order.
- **Directive validation** — whether a walk's path names a relation or a chain
  of reference properties, which edge types `.edges` may name, and whether a
  `.distinct` or `.fields` path is a single property.
- **Evaluation** — matching rows, compiling SQL, and interpreting the `.order`
  rankings (`hot`, `search`, `similar`) against stored data.

## Multi-entity rules

A multi-entity rule uses one query pattern per entity, separated by `;`. Shared
variables join the patterns. This package parses one pattern and `declared()`
separates its filter from its instructions; reading a `;`-separated set of them
into a match plan is [@yaks/graph](../graph/join.ts)'s job.

## Teaching the format

`OPERATORS` and `DIRECTIVES` are the tables above as data, and `FORMAT` is a
prose description of the format composed from them — what a CLI or an MCP server
prints when asked how a query is written. A help page and a tab-completion list
read the same two tables, so they share the same syntax definitions. These
exports contain no schema: which properties hold times, which names are kinds,
and how an id resolves are for a schema-aware caller to describe alongside.

The root export also includes AST types, `coerce()` for builder values,
`parseDot()` for one clause token, `cursor()` for entity-number cursors, and
`unitMs()` for time-unit conversion. `WALK_LIMIT` is the standard 10,000-node
traversal limit; `WALK_DEPTH` is the older exported depth constant (16), not the
default for a walk without a depth qualifier. The package has no runtime
dependencies or platform-specific APIs.
