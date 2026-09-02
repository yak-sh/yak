# Building an app on yaks.app

An app is an `index.html` and whatever files sit beside it, served live at
`<space>.yaks.app/<app>/`. There is no build step and no framework: what you
write is what the browser gets. Every app comes with its own store — a graph of
entities — and a small client for reading and writing it from the page.

Make one with `app_new`, write files with `app_files`, then `app_deploy`, and
give the person the URL.

## The store, from a page

The kernel serves a client beside every app, at `./api/client.js`:

    <script type="module">
      import { apply, query, search } from './api/client.js'
    </script>

Three functions, all same-origin, all talking to this app's own graph:

- `apply(bundles)` saves. One bundle or an array; it answers
  `{ok, changes, aliases}`.
- `query(filter)` lists. The filter line below.
- `search(text)` finds words across the app's docs, ranked.

A refusal throws with the server's own sentence, so `try/catch` and show it.
Reads are open to anyone; writes need a signed-in owner or editor of the space
(yaks.app signs people in — the page does nothing about it).

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

Components an app declares for itself — a `recipe` with `serves` and `minutes`
of its own — are coming; an app will name its vocabulary and get its own
columns. Until then the shared words above carry the shape, and `doc.body`
carries the rest: it is text, so markdown or JSON both live there, and a page
that saves JSON there parses it back on the way out.

## The filter line

The same grammar the platform speaks everywhere:

- `.doc.title~=cake` contains, `.task.status=open` equals, and an empty value
  asks for absent: `.archived=` is everything not archived.
- `.doc!` has the component at all.
- `id=<eid>` fetches one by address.
- `limit=50`, `after=<num>` page — a windowed read answers the NEWEST that many,
  where a plain list is oldest first; `.count!` counts instead of listing.
- Bare words are a full-text term, which is all `search` is.

## When something breaks

A request to the app that fails becomes an entity in the app's own store, and
the person's agent hears about it on its next reply — once, then `app_errors`
lists what is still open. Nothing is swallowed, so build for the person and fix
what comes back.
