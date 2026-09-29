# @yaks/query

A parser and a set of builders for the yaks query format. `parse()` turns a
query string into a serializable abstract syntax tree (AST); the builders
construct the same tree from code. The parser checks syntax only — not whether a
property exists, and not whether a given backend can answer the query. Use
[@yaks/sql](../sql/README.md) to compile the tree to SQL, or
[@yaks/match](../match/README.md) to evaluate it over bundles in memory. A
bundle is one entity's components represented as a JSON object. This package
stores no entities and opens no database; its output is plain JSON data.

Given a loaded [@yaks/vocab](../vocab/README.md) vocabulary, two functions read
a query the way it will be answered: `meant()` decides what a bare property
means from the rest of the line, and `complete()` offers what can be typed next
at a caret.

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
| accessors     | `clauses directive orderOf nearOf windowOf declared bare`                           |

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
`a and (b or c)`. An empty alternative beside a `|` is refused. A directive
(below) belongs to the whole query wherever it is written, so `.a|.b&.limit=2`
is at most two of `a or b`, never `b` cut to two. To narrow a line with another,
`conjoin('.a|.b', '.c')` writes `(.a|.b)&.c`, grouping a line that holds a
top-level `|`.

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
projection, aggregation or pagination, and the parser lifts each of those to the
top-level clause list, where `directive(clause)` finds it; `.refs` filters by
references:

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

`.after=<id>` is the paging cursor: an entity number, human id, or eid to
continue past (`.after=T-13882` names the same number as `.after=13882`). An eid
pages entities that have no number. It does not depend on the ordering — an
evaluator works out where that entity sits in whatever order the query asked
for, so a caller does not need the ordered property's value to request the next
page. This parser only records which entity it names; working out where that
entity sits is evaluation (`@yaks/sql`, `@yaks/match`).

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

## Reading a query against a vocabulary

A bare property several components declare (`status`, on a graph holding tasks
and sessions) is ambiguous to the vocabulary, which refuses it and names the
candidates. `meant(vocab, ast)` resolves it to the component the rest of the
line names outright, when exactly one candidate is named: `.task&.status=open`
reads as `.task&.task.status=open`. A branch of an `|` sees its own clauses and
what encloses it, never its sibling's. `meaning(vocab)` does the same for a
query as typed, and returns the very string when nothing changed.

`complete(vocab, text, caret?, source?)` is the one completion engine for every
place a query is typed. It reads the word under the caret and returns its span
(`from`, `to`) and the candidates to replace it with, each the whole word as it
reads once taken and labeled with where it comes from:

```ts
import { loadVocab } from '@yaks/vocab'
import { complete } from '@yaks/query'

let v = loadVocab({
  $defs: {
    task: {
      component: true,
      properties: { status: { type: 'string', enum: ['open', 'done'] } },
    },
  },
})
complete(v, '.sta').cands // [..., { text: '.status', kind: 'task' }]
complete(v, '.status').cands // the operators: '.status=' equals, '.status!=' not, …
complete(v, '.status=o').cands // [{ text: '.status=open', kind: 'status' }]
```

It offers components, properties (`· stamped` for a server-owned one, `· ref`
for a reference), reverse associations, operators, the dotted directives and
their values, enum members, `1`/`0` for a flag and time phrases for a time. A
bare property is offered only where it stands: resolved by the vocabulary, or by
the rest of the line as `meant()` would read it. The properties of a `_`
component, and one marked `bare: false`, are reached through their component.

What only a graph knows comes from a `source` the caller supplies:
`ids(ref,
prefix)` for the entities a reference could name,
`values(comp, prop, prefix)` for the values a property holds, and `ranks` for
the `.order=` rankings its evaluator answers. A source that answers with a
promise makes the whole answer a promise; one that answers at once keeps it
synchronous.

## What this package leaves to a schema-aware compiler

Schema-dependent interpretation belongs to a compiler such as `@yaks/sql`:

- **Field routing** — mapping a bare `.status` to the record type that owns it
  (@yaks/vocab's `route` and `aim`). Paths stay raw segments in the AST;
  `meant()` above only qualifies a bare name the line decides.
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
  of reference properties, which edge types `.edges` may name, and whether an
  `.order`, `.distinct`, `.tally` or `.fields` path names one property, on the
  entity or through a chain of references (`.fields=review.book.doc.title`).
- **Evaluation** — matching rows, compiling SQL, and interpreting the `.order`
  rankings (`hot`, `search`, `similar`) against stored data.

## Multi-entity rules

A multi-entity match uses one query pattern per entity, separated by `;`. Shared
variables join the patterns. Brackets collect inner matches into one outer
binding, including an empty collection:

```text
$region .region; [$sfx .sfx, sfx.region=$region]
```

`parseMatch()` reads the recursive syntax into pattern and collection parts.
`declared()` separates each pattern's filter from its instructions, and
[@yaks/graph](../graph/join.ts) turns the parts into a match plan.

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
default for a walk without a depth qualifier. The package's one dependency is
@yaks/vocab, for `meant()` and `complete()`; it uses no platform-specific APIs.
