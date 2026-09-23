---
doc:
  title: 'Components: the platform''s, and your own'
guide:
  slug: components
  brief: the platform's components, and your own
  description: >-
    Every component an app already has, property by property, and vocab.json for
    components of your own: the property types, what a later deploy may change,
    the names already taken, and when a property beats doc.body.
---

# Components: the platform's, and your own

Every app's store shares the same small vocabulary, and every app can add
components of its own. This page is that vocabulary property by property — what
each holds and when to reach for it — then `vocab.json`, what a later deploy may
and may not change, the names already taken, and how to choose between a
property of your own and text in `doc.body`.

## What a component is

A component is one named set of fields describing _one_ aspect of an entity. An
entity is nothing but the components it has: there is no `kind` property, no
table of types, no class to pick at creation. A row with `doc` has words a
person reads; give the same row `task` as well and it has a state; give it
`recipe` too and it is a recipe. Take `task` off and it stops being work without
stopping being anything else.

    await apply({
      entity: { eid: '$cake' },
      doc: { title: 'Lemon cake', body: '3 lemons, 200g butter...' },
      recipe: { serves: 8, minutes: 50 },
    })

That is one entity, two components, one call. `kind` on the row you read back is
derived from the components it has — your own component wins, being the most
specific thing on the row — and nothing in the store branches on it. Every
component is a _patch_: send the properties you are changing and the rest are
left alone; `prop: null` clears one; `recipe: null` takes the whole component
off; `{entity: {eid}, tombstone: {}}` kills the entity.

    await apply({ entity: { eid }, recipe: { minutes: 45 } })   // one property
    await apply({ entity: { eid }, recipe: { source: null } })  // cleared
    await apply({ entity: { eid }, recipe: null })              // not a recipe

## The platform's vocabulary

These components mean the same thing in every store on the platform. Each
heading gives the properties you may write; a few carry server-set properties
you can read but never write, and those are named beneath.

**`doc`** — `title` (text), `body` (text). The words a person reads, and what
`search` searches unless a property of your own is marked searchable (below).
Nearly every entity your app saves should have one: a row with no `doc` has
nothing to draw.

    await apply({ entity: { eid: '$c' }, doc: { title: 'Chana masala' } })

A body is stored content-addressed: the row keeps the SHA-256 of the text and
the text itself is kept once, however many rows quote it. None of that is a row
of the graph — there is no second entity beside your doc — so `.doc!` returns
your docs and a body reads back as the text you wrote.

**`filed`** — `priority` (number), `project` (eid), `assignee` (eid), `domain`
(text). Optional portfolio filing, separate from task presence. A microtask
needs no filing; add it when work belongs on a project board.

**`task`** — no stored properties. Anything with a state: a chore, a to-do, a
suggestion waiting on someone. Reach for it rather than inventing a `status`
property of your own, and the platform's own status grammar works on your rows.

`status` is _read_, never written — `open`, `wip`, `done` or `cancelled`,
derived from the components the entity has: `cancelled` if it has `cancelled`,
else `done` if it has `completed`, else `wip` if it has a live `claim`, else
`open`.

    await apply({ entity: { eid: '$t' },
      doc: { title: 'Water the plants' }, task: {}, filed: { priority: 1 } })

    let todo = await query('.task.status=open&.doc?')

**`completed`** — no writable properties; the store sets `at` (time), `by` (eid)
and `via` (eid). The mark that makes a task `done`. The store fills all three —
the clock from the write, the writer from whoever is asking — so `completed: {}`
is the whole write, and taking it off again is `completed: null`.

    await apply({ entity: { eid }, completed: {} })      // done
    await apply({ entity: { eid }, completed: null })    // open again

**`cancelled`** — `reason` (text); the store sets `at` (time), `by` (eid) and
`via` (eid). Called off rather than finished, and the one of the two that has
somewhere to put why.

    await apply({ entity: { eid }, cancelled: { reason: 'moved house' } })

**`project`** — `color` (text). A thing other rows belong to, by
`filed.project`. Reach for it when your app has lists that own work — a
household, a course, a trip. The reference detaches when the project dies: the
tasks live on with a null `project`.

    let { aliases } = await apply({
      entity: { eid: '$p' }, doc: { title: 'Kitchen' },
      project: { color: '#a7c080' },
    })
    await apply({ entity: { eid }, task: {}, filed: { project: aliases.$p } })

**`comment`** — `target` (eid). A note aimed at _any_ entity — a recipe, a
photo, another comment. The note's own words go in its `doc`. The comment dies
with its target, so a deleted recipe takes its thread with it.

    await apply({ entity: { eid: '$n' },
      doc: { body: 'Halve the sugar.' }, comment: { target: recipe } })

    let thread = await query(`.comment.target=${recipe}&.doc?`)

**`alias`** — no properties of its own; `alias: { name }` is the shorthand. A
name of your own for an entity, worth as much as its eid. Write it beside a `$`
eid and the write becomes idempotent: the same name written again patches the
entity that already holds it, so a seed, an import, or a page that saves itself
every time it opens writes one row rather than a pile.

    await apply({ entity: { eid: '$r' },
      alias: { name: 'recipe:lemon-cakes' },
      doc: { title: 'Lemon cakes' } })

    // and then, without ever having kept the eid
    await apply({ entity: { eid: '$n' }, doc: { body: 'Halve the sugar.' },
      comment: { target: 'recipe:lemon-cakes' } })

A name stands wherever an eid does — in a reference property, as a bundle's own
`entity.eid`, in `id=`, in `graph_show` — and an eid always wins over a name for
the same entity. One name, one entity: a second entity claiming a name somebody
holds is refused, naming the holder. Delete the entity and the name is free
again. An entity may answer to as many names as you give it; each is a row of
its own (`key{of, value}` with `alias`), which is what `.alias!` lists.

**`person`** — no properties. Whoever wrote a row. The store mints one for each
writer it meets, titled with what to call them, so `person` rows have a `doc`
too. You read them for a byline. They are screened out of an ordinary listing,
so ask for them by name: `query('.person!&.doc?')` lists everyone this store has
met.

**`archived`** — no writable properties; the store sets `at` (time), `by` (eid)
and `via` (eid). The stamp that takes something out of the open list. Reach for
it rather than a `hidden` property of your own — every part of the platform
knows it, and `.archived=` is "everything not archived".

    await apply({ entity: { eid }, archived: {} })
    let open = await query('.recipe!&.archived=')

**`favorite`** — no writable properties; the store sets `at` (time). A plain
star, one stamp per entity rather than one per person: it means "this app has
starred this", not "you have".

**`web`** — `url` (url). An address out on the web: a bookmark, a source, the
page a recipe was copied from. Also carries a server-set `frozen_at`.

    await apply({ entity: { eid: '$b' }, doc: { title: 'The recipe' },
      web: { url: 'https://example.com/chana' } })

**`blob`** — `bytes` (number). A byte count, not the bytes. It sits on the
content-addressed entity the bytes live at, so it is how big a file is.

**`attachment`** — `blob` (eid), `mime` (text), `name` (text). One file, as
`upload` writes it. `attachment.blob` is where the bytes are, which is what
`./api/blob/<sha>` is built from; deleting the bytes takes the row with them.

**`image`** — `w` (number), `h` (number). What a picture measures, on the blob
itself, not on the row that points at it. `upload` reads it off the file's own
header (png, jpeg, gif, webp), so a wall can hold a photo's space open before
its bytes arrive.

**`created`** — no writable properties; the store sets `at` (time), `by` (eid)
and `via` (eid). **`updated`** — the same three. The byline and the clock. You
rarely write either: the store stamps the writer and the moment on its own, and
a listing leaves them out unless the filter asks for them.

    for (let e of await query('.doc!&.created!')) draw(e, e.created.by?.name)

`created.at` is **when this store first saw the row**, and it cannot be given a
past moment — not by a page, not by `graph_apply`. So a row with a date of its
own carries that date in a `time` property of its own: when the diary entry was
written, when the message was left, when the seedling went in. That is not a
second copy of the stamp; they are two different facts, and they disagree
exactly when it matters — an import.

    { "$defs": {
        "jotting": { "properties": {
          "written": { "type": "string", "format": "date-time" } } } } }

    graph_apply { app: 'diary', entities: [
      { doc: { body: 'Beans in, back bed.' },
        jotting: { written: '2026-04-11T12:00:00Z' } } ] }

Seed a fortnight of a guestbook and every `created.at` reads today, truthfully:
today is when you wrote them. Draw `jotting.written`.

**`exception`** — `at`, `message`, `stack`, `request`, `version`, all
server-set. **`failed`** — `at`, `message`, server-set. The platform's own rows
about your app: what a route threw, what a page reported. Nothing you write.
They stay out of every listing unless the filter names one (`.exception!`), and
`app_errors` is the tool meant for them.

Not listed: `edge`, which is a relation between two entities rather than a
component on either one — last section.

## The property types

A property is one of these, and a `vocab.json` declares it with the JSON Schema
shown beside it:

- `text` — `{"type": "string"}`. One line, or many. The catch-all.
- `number` — `{"type": "number"}`, stored as a SQLite real, so integers and
  decimals both fit.
- `bool` — `{"type": "boolean"}`. True or false.
- `time` — `{"type": "string", "format": "date-time"}`, an ISO 8601 timestamp
  with a zone, as text: `new Date().toISOString()`, or `'2026-04-11T12:00:00Z'`
  written by hand. It comes back exactly as it was sent, so it is a string on
  the way in and a string on the way out; `new Date(row.jotting.written)` when
  you need to do arithmetic with it, and the ordinary comparisons filter it
  (`.jotting.written>=2026-04-01`).
- `url` — `{"type": "string", "format": "uri"}`, an address out on the web; text
  with a link's face.
- `eid` — a reference to another entity. The platform's own components have
  these; a `vocab.json` cannot declare one (below).
- a closed set of values — the platform's alone; a refusal lists the set,
  `open|wip|done|cancelled`.

**Noon for a date.** When a `time` property really holds a _day_ — the plants
went in, the meeting is on the 4th — write noon UTC, `2026-04-11T12:00:00Z`.
Midnight is the day before for everyone west of Greenwich, so a diary written at
`T00:00:00Z` renders a day early in California, and the page has to correct for
a zone it should never have had to think about.

Every property says its `type`; `app_deploy` refuses one that does not. A string
property keeps what it is sent as a string: a number written to a `text`
property comes back as `"5"`.

The first five are the ones a `vocab.json` may declare. References, closed sets
and content-addressed bodies each need machinery a store cannot plant from a
name alone — a foreign key, a set to enforce, a hash.

**No eid property of your own**, then: a component of yours cannot point at
another entity by declaring one. Where a row of yours needs to be about another
row, the platform already has a component for it — `comment.target` is an eid
aimed at any entity, and an edge is the other way to record it. A history
component (a chore's ticks, a diary's plantings) is the case that wants this;
until it can be declared, hang the ticks off `comment.target` or make each tick
its own entity carrying the parent's eid in `comment.target`.

## What a refusal tells you

`graph_schema` reports the vocabulary: every component, its properties and their
types, for the app or the space you name. `graph_apply`'s input schema is that
vocabulary too, and it is deliberately open: a property your cached copy of the
schema has never heard of still reaches the store, and a property nobody
declared is refused there. The schema describes; the server decides.

Name a property that is not there and the refusal lists the whole component —
from a page's `./api/` endpoints and from an agent's tools alike — so one look
ends the guessing:

    unknown property: recipe.calories — recipe has title (text),
      serves (number), minutes (number)

    no such prop: .recipe.mins — recipe has title (text), serves (number),
      minutes (number)

Name a component nobody declared and the refusal tells you where a new component
comes from, never what some other store has:

    unknown component: dayline — a component of your own is declared in
      vocab.json and planted by app_deploy:
      {"$defs": {"recipe": {"properties": {"serves": {"type": "number"}}}}}
      · https://yaks.app/docs.md

A property that exists but is the server's (`created.at`, `completed.via`) is
neither refused nor written. It is dropped in silence, so a row you read and
patch straight back is never punished for carrying its own stamps.

## What an unwritten property reads back as

**Null, and present.** A property of yours that nothing has ever written is on
the row with the value `null` — not missing from it. So `'mood' in row.jotting`
is true either way and is the wrong test; the value is the right one.

    { "jotting": { "written": "2026-04-11T12:00:00Z",
                   "mood": null, "pages": null, "aloud": null } }

    if (row.jotting.mood) …          // right
    if ('mood' in row.jotting) …     // always true

That holds for the platform's own properties too, `doc.title` included: a doc
nobody titled reads back as null, not `''`. `doc.body` is kept content-addressed
and reads back as null when there is none.

## Components of your own

An app names its own components in a `vocab.json` at its root, and `app_deploy`
plants them in that app's store. It is a JSON Schema document, which is the
format the platform uses underneath: one `$defs` entry per component, one
`properties` entry per property — nothing around it:

    { "$defs": {
        "recipe": { "properties": {
          "serves":  { "type": "number" },
          "minutes": { "type": "number" },
          "source":  { "type": "string" } } },
        "cooked": { "properties": {
          "on":    { "type": "string", "format": "date-time" },
          "again": { "type": "boolean" } } } } }

After the deploy those are components like any other: write them in a bundle,
read them back on the row, filter on them, name them in a `tools.json`.

    await apply({ entity: { eid: '$c' }, doc: { title: 'Chana masala' },
      recipe: { serves: 4, minutes: 35 } })

    let quick = await query('.recipe.minutes<=30&.doc?')

Write it as `vocab.yml` instead if you would rather read it — YAML is the same
manifest with fewer braces and quotes, and an app that has both is deployed from
the `.yml`:

    $defs:
      recipe:
        properties:
          serves: { type: number }
          minutes: { type: number }
          source: { type: string }
      cooked:
        properties:
          on: { type: string, format: date-time }
          again: { type: boolean }

A component name is `a-z`, then `a-z0-9_`, up to 40 characters, and may not be
one of the platform's own component names. A property name follows the same
rules and is checked against nothing else — only `entity` and `eid` are refused,
since those name the row itself. So `recipe.doc` is a legal property; it just
reads like a component, and `.recipe.doc` addresses it rather than the doc
beside it.

**A chore board.** The state is the platform's, so declare only what the
platform has no component for:

    { "$defs": {
        "chore": { "properties": {
          "room":       { "type": "string" },
          "every_days": { "type": "number" } } } } }

    await apply({ entity: { eid: '$c' },
      doc: { title: 'Descale the kettle' },
      chore: { room: 'kitchen', every_days: 90 },
      task: {}, filed: { priority: 2 } })

    await apply({ entity: { eid }, completed: {} })
    let left = await query('.chore!&.task.status=open&.doc?')

**A reading list.** Two components, because a book and your reading of it are
two aspects — one is true of the book forever, the other is yours and changes:

    { "$defs": {
        "book": { "properties": {
          "author": { "type": "string" },
          "pages":  { "type": "number" },
          "isbn":   { "type": "string" } } },
        "reading": { "properties": {
          "started":  { "type": "string", "format": "date-time" },
          "finished": { "type": "string", "format": "date-time" },
          "rating":   { "type": "number" } } } } }

    await apply({ entity: { eid: '$b' }, doc: { title: 'Piranesi' },
      book: { author: 'Susanna Clarke', pages: 245 } })

    await apply({ entity: { eid },
      reading: { started: new Date().toISOString() } })

    let unread = await query('.book!&.reading=&.doc?')

`.reading=` asks for the component's absence — every book you have not begun.

**A recipe box with pictures.** A component of your own points at the
platform's:

    { "$defs": {
        "recipe": { "properties": {
          "serves":  { "type": "number" },
          "minutes": { "type": "number" } } },
        "photo": { "properties": {
          "caption": { "type": "string" },
          "blob":    { "type": "string" } } } } }

`photo.blob` is `text` and not `eid`, because a manifest cannot declare a
reference. It costs nothing: it holds the eid `upload` answered with, and
`./api/blob/<eid>` serves the bytes.

**A searched property.** A property can declare more than its type.
`"search": true` is the one to know: it puts that property's text in the search
index, so `search` finds a row by what is written there, the way it already
finds one by its title or its body.

    { "$defs": {
        "recipe": { "properties": {
          "serves": { "type": "number" },
          "method": { "type": "string", "search": true } } } } }

Only prose can be searched — a number, a date and a URL are matched by their
value, not read — so `"search": true` anywhere else is refused at deploy, in a
message naming the property. A property that declares nothing extra is stored
and readable and simply never searched.

Your components are yours. No other app's store has heard of them, and no other
app's rows can collide with them — unless a sibling app of the same person
declares the same name, which is the next page.

## How a vocabulary evolves

The rule is short: **properties only ever arrive.**

- **Adding a property** is a deploy. It reports `added: recipe.source`.
- **A property that already exists is never retyped.** Declare `pages` as `text`
  where it was `number` and the deploy is refused:
  `vocab.json: book.pages is
  already number — a property keeps the type its rows were written under`.
- **A property the new manifest stops naming does not go away.** Its rows are
  still there, and the deploy reports it:

      kept, not in vocab.json (the rows are there): note.text — name it in
      vocab.json again to keep writing it, or move its rows to the new word
      yourself, a row at a time with graph_query then graph_apply. Nothing is
      migrated behind you.

  That line is what makes a rename visible. Change `minutes` to `mins` and you
  have two properties: the new one arrives empty, the old one keeps every row
  already written, and rows read back as `"minutes": 46, "mins": null` until you
  move them yourself.

- **A whole component the manifest stops naming is dropped if it holds no rows
  and kept if it holds any.** `dropped (no rows): jot` — the table goes with the
  component, so a name you tried once does not stay in the app forever. A
  component with rows stays declared and stays writable.

- **The whole manifest is read before anything is planted.** A refusal names
  every collision at once and leaves the store as it was, so probing for a free
  name costs one deploy and leaves nothing behind.

Everything a deploy did to the vocabulary is in what it reports: `components:`
then `added:` then `kept:` then `dropped:`. Read it — it is the only place a
half-finished rename is ever mentioned.

## The names already taken

The platform's own vocabulary is refused in a `vocab.json`, so that `doc` means
`doc` in every store on the platform. A manifest reaching for one is refused
whole:

    vocab.json: card, entry are words the platform already says — pick
      another name

These are the names, all of them:

    about accept access alias anchor app apply archetype architecture archived
    artifact attachment attention bash blob blocked board bounced brief bug
    call call_ready call_woken camera cancel cancelled canvas card chat
    checkpoint claim client comment commit completed conflict contains content
    created cursor decided delegates deliver delivered deploy design doc dream
    edge effect email entity entry error exception execution exit failed
    favorite feedback fetch filed finding fired fixer fold fork generation
    goal grant graph_query headers hook hostname image imported installed key
    knock layout lease mail member memory message meta meter model
    nofix notified noverify opaque opened order output pane patch person
    persona pin plan process product project prompt proposed provider
    published quarantined reads reasoning recall recalled redaction referenced
    references repo report requires response result resume retired review role
    run runner runtime satisfies service session setting settled shelf signal
    signin space spawn stderr stop stop_request subscription supersedes
    supervises task task_context timeout tool tool_use updated usage venture
    verifier wake wants web worked worktree yield

When your first choice is taken, ask what the component is _for_ and name that:
the taken name is the general one, yours is the specific one. Not `card` but
`flashcard`, not `entry` but `weigh_in`, not `plan` but `menu`, not `board` but
`standings`. A prefix works too — `book_note` — but a name of its own reads
better in a filter, and the filter is where you meet it most.

## A property, or `doc.body`?

`doc.body` is text. Anything can live there, and one thing should: **the words a
person reads and search should find.** A recipe's method, a note's prose, a
book's blurb.

Reach for a property when the value is one the app will filter, sort, count or
draw as a field — `serves`, `minutes`, `rating`, `started`. Those are the things
`.recipe.minutes<=30` can ask about; the same number written into `body` is
invisible to every query.

Reach for `body` when the value is prose, when it is long, or when it varies
from row to row in a way a property cannot describe. JSON keeps in `body` too,
which is the right answer for a shape you have not settled — but the moment you
want to filter on a key inside it, that key wants to be a property.

Do not put in a property what the graph already holds. Who wrote it is
`created.by`; whether it is done is `completed`; whether it is hidden is
`archived`; what it belongs to is `filed.project` or a `contains` edge. A second
copy in a property of your own only drifts.

The exception is a date the row itself has. `created.at` is when the store saw
the row, which is the right answer for a page someone is typing into and the
wrong one for anything imported or seeded, where it reads today for something
that happened in April. When the date is part of what the row IS, it is a `time`
property of yours.

## One component, or a wider one?

Cohesion is the test: **a component describes a single aspect of an entity.** If
half the properties are always written together and the other half are written
by a different act, at a different time, that is two components.

The reading list above is the case. `book` is what the book IS — it never
changes, and two people would agree on it. `reading` is what happened between
you and it: it arrives later, changes often, and might never arrive. Splitting
them buys `.book!&.reading=` for the unread, spares an unstarted book a row of
nulls, and leaves room for a lending app to add a third component.

Split when either half can be true without the other. Keep one component when
the properties are born together and die together — `image` is `w` and `h`.

## Edges are relations, not properties

A relation between two entities is not a property on either. It is an edge — a
record of its own, naming the relation and the entity at the far end:

    await apply({ entity: { eid: menu },
      edges: { type: 'contains', child: recipe } })

    await apply({ entity: { eid: menu }, edges: [
      { type: 'contains', child: starter },
      { type: 'contains', child: pudding },
    ] })

It reads parent first: the entity you addressed `contains` the child. Both ends
must already exist, or be written in the same `apply` call — an edge naming a
missing endpoint is dropped on its own rather than refusing your write, and so
is an edge whose type is not one of these:

    requires  contains  reads  about  supervises  delegates
    recalled  supersedes  worked  referenced  wants  satisfies

For an app, five carry their weight: `contains` for a whole and its parts (a
menu and its courses), `requires` for one thing that waits on another, `about`
for a note aimed at a subject, `referenced` for a mention, and `supersedes` for
a version replacing the one before it. The rest are the platform's own
machinery.

Note the exact name: the type is `referenced`, not `references`. A type the
store does not know is not refused — the edge is simply never made — so a typo
is silent, and you notice only when nothing comes back.

A listing does not carry edges — a filter returns components — so an app that
draws a relation keeps the far end where it can read it back: the child's own
row, or an eid in a `text` property of your own. Delete an entity and every edge
touching it goes with it.

The whole guide is at <https://yaks.app/docs.md>; two apps writing about one
entity is <https://yaks.app/docs/entities.md>, and the filter grammar in full is
<https://yaks.app/docs/querying.md>.
