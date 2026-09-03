# Building an app on yaks.app

An app is an `index.html` and whatever files sit beside it, served live at
`<space>.yaks.app/<app>/`. There is no build step and no framework: what you
write is what the browser gets. Every app comes with its own store — a graph of
entities — and a small client for reading and writing it from the page.

Make one with `app_new`, write files with `app_files` — the whole set in one
call, as `files: [{path, content}, ...]` — then `app_deploy`, and give the
person the URL.

A page with more than one screen routes itself. The simplest way is the hash —
`location.hash`, and a `hashchange` listener redrawing — which needs nothing
from the kernel. Pretty paths work too: under an app, an address that names no
file and ends in no extension (`/recipes/42`) is served the app's `index.html`,
so a page using the History API can read `location.pathname` and draw that
place, and a link straight to it opens. A missing file — anything with an
extension, like `/style.css` — is still a 404. A server answering routes with
CODE of its own comes later.

## The store, from a page

The kernel serves a client beside every app, at `/<app>/api/client.js` — the
app's own slug, absolute:

    <script type="module">
      import { apply, me, query, search, subscribe, upload }
        from '/recipes/api/client.js'
    </script>

Import it absolutely, always. A relative `./api/client.js` breaks the moment a
page is opened at a pretty path: at `/recipes/42` it resolves to
`/recipes/42/api/client.js`, which is not there. The app knows its own slug; a
page does not know its own depth.

Six functions, all same-origin, all talking to this app's own graph:

- `apply(bundles)` saves. One bundle or an array; it answers
  `{ok, changes, aliases}`.
- `query(filter)` lists. The filter line below.
- `search(text)` finds words across the app's docs, ranked.
- `subscribe(filter, cb)` is `query` that keeps answering.
- `upload(file)` saves bytes and answers where they live. Files, below.
- `me()` says who is looking, before you ask them for anything.

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

Ask on load, not on refusal. `me()` answers
`{person, name, role, reads, writes, signIn}` — `person` null when they are
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
      task: { priority: 1 },
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

The store stamps every row with who saved it, and the stamp says their NAME: ask
for it with `.created!` and the byline is on the row, so one query draws a list
with its writers.

    for (let e of await query('.doc!&.created!')) draw(e, e.created.by?.name)

A reference to somebody this store knows answers `{eid, name}` — the name they
chose when they signed in (or the front of their address, if they skipped the
question), never an address: an address stays with the platform, so a page can
show a byline to anyone. Anything else stays the bare eid it always was, and a
write still takes that eid — a row read and handed back means the eid it named.

A person is a row here too, so `query('.person!&.doc?')` lists everyone the
store has met, by name; they stay out of an ordinary listing, which answers what
the page saved.

An `open` app takes writes from anyone with the link, and a guest who never
signed in is nobody yet: their rows have no `created.by` to name. If a byline
matters there, ask for a name on the page and save it in your own row.

## Files

`upload` takes a `File` off an `<input type=file>` — or any `Blob` — and answers
`{eid, url, mime, bytes}`, plus `w` and `h` when the file is a picture that says
so. The bytes are stored under their own SHA-256, so the same file twice is one
upload: `eid` is that address, and `url` is where the app serves the bytes back,
cached forever because they can never change.

    let input = document.querySelector('input[type=file]')
    let file = await upload(input.files[0])

    img.src = file.url                 // straight into the page

    await apply({                      // and a row that remembers it
      photo: { caption: 'the cake', blob: file.eid },
    })

    for (let p of await query('.photo!')) {
      draw(p.photo.caption, `/recipes/api/blob/${p.photo.blob}`)
    }

(`photo` is the app's own component —
`{"photo": {"caption": "text", "blob":
"text"}}` in its `vocab.json`; see
below.) A row points at bytes by their eid, and `/<app>/api/blob/<eid>` is where
they are, which is what `url` already holds — absolute, like the import, so it
is right from a page at any path.

The upload writes a row of its own as well, so `query('.attachment!')` lists
every file in the app. That row's eid is the row's, not the bytes' — the bytes
are `.attachment.blob`, and that is what an address is built from:

    for (let f of await query('.attachment!')) {
      draw(`/recipes/api/blob/${f.attachment.blob}`, f.attachment.name)
    }

What a picture measures is a fact about the bytes, so `image` sits on the blob
itself — at the very eid a row points at, which is `file.eid` for the one you
just sent. Read them the way you read names, and a wall can hold each photo's
space open before its bytes arrive:

    let size = new Map((await query('.image!'))
      .map((i) => [i.entity.eid, i.image]))

    for (let p of await query('.photo!')) reserve(size.get(p.photo.blob))

The same bytes twice are one blob and one `attachment` row — but a `photo` row
of your own is still a second row, and the wall shows the picture twice. Look
before you write one:

    let [seen] = await query(`.photo.blob=${file.eid}`)
    if (!seen) await apply({ photo: { caption, blob: file.eid } })

Who may upload is the app's `access`, the same as any other write; who may read
the bytes is the same as any other read. Deleting the app deletes its files with
it.

**One upload is 20 MB at most**, and a phone's photo is often more than that.
The refusal a page catches says so in a guest's words, so the sending is yours
to get right: downscale on the page — five lines, no library, and the app is
faster for everyone:

    let bmp = await createImageBitmap(file)
    let scale = Math.min(1, 1600 / bmp.width)   // never blow a small one up
    let cv = new OffscreenCanvas(bmp.width * scale, bmp.height * scale)
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height)
    let small = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.85 })

Then `upload(small, { name: file.name })`. There is no server-side resizing yet,
so the page's own downscale is the whole of it.

## The components an app has today

The platform's own vocabulary, shared by every app — each component with every
column it carries, and what each column holds. A column is `text`, `number`,
`bool`, `time`, `url`, an `eid` naming another entity, or a closed set of words.
Name a column that isn't there and the refusal lists the ones that are, so the
shape is one question, never five.

- `doc` — `title` (text), `body` (text). The words a person reads; what `search`
  searches.
- `task` — `priority` (number), `project` (eid), `assignee` (eid), `domain`
  (text). Anything with a state. Its `status` is READ, not written — `open`,
  `wip`, `done` or `cancelled`, derived from the two marks below.
- `completed` — `at` (time), `by` (eid). The mark that makes a task `done`; the
  store fills both, so `completed: {}` is the whole write.
- `cancelled` — `at` (time), `by` (eid), `reason` (text). Called off rather than
  finished.
- `project` — `color` (text). A thing others belong to, by `task.project`.
- `comment` — `target` (eid). A note aimed at another entity.
- `person` — no columns. Whoever wrote a row; their name is their `doc.title`.
- `archived` — no columns. The stamp that takes something out of the open list
  (`.archived=` selects the ones without it).
- `web` — `url` (url). An address out on the web.
- `blob` — `bytes` (number). A byte COUNT, not the bytes themselves.
- `attachment` — `blob` (eid), `mime` (text), `name` (text). A file, as `upload`
  writes it above.
- `image` — `w` (number), `h` (number). What a picture measures, on the blob
  itself; `upload` reads it off the file's own header (png, jpeg, gif, webp).

An edge is a sentence, not a column: `dependency` is `{type, child}`, where type
is one of `contains`, `requires`, `about`, `references`, `supersedes`.

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
    meter model nofix notice notified noverify opaque opened output pane patch
    person persona pin plan project prompt proposed quarantined reads reasoning
    recall recalled redaction references repo requires response result resume
    review role run runner runtime satisfies session setting settled shelf
    signin space spawn stderr stop_request subscription supersedes supervises
    task task_context timeout tool updated usage venture verifier wake wants
    web worked worktree yield

Anything the columns don't cover still lives in `doc.body`: it is text, so
markdown or JSON both keep there.

## An entity spans apps

An eid is the same thing everywhere. Two apps of the person's can write about
one entity, each in its own words: a reading list app saves the `book`, a
lending app saves who has it, and there is no copy and no sync between them —
they are one entity wearing two components, one per store.

A component lives with the app that DECLARES it, so nothing has to be agreed:
`book` is the reading list's word wherever it is written, `loan` is the lending
app's. Anything shared — `doc`, `comment`, `image` — goes to the app you name,
else the app where that entity already lives.

One word, one home — the first app in the space to declare it. Name it in a
second app's vocab.json and nothing is planted twice: the deploy answers
`book lives in reading-list`, this app reads and writes it there, and a column
you added grows that app's table.

A shape conflict is the only refusal — the same column declared with two types,
named with both types and with the app the word lives in.

Across spaces a word means what its space says: bundles merge by name only where
the shapes agree, and otherwise stay apart with the space named beside `kind`.

    graph_apply { app: 'reading', entities: [
      { entity: { eid: '$b' }, doc: { title: 'Piranesi' },
        book: { pages: 245 } } ] }

    graph_apply { app: 'lending', entities: [
      { entity: { eid: '<that eid>' }, loan: { to: 'Maya' } } ] }

`graph_query` with NO app named reads every app the person has at once and
answers one bundle per entity, composed out of whichever stores hold a piece:

    graph_query { filter: '.book!&.loan?' }
    → [ { kind: 'book', entity: { eid: '...', num: 3 },
          book: { pages: 245 }, loan: { to: 'Maya' },
          _stores: { book: 'jeff/reading', loan: 'jeff/lending' } } ]

`.book!` says which entities the answer is about; `.loan?` asks for the loan
beside them, where there is one. Name both with `!` (`.book!&.loan!`) and the
answer is only the books that are lent out — a filter's `&` is an intersection,
across apps as within one. `_stores` says which app holds which component, on a
bundle that spans two.

A PAGE reads a sibling app the same way, by naming its address:

    import { store } from '/reading/api/client.js'

    let lending = store('/lending/api/')
    let loans = await lending.query('.loan!')

It is the app's own door, so its `access` decides: a `private` app answers
nobody but its members, whichever page is asking.

## Tools of your own

An app can also carry its own **tools**, so the person's agent can act on it
without a page open. They go in a `tools.json` at the app's root, beside
`vocab.json`, and the same `app_deploy` hands them over:

    { "log_run": {
        "description": "Log a run for the club leaderboard",
        "input": { "who": "text", "miles": "number" },
        "apply": { "entity": { "eid": "$run" },
                   "jog": { "who": "{{who}}", "miles": "{{miles}}" } } },
      "leaderboard": {
        "description": "Every run since a date",
        "input": { "since": "time" },
        "query": ".jog!&.created.at>={{since}}" } }

After the deploy those are `runs__log_run` and `runs__leaderboard` at the
connector — `<app>__<tool>`, listed for the person and for everyone else in the
space, with the app's title in the description.

An entry is four things: a `description` (the sentence the model chooses by), an
`input` of arguments typed like a component's columns (`text`, `number`, `bool`,
`time`, `url` — all of them required), and exactly one act:

- `apply` — an entity bundle, or a list of them, exactly as `apply()` takes on
  the page.
- `query` — a filter line, answered as the same listing `query()` gets.

`{{arg}}` is a hole, filled from the call's arguments. A string that is nothing
but a hole keeps the argument's own type, so `"{{miles}}"` writes the number; a
hole inside a sentence is spliced in as text. A hole naming an argument the
`input` never declared is refused at deploy, with everything else wrong in the
file, in one sentence — nothing is planted until the whole manifest reads.

A tool is a template, never code: the act goes through the app's own doors as
the person calling it, so the app's `access` decides it, `created.by` names
them, and a refusal is the same sentence the page would show. Nobody gets more
through a tool than they have on the page.

### A page the answer draws itself in

An entry may also name a `view`: a page in the app's own files that the person's
agent RENDERS the answer in, instead of reading it out. Add it beside the act
and deploy the page with everything else:

    "leaderboard": { "description": "Every run since a date",
                     "input": { "since": "time" },
                     "query": ".jog!&.created.at>={{since}}",
                     "view": "leaderboard.html" }

The page gets the tool's answer over the host's own postMessage protocol: say
hello with `ui/initialize`, then draw whatever arrives in
`ui/notifications/tool-result` — `structuredContent` is what `query` answered,
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

Relative URLs still work: the door hands the host the page with a `<base>` at
the app's own address, so a stylesheet or an image beside `index.html` loads.
Its DATA does not come that way — `./api/query` from inside the frame is another
origin with no session on it. The answer arrives in the notification above, and
a redraw is a plain MCP `tools/call` back through the host for the app's own
tool, which does carry who is looking.

## Code of your own

An app is pages until you give it a `worker.js`, and then it has a server. Write
one beside `index.html` and `app_deploy` puts it in front of the app: every
request for the app that is not `/api/…` reaches it first, and **anything it
answers 404 falls through to the files**. So a worker owns the routes it names
and leaves every page, stylesheet and picture to the platform — you never have
to serve your own `index.html`.

The file itself is never served: `GET /<app>/worker.js` is a 404, and so are
`vocab.json` and `tools.json` — those three are the app's inside, not its pages,
and only a member reads them back (`app_files` read).

It is a plain ES module, and `env` holds three things:

- `env.STORE` — the app's own graph, at the same doors `client.js` uses, **as
  the person looking at the page**. `env.STORE.fetch('/query?.doc!')`,
  `env.STORE.fetch('/apply', {method: 'POST', body})`. A path, not a URL.
- `env.FILES` — the app's own files. `env.FILES.fetch('/index.html')`.
- one entry per secret you set, under the name you set it (below).

Name your routes anything that is not under `/api/`: that segment is the
platform's own doors — apply, query, me, graph, ws, blob, files — and a request
for one never reaches your worker. Your routes live beside it.

Here is the whole of it — one route out of the store, one outside call the page
must not be able to make itself:

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
anything. It never sees their platform session cookie: the app is owed this
visit and no more, and `env.STORE` already acts as them, so what the app's
`access` lets that person do is exactly what the worker can do.

**Secrets** are the reason to write a worker at all: an API key belongs on the
server, never in a page anyone can read. `app_secret_set` puts one on the app's
script, the worker reads it as `env.NAME`, and nothing — no tool, no query, no
history — can read it back. `app_secret_list` names them; `app_secret_remove`
takes one away. Ask the person for the value.

**Limits**: 50ms of CPU and 50 subrequests per request. That is a store read and
an outside call with room to spare; it is not a place to loop.

A throw, or a 5xx, becomes the same `exception` the pages file — the person's
agent hears about it on its next reply, and `app_errors` lists what is open. So
let it throw: a break you can see is worth more than a `catch` that hides it.

## The doors underneath

`client.js` is a wrapper over ordinary HTTP doors, same-origin, in case you want
them directly (or from `curl`, or from another page):

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

`apply` posts to the apply door, `query` and `search` read the query one, and
both answer by the app's `access` above: a refused write is 401 to a stranger
and 403 to a member who may not. `me` answers everyone — a stranger learning
they must sign in is what it is for.

## The filter line

The same grammar the platform speaks everywhere:

- `.doc.title~=cake` contains, `.task.status=open` equals, and an empty value
  asks for absent: `.archived=` is everything not archived.
- `.doc!` has the component at all.
- `.loan?` ASKS for a component without filtering on it — an answer carries the
  components its filter names, so `.book!&.loan?` is every book, wearing its
  loan where it has one. `*` asks for every component, which is what you want
  when you are looking rather than reading.
- `id=<eid>` fetches one by address, whole — an address names no component to
  leave out.
- `limit=50`, `after=<num>` page — a windowed read answers the NEWEST that many,
  where a plain list is oldest first; `.count!` counts instead of listing.
- Bare words are a full-text term, which is all `search` is.
- `&` joins them: `.recipe.minutes<=30&.doc.title~=cake` asks both at once. Each
  filter ends where the next `&` begins, so `.recipe!.created!` is not a filter
  — it is two of them run together.
- `.created!` asks for the platform's stamps — who saved a row and when. A
  listing leaves them out unless you name them, so what comes back is what you
  saved; `.recipe!&.created!` is your rows with their timestamps.

A row comes back as the components you named, plus its address and its kind —
`query('.recipe!')` answers recipes and no titles, and `query('.recipe!&.doc?')`
answers both. Ask for what you will draw.

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
