# One entity, two apps

Two of the person's apps can write about the same thing without either one
copying the other. This page is how: which app a component lives in, what a
deploy answers when a word already has a home, what happens across spaces, how a
page reads a sibling app, and how `graph_query` composes one bundle out of
several stores.

## The eid is the thing

An eid is a uuid the CLIENT mints, and it means the same entity in every store
on the platform. Nothing registers it, nothing hands it out, nothing has to
agree. A reading list saves the book; a lending app, on the same eid, saves who
has it. They are one entity wearing two components, one per store — no copy, no
sync, nothing to keep in step.

    let piranesi = crypto.randomUUID()

    graph_apply { app: 'reading-list', entities: [
      { entity: { eid: piranesi }, doc: { title: 'Piranesi' },
        book: { pages: 245 } } ] }

    graph_apply { app: 'lending', entities: [
      { entity: { eid: piranesi }, loan: { to: 'Maya' } } ] }

`num` is the other half of an address and is NOT shared: it is one store's own
counter, so the same entity is `#3` in one app and `#17` in another. Address
things by eid across apps, and by num only inside one.

## Which app a component lives in

A component lives with the app that DECLARES it, so nothing has to be
negotiated. `book` is the reading list's word wherever it is written; `loan` is
the lending app's. A write is split by component and each part is sent to the
app that owns that word.

The platform's shared words — `doc`, `comment`, `task`, `image`, `archived` —
belong to no app, so they go, in this order:

1. the app you named, if you named one;
2. the app where that entity already wears the word;
3. the app whose OWN word is in the same bundle — a title beside a recipe is the
   recipe's title, which is what makes writing a new entity one call.

When none of those decides it, the write is refused rather than guessed:

    which app should doc go in? name one with app — reading-list, lending

Every part is admitted in its own store BEFORE any of them commits, so a refusal
in one leaves the others unwritten. A `$alias` is minted once, at the door, so a
bundle landing in two stores lands under one eid.

    graph_apply { entities: [
      { entity: { eid: piranesi },
        doc: { title: 'Piranesi (2020)' },   → reading-list, where it lives
        loan: { to: 'Bo' } } ] }             → lending, whose word it is

## One word, one home

Declare `book` in a second app of the same space and nothing is planted twice.
The first app in the space to declare a word is its HOME; a later manifest
naming it is a USE, not a second declaration. The deploy says so:

    book lives in reading-list; this app reads and writes it there
    components: loan

`book` is missing from `components:` on purpose — the lending app homes only
`loan`. Its store never plants a `book` table, so asking that store for one is a
refusal, and the rows are all in one place:

    graph_query { app: 'lending', filter: '.book!' }
    → unknown prop: .book

    graph_query { app: 'reading-list', filter: '.book!' }
    → both books, however they were written

A column the borrower adds grows the HOME's table, additively, and is then
writable from either app:

    lending/vocab.json: { "book": { "title": "text", "isbn": "text" },
                          "loan": { "to": "text" } }
    → added: book.isbn

**From the agent tier and from an app's own tools, a borrowed word just works**:
`graph_apply { app: 'lending', entities: [{ book: … }] }` lands in the reading
list's store, and a `tools.json` entry of the lending app may name `book` in its
`apply` or its `query`. **From a PAGE it does not**: `./api/apply` and
`./api/query` are this app's own doors onto this app's own store, so a page that
writes a borrowed word gets `unknown component: book`. Reach the home app by its
address instead — `store('/reading-list/api/')`, below.

## The one refusal: a shape conflict

Declaring a word another app homes is refused for exactly one reason — the same
column with two types. The rows already written under the home's type are the
record of what that column is, and no manifest may rewrite them.

    vocab.json: book.pages is text here and number in reading-list,
      where book lives — a column keeps the type its rows were written under

The whole manifest is read before anything is planted, so that deploy moves
nothing at all: not the home's column, not this app's own words, not its files.

## Across spaces, a word means what its space says

Within one space a word has one home. Across spaces there is no home to share,
so the same name may be two vocabularies — and the answer says which.

**Where the shapes agree**, the name is one word and the bundle is one. A column
only one side declares agrees by construction, since a vocabulary only ever
grows.

**Where they disagree** — `note.body` is `text` in one space and `number` in
another — the rows stay apart. The same eid comes back as two bundles, each
naming the space it is answering for:

    graph_query { filter: '.note!' }
    → [ { kind: 'note', space: 'shelf', entity: {…}, note: { body: 'lovely' } },
        { kind: 'note', space: 'stall', entity: {…}, note: { body: 3 } } ]

A WRITE has no such luxury — one bundle cannot land in two meanings — so it asks
you:

    note means two things — shelf and stall declare it differently;
      name the app this goes in

And what is out of reach is simply absent. Another person's private app can hold
a component on the very eid you are reading, and it never appears on your
bundle: reach is the apps you may read, and nothing else.

## Reading a sibling app from a page

`client.js` exports `store(base)`, which is the same six functions pointed at an
address you name:

    import { query, store } from './api/client.js'

    let lending = store('/lending/api/')
    let loans = await lending.query('.loan!&.doc?')

Every app in a space shares one hostname, so the address is a PATH, not a URL —
`/lending/api/`. It resolves against the page's own origin, and the trailing
slash is optional (the doors hang under it either way). Your own app is a path
like any other, so `store('/reading/api/')` is the same store as the bare
`query` you imported.

It is that app's own door, so that app's `access` decides: a `private` sibling
answers its members only, whoever is asking, and a `public` one takes writes
from a member and reads from anyone with the link. Nothing about being a
neighbour grants anything.

## `graph_query` with no app named

Name an app and you get that app's own answer, untouched. Leave `app` out and
the question is asked of EVERY app in reach — every app the person may read, in
every space they belong to — and answered as one bundle per entity.

    graph_query { filter: '.book!&.loan?' }
    → [ { kind: 'book', entity: { eid: '…', num: 3 },
          book: { pages: 245 }, loan: { to: 'Maya' },
          _stores: { book: 'jeff/reading-list', loan: 'jeff/lending' } } ]

- `!` says which entities the answer is ABOUT; `?` asks for a component beside
  them without filtering on it. So `.book!&.loan?` is every book, wearing its
  loan where it has one, and `.book!&.loan!` is only the books that are out —
  `&` is an intersection across apps exactly as within one.
- `_stores` says which app holds which component. It rides only on a bundle that
  actually spans two, which is where you need it: to write one component back,
  you need to know whose it is.
- `kind` is the app's own word, not a platform word — and when two app words are
  on one row, the one the filter REQUIRED wins, so `.book!&.loan?` and
  `.loan?&.book!` both answer books.
- `.count!` counts ENTITIES, not rows: summing each store's own count would
  count a spanning entity twice.
- `limit=` bounds each PART before the parts meet, so a mixed filter's window is
  the newest of each side, then the newest of what they had in common.
- `.distinct` and `.tally` read one app at a time, and say so: name one with
  `app`, or ask for the rows and reduce them yourself.
- A word nobody in reach declared is a refusal, not an empty answer:
  `unknown prop: .sandwich`.
- `search` with no app named merges every app's ranked hits, best first.

## A pair, end to end

Two apps, one shelf of books.

    reading-list/vocab.json
    { "book": { "author": "text", "pages": "number" } }

    lending/vocab.json
    { "book": { "author": "text" }, "loan": { "to": "text",
      "due": "time" } }

The lending deploy answers:

    book lives in reading-list; this app reads and writes it there
    components: loan

Now one call writes both halves:

    graph_apply { entities: [
      { entity: { eid: '$b' },
        doc: { title: 'Solenoid' },
        book: { author: 'Mircea Cărtărescu', pages: 672 },
        loan: { to: 'Maya', due: '2026-10-01T00:00:00Z' } } ] }

`doc` and `book` land in the reading list; `loan` lands in lending; the alias is
minted once, so both are the same entity. Each app's own page draws its own half
— the reading list's `query('.book!&.doc?')` never mentions loans — and either
page can borrow the other's view when it wants it:

    let out = await store('/lending/api/').query('.loan!')
    let due = new Map(out.map((r) => [r.entity.eid, r.loan.due]))

    for (let b of await query('.book!&.doc?')) {
      draw(b.doc.title, due.get(b.entity.eid))
    }

And the person's agent sees the whole thing at once, without naming an app:

    graph_query { filter: '.book!&.loan!&.doc?' }
    → every book that is out, with its title and who has it

Neither app knows the other's schema. Delete the lending app and the books are
untouched; delete a book and its loan goes with the entity.

The whole guide is at <https://yaks.app/guide.md>; the components themselves,
and `vocab.json`, are <https://yaks.app/guide/components.md>, and the filter
grammar in full is <https://yaks.app/guide/querying.md>.
