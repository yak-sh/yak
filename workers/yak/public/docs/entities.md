---
doc:
  title: Cross-App Data
guide:
  slug: entities
  brief: one entity shared by several apps, and reading across apps
  description: >-
    Sharing data between apps: two of the person's apps writing components on
    the same entity (one eid) without copying it; which app a component lives
    in and its home app in a space; type conflicts; components across spaces;
    how a page reads a sibling app with store(); and how graph_query with no
    app named combines several stores into one bundle per entity.
---

# Cross-App Data

Two of the person's apps can write components on the same entity without either
app copying the other's data. This page covers which app a component lives in,
what a deploy reports when a component already has a home, what happens across
spaces, how a page reads a sibling app, and how `graph_query` combines one
bundle out of several stores.

## Shared entity ids (eids)

An eid is a UUID the client mints, and it identifies the same entity in every
store on the platform. No registry assigns eids, and no store has to agree to
one. A reading list app saves the book; a lending app saves who has borrowed it,
on the same eid. The result is one entity with two components, one in each
store, with no copied data and nothing to synchronize.

    let piranesi = crypto.randomUUID()

    graph_apply { app: 'reading-list', entities: [
      { entity: { eid: piranesi }, doc: { title: 'Piranesi' },
        book: { pages: 245 } } ] }

    graph_apply { app: 'lending', entities: [
      { entity: { eid: piranesi }, loan: { to: 'Maya' } } ] }

The eid is the entity's only identifier. An app's store mints no number beside
it: a number comes from a store's own counter, and would be `#3` in one app and
`#17` in another for the same entity, so an entity has one id everywhere.

## Which app a component lives in

A component is stored in the app that declares it, so no app has to decide where
it goes. `book` is the reading list's component wherever it is written; `loan`
is the lending app's. A write is split up by component and each part is sent to
the app that owns that component.

The platform's shared components (`doc`, `comment`, `task`, `image`, `archived`)
belong to no app, so each one goes to the first of these that applies:

1. the app the bundle names, where it sets `"$app": "<slug>"`;
2. the app where that entity already has that component;
3. the app whose own component is in the same bundle: a title written beside a
   recipe goes with the recipe, which is what lets a new entity be written in
   one call.

`$app` is set on the bundle rather than on the call, because the bundles in one
write may go to several apps at once: each bundle goes to one app, not the whole
write. When none of the three rules decides, the write is refused instead of
guessed:

    which app should doc go in? say $app on the bundle — reading-list, lending

Every part is checked in its own store before any of them commits, so a refusal
in one leaves the others unwritten. A `$alias` is minted once, when the write
arrives, so a bundle split across two stores is written under one eid.

    graph_apply { entities: [
      { entity: { eid: piranesi },
        doc: { title: 'Piranesi (2020)' },   → reading-list, which has its doc
        loan: { to: 'Bo' } } ] }             → lending, which declares loan

## A component's home app

When a second app in the same space declares `book`, no second `book` table is
created. The first app in the space to declare a component is its _home_; a
later manifest naming it is a use, not a second declaration. The deploy reports
that:

    uses: book from reading-list
    components: loan

`book` is left out of `components:` because the lending app is the home of
`loan` only. Its store never creates a `book` table, so asking that store for
one is refused, and all the rows are in one store:

    graph_query { app: 'lending', filter: '.book' }
    → unknown prop: .book

    graph_query { app: 'reading-list', filter: '.book' }
    → both books, however they were written

`graph_query` with an app named asks that store directly. The lending page's
`./api/query`, its local graph and its socket follow the app's declared uses and
can read `book` from its home, the reading list.

A property the borrowing app declares is added to the home's table (properties
are only ever added), and can then be written from either app:

    lending/vocab.json: { "$defs": {
      "book": { "properties": {
        "title": { "type": "string" },
        "isbn":  { "type": "string" } } },
      "loan": { "properties": {
        "to": { "type": "string" } } } } }
    → added: book.isbn

From an agent's tools, an app's commands and its page, a borrowed component is
stored in one place, its home.
`graph_apply { app: 'lending', entities: [{ book: … }] }` is written to the
reading list's store, and a command of the lending app may name `book` in its
`apply` or its `query`. The lending page can query, apply and subscribe to
`book` through its own `./api/` endpoints. Its vocabulary includes the borrowed
schema, so a local `@yaks/client` graph can watch `.book` too. A filter such as
`.book&?loan` joins the reading list's `book` to lending's `loan` on their
shared eid.

## Type conflicts between apps

Declaring a component whose home is another app is refused for only one reason:
the same property with two types. The rows already written under the home's type
define what that property is, and no manifest may rewrite them.

    vocab.json: book.pages is text in this app and number in reading-list,
      where book lives — a property keeps the type its rows were written under

The whole manifest is checked before anything is created, so a refused deploy
changes nothing at all: not the home's property, not this app's own components,
not its files.

## Components across spaces

Within one space a component has one home. Spaces share no home, so the same
component name may describe two different shapes in two spaces, and the answer
says which space each row comes from.

**When the shapes agree**, the name means one component and the entity comes
back as one bundle. A property only one space declares never conflicts, since a
vocabulary only ever grows.

**When they disagree** (`note.body` is `text` in one space and `number` in
another), the rows are kept apart. The same eid comes back as two bundles, each
naming the space it is answering for:

    graph_query { filter: '.note' }
    → [ { kind: 'note', space: 'shelf', entity: {…}, note: { body: 'lovely' } },
        { kind: 'note', space: 'stall', entity: {…}, note: { body: 3 } } ]

A write cannot be split this way, since one bundle cannot be written under two
meanings, so it is refused and asks you to name the app:

    note means two things — shelf and stall declare it differently;
      name the app this goes in

Components in apps you cannot read are left out. Another person's private app
can hold a component on the same eid you are reading, and it never appears on
your bundle: the apps in reach are the apps you may read, and nothing else.

## Reading a sibling app from a page

`client.js` exports `store(base)`, which points its functions at an address you
name. Use it to read a sibling app's components that your app has not declared
as uses:

    import { query, store } from './api/client.js'

    let lending = store('/lending/api/')
    let loans = await lending.query('.loan&?doc')

Every app in a space shares one hostname, so the address is a path, not a URL:
`/lending/api/`. It resolves against the page's own origin, and the trailing
slash is optional (the endpoints are under it either way). Your own app is a
path like any other, so `store('/reading/api/')` is the same store as the bare
`query` you imported.

These are that app's own endpoints, so that app's `access` decides: a `private`
sibling answers its members only, whoever is asking, and a `public` one accepts
writes from a member and reads from anyone with the link. A page query naming a
borrowed component also checks access to its home. Being in the same space
grants no access.

## `graph_query` with no app named

With an app named, you get that app's own answer, unchanged. With `app` left
out, the query is asked of every app in reach (every app the person may read, in
every space they belong to), and the answer is one bundle per entity.

    graph_query { filter: '.book&?loan' }
    → [ { kind: 'book', entity: { eid: '…' },
          book: { pages: 245 }, loan: { to: 'Maya' },
          _stores: { book: 'yourname/reading-list', loan: 'yourname/lending' } } ]

- `.` names which entities the answer is _about_; `?` asks for a component
  beside them without filtering on it. So `.book&?loan` is every book, with its
  loan where it has one, and `.book&.loan` is only the books that are out: `&`
  is an intersection across apps exactly as within one.
- `_stores` names which app holds which component. It appears only on a bundle
  that spans two apps, which is where you need it: to write one component back,
  you need to know which app holds it.
- `kind` is one of the apps' own components, never a platform one. When a row
  carries components from two apps, `kind` is the one the filter required, so
  `.book&?loan` and `?loan&.book` both return books.
- `.count` counts _entities_, not rows: summing each store's own count would
  count an entity that spans two stores twice.
- `limit=` bounds each part before the parts are combined, so a mixed filter's
  window is the newest of each side, then the newest of what they had in common.
- `.distinct` and `.tally` read one app at a time, and refuse when no app is
  named: name one with `app`, or ask for the rows and reduce them yourself.
- A component nobody in reach declared is a refusal, not an empty answer:
  `unknown prop: .sandwich`.
- `search` with no app named merges every app's ranked hits, best first.

## Example: a reading list and a lending app

Two apps share one set of books.

    reading-list/vocab.json
    { "$defs": {
        "book": { "properties": {
          "author": { "type": "string" },
          "pages":  { "type": "number" } } } } }

    lending/vocab.json
    { "$defs": {
        "book": { "properties": {
          "author": { "type": "string" } } },
        "loan": { "properties": {
          "to":  { "type": "string" },
          "due": { "type": "string", "format": "date-time" } } } } }

The lending deploy reports:

    uses: book from reading-list
    components: loan

One call then writes the components of both apps:

    graph_apply { entities: [
      { entity: { eid: '$b' },
        doc: { title: 'Solenoid' },
        book: { author: 'Mircea Cărtărescu', pages: 672 },
        loan: { to: 'Maya', due: '2026-10-01T00:00:00Z' } } ] }

`doc` and `book` are written to the reading list and `loan` to lending; the
alias is minted once, so both parts are the same entity. Each app's own page
draws its own components (the reading list's `query('.book&?doc')` never
mentions loans), and the lending page can read both of its declared components
through one query:

    let out = await query('.book&?loan&?doc')
    for (let b of out) draw(b.doc.title, b.loan?.due)

The person's agent can read the whole entity at once, without naming an app:

    graph_query { filter: '.book&.loan&?doc' }
    → every book that is out, with its title and who has it

Neither app knows the other's schema. Deleting the lending app leaves the books
untouched; deleting a book deletes its loan with the entity.

The whole guide is at <https://yaks.app/docs.md>; components and `vocab.json`
are covered in Components and vocab.json, <https://yaks.app/docs/components.md>,
and the full query syntax in Query Syntax, <https://yaks.app/docs/querying.md>.
