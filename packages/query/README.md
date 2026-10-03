# @yaks/query

Parses query strings into a serializable AST, builds the same AST from code, and
completes query text against a loaded vocabulary. Use it for query input, query
builders, and interpreters that need one shared format.

## Query model

A **query** describes which [entities](../graph/README.md#data-model) to select
and how to shape the answer, such as `.task.status=open .limit=20`. An **AST**
(abstract syntax tree) is the query's plain JSON representation:
`{ kind: 'and', clauses: [...] }`. A **clause** is one AST node, such as
`{ kind: 'text', value: 'crash' }`; `and` and `or` clauses contain other
clauses.

A **path** is a sequence of raw dotted names, such as `task.status` or
`review.book.doc.title`. A **predicate** is a clause with a path, an operator,
and a value, such as `.task.status=open`. The parser keeps paths as segments; a
[vocabulary](../vocab/README.md#vocabulary) determines what they name. A
[property](../graph/README.md#data-model) is named with its
[component](../graph/README.md#data-model): `.task.status`, never `.status`. A
name alone names a component: `.task`.

A **value** is the right-hand side of a predicate. A **scalar** keeps its raw
text (`{ kind: 'scalar', raw: 'open' }`); a **list** holds alternative values
(`open,done`); a **range** holds two ends (`1..5`, inclusive, or `1...5`,
excluding the end). The vocabulary determines whether a scalar is a number, a
[reference](../vocab/README.md#vocabulary), an enum member, or a time.

`parse()` checks syntax, not whether a property exists or an evaluator supports
it. [@yaks/sql](../sql/README.md) compiles the AST to SQL;
[@yaks/match](../match/README.md) evaluates it over
[bundles](../graph/README.md#data-model) in memory. This package stores no
entities and opens no database.

## Install

```sh
deno add jsr:@yaks/query
# or: npx jsr add @yaks/query
```

## Parse and build

Builders construct the same AST as the parser. They accept strings, numbers, or
value nodes; `coerce()` turns strings and numbers into scalars.

```ts
import { and, eq, le, list, parse } from '@yaks/query'
import { equal } from '@yaks/testing'

const query = parse(
  '.task.status=open .task.priority<=1 .task.team=frontend,backend',
)
equal(
  query,
  and(
    eq('task.status', 'open'),
    le('task.priority', 1),
    eq('task.team', list('frontend', 'backend')),
  ),
)
equal(JSON.parse(JSON.stringify(query)), query)
```

## Exports

All exports are available from `@yaks/query`.

| Part                      | Exports                                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Parsing                   | `parse`, `parseDot`, `conjoin`, `valued`, `cursor`, `ParseOpts`                                                         |
| Predicates                | `eq`, `ne`, `contains`, `lt`, `le`, `gt`, `ge`, `present`, `absent`, `want`, `pred`, `bare`                             |
| Values and text           | `coerce`, `scalar`, `list`, `range`, `time`, `text`, `never`                                                            |
| Composition               | `and`, `or`, `map`                                                                                                      |
| Walks                     | `walk`, `WALK_LIMIT`, `WALK_DEPTH`                                                                                      |
| Directives and references | `order`, `near`, `refs`, `hasRefs`, `count`, `distinct`, `tally`, `fields`, `field`, `every`, `limit`, `after`, `edges` |
| Accessors                 | `clauses`, `directive`, `orderOf`, `nearOf`, `windowOf`                                                                 |
| Rule instructions         | **`ensure`**, `gate`, `mutable`, `gone`, `resource`, `variable`, `declared`, `Declares`, `Set`                          |
| Multi-entity matches      | `parseMatch`, `MatchPart`                                                                                               |
| Time literals             | `isTimeLiteral`, `timeSpan`, `timeInstant`, `timeEdges`, `unitMs`, `Span`, `Edge`                                       |
| Completion                | `complete`, `Completion`, `Cand`, `Source`                                                                              |
| Format help               | `OPERATORS`, `DIRECTIVES`, `FORMAT`, `Taught`                                                                           |
| AST types                 | `Query`, `Clause`, `Op`, `Value`, `Input`, and the node types in [ast.ts](./ast.ts)                                     |

## Predicates and text

A **text term** is a clause containing search text, such as `crash`,
`"two words"`, or the prefix term `lemo*`. A bare word is a text term; a
component prefix or an operator identifies a clause. Malformed clauses throw
`SyntaxError` rather than becoming text terms.

| Written                       | Meaning                                   |
| ----------------------------- | ----------------------------------------- |
| `.p=v`                        | equals                                    |
| `.p=a,b,c`                    | equals any list member                    |
| `.p=1..5` / `.p=1...5`        | inclusive range / range excluding the end |
| `.p!=v`                       | not equal                                 |
| `.p~=v`                       | contains a literal substring              |
| `.p<v` `.p<=v` `.p>v` `.p>=v` | comparisons                               |
| `.comp` / `.comp.prop`        | present                                   |
| `!comp` / `!comp.prop`        | absent                                    |
| `?comp` / `?comp.prop`        | requested when present, without filtering |

Contains keeps its entire value as one scalar, including commas or `..`. The
other operators parse list and range structure.

```ts
import {
  absent,
  and,
  bare,
  contains,
  eq,
  parse,
  parseDot,
  present,
  range,
  text,
  valued,
  want,
} from '@yaks/query'
import { equal } from '@yaks/testing'

equal(
  parse('crash .task.priority=1...5 !task.closed ?doc'),
  and(
    text('crash'),
    eq('task.priority', range(1, 5, true)),
    absent('task.closed'),
    want('doc'),
  ),
)
equal(parse('.doc.title~="two words"'), and(contains('doc.title', 'two words')))
equal(parse('lemo*'), and(text('lemo*')))
equal(parseDot('.task'), [present('task')])
equal(parseDot('task'), null)
equal(bare(present('task')), true)
equal(bare(present('task.status')), false)
equal(valued('.task.status=open'), true)
```

### Separators, grouping, and quoting

Whitespace, `&`, and commas between clauses mean AND. `|` means OR and binds
more loosely; parentheses group clauses. A comma inside a value makes a list,
with no spaces and no empty members. `.p=a,b` is one predicate; `.p=a, b`
throws. A comma between valued clauses can follow whitespace: `.p=a, .q=b`.

Quote values containing spaces, using single or double quotes; a backslash
inside quotes escapes the next character. Unquoted `.doc.title~=two words` is a
predicate containing `two` followed by the text term `words`. Paths with
operators may omit the leading dot: `task.status=open` and `.task.status=open`
parse alike. Without an operator, `task` is a text term and `.task` tests
presence.

`conjoin()` combines query strings so each narrows the whole of the others,
grouping a string with a top-level `|` before joining it.

```ts
import { and, conjoin, eq, or, parse } from '@yaks/query'
import { equal } from '@yaks/testing'

equal(
  parse('.task.status=open (.task.priority=1|.task.priority=2)'),
  and(
    eq('task.status', 'open'),
    or(eq('task.priority', 1), eq('task.priority', 2)),
  ),
)
equal(conjoin('.task|.note', '.doc', ''), '(.task|.note)&.doc')
equal(parse('task.status=open'), parse('.task.status=open'))
```

### Strict parsing and empty queries

`parse(q, { text: false })` refuses bare words. Quoted text terms remain
allowed. Each presence, absence, and requested form has one spelling; `.p!`,
`.p!=`, `.p=`, `.p?`, and `!.p` throw with the accepted form. An empty query has
a `never` clause, which selects nothing.

Parsed ASTs are frozen throughout and cached by query string and strictness.
Treat them as immutable; construct a different AST with builders or `map()`.

```ts
import { and, never, parse, text } from '@yaks/query'
import { equal, throws } from '@yaks/testing'

equal(parse(''), and(never()))
equal(parse('"crash"', { text: false }), and(text('crash')))
equal(
  (await throws(() => parse('crash', { text: false }))) instanceof SyntaxError,
  true,
)
equal(
  (await throws(() => parse('.task.status=open, done'))) instanceof SyntaxError,
  true,
)
equal((await throws(() => parse('!.task'))) instanceof SyntaxError, true)
equal(Object.isFrozen(parse('.task').clauses[0]), true)
```

## Walks and qualifiers

A **walk** is a clause selecting entities reached by repeated traversal of a
path. `.requires->item-42` selects entities that reach `item-42`;
`.requires<-item-42` selects what `item-42` reaches. The vocabulary determines
whether the path names a relation, a reference property (`fork.from`), or a
chain of reference properties (`fork.from.entry.session`). The target is one
entity, by eid or human id.

A **qualifier** is an argument in brackets on a path. It can be an operator and
value (`<=3`), a key and value (`key=value`), or a bare word. A walk accepts one
depth cap (`[<=3]`), and `.edges` accepts one or two bare words; other clauses
refuse qualifiers. Brackets after an operator belong to the value, so
`.doc.title~=x[1]` contains the literal `x[1]`.

Without a depth qualifier, a walk carries no hop cap. `WALK_LIMIT` specifies the
standard evaluator limit of 10,000 nearest entities other than the target.
`WALK_DEPTH` is an exported constant of 16; `parse()` does not apply it to walks
without a qualifier.

```ts
import { and, parse, walk } from '@yaks/query'
import { equal, throws } from '@yaks/testing'

equal(
  parse('.requires[<=3]->item-42'),
  and(walk('requires', '->', 'item-42', 3)),
)
equal(parse('.fork.from<-S-7'), and(walk('fork.from', '<-', 'S-7')))
equal(
  (await throws(() => parse('.task.status[<=3]=open'))) instanceof SyntaxError,
  true,
)
```

## Directives

A **directive** is a clause shaping the answer rather than selecting entities:
ordering, projection, aggregation, or pagination. `directive()` identifies these
clauses. Under OR, the parser lifts directives to the query's top-level clause
list, so `.task|.note&.limit=2` limits the combined selection. `.refs` is a
reserved name too, but it selects by references and is not a directive.

| Written                              | Requested answer                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `.order=hot`                         | order by a ranking or a property path (`-created.at` descends)                  |
| `.near=42`                           | similarity ranking relative to one entity                                       |
| `.refs=42` / `.refs` / `!refs`       | references to 42 / any references / no references                               |
| `.count`                             | number of matches                                                               |
| `.distinct=comp.prop`                | distinct property values                                                        |
| `.tally=comp.prop`                   | each property value with its count                                              |
| `.fields=pin.x,pin.z~`               | selected properties; `~` excludes that property from subscription notifications |
| `*`                                  | every component of each selected entity                                         |
| `.limit=200`                         | at most 200 entities; `0` requests none                                         |
| `.after=13882`                       | continue past one entity, by number, human id, or eid                           |
| `.edges`                             | edges touching the answer                                                       |
| `.edges[type,via]`                   | one edge type and an optional endpoint reference property                       |
| `.edges.peers=task.status,doc.title` | properties of the far endpoint                                                  |
| `.edges.limit=200`                   | at most 200 edges                                                               |

A property path through a reference in `.fields` requests what it reaches as its
own bundle. See [graph projections](../graph/README.md#projections). The parser
records raw directive values; the evaluator validates their paths and rankings
and locates the entity named by `.after` in the requested order. `cursor()`
recognizes entity numbers and human ids; other nonempty `.after` values become
eids. An aggregate uses every match and ignores `.order`, `.limit`, and
`.after`, which shape entity lists.

```ts
import {
  after,
  and,
  clauses,
  count,
  cursor,
  directive,
  distinct,
  edges,
  every,
  fields,
  hasRefs,
  limit,
  near,
  nearOf,
  order,
  orderOf,
  parse,
  refs,
  tally,
  windowOf,
} from '@yaks/query'
import { equal } from '@yaks/testing'

equal(
  parse('.order=hot .near=T-42 .fields=pin.x,pin.z~ * .limit=2 .after=T-3'),
  and(
    order('hot'),
    near('T-42'),
    fields('pin.x', 'pin.z~'),
    every(),
    limit(2),
    after(3),
  ),
)
equal(
  parse('.count .distinct=task.status .tally=task.status'),
  and(
    count(),
    distinct('task.status'),
    tally('task.status'),
  ),
)
equal(parse('.refs=T-42 .refs !refs'), and(refs('T-42'), hasRefs(), refs()))
equal(
  parse('.edges[watches,author.team] .edges.peers=doc.title .edges.limit=2'),
  and(
    edges({ select: { type: 'watches', via: ['author', 'team'] } }),
    edges({ peers: [['doc', 'title']] }),
    { kind: 'edges', peers: [], limit: 2 },
  ),
)
const query = parse(
  '.task|.note&.order=hot&.near=T-42&.limit=2&.after=book:dune',
)
equal(clauses(query).filter(directive).map((c) => c.kind), [
  'order',
  'near',
  'limit',
  'after',
])
equal(orderOf(query), 'hot')
equal(nearOf(query), 'T-42')
equal(windowOf(query), { limit: 2, after: 'book:dune' })
equal(cursor('T-3'), 3)
equal(cursor('book:dune'), undefined)
```

## Rule instructions

A **rule instruction** is a clause that declares what a
[rule](../graph/README.md#rules) adds, writes, reads as a
[resource](../graph/README.md#rules), or binds as a variable. These clauses need
a rule engine; ordinary evaluators reject them when passed directly.
`declared()` separates instructions from the **filter**, the query an evaluator
can answer.

| Written                 | AST node      | Rule instruction                                                       |
| ----------------------- | ------------- | ---------------------------------------------------------------------- |
| `+comp`                 | **`ensure`**  | add the component before the rule runs                                 |
| `+!comp`                | **`gate`**    | require absence, then add the component so the rule runs once          |
| `*comp`                 | **`mutable`** | declare the component in the rule's write set, also requiring presence |
| `-comp`                 | **`gone`**    | match removal by the current write                                     |
| `#Name`                 | `resource`    | name a singleton resource; an eid fragment may also follow `#`         |
| `$name` / `$name=value` | **`var`**     | name a variable / bind its value                                       |

`+comp.prop=value` and `*comp.prop=value` also declare property assignments;
`+!comp` accepts only a component. An ensure or gate supplies a component that a
mutable instruction writes without requiring its prior presence. A gone clause
differs from absence: it requires removal information from the write. A
committed bundle alone cannot answer it.

```ts
import { absent, and, declared, parse, present, scalar } from '@yaks/query'
import { equal } from '@yaks/testing'

const rule = declared(
  parse('$item .task +!created *created +result.call=$item #Config'),
)
equal(rule.filter, and(present('task'), absent('created')))
equal(rule.gates, ['created'])
equal(rule.writes, ['created'])
equal(rule.ensures, ['result'])
equal(rule.sets, [{ comp: 'result', prop: 'call', value: scalar('$item') }])
equal(rule.resources, ['Config'])
equal(rule.vars, ['item'])
equal(declared(parse('*task.status=done')).filter, and(present('task')))
equal(declared(parse('$priority=1')).values, [['priority', scalar('1')]])
equal(declared(parse('-task')).filter, and({ kind: 'gone', comp: 'task' }))
```

## Multi-entity matches

A **multi-entity match** joins entity queries by shared variables. A **pattern**
is one entity query in that match. A **collection** is a bracketed sequence of
patterns or nested collections whose matches belong to the surrounding
[binding](../graph/README.md#rules-over-more-than-one-entity) rather than
multiplying it. Semicolons separate patterns outside brackets and quotes; shared
variables join their matches. A collection can yield no matches, but its syntax
must contain at least one pattern.

`parseMatch()` parses these parts, using strict parsing by default.
[@yaks/graph](../graph/README.md#rules-over-more-than-one-entity) plans and
evaluates the match.

```ts
import { parse, parseMatch } from '@yaks/query'
import { equal } from '@yaks/testing'

equal(parseMatch('$region .region; [$sfx .sfx .sfx.region=$region]'), [
  { kind: 'pattern', query: parse('$region .region') },
  {
    kind: 'collection',
    parts: [
      { kind: 'pattern', query: parse('$sfx .sfx .sfx.region=$region') },
    ],
  },
])
```

## Mapping clauses and reverse associations

`map(ast, f)` visits every clause, children before parents, including boolean
composition and nested
[reverse association](../vocab/README.md#routing-and-references) conditions.
Returning each clause unchanged preserves the AST's identity. Interpreters use
it to rewrite paths without mutating a parsed AST.

The parser preserves the `!` that negates a reverse association's child test:
`.reviews!.review.rating!=5` carries `not: true`. Nested tests use a predicate's
`where` clause. Whether a name is a reverse association, and how to interpret
its cardinality or child test, belongs to the vocabulary and evaluator.

```ts
import { and, eq, map, parse } from '@yaks/query'
import { equal } from '@yaks/testing'

const query = parse('.task.status=open (.task.priority=1|.task.priority=2)')
equal(map(query, (c) => c) === query, true)
equal(
  map(
    parse('.task.status=open'),
    (c) => c.kind == 'pred' ? { ...c, path: ['session', 'status'] } : c,
  ),
  and(eq('session.status', 'open')),
)
equal(parse('.reviews!.review.rating!=5').clauses, [
  {
    kind: 'pred',
    path: ['reviews', 'review', 'rating'],
    op: '!=',
    value: { kind: 'scalar', raw: '5' },
    not: true,
  },
])
```

## Time literals

A **time literal** is text recognized by `timeSpan()`, such as `today`,
`1 hour ago`, `in 5m`, `9am`, or an ISO date or timestamp. A **span** has
`start` and `end` in epoch milliseconds and an optional `at` for the moment
named by a relative time literal. Day boundaries use the runtime's local time
zone; a timestamp with a zone uses that zone. Pass `now` to fix the clock.

The parser emits scalars even for `today`; only a vocabulary-aware compiler can
decide that a property holds time. `time()` builds an explicit time value.
`timeInstant()` takes `at` when present, otherwise `start`; `timeEdges()`
produces alternative sets of comparisons for an evaluator. An **Edge** is one
operator and epoch-millisecond boundary, such as `['>=', start]`. For equality,
each alternative describes a span with an inclusive start and exclusive end.
Comparisons against a moment use that moment; comparisons against a span use the
appropriate boundary. Unrecognized text returns `null`. `unitMs()` returns fixed
unit lengths; calendar months and years have no fixed length.

```ts
import {
  and,
  eq,
  isTimeLiteral,
  parse,
  time,
  timeEdges,
  timeInstant,
  timeSpan,
  unitMs,
} from '@yaks/query'
import { equal } from '@yaks/testing'

const now = +new Date(2026, 6, 15, 12)
equal(timeSpan('1 hour ago', now), {
  start: now - 3_600_000,
  end: now,
  at: now - 3_600_000,
})
equal(timeInstant('in 5m', now), now + 300_000)
equal(timeSpan('today', now), {
  start: +new Date(2026, 6, 15),
  end: +new Date(2026, 6, 16),
})
equal(timeEdges('>', '1 hour ago', now), [[['>', now - 3_600_000]]])
equal(timeEdges('=', 'now,1 hour ago', now), [
  [['=', now]],
  [['>=', now - 3_600_000], ['<', now]],
])
equal(isTimeLiteral('open', now), false)
equal(unitMs('m'), 60_000)
equal(unitMs('mo'), undefined)
equal(parse('.created.at=today'), and(eq('created.at', 'today')))
equal(time('today'), { kind: 'time', raw: 'today' })
```

## Completion

A **completion** is the replacement span (`from`, `to`), candidates, and `whole`
flag returned by `complete(vocab, text, caret?, source?)`. A **candidate** is
the complete replacement text with a `kind` label describing its origin. `whole`
says the text already forms a whole word; that word is excluded from the
candidates. Extensions of a whole word precede replacements.

Completion offers components, qualified properties, reverse associations,
operators, directives, enum members, boolean values, and time literals.
Reference and stamped property labels carry `· ref` and `· stamped`. An exact
name comes first, then a property whose component the rest of the query names;
this orders candidates without changing the query's meaning.

```ts
import { complete } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    task: {
      component: true,
      properties: {
        status: { type: 'string', enum: ['open', 'done'] },
      },
    },
  },
})
equal(complete(vocab, '.sta'), {
  from: 0,
  to: 4,
  cands: [{ text: '.task.status', kind: 'task' }],
  whole: false,
})
equal(complete(vocab, '.task.status=o').cands, [{
  text: '.task.status=open',
  kind: 'status',
}])
equal(complete(vocab, '.task.status').whole, true)
equal(complete(vocab, '.task').cands[0], { text: '.task.', kind: 'comp' })
```

A completion **source** supplies what only a graph knows: `ids(ref, prefix)`
returns reference targets, `values(comp, prop, prefix)` returns property values,
and `ranks` lists supported `.order` rankings. These return candidates whose
text is the value rather than the whole replacement. A promise from a source
makes that completion asynchronous; synchronous answers stay synchronous.
[@yaks/filter](../filter/README.md) builds browser and terminal query fields on
this interface.

```ts
import { complete } from '@yaks/query'
import { loadVocab } from '@yaks/vocab'
import { equal } from '@yaks/testing'

const vocab = loadVocab({
  $defs: {
    task: { component: true, properties: { team: { type: 'string' } } },
  },
})
const source = {
  values: (_comp: string, _prop: string, prefix: string) =>
    ['frontend', 'backend'].filter((text) => text.startsWith(prefix))
      .map((text) => ({ text, kind: 'team' })),
  ids: async (_ref: string, prefix: string) =>
    ['T-42'].filter((text) => text.startsWith(prefix))
      .map((text) => ({ text, kind: 'entity' })),
  ranks: ['hot'],
}
equal((await complete(vocab, '.task.team=f', undefined, source)).cands, [
  { text: '.task.team=frontend', kind: 'team' },
])
equal((await complete(vocab, '.refs=T-', undefined, source)).cands, [
  { text: '.refs=T-42', kind: 'entity' },
])
equal((await complete(vocab, '.order=h', undefined, source)).cands, [
  { text: '.order=hot', kind: 'rank' },
])
```

## Format help

`OPERATORS` and `DIRECTIVES` describe syntax as `Taught` entries with `spell`,
`word`, and `means`. `DIRECTIVES` also includes the reserved `.refs` filter and
walk syntax. `FORMAT` composes these tables into help text for a CLI or MCP
server. Callers add their vocabulary's property names, types, and rankings.

```ts
import { DIRECTIVES, FORMAT, OPERATORS } from '@yaks/query'
import { equal } from '@yaks/testing'

const contains = OPERATORS.find((entry) => entry.spell == '~=')!
equal(contains.word, 'contains')
equal(FORMAT.includes(contains.means), true)
equal(DIRECTIVES.some((entry) => entry.spell == '.fields='), true)
```

## Limits

Schema-dependent interpretation belongs to the vocabulary and evaluator:
resolving property paths and reference ids, refusing a property named alone,
coercing scalar values, interpreting reverse associations, expanding kinds, and
validating directive paths and rankings. See
[@yaks/vocab](../vocab/README.md#routing-and-references),
[@yaks/sql](../sql/README.md), and [@yaks/match](../match/README.md). Rules and
multi-entity matches require a rule engine such as
[@yaks/graph](../graph/README.md#rules). Completion uses the loaded vocabulary
and the source supplied by its caller; it does not read stored entities itself.
