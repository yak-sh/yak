# @yaks/match

Runs [@yaks/query](../query/README.md) queries against bundles held in memory. A
bundle is one entity's components as a JSON object. This package stores no data
itself: callers supply the array to search, and no database is opened.
`matcher()` selects from an array of bundles, including ordering and paging;
`filter()` tests a single bundle. Both read a [@yaks/vocab](../vocab/README.md)
schema to find out which component a property belongs to and what type it holds.

The same query text can be run against a database by
[@yaks/sql](../sql/README.md), which compiles it into a `SELECT`.
`parity_test.ts` runs both over identical data and asserts they return the same
rows for the supported queries covered by those tests. Differences and
unsupported queries are listed below.

## Install

```sh
deno add jsr:@yaks/match jsr:@yaks/vocab
# or: npx jsr add @yaks/match @yaks/vocab
```

## A bundle

A bundle puts identity under `entity` and each component under its own name,
with the component's properties inside. For example:

```ts
const b1 = {
  entity: { eid: 'b1', num: 3 },
  doc: { title: 'The Left Hand of Spring', body: 'a winter journey north' },
  book: { price: 12, status: 'shelved', author: 'a1' },
}
```

That is the shape [@yaks/graph](https://jsr.io/@yaks/graph) writes and
[@yaks/sqlite](https://jsr.io/@yaks/sqlite) reads back. This package declares
the shape in its own types rather than importing @yaks/graph's `Bundle`, because
@yaks/graph imports this package to compile its rules; the dependency has to run
one direction. A @yaks/graph bundle passes wherever this type is asked for.

The query reference below uses the repository's bookshop fixture in
[`harness.ts`](./harness.ts): two authors (`a1`, `a2`), four books (`b1`–`b4`),
three reviews (`r1`–`r3`), a member, a plain document and one deleted review.
Authors precede books in the array, so `b1` has entity number 3. This fixture is
not part of the package's public exports.

## matcher and filter

```ts
import { matcher } from '@yaks/match'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      type: 'object',
      properties: {
        price: { type: 'number' },
        status: { type: 'string', enum: ['draft', 'shelved', 'sold'] },
        author: { type: 'string', ref: 'entity', death: 'detach' },
      },
    },
  },
})
const b4 = {
  entity: { eid: 'b4', num: 6 },
  book: { price: 7.5, status: 'shelved', author: 'a1' },
}
const bundles = [b1, b4] // b1 is defined above

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
wants to re-check the single entity that just changed without searching the
whole array:

```ts
import { filter } from '@yaks/match'

let mine = filter('.status=shelved .author=a1', vocab)
mine(b1) // true
mine(b1, bundles) // include related entities when following references
```

`filter()` ignores `.order`, `.limit` and `.after`. Those describe a sequence,
and therefore do not affect a single-entity test.

Both functions accept a query string or an AST from `@yaks/query`, followed by
the vocabulary and an optional options object. They return complete input
bundles: `.fields`, `*` and optional-property predicates do not trim the result.

Both functions take an options object. `opts.now` is the millisecond timestamp
that relative time phrases (`today`, `1 hour ago`) resolve against; it defaults
to `Date.now()`. Pass the same value to @yaks/sql and both sides select the same
rows. `opts.computed` is described under
[Computed properties](#computed-properties).

## Operators

| query                | matches                                                   |
| -------------------- | --------------------------------------------------------- |
| `.price=12`          | the property equals the operand                           |
| `.status=draft,sold` | any of the listed values                                  |
| `.price=7.5..12`     | an inclusive range                                        |
| `.price=0...12`      | a range that excludes its upper bound                     |
| `.author=`           | the property is absent or empty                           |
| `.author!`           | the property has a value                                  |
| `.status!=sold`      | not equal, including entities with no `status` at all     |
| `.title~=spring`     | contains, case-insensitive                                |
| `.price<20`          | less than; also `<=`, `>`, `>=`                           |
| `.price?`            | a request for the property in the result; filters nothing |

An absent property never compares true under `<`, `<=`, `>` or `>=`, and `~=`
with an empty operand (`.title~=`) asks for presence rather than selecting
everything.

Number, priority and boolean properties compare numerically; every other type
compares as text. A boolean is stored as 0 or 1, so `.available=1` selects the
books in stock and `.available=true` selects nothing. An operand no stored
number could equal selects nothing rather than raising: `.price=12.0` is empty,
because a stored `12` formats back as `12`. A comparison is stricter —
`.price>cheap` is refused at compile time, because there is no number to compare
against.

### Time properties

A property the vocabulary types as a timestamp reads its operand as a time
phrase first. A phrase defines a time interval, interpreted by the operator:

- `=` — inside the span (`.released=today`)
- `>=` — from its start (`.released>=yesterday`)
- `<=` — up to its end
- `>` and `<` — strictly after, strictly before

A comma list of phrases under `=` is any-of, and under `!=` is none-of. When the
operand is not a phrase at all, the ordinary rules apply, so
`.released<2024-01-01` compares strings. The matcher expects canonical ISO 8601
timestamps whose string order is chronological. Values outside the supported
timestamp range do not match time comparisons.

### Components

`.signed!` selects the entities that have the `signed` component, and `.signed=`
the ones that do not. This works for a component with no properties at all — a
tag that records a boolean property through its presence — as well as for one
with properties.

A trailing `!` on a bare name is resolved as a component before it is resolved
as a property. In the bookshop `.book!` selects the four books (the entities
with a `book` component), while `.book=b1` still resolves to `review.book`, the
reference property of that name, and selects the two reviews of `b1`. Use the
qualified property name to avoid this ambiguity: `.review.book!` selects the
reviews that name a book.

### Kinds

A vocabulary marks some components as kinds and orders them by precedence.
`.kind=book` selects entities that have the `book` component and none of the
kinds ordered before it — that is, entities whose most specific kind is `book`.
In the bookshop the order is `book`, `member`, `doc`, `review`, so `.kind=doc`
selects the two authors and the opening-hours document but not the books, which
have a `doc` component as well. A plural folds to the singular: `.kind=books`
means `.kind=book`. A value that names no kind is refused.

### References and paths

A reference property holds another entity's id, so `.author=a1` selects that
author's books. A dotted path follows the reference and tests a property on the
entity it points at:

```
.author.doc.title~=vale   // books whose author's title contains "vale"
```

Every hop but the last must be a reference property; anything else is refused
when the query is compiled. Each step is looked up in the bundle array, and an
entity missing from it reads as absent.

For the operators only a present value can satisfy — `!`, the four comparisons,
and `=` or `~=` with a non-empty operand — the entity must also have the root
component of the path. The absent forms do not require it, so
`.author.doc.title=` selects entities with no author at all as well as books
whose author has no title: a missing entity anywhere along the path reads as an
absent value. @yaks/sql emits the same narrowing, which also lets its query
planner start from the root component's table.

### Reverse hops

A vocabulary derives a reverse association for a reference: because
`review.book` points at a book, a book can be asked about its `reviews`.

- `.reviews!` — has at least one review
- `.reviews=` — has none
- `.reviews>=2` — a count, with any of `=`, `!=`, `<`, `<=`, `>`, `>=`
- `.reviews.stars=5` — at least one review matching that predicate

A child predicate is compiled by the same clause compiler, over the child
bundle, so anything refused there refuses the whole hop. A child predicate may
not reach the identity component: inside the hop, `entity` names the child
rather than the entity being tested, so `.reviews.entity.num=7` is refused
because this form is unsupported.

### Backlinks

`.refs=b1` selects every entity holding a reference to `b1`, across every
reference property the vocabulary declares — in the bookshop, the two reviews of
that book. Only a nonempty `=` operand is supported here. The parser accepts
`.refs!` and `.refs=`, but this evaluator rejects both.

### Identity

`.eid=b1`, `.eid=b1,b2` and `.num=3` name entities rather than filter them, and
are answered as a lookup in the array. A human-readable id works in either
property: `B-3` is read as the entity numbered 3 (the prefix is ignored for
lookup), so one operand form fetches by eid, by entity number, or by the id a
person types.

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
- a reference property on the entity itself — `.fork.from->S-7` reads
  `fork.from` as this entity → the entry it names;
- a chain of reference properties composed into one pair —
  `.fork.from.session->S-1` reads this entity → the session of the entry it
  forked from.

Reachable entities are computed breadth-first and cached within each evaluation
of the supplied array. The target itself is selected only when a cycle leads
back to it. A path that is neither a relation tag nor a chain of reference
properties is refused.

### Full-text terms

A bare word in the query is a full-text term over every stored text property of
every component the entity has. This evaluator does not inspect the `search`
keyword; `@yaks/fts` indexes only properties explicitly marked `search: true`.
It matches whole words, so `fables` finds "writes fables" while `fable` finds
nothing. A trailing `*` prefix-matches the final word: `catalog*` finds "Spring
Catalogue". The parser keeps a quoted run together as one term, whose words must
then appear in that order: `"narrow kitchens"`.

A token is a run of Unicode letters and digits, lowercased. A term with no word
in it at all matches nothing, never everything.

## Ordering and paging

`.order=price` sorts ascending by that property and `.order=-price` descending.
Values sort absent first, then numbers, then text — the order SQLite's
`ORDER BY` gives over the same values — and the entity number breaks ties, so
ties are deterministic. Ascending property order puts missing values first;
descending order reverses that property order.

`.limit=n` keeps the first n results. `.after=<num>` continues past the entity
with that number, wherever it sits in the order. It is one cursor form for every
ordering, so callers need only the last entity number to request another page:

- The anchor is looked up in the whole array rather than among the matches, so
  an anchor that no longer matches the query still names a place in the order.
- An anchor with no value for the ordered property sorts as an absent value,
  with its entity number breaking ties.
- An anchor not found in the array leaves the results unchanged, as on the first
  page.

@yaks/sql uses keyset predicates for pagination, and `parity_test.ts` checks
shared cases. One difference: with no explicit ordering, SQL compares entity
numbers directly to `.after`, even if that entity is absent; this matcher
returns the first page when its anchor is absent.

With `.limit` or `.after` but no `.order`, results come back newest entity
number first. With none of the three, this matcher keeps input order while
`@yaks/sql` defaults to oldest entity number first. For a query without ordering
or pagination, compare membership rather than result order.

## Computed properties

A vocabulary can declare a property it never stores (`computed: true`), because
its formula belongs to the application rather than the schema. The caller
supplies its read function, keyed by `comp.prop`, through `opts.computed`. This
corresponds to the `derived` SQL expression hook
[@yaks/sql](https://jsr.io/@yaks/sql) takes:

```ts
// With the book vocabulary above, override reads of a stored property.
const discounted = matcher('.price<10', vocab, {
  computed: {
    'book.price': (b) => Number((b.book as { price: number }).price) / 2,
  },
})
discounted(bundles) // [b1, b4]
```

`opts.computed` maps `comp.prop` to a function of the bundle. The property's
type still comes from the vocabulary, and ordering uses the registered function
too. A registration also serves as a plain read override for a stored property.
A computed property nobody registered is refused.

## Refused queries

Unsupported query features throw
[`Unsupported`](https://jsr.io/@yaks/sql/doc/~/Unsupported), the error type also
used by @yaks/sql, with `by` set to `@yaks/match`. A caller using both therefore
has one error type to catch. Every refusal happens when the query is compiled,
before any bundle is read.

- **`.near=`** — nearest-neighbour search needs vectors, and **`.edges!`** asks
  for links to be returned alongside the result. This evaluator does not
  implement either directive. Walks are supported using the supplied entities;
  see above.
- **`.count!`, `.distinct=`, `.tally=`** — these return aggregate rows rather
  than entities. Count what comes back instead.
- **A computed property nobody registered** — no function was supplied to
  calculate it. Register it through `opts.computed` and it is answered;
  @yaks/sql refuses the same property for the same reason when its `derived`
  hook has no entry.
- **`.refs!` and `.refs=`** — only `.refs=<id>` is a question about backlinks.
- **A predicate the property's type cannot answer** (`.price>cheap`), **a path
  whose root is not a reference property**, and **a reverse hop that is neither
  a count nor a child filter**.

The evaluators also differ in their text behavior:

- `~=` with a non-ASCII operand. SQLite's `lower()` folds ASCII only, so the SQL
  compiler rejects this operand; here case conversion uses JavaScript's
  `toLowerCase`.
- This evaluator can search stored text without a registered extension.
  `@yaks/sql` requires a text extension such as [@yaks/fts](../fts/README.md).
  FTS searches only selected properties, normally those marked `search: true`,
  and treats an unquoted word as a prefix. This evaluator searches every stored
  scalar text property and requires an explicit trailing `*` for prefix
  matching. Even with identical fields, tokenization and Unicode case handling
  can differ. Use the database search when exact agreement with its index is
  required.

## Exports

The root module exports `matcher`, `filter`, their function and options types,
`Bundle`, `Eid`, `Computed`, and `live()` to test whether an entity is deleted.
It also exports the lower-level value helpers `check`, `cmp`, `contains`, `eq`,
`ne`, `time`, `EXISTS`, and `Check`; the text helpers `search` and `tokens`; and
`Unsupported`.

## Compatibility

Pure TypeScript. It imports no platform API — no `Deno` global, no Node
built-in, no DOM global — and type-checks under `lib: ["dom", "esnext"]`, so it
runs unchanged in a browser, on Deno, and on Node (via JSR or npm). Its only
dependencies are sibling packages: a @yaks/query AST, a @yaks/vocab schema, and
@yaks/sql's `Unsupported` error and property type categories.

## License

Apache-2.0
