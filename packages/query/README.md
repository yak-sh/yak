# @yaks/query

A generic, **schema-agnostic** parser and builder vocabulary for the yaks query
format. It turns a query string into a plain, serializable AST, and builds the
_same_ AST from code. It knows the format — operators, any-of lists, ranges,
time literals, the reserved directives, how tokens separate — and nothing about
any schema. Deciding whether `status` is a real column, a reference, or an enum,
and how a field maps to storage, is a downstream job (`@yaks/sql` takes this AST
plus a schema and compiles SQL).

## Parse

```ts
import { parse } from '@yaks/query'

parse('.status=open&.priority<=1&.domain=Ops,Eng')
// {
//   kind: 'and',
//   clauses: [
//     { kind: 'pred', path: ['status'],   op: '=',  value: { kind: 'scalar', raw: 'open' } },
//     { kind: 'pred', path: ['priority'], op: '<=', value: { kind: 'scalar', raw: '1' } },
//     { kind: 'pred', path: ['domain'],   op: '=',
//       value: { kind: 'list', items: [ {kind:'scalar',raw:'Ops'}, {kind:'scalar',raw:'Eng'} ] } },
//   ],
// }
```

Bare words are full-text terms, and `&` and whitespace both separate clauses, so
a search box mixes filters and text on one line:

```ts
parse('runner exit .updated.at=today')
// and( text('runner'), text('exit'), pred('updated.at', '=', scalar('today')) )
```

## Build

The builders produce the same shape, so `parse(x)` deep-equals the equivalent
builder calls:

```ts
import { and, eq, le, list, parse } from '@yaks/query'

const a = parse('.status=open&.priority<=1&.domain=Ops,Eng')
const b = and(
  eq('status', 'open'),
  le('priority', 1),
  eq('domain', list('Ops', 'Eng')),
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
  (literal) · `.p<v .p<=v .p>v .p>=v` comparisons · `.p?` want the component
  beside the filter.
- Paths are raw dotted segments: `.comment.target.doc.title~=foo`. This parser
  does not route them to components — that is schema.
- Directives ride the clause list: `.order=hot` `.near=T-3` `.refs=T-3`
  `.count!` `.distinct=col` `.tally=col` `.fields=pin.x,pin.z~` `.limit=200`
  `.after=13882` `.edges!` `.edges.peers=status,title`
  `.edges[referenced,entry.session]!` `.reaches[requires,<=3]=T-42`.
- Quotes glue a value across whitespace and `&`; the empty query selects nothing
  (`{ kind: 'never' }`).

## Time literals

A value's _syntax_ never marks it a time — `today` looks like any word, and
`.domain=today` is a plain string. Whether a field is time-typed is schema, so
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

## What is downstream (`@yaks/sql`'s job)

This package deliberately stops at structure. Everything that needs the
vocabulary is left as raw tokens for a schema-aware compiler:

- **Field routing** — mapping a bare `.status` to its owning component, and
  resolving the two dotted spellings (`.comment.target` vs `.assignee`) into
  deref hops. Paths stay raw segments here.
- **Reference resolution** — turning an id/alias (`.assignee=jeff`) into an eid,
  and the `.refs`/reverse-union targets, needs the graph.
- **Type coercion** — reading a scalar as a number, priority, bool, enum, or
  time, and promoting time-typed scalars via `timeSpan`.
- **Reverse associations** — `.comments`, its cardinality (`.comments>=5`), and
  the ALL/NONE mid-bang (`.comments!.status!=done`) are named by pluralizing a
  component with a reference column, which is schema. Non-bang reverse forms
  parse as ordinary path predicates for the compiler to restructure; the
  mid-bang form is refused at this layer (it is indistinguishable from a
  forgotten `&` without the schema).
- **Scopes** — `.kind=memory` parses as an ordinary predicate; expanding it to
  the presence/absence clauses a kind implies needs the kind order.
- **Directive validation** — which edge types `.reaches`/`.edges` may name, and
  whether a `.distinct`/`.fields` path is a single column, is schema.
- **Evaluation** — matching rows, compiling SQL, and interpreting `.order`
  rankings (`hot`, `search`, `similar`) against real data.
