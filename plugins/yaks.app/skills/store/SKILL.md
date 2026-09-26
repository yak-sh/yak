---
name: store
description: 'The store, from a page (yaks.app). ./api/client.js in full — apply, query, search, subscribe, upload and me — what a bundle of components looks like going in, patching and deleting, compare-and-set with $was so two writers cannot both spend one value, who may read and write, the byline on a row, seed.json for the data an app comes with, and the HTTP endpoints underneath.'
---

# The store, from a page

Every app comes with a graph of its own and a client for reading and writing it
from the browser. This page is the whole of that client — what each function
accepts and returns, what you send when you save, what comes back when you read,
who may do either, and the HTTP endpoints underneath. The filter string itself —
what goes inside `query('…')` — has its own page:
<https://yaks.app/docs/querying.md>.

## The client, and every address relative

The platform serves one client beside every app, at `./api/client.js`:

    <script type="module">
      import { apply, me, query, search, subscribe, upload }
        from './api/client.js'
    </script>

Write that import as a relative path, and never write the app's own name into
any of the app's files. The code is _copied_ when somebody installs your app, so
a page carrying `/chores/api/client.js` is a 404 the moment the copy lands at
`/chore-chart/` — and it renders as bare HTML with nothing to explain why. The
platform gives every HTML page it serves a `<base href>` at the app's own
address (inside `<head>` if there is one, else after the doctype; a page with a
`<base>` of its own keeps it), which is what makes `./api/client.js` and
`./style.css` resolve from any depth the page is opened at — a pretty path like
`/recipes/42` included, where a relative URL would otherwise resolve against
`/recipes/42/`.

`store(base)` is the same six functions at an address you name. Every app in a
space shares one hostname, so a sibling app is a path — with or without its
trailing slash, and answering by its own `access`, whoever is asking:

    import { store } from './api/client.js'

    let lending = store('/lending/api/')
    let loans = await lending.query('.loan')

## The six functions

### apply(bundles)

A bundle is one entity and the components you are writing on it. `apply` accepts
one bundle or an array of them (`apply(b)` or `apply([b1, b2])`) and POSTs them
to `./api/apply` as `{entities: [...]}`. It returns:

    { ok: true,
      aliases: { $cake: '4f3c…' },
      bundles: [ {entity: {eid: '4f3c…'}, $alias: '$cake', doc: {…}}, ... ] }

`aliases` maps each `$alias` you sent to the eid it minted. `bundles` is what
landed, one bundle per entity written, each carrying the `$alias` you named it
by, with the properties the store stamped on it. The whole array is one batch —
every bundle in one `apply` call, applied in one transaction — so if any bundle
is refused, nothing in that call is written.

If the app's store cannot apply a write right now (yaks.app itself is failing,
not your data), the write is kept and applied later, in the order it was sent.
`apply` then returns `{ ok: true, pending: true, aliases: {}, bundles: [] }`.
Don't send the write again.

### query(filter)

    let recipes = await query('.recipe&?doc')

A GET of `./api/query?<filter>`, returning an array of rows — oldest first, in
the order they were written. An aggregate filter returns an object instead
(`query('.doc&.count')` → `{count: 12}`). The filter goes into the URL as you
wrote it, so a value carrying `&` or `#` needs `encodeURIComponent` around it;
`#` would otherwise start a fragment and take the rest of the filter with it.

### search(text, filter?)

    let lemony = await search('lemon')
    let quick = await search('lemon', '.recipe&?doc')

Full text over the app's `doc` rows — title and body, title weighted heavier —
in relevance order rather than creation order. The text is percent-encoded for
you and sent as a quoted phrase, so punctuation is safe to pass straight
through; a trailing `*` prefix-matches the last word (`search('lem*')`).

**What a hit carries.** A search term names no component, the way `id=` does
not, so a search with no filter returns the whole entity — every component the
row has. That is what lets a page draw cards from a search: the recipe's
`minutes` and `serves` are there, and a comment on a recipe can be told apart
from the recipe by the components it has.

Pass a filter and the ordinary rule is back — the answer is cut to the
components the filter names, so name the ones you will draw:

    await search('lemon', '.recipe')        // recipes, no titles
    await search('lemon', '.recipe&?doc')  // recipes with their titles

Either way a `rank` component rides along, which the store adds to the answer
only — never stored, never writable. `rank.snip` is a body snippet with each hit
wrapped between `\x01` and `\x02`, and `rank.title_hit` is the title marked the
same way.

### subscribe(filter, cb)

`query` that keeps returning. It hands back the stop function synchronously —
not a promise, so there is nothing to await. Its own section below.

### upload(file, {name}?)

    let file = await upload(input.files[0])
    let file = await upload(blob, { name: 'cake.jpg' })

Accepts a `File` off an `<input type=file>` or any `Blob`, POSTs the bytes to
`./api/blob`, and returns `{eid, url, mime, bytes}` plus `w` and `h` when the
bytes are a picture that declares its size (png, jpeg, gif, webp). `mime` is the
blob's own `type`; `name` defaults to `file.name` and is sent percent-encoded.
The bytes are stored under their SHA-256, so `eid` is that hash and the same
file twice is one upload and one row. 20 MB is the ceiling.

### me()

`{person, name, role, reads, writes, signIn}`, returned to anyone — a signed-out
visitor at a `private` app included, which is the point. Below.

## The bundle you save

An entity is a bundle: `{entity: {eid}, ...components}`. A component is a named
set of properties; the entity is whatever its components make it.

    let saved = await apply({
      entity: { eid: '$cake' },
      doc: { title: 'Lemon cake', body: '3 lemons, 200g butter…' },
      recipe: { serves: 8, minutes: 55 },
    })

- `entity.eid` naming an existing entity _patches_ it.
- A `$`-prefixed eid is an alias local to this batch: it mints an entity, and
  `saved.aliases.$cake` reports which one. The name is yours — `$cake`, `$1`,
  `$row-7`.
- No `entity` key at all mints one too, silently, and nothing in `aliases`
  points at it. Use an alias whenever you need the eid afterwards.
- An eid you minted yourself — a `crypto.randomUUID()`, or a sha256 hex string —
  that names nothing yet and carries components _defines_ that entity.
- A new entity needs at least one component, and one bundle per entity per
  batch: the same eid twice is refused, so merge them into one bundle.

A `$alias` — or a whole nested bundle — stands in wherever an eid goes: in
`entity.eid`, in a property that references an entity, in an edge's child. An
edge is a link between two entities rather than a property, so edges are written
under `edges`:

    await apply({
      entity: { eid: '$note' },
      doc: { body: 'needs a lemon' },
      comment: { target: { entity: { eid: cake } } },   // or just `cake`
      edges: [{ type: 'about', child: cake }],
    })

Both ends of an edge must exist, or be minted in the same batch. The `type` is
written the way the store declares it: the referencing edge is `referenced`,
never `references` — the latter is refused as `unknown edge type: references`.

### Patching, clearing, deleting

Four different things, four different ways to write them:

    // patch — send only what changes; every other property is left alone
    await apply({ entity: { eid: cake }, recipe: { minutes: 45 } })

    // clear one property — null on the property
    await apply({ entity: { eid: cake }, recipe: { minutes: null } })

    // drop the whole component — null instead of the object
    await apply({ entity: { eid: cake }, recipe: null })

    // delete the entity
    await apply({ entity: { eid: cake }, tombstone: {} })

A tombstone stands alone: it names an existing entity by eid and carries no
components and no edges (`a dead entity takes no patch` if it does), and it
needs an eid that already exists — there is nothing to delete behind a `$alias`.
Deleting cascades to entities that exist only about the deleted one. Writing to
the same eid later brings it back, holding only what that write gives it; a
write whose `$was` was read before the delete is dropped.

A row you read can be handed straight back as a patch: the fields a read adds —
`kind`, `rank`, the stamps — are dropped on the way in, and a reference that
came back as `{eid, name}` writes as the eid it named.

### Only one of you wins: `$was`

A batch is atomic, which tells you nothing about the read that came before it.
Two tabs, a phone and a tab, a page and an agent — each reads 40 gold, each
writes 50, and the second write is not wrong about anything except the world.
That is the duplicate reward, and it is a read-modify-write with nothing holding
the read.

So state what you based the write on. `$was` names, per component and per
property, the SHA-256 of the value you read, and the store refuses the whole
batch if that property has moved since. `was()` computes that hash, and is
exported beside `apply`:

    import { apply, query, was } from './api/client.js'

    let claim = async (eid) => {
      let [me] = await query(`id=${eid}&.player`)
      // Already collected today: nothing to write, and nothing to race.
      if (me.player.claimed == today()) return 'already claimed'
      await apply({
        entity: { eid },
        player: { gold: me.player.gold + 10, claimed: today() },
        // The guard: the day I read, as I read it. A second claim that read
        // the same day loses here rather than paying out twice.
        $was: { player: { claimed: await was(me.player.claimed) } },
      })
      return 'claimed'
    }

The refusal arrives as an ordinary throw, and its message names which property
moved and what it holds now — so the page re-reads and decides again rather than
clobbering a writer it never saw:

    try { await claim(eid) } catch (e) {
      if (/has moved since it was read/.test(e.message)) return claim(eid)
      throw e
    }

Three things worth knowing. `null` is a guard too — "I read no value" — and it
is how a property that must still be empty is guarded, which is the shape of
"mint this once". Every property you name must be one the vocabulary declares,
because a guard on a property that does not exist would compare absent to absent
and protect nothing. And the whole batch is refused, never the part that moved:
a title from one writer and a body from another is the state this exists to make
impossible.

Agents guard the same way, on the same property: `graph_apply` accepts `$was`
beside the components, and refuses with the same message.

## What a row carries back

    { kind: 'recipe',
      entity: { eid: '4f3c…' },
      doc: { title: 'Lemon cake', body: '…' },
      recipe: { serves: 8, minutes: 45 } }

`entity` and `kind` name the row. Everything else is exactly the components the
filter named — by presence (`.recipe`), by request (`?doc`), or by a predicate
of its own (`.recipe.minutes<=30`). A component asserted _absent_ (`!archived`)
filters without asking for anything back. `*` asks for every component, which is
what you want when you are looking rather than drawing.

A property of yours that nothing has ever written is on the row with the value
`null`, not missing from it — so `row.entry.mood` is the test for "was this
written", never `'mood' in row.entry`. The platform's own properties are no
exception: `doc.title` comes back null too, and `doc.body` — a content-addressed
blob — comes back null when there is none.

Three things a listing leaves out unless you name them: the platform's stamps
(`created`, `updated`, `notified`, `opened`, `quarantined` — `.created` asks for
them back); the platform's own rows about the app (`exception` and `error`, what
the platform recorded when something broke — `.exception` asks for those, and
asking for the stamps is _not_ asking for these); and `person` rows, which the
store mints for whoever writes to it and `query('.person&?doc')` lists by name.

## subscribe in practice

    let stop = subscribe('.task.status=open&?doc', (rows) => draw(rows))
    // …later
    stop()

What arrives is the _whole_ row set, not a delta: on the first call, and again
after every committed write that touches the filter's answer, the callback is
handed the current rows sorted oldest first — the same shape and the same
components `query()` returns for that same filter. So redraw the list from what
arrives; never append to what you drew last time.

- Ask for what you will draw. A subscription's rows carry the components its
  filter names, exactly like a query, so `.task.status=open` alone gives you no
  titles to paint.
- The write can come from anywhere: this tab, another tab, the person's phone,
  their agent through an MCP tool call. One socket per store, opened on the
  first subscription and shared by every subscription after it, reconnecting on
  its own and re-declaring every subscription on open — no catch-up to write.
- A row that is deleted, or that leaves the filter's answer, drops out of the
  set the callback gets. Nothing else changes.
- `stop()` removes that one subscription; the last one to leave closes the
  socket. Call it on `beforeunload`, or when the view it feeds is torn down.
- Subscribe to rows. An aggregate filter like `.count` has no rows to hand back,
  so the callback keeps being handed an empty array. Poll it with `query`
  instead.
- Keep the count small. A socket carries its declarations in about 2 KB of state
  so it survives hibernation, and past that a declaration is refused — quietly,
  from the page's side.
- A filter the store cannot serve fails on the socket, not in your code: it
  throws where the page's error reporter picks it up, rather than rejecting a
  promise you can catch. Try the filter through `query()` first.
- **A socket that will not open reports nothing at all.** `subscribe` does not
  throw and has no promise to reject, so a page that only subscribes shows an
  empty screen for as long as the socket is down — no error, no callback. It
  retries on its own, backing off to every 15 seconds, and the first frame that
  arrives fills the page. So `query` first for what you can draw now, then
  `subscribe` to keep it true; the first callback replaces the rows you drew.

      draw(await query('.task.status=open&?doc'))
      let stop = subscribe('.task.status=open&?doc', draw)

## Who may read, who may write

An app's `access` is one of three settings, given by `app_new` and `app_set`:

- `public` — the default. Anyone with the link reads. Only a member (owner or
  editor) writes.
- `open` — anyone with the link reads _and_ writes. The vote page, the shared
  list, the party wall.
- `private` — members only, both halves. The pages are hidden too, not just the
  data: a stranger asking for `/diary/` is sent to sign in, and someone signed
  in who is not a member gets the same answer a wrong address gets. The app's
  own `worker.js` runs ahead of that, and `env.APP` lets it write as the app — a
  private app with a worker is one whose gatekeeper is its own code.

A `viewer` reads a private app and never writes it. Writing the app's own files
(`PUT ./api/files/<path>`) is outside this bargain: those bytes are always an
owner's or an editor's to change, whatever the app lets its visitors save.

Ask on load, not on refusal:

    let who = await me()
    if (!who.writes) show(`<a href="${who.signIn}">Sign in to post</a>`)
    else if (!who.person) show('<input name="who" placeholder="Your name">')

Both halves matter, and they are different people. On a `public` app a guest who
types first is bounced to sign in and comes back to an empty form. On an `open`
app the guest writes fine — but they are nobody the platform knows, so their
rows have no `created.by` at all. If that page wants a byline, it has to ask for
a name and save it in a property of its own.

What `me()` returns:

- `person` — their eid, `null` when signed out.
- `name` — what to call them, `null` when signed out. A name, never an address.
- `role` — `owner`, `editor`, `viewer`, or `null`.
- `reads` / `writes` — this app's access, already worked out for this caller.
- `signIn` — the platform login page, already carrying this page as its return
  address. `null` once they are in. It is offered even on an `open` app, where
  signing in is not the way through but a named guest may still be wanted.

## The byline

The store stamps every row with who saved it, and a stamp is a component like
any other: it comes back when the filter names it.

    for (let e of await query('.doc&.created')) draw(e, e.created.by?.name)

`created.at` is when. `created.by` is who — and where this store knows the
person, it returns `{eid, name}` rather than a bare eid, so _one_ query draws a
list with its writers instead of painting "someone" and asking again.

This is a rule about references, not about that one stamp: any property that
points at an entity comes back with the name when the store knows that entity as
a person, a property of your own included.

The name is the one they chose at sign-in, or the front of their address if they
skipped the question. An address is never in the answer: an app's store learns
names and keeps no address book, so a `public` app answering `.person` to a
stranger hands out no roster. Anything the store cannot name stays the bare eid
it always was — and a write still accepts that eid, so a row read and handed
straight back means the entity it named:

    let [entry] = await query('.doc.title~=Fig&.created')
    await apply({
      entity: { eid: entry.entity.eid },
      task: {}, filed: { assignee: entry.created.by },   // {eid, name} writes as the eid
    })

A guest on an `open` app has nothing to name. Their `created.by` is null, which
is exactly what `me()` told the page before they typed.

## The data it comes with

A store can start with rows in it. Write a `seed.json` beside `index.html` — a
JSON list of the same bundles `apply` accepts — and the first `app_deploy`
writes them into the app's store:

    [ {"entity": {"eid": "$soup"}, "doc": {"title": "Lentil soup"},
       "recipe": {"serves": 4}},
      {"entity": {"eid": "$note"}, "doc": {"body": "double the cumin"},
       "comment": {"target": "$soup"}} ]

A `seed.yml` is the same list written as YAML, and is read the same way:

    - entity: {eid: $soup}
      doc: {title: Lentil soup}
      recipe: {serves: 4}

When there is a lot of it, write a `seed/` folder of `*.json` (or `*.yml`) files
instead — `seed/01-places.json`, `seed/02-menu.json` — and upload them a call at
a time. All of them are _one_ batch, read in filename order, so an alias minted
in one file resolves in the next and the pieces can point at each other. Either
layout works, and a `seed.json` with a `seed/` folder beside it is still that
one batch, the file first.

Four things to know:

- It runs once per store, after the app's own `vocab.json` is installed — so a
  seed may write components of your own — and it is marked as done. Deploy again
  and nothing is seeded: what the person has changed since is theirs.
- `app_install` gives the copy its own store, so the seed runs again there. That
  is how a published app arrives furnished in somebody else's space.
- A bundle the store refuses refuses the whole deploy, and nothing is written.
  The refusal names the file and the entry, then explains what was wrong:
  `seed/02-menu.json[7] was refused: unknown property: recipe.serving`. A file
  that is not JSON names itself the same way.
- The seed files are part of the app's inside, like `vocab.json` and
  `worker.js`: they are never served to the web. `app_files` reads them back.

Give a row a name and loading it twice is safe:

    {"entity": {"eid": "$soup"}, "alias": {"name": "recipe:lentil-soup"},
     "doc": {"title": "Lentil soup"}, "recipe": {"serves": 4}}

A row carrying `alias{name}` lands on the entity that already holds that name
instead of writing a second one — so the same seed loaded again is a patch, not
a duplicate. The name works wherever an eid does, too: in a property that
references an entity, in `id=`, and in `graph_show`. Where a value could be read
as either, the eid wins.

For data the person is meant to edit, that is all there is to it. For a table of
constants your page reads — an emoji list, a lookup — a plain `.js` file beside
the page is simpler, and it is not data anyone can change.

Data that arrives later is `store_load`, which reads the same kind of file on
purpose: `store_load(app, path)` writes one JSON file already in the app —
`data/cities.json` — or every `*.json` and `*.csv` under a folder you name, into
the store now, as you. It is one batch, in filename order, aliases resolving
across the files, and a refusal names the file and the entry exactly as a seed's
does; unlike a seed there is no once-only mark, so calling it again loads the
file again — which is safe when the rows carry `alias{name}`, since a named row
lands on the entity that already holds the name and the second load is a patch
rather than a pile of copies. It applies whatever the file contains — a bundle
carrying `tombstone: {}` deletes that entity, and the store decides whether you
may. That makes an import two calls and nothing transcribed:
`app_files(op: 'fetch')` writes the bytes of a public dataset into the app, and
`store_load` puts them in the store, reporting the files it read and how many
entities it wrote.

Most data a person already has is a spreadsheet, and a `.csv` is the same call
with one more argument: a spreadsheet does not state what a row is, so `as`
does. Each row becomes one entity with that component, and the header row names
its properties.

    id,name,serves
    lentil,Lentil soup,4
    fig,Fig tart,8

`store_load(app, path: 'data/menu.csv', as: 'recipe')` writes those two as
`recipe{name, serves}`, each value coerced to the type `vocab.json` declares for
the property — `serves` is a number, a `bool` accepts true/yes/1 either way
round, and an empty cell is left unwritten rather than written null. A `title`
or `body` header lands in the row's `doc`; an `id` (or `alias`) column is the
row's name — `alias{name}`, which lands on the entity already holding it, so
loading the file again patches the same rows instead of minting a second set of
them, and the name works wherever an eid does. Leave it out and every load mints
new rows. A header the component has no property for is refused by name: rename
it with `map {"Serves how many": "serves"}`, or declare the property in
`vocab.json`. A cell that will not coerce is refused naming the row and the
header, and the whole file is one batch, exactly as a JSON load is.

## The HTTP endpoints underneath

`client.js` is a wrapper over ordinary same-origin HTTP. Call these endpoints
directly from `curl`, from another page, or from your own `worker.js` through
`env.STORE`.

    POST ./api/apply
    content-type: application/json
    {"entities": [ {"entity": {"eid": "$r"}, "doc": {"title": "Lemon cake"}} ]}
    → {"ok": true, "aliases": {"$r": "4f3c…"}, "bundles": [...]}

    POST ./api/apply
    content-type: application/x-ndjson
    {"entity": {"eid": "$1"}, "doc": {"title": "Lemon cake"}}
    {"entity": {"eid": "$2"}, "doc": {"title": "Fig tart"}}
    → {"entity": {"eid": "4f3c…"}, "doc": {"title": "Lemon cake"}}
      {"entity": {"eid": "8b91…"}, "doc": {"title": "Fig tart"}}

    GET ./api/query?.doc
    → [ {"kind": "doc", "entity": {"eid": "4f3c…"},
         "doc": {"title": "Lemon cake"}} ]

    GET ./api/query?.doc&.count
    → {"count": 12}

    GET ./api/me
    → {"person": null, "name": null, "role": null, "reads": true,
       "writes": false, "signIn": "https://yaks.app/login?return=…"}

    GET ./api/vocab.json
    → [ {"title": "spine", "$defs": {"entity": {…}, "created": {…}, …}}, …,
        {"$defs": {"recipe": {…}}} ]

    POST ./api/blob
    content-type: image/jpeg          ← the file's own type
    x-yak-name: cake.jpg              ← optional, percent-encoded
    <the bytes>
    → {"eid": "9f2a…", "url": "/photos/api/blob/9f2a…",
       "mime": "image/jpeg", "bytes": 51234, "w": 1600, "h": 1200}

    GET ./api/blob/<eid>
    → the bytes, with that mime, cached forever

`./api/vocab.json` is every word the app's store speaks, the platform's and the
app's own, as the JSON Schema documents the store loaded. A page that keeps a
copy of its store in the browser (`@yaks/client`) loads them with `loadVocab`
before it opens, so it asks and writes exactly what the store takes —
`created.by` included.

The blob endpoint accepts a 64-character lowercase hex address and nothing else;
anything else is `no_such_file`. Bytes come back with the mime type and the
filename from their `attachment` row, `nosniff`, and a sandbox CSP, so an
uploaded page or SVG stays inert when someone opens it in a tab.

**Loading a lot at once.** A file too big for one `apply` goes to the same
endpoint as NDJSON — one bundle per line, blank lines skipped — and is applied
50 lines at a time, so neither the parse nor the transaction is ever the whole
file:

    curl -X POST https://ada.yaks.app/cookbook/api/apply \
      -H 'content-type: application/x-ndjson' \
      --data-binary @rows.ndjson

The answer is NDJSON too — one saved row per line, as each fifty commit — and it
is a 200 whatever happens, because the first rows are sent long before a later
line can be refused. So a refusal is the last line instead:
`{"error": "Refused", "message": "unknown property: recipe.serving", "line": 137,
"committed": 100}`
— the line the bad bundle was on, and how many landed before it. Nothing after
that line is read, and the fifty it was in rolled back whole. One thing to
watch: an alias resolves inside its own run of 50 lines and nowhere else, so
write `$cake` and the row pointing at it near each other.

Each endpoint is governed by the app's `access` — its read rule for `query`,
`blob/<eid>` and the live socket, its write rule for `apply` and `blob`, and
`me` answered to everyone. The whole set, as the 404 itself lists, is apply,
query, me, graph, ws, blob, and files/`<path>`; a request for anything under
`/api/` is the platform's, never your worker's.

## What a refusal says

Two shapes reach the page, and the client turns both into a thrown `Error`.

A refusal from the platform's own endpoints is JSON, and the client throws the
message alone:

    {"error": {"code": "not_a_writer", "message": "sign in to change this app"}}

    try { await apply(bundle) }
    catch (e) { e.signIn ? location = e.signIn : show(e.message) }

`e.signIn` is set only when signing in is the way through, and it already holds
this page as its return address. The codes from these endpoints: `not_a_reader`,
`not_a_writer` (401 to a stranger, 403 to a member who may not), `too_large`,
`no_bytes`, `space_full`, `no_such_file`, `method_not_allowed`, `not_found`.

A refusal from the store — an unknown component, a property that does not exist,
a bundle that does not parse — is plain text with a 400, so the message the
client throws is prefixed with the status and cut to 120 characters:

    400 unknown property: doc.name — doc has title (string), body (string)
    400 unknown component: recipy — a component of your own is declared…

Both messages are written to be read: a bad property names the properties that
do exist, and an undeclared component explains where one of your own comes from.

You need not wire any of this up to be told about it. The platform puts an error
reporter in every page it serves, so a throw, an unhandled rejection, or a
failed request is already on its way to the app's store and the person's agent.
Catch what you want to show.

## The mistakes

**Asking for the wrong components.** A row carries only the components its
filter named. `query('.recipe')` returns recipes with no titles, and a page
drawing `row.doc.title` prints `undefined` for every one of them. Ask for the
title beside it: `query('.recipe&?doc')`. `&?doc` is the way to ask for a
_second_ component — `.recipe.doc` addresses a _property_ of `recipe`, a
different question and one `recipe` has no answer to. `subscribe` returns the
same components a query does, so it is the same mistake there.

**Reaching for localStorage.** State a page keeps in the browser is invisible to
the person's other device, to anyone else looking at the same page, and to the
person's agent — and gone when they clear their browser. It is not a lighter
store; it is a store nobody else can see. Save a row instead. (In an installed
app its space's owner sandboxed, `localStorage` is the platform's: each
signed-in person's keys are kept in the app's store rather than the browser:
<https://yaks.app/docs/sharing.md>.)

**Writing the app's own name into the app.** `/chores/api/client.js`,
`/chores/style.css`, `fetch('/chores/api/query?…')` — every one breaks the
moment somebody installs a copy at another address. Write `./api/client.js` and
`./style.css`. The one address that legitimately names another app is a sibling
store you meant to read: `store('/lending/api/')`. A sandboxed copy reads a
sibling only as a stranger would.

**Saving the same thing twice.** Content addressing makes the same bytes one
blob and one `attachment` row — but a row of your _own_ pointing at them is
still a second row, and the wall shows the photo twice. Look first:

    let [seen] = await query(`.photo.blob=${file.eid}`)
    if (!seen) await apply({ photo: { caption, blob: file.eid } })

**Finding out who is looking from a refusal.** By then the guest has typed and
their work is gone. `me()` on load, every time.

---

The whole guide is at <https://yaks.app/docs.md>; the filter string has its own
page at <https://yaks.app/docs/querying.md>.
