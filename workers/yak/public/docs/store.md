---
doc:
  title: Frontend Data
guide:
  slug: store
  brief: reading and writing the store from a page with ./api/client.js
  description: >-
    The frontend data API, ./api/client.js, in full: every function it
    exports; apply, query, search, subscribe, upload, digest, me, the outbox of
    unsaved writes and store(base) for another app's store; the bundle of
    components a write sends;
    patching and deleting; compare-and-set with $was so two writers cannot
    both spend one value; read and write access; the created.by author stamp
    on a row; seed.json seed data and store_load imports; and the HTTP
    endpoints underneath.
---

# Frontend Data

Every app has its own graph of data, the app's **store**, and a JavaScript
client for reading and writing the store from the browser. This page documents
that client in full: what each function accepts and returns, what a write sends,
what a read returns, who may do either, and the HTTP endpoints underneath. The
filter syntax used inside `query('…')` has its own page, Query Syntax:
<https://yaks.app/docs/querying.md>.

## Importing the client with relative paths

The platform serves one client beside every app, at `./api/client.js`:

    <script type="module">
      import { apply, me, query, search, subscribe, upload }
        from './api/client.js'
    </script>

Write that import as a relative path, and never write the app's own name into
any of the app's files. The code is _copied_ when somebody installs your app, so
a page that imports `/chores/api/client.js` gets a 404 as soon as the copy is
served at `/chore-chart/`, and it renders as bare HTML with no error to explain
why. The platform gives every HTML page it serves a `<base href>` set to the
page's own folder under the app's address (inside `<head>` if there is one, else
after the doctype; a page with a `<base>` of its own keeps it), so a relative
URL resolves the way it does on any web page, wherever the app is served.
`index.html`'s folder is the app's root folder, so `./api/client.js` and
`./style.css` also resolve from a route such as `/recipes/42`, where the app's
`index.html` answers and a relative URL would otherwise resolve against
`/recipes/42/`. A page in a folder, `admin/index.html`, reaches the same client
at `../api/client.js`.

## Exports of `client.js`

`client.js` exports fifteen names. These eleven are bound to the app's own
store:

- the functions `apply`, `query`, `search`, `subscribe`, `upload` and `me`, and
  the `outbox` object, each documented below.
- `drafts`, which keeps a person's typed input in the store
  ([Realtime Sync and Persistence](./storage.md)).
- `publish`, `unpublish` and `publicFiles`, which put a file on the public web
  at a path of the app's address ([Files and Uploads](./files.md)).

These four functions need no store:

- `was(value)`, the hash a compare-and-set write names, documented under
  Compare-and-set with `$was` below.
- `digest(file)`, the SHA-256 of a file, documented below.
- `draftEid(by, place)`, the eid of a person's draft at a place
  ([Components and vocab.json](./components.md)).
- `store(base)`, described next.

`store(base)` returns an object holding the eleven names bound to a store
(`apply`, `query`, `search`, `subscribe`, `upload`, `me`, `outbox`, `drafts`,
`publish`, `unpublish` and `publicFiles`), pointed at the store at the address
you pass. Every app in a space shares one hostname, so a sibling app (another
app in the same space) is addressed by its path, with or without the trailing
slash. The sibling answers according to its own `access` setting, whoever is
asking:

    import { store } from './api/client.js'

    let lending = store('/lending/api/')
    let loans = await lending.query('.loan')

`store(base, {clock})` keeps the store's waits on `clock` instead of the
browser's timers: the outbox's and an upload's retries, and the socket's
reconnects. `clock.after(ms, fn)` calls `fn` once `ms` milliseconds have passed
and returns a function that cancels it, so a test of a page moves the store's
time itself.

## Client functions

### apply(bundles)

A bundle is one entity and the components you are writing on it. `apply` accepts
one bundle or an array of them (`apply(b)` or `apply([b1, b2])`) and POSTs them
to `./api/apply` as `{entities: [...]}`. It returns:

    { ok: true,
      aliases: { $cake: '4f3c…' },
      bundles: [ {entity: {eid: '4f3c…'}, $alias: '$cake', doc: {…}}, ... ] }

`aliases` maps each `$alias` you sent to the eid it minted. `bundles` is what
was written: one bundle per entity, each carrying the `$alias` you named it by,
with the properties the store stamped on it. The whole array is one batch (every
bundle in one `apply` call is applied in one transaction), so if any bundle is
refused, nothing in that call is written.

If the answer is neither an acceptance nor a refusal (the request failed, or
yaks.app itself is failing, not your data), `apply` throws an `Error`, and the
write stays in the `outbox` (below), which sends it again on its own until the
store answers it. Don't call `apply` with the write again: that is a second
write.

### query(filter)

    let recipes = await query('.recipe&?doc')

Sends a GET request to `./api/query?<filter>` and returns an array of rows,
oldest first, in the order they were written. An aggregate filter returns an
object instead (`query('.doc&.count')` → `{count: 12}`). The filter goes into
the URL exactly as you wrote it, so a value containing `&` or `#` needs
`encodeURIComponent` around it; `#` would otherwise start a URL fragment and cut
off the rest of the filter.

### search(text, filter?)

    let lemony = await search('lemon')
    let quick = await search('lemon', '.recipe&?doc')

Full-text search over the app's `doc` rows (title and body, with the title
weighted higher), returned in relevance order rather than creation order. The
text is percent-encoded for you and sent as a quoted phrase, so punctuation is
safe to pass through unchanged; a trailing `*` prefix-matches the last word
(`search('lem*')`).

**What a search result contains.** A search term names no component (neither
does `id=`), so a search with no filter returns the whole entity: every
component the row has. This lets a page draw cards from search results: the
recipe's `minutes` and `serves` are included, and a comment on a recipe can be
told apart from the recipe by its components.

With a filter, the usual rule applies: the result contains only the components
the filter names, so name the ones you will draw:

    await search('lemon', '.recipe')        // recipes, no titles
    await search('lemon', '.recipe&?doc')  // recipes with their titles

In both cases each result also carries a `rank` component, which the store adds
to the response only; it is never stored and cannot be written. `rank.snip` is a
body snippet with each match wrapped between `\x01` and `\x02`, and
`rank.title_hit` is the title marked the same way.

### subscribe(filter, cb)

A `query` that keeps calling back with the current rows as they change, and the
way a page loads the data it draws: the first rows come over the page's existing
connection while its WebSocket opens. `subscribe` returns at once the function
that ends the subscription; that function's `ready` property is a promise of the
first rows. It is described in full in its own section below.

### upload(file, {name}?)

    let file = await upload(input.files[0])
    let file = await upload(blob, { name: 'cake.jpg' })

Accepts a `File` from an `<input type=file>` or any `Blob`, POSTs the bytes to
`./api/blob`, and returns `{eid, url, mime, bytes}`, plus `w` and `h` when the
bytes are a picture that declares its size (png, jpeg, gif, webp). `mime` is the
blob's own `type`; `name` defaults to `file.name` and is sent percent-encoded.
The bytes are stored under their SHA-256, so `eid` is that hash, and uploading
the same file twice stores one copy and writes one row. The app's `vocab.json`
sets which files it accepts, by size and type ([Files and Uploads](./files.md)).
A file of 32 MiB or more is uploaded in parts, several at a time, and resumes
where it stopped: uploading the same file again sends only the parts that had
not arrived ([Files and Uploads](./files.md)).

### digest(file)

    let eid = await digest(input.files[0])

The SHA-256 of a `File` or `Blob`, in hex: the eid `upload` returns for it. It
reads the file a few MiB at a time, so it works on a file larger than memory.

### me()

Returns `{person, name, role, reads, writes, signIn, invited}` to any caller,
including a signed-out visitor at a `private` app, so a page can always ask what
the visitor may do. The fields are described below.

### outbox

    let off = outbox.onPending(() => drawUnsaved(outbox.pending()))

The **outbox** holds every write `apply` has sent until the store accepts it. In
a browser it is kept in IndexedDB, one outbox per store address and signed-in
person, so a write survives a reload: the next page opened on the same store by
the same person sends it again. Each write carries an `idempotency-key` header,
and the store writes a write sent again under the same key only once. Writes are
sent in the order they were made, so a write whose outcome is unknown holds back
the writes after it.

- `outbox.pending()` returns the writes not yet accepted, oldest first, each as
  `{key, sent, state, at, refusal}`. `sent` is the `{entities: [...]}` that
  `apply` sent, `state` is `pending` or `refused`, and `refusal` is
  `{name, message}` on a refused write.
- `outbox.onPending(fn)` calls `fn` whenever that list changes, and returns the
  function that stops it.
- `outbox.retry(key)` sends a refused write again, and `outbox.forget(key)`
  discards a write.
- `outbox.ready` is a promise that resolves once the kept writes are loaded, and
  `outbox.close()` stops the outbox.

A write stays `pending`, and is sent again a second later, while its outcome is
unknown: the request failed, or the answer was a 202, a 408, 425 or 429, a
status of 500 or more, or neither a receipt nor a JSON error. A refusal (any
other JSON error, such as `refused` for an unknown property, or `not_a_writer`;
see Error responses below) is kept as `refused` and is not sent again until
`retry(key)`. Either way, `apply` throws.

## Bundle format

A write sends each entity as a bundle: `{entity: {eid}, ...components}`. A
component is a named set of properties, and an entity is defined entirely by the
components it carries.

    let saved = await apply({
      entity: { eid: '$cake' },
      doc: { title: 'Lemon cake', body: '3 lemons, 200g butter…' },
      recipe: { serves: 8, minutes: 55 },
    })

- `entity.eid` naming an existing entity _patches_ it.
- A `$`-prefixed eid is an alias local to this batch: it mints an entity, and
  `saved.aliases.$cake` reports which one. You choose the name: `$cake`, `$1`,
  `$row-7`.
- A bundle with no `entity` key also mints an entity, but nothing in `aliases`
  points at it. Use an alias whenever you need the eid afterwards.
- An eid you minted yourself (a `crypto.randomUUID()`, or a sha256 hex string)
  that names no entity yet and carries components _defines_ that entity.
- A new entity needs at least one component, and a batch holds one bundle per
  entity: the same eid twice is refused, so merge them into one bundle.

A `$alias`, or a whole nested bundle, can be used anywhere an eid is expected:
in `entity.eid`, in a property that references an entity, in an edge's child. An
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
never `references`, which is refused as `unknown edge type: references`.

### Patching, clearing and deleting

Each of these four operations is written differently:

    // patch: send only what changes; every other property is left alone
    await apply({ entity: { eid: cake }, recipe: { minutes: 45 } })

    // clear one property: null on the property
    await apply({ entity: { eid: cake }, recipe: { minutes: null } })

    // drop the whole component: null instead of the object
    await apply({ entity: { eid: cake }, recipe: null })

    // delete the entity
    await apply({ entity: { eid: cake }, tombstone: {} })

A tombstone bundle carries nothing else: it names an existing entity by eid and
carries no components and no edges (one that does is refused with
`a dead entity takes no patch`), and it needs an eid that already exists, since
a `$alias` names nothing to delete. Deleting an entity cascades to the entities
that exist only about it. A later write to the same eid brings the entity back,
holding only what that write carries; a write whose `$was` was read before the
delete is dropped.

A row returned by a read can be sent back as a patch once its stamps are
removed: the fields a read adds, `kind` and `rank`, are dropped when the write
arrives, and a reference returned as `{eid, name}` is written as the eid it
names. A stamp (`created.at`, `completed.via`) is set by the server, and a write
that includes one is refused. The `entity` key can be sent back whole: its
`entity.archetype` is set by the store, and the value sent is dropped.

### Compare-and-set with `$was`

A batch is atomic, but that says nothing about the read the write was based on.
Two writers (two tabs, a phone and a tab, a page and an agent) each read 40 gold
and each write 50. The second write is valid on its own, but it was based on a
value that has since changed, and the reward is paid twice. This is a
read-modify-write race: nothing checks that the value read is still current when
the write lands.

To prevent it, a write states the values it was based on. `$was` names, per
component and per property, the SHA-256 of the value you read, and the store
refuses the whole batch if that property has changed since. `was()` computes
that hash, and is exported beside `apply`:

    import { apply, query, was } from './api/client.js'

    let claim = async (eid) => {
      let [me] = await query(`id=${eid}&.player`)
      // Already claimed today: there is nothing to write, so nothing to race.
      if (me.player.claimed == today()) return 'already claimed'
      await apply({
        entity: { eid },
        player: { gold: me.player.gold + 10, claimed: today() },
        // The guard: the `claimed` value as it was read. A second claim based
        // on the same read is refused here instead of paying out twice.
        $was: { player: { claimed: await was(me.player.claimed) } },
      })
      return 'claimed'
    }

The refusal is thrown as an ordinary error with `e.status` 409, and its message
names the property that changed and its current value, so the page can read
again and decide again instead of overwriting a write it never saw. The refused
write stays in the [outbox](#outbox) as `refused` until the page forgets it, so
forget it before trying again:

    import { outbox } from './api/client.js'

    try { await claim(eid) } catch (e) {
      if (!/has moved since it was read/.test(e.message)) throw e
      for (let w of outbox.pending()) {
        if (w.refusal?.message == e.message) await outbox.forget(w.key)
      }
      return claim(eid)
    }

Three more details. `null` is a guard too, meaning "I read no value": it guards
a property that must still be empty, which is how to write something exactly
once. Every property you name must be one the vocabulary declares, because a
guard on a property that does not exist would compare absent to absent and
protect nothing. And the store refuses the whole batch, never only the part that
changed: a title from one writer and a body from another is the state `$was`
exists to prevent.

Agents use the same guard on the same properties: `graph_apply` accepts `$was`
beside the components, and refuses with the same message.

## Rows returned by a query

    { kind: 'recipe',
      entity: { eid: '4f3c…' },
      doc: { title: 'Lemon cake', body: '…' },
      recipe: { serves: 8, minutes: 45 } }

`entity` and `kind` identify the row. Every other key is one of the components
the filter named: by presence (`.recipe`), by request (`?doc`), or by a
predicate on it (`.recipe.minutes<=30`). A component asserted _absent_
(`!archived`) filters the rows without adding anything to them. `*` asks for
every component, which is useful when you are inspecting data rather than
drawing a page.

A declared property that has never been written is on the row with the value
`null`, not missing from it, so test `row.entry.mood` to learn whether it was
written, never `'mood' in row.entry`. The platform's own properties behave the
same way: `doc.title` comes back null too, and `doc.body` (a content-addressed
blob) comes back null when there is none.

A query leaves out three things unless the filter names them: the platform's
stamps (`created`, `updated`, `notified`, `opened`, `quarantined`; `.created`
asks for them back); the platform's own rows about the app (`exception`,
`refusal` and `error`, what the platform recorded when something broke or a
request was declined; name each diagnostic separately, such as `.exception` or
`.refusal`, and asking for the stamps does _not_ ask for these); and `person`
rows, which the store mints for whoever writes to it and `query('.person&?doc')`
lists by name. Asking for `.entry` also returns transcript `refusal` rows, but
not exceptions.

## Live queries with `subscribe`

    let stop = subscribe('.task.status=open&?doc', (rows) => draw(rows))
    // …later
    stop()

What arrives is the _whole_ row set, not a delta: on the first call, and again
after every committed write that changes the filter's answer, the callback is
handed the current rows sorted oldest first, with the same shape and the same
components `query()` returns for that filter. So redraw the list from what
arrives; never append to what you drew last time.

- Ask for the components you will draw. A subscription's rows carry the
  components its filter names, exactly like a query, so `.task.status=open`
  alone gives you no titles to draw.
- The write can come from any writer: this tab, another tab, the person's phone,
  their agent through an MCP tool call. There is one WebSocket per store, opened
  on the first subscription and shared by every subscription after it. It
  reconnects on its own and re-declares every subscription when it opens, so the
  page needs no code to catch up after a reconnect.
- A row that is deleted, or that stops matching the filter, is removed from the
  set the callback receives. The rest of the set is unchanged.
- `stop()` removes that one subscription; removing the last one closes the
  socket. Call it on `beforeunload`, or when the view it feeds is torn down.
- Subscribe to rows. An aggregate filter like `.count` returns no rows, so the
  callback is always handed an empty array. Poll an aggregate with `query`
  instead.
- Keep the number of subscriptions small. A socket stores its subscription
  declarations in about 2 KB of state so that it survives hibernation, and a
  declaration past that limit is refused without any error reaching the page.
- A filter the store cannot serve is thrown where the page's error reporter
  picks it up, and rejects the subscription's `ready` (below), which is the
  place to catch it.
- **The first rows do not wait for the socket.** They come from a query on the
  connection the page already has, and the socket's first frame replaces them,
  so a page that only subscribes is drawn as soon as a query would have drawn
  it. A socket that does not open retries on its own, backing off to one attempt
  every 15 seconds. Calling `query` with the same filter before subscribing only
  sends the store the same request twice.
- **`ready` resolves with the first rows**, for a page that needs them before it
  continues. It rejects with the store's refusal of the filter:

      let open = subscribe('.task.status=open&?doc', draw)
      let [who, tasks] = await Promise.all([me(), open.ready])

  Several filters subscribed at the same time load in one round trip, and
  filters combined into one filter load in one request: `(.task|.comment)&?doc`
  ([Performance](./speed.md)).

### Synchronized server time

For shared deadlines, use `link.now()` on a Sync from `@yaks/sync`, or
`client.wire.now()` on an `@yaks/client` configured with a server URL. It
returns epoch milliseconds on the app store's clock, calibrated over the same
`./api/ws` socket the client already uses. No extra HTTP request or `Date`
header is needed, and the box's `@yaks/api` server speaks the same protocol.

The first call starts calibration; before a reply it returns local time.
Thereafter each call is a local read of the estimated store time. Measured round
trips refine the offset (excluding server work, preferring low-delay samples).
While offline it keeps the last offset and resamples on reconnect. Call the
client's `close()` when finished to stop its socket and clock probes.
Corrections can move time forward or backward; use a local monotonic timer for
elapsed durations, and this clock for agreed epoch deadlines. Network asymmetry
still limits precision; it is not an authority for enforcing rules.

## Read and write access

An app's `access` is one of three settings, given by `app_new` and `app_set`:

- `public`: the default. Anyone with the link reads. Only a member (owner or
  editor) writes.
- `open`: anyone with the link reads _and_ writes. For example a vote page, a
  shared list or a party wall.
- `private`: members only, for reading and for writing. The pages are hidden
  too, not just the data: a stranger asking for `/diary/` is sent to sign in,
  and someone signed in who is not a member gets the same answer a wrong address
  gets. The app's own `worker.js` runs before that check, and `env.APP` lets it
  write as the app, so in a private app with a worker, the worker's own code
  decides who gets in.

A `viewer` reads a private app and never writes it. Writing the app's own files
(`PUT ./api/files/<path>`) is not governed by `access`: only an owner or an
editor can change those files, whatever the app lets its visitors save.

Call `me()` when the page loads, not after a write is refused, and in parallel
with the page's reads rather than before them, since no read waits on its
answer:

    let who = await me()
    if (!who.writes) {
      show(who.signIn ? `<a href="${who.signIn}">Sign in to post</a>`
         : who.invited ? 'Accept the invitation in your email, then come back.'
         : 'Only members of this app can post.')
    } else if (!who.person) show('<input name="who" placeholder="Your name">')

Both checks matter, and they apply to different visitors. On a `public` app, a
guest who types before signing in is sent to sign in and comes back to an empty
form. On an `open` app the guest's write succeeds, but the platform does not
know who they are, so their rows have no `created.by` at all. If that page wants
to show an author, it has to ask for a name and save it in a property of its
own.

What `me()` returns:

- `person`: their eid, `null` when signed out.
- `name`: what to call them, `null` when signed out. A name, never an email
  address.
- `role`: `owner`, `editor`, `viewer`, or `null`.
- `reads` / `writes`: this app's access, already worked out for this caller.
- `signIn`: the platform login page, already carrying this page as its return
  address. `null` once they are signed in. It is set even on an `open` app,
  where signing in is not needed to write but a page may still want a named
  guest.
- `invited`: `true` when they are signed in, may not write here yet, and the
  owner has invited them (`member_add`). The remaining step is the accept link
  in the email yaks.app sent them, which no page can follow for them.

## Author names on rows: `created.by`

The store stamps every row with who wrote it, and a stamp is a component like
any other: it is returned when the filter names it.

    for (let e of await query('.doc&.created')) draw(e, e.created.by?.name)

`created.at` is when the row was written, and `created.by` is who wrote it.
Where this store knows the person, `created.by` is returned as `{eid, name}`
rather than a bare eid, so _one_ query draws a list with its authors' names,
without drawing "someone" and asking again.

This applies to every reference, not only to that stamp: any property that
points at an entity is returned with the name when the store knows that entity
as a person, including a property the app declares.

The name is the one they chose under Settings at yaks.app/manage/settings, or
the one they were invited under, else the part of their email address before the
`@`. An email address is never returned: an app's store records names and keeps
no email addresses, so a `public` app answering `.person` to a stranger gives
out no one's address. A reference the store cannot name is returned as the bare
eid, and a write accepts that eid, so a row read and sent straight back refers
to the same entities:

    let [entry] = await query('.doc.title~=Fig&.created')
    await apply({
      entity: { eid: entry.entity.eid },
      task: {}, filed: { assignee: entry.created.by },   // {eid, name} writes as the eid
    })

A guest on an `open` app has no name to return. Their `created.by` is null,
which matches what `me()` told the page before they typed.

## Seed data and imports

An app's store can start with rows in it. Write a `seed.json` beside
`index.html` (a JSON list of the same bundles `apply` accepts), and the first
`app_deploy` writes them into the app's store:

    [ {"entity": {"eid": "$soup"}, "doc": {"title": "Lentil soup"},
       "recipe": {"serves": 4}},
      {"entity": {"eid": "$note"}, "doc": {"body": "double the cumin"},
       "comment": {"target": "$soup"}} ]

A `seed.yml` is the same list written as YAML, and is read the same way:

    - entity: {eid: $soup}
      doc: {title: Lentil soup}
      recipe: {serves: 4}

For a large seed, write a `seed/` folder of `*.json` (or `*.yml`) files instead
(`seed/01-places.json`, `seed/02-menu.json`) and upload them one call at a time.
All of them are _one_ batch, read in filename order, so an alias minted in one
file resolves in the next and the files can reference each other's rows. Both
layouts work, and a `seed.json` with a `seed/` folder beside it is still one
batch, with `seed.json` first. One batch holds at most 2,000 entities, or 1.9 MB
of them; a seed bigger than that makes the deploy fail, and the rest of the data
belongs in a data folder that `store_load` writes.

How seeding behaves:

- It runs once per store, after the app's own `vocab.json` is installed (so a
  seed may write the app's own components), and it is then marked as done.
  Deploying again seeds nothing, so changes the person has made since are kept.
- `app_install` gives the copy its own store, so the seed runs again there. That
  is how a published app installed in somebody else's space starts with its seed
  data.
- A bundle the store refuses refuses the whole deploy, and nothing is written.
  The refusal names the file and the entry, then explains what was wrong:
  `seed/02-menu.json[7] was refused: unknown property: recipe.serving`. A file
  that is not JSON is named the same way.
- The seed files are internal to the app, like `vocab.json` and `worker.js`:
  they are never served to the web. `app_files` reads them back.

A row with a name can be loaded twice safely:

    {"entity": {"eid": "$soup"}, "alias": {"name": "recipe:lentil-soup"},
     "doc": {"title": "Lentil soup"}, "recipe": {"serves": 4}}

A row carrying `alias{name}` lands on the entity that already holds that name
instead of writing a second one, so the same seed loaded again is a patch, not a
duplicate. The name works wherever an eid does, too: in a property that
references an entity, in `id=`, and in `graph_show`. Where a value could be read
as either, the eid wins.

Seed rows are for data the person is meant to edit. For a table of constants
your page reads (an emoji list, a lookup table), a plain `.js` file beside the
page is simpler, and nobody can change it.

Data added later is loaded with `store_load`, which deliberately reads the same
file format. `store_load(app, path)` writes one JSON file already in the app
(`data/cities.json`), or every `*.json` and `*.csv` under a folder you name,
into the store immediately, as you. It is one batch, in filename order, with
aliases resolving across the files, and a refusal names the file and the entry
exactly as a seed's does. Unlike a seed it has no run-once mark, so calling it
again loads the file again. That is safe when the rows carry `alias{name}`: a
named row lands on the entity that already holds the name, so the second load is
a patch rather than a set of copies. It applies whatever the file contains: a
bundle carrying `tombstone: {}` deletes that entity, and the store decides
whether you may. So an import takes two calls, with no data copied into a tool
call by hand: `app_files(op: 'fetch')` writes the bytes of a public dataset into
the app, and `store_load` writes them into the store, reporting the files it
read and how many entities it wrote.

A store serves no other request while it writes one batch, so a batch holds at
most 2,000 entities, or 1.9 MB of them. A bigger load is written in parts of
that size, one after another, each its own batch, written whole or not at all.
An alias like `$here` resolves within its own part only; a row that later parts
reference needs an `alias{name}`, which resolves across parts. If a part is
refused, the parts before it stay written and the refusal says which were
written; fix the file and call again with the `part:` it names to continue from
there. A call that has been writing for a minute stops between parts the same
way, and its response names the part to continue from.

Data a person already has is often a spreadsheet. A `.csv` loads with the same
call and one more argument, `as`, because a CSV file does not say what a row is:
`as` names the component. Each row becomes one entity with that component, and
the header row names its properties.

    id,name,serves
    lentil,Lentil soup,4
    fig,Fig tart,8

`store_load(app, path: 'data/menu.csv', as: 'recipe')` writes those two as
`recipe{name, serves}`, each value coerced to the type `vocab.json` declares for
the property: `serves` is a number, a `bool` accepts true/yes/1 and false/no/0,
an `object` or `array` cell is JSON (`["bread","vegan"]`), and an empty cell is
left unwritten rather than written null. A `title` or `body` header goes into
the row's `doc`. An `id` (or `alias`) column is the row's name, `alias{name}`,
which lands on the entity already holding it, so loading the file again patches
the same rows instead of minting a second set, and the name works wherever an
eid does. Without that column, every load mints new rows. A header the component
has no property for is refused by name: rename it with
`map {"Serves how many": "serves"}`, or declare the property in `vocab.json`. A
cell that cannot be coerced is refused, naming the row and the header, and the
whole file is one batch, the same as a JSON load.

## HTTP endpoints

`client.js` is a wrapper over ordinary same-origin HTTP. Call these endpoints
directly from `curl`, from another page, or from your own `worker.js` through
`env.STORE`.

    POST ./api/apply
    content-type: application/json
    {"entities": [ {"entity": {"eid": "$r"}, "doc": {"title": "Lemon cake"}} ]}
    → {"ok": true, "aliases": {"$r": "4f3c…"}, "bundles": [...]}

    POST ./api/apply
    content-type: application/json
    [ {"entity": {"eid": "4f3c…"}, "doc": {"title": "Lemon cake"}} ]
    → [ {"entity": {"eid": "4f3c…"}, "doc": {"title": "Lemon cake"},
         "created": {"at": "…", "by": "…"}} ]

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
       "writes": false, "signIn": "https://yaks.app/login?return=…",
       "invited": false}

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
    → the bytes, with that mime and a revalidating cache header

`./api/vocab.json` returns the store's whole vocabulary, the platform's
components and the app's own, as the JSON Schema documents the store loaded. A
page that keeps a copy of its store in the browser (`@yaks/client`) loads them
with `loadVocab` before it opens, so its queries and writes match exactly what
the store accepts, `created.by` included. It writes a bare array of bundles, and
the response is the batch as the store applied it, including stamps. The live
socket (`./api/ws`) sends each row in that vocabulary, so `created.by` is the
person's eid there, with the names the store knows sent beside the rows;
`subscribe` puts the names in, the same way `query` returns them.

The blob endpoint accepts a 64-character lowercase hex address and nothing else;
anything else is `no_such_file`. Bytes come back with the mime type and the
filename from their `attachment` row, `nosniff`, and a sandbox CSP, so an
uploaded page or SVG stays inert when someone opens it in a tab.

**Bulk loading with NDJSON.** A file too big for one `apply` is sent to the same
endpoint as NDJSON (one bundle per line, blank lines skipped) and is applied 50
lines at a time, so neither the parse nor the transaction ever covers the whole
file:

    curl -X POST https://ada.yaks.app/cookbook/api/apply \
      -H 'content-type: application/x-ndjson' \
      -H "authorization: Bearer $TOKEN" \
      --data-binary @rows.ndjson

The response is NDJSON too, one saved row per line as each group of 50 commits,
and its status is 200 whatever happens, because the first rows are sent long
before a later line can be refused. So a refusal is sent as the last line
instead:
`{"error": "Refused", "message": "unknown property: recipe.serving", "line": 137,
"committed": 100}`.
It gives the line the bad bundle was on, and how many bundles were written
before it. Nothing after that line is read, and the group of 50 it was in is
rolled back whole. Note that an alias resolves only inside its own group of 50
lines, so write `$cake` and the row pointing at it close together.

From outside a page (a terminal, a script, an assistant's own sandbox) the
writer is whoever the token names. The `grant` tool mints one,
`grant(space: 'ada')`: it lasts an hour, reaches that one space, and writes as
the person with exactly their access, so the rows carry their name. Use it to
load a dataset from a machine into a store without typing it into a tool call,
and without opening the app to everyone while it loads. Revoke it when the load
is done: `grant(revoke: <id>)`, with the id its response named.

Each endpoint is governed by the app's `access`: its read rule for `query`,
`vocab.json`, `blob/<eid>` and the live socket (`ws`), its write rule for
`apply`, `blob` and an upload in parts (`blob/<sha>`,
[Files and Uploads](./files.md)), and `me` answers everyone. Every request under
`/api/` is handled by the platform, never by your worker, and a path it does not
serve answers 404 `not_found`. The endpoints that belong to other features are
documented on their own pages: `public` in [Files and Uploads](./files.md),
`env`, `fetch` and `connections/<integration>` in [Backend Code](./code.md),
`ai/run` in [AI Models](./models.md), `rtc/` in [Voice Calls](./voice.md),
`pay/checkout` in [Payments](./selling.md), `commands` and `command` in
[App Commands](./tools.md), `stats` in [Visitor Analytics](./stats.md), and
`report` in [Errors and Rollback](./errors.md). `PUT ./api/files/<path>` writes
one of the app's own files, as described under Read and write access above.

## Error responses

Every error response from the endpoints on this page is JSON in one shape, with
the two exceptions at the end of this section:

    {"error": {"code": "not_a_writer", "message": "sign in to change this app"}}

`code` is a fixed word a program can test, and `message` is a sentence for the
person. When signing in would allow the request, the object also holds `signIn`:
the platform's login address, with this page already set as its return address.

`client.js` throws each error response as an `Error`. `e.message` is the
response's `message`, whole and without the status in front of it. `e.status` is
the HTTP status, and `e.signIn` is set when the response held `signIn`:

    try { await apply(bundle) }
    catch (e) { e.signIn ? location = e.signIn : show(e.message) }

A refusal from the app's store (an unknown component, a property that does not
exist, a value of the wrong type, a bundle that does not parse, a `$was` guard
on a property that has changed) has the code `refused`. Its `message` is the
store's own sentence, and its status is the store's: 400 for a request the store
cannot apply, 403 for a write the app's rules forbid this person, 409 for a
`$was` guard that no longer matches, and 429 for a component written again
sooner than its `pace` allows. So for an unknown property or component,
`e.message` is:

    unknown property: doc.name — doc has title (string), body (string)
    unknown component: recipy — a component of your own is declared in vocab.json and planted by app_deploy: …

Both messages explain how to fix the request: a bad property names the
properties that do exist, and an undeclared component explains how to declare a
component.

The codes these endpoints answer, and their statuses:

- `refused`: the store's status, as above.
- `not_a_reader` and `not_a_writer`: 401 to a signed-out visitor, with `signIn`,
  and 403 to a signed-in person who may not read or change the app.
- `not_found`: 404, for a path under `./api/` that no endpoint serves, or an
  address where no app is.
- `method_not_allowed`: 405.
- `expected_websocket`: 426, for a request to `ws` that is not a WebSocket
  upgrade.
- `space_full`: 413.
- `no_bytes` (400), `too_large` (413), `unsupported_media_type` (415) and
  `upload_gone` (409), from an upload.
- `no_such_file`: 404.
- `blob_unavailable`: 503, when the app's store fails while `blob/<eid>` is
  read.

[Errors and Rollback](./errors.md) says what each code means.

Two answers are not JSON. A space that has used its monthly request units
answers anyone who is not one of its signed-in people with a plain-text 429, and
a failure of yaks.app itself answers the platform's HTML error page with a 500.
For a body that is not a JSON error, `client.js` throws the status followed by
the first 120 characters of the body's text, with any HTML tags removed. A write
that gets either answer stays `pending` in the outbox, which sends it again.

A bulk load sent as NDJSON is the one write answered otherwise: once it reaches
the store its status is 200, and the store's refusal is its last line, as
described under Bulk loading with NDJSON above.

Errors are reported without any setup. The platform puts an error reporter in
every page it serves, so a throw, an unhandled rejection, or a failed request is
already sent to the app's store and the person's agent. Catch only the errors
you want to show.

## Common mistakes

**Asking for the wrong components.** A row carries only the components its
filter named. `query('.recipe')` returns recipes with no titles, and a page
drawing `row.doc.title` prints `undefined` for every one of them. Ask for the
title beside it: `query('.recipe&?doc')`. `&?doc` is how to ask for a _second_
component; `.recipe.doc` addresses a _property_ of `recipe` named `doc`, which
`recipe` does not have. `subscribe` returns the same components a query does, so
the same mistake applies there.

**Using localStorage.** State a page keeps in the browser is invisible to the
person's other devices, to anyone else looking at the same page, and to the
person's agent, and it is lost when they clear their browser data. It is not a
lightweight version of the store; it is storage nobody else can read. Save a row
instead. (In an installed app its space's owner sandboxed, `localStorage` is the
platform's: each signed-in person's keys are kept in the app's store rather than
the browser: <https://yaks.app/docs/sharing.md>.)

**Writing the app's own name into the app.** `/chores/api/client.js`,
`/chores/style.css`, `fetch('/chores/api/query?…')`: each one breaks when
somebody installs a copy at another address. Write `./api/client.js` and
`./style.css`. The only address that should name another app is a sibling store
you intend to read: `store('/lending/api/')`. A sandboxed copy reads a sibling
only as a stranger would.

**Saving a second row for the same file.** Because blobs are content-addressed,
the same bytes are one blob and one `attachment` row, but a row of your _own_
pointing at them is still a second row, and a photo wall shows the photo twice.
Query for an existing row first:

    let [seen] = await query(`.photo.blob=${file.eid}`)
    if (!seen) await apply({ photo: { caption, blob: file.eid } })

**Checking access only after a refusal.** By then the guest has typed their
input and lost it. Call `me()` on every page load.

---

The whole guide is at <https://yaks.app/docs.md>; the filter syntax has its own
page, Query Syntax, at <https://yaks.app/docs/querying.md>.
