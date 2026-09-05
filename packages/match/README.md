# @yaks/match

Evaluate a [@yaks/query](https://jsr.io/@yaks/query) AST as a predicate over
entity **bundles held in memory**. No database, no SQL: the same query line a
server answers from storage, answered from an array.

A query is one grammar with two evaluators. Where the data lives in a database,
[@yaks/sql](https://jsr.io/@yaks/sql) compiles the query into a statement. Where
the data is already in hand — a page's local state, a cache, a worker's working
set, a test fixture — there is nothing to compile against, so this package
evaluates the same AST directly. A filter written once selects the same entities
on both sides; that agreement is tested query by query against a real SQLite
database (`parity_test.ts`).

## Install

```sh
deno add jsr:@yaks/match
# or: npx jsr add @yaks/match
```

## Use

```ts
import { matcher } from '@yaks/match'

let live = matcher('.status=live&.price<20&.order=-price', vocab)
live(bundles) // the matching bundles, dearest first
```

A **bundle** is one entity, whole: its identity under `entity`, every component
it wears under that component's name — the shape
[@yaks/graph](https://jsr.io/@yaks/graph) defines and
[@yaks/sqlite](https://jsr.io/@yaks/sqlite) reads back.

```ts
{ entity: { eid: 'b1', num: 3 },
  doc: { title: 'The Left Hand of Spring' },
  book: { price: 12, status: 'shelved', author: 'a1' } }
```

`matcher(query, vocab, opts?)` compiles a query into a selection over a bundle
**set**. The set is the whole world for that run: a reference followed to its
target, the backlinks of an id, and the children of a reverse hop are all
answered from it, and an entity it does not hold reads as absent — the same
answer a missing row gives. Deleted entities (a `tombstone` component, or
`$delete`) are excluded, the way a database excludes its graves.

`filter(query, vocab, opts?)` compiles the same query into a per-bundle test,
for a caller re-checking the one bundle that just changed rather than sweeping
the set:

```ts
import { filter } from '@yaks/match'

let mine = filter('.status=live&.author=a1', vocab)
mine(bundle) // does this one belong?
mine(bundle, everything) // …judged against a set, for references and hops
```

`opts.now` fixes the moment relative time phrases (`today`, `1 hour ago`)
resolve against — pass the same value a compiled query is given and both sides
answer alike.

## Computed columns

A column a vocabulary declares but never stores (`persist: false`) has no value
in a bundle to read: its formula belongs to the application, not the schema. So
this package takes it the way [@yaks/sql](https://jsr.io/@yaks/sql) takes its
`derived` hook — from the caller, keyed `comp.prop`:

```ts
import { compute, derived } from '@yaks/task'

// one rule, two evaluators
matcher('.status=open', vocab, { computed: compute() }) // in memory
compile(ast, vocab, { derived: derived() }) // in a database
```

`opts.computed` maps `comp.prop` to a function of the bundle. The column's TYPE
still comes from the vocabulary — it declares the column, the registration only
says how to read it — and ordering by a computed column works the same way. A
registration also serves as a plain read override for a stored column. A
computed column nobody registered still declines (below).

## The grammar it answers

Everything on @yaks/sql's common path:

- `.p=v` equals · `.p=a,b,c` any-of · `.p=1..5` inclusive range, `1...5`
  exclusive end · `.p=` absent · `.p!` present · `.p!=v` not · `.p~=v` contains
  (case-insensitive) · `.p<v .p<=v .p>v .p>=v` comparisons · `.p?` want (a
  projection request, never a filter).
- A number column compares numerically, everything else as text; a boolean is
  read as it is stored (0/1); an operand no number can equal selects nothing.
- **Time**: a time-typed column reads its operand as a phrase first — a phrase
  names a span and the operator picks its edge (`=` within, `>=` from the start,
  `<=` until the end, `>` and `<` strictly outside) — and falls back to the
  plain rules when the operand is no phrase.
- **Kinds**: `.kind=book` — the entity wears that kind and every kind sorting
  before it is absent.
- **Facets**: `.review!` wears the component, `.review=` does not — including a
  TAG, a component with no columns at all, where wearing it is the whole fact. A
  bare bang completes a component sentence, so it wins over a column of the same
  name (`.book!` is the books; `.book=b1` is still review's reference, and
  `.review.book!` reaches that column).
- **References**: `.author=a1`, and dereference paths through them,
  `.book.author.doc.title~=vale`.
- **Reverse hops**: `.reviews!` has one, `.reviews=` has none, `.reviews>=5` a
  count, `.reviews.stars=5` an existential over a filtered child.
- **Backlinks**: `.refs=<id>` — every entity holding a reference to that one.
- **Identity**: `.eid=a1`, `.eid=a1,b2`, `.num=3` — naming entities rather than
  filtering them, answered as a set lookup. A human id names one too (`B-7` is
  the entity numbered 7).
- **Bare words**: a full-text term over every stored text or body column, by
  whole word (so `cat` does not find "catalogue"); a trailing `*`
  prefix-matches, and quoting glues a phrase.
- **Ordering and windows**: `.order=field`, `-field` descending, `.limit=n`,
  `.after=num`.

## Ordering and paging

`.order=` sorts by a column, absent values first, then numbers, then text — the
order a SQL `ORDER BY` gives over the same values — and the entity number breaks
its ties, so the order is total.

A `.limit`/`.after` window pages **within** that order: a window says how much
of a sequence to answer with, never which sequence. With no `.order=` the
sequence is newest-first by entity number, as it always was.

`.after=<num>` names the entity to continue past — one cursor spelling however
the answer is ordered, so a caller pages without ever learning the order key.
The anchor is looked up in the whole set, not the hits, so an anchor that no
longer matches the query still names a place in the order; an anchor with no
value for the ordered column pages by its number alone; and an anchor no entity
in the set has leaves the page whole, which is the first page. @yaks/sql
compiles the same rule as a keyset, and `parity_test.ts` pins the agreement.

With no ordering directive the bundles come back in the order they were given. A
database leaves that order to its query plan, so **membership** is what the two
evaluators promise there, and order is promised for the queries that ask for
one.

## Declines

A question this package cannot answer **exactly** throws
[`Unsupported`](https://jsr.io/@yaks/sql/doc/~/Unsupported) — the same error
@yaks/sql throws (its `by` field names which package refused), so a caller with
both has one decline contract and one `catch`. Every decline happens when the
query is compiled, before a bundle is read:

- **`.near`** — nearest-neighbour needs vectors; **`.edges!`** and `.reaches`
  need a stored link table. None of that rides in a bundle.
- **`.count!`, `.distinct=`, `.tally=`** — an aggregate is a row shape, not a
  selection of entities. Count what comes back instead.
- **A computed column** (`persist: false` in the vocabulary) **nobody
  registered** — no bundle holds its value and no rule was handed in for it.
  Register it through `opts.computed` (above) and it answers; @yaks/sql declines
  the same column for the same reason when its `derived` hook has no entry.
- **`.refs!` / `.refs=`** (presence and absence) — only `.refs=<id>` is a
  question about backlinks.
- **A predicate the column's type cannot answer** — `.price>cheap`, a comparison
  against a number the column cannot hold — and **a path whose root is not a
  reference**, and **a reverse hop** that is neither a count nor a child filter.

Two places where it deliberately answers MORE than @yaks/sql, both because a
JavaScript evaluator can and SQLite cannot:

- `~=` with a non-ASCII needle. SQLite's `lower()` folds ASCII only, so the SQL
  compiler refuses rather than answer almost-right; here the fold is
  JavaScript's own.
- A bare word searches every stored text column. @yaks/sql's built-in SQLite
  lowering searches one `doc` index, so bare-word parity holds for a vocabulary
  whose prose lives in `doc`, or for a compile that registers
  [@yaks/fts](https://jsr.io/@yaks/fts) (whose default field choice is the one
  used here). Word breaking and case folding are JavaScript's; text outside the
  ASCII alphabet is where an index and this package can part.

## Compatibility

Pure TypeScript. It imports no platform API — no `Deno`, no Node built-in, no
DOM global — and type-checks under `lib: ["dom", "esnext"]`, so it runs
unchanged in a **browser**, on **Deno**, and on **Node** (via JSR / npm). Its
only dependencies are the sibling packages: a `@yaks/query` AST, a `@yaks/vocab`
schema, `@yaks/graph`'s bundle types, and `@yaks/sql`'s `Unsupported` and column
type categories.

## License

Apache-2.0
