# @yaks/query

A generic, **schema-agnostic** parser and builder for the yaks query format. It
turns a query string into a plain, serializable AST, and builds the _same_ AST
from code. It knows the format — operators, any-of lists, ranges, time literals,
the reserved directives, how tokens separate — and nothing about any particular
schema. Deciding whether `status` is a real column, a reference, or an enum, and
how a field maps to storage, is a downstream job — see
[@yaks/vocab](https://jsr.io/@yaks/vocab), which describes a schema, and
[@yaks/sql](https://jsr.io/@yaks/sql), which takes this AST plus a `@yaks/vocab`
schema and compiles SQL.

## Install

```sh
deno add jsr:@yaks/query
# or: npx jsr add @yaks/query
```

## Parse

```ts
import { parse } from '@yaks/query'

parse('.status=open&.priority<=1&.team=frontend,backend')
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

Bare words are full-text terms, and `&` and whitespace both separate clauses, so
a search box mixes filters and text on one line:

```ts
parse('crash on save .updated.at=today')
// and( text('crash'), text('on'), text('save'), pred('updated.at', '=', scalar('today')) )
```

## Build

The builders produce the same shape, so `parse(x)` deep-equals the equivalent
builder calls:

```ts
import { and, eq, le, list, parse } from '@yaks/query'

let a = parse('.status=open&.priority<=1&.team=frontend,backend')
let b = and(
  eq('status', 'open'),
  le('priority', 1),
  eq('team', list('frontend', 'backend')),
)
// a deep-equals b
```

Vocabulary: `eq ne contains lt le gt ge present absent want pred` (predicates);
`list range scalar time text` (values and terms); `and or` (composition);
`order near refs hasRefs count distinct tally fields limit after edges reaches`
(directives); `clauses orderOf nearOf windowOf` (accessors).

## The format

- `.p=v` equals · `.p=a,b,c` any-of · `.p=1..5` range (inclusive), `1...5`
  exclusive end · `.p=` absent · `.p!` present · `.p!=v` not · `.p~=v` contains
  (literal) · `.p<v .p<=v .p>v .p>=v` comparisons · `.p?` want the field
  alongside the filter.
- Paths are raw dotted segments: `.review.book.title~=magic`. This parser does
  not route them to a schema — that is a downstream job.
- Directives ride the clause list: `.order=hot` `.near=42` `.refs=42` `.count!`
  `.distinct=col` `.tally=col` `.fields=pin.x,pin.z~` `.limit=200`
  `.after=13882` `.edges!` `.edges.peers=status,title`
  `.edges[watches,author.team]!` `.reaches[blocks,<=3]=42`.
- Quotes glue a value across whitespace and `&`; the empty query selects nothing
  (`{ kind: 'never' }`).
- `.after=<num>` is the window's cursor: the spine number of the entity to
  continue past, and the ONLY cursor spelling. It is order-agnostic on purpose —
  an evaluator derives the anchor's place in whatever order the query asked for,
  so a caller pages without ever learning the order key. This parser only says
  which entity it names; where that sits is evaluation (`@yaks/sql`,
  `@yaks/match`).

## Time literals

A value's _syntax_ never marks it a time — `today` looks like any word, and
`.team=today` is a plain string. Whether a field is time-typed is schema, so
`parse` emits scalars and never a `time` node. The generic recognizer is here
for downstream to promote a scalar once the schema says the column is
time-typed:

```ts
import { isTimeLiteral, timeInstant, timeSpan } from '@yaks/query'

timeSpan('1 hour ago') // { start, end } | null
timeInstant('in 5m') // one moment (a forward phrase reads its end)
```

The `time(raw)` builder makes the explicit node a promoted AST or a hand-written
query carries.

## What is downstream

This package deliberately stops at structure. Everything that needs a schema is
left as raw tokens for a schema-aware compiler such as `@yaks/sql`:

- **Field routing** — mapping a bare `.status` to the record type that owns it,
  and resolving alternate spellings of the same field into the right hop. Paths
  stay raw segments here.
- **Reference resolution** — turning an id or name (`.author=alice`) into a
  reference id, and resolving `.refs`/reverse-union targets, needs the schema.
- **Type coercion** — reading a scalar as a number, an enum, a boolean, or a
  time, and promoting time-typed scalars via `timeSpan`.
- **Reverse associations** — `.reviews`, its cardinality (`.reviews>=5`), and a
  mid-bang all/none form (`.reviews!.rating!=5`) are named by pluralizing a
  record type that references this one, which is schema. Non-bang reverse forms
  parse as ordinary path predicates for the compiler to restructure; the
  mid-bang form is refused at this layer (it is indistinguishable from a
  forgotten `&` without the schema).
- **Scopes** — `.kind=book` parses as an ordinary predicate; expanding it to the
  presence/absence clauses a kind implies needs the schema's kind order.
- **Directive validation** — which edge types `.reaches`/`.edges` may name, and
  whether a `.distinct`/`.fields` path is a single column, is schema.
- **Evaluation** — matching rows, compiling SQL, and interpreting `.order`
  rankings (`hot`, `search`, `similar`) against real data.
