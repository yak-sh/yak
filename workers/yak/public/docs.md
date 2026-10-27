# Building a yaks app

The platform is yaks.app, written the way its address is: lowercase, with the
`.app`. An app built on yaks.app is a yaks app.

A yaks app is an `index.html` and whatever files sit beside it, served live at
`<space>.yaks.app/<app>/`. No build step is needed: what you write is what the
browser gets, except TypeScript and npm imports, which `app_deploy` compiles.
Every other HTML file is a page at its own address, and a site any tool builds
serves as built from a folder of the app
([code](https://yaks.app/docs/code.md)). Every app comes with its own store, a
graph of entities, and a small client for reading and writing it from the page.
Apps in the same space can work with one entity across those stores.

Make one with `app_new`, write files with `app_files` (the whole set in one
call, as `files: [{path, content}, ...]`), then `app_deploy`, and give the
person the URL.

The person can also make or update one without you: the drop zone on their
space's own page accepts a `.zip` of an app's files, or a single `index.html`.

This page is the map. Each section says what a subject is and names the page
that covers it; the pages are the reference. Add `.md` to any page's address for
the markdown an assistant reads.

## Frontend Data

Every app is served a client at `./api/client.js` for reading and writing the
app's own store: `apply` saves, `query` lists, `search` searches, `subscribe` is
a query that keeps calling back as rows change, `upload` saves bytes, and `me`
reports who is looking. It exports more for particular jobs: `was` and `outbox`
for writes, `digest` for a file's SHA-256, `drafts` and `draftEid` for typed
input, `publish`, `unpublish` and `publicFiles` for public files, and
`store(base)` for another app's store. Write every address in the app as a
relative path from the page's own folder: the platform gives each page a
`<base href>` at its folder under the app's address, so the same files work
wherever the app is served or installed. A page in a folder reaches the client
at `../api/client.js`.

    import { apply, me, query, search, subscribe, upload }
      from './api/client.js'

    await apply({ entity: { eid: '$cake' },
                  doc: { title: 'Lemon cake', body: '3 lemons...' } })
    let recipes = await query('.doc')

An entity is a bundle, `{entity: {eid}, ...components}`; a `$alias` in place of
the eid creates one. Who may read and write is the app's `access`: `public`,
`open` or `private`. Ask `me()` on load and shape the page before anyone types.

Deeper: <https://yaks.app/docs/store.md> — every function of the client, the
HTTP endpoints underneath, and who may read and write.

## Performance

A page's load time is set by its network round trips, and a read that waits for
another read's answer adds a round trip. So a page subscribes to what it draws,
every kind in one line, and calls `me()` at the same time rather than first:

    subscribe('(.recipe|.chore)&?doc', draw)   // its first rows over HTTP
    let who = await me()                       // beside them, not ahead

That loads in one round trip. `subscribe(...).ready` resolves with the first
rows, for a page that needs them before it continues, so a page never queries a
filter and then subscribes to the same filter.

Deeper: <https://yaks.app/docs/speed.md> — why that is one round trip, how to
see a slow page's round trips and the `Server-Timing` header on every response,
and what else slows a page: chains of module imports, images, and work done on
every change.

## Files and Uploads

`app_deploy` releases the app's draft. Open pages get a `yak-release` event with
`{version, reload}` and an optional or required Reload notice, never an
automatic reload. An app can take over the notice without losing input. Use
`reload: 'required'` on `app_deploy` for a changed contract the vocabulary
cannot describe; otherwise the platform derives the level.

An `icon.svg` beside `index.html`, square and without `<text>`, is drawn as the
app's icon on a home screen. `upload` takes a file and returns where its bytes
live, addressed by their own SHA-256, and a row that points at them is what a
gallery draws. An upload is held to the space's room and the app's `blob` word,
so downscale a photo on the page to keep it quick to send.

Deeper: <https://yaks.app/docs/files.md> — releases, `yak-release`,
`app_deploy`'s `reload`, the app's icon, uploads, pictures, and a gallery that
never shows one twice.

## Components and vocab.json

A component is a named set of properties an entity carries. The platform's own,
`doc`, `task`, `completed`, `comment`, `person`, `attachment`, `image` and the
rest, are shared by every app. An app declares components of its own in a
`vocab.json` at its root, and `app_deploy` installs them in that app's store:

    { "$defs": { "recipe": { "properties": {
        "serves":  { "type": "number" },
        "minutes": { "type": "number" } } } } }

A later deploy may add a property; one that already has rows is never dropped or
retyped. A new capability is a new component, not a new tool.

Deeper: <https://yaks.app/docs/components.md> — every component with its
properties, and vocab.json for declaring an app's own components.

Deeper: <https://yaks.app/docs/storage.md> — `sync`, `durable`, `pace` and
`save`: what players see, what stays in a browser, and what the store keeps.

## Multiplayer Games

A game's page reads the graph, computes rules and writes bundles. `@yaks/game`
provides rules, controls and HUD parts; `@yaks/stage` draws ordinary geometry
and sound, and `@yaks/voxel/three` supplies a voxel look. One elected page
advances shared creatures; the others draw their relayed values.

Deeper: <https://yaks.app/docs/games.md> — Holdfast's working multiplayer
pattern, toolkit dependencies, shared time, owner handoff and dropped orders.

## Scheduling

An app has no cron job and no process that keeps running. Any row can carry a
`wake` component with a time and a recurrence; at that time the store wakes and
writes `fired` on the row. What a firing does is a rule declared in
`vocab.json`, and an app's own commands can be scheduled the same way.

Deeper: <https://yaks.app/docs/wakes.md> — every property, recurrence and time
zones, pausing and resuming, what a rule may match, scheduling a command, and
why there is no cron trigger to configure.

## Cross-App Data

An eid means the same entity everywhere. Apps in one space can each add their
own component to it, or one app can use a component another app declares. Each
component has one home, so a page or command reads and writes it there without
copying rows between apps. Each app's access still decides who can read or write
its part. `graph_query` with no app named reads every app the person can reach.

Deeper: <https://yaks.app/docs/entities.md> — which app a component lives in,
and a two-app pair end to end.

## App Commands

An app can declare commands, so the person's agent can act on it without a page
open: a `$defs` entry of `vocab.json` marked `"tool": true`, the way a yaks
package declares its tools, with a description, an argument schema, and one
action, an `apply` template or a `query`. They are listed by `commands` and run
by `command`; they never join the connector's own tool list, which is fixed and
the same for everyone.

    "log_run": {
      "tool": true,
      "description": "Log a run for the club leaderboard",
      "input": { "who":   { "type": "string" },
                 "miles": { "type": "number" } },
      "required": ["who", "miles"],
      "apply": { "entity": { "eid": "$run" },
                 "jog": { "who": "$who", "miles": "$miles" } } }

Deeper: <https://yaks.app/docs/tools.md> — the whole reference for a command,
and the view protocol.

## AI Models

An app asks a model with rows, not a key: a page writes an `entry` in a
transcript (any entity wearing `session`) with `using{model}` and
`sending{instructions}`, the app's own store asks the model, and the reply lands
in the same transcript for any page subscribed to see. `questions` beside the
entry are answered by the `typesafe/jev` model as `answer` rows (a choice, a
yes-or-no, a score), and a command marked `"model": true` is one the model may
call. One call answered at once is a post to `./api/ai/run`, or `env.AI.run` in
a worker, and a question about a picture is one of those, the picture inside it.
Every call spends the owner's monthly account budget, weighed in dollars by the
model's price.

Deeper: <https://yaks.app/docs/models.md> — the rows that ask and the rows that
come back, typed questions, one call at once, asking about a picture, who may
ask, and the models and their prices.

## Voice Calls

People using an app can talk to each other by voice: a page joins a call through
the app's own `./api/rtc/` door with `@yaks/rtc`, publishes the microphone, and
hears the voices it asks for. Who is speaking is the relayed `rtc` component on
the entity they speak as. Every voice received spends the same monthly budget
models do.

Deeper: <https://yaks.app/docs/voice.md> — speaking, hearing, placing a voice in
space, who may speak, and what it costs.

## App Notes (NOTES.md)

A rule the person wants followed every time goes in a `NOTES.md` beside
`index.html`: weights in grams, one photo per recipe. Any agent that can reach
the app is given it, so the rule is stated once and followed from then on.

Deeper: <https://yaks.app/docs/notes.md> — what belongs in the file, its size
limit, and the three places it is handed over.

## Memories

A memory keeps the person's own words for the whole space: `store_memory_save`
stores a sentence verbatim with a line of context, and `store_memory_recall`
finds it by what it is about. Save their words as soon as they say how they want
something built or handled.

Deeper: <https://yaks.app/docs/memory.md> — the shape of a memory, what context
is for, and how a recall is ranked.

## Backend Code

An app's backend code is a `worker.js` beside `index.html`. Every request that
is not `/api/...` reaches it first, and any request it answers with a 404 falls
through to the app's files. `env.STORE` is the app's own store as the person
looking, and a key the person connected (`store_connection_need`) arrives as
`env.NAME`. Using a key does not need a worker: a page calls a connected service
through `./api/fetch`, which adds the key to the outgoing request.

A worker and a page's scripts may be TypeScript and may import npm packages:
name the packages in a `package.json`, and `app_deploy` compiles them, pinning
the versions it installed in `package-lock.json`.

Deeper: <https://yaks.app/docs/code.md> — env, routes, keys, limits, whole
workers to copy, and TypeScript and npm packages.

## Front Page and Routing

The space's front page, set with `app_set(app, home: true)`, is served at the
bare address and is the space's router as well as its homepage: it sees every
path no other app claims, and can ask for paths other apps own. A router that
breaks fails open, so it never takes the space down.

Deeper: <https://yaks.app/docs/home.md> — the five steps a request goes through,
the `first` globs, why a broken router fails open, and where the space's mail
lands.

## Web Clipping

An app can save a page from another website: a worker route fetches the URL and
reads the page's metadata, and a bookmarklet opens that route with the URL of
the page the person is on.

Deeper: <https://yaks.app/docs/clipping.md> — the whole clipper, the
bookmarklet, and what to do when a site refuses.

## Access, Publishing and Installing

Who may read and write an app is its `access` and its guest list; `member_add`
invites someone by email. A deployed app can be published under a name the whole
platform shares, and anyone can install a copy into their own space. A copy
shares nothing but the code, and stays on the version it was installed from
until its owner updates it.

Deeper: <https://yaks.app/docs/sharing.md> — access, members, publishing,
installing, pinning.

## Email

Every app has a mailbox at `<space>.<app>@yaks.app`. Mail in both directions is
rows in the store: sending is one `apply` with the recipient, the letter and a
`deliver` request, and a letter that arrives is stored as an entity the page can
subscribe to.

Deeper: <https://yaks.app/docs/mail.md> — the bundle that sends a letter, what
comes back, how an arriving letter is stored, and the limits.

## Payments

A seller on Plus connects a Stripe account to their space once, and after that
any app in the space posts a cart to `./api/pay/checkout` and sends the buyer to
the page it returns. A card number never reaches the app, and a paid order is
written into the app's store as an `order` row.

Deeper: <https://yaks.app/docs/selling.md> — connecting the account, the whole
shape of the checkout endpoint, what an order contains, and who can read one.

## Custom Domains

A space, or one app of it, can also answer at a domain the person already owns,
with the `.yaks.app` address still working. `domain_attach` gives the CNAME
pointing at `origin.saas.yaks.app` and the ownership TXT record to add. The
domain serves only after ownership is verified and Cloudflare is ready;
`domain_status` says what is still needed. Custom domains need Plus.

Deeper: <https://yaks.app/docs/domains.md> — the records to add and where to
type it at each registrar, the apex, moving DNS to Cloudflare, and what each
pending state means.

## Query Syntax

Every read uses one query syntax: `.doc` selects rows that have a component,
`?doc` asks for one beside the rows selected, `.recipe.minutes<=30` filters a
property, `&` joins, `.entity.eid=<eid>` fetches one entity whole, `.limit=`
windows the answer, and a bare word is a full-text search. A row comes back with
the components the filter names, so ask for what you will draw.

Deeper: <https://yaks.app/docs/querying.md> — every operator, with worked
examples.

## Errors and Rollback

A refusal returns a code for you and a message for the person, and `client.js`
throws the message. Every page the platform serves reports its own errors, so a
break is kept for the app and the person's agent hears about it once;
`app_errors` lists what is still open, and `app_list` says how many. Every
destructive action can be undone: the 30-day trash, `store_restore`, file
history, and `app_rollback`.

Deeper: <https://yaks.app/docs/errors.md> — every refusal, app_errors, and
rolling back.

## Visitor Analytics

Every HTML page the platform answers for an app is counted, and nothing that
could identify a visitor is kept. `app_stats` returns the visits per day, the
pages opened, the sites that linked there and the countries.

Deeper: <https://yaks.app/docs/stats.md> — what a page view records, what it
never does, and the three places to read it.

## Platform Feedback

Feedback about yaks.app itself, from you or the person (a tool that refused for
no reason you could find, a page of this documentation that taught the wrong
thing, a feature request), goes to `feedback(text, app?)`, and it reaches the
people who run yaks.app as mail they can answer. An error inside the person's
own app is not this; that is in `app_errors`, and fixing it is yours.
