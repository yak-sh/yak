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

Bare words are full-text terms, and whitespace separates clauses, so a search
box mixes filters and text on one line:

```ts
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

Vocabulary: `eq ne contains lt le gt ge present absent want pred` (predicates);
`ensure gate mutable resource variable` (the rule sigils);
`list range scalar
time text` (values and terms); `and or` (composition);
`clauses orderOf nearOf
windowOf declared` (accessors); the walk `walk`; and the
directives
`order near refs hasRefs
count distinct tally fields every limit after edges`.

## The format

A token is one of three things **by its own shape**: a component clause (it
wears a sigil, or it carries an operator), a quoted text term, or a bare word,
which is a text term. Nothing is read by trying and failing — a malformed clause
throws where it is read rather than falling back to text.

A clause is `path [qualifiers]? operator value`. The bracket binds to the
**path** and is read before any operator, so `.requires[<=3]->T-42` is the path
`requires` qualified by a cap, then the walk operator; a bracket after the
operator is part of the value (`.title~=x[1]`).

- **Sigils** mark a component word: `.comp` present · `!comp` absent · `+comp`
  ensure (add it before the rule runs) · `+!comp` gate (it must be absent, and
  is added, so a rule fires once) · `*comp` mutable (the rule's write set; it
  says the component is present as well, so `*comp` needs no `.comp` beside it,
  and `+comp`/`+!comp` is how a rule writes one that is not there yet) · `#Name`
  a singleton resource, capitalized so it cannot collide with a component in the
  bundle a rule binds them into · `$name` a variable. The first two are ordinary
  predicates — presence and absence are questions any evaluator answers — and
  the rest are a rule's own words, which an evaluator with no rule engine
  refuses (`Unsupported`) rather than guessing at. `declared(ast)` splits a
  query into the filter half and those lists.
- **Operators**: `.p=v` equals · `.p=a,b,c` any-of · `.p=1..5` range
  (inclusive), `1...5` exclusive end · `.p!=v` not · `.p~=v` contains (literal)
  · `.p<v .p<=v .p>v .p>=v` comparisons · `.p?` want the field alongside the
  filter.
- **The walk**: `.requires->T-42` selects what reaches `T-42` through at most 16
  `requires` hops; `.requires<-T-42` walks the other way (what `T-42` reaches);
  `.requires[<=3]->T-42` caps the depth. The path is a relation name or a
  reference column (`.fork.from->S-7`) — which is schema — and the target is one
  entity, by eid or human id. The cap is part of the grammar: an unbounded walk
  has no spelling. Parses to a `walk` node
  (`walk(field, dir,
  target, depth?)`).
- **Qualifiers**: a path may wear a bracket of comma-separated arguments — `<=3`
  (an operator and a value), `key=value`, or a bare `word`. Each clause says
  which it accepts: the walk takes exactly one depth cap, `.edges[type,
  via]`
  two bare words, and every other clause none — an unknown qualifier is refused
  by name (`.status[<=3]=open` throws), never dropped.
- The leading `.` is **accepted everywhere and required nowhere**: it keeps a
  URL query string's filters apart from its `page` and `per`, and a rule that
  never travels in a URL may drop it — `comp.prop=1` is the same clause as
  `.comp.prop=1`, and `"comp.prop=1"` in quotes is the text term. It IS what
  tells the opless `.env` (wears `env`) from `env` (search for it).
- `.p!` (present) and `.p=` (absent) are the older spellings of `.p` and `!p`,
  still parsed to the same nodes; saved queries keep working.
- **Separators**: between terms, whitespace, `&` and `,` are aliases for AND
  (`&` is the URL-query form), and every term stands alone; inside a value `,`
  is the list operator. A list has no spaces and no empty member: `.p=a,b` is
  one clause, `.p=a, b` is refused. A value holding a space is quoted —
  `.title~="two words"`, `.status='open wip'`, a backslash escaping inside —
  where unquoted `.title~=two words` is the filter `two` and the search term
  `words`.
- `?comp` is the prefix mirror of `!comp`: optional, selected when present and
  never filtered on. `.comp?` is its older suffix spelling, still parsed.
- `parse(q, { text: false })` refuses bare-word text terms, so a rule or a saved
  filter fails on a stray word instead of quietly gaining one. A quoted term is
  still allowed — quoting is how a strict query asks for a word.
- Paths are raw dotted segments: `.review.book.title~=magic`. This parser does
  not route them to a schema — that is a downstream job.
- Directives ride the clause list: `.order=hot` `.near=42` `.refs=42` `.count!`
  `.distinct=col` `.tally=col` `.fields=pin.x,pin.z~` `*` (every component)
  `.limit=200` `.after=13882` `.edges!` `.edges.peers=status,title`
  `.edges[watches,author.team]!`.
- Quotes glue a value across whitespace; the empty query selects nothing
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
  forgotten space without the schema).
- **Scopes** — `.kind=book` parses as an ordinary predicate; expanding it to the
  presence/absence clauses a kind implies needs the schema's kind order.
- **Directive validation** — whether a walk's path names a relation or a
  reference column, which edge types `.edges` may name, and whether a
  `.distinct`/`.fields` path is a single column, is schema.
- **Evaluation** — matching rows, compiling SQL, and interpreting `.order`
  rankings (`hot`, `search`, `similar`) against real data.
