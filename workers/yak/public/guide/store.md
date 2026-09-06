# The store, from a page

Every app comes with a graph of its own and a client for reading and writing it
from the browser. This page is the whole of that client — what each function
takes and answers, what a bundle looks like going in, what a row looks like
coming back, who may do either, and the HTTP doors underneath. The filter line
itself — what goes inside `query('…')` — has its own page:
<https://yaks.app/guide/querying.md>.

## The client, and every address relative

The kernel serves one client beside every app, at `./api/client.js`:

    <script type="module">
      import { apply, me, query, search, subscribe, upload }
        from './api/client.js'
    </script>

Write that import RELATIVE, and never write the app's own name into any of the
app's files. The code is COPIED when somebody installs your app, so a page
carrying `/chores/api/client.js` is a 404 the moment the copy lands at
`/chore-chart/` — and it renders as bare HTML with nothing saying so. The kernel
gives every HTML page it serves a `<base href>` at the app's own address (inside
`<head>` if there is one, else after the doctype; a page carrying its own
`<base>` keeps it), which is what makes `./api/client.js` and `./style.css`
resolve from any depth the page is opened at — a pretty path like `/recipes/42`
included, where a relative URL would otherwise resolve against `/recipes/42/`.

`store(base)` is the same six functions at an address you name. Every app in a
space shares one hostname, so a sibling app is a PATH — with or without its
trailing slash, and answering by its OWN `access`, whoever is asking:

    import { store } from './api/client.js'

    let lending = store('/lending/api/')
    let loans = await lending.query('.loan!')

## The six functions

### apply(bundles)

One bundle or an array of them (`apply(b)` or `apply([b1, b2])`), POSTed to
`./api/apply` as `{entities: [...]}`. It answers:

    { ok: true,
      changes: [ {eid, name, comp}, ... ],
      aliases: { $cake: '4f3c…' } }

`changes` is the flat wire form of what landed, one entry per component written.
`aliases` maps each `$alias` you sent to the eid it minted. The whole array is
one transaction: if any bundle is refused, nothing in the batch commits.

### query(filter)

    let recipes = await query('.recipe!&.doc?')

A GET of `./api/query?<filter>`, answering an array of rows — oldest first, by
the number the store minted. An aggregate filter answers an object instead
(`query('.doc!&.count!')` → `{count: 12}`). The filter goes into the URL as you
wrote it, so a VALUE carrying `&` or `#` needs `encodeURIComponent` around it;
`#` would otherwise start a fragment and take the rest of the line with it.

### search(text, filter?)

    let lemony = await search('lemon')
    let quick = await search('lemon', '.recipe!&.doc?')

Full text over the app's `doc` rows — title and body, title weighted heavier —
in relevance order rather than creation order. The text is percent-encoded for
you and sent as a quoted phrase, so punctuation is safe to pass straight
through; a trailing `*` prefix-matches the last word (`search('lem*')`).

**What a hit carries.** A word names no component to leave out, the way `id=`
does not, so a search with no filter answers the WHOLE entity — every component
the row has. That is what lets a page draw cards from a search: the recipe's
`minutes` and `serves` are there, and a comment on a recipe is telling apart
from the recipe by the components it has.

Pass a filter and the ordinary rule is back — the answer is cut to the
components the filter names, so name the ones you will draw:

    await search('lemon', '.recipe!')        // recipes, no titles
    await search('lemon', '.recipe!&.doc?')  // recipes with their titles

Either way a `rank` component rides along, which the store adds for the answer
only — never stored, never writable. `rank.snip` is a body snippet with each hit
wrapped between `\x01` and `\x02`, and `rank.title_hit` is the title marked the
same way.

### subscribe(filter, cb)

`query` that keeps answering. Returns the stop function SYNCHRONOUSLY — not a
promise, so there is nothing to await. Its own section below.

### upload(file, {name}?)

    let file = await upload(input.files[0])
    let file = await upload(blob, { name: 'cake.jpg' })

Takes a `File` off an `<input type=file>` or any `Blob`, POSTs the bytes to
`./api/blob`, and answers `{eid, url, mime, bytes}` plus `w` and `h` when the
bytes are a picture that states its size (png, jpeg, gif, webp). `mime` is the
blob's own `type`; `name` defaults to `file.name` and rides percent-encoded. The
bytes are stored under their SHA-256, so `eid` is that hash and the same file
twice is one upload and one row. 20 MB is the ceiling.

### me()

`{person, name, role, reads, writes, signIn}`, answered to ANYONE — a signed-out
visitor at a `private` app included, which is the point. Below.

## The bundle you save

An entity is a bundle: `{entity: {eid}, ...components}`. A component is a named
set of columns; the entity is whatever its components make it.

    let saved = await apply({
      entity: { eid: '$cake' },
      doc: { title: 'Lemon cake', body: '3 lemons, 200g butter…' },
      recipe: { serves: 8, minutes: 55 },
    })

- `entity.eid` naming an existing entity PATCHES it.
- A `$`-prefixed eid is a batch-local alias: it mints an entity, and
  `saved.aliases.$cake` says which one. The name is yours — `$cake`, `$1`,
  `$row-7`.
- No `entity` key at all mints one too, silently, and nothing in `aliases`
  points at it. Use an alias whenever you need the eid afterwards.
- An eid you minted yourself — a `crypto.randomUUID()`, or a sha256 hex string —
  that names nothing yet and carries components DEFINES that entity.
- A new entity needs at least one component, and one bundle per entity per
  batch: the same eid twice is refused, so merge them into one bundle.

A `$alias` — or a whole nested bundle — stands in wherever an eid goes: in
`entity.eid`, in a column that references an entity, in an edge's child. Edges
are sentences, not columns, and ride as `edges`:

    await apply({
      entity: { eid: '$note' },
      doc: { body: 'needs a lemon' },
      comment: { target: { entity: { eid: cake } } },   // or just `cake`
      edges: [{ type: 'about', child: cake }],
    })

Both ends of an edge must exist, or be minted in the same batch. The `type` is
the wire's own spelling: the referencing edge is `referenced`, never
`references` — the latter is refused as `unknown edge type: references`.

### Patching, clearing, deleting

Four different things, four different spellings:

    // patch — send only what changes; every other column is left alone
    await apply({ entity: { eid: cake }, recipe: { minutes: 45 } })

    // clear one column — null on the column
    await apply({ entity: { eid: cake }, recipe: { minutes: null } })

    // drop the whole component — null instead of the object
    await apply({ entity: { eid: cake }, recipe: null })

    // delete the entity
    await apply({ entity: { eid: cake }, tombstone: {} })

A tombstone stands ALONE: it names an existing entity by eid and carries no
components and no edges (`a dead entity takes no patch` if it does), and it
needs a real eid — there is nothing to kill behind a `$alias`. Death is
permanent, and it cascades to entities that exist only about the dead one.

A row you READ can be handed straight back as a patch: the projections a read
adds — `kind`, `rank`, the stamps — are dropped on the way in, and a reference
that came back as `{eid, name}` writes as the eid it named.

## What a row carries back

    { kind: 'recipe',
      entity: { eid: '4f3c…', num: 12 },
      doc: { title: 'Lemon cake', body: '…' },
      recipe: { serves: 8, minutes: 45 } }

`entity` and `kind` name the row. Everything else is exactly the components the
filter NAMED — by presence (`.recipe!`), by request (`.doc?`), or by a predicate
of its own (`.recipe.minutes<=30`). A component asserted ABSENT (`.archived=`)
filters without asking for anything back. `*` asks for every component, which is
what you want when you are looking rather than drawing.

A column of yours that nothing has ever written is on the row with the value
`null`, not missing from it — so `row.entry.mood` is the test for "was this
written", never `'mood' in row.entry`. The platform's own columns are no
exception: `doc.title` answers null too, and `doc.body` — a content-addressed
blob — answers null when there is none.

Three things a listing leaves out unless you name them: the platform's STAMPS
(`created`, `updated`, `notified`, `opened`, `quarantined` — `.created!` asks
for them back); the platform's own rows about the app (`exception` and `error`,
what the kernel wrote down when something broke — `.exception!` asks for those,
and asking for the stamps is NOT asking for these); and `person` rows, which the
store mints for whoever writes to it and `query('.person!&.doc?')` lists by
name.

## subscribe in practice

    let stop = subscribe('.task.status=open&.doc?', (rows) => draw(rows))
    // …later
    stop()

What arrives is a WHOLE ROW SET, not a delta: on the first call, and again after
every committed write that touches the filter's answer, the callback is handed
the current rows sorted oldest first — the same shape and the same projection
`query()` answers with for that same line. So redraw the list from what arrives;
never append to what you drew last time.

- Ask for what you will draw. A subscription's rows carry the components its
  filter names, exactly like a query, so `.task.status=open` alone gives you no
  titles to paint.
- The write can come from anywhere: this tab, another tab, the person's phone,
  their agent through an MCP tool. One socket per store, opened on the first
  subscription and shared by every subscription after it, reconnecting on its
  own and re-declaring every subscription on open — no catch-up to write.
- A row that dies, or that leaves the filter's answer, drops out of the set the
  callback gets. Nothing else changes.
- `stop()` removes that one subscription; the last one to leave closes the
  socket. Call it on `beforeunload`, or when the view it feeds is torn down.
- Subscribe to ROWS. An aggregate line like `.count!` has no rows to fold, so
  the callback keeps being handed an empty array. Poll it with `query` instead.
- Keep the count small. A socket carries its declarations in about 2 KB of state
  so it survives hibernation, and past that a declaration is refused — quietly,
  from the page's side.
- A filter the store cannot serve fails on the socket, not in your code: it
  throws where the page's error reporter picks it up, rather than rejecting a
  promise you can catch. Try the line through `query()` first.
- **A socket that will not open says nothing at all.** `subscribe` does not
  throw and has no promise to reject, so a page that only subscribes shows an
  empty screen for as long as the socket is down — no error, no callback. It
  retries on its own, backing off to every 15 seconds, and the first frame that
  arrives fills the page. So `query` FIRST for what you can draw now, then
  `subscribe` to keep it true; the first callback replaces the rows you drew.

      draw(await query('.task.status=open&.doc?'))
      let stop = subscribe('.task.status=open&.doc?', draw)

## Who may read, who may write

An app's `access` is one of three words, set by `app_new` and `app_set`:

- `public` — the default. Anyone with the link READS. Only a member (owner or
  editor) writes.
- `open` — anyone with the link reads AND writes. The vote page, the shared
  list, the party wall.
- `private` — members only, both halves. The pages are hidden too, not just the
  data: a stranger asking for `/diary/` is sent to sign in, and someone signed
  in who is nobody here gets the nothing-here a wrong address gets. The app's
  own `worker.js` runs ahead of that, and `env.APP` lets it write as the app — a
  private app with a worker is one whose gatekeeper is its own code.

A `viewer` reads a private app and never writes it. The file door
(`PUT ./api/files/<path>`) is outside this bargain: writing the app's own bytes
is always an owner's or editor's, whatever it lets its visitors save.

Ask on load, not on refusal:

    let who = await me()
    if (!who.writes) show(`<a href="${who.signIn}">Sign in to post</a>`)
    else if (!who.person) show('<input name="who" placeholder="Your name">')

Both halves matter, and they are different people. On a `public` app a guest who
types first is bounced to sign in and comes back to an empty form. On an `open`
app the guest writes fine — but they are nobody the platform knows, so their
rows have no `created.by` at all. If that page wants a byline, it has to ask for
a name and save it in a column of its own.

What `me()` answers:

- `person` — their eid, `null` when signed out.
- `name` — what to call them, `null` when signed out. A name, never an address.
- `role` — `owner`, `editor`, `viewer`, or `null`.
- `reads` / `writes` — this app's access, already answered for this caller.
- `signIn` — the platform login page, already carrying this page as its return
  address. `null` once they are in. It is offered even on an `open` app, where
  signing in is not the way through but a named guest may still be wanted.

## The byline

The store stamps every row with who saved it, and a stamp is a component like
any other: it comes back when the filter names it.

    for (let e of await query('.doc!&.created!')) draw(e, e.created.by?.name)

`created.at` is when. `created.by` is who — and where this store knows the
person, it answers `{eid, name}` rather than a bare eid, so ONE query draws a
list with its writers instead of painting "someone" and asking again.

This is a rule about REFERENCES, not about that one stamp: any column that
points at an entity answers with the name when the store knows that entity as a
person, a column of your own included.

The name is the one they chose at sign-in, or the front of their address if they
skipped the question. An address is never in the answer: an app's store learns
names and keeps no address book, so a `public` app answering `.person!` to a
stranger hands out no roster. Anything the store cannot name stays the bare eid
it always was — and a write still takes that eid, so a row read and handed
straight back means the entity it named:

    let [entry] = await query('.doc.title~=Fig&.created!')
    await apply({
      entity: { eid: entry.entity.eid },
      task: { assignee: entry.created.by },   // {eid, name} writes as the eid
    })

A guest on an `open` app has nothing to name. Their `created.by` is null, which
is exactly what `me()` told the page before they typed.

## The data it comes with

A store can start with rows in it. Write a `seed.json` beside `index.html` — a
JSON list of the same bundles `apply` takes — and the first `app_deploy` writes
them into the app's store:

    [ {"entity": {"eid": "$soup"}, "doc": {"title": "Lentil soup"},
       "recipe": {"serves": 4}},
      {"entity": {"eid": "$note"}, "doc": {"body": "double the cumin"},
       "comment": {"target": "$soup"}} ]

When there is a lot of it, write a `seed/` folder of `*.json` files instead —
`seed/01-places.json`, `seed/02-menu.json` — and write them a call at a time.
All of them are ONE batch, read in filename order, so an alias minted in one
file resolves in the next and the pieces can point at each other. Either
spelling works, and a `seed.json` with a `seed/` folder beside it is still that
one batch, the file first.

Four things to know:

- It runs ONCE per store, after the app's own `vocab.json` is planted — so a
  seed may write components of your own — and it is marked as done. Deploy again
  and nothing is seeded: what the person has changed since is theirs.
- `app_install` gives the copy its own store, so the seed runs again there. That
  is how a published app arrives furnished in somebody else's space.
- A bundle the store refuses refuses the whole deploy, and nothing is written.
  The refusal names the file and the entry, then says what was wrong:
  `seed/02-menu.json[7] was refused: unknown column: recipe.serving`. A file
  that is not JSON names itself the same way.
- The seed files are the app's inside, like `vocab.json` and `tools.json`: they
  are never served to the web. `app_files` reads them back.

For data the person is meant to edit, that is all there is to it. For a table of
constants your page reads — an emoji list, a lookup — a plain `.js` file beside
the page is simpler, and it is not data anyone can change.

## The doors underneath

`client.js` is a wrapper over ordinary same-origin HTTP. Use them directly from
`curl`, from another page, or from your own `worker.js` through `env.STORE`.

    POST ./api/apply
    content-type: application/json
    {"entities": [ {"entity": {"eid": "$r"}, "doc": {"title": "Lemon cake"}} ]}
    → {"ok": true, "changes": [...], "aliases": {"$r": "4f3c…"}}

    POST ./api/apply
    content-type: application/x-ndjson
    {"entity": {"eid": "$1"}, "doc": {"title": "Lemon cake"}}
    {"entity": {"eid": "$2"}, "doc": {"title": "Fig tart"}}
    → {"entity": {"eid": "4f3c…", "num": 12}, "doc": {"title": "Lemon cake"}}
      {"entity": {"eid": "8b91…", "num": 13}, "doc": {"title": "Fig tart"}}

    GET ./api/query?.doc!
    → [ {"kind": "doc", "entity": {"eid": "4f3c…", "num": 12},
         "doc": {"title": "Lemon cake"}} ]

    GET ./api/query?.doc!&.count!
    → {"count": 12}

    GET ./api/me
    → {"person": null, "name": null, "role": null, "reads": true,
       "writes": false, "signIn": "https://yaks.app/login?return=…"}

    POST ./api/blob
    content-type: image/jpeg          ← the file's own type
    x-yak-name: cake.jpg              ← optional, percent-encoded
    <the bytes>
    → {"eid": "9f2a…", "url": "/photos/api/blob/9f2a…",
       "mime": "image/jpeg", "bytes": 51234, "w": 1600, "h": 1200}

    GET ./api/blob/<eid>
    → the bytes, with that mime, cached forever

The blob door takes a 64-character lowercase hex address and nothing else;
anything else is `no_such_file`. Bytes come back with the mime and filename from
their `attachment` row, `nosniff`, and a sandbox CSP, so an uploaded page or SVG
stays inert when someone opens it in a tab.

**Loading a lot at once.** A file too big for one `apply` goes to the same door
as NDJSON — one bundle per line, blank lines skipped — and is applied 50 lines
at a time, so neither the parse nor the transaction is ever the whole file:

    curl -X POST https://ada.yaks.app/cookbook/api/apply \
      -H 'content-type: application/x-ndjson' \
      --data-binary @rows.ndjson

The answer is NDJSON too — one saved row per line, as each fifty commit — and it
is a 200 whatever happens, because the first rows are answered long before a
later line can be refused. So a refusal is the LAST line instead:
`{"error": "Refused", "message": "unknown column: recipe.serving", "line": 137,
"committed": 100}`
— the line the bad bundle was on, and how many landed before it. Nothing after
that line is read, and the fifty it was in rolled back whole. One thing to
watch: an alias resolves inside its own run of 50 lines and nowhere else, so
write `$cake` and the row pointing at it near each other.

Each door is governed by the app's `access` — its read rule for `query`,
`blob/<eid>` and the live socket, its write rule for `apply` and `blob`, and
`me` answered to everyone. The whole set, as the 404 itself says, is apply,
query, me, graph, ws, blob, and files/`<path>`; a request for anything under
`/api/` is the platform's, never your worker's.

## Refusals, in words

Two shapes reach the page, and the client turns both into a thrown `Error`.

A refusal from the kernel's own doors is JSON, and the client throws the
sentence alone:

    {"error": {"code": "not_a_writer", "message": "sign in to change this app"}}

    try { await apply(bundle) }
    catch (e) { e.signIn ? location = e.signIn : show(e.message) }

`e.signIn` is set only when signing in is the way through, and it already holds
this page as its return address. The codes from these doors: `not_a_reader`,
`not_a_writer` (401 to a stranger, 403 to a member who may not), `too_large`,
`no_bytes`, `space_full`, `no_such_file`, `method_not_allowed`, `not_found`.

A refusal from the STORE — an unknown component, a column that does not exist, a
bundle that does not parse — is plain text with a 400, so the message the client
throws is prefixed with the status and cut to 120 characters:

    400 unknown column: doc.name — doc {title: text, body: text}
    400 unknown component: recipy — a component of your own is declared…

Both sentences are written to be read: a bad column names the columns that do
exist, and an undeclared component says where one of your own comes from.

You need not wire any of this up to be TOLD about it. The kernel puts a reporter
in every page it serves, so a throw, an unhandled rejection, or a failed request
is already on its way to the app's store and the person's agent. Catch what you
want to SHOW.

## The mistakes

**Asking for the wrong components.** A row carries only the components its
filter named. `query('.recipe!')` answers recipes with no titles, and a page
drawing `row.doc.title` prints `undefined` for every one of them. Ask for the
title beside it: `query('.recipe!&.doc?')`. `&.doc?` is the way to ask for a
SECOND component — `.recipe.doc` addresses a COLUMN of `recipe`, a different
question and one `recipe` has no answer to. `subscribe` is the same projection,
so it is the same mistake there.

**Reaching for localStorage.** State a page keeps in the browser is invisible to
the person's other device, to anyone else looking at the same page, and to the
person's agent — and gone when they clear their browser. It is not a lighter
store; it is a store nobody else can see. Save a row instead.

**Writing the app's own name into the app.** `/chores/api/client.js`,
`/chores/style.css`, `fetch('/chores/api/query?…')` — every one breaks the
moment somebody installs a copy at another address. Write `./api/client.js` and
`./style.css`. The one address that legitimately names another app is a sibling
store you meant to read: `store('/lending/api/')`.

**Saving the same thing twice.** Content addressing makes the same bytes one
blob and one `attachment` row — but a row of your OWN pointing at them is still
a second row, and the wall shows the photo twice. Look first:

    let [seen] = await query(`.photo.blob=${file.eid}`)
    if (!seen) await apply({ photo: { caption, blob: file.eid } })

**Finding out who is looking from a refusal.** By then the guest has typed and
their work is gone. `me()` on load, every time.

---

The whole guide is at <https://yaks.app/guide.md>; the filter line has its own
page at <https://yaks.app/guide/querying.md>.
