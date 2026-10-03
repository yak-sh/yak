# @yaks/match

Runs [queries](../query/README.md#query-model) against
[bundles](../graph/README.md#data-model) held in memory, without SQL or a
database. It selects bundles, tests individual bundles, produces projected or
aggregate rows, and routes changed bundles to the queries they match.

A **source** is the data an evaluation can read (`Source`): an array of bundles
or an Index. An **Index** is a bundle lookup (`Index`) with a complete `list`
and `of(eid)`; optional `wearing`, `keyed` and `ranged` methods narrow reads,
and `gone` answers removal clauses. A **selection** is a compiled function from
a source to matching bundles (`Select`), including the query's ordering and
paging. A **filter** is a compiled function that tests one bundle (`Filter`),
with an optional source for questions about other entities.

All evaluators use a [vocabulary](../vocab/README.md#vocabulary) to resolve
component names and property types. They accept query text or an
[AST](../query/README.md#query-model). [@yaks/sql](../sql/README.md) compiles
queries into SQL; [@yaks/sqlite](../sqlite/README.md) executes that SQL; the
limits below describe where the answers differ.

## Install

```sh
deno add jsr:@yaks/match jsr:@yaks/vocab
# or: npx jsr add @yaks/match @yaks/vocab
```

## matcher and filter

```ts
import { filter, matcher } from '@yaks/match'
import { equal } from '@yaks/testing'
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
const b1 = {
  entity: { eid: 'b1', num: 3 },
  book: { price: 12, status: 'shelved', author: 'a1' },
}
const b4 = {
  entity: { eid: 'b4', num: 6 },
  book: { price: 7.5, status: 'shelved', author: 'a1' },
}
const bundles = [b1, b4]

let cheap = matcher(
  '.book.status=shelved .book.price<20 .order=-book.price',
  vocab,
)
equal(cheap(bundles), [b1, b4])

// A single bundle, tested alone or with the entities its references reach:
let mine = filter('.book.status=shelved .book.author=a1', vocab)
equal(mine(b1), true)
equal(mine(b1, bundles), true)

// A read override, here for a stored property:
const discounted = matcher('.book.price<10', vocab, {
  computed: {
    'book.price': (b) => Number((b.book as { price: number }).price) / 2,
  },
})
equal(discounted(bundles), [b1, b4])
```

Whitespace and `&` both separate clauses, so the query above can also be written
`.book.status=shelved&.book.price<20&.order=-book.price`.

The array you pass in is all the data the run can see. Following a reference to
its target, finding the backlinks of an id, listing the children of a reverse
hop: each is a lookup in that array, and an entity missing from it reads as
absent — the same answer a missing database row gives. Deleted entities are
skipped: a bundle with a `tombstone` component, or one carrying the `$delete`
marker.

`filter()` compiles the same query into a test on one bundle, for a caller that
wants to re-check the single entity that just changed without searching the
whole array. Pass a source as its second argument when the query follows
references or reads reverse associations or backlinks.

`filter()` ignores `.order`, `.limit` and `.after`. Those describe a sequence,
and therefore do not affect a single-entity test.

`matcher()` returns complete input bundles: `.fields`, `*` and optional-property
predicates do not trim the result.

## Exports

| Export                                                            | Purpose                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| `matcher`, `filter`, `rows`                                       | Compile selections, filters, projections and aggregates |
| `Query`, `Source`, `Select`, `Filter`, `Row`, `MatchOpts`         | Evaluation types and options                            |
| `index`, `Index`, `keyOf`                                         | Bundle lookup and value keys                            |
| `Bundle`, `Eid`, `Computed`, `live`, `statusOf`                   | Bundle types, reads and deletion checks                 |
| `net`, `Net`, `NetOpts`                                           | Route changed bundles to held queries                   |
| `check`, `Check`, `EXISTS`, `cmp`, `eq`, `ne`, `contains`, `time` | Tests over individual property values                   |
| `search`, `tokens`                                                | Tests over text and tokenization                        |
| `Unsupported`                                                     | Query refusal shared with @yaks/sql                     |

## Compilation and Index reads

A query compiles once, the way a regular expression does: `@yaks/query` returns
the same tree for the same text, and the compiled test is kept against that
tree, the vocabulary and the `computed` rules. A query whose answer depends on
when it is asked (`.book.released=today`) is compiled again for each moment.

A compiled query also knows the sets its matches must lie inside: the entities
wearing a component it requires, the entities whose text, enum or reference
property equals a value it names, the entities whose number lies between the
bounds a comparison or range sets, or the ids it lists. Optional
`wearing(comp)`, `keyed(comp, prop, key)` (a value's key is `keyOf`) and
`ranged(comp, prop, lo, hi)` methods supply these sets through an Index. The run
then reads the smallest of those sets instead of every bundle, and still tests
each candidate, so the Index decides how much is read and never what matches.
[@yaks/ram](../ram/README.md) is such a caller. Without an ordering, the order
of the result is the order the source yields.

Both functions take an options object. `opts.now` is the millisecond timestamp
that relative time phrases (`today`, `1 hour ago`) resolve against; it defaults
to `Date.now()`. Pass the same value to @yaks/sql to resolve time phrases
against the same moment. `opts.computed` is described under
[Computed properties](#computed-properties).

`index()` supplies `list` and a lazy eid lookup. Optional `wearing`, `keyed` and
`ranged` methods let a caller provide smaller candidate sets. `gone` supplies
the eids from which a pending batch removed a component.

```ts
import { index, keyOf, live, matcher } from '@yaks/match'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab({ $defs: { signed: { component: true } } })
const b1 = { entity: { eid: 'b1' }, signed: {} }
const b2 = { entity: { eid: 'b2' } }
const source = index([b1, b2])
equal(source.of('b1'), b1)
equal(matcher('.signed', vocab)(source), [b1])
equal(keyOf(true), '1')
equal(keyOf(null), undefined)
equal(live({ ...b1, tombstone: {} }), false)
equal(live({ ...b1, $delete: true }), false)
equal(
  matcher('-signed', vocab)({
    ...source,
    gone: () => new Set(['b2']),
  }),
  [b2],
)
```

## Operators

| query                     | matches                                                   |
| ------------------------- | --------------------------------------------------------- |
| `.book.price=12`          | the property equals the operand                           |
| `.book.status=draft,sold` | any of the listed values                                  |
| `.book.price=7.5..12`     | an inclusive range                                        |
| `.book.price=0...12`      | a range that excludes its upper bound                     |
| `!book.author`            | the property is absent or empty                           |
| `.book.author`            | the property has a value                                  |
| `.book.status!=sold`      | not equal, including entities with no `status` at all     |
| `.doc.title~=spring`      | contains, case-insensitive                                |
| `.book.price<20`          | less than; also `<=`, `>`, `>=`                           |
| `?book.price`             | a request for the property in the result; filters nothing |

An absent property never compares true under `<`, `<=`, `>` or `>=`, and `~=`
with an empty operand (`.doc.title~=`) asks for presence rather than selecting
everything.

Number, priority and boolean properties compare numerically; every other type
compares as text. A boolean is stored as 0 or 1, and `true` and `false` name
those, so `.book.available=true` and `.book.available=1` both select the books
in stock. An operand no stored number could equal selects nothing rather than
raising: `.book.price=12.0` is empty, because a stored `12` formats back as
`12`. A comparison is stricter — `.book.price>cheap` is refused at compile time,
because there is no number to compare against.

### Time properties

A property the vocabulary types as a timestamp reads its operand as a time
phrase first. A phrase names a moment or a stretch of time, and the operator
compares with it (`timeEdges` in @yaks/query):

- A moment (`now`, `1-hour-ago`, `in-5m`) compares as itself: `>1-hour-ago` is
  later than an hour ago, and `<=in-5m` is no later than five minutes from now.
- A stretch (`today`, `last week`, `9am`, `2024-06-15`) compares as a whole:
  `>=` from its start, `>` after its end, `<` before its start, `<=` before its
  end.
- `=` selects the stretch, or for a moment the time between now and it:
  `.book.released=today`, and `.book.released=10-minutes-ago` for the last ten
  minutes.
- `lo..hi` runs from `lo` through `hi`, and `lo...hi` stops before `hi`:
  `.book.released=yesterday..today`.

A comma list of phrases under `=` is any-of, and under `!=` is none-of. When the
operand is not a time phrase, the ordinary value rules apply. The matcher
expects canonical ISO 8601 timestamps whose string order is chronological.
Values outside the supported timestamp range do not match time comparisons.

### Components

`.signed` selects the entities that have the `signed` component, and `!signed`
the ones that do not. This works for a component with no properties at all — a
tag that records a boolean property through its presence — as well as for one
with properties.

A bare presence test names a component; a property presence test names its
component and property. A property named alone is refused, and the message names
each component that declares it: `.price` answers
`.price is a property, not a component — name it
.book.price`.

### Kinds

A vocabulary marks some components as [kinds](../vocab/README.md#vocabulary) and
orders them by precedence. `.kind=book` selects entities that have the `book`
component and none of the kinds ordered before it — that is, entities whose most
specific kind is `book`. A plural folds to the singular: `.kind=books` means
`.kind=book`. A value that names no kind is refused.

### References and paths

A [reference](../vocab/README.md#vocabulary) can be tested directly, so
`.book.author=a1` selects that author's books. A
[path](../query/README.md#query-model) follows the reference and tests a
property on the entity it points at:

```
.book.author.doc.title~=vale   // books whose author's title contains "vale"
```

Every hop but the last must be a reference property; anything else is refused
when the query is compiled. Each step is looked up in the bundle array, and an
entity missing from it reads as absent.

For presence tests, the four comparisons, and `=` or `~=` with a non-empty
operand, the entity must also have the root component of the path. The absent
forms do not require it, so `!book.author.doc.title` selects entities with no
author at all as well as books whose author has no title: a missing entity
anywhere along the path reads as an absent value. @yaks/sql emits the same
narrowing, which also lets its query planner start from the root component's
table.

### Reverse hops

A vocabulary derives a
[reverse association](../vocab/README.md#routing-and-references): because
`review.book` points at a book, a book can be asked about its `reviews`.

- `.reviews` — has at least one review
- `!reviews` — has none
- `.reviews>=2` — a count, with any of `=`, `!=`, `<`, `<=`, `>`, `>=`
- `.reviews.review.stars=5` — at least one review matching that predicate

A child predicate is compiled by the same clause compiler, over the child
bundle, so anything refused there refuses the whole hop. A child predicate may
not reach the identity component: inside the hop, `entity` names the child
rather than the entity being tested, so `.reviews.entity.num=7` is refused
because this form is unsupported.

### Backlinks

`.refs=b1` selects every entity holding a reference to `b1`, across every
reference property the vocabulary declares. The source must also contain `b1`.
Only a nonempty `=` operand is supported here. The parser accepts `.refs` and
`!refs`, but this evaluator rejects both.

### Identity

`.entity.eid=b1`, `.entity.eid=b1,b2` and `.entity.num=3` name entities rather
than filter them, and are answered as a lookup in the array. A human-readable id
works in either property: `B-3` is read as the entity numbered 3 (the prefix is
ignored for lookup), so one operand form fetches by eid, by entity number, or by
the id a person types.

### Walks

A [walk](../query/README.md#walks-and-qualifiers) selects by reachability.
`.book.author->a1` selects the entities that reach `a1` by following `author`
references. `<-` reverses the direction, selecting the entities the target
reaches. A bracket caps the hops: `.cites[<=3]->p1` allows at most three.
Without a bracket the closure is unbounded, capped at @yaks/query's `WALK_LIMIT`
rows.

One hop is a `(from, to)` pair, and a bundle can state one in three ways:

- an edge entity — a bundle carrying [@yaks/edge](../edge/README.md)'s
  `edge{from, to}` component alongside the relation's tag component
  (`cites {}`);
- a reference property on the entity itself — `.fork.from->S-7` reads
  `fork.from` as this entity → the entry it names;
- a chain of reference properties composed into one pair —
  `.fork.from.entry.session->S-1` reads this entity → the session of the entry
  it forked from.

Reachable entities are computed breadth-first and cached within each evaluation
of the supplied array. The target itself is selected only when a cycle leads
back to it. A path that is neither a relation tag nor a chain of reference
properties is refused.

### Text terms

A [text term](../query/README.md#predicates-and-text) searches over every stored
text property of every component the entity has. This evaluator does not inspect
the `search` keyword; [@yaks/fts](../fts/README.md) controls which properties
its database index searches. It matches whole words, so `fables` finds "writes
fables" while `fable` finds nothing. A trailing `*` prefix-matches the final
word: `catalog*` finds "Spring Catalogue". The parser keeps a quoted run
together as one text term, whose words must then appear in that order:
`"narrow kitchens"`.

A **token** is a run of Unicode letters and digits, lowercased (`tokens`). A
text term with no token in it at all matches nothing, never everything.

### Evaluate predicates, references and text

This complete bookshop example checks predicates, kinds, reference paths,
reverse associations, backlinks, walks, text terms and time comparisons. The
source must contain the referenced entities.

```ts
import { matcher } from '@yaks/match'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab({
  $defs: {
    doc: {
      component: true,
      kind: true,
      properties: {
        title: { type: 'string' },
      },
    },
    book: {
      component: true,
      kind: true,
      before: ['doc'],
      properties: {
        price: { type: 'number' },
        available: { type: 'boolean' },
        author: { type: 'string', ref: 'entity' },
        released: { type: 'string', format: 'date-time' },
      },
    },
    review: {
      component: true,
      properties: {
        book: { type: 'string', ref: 'book' },
        stars: { type: 'number' },
      },
    },
    signed: { component: true },
  },
})
const author = { entity: { eid: 'a1' }, doc: { title: 'Ursula Vale' } }
const b1 = {
  entity: { eid: 'b1', num: 3 },
  doc: { title: 'Spring Catalogue' },
  book: {
    price: 12,
    author: 'a1',
    available: true,
    released: '2024-06-15T09:00:00.000Z',
  },
  signed: {},
}
const b2 = { entity: { eid: 'b2' }, book: { price: 30 } }
const review = { entity: { eid: 'r1' }, review: { book: 'b1', stars: 5 } }
const source = [author, b1, b2, review]
const select = (q: string) =>
  matcher(q, vocab, {
    now: Date.parse('2024-06-15T12:00:00.000Z'),
  })(source).map((b) => b.entity.eid)
for (
  const q of [
    '.book.price=10..20',
    '.book.price=10...30',
    '.book.available=true',
    '.signed',
    '.book !book.author',
    '.entity.eid=B-3',
    '.book.author.doc.title~=vale',
    '.reviews>=1',
    '.reviews.review.stars=5',
    '.book.author->a1',
    'catalog*',
    '"spring catalogue"',
    '.book.released=today',
  ]
) {
  equal(select(q), q == '.book !book.author' ? ['b2'] : ['b1'])
}
equal(select('.kind=books'), ['b1', 'b2'])
equal(select('.kind=doc'), ['a1'])
equal(select('.refs=b1'), ['r1'])
equal(select('.book.price<20|.review'), ['b1', 'r1'])
```

## Ordering and paging

`.order=book.price` sorts ascending by that property and `.order=-book.price`
descending. The property may be one a chain of references reaches, as in a path
predicate: `.order=review.book.book.price` orders reviews by their book's price,
and `rows()` projects `.fields=review.book.doc.title` the same way. Values sort
absent first, then numbers, then text — the order SQLite's `ORDER BY` gives over
the same values — and the entity number breaks ties, so ties are deterministic.
Ascending property order puts missing values first; descending order reverses
that property order.

`.limit=n` keeps the first n results, and `.limit=0` keeps none. An aggregate in
`rows()` ignores `.order`, `.limit` and `.after` and counts every match, as
@yaks/sql does. `.after=<id>` continues past the entity with that number or eid,
wherever it sits in the order. It is one cursor form for every ordering, so
callers need only the last entity's number or eid to request another page:

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
number first; unnumbered entities keep reverse input order. With none of the
three, this matcher keeps input order while `@yaks/sql` defaults to oldest
entity number first. For a query without ordering or pagination, compare
membership rather than result order.

```ts
import { matcher, rows } from '@yaks/match'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab({
  $defs: {
    book: {
      component: true,
      properties: {
        price: { type: 'number' },
        status: { type: 'string' },
      },
    },
  },
})
const b1 = {
  entity: { eid: 'b1', num: 1 },
  book: { price: 12, status: 'sold' },
}
const b2 = { entity: { eid: 'b2', num: 2 }, book: { price: 7, status: 'sold' } }
const source = [b1, b2]
equal(matcher('.book .order=book.price .limit=1', vocab)(source), [b2])
equal(matcher('.book .order=book.price .after=b2', vocab)(source), [b1])
equal(matcher('.book .limit=1', vocab)(source), [b2])
equal(rows('.book .fields=book.price .order=book.price', vocab)(source), [
  { eid: 'b2', 'book.price': 7 },
  { eid: 'b1', 'book.price': 12 },
])
equal(rows('.book .count .limit=1', vocab)(source), [{ value: '', n: 2 }])
equal(rows('.book .tally=book.status', vocab)(source), [{
  value: 'sold',
  n: 2,
}])
equal(rows('.book .distinct=book.status', vocab)(source), [{ value: 'sold' }])
```

`rows()` returns the same [row shapes](../sql/README.md) as @yaks/sql. A
projection retains the eid and keys each requested value by its written path;
aggregates return `value` and, for counts and tallies, `n`.

## Computed properties

A vocabulary can declare a property it never stores (`computed: true`). A
**Computed** registry maps `comp.prop` to a function that reads that property
from a bundle and an Index. Supply it through `opts.computed`; this corresponds
to [@yaks/sql's `derived` hook](../sql/README.md). The property's type still
comes from the vocabulary, and ordering uses the registered function too. A
registration also overrides reads of a stored property, as `book.price` does in
the first example. A computed property nobody registered is refused.

A [ladder](../vocab/README.md#kinds-and-status) needs no registration. A
component whose vocabulary declares `status` ([@yaks/vocab](../vocab/README.md))
has its computed `status` read from that declaration, as @yaks/sql reads it, and
`statusOf(vocab, comp, bundle)` reads it off one entity in hand: the first rung
the entity wears, else the status the bundle carries (what a store read with its
whole ladder), else the default.

```ts
import { matcher, statusOf } from '@yaks/match'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab({
  $defs: {
    job: {
      component: true,
      status: { failed: 'failed', default: 'pending' },
      properties: { cost: { type: 'number', computed: true } },
    },
    failed: { component: true },
  },
})
const job = { entity: { eid: 'j1' }, job: {} }
equal(statusOf(vocab, 'job', job), 'pending')
equal(statusOf(vocab, 'job', { ...job, failed: {} }), 'failed')
equal(
  matcher('.job.cost<20', vocab, {
    computed: { 'job.cost': () => 12 },
  })([job]),
  [job],
)
equal(matcher('.job.status=pending', vocab)([job]), [job])
```

## Query routing

A **network** holds queries under caller-chosen keys (`Net<K>`), shares their
compiled clause tests, and routes a changed bundle to the queries it matches.
`add` can seed the eids a query already holds. `route` tests without changing
that membership; `move` records membership and returns `into` (all matches) and
`out` (previous matches that ceased to match). `forget` removes one eid's
membership, and `drop` removes a query.

A network accepts queries about one entity alone. `add` returns `false` for
queries requiring other entities, ordering, paging or aggregates, or for a query
it cannot compile; the caller must evaluate those queries separately. Adding
under an existing key drops its previous query even when refused.

```ts
import { net } from '@yaks/match'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab({
  $defs: {
    health: { component: true, properties: { hp: { type: 'number' } } },
  },
})
const watching = net<string>(vocab)
const creature = { entity: { eid: 'c1' }, health: { hp: 3 } }
equal(watching.add('alive', '.health.hp>0'), true)
equal(watching.add('page', '.health .limit=2'), false)
equal(watching.route(creature), ['alive'])
equal(watching.move(creature), { into: ['alive'], out: [] })
equal(watching.move({ ...creature, health: { hp: 0 } }), {
  into: [],
  out: ['alive'],
})
watching.move(creature)
equal(watching.forget('c1'), ['alive'])
watching.drop('alive')
equal(watching.route(creature), [])
```

## Value and text helpers

A **Check** tests one property's value, with `null` for absence. `check` takes
the internal operator names: `''` for equals, `!` for not-equals, `~` for
contains, the comparison operators unchanged, and `EXISTS` for presence. The
type tag uses [@yaks/sql's property categories](../sql/README.md). A helper
returns `null` when it cannot express the requested test.

```ts
import {
  check,
  cmp,
  contains,
  eq,
  EXISTS,
  ne,
  search,
  time,
  tokens,
} from '@yaks/match'
import { equal } from '@yaks/testing'

const now = Date.parse('2024-06-15T12:00:00.000Z')
equal(check(EXISTS, '', 'text', now)!(null), false)
equal(cmp('<', '20', 'number')!(12), true)
equal(cmp('<', 'cheap', 'number'), null)
equal(eq('7..12', 'number')!(12), true)
equal(ne('sold', 'text')!(null), true)
equal(contains('SPRING')('Spring Catalogue'), true)
equal(time('', 'today', now)!('2024-06-15T09:00:00.000Z'), true)
equal(tokens('Spring, CATALOGUE!'), ['spring', 'catalogue'])
equal(search('spring cat*')!('Spring Catalogue'), true)
equal(search('cat')!('Catalogue'), false)
equal(search('!!!'), null)
```

## Refused queries

Unsupported query features throw
[`Unsupported`](https://jsr.io/@yaks/sql/doc/~/Unsupported), the error type also
used by @yaks/sql, with `by` set to `@yaks/match`. A caller using both therefore
has one error type to catch. Every refusal happens when the query is compiled,
before any bundle is read.

- **`.near=`** — nearest-neighbour search needs vectors, and **`.edges`** asks
  for links to be returned alongside the result. This evaluator does not
  implement either directive. Walks are supported using the supplied entities;
  see above.
- **`.count`, `.distinct=`, `.tally=` in `matcher()` or `filter()`** — these
  return aggregate rows rather than entities; `rows()` answers them. As in
  @yaks/sql (`tallied`), `.distinct` and `.tally` count a number as the number
  it is and a text, enum or eid property as its text, and refuse the rest.
- **A computed property nobody registered** — no function was supplied to
  calculate it. Register it through `opts.computed` and it is answered;
  @yaks/sql refuses the same property for the same reason when its `derived`
  hook has no entry.
- **`.refs` and `!refs`** — only `.refs=<id>` is a question about backlinks.

A removal (`-comp`) is not refused: it asks what a pending batch took off, which
an `Index` answers through its `gone` member (@yaks/ram's rules supply it). A
source without one holds no pending batch, and the clause matches nothing, as
@yaks/sql answers it with no batch under the statement.

- **A predicate the property's type cannot answer** (`.book.price>cheap`), **a
  path whose root is not a reference property**, and **a reverse hop that is
  neither a count nor a child filter**.

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

A caller can identify a refusal by its shared error type and `by` value:

```ts
import { matcher, Unsupported } from '@yaks/match'
import { equal } from '@yaks/testing'
import { loadVocab } from '@yaks/vocab'

const vocab = loadVocab({ $defs: { book: { component: true } } })
let refused = false
try {
  matcher('.book .count', vocab)
} catch (error) {
  refused = error instanceof Unsupported && error.by == '@yaks/match'
}
equal(refused, true)
```

## Compatibility

Pure TypeScript. It imports no platform API — no `Deno` global, no Node
built-in, no DOM global — and type-checks under `lib: ["dom", "esnext"]`, so it
runs unchanged in a browser, on Deno, and on Node (via JSR or npm). Its only
dependencies are sibling packages: a @yaks/query AST, a @yaks/vocab schema, and
@yaks/sql's `Unsupported` error and property type categories.

## License

Apache-2.0
