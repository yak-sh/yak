# Components: the platform's, and your own

Every app's store speaks the same small vocabulary, and every app may add words
of its own. This page is that vocabulary column by column — what each holds and
when to reach for it — then `vocab.json`, what a later deploy may and may not
change, the names already taken, and how to choose between a column of your own
and text in `doc.body`.

## What a component is

A component is one named set of fields describing ONE aspect of an entity. An
entity is nothing but the components it wears: there is no `kind` column, no
table of types, no class to pick at creation. A row that wears `doc` has words a
person reads; the same row wearing `task` as well has a state; wearing `recipe`
too, it is a recipe. Take `task` off and it stops being work without stopping
being anything else.

    await apply({
      entity: { eid: '$cake' },
      doc: { title: 'Lemon cake', body: '3 lemons, 200g butter...' },
      recipe: { serves: 8, minutes: 50 },
    })

That is one entity, two sentences, one call. `kind` on the row you read back is
derived from what it wears — your own word wins, being the most specific thing
said about the row — and nothing in the store branches on it. Every component is
a PATCH: send the columns you are changing and the rest are left alone;
`column: null` clears one; `comp: null` takes the whole component off;
`{entity: {eid}, tombstone: {}}` kills the entity.

    await apply({ entity: { eid }, recipe: { minutes: 45 } })   // one column
    await apply({ entity: { eid }, recipe: { source: null } })  // cleared
    await apply({ entity: { eid }, recipe: null })              // not a recipe

## The platform's vocabulary

These words mean the same thing in every store on the platform. Each heading
gives the columns you may WRITE; a few carry server-set columns you can read but
never write, and those are named beneath.

**`doc`** — `title` (text), `body` (text). The words a person reads, and the
only thing `search` searches. Nearly every entity your app saves should wear
one: a row with no `doc` is invisible to search and has nothing to draw.

    await apply({ entity: { eid: '$c' }, doc: { title: 'Chana masala' } })

A body is stored content-addressed: the text becomes an entity of its own
wearing `blob`, and the `doc` row points at it. So `.doc!` answers your docs and
never those rows, and a filter like `*` or `.blob!` will show them.

**`task`** — `priority` (number), `project` (eid), `assignee` (eid), `domain`
(text). Anything with a state: a chore, a to-do, a suggestion waiting on
someone. Reach for it rather than inventing a `status` column of your own, and
the platform's own status grammar works on your rows.

`status` is READ, never written — `open`, `wip`, `done` or `cancelled`, derived
from what the entity wears: `cancelled` if it wears `cancelled`, else `done` if
it wears `completed`, else `wip` if it wears a live `claim`, else `open`.

    await apply({ entity: { eid: '$t' },
      doc: { title: 'Water the plants' }, task: { priority: 1 } })

    let todo = await query('.task.status=open&.doc?')

**`completed`** — `at` (time), `by` (eid). The mark that makes a task `done`.
The store fills both — the clock from the write, the writer from whoever is
asking — so `completed: {}` is the whole write, and taking it off again is
`completed: null`. It also carries a server-set `via`.

    await apply({ entity: { eid }, completed: {} })      // done
    await apply({ entity: { eid }, completed: null })    // open again

**`cancelled`** — `at` (time), `by` (eid), `reason` (text). Called off rather
than finished, and the one of the two that has somewhere to put why. Also
carries a server-set `via`.

    await apply({ entity: { eid }, cancelled: { reason: 'moved house' } })

**`project`** — `color` (text). A thing other rows belong to, by `task.project`.
Reach for it when your app has lists that own work — a household, a course, a
trip. The reference detaches when the project dies: the tasks live on with a
null `project`.

    let { aliases } = await apply({
      entity: { eid: '$p' }, doc: { title: 'Kitchen' },
      project: { color: '#a7c080' },
    })
    await apply({ entity: { eid }, task: { project: aliases.$p } })

**`comment`** — `target` (eid). A note aimed at ANY entity — a recipe, a photo,
another comment. The note's own words go in its `doc`. The comment dies with its
target, so a deleted recipe takes its thread with it.

    await apply({ entity: { eid: '$n' },
      doc: { body: 'Halve the sugar.' }, comment: { target: recipe } })

    let thread = await query(`.comment.target=${recipe}&.doc?`)

**`person`** — no columns. Whoever wrote a row. The store mints one for each
writer it meets, titled with what to call them, so `person` rows wear a `doc`
too. You read them for a byline. They are screened out of an ordinary listing,
so ask for them by name: `query('.person!&.doc?')` lists everyone this store has
met.

**`archived`** — no writable columns; the store sets `at` (time), `by` (eid) and
`via` (eid). The stamp that takes something out of the open list. Reach for it
rather than a `hidden` column of your own — every door knows it, and
`.archived=` is "everything not archived".

    await apply({ entity: { eid }, archived: {} })
    let open = await query('.recipe!&.archived=')

**`favorite`** — no writable columns; the store sets `at` (time). A one-word
star, one stamp per ENTITY rather than one per person: it says "this app has
starred this", not "you have".

**`web`** — `url` (url). An address out on the web: a bookmark, a source, the
page a recipe was copied from. Also carries a server-set `frozen_at`.

    await apply({ entity: { eid: '$b' }, doc: { title: 'The recipe' },
      web: { url: 'https://example.com/chana' } })

**`blob`** — `bytes` (number). A byte COUNT, not the bytes. It sits on the
content-addressed entity the bytes live at, so it is how big a file is.

**`attachment`** — `blob` (eid), `mime` (text), `name` (text). One file, as
`upload` writes it. `attachment.blob` is where the bytes are, which is what
`./api/blob/<eid>` is built from; deleting the bytes takes the row with them.

**`image`** — `w` (number), `h` (number). What a picture measures, on the BLOB
itself, not on the row that points at it. `upload` reads it off the file's own
header (png, jpeg, gif, webp), so a wall can hold a photo's space open before
its bytes arrive.

**`created`** — `by` (eid); the store sets `at` (time) and `via` (eid).
**`updated`** — the same three. The byline and the clock. You rarely write
either: the store stamps the writer and the moment on its own, and a listing
leaves them out unless the filter asks for them.

    for (let e of await query('.doc!&.created!')) draw(e, e.created.by?.name)

`created.at` is **when this store first saw the row**, and it cannot be given a
past moment — not by a page, not by `graph_apply`. So a row with a date of its
own carries that date in a `time` column of its own: when the diary entry was
written, when the message was left, when the seedling went in. That is not a
second copy of the stamp; they are two different facts, and they disagree
exactly when it matters — an import.

    { "entry": { "written": "time" } }

    graph_apply { app: 'diary', entities: [
      { doc: { body: 'Beans in, back bed.' },
        entry: { written: '2026-04-11T12:00:00Z' } } ] }

Seed a fortnight of a guestbook and every `created.at` says today, truthfully:
today is when you wrote them here. Draw `entry.written`.

**`exception`** — `at`, `message`, `stack`, `request`, `version`, all
server-set. **`error`** — `at`, `message`, server-set. The kernel's own rows
about your app: what a route threw, what a page reported. Nothing you write.
They stay out of every listing unless the filter names one (`.exception!`), and
`app_errors` is the door meant for them.

Not listed: `dependency`, which is an edge and not a component — last section.

## The column types

A column is one of these:

- `text` — one line, or many. The catch-all.
- `number` — stored as a SQLite real, so integers and decimals both fit.
- `bool` — true or false.
- `time` — an ISO 8601 timestamp with a zone, as text:
  `new Date().toISOString()`, or `'2026-04-11T12:00:00Z'` written by hand. It
  comes back exactly as it was sent, so it is a string on the way in and a
  string on the way out; `new Date(row.entry.written)` when you need to do
  arithmetic with it, and the ordinary comparisons filter it
  (`.entry.written>=2026-04-01`).
- `url` — an address out on the web; text with a link's face.
- `eid` — a reference to another entity. The platform's own words have these; a
  `vocab.json` cannot declare one (below).
- a closed set of words — the platform's alone; a refusal spells the set,
  `open|wip|done|cancelled`.

**Noon for a date.** When a `time` column really holds a DAY — the plants went
in, the meeting is on the 4th — write noon UTC, `2026-04-11T12:00:00Z`. Midnight
is the day before for everyone west of Greenwich, so a diary written at
`T00:00:00Z` renders a day early in California, and the page has to correct for
a zone it should never have had to think about.

The first five are the ones a `vocab.json` may spell. References, closed sets
and content-addressed bodies each carry machinery a store cannot plant from one
word — a foreign key, a set to enforce, a hash.

**No eid column of your own**, then: a component of yours cannot point at
another entity by declaring one. Where a row of yours needs to be ABOUT another
row, the platform already has the word for it — `comment.target` is an eid aimed
at any entity, and a `dependency` edge is the other way to say it. A history
component (a chore's ticks, a diary's plantings) is the case that wants this;
until it can be declared, hang the ticks off `comment.target` or make each tick
its own entity carrying the parent's eid in `comment.target`.

## What a refusal tells you

Name a column that is not there and the refusal spells the WHOLE shape, at both
doors, so one look ends the guessing:

    unknown column: recipe.calories — recipe has title (text),
      serves (number), minutes (number)

    no such prop: .recipe.mins — recipe has title (text), serves (number),
      minutes (number)

Name a component nobody declared and the refusal says where a new word comes
from, never what some other graph has:

    unknown component: dayline — a component of your own is declared in
      vocab.json and planted by app_deploy:
      {"recipe": {"title": "text", "serves": "number"}}
      · https://yaks.app/guide.md

A column that exists but is the server's (`created.at`, `completed.via`) is
neither refused nor written. It is dropped in silence, so a row you read and
patch straight back is never punished for carrying its own stamps.

## What an unwritten column reads back as

**Null, and present.** A column of yours that nothing has ever written is on the
row with the value `null` — not missing from it. So `'mood' in row.entry` is
true either way and is the wrong test; the value is the right one.

    { "entry": { "written": "2026-04-11T12:00:00Z",
                 "mood": null, "pages": null, "aloud": null } }

    if (row.entry.mood) …          // right
    if ('mood' in row.entry) …     // always true

The platform's own `doc.title` is the exception worth knowing: it has a default,
so a doc nobody titled answers `''` rather than null. `doc.body` is kept as a
content-addressed blob and answers null when there is none.

## Components of your own

An app names its own components in a `vocab.json` at its root, and `app_deploy`
plants them in that app's store. One object, one key per component, one typed
column per entry — nothing around it:

    { "recipe": { "serves": "number", "minutes": "number",
                  "source": "text" },
      "cooked": { "on": "time", "again": "bool" } }

After the deploy those are components like any other: write them in a bundle,
read them back on the row, filter on them, name them in a `tools.json`.

    await apply({ entity: { eid: '$c' }, doc: { title: 'Chana masala' },
      recipe: { serves: 4, minutes: 35 } })

    let quick = await query('.recipe.minutes<=30&.doc?')

A component name is `a-z`, then `a-z0-9_`, up to 40 characters, and may not be
one of the platform's words. A COLUMN name follows the same spelling and is
checked against nothing else — only `entity` and `eid` are refused, since those
name the row itself. So `recipe.doc` is a legal column; it just reads like a
component, and `.recipe.doc` addresses it rather than the doc beside it.

**A chore board.** The state is the platform's, so declare only what the
platform has no word for:

    { "chore": { "room": "text", "every_days": "number" } }

    await apply({ entity: { eid: '$c' },
      doc: { title: 'Descale the kettle' },
      chore: { room: 'kitchen', every_days: 90 },
      task: { priority: 2 } })

    await apply({ entity: { eid }, completed: {} })
    let left = await query('.chore!&.task.status=open&.doc?')

**A reading list.** Two components, because a book and your reading of it are
two aspects — one is true of the book forever, the other is yours and changes:

    { "book": { "author": "text", "pages": "number", "isbn": "text" },
      "reading": { "started": "time", "finished": "time",
                   "rating": "number" } }

    await apply({ entity: { eid: '$b' }, doc: { title: 'Piranesi' },
      book: { author: 'Susanna Clarke', pages: 245 } })

    await apply({ entity: { eid },
      reading: { started: new Date().toISOString() } })

    let unread = await query('.book!&.reading=&.doc?')

`.reading=` asks for the component's absence — every book you have not begun.

**A recipe box with pictures.** Your word points at the platform's:

    { "recipe": { "serves": "number", "minutes": "number" },
      "photo": { "caption": "text", "blob": "text" } }

`photo.blob` is `text` and not `eid`, because a manifest cannot declare a
reference. It costs nothing here: it holds the eid `upload` answered with, and
`./api/blob/<eid>` serves the bytes.

Your words are yours. No other app's store has heard of them, and no other app's
rows can collide with them — unless a sibling app of the same person names the
same word, which is the next page.

## How a vocabulary evolves

The rule is one sentence: **columns only ever arrive.**

- **Adding a column** is a deploy. The answer says `added: recipe.source`.
- **A column that already exists is never retyped.** Declare `pages` as `text`
  where it was `number` and the deploy is refused:
  `vocab.json: book.pages is
  already number — a column keeps the type its rows were written under`.
- **A column the new manifest stops naming does not go away.** Its rows are
  still there, and the deploy says so:

      kept, not in vocab.json (the rows are there): note.text — name it in
      vocab.json again to keep writing it, or move its rows to the new word
      yourself, a row at a time with graph_query then graph_apply. Nothing is
      migrated behind you.

  That line is what makes a RENAME visible. Change `minutes` to `mins` and you
  have two columns: the new one arrives empty, the old one keeps every row
  already written, and rows read back say `"minutes": 46, "mins": null` until
  you move them yourself.

- **A whole component the manifest stops naming is dropped if it holds no rows
  and kept if it holds any.** `dropped (no rows): jot` — the table goes with the
  word, so a name you tried once does not stay in the app forever. A component
  with rows stays declared and stays writable.

- **The whole manifest is read before anything is planted.** A refusal names
  every collision at once and leaves the store as it was, so probing for a free
  name costs one deploy and leaves nothing behind.

Everything a deploy did to the vocabulary is in its answer: `components:` then
`added:` then `kept:` then `dropped:`. Read it — it is the only place a
half-finished rename is ever mentioned.

## The words already taken

The platform's own vocabulary is refused in a `vocab.json`, so that `doc` means
`doc` in every store on the platform. A manifest reaching for one is refused
whole:

    vocab.json: card, entry are words the platform already says — pick
      another name

These are the names, all of them:

    about accept alias anchor app apply architecture archived attachment
    attention bash blob blocked board brief bug call camera cancel cancelled
    canvas card chat checkpoint claim client comment commit completed
    conflict contains content created cursor decided delegates deliver
    delivered deploy design doc dream edge effect email entity entry error
    exception exit favorite feedback fetch finding fixer fold fork
    generation goal graph_query headers hook hostname image imported
    installed knock layout lease mail member memory message meta meter model
    nofix notice notified noverify opaque opened output pane patch person
    persona pin plan project prompt proposed published quarantined reads
    reasoning recall recalled redaction references repo report requires
    response result resume review role run runner runtime satisfies session
    setting settled shelf signin space spawn stderr stop_request
    subscription supersedes supervises task task_context timeout tool
    updated usage venture verifier wake wants web worked worktree yield

When your first choice is taken, ask what the word is FOR and name that: the
taken word is the general one, yours is the specific one. Not `card` but
`flashcard`, not `entry` but `weigh_in`, not `plan` but `menu`, not `board` but
`standings`. A prefix works too — `book_note` — but a word of its own reads
better in a filter, and the filter is where you meet it most.

## A column, or `doc.body`?

`doc.body` is text. Anything can live there, and one thing should: **the words a
person reads and search should find.** A recipe's method, a note's prose, a
book's blurb.

Reach for a COLUMN when the value is one the app will filter, sort, count or
draw as a field — `serves`, `minutes`, `rating`, `started`. Those are the things
`.recipe.minutes<=30` can ask about; the same number written into `body` is
invisible to every query.

Reach for `body` when the value is prose, when it is long, or when it varies
from row to row in a way a column cannot describe. JSON keeps in `body` too,
which is the right answer for a shape you have not settled — but the moment you
want to filter on a key inside it, that key wants to be a column.

Do not put in a column what the graph already holds. Who wrote it is
`created.by`; whether it is done is `completed`; whether it is hidden is
`archived`; what it belongs to is `task.project` or a `contains` edge. A second
copy in a column of your own only drifts.

The exception is a DATE the row itself has. `created.at` is when the store saw
the row, which is the right answer for a page someone is typing into and the
wrong one for anything imported or seeded, where it says today about something
that happened in April. When the date is part of what the row IS, it is a `time`
column of yours.

## One component, or a wider one?

Cohesion is the test: **a component describes a single aspect of an entity.** If
half the columns are always written together and the other half are written by a
different act, at a different time, that is two components.

The reading list above is the case. `book` is what the book IS — it never
changes, and two people would agree on it. `reading` is what happened between
you and it: it arrives later, changes often, and might never arrive. Splitting
them buys `.book!&.reading=` for the unread, spares an unstarted book a row of
nulls, and leaves room for a lending app to add a third sentence.

Split when either half can be true without the other. Keep one component when
the columns are born together and die together — `image` is `w` and `h`.

## Edges are sentences, not columns

A relation between two entities is not a column on either. It is a `dependency`
— a whole sentence naming its verb and its far end:

    await apply({ entity: { eid: menu },
      dependency: { type: 'contains', child: recipe } })

    await apply({ entity: { eid: menu }, dependency: [
      { type: 'contains', child: starter },
      { type: 'contains', child: pudding },
    ] })

The sentence reads parent first: the entity you addressed `contains` the child.
Both ends must already exist, or arrive in the same batch — an edge naming a
missing endpoint is dropped on its own rather than refusing your write, and so
is an edge whose type is not one of these:

    requires  contains  reads  about  supervises  delegates
    recalled  supersedes  worked  referenced  wants  satisfies

For an app, five carry their weight: `contains` for a whole and its parts (a
menu and its courses), `requires` for one thing that waits on another, `about`
for a note aimed at a subject, `referenced` for a mention, and `supersedes` for
a version replacing the one before it. The rest are the platform's own
machinery.

Note the spelling: the type is `referenced`, not `references`. A type the store
does not know is no refusal — the edge is simply never made — so a misspelling
is silence, and you notice by nothing coming back.

A listing does not carry edges — a filter answers components — so an app that
draws a relation keeps the far end where it can read it back: the child's own
row, or an eid in a `text` column of your own. Delete an entity and every edge
touching it goes with it.

The whole guide is at <https://yaks.app/guide.md>; two apps writing about one
entity is <https://yaks.app/guide/entities.md>, and the filter grammar in full
is <https://yaks.app/guide/querying.md>.
