# @yaks/match

Runs [@yaks/query](../query/README.md) queries against entity bundles held in
memory — no database and no SQL. `matcher()` selects from an array of bundles,
including ordering and paging; `filter()` tests a single bundle. Both read a
[@yaks/vocab](../vocab/README.md) schema to find out which component a column
belongs to and what type it holds.

The same query text can be run against a database by
[@yaks/sql](../sql/README.md), which compiles it into a `SELECT`.
`parity_test.ts` runs both over identical data and asserts they return the same
rows. The queries this package refuses, and the two it answers that the SQL side
refuses, are listed at the end.

## Install

```sh
deno add jsr:@yaks/match
# or: npx jsr add @yaks/match
```

## A bundle

A bundle is one entity with everything stored about it: its identity under
`entity`, and each component under its own name, columns inside.

```ts
{ entity: { eid: 'b1', num: 3 },
  doc: { title: 'The Left Hand of Spring', body: 'a winter journey north' },
  book: { price: 12, status: 'shelved', author: 'a1' } }
```

That is the shape [@yaks/graph](https://jsr.io/@yaks/graph) writes and
[@yaks/sqlite](https://jsr.io/@yaks/sqlite) reads back. This package declares
the shape in its own types rather than importing @yaks/graph's `Bundle`, because
@yaks/graph imports this package to compile its rules; the dependency has to run
one direction. A @yaks/graph bundle passes wherever this type is asked for.

Every example below runs against the bookshop fixture in `harness.ts`: four
books (`b1`–`b4`), three reviews (`r1`–`r3`), two authors (`a1`, `a2`), a member
and a plain document. Entity numbers are assigned in that order, so `b1` is
number 3.

## matcher and filter

```ts
import { matcher } from '@yaks/match'

let cheap = matcher('.status=shelved .price<20 .order=-price', vocab)
cheap(bundles) // [b1, b4] — the shelved books under 20, most expensive first
```

Whitespace and `&` both separate clauses, so the query above can also be written
`.status=shelved&.price<20&.order=-price`.

The array you pass in is all the data the run can see. Following a reference to
its target, finding the backlinks of an id, listing the children of a reverse
hop: each is a lookup in that array, and an entity missing from it reads as
absent — the same answer a missing database row gives. Deleted entities are
skipped: a bundle with a `tombstone` component, or one carrying the `$delete`
marker.

`filter()` compiles the same query into a test on one bundle, for a caller that
wants to re-check the single entity that just changed instead of sweeping the
whole array:

```ts
import { filter } from '@yaks/match'

let mine = filter('.status=shelved .author=a1', vocab)
mine(b1) // true
mine(b1, everything) // pass the array too when the query follows references or hops
```

`filter()` ignores `.order`, `.limit` and `.after`. Those describe a sequence,
and one bundle is not a sequence.

Both functions take an options object. `opts.now` is the millisecond timestamp
that relative time phrases (`today`, `1 hour ago`) resolve against; it defaults
to `Date.now()`. Pass the same value to @yaks/sql and both sides select the same
rows. `opts.computed` is described under [Computed columns](#computed-columns).

## Operators

| query                | matches                                                 |
| -------------------- | ------------------------------------------------------- |
| `.price=12`          | the column equals the operand                           |
| `.status=draft,sold` | any of the listed values                                |
| `.price=7.5..12`     | an inclusive range                                      |
| `.price=0...12`      | a range that excludes its upper bound                   |
| `.author=`           | the column is absent or empty                           |
| `.author!`           | the column has a value                                  |
| `.status!=sold`      | not equal, including entities with no `status` at all   |
| `.title~=spring`     | contains, case-insensitive                              |
| `.price<20`          | less than; also `<=`, `>`, `>=`                         |
| `.price?`            | a request for the column in the result; filters nothing |

An absent column never compares true under `<`, `<=`, `>` or `>=`, and `~=` with
an empty operand (`.title~=`) asks for presence rather than selecting
everything.

Number, priority and boolean columns compare numerically; every other type
compares as text. A boolean is stored as 0 or 1, so `.available=1` selects the
books in stock and `.available=true` selects nothing. An operand no stored
number could equal selects nothing rather than raising: `.price=12.0` is empty,
because a stored `12` formats back as `12`. A comparison is stricter —
`.price>cheap` is refused at compile time, because there is no number to compare
against.

### Time columns

A column the vocabulary types as a timestamp reads its operand as a time phrase
first. A phrase names a span of time, and the operator picks an edge of it:

- `=` — inside the span (`.released=today`)
- `>=` — from its start (`.released>=yesterday`)
- `<=` — up to its end
- `>` and `<` — strictly after, strictly before

A comma list of phrases under `=` is any-of, and under `!=` is none-of. When the
operand is not a phrase at all, the ordinary rules apply, so
`.released<2024-01-01` compares strings. Timestamps are stored as ISO 8601
strings, over which lexicographic order is chronological; a value outside the
range a canonical stamp lives in is not treated as a stamp and never matches a
time comparison.

### Components

`.signed!` selects the entities that have the `signed` component, and `.signed=`
the ones that do not. This works for a component with no columns at all — a tag,
where having it is the whole fact — as well as for one with columns.

A trailing `!` on a bare name is resolved as a component before it is resolved
as a column. In the bookshop `.book!` selects the four books (the entities with
a `book` component), while `.book=b1` still resolves to `review.book`, the
reference column of that name, and selects the two reviews of `b1`. Writing the
component out reaches the column either way: `.review.book!` selects the reviews
that name a book.

### Kinds

A vocabulary marks some components as kinds and orders them by precedence.
`.kind=book` selects entities that have the `book` component and none of the
kinds ordered before it — that is, entities whose most specific kind is `book`.
In the bookshop the order is `book`, `member`, `doc`, `review`, so `.kind=doc`
selects the two authors and the opening-hours document but not the books, which
have a `doc` component as well. A plural folds to the singular: `.kind=books`
means `.kind=book`. A value that names no kind is refused.

### References and paths

A reference column holds another entity's id, so `.author=a1` selects that
author's books. A dotted path follows the reference and tests a column on the
entity it points at:

```
.author.doc.title~=vale   // books whose author's title contains "vale"
```

Every hop but the last must be a reference column; anything else is refused when
the query is compiled. Each step is looked up in the bundle array, and an entity
missing from it reads as absent.

For the operators only a present value can satisfy — `!`, the four comparisons,
and `=` or `~=` with a non-empty operand — the entity must also have the root
component of the path. The absent forms do not require it, so
`.author.doc.title=` selects entities with no author at all as well as books
whose author has no title: a missing entity anywhere along the path reads as an
absent value. @yaks/sql emits the same narrowing, which also lets its query
planner drive from the root component's table.

### Reverse hops

A vocabulary derives an association from the far side of a reference: because
`review.book` points at a book, a book can be asked about its `reviews`.

- `.reviews!` — has at least one review
- `.reviews=` — has none
- `.reviews>=2` — a count, with any of `=`, `!=`, `<`, `<=`, `>`, `>=`
- `.reviews.stars=5` — at least one review matching that predicate

A child predicate is compiled by the same clause compiler, over the child
bundle, so anything refused there refuses the whole hop. A child predicate may
not reach the identity component: inside the hop, `entity` names the child
rather than the entity being tested, so `.reviews.entity.num=7` is refused
rather than quietly answering a different question.

### Backlinks

`.refs=b1` selects every entity holding a reference to `b1`, across every
reference column the vocabulary declares — in the bookshop, the two reviews of
that book. Only the `=` form exists: `.refs!` and `.refs=` are refused, because
"references anything" is a different question, and answering it as a union over
all reference columns would not be what the query means.

### Identity

`.eid=b1`, `.eid=b1,b2` and `.num=3` name entities rather than filter them, and
are answered as a lookup in the array. A human-readable id works in either
column: `B-3` is read as the entity numbered 3 (the letter is display, the
number is the identity), so one operand form fetches by eid, by entity number,
or by the id a person types.

### Walks

A walk selects by reachability. `.author->a1` selects the entities that reach
`a1` by following `author` references — the two books by that author. `<-`
reverses the direction, selecting the entities the target reaches. A bracket
caps the hops: `.cites[<=3]->p1` allows at most three. Without a bracket the
closure is unbounded, capped at @yaks/query's `WALK_LIMIT` rows.

One hop is a `(from, to)` pair, and a bundle can state one in three ways:

- an edge entity — a bundle carrying [@yaks/edge](../edge/README.md)'s
  `edge{from, to}` component alongside the relation's tag component
  (`cites {}`);
- a reference column on the entity itself — `.fork.from->S-7` reads `fork.from`
  as this entity → the entry it names;
- a chain of reference columns composed into one pair —
  `.fork.from.session->S-1` reads this entity → the session of the entry it
  forked from.

The closure is computed breadth-first, once per bundle array, and cached against
it. The target itself is selected only when a cycle leads back to it. A path
that is neither a relation tag nor a chain of reference columns is refused.

### Full-text terms

A bare word in the query is a full-text term over every stored text column of
every component the entity has — the same fields a full-text index covers by
default. It matches whole words, so `fables` finds "writes fables" while `fable`
finds nothing. A trailing `*` prefix-matches the final word: `catalog*` finds
"Spring Catalogue". The parser keeps a quoted run together as one term, whose
words must then appear in that order: `"narrow kitchens"`.

A token is a run of Unicode letters and digits, lowercased. A term with no word
in it at all matches nothing, never everything.

## Ordering and paging

`.order=price` sorts ascending by that column and `.order=-price` descending.
Values sort absent first, then numbers, then text — the order SQLite's
`ORDER BY` gives over the same values — and the entity number breaks ties, so
the order is total and a page cut here holds the rows a page cut in SQL holds.

`.limit=n` keeps the first n results. `.after=<num>` continues past the entity
with that number, wherever it sits in the order. It is one cursor form for every
ordering, so a caller pages without ever learning the order key:

- The anchor is looked up in the whole array rather than among the matches, so
  an anchor that no longer matches the query still names a place in the order.
- An anchor with no value for the ordered column pages on its entity number
  alone.
- An anchor no entity in the array has leaves the page whole, which is the first
  page.

@yaks/sql compiles the same rule as a keyset predicate, and `parity_test.ts`
pins the agreement.

With `.limit` or `.after` but no `.order`, results come back newest entity
number first. With none of the three, they keep the order they were given. A
database leaves an unordered result to its query plan, so for a query with no
`.order` the two evaluators promise the same membership, not the same order.

## Computed columns

A vocabulary can declare a column it never stores (`computed: true`), because
its formula belongs to the application rather than the schema. No bundle holds a
value for it, so this package takes the rule from the caller, keyed `comp.prop`
— the in-memory equivalent of the `derived` hook
[@yaks/sql](https://jsr.io/@yaks/sql) takes:

```ts
import { compute, derived } from '@yaks/task'

// one rule, two evaluators
matcher('.status=open', vocab, { computed: compute() }) // in memory
compile(ast, vocab, { derived: derived() }) // in a database
```

`opts.computed` maps `comp.prop` to a function of the bundle. The column's type
still comes from the vocabulary — the vocabulary declares the column, the
registration only supplies the read — and ordering by a computed column works
the same way. A registration also serves as a plain read override for a stored
column. A computed column nobody registered is refused.

## Refused queries

A question this package cannot answer exactly throws
[`Unsupported`](https://jsr.io/@yaks/sql/doc/~/Unsupported), the error @yaks/sql
throws, with its `by` field set to `@yaks/match` to name which of the two
refused. A caller using both therefore has one error type to catch. Every
refusal happens when the query is compiled, before any bundle is read.

- **`.near=`** — nearest-neighbour search needs vectors, and **`.edges!`** asks
  for links to be returned alongside the result. Neither is in a bundle. (Walks
  are answered; see above.)
- **`.count!`, `.distinct=`, `.tally=`** — an aggregate is a row shape, not a
  selection of entities. Count what comes back instead.
- **A computed column nobody registered** — no bundle holds its value and no
  rule was handed in. Register it through `opts.computed` and it is answered;
  @yaks/sql refuses the same column for the same reason when its `derived` hook
  has no entry.
- **`.refs!` and `.refs=`** — only `.refs=<id>` is a question about backlinks.
- **A predicate the column's type cannot answer** (`.price>cheap`), **a path
  whose root is not a reference column**, and **a reverse hop that is neither a
  count nor a child filter**.

Two questions it answers that @yaks/sql refuses, because JavaScript can do what
SQLite cannot:

- `~=` with a non-ASCII operand. SQLite's `lower()` folds ASCII only, so the SQL
  compiler refuses rather than answer almost-right; here the fold is
  JavaScript's `toLowerCase`.
- A bare word searches every stored text column. @yaks/sql's built-in SQLite
  lowering searches one `doc` index, so bare-word results agree for a vocabulary
  whose prose is in `doc`, or for a compile that registers
  [@yaks/fts](https://jsr.io/@yaks/fts), whose default field choice is the one
  used here. Word breaking and case folding are JavaScript's, so text outside
  the ASCII alphabet is where an index and this package can differ.

## Compatibility

Pure TypeScript. It imports no platform API — no `Deno` global, no Node
built-in, no DOM global — and type-checks under `lib: ["dom", "esnext"]`, so it
runs unchanged in a browser, on Deno, and on Node (via JSR or npm). Its only
dependencies are sibling packages: a @yaks/query AST, a @yaks/vocab schema, and
@yaks/sql's `Unsupported` error and column type categories.

## License

Apache-2.0
