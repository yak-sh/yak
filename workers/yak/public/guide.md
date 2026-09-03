# Building an app on yaks.app

An app is an `index.html` and whatever files sit beside it, served live at
`<space>.yaks.app/<app>/`. There is no build step and no framework: what you
write is what the browser gets. Every app comes with its own store — a graph of
entities — and a small client for reading and writing it from the page.

Make one with `app_new`, write files with `app_files` — the whole set in one
call, as `files: [{path, content}, ...]` — then `app_deploy`, and give the
person the URL.

## The store, from a page

The kernel serves a client beside every app, at `./api/client.js`:

    <script type="module">
      import { apply, query, search, subscribe } from './api/client.js'
    </script>

Four functions, all same-origin, all talking to this app's own graph:

- `apply(bundles)` saves. One bundle or an array; it answers
  `{ok, changes, aliases}`.
- `query(filter)` lists. The filter line below.
- `search(text)` finds words across the app's docs, ranked.
- `subscribe(filter, cb)` is `query` that keeps answering.

`subscribe` is how a page stays true while it is open: it calls back with the
rows now and again on every change to them, including one made on the person's
other device, and it hands back a function that stops it.

    let stop = subscribe('.doc!', (recipes) => draw(recipes))

A refusal throws with the server's own sentence, so `try/catch` and show it. Who
may read and write is the app's `access`: `public` (the default) reads to anyone
with the link and writes to a member, `open` writes to anyone with the link —
the vote page, the shared list — and `private` answers members only. `app_new`
and `app_set` set it; `member_add` invites someone into the space by email
address — name the app and the invitation is mailed to them, carrying its link —
and they sign in there with that address and come back to the page they were on.

## What you save

An entity is a bundle: `{entity: {eid}, ...components}`. A component is a named
set of fields the entity carries. `entity.eid` names one that already exists; a
`$alias` in its place mints a new one, and `aliases` in the answer says what eid
it became. A `$alias` — or a whole nested bundle — stands in wherever an eid
goes.

    let saved = await apply({
      entity: { eid: '$cake' },
      doc: { title: 'Lemon cake', body: '3 lemons, 200g butter...' },
    })

    let recipes = await query('.doc!')   // every one, oldest first
    let lemony = await search('lemon')   // the ones about lemons

A second component on the same entity is a second sentence about it — here, one
to make again:

    await apply({
      entity: { eid: saved.aliases.$cake },
      task: { status: 'open', priority: 1 },
    })

    let toMake = await query('.task.status=open')

Each row comes back the way it went in, plus its address:

    { kind: 'task', entity: { eid: '4f3c...', num: 12 },
      doc: { title: 'Lemon cake', body: '3 lemons, 200g butter...' },
      task: { status: 'open', priority: 1 } }

To change one, send its eid with just the fields you are changing; omitted
fields are left alone, and `null` clears one. `{entity: {eid}, tombstone: {}}`
deletes it.

## Who wrote it

The store stamps every row with who saved it. Ask for the stamp with
`.created!`, and read the names once — a person is a row here too, titled with
what to call them:

    let by = new Map((await query('.person!'))
      .map((p) => [p.entity.eid, p.doc.title]))

    for (let e of await query('.doc!&.created!')) draw(e, by.get(e.created.by))

People stay out of an ordinary listing — `query('.doc!')` answers what the page
saved — so `.person!` is how you ask for them.

## The components an app has today

The platform's own vocabulary, shared by every app:

- `doc` — `title`, `body`. The words a person reads; what `search` searches.
- `task` — `status` (`open`, `wip`, `done`, `cancelled`), `priority`, `project`.
  Anything with a state.
- `project` — a thing others belong to, by `task.project`.
- `comment` — `target`. A note aimed at another entity.
- `web` — `url`. `image`, `attachment`, `blob` — files that belong to one.
- `archived` — the stamp that takes something out of the open list (`.archived=`
  selects the ones without it).
- `dependency` — how two entities relate: `{type, child}`, where type is one of
  `contains`, `requires`, `about`, `references`, `supersedes`.

## Components of your own

An app names its own components in a `vocab.json` at its root, and `app_deploy`
plants them in that app's store:

    { "recipe": { "title": "text", "serves": "number", "minutes": "number" } }

After the deploy `recipe` is a component like any other — write it in a bundle,
read it back in the row, filter on it:

    await apply({
      entity: { eid: '$pancakes' },
      doc: { title: 'Pancakes' },
      recipe: { serves: 4, minutes: 20 },
    })

    let quick = await query('.recipe.minutes<=30')

A column is one of `text`, `number`, `bool`, `time`, `url`. A later deploy may
add a column, but one that already has rows is never dropped or retyped. A whole
component the manifest stops naming is dropped if it holds no rows and kept if
it holds any — so a name you tried once and thought better of does not stay in
the app forever. Your words are yours: no other app's store has heard of them.

The platform's own words are refused, so that `doc` means `doc` in every store.
The manifest is read whole before anything is planted, so a refusal names every
collision at once and leaves the store as it was. These are the words already
taken:

    about accept alias anchor app apply architecture archived attachment
    attention bash blob blocked board brief bug call camera cancel cancelled
    canvas card chat checkpoint claim client comment commit completed conflict
    contains content created cursor decided delegates deliver delivered design
    doc dream edge effect email entity entry error exception exit favorite
    feedback fetch finding fixer fold fork generation goal graph_query headers
    hook image imported knock layout lease mail member memory message meta
    model nofix notice notified noverify opaque opened output pane patch person
    persona pin project prompt proposed quarantined reads reasoning recall
    recalled redaction references repo requires response result resume review
    role run runner runtime satisfies session setting settled shelf signin
    space spawn stderr stop_request subscription supersedes supervises task
    task_context timeout tool updated usage venture verifier wake wants web
    worked worktree yield

Anything the columns don't cover still lives in `doc.body`: it is text, so
markdown or JSON both keep there.

## The doors underneath

`client.js` is a wrapper over two ordinary HTTP doors, same-origin, in case you
want them directly (or from `curl`, or from another page):

    POST ./api/apply
    content-type: application/json
    {"entities": [ {"entity": {"eid": "$r"}, "doc": {"title": "Lemon cake"}} ]}
    → {"ok": true, "changes": [...], "aliases": {"$r": "4f3c..."}}

    GET ./api/query?.doc!            → every entity with a title
    GET ./api/query?.doc.title~=cake → the ones whose title contains "cake"
    → [ {"kind": "doc", "entity": {"eid": "4f3c...", "num": 12}, ... } ]

`apply` posts to the first, `query` and `search` read the second, and both
answer by the app's `access` above: a refused write is 401 to a stranger and 403
to a member who may not.

## The filter line

The same grammar the platform speaks everywhere:

- `.doc.title~=cake` contains, `.task.status=open` equals, and an empty value
  asks for absent: `.archived=` is everything not archived.
- `.doc!` has the component at all.
- `id=<eid>` fetches one by address.
- `limit=50`, `after=<num>` page — a windowed read answers the NEWEST that many,
  where a plain list is oldest first; `.count!` counts instead of listing.
- Bare words are a full-text term, which is all `search` is.
- `&` joins them: `.recipe.minutes<=30&.doc.title~=cake` asks both at once. Each
  filter ends where the next `&` begins, so `.recipe!.created!` is not a filter
  — it is two of them run together.
- `.created!` asks for the platform's stamps — who saved a row and when. A
  listing leaves them out unless you name them, so what comes back is what you
  saved; `.recipe!&.created!` is your rows with their timestamps.

Ask for the component you want, not for the absence of one: a long `body` is
kept as its own content-addressed entity beside the doc, so a filter that
selects everything selects those too, and a page rendering `row.doc.title` would
print `undefined`. `.doc!` never picks them up.

## When something breaks

A door that refuses answers a code for you and a sentence for the person —
`{"error": {"code": "not_a_writer", "message": "sign in to change this app"}}`.
`client.js` throws the sentence, and carries `signIn` when signing in is the way
through — the login page already holding this page as its return address:

    try { await apply(...) }
    catch (e) { e.signIn ? location = e.signIn : show(e.message) }

A request to the app that fails becomes an entity in the app's own store, and
the person's agent hears about it on its next reply — once, then `app_errors`
lists what is still open. That row is the platform's, not yours: a listing
leaves it out the way it leaves out the stamps, unless a filter names it
(`.exception!`).

Pages report themselves, with nothing to add: the kernel puts a reporter in
every page it serves, so a script error, a promise nobody caught, a refusal from
`/api/*`, a blocked resource or a failed request all arrive at
`POST ./api/report` and show up the same way. (A page may post there itself —
`{message, stack?, url?, line?}` — but it rarely needs to.)

Nothing is swallowed, so build for the person and fix what comes back.
