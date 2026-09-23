---
doc:
  title: 'Querying: the filter grammar'
guide:
  slug: querying
  brief: the filter grammar, with examples
  description: >-
    The one filter grammar, used everywhere a store is read, with worked
    examples: presence and absence, contains, comparisons, ranges, time
    phrases, walking a reference, counting, windows, full text — and why a row
    carries only the components its filter named.
---

# Querying: the filter grammar

One grammar reads an app's store, and everything that reads one uses it:
`query()` and `subscribe()` on a page, `GET ./api/query` underneath them,
`graph_query` in an agent's tools, a `query` in the app's own `tools.json`, and
`env.STORE.fetch` from a worker. This page is that grammar with its examples —
what selects rows, what a row comes back carrying, and the handful of things
this store will not do.

The examples are a kitchen app: a `vocab.json` declaring

    { "$defs": {
        "recipe": { "properties": {
          "serves":  { "type": "number" },
          "minutes": { "type": "number" },
          "cuisine": { "type": "string" } } },
        "chore": { "properties": {
          "every": { "type": "number" } } },
        "reading": { "properties": {
          "pages":   { "type": "number" },
          "started": { "type": "string", "format": "date-time" },
          "done":    { "type": "boolean" } } } } }

beside the platform's own components — `doc`, `task`, `comment`, `archived`,
`created` and the rest.

## The shape of a filter

A filter is predicates joined by `&`. Each one is a dot, a component, a
property, an operator, a value:

    .recipe.minutes<=30
     ^      ^       ^ ^
     |      |       | value
     |      |       operator
     |      property of that component
     component

    await query('.recipe.minutes<=30&.doc?')

    GET ./api/query?.recipe.minutes<=30&.doc?

Every predicate must hold — `&` is an intersection, never an "or". (Any-of lives
inside one predicate, below.) A predicate ends where the next `&` begins, so two
of them run together is not a longer filter but a mistake, and the store tells
you so:

    .recipe!.doc!
    → presence filters end at !: .recipe! — join filters with &:
      .recipe!&.doc!

Your own components must be written _qualified_ — `.recipe.serves`, never
`.serves` — so a component you invent can never change what `.title` means in
somebody else's store. The platform's properties do work bare (`.title~=lemon`
is `.doc.title~=lemon`), but write the component anyway: it reads better, and it
never becomes ambiguous.

An empty filter selects nothing. There is no "everything" — `query('')` and a
bare `query('limit=50')` both return `[]`. To list what you saved, name a
component those rows have: `.doc!`, `.recipe!`.

## Asking for a component

Four ways to name a component rather than one of its properties:

    .recipe!      has a recipe
    .recipe=      has no recipe
    .recipe?      asks for the recipe without filtering on it
    *             every component this store holds (the debugging form)

`!` and `=` _select_. `?` selects nothing and screens nothing — it only asks for
the component to come back with whatever the rest of the filter selected:

    await query('.chore!&.completed=&.doc?')   // chores not yet done
    await query('.recipe!&.doc?')              // recipes, with their titles

`?` is safe for a component this store never planted: asking for one is not
claiming it exists, so `.recipe!&.loan?` returns the recipes and simply leaves
the loan off. `.loan!` for a component that was never planted is refused
instead, because an empty answer would lie about what is there.

`*` returns every component of every row it selected. Use it when you are
looking rather than drawing:

    await query('.doc.title~=drizzle&*')

It is part of the filter, so it works wherever a filter does: `subscribe()`
keeps running the same query, and the updates it sends carry the same whole
rows.

## What an answer carries

**A row carries only the components its filter named.** This is the one rule to
hold on to, because the mistake it prevents is a page that draws `undefined`.

A row is `{kind, entity: {eid}, ...those components}`. So this is the wrong
page:

    for (let r of await query('.recipe!')) {
      draw(r.doc.title)                  // TypeError: no doc on the row
    }

    → [{ kind: 'recipe', entity: {eid: '940d…'},
         recipe: {serves: 4, minutes: 20, cuisine: 'american'} }]

and this is the right one:

    for (let r of await query('.recipe!&.doc?')) {
      draw(r.doc.title, r.recipe.minutes)
    }

    → [{ kind: 'recipe', entity: {eid: '940d…'},
         doc: {title: 'Pancakes', body: 'flour, milk, eggs'},
         recipe: {serves: 4, minutes: 20, cuisine: 'american'} }]

Anything a predicate mentions counts as naming it, whichever operator it uses:
`.doc.title~=cake` carries the doc, `.task.status=open` carries the task,
`.created.at=today` carries the stamp. Three things do _not_ name one: an
absence (`.archived=` asks for rows without one — there is nothing to carry),
the `*` form, which asks for all of them, and a bare word, which searches the
docs without naming anything to leave out — so a filter that is only words
returns whole entities, like `id=`.

A property of yours that nothing has written is on the row with the value
`null`, not missing from it, so test the value and not `in`. The platform's own
properties read back the same way, `doc.title` included.

`entity` and `kind` are on every row: `entity.eid` is the address to write back
to — the only name an entity has here — and `kind` is what the entity is, the
first component it has, one of your own included.

Three kinds of row are left out of a listing unless the filter names them: the
platform's stamps (`.created!`, `.updated!`), the platform's own error rows
(`.exception!`, `.error!`), and the `person` rows the store keeps so a byline
has a name (`.person!`). What comes back is what your app saved.

`subscribe(filter, cb)` returns the same rows by the same rule, so a page swaps
one for the other and nothing else changes.

## The operators

    .recipe.cuisine=thai          equals
    .recipe.cuisine!=thai         not
    .doc.title~=drizzle           contains, case-insensitive, literal
    .recipe.minutes<30            less than
    .recipe.minutes<=30           at most
    .recipe.serves>4              more than
    .recipe.serves>=4             at least
    .recipe.cuisine=thai,british  any of
    .recipe.minutes=20..35        a range, both ends included
    .recipe.minutes=20...35       a range, the end excluded
    .recipe.cuisine=              the property is empty or absent
    .recipe.cuisine~=             the property is there at all

A number property compares numerically and every other property as text, which
is why an ISO stamp compares correctly as text. A comparison a property's type
cannot make — `.recipe.serves>many` — is refused rather than guessed at.

A list and a range are values, not extra syntax: `.recipe.cuisine!=thai,indian`
is "neither", and `.recipe.minutes!=20..35` is "outside that band".

**`!=` also matches a row that lacks the property entirely** — nothing there is
not `thai`. When you mean "has a cuisine, and it is not thai", write both:

    await query('.recipe!&.recipe.cuisine!=thai&.doc?')

`~=` is a plain substring test on the stored text, not full-text search: it
finds `drizzle` inside `Lemon drizzle`, and it will not stem, rank, or match
across a word boundary. Bare words do that (below).

## Values, by type

The platform's own properties are typed, and a value that cannot be one is
refused loudly rather than quietly matching nothing:

    .task.status=finished
    → task.status is one of open, wip, done, cancelled — got 'finished'

    .filed.priority=high
    → priority is a finite number, optionally P-prefixed (P2, p02, 1.5)
      — got 'high'

- **text** — as typed. `.doc.title~=cake`
- **number** — `.recipe.serves>=4`, decimals fine.
- **enum** — `task.status` is `open`, `wip`, `done` or `cancelled`. It is read,
  never written: `.task.status=done` selects the entities that have a
  `completed`.
- **priority** — a number, and `P` is optional: `.filed.priority<=2` and
  `.filed.priority<=P2` ask the same thing.
- **time** — a stamp or a phrase; the next section is only about those.
- **url** — text with a shape. Quote it (below), or the `&` in its query string
  starts a second predicate.
- **eid** — a reference to another entity, by its eid: `.comment.target=940d…`,
  `.filed.assignee=dc5e…`, `.created.by=<who.person>`.

Your _own_ properties work differently: they are stored as given and compared as
text, with no parsing on either side. Two consequences worth knowing before you
design a component:

- A `bool` of yours lands in the store as `1` or `0`, so filter it that way —
  `.reading.done=1` finds the finished ones, `.reading.done=true` finds nothing.
- A `time` of yours is kept verbatim and compared as text, so write ISO stamps
  (`new Date().toISOString()`) and compare with ISO:
  `.reading.started>=2026-01-01` works, while `.reading.started=today` matches
  only a row whose value is the literal text `today`. Time phrases are for the
  platform's stamps.

Numbers of yours still compare as numbers — `.recipe.serves>=4` — because both
sides read as numbers.

## Time phrases

A time phrase is a range, and the operator picks which edge of it you mean:

    =   within it            .created.at=today
    >=  from its start       .created.at>=2026-01-01
    <=  until its end        .created.at<=yesterday
    >   after it ends        .created.at>last-week
    <   before it starts     .created.at<today

The phrases:

    now                       today  yesterday  tomorrow
    this|last|next minute|hour|day|week|month|year
    5 minutes ago             2 hours ago   3 days ago   (also 5m, 2h, 3d)
    in 2 days                 after 8h
    9am   9:30pm   14:00   noon   midnight   9am tomorrow
    2026-07-04                a whole day
    2026-07-25T09:00          a minute; with seconds, a second

Whitespace separates predicates, so join a phrase with `-` or `_`, or quote it:

    await query('.doc!&.created.at>=1-hour-ago')
    await query('.doc!&.created.at>="1 hour ago"')

A phrase is read fresh every time the query runs, so a saved `today` still means
today tomorrow. Weeks start Monday. Day boundaries are local time.

## The platform's stamps

Every row the store keeps is stamped with who saved it and when. The stamps sit
in components of their own, so they are asked for by name and left out of a
listing that does not name them:

    .created!        who saved it and when
    .created.at      when                (time)
    .created.by      who                 (a reference)
    .updated.at      when it last changed
    .updated.by      who changed it

    await query('.recipe!&.created!&.doc?')

    → [{ kind: 'recipe', entity: {…},
         doc: {title: 'Lemon drizzle', body: '…'},
         created: {by: {eid: 'dc5e…', name: 'Maya'},
                   at: '2026-09-03T12:59:27.876Z', via: null},
         recipe: {serves: 8} }]

A reference to somebody this store has met reads back as `{eid, name}`, so one
query draws a list with its bylines. Anything else stays the bare eid.

`at` and `by` are shared by several components, so write out which one you mean:
`.created.at`, `.updated.by`, `.completed.at`, `.archived.at`. Some lines that
come up:

    .doc!&.created.by=<who.person>&.doc?      what this person saved
    .doc!&.updated.at>=today&.doc?            what changed today
    .doc!&.created.by!&.doc?                  the rows that have a byline
    .doc!&.created.at=last-week&.created!     last week's, with the stamp

## Quoting

Quotes hold a value together against both separators — whitespace and `&`:

    await query('.doc.title~="Lemon drizzle"')
    await query('.web.url="https://x.test/p?a=1&b=2"&.web?')

Unquoted, the `&` in that URL would end the predicate and start a second one.
Quoting is how you avoid that; percent-encoding a value with an `&` in it does
not survive the trip, because the HTTP endpoint decodes each part of the query
string before the grammar reads it. Quote it.

A value with a space but no `&` survives on its own —
`.doc.title~=Lemon drizzle` is one predicate — but only until something else is
added to the filter. Quoting always works, so quote.

## Walking a reference

A dotted path walks a reference property and tests a property on the far side.
Every hop but the last must be a reference:

    .comment.target.doc.title~=Pancakes    comments on the pancake recipe
    .filed.project.doc.title~=Kitchen       tasks in the project called Kitchen
    .assignee.title~=maya                  bare: filed.assignee → doc.title

Only the platform's properties can be references — a `vocab.json` property is
`text`, `number`, `bool`, `time` or `url` — so paths walk `comment.target`,
`filed.project`, `filed.assignee`, `attachment.blob`, and the `by` of each
stamp. Point at another entity from your own component by keeping its eid in a
`text` property; it holds the address, but a path will not walk it.

The plural form walks the other way — the entities pointing back at this one:

    .comments!                    has at least one comment
    .comments=                    has none
    .comments>=2                  has two or more (any comparison works)
    .comments.doc.body~=butter    has some comment mentioning butter
    .comments!.doc.body~=butter   has none mentioning butter
    .comments!.doc.body!=butter   every comment mentions it (De Morgan)

The name is the component's plural — `.comments` are the entities whose
`comment.target` names this row. When a component has two reference properties
the name picks which one: `.tasks_project` are the projects that have tasks,
`.tasks_assignee` the people who do; `.attachments` are the blobs a file row
points at.

    // the recipes nobody has said anything about
    await query('.recipe!&.comments=&.doc?')

    // whoever has been given something to do
    await query('.tasks_assignee!&.doc?')

And `.refs` is the union of all of them — everything pointing at one entity, by
whichever property:

    await query(`.refs=${eid}&.doc?`)   // what mentions this
    await query('.refs=&.doc?')         // what mentions nothing

## Counting and tallying

Three directives return a value instead of rows. They sit beside the filters
that select what they reduce, and they read from the index — a page that wants a
number asks for the number, never for the rows to count.

    await query('.recipe!&.count!')
    → {count: 3}

    await query('.recipe!&.tally=recipe.cuisine')
    → {tally: {american: 1, british: 1, thai: 1}}

    await query('.recipe!&.distinct=recipe.cuisine')
    → {distinct: ['american', 'british', 'thai']}

`.count!` counts what the rest of the filter selects. `.tally=` counts each
value of one property; `.distinct=` returns those values themselves, sorted.
Both name one property, never a path, and your own properties must be written
with their component — `.tally=recipe.cuisine`, not `.tally=cuisine`.

The answer is an object, not an array, so a page has to branch on which it asked
for. Ask for one aggregate at a time: with two in one filter, only the first is
used.

    let { count } = await query('.chore!&.completed=&.count!')
    badge.textContent = `${count} to do`

## Windows

A window bounds the answer without changing what matches.

    limit=20            the newest 20 matches

A plain listing is oldest first, in the order the rows were written. A windowed
listing is the newest that many — still in that same oldest-first order among
themselves. So `limit` is the front page of a feed:

    let page = await query('.doc!&limit=20')

Both forms work — `limit=20` and `.limit=20` are the same window — and a bad
bound is refused rather than dropped:

    .limit=abc
    → .limit takes a whole number: .limit=200

Remember that a window without a filter is nothing: `limit=50` alone returns
`[]`, because an empty filter selects nothing.

## One entity, whole

    await query(`id=${eid}`)

`id=` addresses instead of selecting, and an address names no component to leave
out — so it returns the whole bundle, stamps and all. Several at once is a comma
list, or a repeat:

    await query(`id=${a},${b}`)

Name a component beside it and you are back to the ordinary rule:
`id=<eid>&.doc?` returns that entity's doc alone. Anything the store minted an
eid for is addressable this way, including a blob you uploaded.

## Words

A bare word is a full-text term over every doc — title and body — and the answer
comes back ranked, best first:

    await query('lemon')
    await search('lemon')                  // the same search
    await query('lemon&.recipe!&.doc?')    // ranked, and only recipes

    → [{ kind: 'recipe', entity: {…},
         doc: {title: 'Lemon drizzle', body: '3 lemons, 200g butter'},
         recipe: {minutes: 50, serves: 8},
         rank: {title: 'Lemon drizzle', snip: '3 \x01lemons\x02, 200g butter',
                score: 2.0000017} }]

A word names no component to leave out, so — like `id=` above — a filter that is
only words returns the whole entity, the app's own components included. That is
what lets a page draw cards straight from a search. Name a component beside the
word and you are back to the ordinary rule: `lemon&.recipe!` returns recipes
with no titles, `lemon&.recipe!&.doc?` returns both.

`rank` is added to the row for a text query and is never stored. Its `snip`
marks the hit with `\x01` and `\x02` so a page can wrap them in whatever it
likes — never HTML from the store.

Terms match whole tokens: `lemon` does not find `lemons`. A trailing `*`
prefix-matches, and quotes make a phrase:

    await query('lemo*')
    await query('"coconut milk"')

Words and filters mix freely in one filter, which is why a search box can hand
its whole string to `query()` and a saved filter is a valid search.

## What this store will not do

Two pieces of the wider platform grammar are refused in an app's store, by name,
rather than quietly doing something else:

    .doc!&work=build       → work lanes are not served by this store
    .doc!&.order=similar   → semantic ranking is not served by this store

There is no vector search in an app's store, so `.near=<eid>` alone changes
nothing about the answer — do not reach for it. Ranking is what a text term
gives you.

`.kind=` knows the platform's own components only (`.kind=task`,
`.kind=comment`); a component of your own is not a kind to it, and
`.kind=recipe` is refused. Ask for the component instead — `.recipe!` — which is
what you meant.

Everything else the grammar has, this store serves.

## A dozen filters that answer something

    .recipe!&.doc?
      every recipe, with its title and body

    .recipe.minutes<=30&.doc?
      what you can cook in half an hour

    .recipe.cuisine=thai,vietnamese&.doc?
      two cuisines at once

    .doc.title~=lemon&.recipe!
      recipes whose title contains lemon — a substring, not a search, and the
      title predicate already asked for the doc

    .chore!&.completed=&.doc?
      the chores still to do

    .chore!&.completed.at=today&.doc?
      the chores done today

    .chore!&.count!
      how many chores there are, without listing one

    .task.status=open&.tally=filed.domain
      how much open work each part of the house has

    .reading!&.reading.done=1&.reading.started>=2026-01-01&.doc?
      books finished since the new year (your own bool is 1, your own time
      is ISO text)

    .recipe!&.comments=&.doc?
      recipes nobody has commented on

    .doc!&.created.by=<who.person>&.created!&limit=20
      the newest twenty things this person saved, with their stamps

    id=<eid>
      one entity, whole, however many components it has

The whole guide is at <https://yaks.app/docs.md>.
