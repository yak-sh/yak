# Building a yaks app

The platform is yaks.app, written the way its address is: lowercase, with the
`.app`. An app made here is a yaks app.

A yaks app is an `index.html` and whatever files sit beside it, served live at
`<space>.yaks.app/<app>/`. There is no build step and no framework: what you
write is what the browser gets. Every app comes with its own store — a graph of
entities — and a small client for reading and writing it from the page.

Make one with `app_new`, write files with `app_files` — the whole set in one
call, as `files: [{path, content}, ...]` — then `app_deploy`, and give the
person the URL.

The person can also make or update one without you: the drop zone on their
space's own page accepts a `.zip` of an app's files, or a single `index.html`.

This page is the map, and it is meant to be read whole: a short section on every
feature there is. Where a subject has more to it than that, a `Deeper:` line
names the page that goes further — offered beside this one as its own resource,
and readable at that address by anybody.

The space's own address, `<space>.yaks.app/`, lists the apps a visitor may open
— an app nobody may read is not listed there — until one app is made its front
page with `app_set(app, home: true)`; `app_list` reports which app that is, if
any. No app becomes the front page by being made first.

A front page is served at the bare address rather than redirected to, and that
address is the one to hand out, since its own `/<app>/` forwards there. It
answers every path in the space no other app claims, so `/photo.png` is its file
and `/about` its page. The space's apps own the first path segment, though —
`/garden` is the garden app — so a front page's own page at that address is not
reached unless it asks for it (Home, below).

A page with more than one screen routes itself. The simplest way is the hash —
`location.hash`, and a `hashchange` listener redrawing — which needs nothing
from the platform. Pretty paths work too: under an app, an address that names no
file and ends in no extension (`/recipes/42`) is served the app's `index.html`,
so a page using the History API can read `location.pathname` and draw that
place, and a link straight to it opens. A missing file — anything with an
extension, like `/style.css` — is still a 404. Answering routes with code of
your own comes later.

## The store, from a page

Deeper: <https://yaks.app/guide/store.md> — every function of the client, the
HTTP endpoints underneath, and who may read and write.

The platform serves a client library beside every app, at `./api/client.js`:

    <script type="module">
      import { apply, me, query, search, subscribe, upload }
        from './api/client.js'
    </script>

Write every address in your app as a relative path, and never write the app's
own name into its own files. The platform gives each page it serves a
`<base href>` at the address the app is served at — `/<app>/`, or the bare
hostname when it is the front page — so `./api/client.js` and `./style.css` are
right from any path the page is opened at, pretty paths included, and right
again when the app becomes the front page or stops being one. They stay right in
somebody else's copy too, which lives at whatever address they installed it
under. A page that declares a `<base>` of its own keeps it, and is responsible
for its own addresses.

Six functions, all same-origin, all talking to this app's own graph:

- `apply(bundles)` saves. One bundle or an array; it returns
  `{ok, changes, aliases}`.
- `query(filter)` lists. The filter grammar is described below.
- `search(text, filter?)` searches the text of the app's docs, ranked. With no
  filter beside it, a hit carries the whole entity — every component it has.
- `subscribe(filter, cb)` is `query` that keeps calling back as things change.
- `upload(file)` saves bytes and returns where they live. Files, below.
- `me()` reports who is looking, before you ask them for anything.

`subscribe` is how a page stays up to date while it is open: it calls back with
the rows now and again on every change to them, including a change made on the
person's other device, and it returns a function that stops it.

    let stop = subscribe('.doc!', (recipes) => draw(recipes))

A refusal throws an error carrying the server's own message, so `try/catch` and
show it. Who may read and write is the app's `access`: `public` (the default)
allows anyone with the link to read and an owner or editor to write, `open`
allows anyone with the link to write — the vote page, the shared list — and
`private` answers members only. `app_new` and `app_set` set it; `member_add`
invites someone into the space by email address — name the app and the
invitation is mailed to them, carrying its link — and they sign in there with
that address and come back to the page they were on.

Ask on load, not on refusal. `me()` returns
`{person, name, role, reads, writes, signIn}` — `person` is null when they are
signed out — so the page shapes itself before anyone types:

    let who = await me()
    if (!who.writes) show(`<a href="${who.signIn}">Sign in to post</a>`)
    else if (!who.person) show('<input name="who" placeholder="Your name">')

Both halves matter. On a `public` app a guest who types first is bounced to sign
in and comes back to an empty form; on an `open` one their write has no
`created.by` at all, so if the page wants a byline it has to ask for the name
itself. `who.name` is what to call someone signed in — a name, never an address
— and `who.signIn` is where a signed-out visitor signs in, null once they are
in.

## What you save

An entity is a bundle: `{entity: {eid}, ...components}`. A component is a named
set of fields the entity has. `entity.eid` names an entity that already exists;
a `$alias` in its place creates a new one, and `aliases` in the answer reports
what eid it became. A `$alias` — or a whole nested bundle — can stand in
wherever an eid goes.

    let saved = await apply({
      entity: { eid: '$cake' },
      doc: { title: 'Lemon cake', body: '3 lemons, 200g butter...' },
    })

    let recipes = await query('.doc!')   // every one, oldest first
    let lemony = await search('lemon')   // the ones about lemons

A second component on the same entity records a second thing about it — here,
that it is one to make again:

    await apply({
      entity: { eid: saved.aliases.$cake },
      task: {}, filed: { priority: 1 },
    })

    let toMake = await query('.task.status=open&.doc?')

Each row comes back with the components its filter named, plus its address — so
name the ones the page will draw. `.task.status=open` on its own returns no
titles; `&.doc?` asks for the title beside it, and `?` is the only way to ask
for it:

    { kind: 'task', entity: { eid: '4f3c...', num: 12 },
      doc: { title: 'Lemon cake', body: '3 lemons, 200g butter...' },
      task: { status: 'open' } }

To change one, send its eid with just the fields you are changing; omitted
fields are left alone, and `null` clears one. `{entity: {eid}, tombstone: {}}`
deletes it.

An app can come with data already in it: a `seed.json` beside `index.html` — a
JSON list of those same bundles, or a `seed/` folder of `*.json` files when
there is a lot of it — is written into the store by the first `app_deploy`, and
into the copy an `app_install` makes. It is applied once per store, so a later
deploy leaves what the person has changed alone.

## Who wrote it

The store stamps every row with who saved it, and the stamp carries their name:
ask for it with `.created!` and the byline is on the row, so one query draws a
list with its writers.

    for (let e of await query('.doc!&.created!')) draw(e, e.created.by?.name)

A reference to somebody this store knows comes back as `{eid, name}` — the name
they chose when they signed in (or the front of their email address, if they
skipped the question), never an address: an address stays with the platform, so
a page can show a byline to anyone. Any other reference stays the bare eid it
always was, and a write still accepts that eid — a row read and handed back
refers to the eid it named.

A person is a row here too, so `query('.person!&.doc?')` lists everyone the
store has met, by name; they stay out of an ordinary listing, which returns what
the page saved.

An `open` app accepts writes from anyone with the link, and a guest who never
signed in is nobody yet: their rows have no `created.by` to name. If a byline
matters there, ask for a name on the page and save it in a row of your own.

`created.at` is when this store first saw the row and cannot be set to a past
moment, so anything imported or seeded carries its own date in a `time` column
of its own —
`{"$defs": {"jotting": {"properties": {"written":
{"type": "string", "format": "date-time"}}}}}`
— and the page draws that. The stamp is the store's record; the date is the
row's.

## Files

Deeper: <https://yaks.app/guide/files.md> — the app's icon, uploads, pictures,
and a gallery that never shows one twice.

An **`icon.png` beside `index.html`** — square, 512, on its own background,
written with `base64` in place of `content` — is the app's icon on a home
screen. The page is served with `<link rel="apple-touch-icon">` and
`<link rel="manifest">` already in its head, at the app's own root, and
`manifest.webmanifest` is generated from the app: its title, its address, and
that icon at 512 and 192. Either link a page declares itself is kept. Until an
app writes one, `icon.png` is the platform's own default icon.

`upload` accepts a `File` from an `<input type=file>` — or any `Blob` — and
returns `{eid, url, mime, bytes}`, plus `w` and `h` when the file is a picture
whose header gives them. The bytes are stored under their own SHA-256, so the
same file twice is one upload: `eid` is that address, and `url` is where the app
serves the bytes back, cached forever because they can never change.

    let input = document.querySelector('input[type=file]')
    let file = await upload(input.files[0])

    img.src = file.url                 // straight into the page

    await apply({                      // and a row that remembers it
      photo: { caption: 'the cake', blob: file.eid },
    })

    for (let p of await query('.photo!')) {
      draw(p.photo.caption, `./api/blob/${p.photo.blob}`)
    }

(`photo` is the app's own component, declared in its `vocab.json` —

    { "$defs": { "photo": { "properties": {
        "caption": { "type": "string" },
        "blob":    { "type": "string" } } } } }

see below.) A row points at bytes by their eid, and `./api/blob/<eid>` is where
they are served, which is what `url` already holds.

The upload writes a row of its own as well, so `query('.attachment!')` lists
every file in the app. That row has its own eid, which is not the eid of the
bytes — the bytes are `.attachment.blob`, and that is what the address is built
from:

    for (let f of await query('.attachment!')) {
      draw(`./api/blob/${f.attachment.blob}`, f.attachment.name)
    }

A picture's width and height are facts about the bytes, so `image` sits on the
blob itself — at the same eid a row points at, which is `file.eid` for the file
you just uploaded. Read them with a query of their own, and a gallery can hold
each photo's space open before its bytes arrive:

    let size = new Map((await query('.image!'))
      .map((i) => [i.entity.eid, i.image]))

    for (let p of await query('.photo!')) reserve(size.get(p.photo.blob))

The same bytes twice are one blob and one `attachment` row — but a `photo` row
of your own is still a second row, and the gallery shows the picture twice. Look
before you write one:

    let [seen] = await query(`.photo.blob=${file.eid}`)
    if (!seen) await apply({ photo: { caption, blob: file.eid } })

Who may upload is the app's `access`, the same as any other write; who may read
the bytes is the same as any other read. Deleting the app deletes its files with
it.

**One upload is 20 MB at most**, and a phone's photo is often more than that.
The refusal your page catches explains the limit in plain words, but staying
under it is the page's job: downscale before uploading — five lines, no library,
and the app is faster for everyone:

    let bmp = await createImageBitmap(file)
    let scale = Math.min(1, 1600 / bmp.width)   // never blow a small one up
    let cv = new OffscreenCanvas(bmp.width * scale, bmp.height * scale)
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height)
    let small = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.85 })

Then `upload(small, { name: file.name })`. There is no server-side resizing yet,
so the page's own downscale is the whole of it.

## The components an app has today

Deeper: <https://yaks.app/guide/components.md> — every component with its
columns, and vocab.json for components of your own.

These are the platform's built-in components, shared by every app — each one
with every column it has, and what each column holds. A column is `text`,
`number`, `bool`, `time`, `url`, an `eid` naming another entity, or a fixed set
of allowed values. Name a column that isn't there and the refusal lists the ones
that are, so getting the shape right takes one question, not five.

A `time` is sent as an ISO 8601 string with a zone — `new Date().toISOString()`,
`'2026-04-11T12:00:00Z'` — and comes back exactly as it was sent. For a plain
date with no time of day, write **noon** UTC: midnight renders as the day before
for anyone west of Greenwich.

- `doc` — `title` (text), `body` (text). The words a person reads; what `search`
  searches.
- `filed` — `priority` (number), `project` (eid), `assignee` (eid), `domain`
  (text). Optional portfolio filing; a microtask needs none of these.
- `task` — no stored columns. Anything with a state. Its `status` is read, never
  written — `open`, `wip`, `done` or `cancelled`, derived from the two marks
  below. Before either mark it is **`open`**, so `task: {}` is a thing to do.
- `completed` — `at` (time), `by` (eid). The mark that makes a task `done`; the
  store fills both in, so `completed: {}` is the whole write.
- `cancelled` — `at` (time), `by` (eid), `reason` (text). Called off rather than
  finished.
- `project` — `color` (text). A thing others belong to, by `filed.project`.
- `comment` — `target` (eid). A note aimed at another entity.
- `person` — no columns. Whoever wrote a row; their name is their `doc.title`.
- `archived` — no columns. The stamp that takes something out of the open list
  (`.archived=` selects the ones without it).
- `web` — `url` (url). An address out on the web.
- `artifact` — `size` (number). A count of bytes, not the bytes themselves.
- `attachment` — `artifact` (eid), `media_type` (text), `name` (text). A file,
  as `upload` writes it above.
- `image` — `w` (number), `h` (number). A picture's width and height, stored on
  the artifact itself; `upload` reads them from the file's own header (png,
  jpeg, gif, webp).

An edge is a link from one entity to another, not a column: `edges` accepts
`{type, child}`, where type is one of `contains`, `requires`, `about`,
`referenced`, `supersedes`.

## Components of your own

An app declares its own components in a `vocab.json` at its root, and
`app_deploy` installs them in that app's store:

    { "$defs": { "recipe": { "properties": {
        "title":   { "type": "string" },
        "serves":  { "type": "number" },
        "minutes": { "type": "number" } } } } }

After the deploy `recipe` is a component like any other — write it in a bundle,
read it back in the row, filter on it:

    await apply({
      entity: { eid: '$pancakes' },
      doc: { title: 'Pancakes' },
      recipe: { serves: 4, minutes: 20 },
    })

    let quick = await query('.recipe.minutes<=30')

A column is a JSON Schema: `{"type": "string"}` for text, `{"type": "number"}`,
`{"type": "boolean"}`, `{"type": "string", "format": "date-time"}` for a moment,
`{"type": "string", "format": "uri"}` for an address. A later deploy may add a
column, but one that already has rows is never dropped or retyped. A whole
component the manifest stops naming is dropped if it holds no rows and kept if
it holds any — so a name you tried once and thought better of does not stay in
the app forever. Your components are yours: no other app's store knows them.

The platform's built-in names are refused, so that `doc` means `doc` in every
store. The manifest is read in full before anything is installed, so a refusal
names every collision at once and leaves the store as it was. These are the
names already taken:

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

Anything the columns don't cover still lives in `doc.body`: it is text, so
markdown or JSON can both be kept there.

## Coming back later

An app has no cron and nothing sitting awake. Anything in its store can have a
`wake` component instead, and the store comes back to it at that time:

    await apply({
      entity: { eid: '$fern' },
      plant: { window: 'north' },
      wake: { at: '2026-09-20T09:00:00Z', every: '1d', note: 'water me' },
    })

At that moment the row is stamped `fired: { at }` and `wake.at` moves on to the
next occurrence — or is cleared, when there is no next one. Nothing polls, and
an app with no schedules is woken for nothing.

What a firing does is defined by a rule, which is a `vocab.json` entry like a
component and needs no code:

    "waters": {
      "rule": true,
      "match": ".plant, .wake, .fired, +!watered, +watered.by=wake" }

`+comp` writes that component, `+!comp` is a gate — it only fires while that
component is absent, which is how a rule fires once per thing rather than on
every later write. The rule runs inside the transaction the firing is part of,
so the row comes back already carrying what the rule wrote.

`every` accepts a duration (`30m`, `1d`), five cron fields (`0 9 * * 1-5`) or
`@hourly`/`@daily`/`@weekly`/`@monthly`, and a cron expression may end with a
time zone. `wake: { at: null }` pauses without forgetting the schedule;
`wake: null` ends it.

An app's own commands can be scheduled the same way: a `call` component naming
the command, with a `wake` on the same row giving the time. It waits for the
firing, the result is written beside the request, and a recurring schedule is a
standing request — each firing writes its own `call` row, so an earlier result
is never re-run.

Deeper: <https://yaks.app/guide/wakes.md> — every column, recurrence and time
zones, pausing and resuming, what a rule may match, scheduling a command, and
why there is no cron trigger to configure.

## The tool list, and when it changes

The app the person is chatting in — Claude or ChatGPT — listed these tools once,
when it connected, and is still holding that list. Ours is fixed: the same
names, in the same order, for every caller, signed in or not. A connector
directory takes a snapshot of `tools/list` the day a connector is submitted and
serves that snapshot forever, and only `tools/call` ever reaches us. So nothing
a person does changes the list: an app of theirs declares commands, which
`commands` lists and `command` runs (below), and a space they joined brings more
of those. Only a release here changes the list:

- `about` reports what is here **right now** — every tool name, and a roster
  version naming that list. Call it at the start of a conversation; the answer
  is the whole list, not a summary of it.
- When a release changes the list while you are connected, a reply carries one
  line saying so and naming what changed: _the tool list changed since you
  connected (new: mail_send)_. Reconnect, or call `about`, before you act on the
  old list.
- `graph_schema` is the same thing for components. `graph_apply`'s input schema
  is the vocabulary, and it is deliberately open: a column your cached copy has
  never heard of still reaches the store, and a column nobody declared is
  refused there, with the refusal listing the columns that do exist. The schema
  describes; the server decides.

**A new capability is a new component, not a new tool.** `graph_apply` already
writes anything the vocabulary declares, so something an app needs to keep — a
`rating`, a `loan`, a `shift` — is a line in its `vocab.json`, discoverable by
everyone through `graph_schema` the moment it deploys. Reach for a command of
your own (below) only when the app needs a verb that someone else's agent can
call. Every command is one more name anyone reading `commands` has to choose
between.

## An entity spans apps

Deeper: <https://yaks.app/guide/entities.md> — which app a component lives in,
and a two-app pair end to end.

An eid means the same entity everywhere. Two of the person's apps can write
about one entity, each with its own components: a reading list app saves the
`book`, a lending app saves who has it, and there is no copy and no sync between
them — it is one entity with two components, one in each store.

A component lives with the app that declares it, so the two apps never have to
agree on anything: `book` is the reading list's component wherever it is
written, `loan` is the lending app's. A shared component — `doc`, `comment`,
`image` — is written to the app the bundle names with `"$app": "<slug>"`, or
else to the app where that entity already lives.

One component, one home — the first app in the space to declare it. Declare the
same name in a second app's vocab.json and nothing is installed twice: the
deploy reports `book lives in reading-list`, this app reads and writes it there
through `graph_apply` and its own commands, and any column you added goes into
that app's table. A page reaches a component that lives in another app through
the `store` function below: its own `./api/` endpoints serve its own store and
nothing else.

A conflicting shape is the only refusal — the same column declared with two
types. The refusal names both types and the app the component lives in.

Across spaces, a component name means whatever its own space defines it to mean:
bundles merge by name only where the shapes agree, and otherwise stay separate,
with the space named beside `kind`.

    graph_apply { app: 'reading', entities: [
      { entity: { eid: '$b' }, doc: { title: 'Piranesi' },
        book: { pages: 245 } } ] }

    graph_apply { app: 'lending', entities: [
      { entity: { eid: '<that eid>' }, loan: { to: 'Maya' } } ] }

`<that eid>` comes from the first call's own answer: it returns the write as
applied, one bundle per entity, each carrying the `$alias` the call used for it
— so the second call never needs an eid read out of prose.

    [ { "entity": { "eid": "4f3c…", "num": 3 }, "$alias": "$b",
        "doc": { "title": "Piranesi" }, "book": { "pages": 245 },
        "created": { "at": "2026-09-05T…", "by": "…" } } ]

Anything the call deleted — and anything deleted along with it — comes back as
`{"entity": {"eid": "…"}, "tombstone": {}}` and nothing else.

`graph_query` with no app named reads every app the person has at once and
returns one bundle per entity, assembled from whichever stores hold part of it:

    graph_query { filter: '.book!&.loan?' }
    → [ { kind: 'book', entity: { eid: '...', num: 3 },
          book: { pages: 245 }, loan: { to: 'Maya' },
          _stores: { book: 'jeff/reading', loan: 'jeff/lending' } } ]

`.book!` selects which entities the answer is about; `.loan?` asks for the loan
beside them, where there is one. Name both with `!` (`.book!&.loan!`) and the
answer is only the books that are lent out — `&` is an intersection, across apps
just as within one. `_stores` reports which app holds which component, on a
bundle that spans two.

A page reads another app in the same space the same way, by naming its address:

    import { store } from './api/client.js'

    let lending = store('/lending/api/')
    let loans = await lending.query('.loan!')

Those are the other app's own endpoints, so that app's `access` decides: a
`private` app answers nobody but its members, whichever page is asking.

## Commands of your own

Deeper: <https://yaks.app/guide/tools.md> — the whole tools.json reference, and
the view protocol.

An app can also carry its own **commands**, so the person's agent can act on it
without a page open. They go in a `tools.json` at the app's root, beside
`vocab.json`, and the same `app_deploy` installs them:

    { "log_run": {
        "description": "Log a run for the club leaderboard",
        "input": { "who": "text", "miles": "number" },
        "apply": { "entity": { "eid": "$run" },
                   "jog": { "who": "$who", "miles": "$miles" } } },
      "leaderboard": {
        "description": "Every run since a date",
        "input": { "since": "time" },
        "query": ".jog!&.created.at>=$since" } }

After the deploy those are commands of `jeff/runs` — `log_run` and
`leaderboard`, under their own names, listed for the person and for everyone
else in the space with the app's title in the description. They are not tools of
this connector and never join its list, which is the same for everybody: two
fixed tools reach them — `commands` lists what there is and `command` runs one —
`command { name: 'log_run', args: { who: 'Ada', miles: 5 } }`, with `app` named
beside them only where two apps in reach use the same command name.

An entry has three parts: a `description` (the sentence a model chooses it by),
an `input` of arguments typed like a component's columns (`text`, `number`,
`bool`, `time`, `url` — all of them required), and exactly one action:

- `apply` — an entity bundle, or a list of them, exactly as `apply()` accepts on
  the page.
- `query` — a filter, returning the same listing `query()` returns.

`$arg` is a placeholder, filled in from the call's arguments. A string that is
nothing but a placeholder keeps the argument's own type, so `"$miles"` writes a
number; a placeholder inside a longer string is substituted as text. A
placeholder naming an argument the `input` never declared is refused at deploy,
together with everything else wrong in the file, in one message — nothing is
installed until the whole manifest parses.

A command is a template, never code: the action goes through the app's own
endpoints as the person calling it, so the app's `access` decides whether it is
allowed, `created.by` names them, and a refusal is the same message the page
would show. Nobody gets more through a command than they have on the page.

### A page that draws the answer itself

An entry may also name a `view`: a page in the app's own files that the app the
person is chatting in renders the answer in, instead of reading it out. Add it
beside the action and deploy the page with everything else:

    "leaderboard": { "description": "Every run since a date",
                     "input": { "since": "time" },
                     "query": ".jog!&.created.at>=$since",
                     "view": "leaderboard.html" }

The page receives the command's answer over the MCP client's postMessage
protocol: send `ui/initialize` first, then draw whatever arrives in
`ui/notifications/tool-result` — `structuredContent` is what `query` returned,
`{ rows: [...] }` — and report your height back so the frame fits.

    <!doctype html>
    <meta charset="utf-8" />
    <ol id="board"></ol>
    <script>
      let n = 0
      let post = (method, params, id) =>
        parent.postMessage({ jsonrpc: '2.0', method, params, id }, '*')
      addEventListener('message', (e) => {
        if (e.data.method != 'ui/notifications/tool-result') return
        let rows = (e.data.params.structuredContent || {}).rows || []
        board.replaceChildren(...rows.map((r) => {
          let li = document.createElement('li')
          li.textContent = `${r.jog.who} — ${r.jog.miles} miles`
          return li
        }))
        post('ui/notifications/size-changed',
          { width: document.body.scrollWidth,
            height: document.body.scrollHeight })
      })
      post('ui/initialize', { protocolVersion: '2026-01-26' }, ++n)
    </script>

Relative URLs still work: the platform hands the page over with a `<base>` at
the app's own address, so a stylesheet or an image beside `index.html` loads.
Its data does not arrive that way — `./api/query` from inside the frame is a
different origin with no session on it. The answer arrives in the notification
above, and to redraw, make an ordinary MCP `tools/call` of `command` back
through the app the person is chatting in, which does carry who is looking.

## The notes an app keeps

Deeper: <https://yaks.app/guide/notes.md> — what belongs in the file, its size
limit, and the three places it is handed over.

A rule the person wants followed _every_ time — recipes in grams, one photo
each, tag by meal and never by cuisine — goes in a **`NOTES.md`** beside
`index.html`:

    # Recipes

    Weights in grams, never cups. Oven in °C with °F in brackets.
    Every ingredient's amount is repeated in the step that uses it.
    One photo per recipe, of the finished dish, uploaded not linked.

Any agent that can reach the app can be given it, so the rule is stated once and
followed from then on: `about` returns the notes of every app in reach, and a
person can pull one in by name through the MCP prompt named after the app. It is
part of the app's source, like `vocab.json`: `GET /recipes/NOTES.md` is a 404 on
the web, and a member reads it back with `app_files`. Keep it under 4 KB — a
bigger write is refused — and keep it to the rules themselves, not the reasoning
behind them. Installing the app copies it along with the app's other files.

When an agent first connects it is given a summary of **every app the person can
reach** — its address, what it holds and its own commands. That is how an agent
asked to "add this recipe" knows there is already a recipe app to add it to.

## What the person said

Deeper: <https://yaks.app/guide/memory.md> — the shape of a memory, what context
is for, and how a recall is ranked.

A `NOTES.md` is the rules for one app. The other half is what the person said,
in their own words, kept for the whole space:

    memory_save { said: 'use grams, never cups',
                  context: 'setting up the recipe app', about: 'recipes' }

Save the sentence, verbatim, the moment they say how they want something built
or handled — a paraphrase can only lose what they said, and nobody afterwards
can get it back. Add only the line of context needed to read it later. `about`
returns the newest few to any agent that asks, and `memory_recall` finds the
rest by what they are about — ask it before you build or change an app, so what
they told somebody once is not something they have to say again.

## Code of your own

Deeper: <https://yaks.app/guide/code.md> — env, routes, secrets, limits, and
whole workers to copy.

An app is pages until you give it a `worker.js`, and then it has a server. Write
one beside `index.html` and `app_deploy` puts it in front of the app: every
request for the app that is not `/api/…` reaches it first, and **anything it
answers with a 404 falls through to the files**. So a worker owns the routes it
names and leaves every page, stylesheet and picture to the platform — you never
have to serve your own `index.html`.

The configured server source itself is never served; with the default entry,
`GET /<app>/worker.js` is a 404, and so are `vocab.json`, `tools.json`,
`wrangler.jsonc` and `wrangler.json` — these are the app's source, not its
pages, and only a member reads them back (`app_files` read).

An app may carry `wrangler.jsonc` or `wrangler.json` beside `worker.js`. The
supported keys are `main` (the app-relative server source path, `worker.js` by
default; directories such as `dist/server.js` are allowed),
`compatibility_date`, `compatibility_flags`, `vars`, `d1_databases`,
`r2_buckets`, `durable_objects.bindings` with local `class_name`, `migrations`,
`ai`, and `vectorize`. D1 databases, R2 buckets and Vectorize indexes belong to
that app; yaks.app creates them at deploy and reuses them. A new Vectorize index
also names its `dimensions` and `metric`, or a `preset`. `app_deploy` reports
unsupported settings and `app_list` names the bindings. Removing a binding keeps
its resource and data until the app is permanently deleted; the app's 30 days in
the trash keep them too.

The upload wrapper is internal and is never configured by the app. The server
source must be a JavaScript ES module (`.js` or `.mjs`); compile TypeScript
before uploading. `env` holds:

- `env.STORE` — the app's own graph, at the same endpoints `client.js` uses,
  **as the person looking at the page**. `env.STORE.fetch('/query?.doc!')`,
  `env.STORE.fetch('/apply', {method: 'POST', body})`. A path, not a URL.
- `env.FILES` — the app's own files. `env.FILES.fetch('/index.html')`.
- one entry per secret you set, under the name you set it (below).
- the variables and bindings its Wrangler file declares, under their names.

A binding the app declares keeps its name, including `STORE`, `FILES` or `APP`;
the platform supplies those three itself only when no declared binding has taken
the name.

Name your routes anything that is not under `/api/`: that path segment holds the
platform's own endpoints — apply, query, me, graph, ws, blob, files — and a
request for one never reaches your worker. Your own routes live beside it.

Here is the whole of it — one route reading the store, and one outside call the
page must not be able to make for itself:

    export default {
      async fetch(req, env) {
        let url = new URL(req.url)

        if (url.pathname.endsWith('/mine')) {
          let rows = await (await env.STORE.fetch('/query?.recipe!')).json()
          return Response.json(rows.map((r) => r.doc.title))
        }

        if (url.pathname.endsWith('/weather')) {
          let at = 'https://api.example.com/now?city=' + url.searchParams.get('city')
          let got = await fetch(at, {
            headers: { authorization: 'Bearer ' + env.WEATHER_KEY },
          })
          return Response.json(await got.json())
        }

        return new Response('not found', { status: 404 })   // → the files
      },
    }

The request carries `x-yak-person` (their eid, absent for a visitor who has not
signed in) and `x-yak-role`, so the worker knows who is asking without reading
anything. It never sees their platform session cookie: the app is entitled to
this visit and no more, and `env.STORE` already acts as them, so what the app's
`access` lets that person do is exactly what the worker can do.

**Secrets** are the reason to write a worker at all: an API key belongs on the
server, never in a page anyone can read. `app_secret_set` puts one on the app's
script, the worker reads it as `env.NAME`, and nothing — no tool, no query, no
history — can read it back. `app_secret_list` names them; `app_secret_remove`
removes one. Ask the person for the value.

**Limits**: 50ms of CPU and 50 subrequests per request. That is a store read and
an outside call with room to spare; it is not a place to loop.

A thrown error, or a 5xx, becomes the same `exception` component that pages
record — the person's agent hears about it on its next reply, and `app_errors`
lists what is still open. So let it throw: an error you can see is worth more
than a `catch` that hides it.

## Home

Deeper: <https://yaks.app/guide/home.md> — the five steps a request goes
through, the `first` globs, why a broken router fails open, and where the
space's mail lands.

The front page is the space's router as well as its homepage. A request to
`<space>.yaks.app<path>` is answered by the first of five steps that has
anything: the platform's own paths (`/login`, `/connect`, `/mcp`, every app's
`/api/…`), then the app whose slug owns the first segment, then the front page's
files, then the space's index at `/`, and everything else goes to the front
page's `worker.js` where it has one. So the front page sees every path no other
app claims, and a 404 from its worker falls through to its files the same way
any app's does.

It can also answer paths another app owns, by asking for them:

    app_set(app: 'home', first: ['/recipes/*', '/*/print'])

Those globs are stored in `home{first}` — columns of the same `home` component
that marks which app is the front page, so only a front page can have them and
`app_set` refuses them on any other app. `*` matches any run of characters,
slashes included. The platform's own paths belong to no app, so a glob naming
one is refused before anything is written.

Two rules hold. It **fails open**: a worker that throws, times out or answers
404 is skipped, the request lands on the app that owns it, and the failure is
recorded as an `exception` on the front page — a broken router stops the
customizations, never the space. And it **acts as the visitor**, carrying the
person looking rather than the app it routes to, so it can never read a store
they could not read themselves.

`<space>@yaks.app` is the front page's mailbox, so a letter to the space lands
in that app's store as an ordinary row; custom mail behavior for a space is
whatever that app does about those rows. `mail_list` and `mail_send` are
unchanged.

## Saving from another site

Deeper: <https://yaks.app/guide/clipping.md> — the whole clipper, the
bookmarklet, and what to do when a site refuses.

An app can take a page off somebody else's website — a recipe, a listing, an
article — and keep it. Two pieces, and a `worker.js` is what makes it possible:

- **A route that clips.** `/clip?url=…` fetches the address, reads the metadata
  the page carries about itself, and writes one bundle. Use the best source the
  page offers, in this order: a `<script type="application/ld+json">` block
  (schema.org — a recipe arrives with its ingredients in a list), then
  `og:title`/`og:description`/`og:image`, then the `<title>` and the address.
  `HTMLRewriter` is part of the runtime, so there is no parser to install and no
  megabyte of HTML to run regular expressions over.
- **A bookmarklet that launches it.** A link the person drags to their bookmarks
  bar once; pressing it opens the app's clip page with the address of the page
  they are on. It opens a page rather than posting the data, because an app's
  `./api/` write endpoints accept same-origin, cookie-carrying requests only — a
  script on another site cannot write here today, with or without a token.

Keep where it came from, in a component of your own —

    { "$defs": { "source": { "properties": {
        "url": { "type": "string", "format": "uri" },
        "at":  { "type": "string", "format": "date-time" } } } } }

— and make the entity's eid a hash of the address, so clipping the same page
twice updates one row instead of making two. When a site blocks automated
fetches, save the link and the title the browser already had and tell the person
plainly; return 200, not a 5xx, or every blocked page records an error in their
app.

## Sharing an app

Deeper: <https://yaks.app/guide/sharing.md> — access, members, publishing,
installing, pinning.

An app is a plugin. Once it is deployed you can offer it to every other space
here, and anyone can take a copy into their own — five tools:

- `app_publish(app, name?, about?)` — offer the version that is serving, under a
  name the whole platform shares; an app that has never been deployed is
  refused. The name defaults to the app's own slug on a first publish, and a
  name already taken is refused, naming the app that has it. Publishing again
  keeps the name it already has; pass a `name` to change it, and the old one
  stops resolving for everybody holding it. `about` is the line someone browsing
  reads. Only the space owner may publish.
- `app_unpublish(app)` — withdraw the offer. The app is untouched, every copy
  anyone took is untouched, and the name is free again.
- `app_published()` — what is on offer, newest first, each with the address it
  installs at.
- `app_install(name, as?)` — take one. Leave `as` out and it lands at the app's
  own slug — the address its author wrote it at — or at the published name when
  that one is taken here; `as` puts it anywhere you say.
- `app_update(app)` — move an installed copy to whatever its publisher offers
  now.

**An installed app shares nothing but the code.** It is an ordinary app of the
installer's: its own address, its own store, its own R2 prefix, its own worker
script. Their first row is written into a graph nobody else has ever touched,
and the publisher never sees any of it. Nothing is synced, nothing is shared,
nothing phones home. The photos a visitor uploaded to the publisher's copy stay
there too — those are data, not code.

**A copy is pinned to the version it was installed from.** Publishing again does
not move anybody: the installer's copy keeps serving exactly what it served
yesterday until someone calls `app_update`. That is the whole point of the pin —
a publisher cannot change an app out from under the people using it.

An update replaces the code and keeps the data. Every row they saved is still
there afterwards, and so is anything the store learned along the way; what is
removed is any file the publisher's new version does not have — including
anything you wrote into the copy yourself. The vocabulary follows the same rule
it always does: a `vocab.json` that only added components or columns is applied
to their store as additions, and one that would change the type of a column
their rows were written under is refused with the same message a deploy gives —
and nothing changes at all.

## Mail

Deeper: <https://yaks.app/guide/mail.md> — the bundle that sends a letter, what
comes back, how an arriving letter is stored, and the limits.

Every app has a mailbox at `<space>.<app>@yaks.app` — `<space>@yaks.app` for the
space's front page. One dot, always at `yaks.app`: an address under a space's
own hostname (`cookbook@ada.yaks.app`) belongs to nobody and never will. Mail in
both directions is rows in the store, so there is no mail API and no key to set.

Sending is three components written in one `apply` call: the recipient as an
entity with `email{address}`, the letter as `doc{title, body}` (the body in
markdown) plus `mail{}`, and the request to send it, `deliver{to}`, naming the
recipient. A letter with no `deliver` is a draft, kept and never sent; one that
gets a `deliver` later is sent then, once.

    await apply([
      { entity: { eid: '$ana' }, email: { address: 'ana@example.com' } },
      { entity: { eid: '$note' },
        doc: { title: 'Your order is on its way',
               body: 'Two jars of marmalade, posted Tuesday.' },
        mail: {},
        deliver: { to: '$ana' } },
    ])

The `from` is stamped with the app's own address, overwriting whatever the call
set. Sending is restricted to a member who may write, even in an `open` app — a
letter leaves under this platform's name, and an open app with no restriction
there would be an open relay. What became of the letter is written back onto it
as `delivered{at, via}` or `bounced{at, reason}`, so "did it go?" is
`query('.mail!&.bounced!&.doc?')` rather than a log file.

A letter that arrives is stored as one entity in that app's store — `doc` for
the subject and the words, `mail{from, to, at, message_id, verified}` for the
envelope, attachments saved as blobs and linked to it with a `contains` edge —
and anything subscribed sees it arrive. The sender is data, never an actor:
nobody here wrote the letter, so `created.by` is null, and `mail.verified`
carries the DKIM verdict, which is not authority to do anything. Mail is metered
in both directions against the space's plan (<https://yaks.app/pricing>); mail
at the person's own domain is not offered.

## Selling things

Deeper: <https://yaks.app/guide/selling.md> — connecting the account, the whole
shape of the checkout endpoint, what an order contains, and who can read one.

A shop is a shape the platform already knows, and it needs no keys and no code.
The seller needs Plus and connects a Stripe account of their own to their space
once — `space_sell`, or the button on their space page — and after that any app
in the space posts a cart to `./api/pay/checkout`:

    let r = await fetch('./api/pay/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ product: eid, qty: 2, options: 'M' }],
        success: '?ordered={CHECKOUT_SESSION_ID}',
      }),
    })
    location.href = (await r.json()).url

The endpoint reads `price_cents` and the title from each `product` row in the
app's own store, creates a Stripe payment page on the seller's connected
account, and returns where to send the buyer. When Stripe confirms the payment,
an `order{session, account, items, total_cents, fee_cents, email, status}` row
is written to that app's store — `order` is one of the platform's built-in
components, so no `vocab.json` declares it — and the buyer gets a confirmation
from the app's own address. The seller reads their orders with
`query('.order!&.doc?')` and makes refunds in their own Stripe dashboard.

The charge is on the seller's account and the money is theirs, less a small
platform fee. **A card number never reaches your app** — the page somebody types
one on is Stripe's, at Stripe's address. Two rules follow from that: a page
never posts a price, only which product and how many, because a price that
travels through the browser is a price the buyer can edit; and an order is never
written by the page Stripe sends the buyer back to, because a buyer who closes
that tab has still paid.

## A custom domain

Deeper: <https://yaks.app/guide/domains.md> — the record to add and where to
type it at each registrar, the apex, moving DNS to Cloudflare, and what each
pending state means.

A space, or one app of it, can also answer at a domain the person already owns,
with the `.yaks.app` address still working. `ourbookclub.com` on the space
serves it exactly as `jeff.yaks.app` does — the front page at `/`, every app at
`/<app>/`. `herbusiness.com` on a single app serves that app at the root, and
nothing else is there. Both can be in place at once. Three tools, all the space
owner's:

Custom domains require Plus unless the space is exempt. If `domain_attach`
returns `plan_required`, share its `settings_url` so the person can compare
plans in their space's settings. Never provide a direct checkout link. Sign-in
preserves that destination; no domain changes occur until the space is eligible.

- `domain_attach(app?, hostname)` — provisions the hostname and returns the DNS
  record to add, as data: `records: [{type, name, value}]`. Name an `app` for
  the app's own domain; leave it out for the space's.
- `domain_status(hostname?)` — what each domain points at and how far it has
  got. Leave the hostname out for every domain in the space.
- `domain_detach(hostname)` — releases the hostname. What it served is
  untouched.

The record is always the same shape: a CNAME at the hostname, pointing at
`origin.saas.yaks.app`. Add it wherever the person's DNS is managed. You know
their registrar's panel better than they do, so walk them through it in their
own words — or do it for them, if you can reach it.

**The apex is where people give up.** DNS does not allow a CNAME at a bare
domain (`herbusiness.com`, with no `www.` in front). Moving their DNS to
Cloudflare is the answer to lead with: it is free, its CNAME flattening makes
the apex work, and it leaves the domain registered where it is. Failing that,
attach `www.herbusiness.com` and forward the apex to it.

Nothing serves until the record resolves — usually minutes, sometimes a day.
`domain_status` splits the wait into the record arriving, Cloudflare accepting
the hostname, and the certificate being issued, so you can say which one is
outstanding instead of guessing.

## The HTTP endpoints underneath

`client.js` is a wrapper over ordinary same-origin HTTP endpoints, in case you
want to call them directly (from `curl`, say, or from another page):

    POST ./api/blob
    content-type: image/jpeg          ← the file's own type
    x-yak-name: cake.jpg              ← optional, percent-encoded
    <the bytes>
    → {"eid": "9f2a...", "url": "/photos/api/blob/9f2a...",
       "mime": "image/jpeg", "bytes": 51234, "w": 1600, "h": 1200}

    GET ./api/blob/<eid>             → the bytes, with that mime

    POST ./api/apply
    content-type: application/json
    {"entities": [ {"entity": {"eid": "$r"}, "doc": {"title": "Lemon cake"}} ]}
    → {"ok": true, "changes": [...], "aliases": {"$r": "4f3c..."}}

    GET ./api/query?.doc!            → every entity with a title
    GET ./api/query?.doc.title~=cake → the ones whose title contains "cake"
    → [ {"kind": "doc", "entity": {"eid": "4f3c...", "num": 12}, ... } ]

    GET ./api/me
    → {"person": null, "name": null, "role": null, "reads": true,
       "writes": false, "signIn": "https://yaks.app/login?return=..."}

`apply` posts to `./api/apply`, `query` and `search` read `./api/query`, and
both enforce the app's `access` described above: a refused write is 401 to a
stranger and 403 to a member who is not allowed to write. `me` answers everyone
— telling a stranger they must sign in is what it is for.

## The filter grammar

Deeper: <https://yaks.app/guide/querying.md> — every operator, with worked
examples.

The same grammar the platform uses everywhere:

- `.doc.title~=cake` contains, `.task.status=open` equals, and an empty value
  asks for absent: `.archived=` is everything not archived.
- A column holding an eid is filtered by that eid, like any other value:
  `.comment.target=<eid>` is every comment aimed at one entity. That is a
  different question from `id=<eid>`, which addresses the row itself.
- `.doc!` selects everything that has the component at all.
- `.loan?` asks for a component without filtering on it — an answer carries the
  components its filter names, so `.book!&.loan?` is every book, with its loan
  where it has one. `*` asks for every component, which is what you want when
  you are exploring rather than drawing a page.
- A dotted name after a component addresses that component's column:
  `.recipe.minutes` is a column of `recipe`, and `.recipe.doc` is a column
  `recipe` does not have. Asking for a second component is `&.doc?` — the two
  are different questions, and `&.doc?` is the only way to ask the second one.
- `id=<eid>` fetches one entity by address, whole — an address names no
  component to leave out.
- `limit=50` and `after=<num>` page through results — a windowed read returns
  the newest that many, where a plain list is oldest first; `.count!` counts
  instead of listing.
- Bare words are a full-text search term, which is all `search` is. Like `id=`,
  a bare word names no component to leave out, so a search with no filter beside
  it returns whole entities; add `&.recipe!` and the ordinary rule applies
  again.
- `&` joins them: `.recipe.minutes<=30&.doc.title~=cake` asks both at once. Each
  filter ends where the next `&` begins, so `.recipe!.created!` is not a filter
  — it is two of them run together.
- `.created!` asks for the platform's stamps — who saved a row and when. A
  listing leaves them out unless you name them, so what comes back is what you
  saved; `.recipe!&.created!` is your rows with their timestamps.

A row comes back with the components you named, plus its address and its kind —
`query('.recipe!')` returns recipes and no titles, and `query('.recipe!&.doc?')`
returns both. Ask for what you will draw.

Name the components you want rather than reaching for `*`: `*` selects every
component of every row, and a page rendering `row.doc.title` over an answer that
wide would print `undefined` for every row that has no `doc`.

## When something breaks

Deeper: <https://yaks.app/guide/errors.md> — every refusal, app_errors, and
rolling back.

A refusal returns a code for you and a message for the person —
`{"error": {"code": "not_a_writer", "message": "sign in to change this app"}}`.
`client.js` throws the message, and the error carries `signIn` when signing in
is the way through — a login page that already holds this page as its return
address:

    try { await apply(...) }
    catch (e) { e.signIn ? location = e.signIn : show(e.message) }

A request to the app that fails becomes an entity in the app's own store, and
the person's agent hears about it on its next reply — once, then `app_errors`
lists what is still open. That row is the platform's, not yours: a listing
leaves it out the way it leaves out the stamps, unless a filter names it
(`.exception!`).

Pages report their own errors, with nothing for you to add: the platform puts an
error reporter in every page it serves, so a script error, an unhandled promise
rejection, a refusal from `/api/*`, a blocked resource or a failed request all
arrive at `POST ./api/report` and show up the same way. (A page may post there
itself — `{message, stack?, url?, line?}` — but it rarely needs to.)

Nothing is swallowed, so build for the person and fix what comes back.

When the fix is to go back to the previous version, do that: `app_versions`
lists an app's last twenty deploys, newest first, with what changed in each, and
`app_rollback` puts one back — every file of it, its components, its commands
and its worker — as a new version, so a rollback can itself be rolled back. Only
the files change; what the app has saved is never touched.

## Nothing here is lost by a simple mistake

Every destructive thing on this platform has a way back, and each tool's own
description ends by naming it. Four of them, at four sizes:

- **A deleted app or space is in the trash for 30 days.** `app_delete` and
  `space_delete` keep everything — the files, the data, the address — and
  `app_restore` and `space_restore` bring the whole thing back. After 30 days it
  is erased for good, and only then.
- **A store can be put back to any moment in the last 30 days.** `store_restore`
  winds everything the app has saved back to how it was at a time you name — a
  bad import, rows deleted that should not have been. The state before the
  restore is recorded first, so a restore can itself be undone by restoring to a
  moment just before it, and the answer tells you how. Call it with no time
  first and it reports the window and every restore already made.
- **Every file write keeps what it replaced**, for 30 days.
  `app_files(op: 'history', path)` lists them newest first with the sha256, the
  size, when it was replaced and by whom; `app_files(op: 'restore', path)` puts
  one back as a new write, so a restore can be undone by another. A delete keeps
  its bytes the same way.
- **Every deploy can be rolled back**, above.

So **fix things first and ask afterwards**, rather than the other way round. The
whole point of keeping all of this is that a change is cheap to try: an agent
that stops to ask permission before every write is paying a price nobody here is
charging. And when the person hesitates — "will I lose everything?" — say which
of these covers them. They are usually weighing a risk that is not there.

The one thing with no way back is what somebody explicitly asked to erase:
`app_delete(forever: true)` skips the trash, and a secret removed with
`app_secret_remove` was never readable to put back.

## Who visited

Deeper: <https://yaks.app/guide/stats.md> — what a page view records, what it
never does, and the three places to read it.

Every HTML page the platform answers for an app is counted, and nothing else —
not a stylesheet, not an `./api/` call, not a 404. `app_stats(app: 'recipes')`
returns the visits per day for the last month, the pages people opened, the
sites that linked to them and the countries they were in; `days` shortens the
window. Their space page shows the same thing as a block per app, and a member's
page can read its own at `./api/stats`.

There is nothing identifying a visitor in the data: no IP address, no id, no
cookie, not even the browser's user-agent string — only a country, a referring
host and one of `browser`, `bot` or `agent`. So it can report how many and from
where, and it can never report who. Say that plainly when somebody asks the
other question.

Counts are approximate under load and already scaled back up, kept about three
months, and they include crawlers — eleven visits on a page nobody was sent to
is usually eleven robots.

## Feedback on yaks.app itself

Not every problem belongs to the app. Anything either of you has to say about
yaks.app itself — a tool that refused for no reason you could find, a tool or
endpoint that isn't there, a page here that taught you the wrong thing, a step
the person found baffling, a rough edge, a wish, a feature idea, a thing that
went well — `feedback(text, app?)` sends it to the people who run yaks.app, and
it reaches them as mail they can answer.

Send what the person said, in their own words, and what you tried and what
happened. Nothing else: who they are, their space, the app if you name one, and
both version numbers are attached automatically. Where something is broken, work
around it and carry on — the workaround is invisible to us, and this report is
what we see instead. A few an hour is plenty; beyond that, further reports wait.

An error inside the person's own app is not this. That is theirs, it is already
in `app_errors`, and fixing it is yours.

When a plan limit is reached, share the space's plan settings link returned in
the refusal (`https://<space>.yaks.app/_yaks/billing`), not checkout. For Free,
the page explains the paid allowances. For Plus, explain the relevant deletion
or monthly-reset option instead of promising that another upgrade removes the
limit. Sign-in returns the person to the same settings page.
