---
doc:
  title: Components and vocab.json
guide:
  slug: components
  brief: the platform's built-in components, and declaring your own in vocab.json
  description: >-
    Every built-in component an app already has (doc, task, filed, comment,
    alias, attachment, created and the rest), property by property, and
    vocab.json for declaring an app's own components: the property types,
    schema refusals, who may write a component and how often (floor, pace),
    rows kept to members (readers), a component kept from readers below a level (shown), kinds and what a whole one carries (kinds), private per-person rows (personal), full-text search on a property, what a
    later deploy may change, the reserved component names, when to use a
    property instead of doc.body, and edges.
---

# Components and vocab.json

Every app's store has the same built-in vocabulary, and every app can add
components of its own. This page lists that vocabulary property by property,
with what each property holds and when to use it, then covers `vocab.json`, what
a later deploy may and may not change, the reserved names, and how to choose
between a declared property and text in `doc.body`.

## What a component is

A component is one named set of properties describing _one_ aspect of an entity.
An entity is defined only by the components it has: there is no `kind` property,
no table of types, no class to choose at creation. A row with `doc` has text a
person reads; add `task` to the same row and it has a status; add `recipe` too
and it is a recipe. Remove `task` and it is no longer a task, and it is still
everything else it was.

    await apply({
      entity: { eid: '$cake' },
      doc: { title: 'Lemon cake', body: '3 lemons, 200g butter...' },
      recipe: { serves: 8, minutes: 50 },
    })

That is one entity with two components, written in one call. The `kind` on the
row you read back is derived from the components it has (your own component
wins, as the most specific one on the row), and nothing in the store branches on
it. Every component write is a _patch_: send the properties you are changing and
the rest are left unchanged; `prop: null` clears one property; `recipe: null`
removes the whole component; `{entity: {eid}, tombstone: {}}` deletes the
entity.

    await apply({ entity: { eid }, recipe: { minutes: 45 } })   // one property
    await apply({ entity: { eid }, recipe: { source: null } })  // cleared
    await apply({ entity: { eid }, recipe: null })              // not a recipe

## Platform components

These components mean the same thing in every store on the platform. Each entry
lists the properties you may write; a few components also have server-set
properties you can read but never write, and those are named in the entry.

**`event`** — `starts` (text), `ends` (text), `repeats` (text), `place` (text),
`zone` (text). Add `doc{title, body}` for its title and description. Set `zone`
to the event's IANA time zone, such as `America/Detroit`; each event can use its
own zone. `starts` is an ISO date-time with `Z` or a numeric offset, a local
date-time when `zone` is set, or `YYYY-MM-DD` for an all-day event. `ends` is
exclusive and uses the same form; absent means one day for an all-day event, or
a point in time. `repeats` is an RFC 5545 rule such as `FREQ=WEEKLY;BYDAY=SU`,
optionally ending with `COUNT=12` or `UNTIL=20261225T235959Z`. Timed recurrence
follows the event's zone, preserving local wall time through daylight saving
changes. An absent zone means UTC. Each recurring series is one row.

Public and open apps serve their events at `./calendar.ics`. Add that URL to
Google Calendar using “From URL”; the calendar provider refreshes it on its own
schedule. Timed events with a zone use matching `TZID` values on `DTSTART` and
`DTEND`; all-day events stay dates. The feed reads as an anonymous visitor,
excluding person-owned rows and rows carrying `cancelled{at, by, via, reason}`.
A private app has no public feed. An app with a worker is asked first, as at
every address of its own: a worker that draws its own feed answers
`./calendar.ics` (and `./calendar/<token>.ics`), and its 404 passes to this one.
Event expansion and feed serialization live in `@yaks/events`.

**`feed`** — `person` (eid), `token` (text). A person's private calendar
subscription, served at `./calendar/<token>.ics`, including on private apps. It
includes events with that person's completed registrations, excluding cancelled
and waitlisted registrations and cancelled events. Every event keeps its own
time zone. The token opens only that calendar and grants no access to app data
or APIs. Feed rows require a viewer to read and an editor to write. The Operator
returns the link with the person's own registrations; `signup_calendar`
retrieves or replaces it after checking the registration's vouched submitter.
Replacement revokes the previous link immediately.

**`doc`** — `title` (text), `body` (text). The text a person reads, and what
`search` searches, along with any declared property marked searchable (below).
Nearly every entity your app saves should have one: a row with no `doc` has no
text to display.

    await apply({ entity: { eid: '$c' }, doc: { title: 'Chana masala' } })

A body is stored content-addressed: the row keeps the SHA-256 of the text, and
the text itself is stored once, however many rows contain it. The stored text is
not a row of the graph (there is no second entity beside your doc), so `.doc`
returns your docs and a body reads back as the text you wrote.

**`draft`** — `by` (eid), `place` (text), `text` (text), `via` (eid); the store
sets `rev` (number). A person's unsent input, kept and synced across devices on
the eid `draftEid(by, place)` from `@yaks/draft`. A guest's input carries `via`,
the browser it was typed in, until sign-in hands it to a person. Write it with
`typed` to preserve concurrent input, and empty its text in the same batch as
the action that sends it. Keep a local recovery copy until the store
acknowledges that batch.

**`typed`** — `over` (text). An event sent with a draft write, naming the text
the interface last received from the store. The store merges both interfaces'
edits against that shared text and increments the draft's revision; the event
itself is not stored.

    await apply({
      entity: { eid: draftEid(person, 'command') },
      draft: { by: person, place: 'command', text: 'ship it now' },
      typed: { over: 'ship it' },
    })

**`filed`** — `priority` (number), `project` (eid), `assignee` (eid), `domain`
(text). Optional filing in the portfolio, separate from the `task` component. A
microtask needs no filing; add it when the work belongs on a project board.

**`task`** — no stored properties. Anything with a status: a chore, a to-do, a
suggestion waiting on someone. Use it instead of a `status` property of your
own, and the platform's status queries work on your rows.

`status` is _read_, never written: `open`, `done` or `cancelled`, computed from
the components the entity has: `cancelled` if it has `cancelled`, else `done` if
it has `completed`, else `open`.

    await apply({ entity: { eid: '$t' },
      doc: { title: 'Water the plants' }, task: {}, filed: { priority: 1 } })

    let todo = await query('.task.status=open&?doc')

**`completed`** — no writable properties; the store sets `at` (time), `by` (eid)
and `via` (eid). The mark that makes a task `done`. The store fills all three,
`at` from the time of the write and `by` and `via` from the writer, so
`completed: {}` is the whole write, and `completed: null` removes it again.

    await apply({ entity: { eid }, completed: {} })      // done
    await apply({ entity: { eid }, completed: null })    // open again

**`cancelled`** — `reason` (text); the store sets `at` (time), `by` (eid) and
`via` (eid). The mark for a task called off rather than finished. Unlike
`completed`, it has a property for the reason.

    await apply({ entity: { eid }, cancelled: { reason: 'moved house' } })

**`project`** — `color` (text). An entity other rows belong to, through
`filed.project`. Use it when your app has lists that group work: a household, a
course, a trip. When the project is deleted, the reference detaches: the tasks
remain, with a null `project`.

    let { aliases } = await apply({
      entity: { eid: '$p' }, doc: { title: 'Kitchen' },
      project: { color: '#a7c080' },
    })
    await apply({ entity: { eid }, task: {}, filed: { project: aliases.$p } })

**`comment`** — `target` (eid), `reply_to` (eid). A note attached to _any_
entity: a recipe, a photo, another comment. The note's own text goes in its
`doc`. A comment is deleted with its target, so deleting a recipe deletes its
comments.

    await apply({ entity: { eid: '$n' },
      doc: { body: 'Halve the sugar.' }, comment: { target: recipe } })

    let thread = await query(`.comment.target=${recipe}&?doc`)

**`alias`** — no properties of its own; `alias: { name }` is the shorthand. A
name you choose for an entity, usable anywhere its eid is. Write it with a `$`
eid and the write becomes idempotent: the same name written again patches the
entity that already has it, so a seed, an import, or a page that saves itself
every time it opens writes one row instead of many duplicates.

    await apply({ entity: { eid: '$r' },
      alias: { name: 'recipe:lemon-cakes' },
      doc: { title: 'Lemon cakes' } })

    // later, without having stored the eid
    await apply({ entity: { eid: '$n' }, doc: { body: 'Halve the sugar.' },
      comment: { target: 'recipe:lemon-cakes' } })

A name works wherever an eid does: in a reference property, as a bundle's own
`entity.eid`, in `id=`, in `graph_show`; an eid always takes precedence over a
name for the same entity. A name belongs to one entity: a write giving a second
entity a name that is already taken is refused, and the refusal names the entity
that has it. When that entity is deleted, the name is free again. An entity may
have any number of names; each is a row of its own (`key{of, value}` with
`alias`), and `.alias` lists them.

**`person`** — no properties. The writer of a row. The store creates one for
each new writer, titled with the person's display name, so `person` rows have a
`doc` too. Read them for a byline. They are excluded from an ordinary listing,
so query for them explicitly: `query('.person&?doc')` lists every person this
store has recorded.

**`archived`** — no writable properties; the store sets `at` (time), `by` (eid)
and `via` (eid). The stamp that takes an entity out of the open list. Use it
instead of a `hidden` property the app declares: every part of the platform
recognizes it, and `!archived` matches everything not archived.

    await apply({ entity: { eid }, archived: {} })
    let open = await query('.recipe&!archived')

**`favorite`** — no writable properties; the store sets `at` (time). A star: one
stamp per entity, not one per person. It means "this app has starred this", not
"you have".

**`web`** — `url` (url). A web URL: a bookmark, a source, the page a recipe was
copied from. It also has a server-set `frozen_at`.

    await apply({ entity: { eid: '$b' }, doc: { title: 'The recipe' },
      web: { url: 'https://example.com/chana' } })

**`blob`** — `bytes` (number). A byte count, not the bytes themselves. It is on
the content-addressed entity that holds the bytes, so it gives a file's size.

**`attachment`** — `blob` (eid), `mime` (text), `name` (text), `artifact` (eid),
`audience` (text), `call` (text), `revised_prompt` (text), `source` (text). One
file, as `upload` writes it, or a model-generated file. `audience` is `user` or
`model`; `model` attachments supply reference images to a model call.
`attachment.blob` points to uploaded bytes; `attachment.artifact` points to
generated bytes; `attachment.source` is the web address a file was fetched from.
`./api/blob/<sha>` serves the uploaded bytes. Deleting the entity at `<sha>`
deletes the upload: its attachment row is deleted with it, and so are the bytes,
unless another attachment still points at them (see
[Files and Uploads](/docs/files)).

**`image`** — `w` (number), `h` (number). An image's dimensions, stored on the
blob itself, not on the row that points at it. `upload` reads them from the
file's header (png, jpeg, gif, webp), so a page can reserve a photo's space
before its bytes arrive.

**`created`** — no writable properties; the store sets `by` (eid), `at` (time)
and `via` (eid). **`updated`** — the same three. Who wrote the row and when. You
rarely write either: the store stamps the writer and the time itself, and a
listing omits them unless the query asks for them.

    for (let e of await query('.doc&.created')) draw(e, e.created.by?.name)

`created.at` is **when this store first received the row**, and it cannot be set
to an earlier time, by a page or by `graph_apply`. So a row with a date of its
own stores that date in a `time` property of its own: when the diary entry was
written, when the message was left, when the seedling was planted. That is not a
second copy of the stamp; they are two different facts, and they differ in
exactly the case where it matters: an import.

    { "$defs": {
        "jotting": { "properties": {
          "written": { "type": "string", "format": "date-time" } } } } }

    graph_apply { app: 'diary', entities: [
      { doc: { body: 'Beans in, back bed.' },
        jotting: { written: '2026-04-11T12:00:00Z' } } ] }

If you seed two weeks of guestbook entries, every `created.at` reads today, and
that is correct: today is when you wrote them. Display `jotting.written`.

**`exception`** — `type`, `value`, both server-set: the error thrown while
producing an answer or transcript entry. Defect reports are kept by the tracker;
`app_errors` reads the app's tracked occurrences. A failed tool call in a
session stays in that session's history.

Not listed here: `edge`, which is a relation between two entities rather than a
component on either one; see the last section, "Edges: relations between
entities".

## Property types

A property has one of these types, and a `vocab.json` declares it with the JSON
Schema shown beside it:

- `text` — `{"type": "string"}`. Single-line or multi-line text. The
  general-purpose type.
- `number` — `{"type": "number"}`, stored as a SQLite real, so integers and
  decimals both fit.
- `bool` — `{"type": "boolean"}`. True or false.
- `time` — `{"type": "string", "format": "date-time"}`, an ISO 8601 timestamp
  with a time zone, as text: `new Date().toISOString()`, or
  `'2026-04-11T12:00:00Z'` written by hand. It is returned exactly as it was
  sent: a string when written and a string when read. Use
  `new Date(row.jotting.written)` for date arithmetic; the ordinary comparison
  operators filter it (`.jotting.written>=2026-04-01`).
- `url` — `{"type": "string", "format": "uri"}`, a web URL; stored as text and
  displayed as a link.
- `object` — `{"type": "object"}`, a JSON object, written and read back whole:
  `{"amount": 2, "unit": "loaf"}`.
- `array` — `{"type": "array"}`, a JSON list, written and read back whole:
  `["bread", "vegan"]`.
- a union — `{"type": ["string", "number"]}`, any one of the types it lists, and
  `"null"` may be one of them. It is stored the way an object is.
- `eid` — a reference to another entity:
  `{"type": "string", "ref": "entity", "death": "keep"}`. The platform's own
  components have these, and a component of yours declares one to say whose row
  it is ("Private per-person rows: `personal`", below).
- a closed set of values — used only by the platform's components; a refusal
  lists the allowed values, such as `cancelled|done|open`.

**Store a date as noon UTC.** When a `time` property holds a _day_ (the day the
plants went in, a meeting on the 4th), write noon UTC, `2026-04-11T12:00:00Z`.
Midnight UTC is still the previous day in every time zone behind UTC, so a diary
entry written at `T00:00:00Z` displays a day early in California, and the page
has to correct for a time zone it should never have had to handle.

Every property declares its `type`; `app_deploy` refuses one that does not. A
string property stores what it is sent as a string: a number written to a `text`
property is read back as `"5"`.

A `vocab.json` can declare every type above except two. A closed set and a
content-addressed body each need machinery a store cannot create from a
declaration alone (a set to enforce, or a hash), so `vocab.json` declares
neither.

A reference declares `ref` and `death`, and `app_deploy` refuses one without
`death`. `death` sets what happens to the row when the entity it points at is
deleted: `cascade` deletes the row, `detach` clears the property, `release`
removes the component, and `keep` leaves the reference as it is. The rule holds
across the space's apps: when another app deletes the entity a reference names,
the rule is carried out in this app too, moments after the delete. A query path
follows a reference of yours, as it follows the platform's own
(<https://yaks.app/docs/querying.md>): `.chore.room.doc.title~=Kitchen` for a
`chore` whose `room` property is a reference.

## Schema refusals and `graph_schema`

`graph_schema` reports the vocabulary: every component, its properties and their
types, for the app or the space you name. `graph_apply`'s input schema is the
generic bundle, `{entity: {eid}}` and any components, so it is the store that
refuses a property nobody declared.

A write or query naming a property that does not exist is refused, and the
refusal lists the whole component, with each property's type as its schema
declared it. Page requests to `./api/` endpoints and an agent's tools get the
same refusal, so one read answers the question:

    unknown property: recipe.calories — recipe has title (string),
      serves (number), minutes (number)

A write or query naming a component nobody declared is refused with an
explanation of how a new component is declared, never with what some other store
has:

    unknown component: dayline — the app's vocab.json does not declare it.
      Declare it there, like
      {"$defs": {"recipe": {"properties": {"serves": {"type": "number"}}}}},
      and deploy the app with app_deploy to install it · how to declare one:
      call guide with page components, or https://yaks.app/docs.md

A write to a property that exists but is set by the server (`created.at`,
`completed.via`) is refused too, naming the property, and nothing in the batch
is written. A row you read includes those stamps, so write back only the
properties you mean to change:

    created.at is server-owned (stamped); only trusted writers may write it

The identity is the exception: a row's `entity` is its address, so a write may
include the identity it read, `{entity: row.entity, …}`. Its `entity.archetype`
is set by the store, and a value sent for it is dropped.

## Reading an unset property

**It is present, with the value `null`.** A property of yours that has never
been written is on the row with the value `null`; it is not missing from the
row. So `'mood' in row.jotting` is true either way and is the wrong test; test
the value instead.

    { "jotting": { "written": "2026-04-11T12:00:00Z",
                   "mood": null, "pages": null, "aloud": null } }

    if (row.jotting.mood) …          // right
    if ('mood' in row.jotting) …     // always true

The same applies to the platform's own properties, including `doc.title`: a doc
with no title reads back as null, not `''`. `doc.body` is stored
content-addressed and reads back as null when there is none.

## Declaring components in vocab.json

An app declares its own components in a `vocab.json` at its root, and
`app_deploy` creates them in that app's store. The file is a JSON Schema
document, the format the platform uses internally: one `$defs` entry per
component, one `properties` entry per property, and nothing else around them:

    { "$defs": {
        "recipe": { "properties": {
          "serves":  { "type": "number" },
          "minutes": { "type": "number" },
          "source":  { "type": "string" } } },
        "cooked": { "properties": {
          "on":    { "type": "string", "format": "date-time" },
          "again": { "type": "boolean" } } } } }

After the deploy they work like any other component: write them in a bundle,
read them on the row, filter on them, and name them in a command.

    await apply({ entity: { eid: '$c' }, doc: { title: 'Chana masala' },
      recipe: { serves: 4, minutes: 35 } })

    let quick = await query('.recipe.minutes<=30&?doc')

A `title` on a component or a property names it in a person's words, and
`"readOnly": true` marks a property the app keeps for itself, which nobody fills
in (a slug, a sort position, a flag on sample rows). The column beside the
Operator's chat names what an app keeps by its titles and leaves the `readOnly`
properties out; the data editor labels its controls by the titles too, and shows
a `readOnly` value without a control to change it:

    "street2": { "type": "string", "title": "Address line 2" },
    "slug":    { "type": "string", "readOnly": true }

### Descriptions are the app's documentation

A `description` on a component says what it is and where a person sees it. On a
property, it says what the property takes, wherever its name does not already
say so. Together they are the app's documentation. Every agent that works in the
app reads them first, because `commands` naming the app answers with each
component, its properties and their descriptions. They also finish the sentences
of the generated `add_` and `find_` commands, and an installed copy carries
them, so they cannot drift from what they describe. A component of a town's
website:

    "meeting": {
      "description": "One meeting of a board, listed on the Meetings page and the calendar with its agenda and minutes beside it; anything but a regular meeting is also posted on the home page as a public notice",
      "properties": {
        "board":  { "type": "string", "ref": "board", "description": "The board that meets" },
        "starts": { "type": "string", "format": "date-time" },
        "kind":   { "type": "string", "description": "regular, special, emergency or hearing" },
        "place":  { "type": "string", "description": "Leave empty for the Township Hall" } } }

`starts` needs no description, since its name and format say it all. A component
with no description, and a reference or a flag with none, is a warning on the
app: `app_deploy` says it, and `app_errors` and `commands` naming the app go on
saying it until the description is written and deployed. Nothing is refused for
one, but an agent that meets it knows only its name. How the app is built
belongs here, not in `NOTES.md`, which holds the person's rules for their copy
([App Notes](./notes.md)).

You can write it as `vocab.yml` instead, if you find YAML easier to read: it is
the same manifest with fewer braces and quotes. An app that has both is deployed
from the `.yml`:

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

A component name starts with `a-z`, continues with `a-z0-9_`, is up to 40
characters, and may not be one of the platform's own component names. A property
name follows the same character rules and is checked against nothing else: only
`entity` and `eid` are refused, since those identify the row itself. So
`recipe.doc` is a valid property; it reads like a component, but `.recipe.doc`
addresses that property, not the `doc` component on the same row.

**Example: a chore board.** The status comes from the platform's `task`, so
declare only what the platform has no component for:

    { "$defs": {
        "chore": { "properties": {
          "room":       { "type": "string" },
          "every_days": { "type": "number" } } } } }

    await apply({ entity: { eid: '$c' },
      doc: { title: 'Descale the kettle' },
      chore: { room: 'kitchen', every_days: 90 },
      task: {}, filed: { priority: 2 } })

    await apply({ entity: { eid }, completed: {} })
    let left = await query('.chore&.task.status=open&?doc')

**Example: a reading list.** Two components, because a book and your reading of
it are two aspects: one is always true of the book, the other is yours and
changes:

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

    let unread = await query('.book&!reading&?doc')

`!reading` matches rows without the component: every book you have not started.

**Example: a recipe box with photos.** An app's own component refers to the
platform's blob:

    { "$defs": {
        "recipe": { "properties": {
          "serves":  { "type": "number" },
          "minutes": { "type": "number" } } },
        "photo": { "properties": {
          "caption": { "type": "string" },
          "blob":    { "type": "string" } } } } }

`photo.blob` is `text`: it holds the eid `upload` returned, and
`./api/blob/<eid>` serves the bytes.

**Array and object properties.** A value that is always written and read whole,
such as a recipe's tags or what one batch makes, is declared `array` or `object`
and written as itself: no `JSON.stringify` when writing, no `JSON.parse` when
reading.

    { "$defs": {
        "recipe": { "properties": {
          "tags":  { "type": "array", "items": { "type": "string" } },
          "makes": { "type": "object", "properties": {
            "amount": { "type": "number" },
            "unit":   { "type": "string" } } } } } } }

    await apply({ entity: { eid: '$r' }, doc: { title: 'Focaccia' },
      recipe: { tags: ['bread', 'vegan'], makes: { amount: 1, unit: 'tray' } } })

    let tagged = await query('.recipe.tags&?doc')

A query can test only whether such a value is present. `.recipe.tags` matches
every recipe with tags; a filter on its contents (`.recipe.tags=vegan`) or an
order by it is refused, naming the property. A value you will want to find rows
by should be a property of its own. The store checks the value against its type,
so a list sent where an object is declared is refused; `items` and `properties`
describe the contents for whoever reads the manifest, and the store does not
check inside the value.

**Full-text search on a property: `"search": true`.** A property can declare
more than its type. `"search": true` is the one to know: it adds that property's
text to the search index, so `search` finds a row by the text in that property,
as it already finds one by its title or its body.

    { "$defs": {
        "recipe": { "properties": {
          "serves": { "type": "number" },
          "method": { "type": "string", "search": true } } } } }

Only prose can be searched (a number, a date and a URL are matched by their
value, not read as text), so `"search": true` on any other property is refused
at deploy, in a message naming the property. A property that declares nothing
extra is stored and readable, and is not searched.

**Sync, persistence and privacy keywords.** `sync`, `durable`, `pace` and `save`
are declared beside `properties`, and so is `personal`, which makes a row
private to one person ("Private per-person rows: `personal`", below). For local
input, relayed movement, saved positions and disconnects, see Realtime Sync and
Persistence, <https://yaks.app/docs/storage.md>. Without these keywords a
component is an ordinary stored component: `sync: server`, `durable: forever`.

**Write permissions and rate limits: `floor` and `pace`.** Beside its
`properties`, a component can declare who may write it and how often each writer
may, and the store enforces both on every path a person writes through: the
page's `./api/apply` and `graph_apply` alike. On an `open` app, a `line`
component can require a signed-in person and allow each writing browser or
client to change a line once a second:

    { "$defs": {
        "line": {
          "floor": "person",
          "pace": "1s",
          "properties": { "level": { "type": "string" } } } } }

`floor` is the minimum a writer must hold, whatever the app's access: `person`
is anyone signed in; `viewer`, `editor` and `owner` require that role on the app
or a higher one. A write that adds, changes or removes the component by anyone
below the floor is refused, naming the component:

    someone signed out may not write line in <app> — only someone signed in may

`pace` is how often one vouched browser or client may change this component on
one entity: `"1s"`, `"500ms"`, `"5m"`. A write that comes sooner is refused,
saying when the writer may write again. Each other entity and each other
component has its own pace, so one batch may write many different lines. The
platform vouches for the writer's `via` independently of its person: guests have
their own pace, signing in keeps that pace, and separate instruments (browsers
or clients) of the same person have separate paces. A write with no `via` shares
the unnamed instrument's pace on that entity and component. Owners are subject
to the pace too. Writing the same values again is not a write, so a retried
request is not refused.

    line is written at most once every 1s by each writer — <via> may again in 400ms

Either refusal reaches a page as `refused` with that message
(<https://yaks.app/docs/errors.md>), and reaches an agent's tool as the same
message. Neither is a break: nothing is filed. A page that changes each line no
faster than its component’s pace is never refused. Call `me()` on load to learn
whether the person is signed in before they type.

**Rows kept to members: `readers`.** A component can also declare the least a
reader holds, whatever the app's access, with the same values as `floor`. An
entity wearing it is then seen only by such readers, through every read: a
query, a count, a live subscription, a search. A `public` or `open` app shows
everything else to anyone and keeps these rows from visitors with no role:

    { "$defs": {
        "signup": {
          "readers": "viewer",
          "properties": { "answers": { "type": "string" } } } } }

Here the app's viewers, editors and owners read every `signup`, and a visitor
signed out or holding no role reads none, nor counts them. The platform's
`registration`, a form's sign-up, declares `editor`, so only the people who run
the app read sign-ups, never its viewers. `readers` keeps rows from readers
only; who may write them is still `floor` and the app's access.

**Only some rows: `readers` with queries.** Instead of a floor, `readers` can be
an object mapping a floor to a query on the component's own properties. An
entity wearing the component asks the highest floor whose query its own row
matches, and asks nothing of its readers when it matches none, so it is read as
if the component declared no `readers`. A query that tests anything but the
component's own properties is refused at `app_deploy`, as is a floor that does
not exist, a query that does not parse and a property the component does not
declare.

`!=` matches a row whose property is absent, as `=` never does. A people
directory whose members join as viewers, where only members and attenders (and
people with no status, such as children listed with their parents) are shown to
viewers, and everyone else (former, nonmember, guest, any status added later) is
read by editors and owners alone, names the status it tests for being present:

    { "$defs": {
        "individual": {
          "readers": {
            "editor": ".individual.status&.individual.status!=member,attender"
          },
          "properties": {
            "first":  { "type": "string" },
            "phone":  { "type": "string" },
            "status": { "type": "string" } } } } }

`.individual.status` is true of a row with a status, so a row with none asks
nothing and every viewer reads it, and `!=member,attender` is true of any other
status. Writing `.individual.status!=member,attender` alone would keep the
people with no status from viewers too. The floor is kept on the entity when it
is written, so a write that changes `status` moves the person in or out of view
in the same commit, through every read and every live subscription. Adding or
changing a condition in `vocab.json` re-reckons every entity of the app in the
background at the next deploy; until it finishes, viewers read none of the rows
of a component whose conditions they might be kept from.

**One part of a row kept back: `shown`.** `readers` keeps a whole entity from a
reader. `shown`, with the same values as `floor`, keeps only its own component:
a reader below that floor reads the entity without it, through every read, and
finds nobody by querying it, while the entity's other components read as they
would. A directory whose members read each other's entries, but whose sign-up
forms record what each person asked for, keeps that list to its editors:

    { "$defs": {
        "interests": {
          "shown": "editor",
          "properties": {
            "choices": { "type": "array", "items": { "type": "string" } } } } } }

A form question whose `fills` is `interests.choices` adds what the person ticked
to their own `interests`, which their entry shows to the app's editors and
owners and to no viewer.

## Kinds: what a whole one carries

A kind names a combination of components: what makes an entity a meal, and what
a whole meal also carries. Without `kinds`, each component an app declares is a
kind of its own name. Declare `kinds` beside `$defs` when an entity of the app
is more than one component:

    { "$defs": {
        "dish":    { "description": "A dish someone cooks",
                     "properties": { "serves": { "type": "number" } } },
        "tasting": { "description": "How it went the last time",
                     "properties": { "stars": { "type": "number" } } } },
      "kinds": {
        "meal": { "description": "A dish cooked for a night, and how it went",
                  "is": ["dish"],
                  "with": { "doc": true, "tasting": { "stars": 0 } } } } }

- **`is`** lists the components an entity carries to be this kind. Left out, it
  is the component of the kind's own name. A row with `dish` reads back as
  `kind: "meal"`.
- **`with`** lists what a whole one also carries. `true` means whoever writes
  one supplies it. An object holds the values the store gives the component when
  an entity of the kind lacks it: writing `dish` through any door (a page, a
  command, `graph_apply`) also writes `tasting{stars: 0}` in the same write,
  unless the entity has a `tasting` already or the write sets one.
- **`description`** and `title` say what the kind is, and the generated
  `add_meal` and `find_meal` say it too. `examples` are whole bundles of one.

Once `vocab.json` declares `kinds`, those are the app's kinds: a component of it
is a kind only where it says `"kind": true` itself, so `tasting` gets no
commands of its own. A kind names only components the app declares, the
platform's (`doc`, `alias`), or those of its `"platform"` packages; any other
name is refused at the deploy. The Operator sees each of its space's apps with
its kinds, one line each:
`meal: dish{serves}, doc{title, body}; a rule adds
tasting{stars}`.

## Private per-person rows: `personal`

In an app shared between members (<https://yaks.app/docs/sharing.md>), every
member reads every row. A component that declares **`personal`** beside its
`properties` is the exception: each of its rows is private to one person, so a
friend can use the same app and never see another person's rows. The owner and
the editors also read only their own, and a guest who is not signed in reads
none.

`personal` takes one of two values.

- **`"personal": "by"`** makes the whole row private to the person a property
  names. That property is a reference to a person, declared with `ref` and
  `death` (a reference is the type `eid`, above). When a write omits it, it is
  set to the person writing.
- **`"personal": "entity"`** makes the component private on a person's own
  entity, the row whose eid is the person's. Only that person writes it, and
  only they read it; the entity's other components are unaffected.

`app_deploy` refuses a `personal` that names a property that is not a reference,
and says what to declare instead.

A diary where each member keeps their own notes and their own mood:

    { "$defs": {
        "note": {
          "personal": "by",
          "properties": {
            "text": { "type": "string" },
            "by":   { "type": "string", "ref": "entity", "death": "keep" } } },
        "mood": {
          "personal": "entity",
          "properties": { "today": { "type": "string" } } } } }

    let { person } = await me()
    await apply({ entity: { eid: '$n' }, note: { text: 'Psalm 23' } })
    await apply({ entity: { eid: person }, mood: { today: 'calm' } })

    let mine = await query('.note')

Another member running that code in the same app gets their own notes and their
own mood: `query('.note')` returns only the rows whose `by` is them, and a
`mood` written onto somebody else's entity is refused. Share the app
(`member_add`, <https://yaks.app/docs/sharing.md>) and each person starts with
none of the others' rows.

Your components belong to your app. No other app's store has them, and no other
app's rows can conflict with them, unless another app of the same person
declares the same name, which is covered on the next page, Cross-App Data
(<https://yaks.app/docs/entities.md>).

## Editing rows without building an interface

Every app has a data editor at `<app>/_web/data`, generated from its
`vocab.json`, so nobody has to build an admin page to change rows. Point people
at it when they want to post a notice, fix a row or attach a PDF: anyone holding
a level on the app opens it from their dashboard ("Edit data" on the app), an
owner or editor lists, adds, edits and removes rows, and a viewer reads them.

It lists each component the app declares, and rows that are only a `doc`. It
leaves out edges, `personal` components and components that are not kept (`sync`
other than `server`, `durable` other than `forever`). Each row gets its `doc`
title and text, then one control per property, from what the property declares:

- `{"type": "string", "ref": "blob", "death": "keep"}` (or a text property named
  `blob`) is a file: an upload, with a link to what is there.
- any other `ref` is a picker over the rows of the component it names, newest
  200 first; `ref: "entity"` picks from every row with a `doc`.
- `format: "date-time"`, `format: "uri"`, `number` and `boolean` get their own
  controls; a list of strings is one item per line; any other object or list is
  JSON.

So declare a meeting's files and links as references and the editor needs
nothing more: `"agenda": {"type": "string", "ref": "blob", "death": "keep"}`. A
component or property is labelled by its `title`, or by its name where it gives
none, and a property's `description` is shown under its control. A property
marked `"readOnly": true` is the app's to write: the editor shows its value as
text, with no control, never writes it, and leaves it off a new row's form.

## Changing the vocabulary across deploys

The rule: **a component or property is dropped only when nothing is stored under
it.**

- **Adding a property** takes a deploy, which reports `added: recipe.source`.
- **A property keeps its type while any row holds a value under it.** Declare
  `pages` as `text` where it was `number`, with pages already written, and the
  deploy is refused:
  `vocab.json: book.pages is
  already number — a property keeps the type its rows were written under`.
  A property with no stored values takes the new type, and the deploy reports it
  as `added`.
- **A property the new manifest no longer declares is kept while any row holds a
  value under it.** The deploy reports it:

      kept, not in vocab.json (the rows are there): note.text — name it in
      vocab.json again to keep writing it, or move its rows to the new word
      yourself, a row at a time with graph_query then graph_apply. Nothing is
      migrated behind you; once no row holds a value under it, the next deploy
      drops it.

  That line is how a rename shows up. Rename `minutes` to `mins` and you have
  two properties: the new one starts empty, the old one keeps every value
  already written, and rows read back as `"minutes": 46, "mins": null` until you
  move the values yourself. Clear the old values as you move them, deploy again,
  and `minutes` is dropped.

- **A component or property the manifest no longer declares is dropped once it
  holds nothing.** `dropped (nothing stored in it): jot, recipe.title`: the
  table or the column is removed, so a name you tried once or renamed does not
  stay in the app forever. A component that still has rows stays declared and
  writable.

- **The whole manifest is checked before anything is created.** A refusal names
  every conflict at once and leaves the store unchanged, so testing whether a
  name is free costs one deploy and changes nothing.

A deploy's report lists everything it did to the vocabulary: `components:`, then
`added:`, then `kept:`, then `dropped:`. Read it: it is the only place an
unfinished rename is ever reported.

## Reserved component names

A `vocab.json` may not declare any of the platform's own component names, so
that `doc` means `doc` in every store on the platform. A manifest that declares
one is refused entirely:

    vocab.json: comment, email are components the platform already declares
      — pick another name

The complete list of reserved names:

    _change _pace _privacy _tx about access account_alert account_usage
    acts_for alias answer app app_draft archetype archived artifact ask
    attachment attempt attribute_writes belief binding blob bounced browser
    budget build build_of builder builder_answer builder_dep builder_edit
    builder_model_answer builder_open builder_ring built call call_ready
    call_woken called calls cancel cancelled checkout chosen cites
    code_review comment commit comp compat completed connection contains
    content conversation cost counted created credit credit_block delegates
    delete_upload deliver delivered demo deploy desk_sidebar dispatch doc
    document_extract document_page document_text draft edge effect email
    entity entry error event exception execution failed favorite featured
    fee feed feedback file filed finding fired form form_guest form_mail
    form_phone form_post former gallery gitobj grant grants_listed heard
    heard_turn hearing held home hook hostname image inference install
    installed integration integration_install interrupted invite inviting
    key last_deploy lease lines mail mail_answered mail_dismissed
    mail_domain mail_post mail_task mcp_list mcp_server member memory
    mentions meter miss model model_reservation model_result newcomer
    newcomer_builds notice notice_confirmed notice_letter notice_posted
    notice_subscription notified notify_deaths notify_trash oauth_grant
    occupancy occurrence offer openai opened openrouter operator
    operator_alerts operator_reach order output output_of own_number parent
    pending person persona phone phone_line plan preview price product
    project provider provisional public_file published push_subscription
    quarantined question questions rating reads recalled recipient ref
    referenced refund_failed refund_request refund_retry refund_sale
    refund_sent refusal refusal_report register_writes registration
    release_remake report report_refusals repository representation requires
    restored result retired revision rtc rtc_lapse sale_access sale_artifact
    satisfies screen screenshot secret seeded seller sender sending serves
    service_checkout service_quote session session_input session_result
    session_run sfu shared signed_in signin skill sms_consent space
    space_logo speech_hear spend staged started starter stop stream_item
    submitted subscription supersedes supervises support sweep switched task
    text text_post theme tool tool_refusal topic trashed tree_entry trend
    tunnel tunnel_tell typed unchecked updated upstream usage uses using
    verified visit visitor_build visitor_calls visitor_share volume
    waitlisted wake wake_run wants watch web worked worktree written

A reserved name listed under Platform components above is in your store already,
and the refusal names its properties: when it means what you meant, such as
`event` for a calendar event, use it as it is and leave it out of `vocab.json`.
Otherwise name the component for its specific purpose: the reserved name is the
general one, and yours is the specific one. Not `comment` but `review`, not
`plan` but `menu`, not `gallery` but `album`, not `home` but `listing`. A prefix
such as `book_note` also works, but a distinct name reads better in a query,
which is where you use it most.

## Choosing between a property and `doc.body`

`doc.body` is text. Anything can be stored there, but it is meant for one thing:
**the text a person reads and search should find**, such as a recipe's method, a
note's text, or a book's blurb.

Use a property when the app will filter, sort, count or display the value as a
field: `serves`, `minutes`, `rating`, `started`. A query such as
`.recipe.minutes<=30` can filter on a property; the same number written into
`body` cannot be found by any query.

Use `body` when the value is prose, when it is long, or when it varies from row
to row in a way a property cannot describe. JSON can be stored in `body` too,
which suits a shape you have not settled yet; but once you want to filter on a
key inside it, make that key a property.

Do not store in a property what the graph already holds. Who wrote it is
`created.by`; whether it is done is `completed`; whether it is hidden is
`archived`; what it belongs to is `filed.project` or a `contains` edge. A second
copy in a declared property gets out of sync.

The exception is a date that belongs to the row's content. `created.at` is when
the store received the row, which is correct for a page someone is typing into
and wrong for anything imported or seeded, where it reads today for something
that happened in April. When the date is part of the row's data, store it in a
`time` property the app declares.

## When to split a component

The test is cohesion: **a component describes a single aspect of an entity.** If
half the properties are always written together and the other half are written
by a different action, at a different time, they are two components.

The reading list above is an example. `book` describes the book itself: it never
changes, and two people would agree on it. `reading` records what happened
between you and the book: it is written later, changes often, and might never be
written. Splitting them makes `.book&!reading` list the unread books, avoids a
row of nulls on a book not yet started, and leaves room for a lending app to add
a third component.

Split when either half can be true without the other. Keep one component when
the properties are always written and removed together, as `image` keeps `w` and
`h`.

## Edges: relations between entities

A relation between two entities is not a property on either. It is an edge: a
record of its own, naming the relation and the entity at the other end:

    await apply({ entity: { eid: menu },
      edges: { type: 'contains', child: recipe } })

    await apply({ entity: { eid: menu }, edges: [
      { type: 'contains', child: starter },
      { type: 'contains', child: pudding },
    ] })

An edge reads parent first: the entity you addressed `contains` the child. Both
ends must already exist, or be written in the same `apply` call. An edge naming
a missing entity is dropped on its own instead of refusing your write, and so is
an edge whose type is not one of these:

    requires  contains  reads  about  supervises  delegates
    recalled  supersedes  worked  referenced  wants  satisfies

Five of these are useful in an app: `contains` for a whole and its parts (a menu
and its courses), `requires` for one thing that waits on another, `about` for a
note aimed at a subject, `referenced` for a mention, and `supersedes` for a
version replacing the one before it. The rest are used by the platform
internally.

Note the exact name: the type is `referenced`, not `references`. A type the
store does not know is not refused; the edge is never created, so a typo fails
silently, and you notice only when nothing comes back.

A listing does not include edges (a query returns components), so an app that
displays a relation stores the other end where it can read it back: on the
child's own row, or as an eid in a `text` property the app declares. Deleting an
entity deletes every edge connected to it.

The whole guide is at <https://yaks.app/docs.md>; two apps writing about one
entity is Cross-App Data, <https://yaks.app/docs/entities.md>, and the full
query syntax is Query Syntax, <https://yaks.app/docs/querying.md>.
