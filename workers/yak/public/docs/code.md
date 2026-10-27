---
doc:
  title: Backend Code
guide:
  slug: code
  brief: backend code in worker.js, env bindings, API keys; TypeScript, npm
  description: >-
    Backend code for an app: worker.js, the server module that answers an
    app's requests before its static files. Which routes it receives (a 404
    falls through to the files, /api/ is reserved), what env holds (STORE, APP,
    FILES, the keys the person connected, and wrangler.jsonc bindings such as
    D1, R2, Vectorize, vpc_services and ai), API keys through sentinels and
    ./api/fetch, the request headers that identify the visitor (x-yak-person,
    x-yak-role, x-yak-app), the CPU and subrequest limits, error handling, and
    complete example workers (webhook, paid API, RSVP). TypeScript and npm
    packages in a worker or a page's scripts: package.json, the
    package-lock.json app_deploy pins them in, and what the compile refuses.
    The platform's @yaks packages, named "platform", whose components the
    app's store also keeps. The build sandbox, and deploying a site built with
    Vite, Astro, Eleventy or SvelteKit.
---

# Backend Code

An app serves only its files until it has a `worker.js`, the app's backend code.
This page covers that file: which requests reach it, what `env` holds, the
request headers that identify the visitor, the limits it runs under, and three
complete example workers. It also covers TypeScript and npm packages, for a
worker and for the scripts a page loads.

## When an app needs a worker

Most apps do not need a worker. A page reads and writes the app's own graph
through `./api/client.js`, and that client already knows who the visitor is and
already enforces the app's `access`. A worker adds nothing there.

An API key does not need a worker either. A page calls an outside service with a
key the person connected through `./api/fetch`, which inserts the key into the
outgoing request, so the page never holds it (API keys and connections, below).

Write a worker when the app has to do something a page cannot be trusted with,
or cannot do at all:

- **A key that must be transformed before it is sent.** A request signature or
  AWS SigV4 is computed from the key itself, so the code that signs needs the
  key (`direct: true`), and only a worker can be given one.
- **Requests from other machines.** A webhook, a form post from another site, a
  cron job on another service: none of them runs your page, so none of them can
  use the client.
- **A response that is not the app's data.** A route that calls another service
  and returns a small result to the page, so the page does not have to speak a
  third party's protocol.
- **Responses a page cannot produce.** A CSV export of the store, a redirect, a
  `content-type` a page cannot set.

A worker is not needed for routing: a path under the app that names no file and
has no extension already serves `index.html`, so a page can read
`location.pathname` and render that route without a server. It is not needed for
templating either: the store is live, and `subscribe` redraws the page when the
data changes.

## The `worker.js` module

`worker.js` sits beside `index.html`, among the app's files. It is a plain ES
module with a default export, and it runs as written:

    export default {
      async fetch(req, env, ctx) {
        return new Response('hello')
      },
    }

`req` is the visitor's request, `env` holds the bindings for the app's store and
files and every key the person has connected, and `ctx` is the runtime's context
object. A worker in plain JavaScript is uploaded unchanged at `app_deploy` and
runs unchanged. One written in TypeScript (`worker.ts`), or one that imports an
npm package, is compiled at `app_deploy` first; see
[TypeScript and npm packages](#typescript-and-npm-packages).

To use a different server output, put `wrangler.jsonc` (or `wrangler.json`) at
the app root with `{"main":"dist/server.mjs"}`. `main` is the app-relative
server source path, defaulting to `worker.js`, or `worker.ts` when the app has
no `worker.js`; directories and a leading `./` are allowed. Deploy follows that
source's relative imports. The platform's upload wrapper uses an internal script
name the app never configures. The server source is not served publicly.

### Multiple modules and WebAssembly

`worker.js` may import the files beside it, and the deploy uploads every module
it imports and every module those import. Nothing else is uploaded with it: the
app's page scripts are still served as page scripts.

This is also how a worker compiled from another language runs on yaks.app. An
imported `.wasm` file is a compiled `WebAssembly.Module`; instantiate it once at
the top level, not per request:

    import wasm from './add.wasm'

    let { exports } = new WebAssembly.Instance(wasm, {})

    export default {
      fetch: () => new Response(String(exports.add(2, 3))),
    }

A `.wasm` file is binary, not text, so write it with `base64` instead of
`content`:

    app_files(app, files: [{path: 'add.wasm', base64: '<the bytes>'}])

## TypeScript and npm packages

A worker, and the scripts a page loads, may be written in TypeScript and may
import npm packages. List each package in a `package.json` beside `index.html`,
as npm does:

    {"dependencies": {"three": "^0.180.0", "hono": "^4"}}

`app_deploy` compiles the files that need it, with esbuild:

- The worker, when it is `worker.ts` or imports a package: compiled into one
  module and uploaded in place of its source. A `.wasm` or `.txt` it imports is
  uploaded beside it, as above.
- Each `<script type="module" src="…">` a page loads, when it is TypeScript or
  imports a package `package.json` names: compiled into one script, served as
  JavaScript at the script's own address. `<script type="module" src="main.ts">`
  works as written, and `app_files` still reads back the source you wrote.

A page script that is compiled:

    import * as THREE from 'three'
    import { subscribe } from './api/client.js'

    let scene: THREE.Scene = new THREE.Scene()

The first deploy writes `package-lock.json` beside `package.json`, with the
version of every package it installed. Every later deploy installs exactly
those, so a redeploy or a rollback builds the same code; change a range in
`package.json` and the next deploy updates the lock to match. One version of
each package is installed; there is no nested dependency tree.

A failed compile refuses the deploy with the compiler's error lines
(`main.ts:3:9: Expected ";" but found "number"`) and changes nothing: the last
release keeps serving. The seconds a compile takes count against the space's
build time, together with the sandbox's.

- Types are stripped, not checked.
- Import a file by its own extension or by none: `./util.ts` or `./util`. An
  import of `./util.js` that means `util.ts` is refused with an error saying so.
- A compiled script is updated only at `app_deploy`; until then its address
  serves the last compiled version.
- A package a page imports that `package.json` does not name is left for the
  browser to load, through the page's import map; the deploy reports it when the
  import map does not name it either.
- CSS a script imports is dropped: link it from the page.
- `./api/client.js` is not bundled. The browser imports it relative to the
  compiled script's own address, so import it from a file beside the page's
  script.
- JSX compiles to `React.createElement` calls; `/** @jsx h */` at the top of a
  file names another function.

## The platform's `@yaks/` packages

The `@yaks/` packages yaks.app is built from are also listed in `package.json`,
with `"platform"` in place of a version:

    {"dependencies": {"@yaks/client": "platform", "@yaks/canvas": "platform"}}

A `"platform"` dependency is never fetched from npm. The compile gives the page
the copy that the current release of yaks.app runs, so the page and the store it
talks to always use the same version.

The package's components are added to the app's store as well. From the deploy
that names a `"platform"` dependency, the store keeps and relays every component
the dependency declares, the same as the app's own components: a page saves
`@yaks/canvas`'s `card` without `vocab.json` declaring `card` again. A component
the package keeps only on the page (`"sync": "none"`) stays on the page, a
package that declares no components adds none, and a component every app's store
already has is unchanged.

- If `vocab.json` declares a component that a `"platform"` dependency also
  declares, the deploy is refused with an error naming the component and both
  declarations: rename yours, or remove the dependency. The deploy is also
  refused when two dependencies declare the same component.
- When a deploy or a rollback no longer names a dependency, its components are
  kept while any data is stored in them, so saved data stays readable. If its
  components hold no data, they are removed with the dependency.

For a working game that uses these dependencies, including page-only controls,
shared Three.js and the components its store keeps, see Multiplayer Games:
<https://yaks.app/docs/games.md>.

## Fall-through to the app's files on 404

Every request for the app that is not under `/api/`, and not for a file the app
published ([Files and Uploads](./files.md), "Public files: `publish`"), reaches
the worker first, and **any request it answers with a 404 falls through to the
app's files.**

    return new Response('not found', { status: 404 })   // → the files

So a worker handles the routes it names and nothing else. The worker does not
serve the app's `index.html`, stylesheets or images: answer 404 for any request
the worker does not handle and the platform serves the file, with the app's
`<base href>` written in, the error reporter injected, and the pretty-path
fallback still working.

The platform treats every 404 from the worker as a fall-through, including one
the worker meant as a response. If a route must report "no such recipe", use a
status that means that, because a 404 sends the caller to `index.html` instead.
Use 400, or answer 200 with a body that explains, or serve your own not-found
page.

## Request paths and the reserved `/api/` routes

The request keeps its full address, so `url.pathname` includes the app's own
slug: a visit to `<space>.yaks.app/recipes/mine` reaches the worker as
`/recipes/mine`.

This has two consequences:

- Match the **end** of the path, not the whole path. An installed copy of your
  app lives at whatever address the installer chose, so a worker that tests
  `pathname == '/recipes/mine'` does not match in any copy. Test
  `pathname.endsWith('/mine')`, or read the app's own slug from the `x-yak-app`
  header the platform sets.
- `/api/*` is reserved for the platform. Its paths are the platform's endpoints,
  and the platform answers a request for one without calling the worker. The
  worker's routes go outside `/api/`. Each endpoint, with the page that covers
  it:
  - `client.js`, `storage.js`: the store client a page imports
    ([Frontend Data](store.md)), and the `localStorage` replacement injected
    into a sandboxed page.
  - `apply`, `query`, `ws`: write bundles, read rows, and subscribe to a query
    ([Frontend Data](store.md)). `graph`, `vocab` and `vocab.json` give a page
    its local graph and the components it uses.
  - `me`: who is looking, their role, and where to sign in
    ([Frontend Data](store.md)).
  - `commands`, `command`: list the app's declared commands and call one
    ([App Commands](tools.md)).
  - `blob`, `blob/<id>`, `files/<path>`: keep and read an uploaded file, and a
    member's write of one of the app's own files ([Files and Uploads](files.md),
    [Access, Publishing and Installing](sharing.md)).
  - `env`, `fetch`, `connections/<integration>`: a page's sentinels, the
    outgoing call that replaces a sentinel with its key, and the page where a
    person connects their own account (API keys and connections, below).
  - `ai/run`: one call to a model, answered in the response
    ([AI Models](models.md)). `ai/recover` takes `{call}` and asks the store to
    recover that model call. `choose` takes `{output}` and picks a retained
    build output, as `store_builder_choose` does.
  - `rtc/*`: voice calls between the people in the app
    ([Voice Calls](voice.md)).
  - `stats`: page-view counts, for the app's members
    ([Visitor Analytics](stats.md)).
  - `pay/checkout`: a cart posted to take a payment ([Payments](selling.md)).
  - `storage`: a signed-in person's saved `localStorage` keys for a sandboxed
    app.
  - `release`: whether a given release (`?version=`) is live.
  - `report`: where a page reports an error ([Errors and Rollback](errors.md)).

These files are never served to the web, whether or not the app has a worker:
`worker.js`, `vocab.json`, `wrangler.jsonc` and `wrangler.json`. They are the
app's private source and configuration. `GET /<app>/worker.js` serves the
platform's 404 page (the check uses the decoded path, so `/%77orker.js` is the
same file and gets the same 404), and a member reads these files back through
`app_files` read. Nothing you write in `worker.js` is visible to a visitor.

## env.STORE: the app's graph, with the visitor's permissions

    let r = await env.STORE.fetch('/query?.recipe&?doc')
    let rows = await r.json()

`env.STORE.fetch(path, init)` calls the same HTTP endpoints that `client.js`
wraps, under the app's own `/api/`. Two things to know about it:

- **It takes a path, not a URL.** `'/query?...'` is the app's query endpoint,
  not one at the root of the hostname. A leading slash is optional and is
  stripped, so `'query?...'` is the same call. The query string is passed
  through.
- **It acts as the visitor.** The platform mints a grant naming this store, this
  visitor and their role, valid for one minute, and the binding adds it to every
  call the worker makes through `STORE` and `FILES`. So the app's `access`
  decides what your worker can do exactly as it decides what the visitor's page
  can do. Going past `access` takes `env.APP` (the next section), a deliberate
  exception with its own rules; `env.STORE` never does it. A grant minted for
  one app's store is refused by any other, and app code never sees the grant
  itself: the binding strips that header before your module is called.

It returns a `Response`, not parsed rows, so check the status yourself:

    let r = await env.STORE.fetch('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entities: [{ doc: { title: 'Lemon cake' } }] }),
    })
    if (!r.ok) return new Response(await r.text(), { status: r.status })

A refusal has the same form a page receives,
`{"error": {"code": "not_a_writer", "message": "sign in to change this app"}}`
with a 401 or 403, so passing it straight through gives the page an error it
already knows how to show.

The full query syntax works in a worker, because these are the same endpoints:
`.doc`, `.recipe.minutes<=30`, `id=<eid>`, `limit=`, `.count`, a bare word for
full text. Request only the components you will use.

## env.APP: the app's graph, with the app's own permissions

    let r = await env.APP.fetch('/query?.household.code=' + hash)

`env.APP.fetch(path, init)` calls the same endpoints at the same paths as
`env.STORE`, with one difference: it acts as the app itself, with the `editor`
role, on the app's own store. It reads and writes the store whatever the app's
`access` is, `private` included, and a write through it is signed by the app, so
`created.by` is the app's own entity and not a guest.

It exists for one kind of app: **one where the worker enforces the
permissions.** `access` is one setting for the whole store, so it cannot express
"each household edits its own row and nobody else's". That rule has to be code,
and the code needs access to the store that `access` does not already refuse.
`env.APP` provides that access.

**A private app's worker still runs.** `private` sends a stranger to the sign-in
page, but only after your worker has received the request, and not for the calls
your worker makes through `env.FILES`. So a guest holding an invitation card
reaches your route, and your route can return a page to them. The rest of
`private` still applies: they cannot call the store endpoints, and they cannot
request a file directly.

Everything said above of `env.STORE` applies to `env.APP` too. It takes a path,
not a URL. The grant naming your store is refused by every other store. Your
code never sees the grant: the platform mints it per request and the binding
keeps it in a closure, so no header a caller sends can become one.

Two limits:

- **It is not the owner.** An editor writes the app's data and never its list of
  members. A batch (everything written in one `apply` call) that touches
  `member`, `grant` or `access` is refused through this binding as through any
  other, so a worker cannot promote anyone, itself included.
- **It is not for the whole worker.** Use `env.STORE` for everything the visitor
  is allowed to do, and `env.APP` only on the code path where your own check has
  passed. A worker that uses `env.APP` everywhere makes the app as good as
  `open`, with more code.

### Example: an RSVP site with invitation codes

The example is a wedding site. Every household has an invitation code, and may
see and change its own reply and nothing else. Set the app to `private`, so the
store answers a stranger with nothing at all, and let the worker handle the
guests' requests: it still runs, and it can still read the app's pages with
`env.FILES` to return one.

Store a **hash** of the code, never the code itself. The codes are printed on
cards sent by post, while the graph is something you will export, back up and
show on a screen, and a leaked code gives access to that household's row.

    // Seeding, once, as the owner: a household per card.
    { entity: { eid: '$h' },
      doc: { title: 'The Okonkwos' },
      household: { code: '<sha-256 of the code>', seats: 2 } }

The route accepts the code, hashes it, finds the one row that matches, and
writes only that row:

    let hashed = async (code) => {
      let bytes = new TextEncoder().encode(code.trim().toUpperCase())
      let sum = await crypto.subtle.digest('SHA-256', bytes)
      return [...new Uint8Array(sum)]
        .map((b) => b.toString(16).padStart(2, '0')).join('')
    }

    export default {
      async fetch(req, env) {
        let url = new URL(req.url)
        if (!url.pathname.endsWith('/rsvp')) {
          return new Response('not found', { status: 404 })
        }
        let sent = await req.json()
        let code = String(sent.code ?? '')
        // The check comes first. Nothing below it may run without it.
        if (!code) return new Response('no code', { status: 403 })
        let r = await env.APP.fetch(
          '/query?.household.code=' + await hashed(code) + '&?doc&limit=1',
        )
        let [found] = await r.json()
        // A wrong code and a missing household get the same response: 403,
        // with nothing saying which it was.
        if (!found) return new Response('no invitation by that code', {
          status: 403,
        })
        // The eid comes from the row the code found, never from the body.
        let w = await env.APP.fetch('/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entities: [{
              entity: { eid: found.entity.eid },
              household: { coming: Number(sent.coming ?? 0) },
            }],
          }),
        })
        if (!w.ok) return new Response(await w.text(), { status: w.status })
        return Response.json({ ok: true, title: found.doc?.title })
      },
    }

**This is the one place where your own check is the only permission check.**
Everywhere else the store checks too: if your check misses a case, the store
still refuses. Through `env.APP` the store does not check. So:

- **The check comes first**, before the first `env.APP` call on that path, with
  nothing between the two.
- **The refusal is 403**, and it reveals nothing else: not 404, not "no such
  household", and not a different message for a wrong code than for a missing
  one. Any difference lets someone work out the guest list.
- **The eid comes from the row the check found**, never from the request body.
  Writing an eid taken from the caller lets the caller choose which row to
  change, which undoes the check.
- **Nothing else on that path uses `env.APP`.** Listing every household to find
  one makes the private app's data public; query for the one row, not the whole
  table.

Rate-limit guesses if the code is short (a four-character code is ten thousand
tries), or make the code long enough that guessing it is not practical.

## env.FILES: the app's own files

    let page = await env.FILES.fetch('/index.html')
    let html = await page.text()

It returns the same files the web gets, under the app's root, served the same
way. Use it to read a template, or to return a page yourself with your own
headers. Because the files are served the same way:

- An HTML page comes back **already transformed**: the `<base href>` is in it
  and the error reporter script is injected. You are reading what a visitor
  would have received, not the bytes in storage.
- `worker.js` and `vocab.json` answer 404 to the worker too: it cannot read its
  own manifest this way.
- A path with no extension that names no file gets `index.html`, the same
  pretty-path fallback the browser gets.

A request from your worker never re-enters your worker, so
`env.FILES.fetch('/index.html')` is not a loop.

## Other env bindings and wrangler.jsonc

Every connection the app uses is on `env` under its binding name: `env.WEATHER`,
`env.OPENAI` (below). The service binding the platform uses to build `STORE`,
`APP` and `FILES` is also there, as `env.KERNEL`. It is internal: it requires
absolute URLs and a grant header your code is never given, and the three
bindings above are built on it so you do not have to use it. Use those.

An app may carry `wrangler.jsonc` or `wrangler.json` beside `worker.js`. The
supported keys are `main` (the app-relative server source path, `worker.js` by
default; directories such as `dist/server.js` are allowed, and the upload
wrapper is internal), `compatibility_date`, `compatibility_flags`, `vars`,
`d1_databases`, `r2_buckets`, `durable_objects.bindings` with local
`class_name`, `migrations`, `vectorize`, `vpc_services` and `ai` (both below).
D1 databases, R2 buckets and Vectorize indexes belong to that app; yaks.app
creates them at deploy and reuses them. A new Vectorize index also names its
`dimensions` and `metric`, or a `preset`. `app_deploy` reports unsupported
settings and names the bindings, and so does `app_list(app)`. Removing a binding
keeps its resource and data until the app is permanently deleted, including
during the app's 30 days in the trash. A declared binding keeps its name,
including `STORE`, `FILES` or `APP`; otherwise those names are the bindings
described above.

`vpc_services` connects the worker to a machine the space's owner runs, such as
a server on their computer, without opening a port on it. The owner first gives
the space a tunnel to the machine and opens the paths apps may reach; then
`"vpc_services": [{ "binding": "BOX" }]` gives the worker `env.BOX`, and
`env.BOX.fetch('http://localhost/mail/inbound', init)` is a request to that path
on the machine, made as the app. Only the path and query are forwarded, and a
path the owner has not opened is answered 403. Any `service_id` in the config is
ignored: the machine is always the space's. A space with no tunnel, and an app
installed from another space, are refused it.

`ai` gives the worker the AI models the space may spend on:
`"ai": { "binding": "AI" }` gives the worker `env.AI`, and
`await env.AI.run(model, input)` calls a model and returns its output, as
Workers AI's own binding does. It is the app calling `./api/ai/run` as itself,
so every call is charged at the model's price to the owner's monthly account
budget; once the budget is spent, `run` throws an error saying so. Only the
models in the catalogue are available (see [AI Models](/docs/models)), and it
never uses the account's own Workers AI.

### Payments without a Stripe key

A worker that charges someone does **not** hold a Stripe key. Payments are a
platform endpoint, `POST ./api/pay/checkout`, which your worker calls through
`env.STORE` exactly as a page calls it, and the charge goes to the seller's own
connected account. You post a cart of product eids and quantities; the price is
read from each `product` row in the app's own store, so the request never
contains an amount of money and there is no key for your worker to leak.
Payments, <https://yaks.app/docs/selling.md>, covers the rest.

## Request headers that identify the visitor

The platform sets three headers on the request it passes to the worker, and
removes any headers with the same names that the client sent:

- `x-yak-person` — the visitor's eid. **Absent** when nobody is signed in.
- `x-yak-role` — `owner`, `editor` or `viewer`. Absent when they have no role in
  the space, which includes every signed-out visitor and every signed-in
  stranger.
- `x-yak-app` — the app's own slug, so a worker can build its own addresses
  without hard-coding its name.

Read them like any other header:

    let person = req.headers.get('x-yak-person')   // null for a guest
    let role = req.headers.get('x-yak-role')

What they guarantee: the platform set them, the request came through the
platform, and no client can forge them, because a client's own `x-yak-person` is
deleted before your code runs.

What they do not guarantee:

- **Permission.** The role is the visitor's membership in the space. What this
  visitor may do with this app's data also depends on the app's `access`, and
  `env.STORE` already applies it. Do not write your own check and assume it
  matches; let the store refuse and pass the refusal on.
- **An identity you can email.** An eid is not an email address and not a name.
  No email address ever reaches app code.
- **A session.** The platform's session cookie is removed from the request: the
  app is given this visit, not a credential for every space the person belongs
  to. Other cookies are kept, so a cookie your own page set is still there.

## API keys and connections

    store_connection_need(app, owner: space, integration: 'ESV',
      hosts: ['api.esv.org'])
    store_connection_list(owner: space)  → what is connected, and to which apps

An app never holds a key. `store_connection_need` declares what it needs (a
built-in integration by name, or a name you choose with the hosts its key may be
sent to), and the person pastes the key, or signs in, on the space's connections
page (`yaks.app/manage/connections?space=<slug>`). The key goes from there to
the vault; it never appears in this chat, the app's data, its history or any
tool's response. Never ask the person to paste a key to you, and never invent
one. The app reads it by its **binding**: the integration's name in capitals
(`ESV`), or the `binding` you give.

The person can also do all of it on that page without you: **Add a key** with
the service's name and the hosts it may be sent to, then, under the connection,
choose the app and the binding name its code reads, and click **Attach to app**.
Use this when `store_connection_need` is not among your tools: tell the person
the binding name the code reads and the hosts, and they do the rest. A
connection the space already has is attached the same way, or with
`connection_attach`, naming the app, the connection id from
`store_connection_list` and the `binding`. Attaching is the owner's grant: at
first only the app's members can use the connection, and the app receives a
sentinel. The owner can separately allow the app's visitors to use it, on the
same page.

A connection that is made or attached is available to the app immediately,
whatever release it is running: there is nothing to redeploy.

### Instructions for getting a key

    store_connection_need(app, owner: space, integration: 'ESV',
      hosts: ['api.esv.org'], title: 'ESV API', site: 'https://api.esv.org',
      instructions: 'Sign up at https://api.esv.org, create an API application, and paste its token.')
    integration_set(integration: 'ESV', instructions: '…')

An integration you name yourself can say how a person gets its key, so someone
you share the app with, and their agent, can get their own key: `instructions`,
in markdown, written for the person and for the agent helping them (where to
sign up, which page issues the key, what to paste), with a `title`, a one-line
`tagline` and its https `site`. Pass them when `store_connection_need` creates
the integration; afterwards the space's owner changes them with
`integration_set`, or under the connection on the connections page. They are
shown beside the connection on every connections page that needs that key, above
the input on the page where a person connects their own key, and in the
`store_connection_need` and `store_connection_list` responses, so you can guide
the person through it. Only the space that created an integration can change
what it says, and the hosts its key may be sent to cannot be changed.

### The integration directory

    integration_list(words: 'bible')
    integration_set(integration: 'ESV', listed: true)

[yaks.app/integrations](/integrations) lists every integration built into
yaks.app, and every one a space created and listed, each with instructions for
getting its key and a button that adds it to one of the reader's own spaces.
`integration_list` searches it, signed in or not. The owner of the space that
created an integration lists it with `integration_set(listed: true)` or from its
card on the connections page, and removes it with `listed: false`. Anyone who
adds it connects their own key; the integration carries no credential, only its
instructions and its hosts.

### Using a key from a page

The app receives a **sentinel**: a string that stands for the key and is useless
anywhere else, so a sentinel in a page's source reveals nothing. A page requests
`./api/env` for the sentinels this visitor may use, by binding, puts one
wherever the service expects its key (a header, the query string, the body), and
sends the request to `./api/fetch?url=` followed by the service's address.
yaks.app forwards it with the key in place of the sentinel, only to the hosts
the connection names and only over https, and returns the service's response.
The ESV API takes its key as `Authorization: Token <key>`:

    let env = await (await fetch('./api/env')).json()
    let esv = (path) =>
      fetch('./api/fetch?url=' + encodeURIComponent(
        'https://api.esv.org/v3/passage/' + path,
      ), { headers: { authorization: 'Token ' + env.ESV } })
        .then((r) => r.json())

    let { passages } = await esv('text/?q=' + encodeURIComponent('John 3:16'))
    let { results } = await esv('search/?q=' + encodeURIComponent('living water'))
    // results: [{ reference, content }, ...]

`./api/fetch` keeps the method, the body and every header except the page's own
(cookies, origin, referer), so a POST with a JSON body works the same way. It
forwards only a request that carries a sentinel; the page makes any other
request itself.

Until the key is connected, `./api/env` has no `ESV`. Instead of failing, tell
the person where they will see it, and how to fix it:

    if (!env.ESV) {
      document.querySelector('#status').textContent =
        'The ESV key is not connected to this app yet: add it at ' +
        'yaks.app/manage/connections and attach it to this app as ESV.'
    }

Only someone with a role on the app may make calls through its connection. For a
page that serves everybody (a public page showing the weather), the person must
open the connection to anyone, on the connections page; until then a signed-out
visitor's call returns `403` from yaks.app, with a message saying so. The
connections page shows how many calls each app made through a connection this
month, and when a connection has a monthly cap, a call over it also returns
`403`, saying whose limit it is and where to connect their own key.

### Using a key from a worker

A worker reads the same sentinel as `env.ESV`, and every fetch it makes goes out
through yaks.app, which replaces the sentinel the same way:

    let got = await fetch('https://api.esv.org/v3/passage/text/?q=John+3:16', {
      headers: { authorization: 'Token ' + env.ESV },
    })

Use a worker for what a page cannot do (When an app needs a worker, above), not
to hold the key: the call is the same either way. A sentinel inside Basic auth
(`Authorization: Basic` of `user:sentinel`, as `curl -u` sends it) is replaced
inside the pair. A key the service needs transformed before it is sent, for a
request signature or AWS SigV4, never appears verbatim in the request, so it
cannot be replaced. `direct: true` gives the worker the key itself instead. Use
it only for that case; a direct key never reaches a page.

### Per-person connections (`each: true`)

An app that reads each person's own account, such as their calendar or their
inbox, requests the connection with `each: true`. Link each person to the app's
`./api/connections/<integration>`, where yaks.app shows the Connect button;
`./api/env` then returns that person's own sentinel, and only they can make
calls with it.

Installing an app copies the connections it requests, never a key. The installed
copy requests each connection the app uses from the installer's space: with the
same binding, the same `direct` setting, and per person where the app requests
one per person. The installer's connections page lists each as needed, with
instructions for getting its key, and `env.ESV` is set once they connect their
own. Opening a connection to anyone is not copied by an install; the installer
opens their own. `app_update` requests any connection the new version added.

## CPU and subrequest limits

Each ordinary request is limited to **50ms of CPU time and 50 subrequests**. A
scheduled command declared with `"worker": "/tick"` gets up to 5 seconds of CPU
time for one bounded step, with the same 50-subrequest limit. Its next step is
another `wake`; the worker does not keep running. The compatibility date the
script is uploaded with is `2025-05-08`, unless `wrangler.jsonc` sets
`compatibility_date`.

50ms is CPU time, not wall-clock time, so time spent waiting on a fetch does not
count against it. A store read, an outside call, and building the response fit
well within it. A loop does not: a fetch per row of a list will reach the
subrequest limit, and parsing a large body repeatedly will reach the CPU limit.
If you need many rows, request them from the store in one query, which is one
subrequest however many rows it returns.

## Error handling

Let errors throw. An error you can see is more useful than a `catch` that hides
it, and the platform records each of these:

- **An exception thrown from your `fetch`** becomes an `exception` entity in the
  app's own store, with the request line, the version the app was serving, the
  message and the stack, and the visitor gets the platform's "Something went
  wrong. Your assistant has been told." page with a 500.
- **A 5xx you return** is recorded the same way, since a 5xx is a failure, not a
  deliberate response: the entity records `the app's worker answered 503`,
  followed by the `error.message` of a JSON response, and names the route.
- **A 4xx you return is not an error** and records nothing. It is a deliberate
  refusal ("no city by that name", or the 401 an outside service returned for a
  mistyped key). The rule depends only on the status, so an outside service's
  refusal passed through does not fill the person's error list.

For an exception and a 5xx, `app_errors` lists the open errors, and the person's
agent is told about each one once, in its next response from a tool that changes
something.

The one error worth catching is a failed outside call, so you can return
something more useful to the page than a stack trace: catch it, and return a 4xx
with a message.

## Example workers

**One route that reads the store.** Every other request falls through to the
files:

    export default {
      async fetch(req, env) {
        let url = new URL(req.url)
        if (!url.pathname.endsWith('/titles')) {
          return new Response('not found', { status: 404 })
        }
        let r = await env.STORE.fetch('/query?.recipe&?doc')
        if (!r.ok) return new Response(await r.text(), { status: r.status })
        let rows = await r.json()
        return Response.json(rows.map((row) => row.doc.title))
      },
    }

**A paid API with a key.** The key is set on the worker; the page calls the
worker, never the service. The outside service's failure is returned as a
message with a 502, which is recorded as an error, while a bad request from the
page gets a 400, which is not:

    export default {
      async fetch(req, env) {
        let url = new URL(req.url)
        if (!url.pathname.endsWith('/weather')) {
          return new Response('not found', { status: 404 })
        }
        let city = url.searchParams.get('city')
        if (!city) {
          return Response.json({ error: 'name a city' }, { status: 400 })
        }

        let at = 'https://api.example.com/now?city=' + encodeURIComponent(city)
        let got = await fetch(at, {
          headers: { authorization: 'Bearer ' + env.WEATHER_KEY },
        })
        if (!got.ok) {
          return Response.json(
            { error: `the weather service said ${got.status}` },
            { status: 502 },
          )
        }
        let now = await got.json()
        // Return only what the page draws: the page does not need the
        // service's full response, and the key stays in the worker.
        return Response.json({ tempC: now.temp_c, sky: now.condition.text })
      },
    }

**A webhook receiver.** A machine posting to the app is not signed in: it has no
session, so `x-yak-person` is absent and the grant names no person. That limits
what it can write: `env.STORE` acts as the caller, and a caller with no role can
write only if the app's `access` is `open`. So a webhook that writes needs an
`open` app, which also means anyone with the link can write. Accept that
trade-off deliberately, and make the route usable only by the sender: require a
shared secret in a header, and compare it with a secret of yours.

    export default {
      async fetch(req, env) {
        let url = new URL(req.url)
        if (!url.pathname.endsWith('/hook')) {
          return new Response('not found', { status: 404 })
        }
        if (req.method != 'POST') {
          return new Response('post it', { status: 405 })
        }
        // A shared secret: the header must match the value the sender was
        // given, which is set on the worker and nowhere else.
        if (req.headers.get('x-hook-key') != env.HOOK_KEY) {
          return new Response('no', { status: 401 })
        }
        let sent = await req.json()
        let r = await env.STORE.fetch('/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entities: [{
              doc: { title: String(sent.title ?? 'untitled') },
              ticket: { state: String(sent.state ?? 'open') },
            }],
          }),
        })
        if (!r.ok) return new Response(await r.text(), { status: r.status })
        return new Response(null, { status: 204 })
      },
    }

(`ticket` is the app's own component, declared in its `vocab.json` and installed
by `app_deploy`.)

## Deploying a worker

A worker is a file, so it is written and released like every other file:

    app_files(app, files: [{path: 'worker.js', content: '<the module>'}])
    app_deploy(app)

When the worker is uploaded, the deploy reports
`worker: worker.js answers first; a 404 from it serves the files`. Delete
`worker.js` and the next deploy removes the worker too, so what is served always
matches the app's files. A rollback replays a deploy: `app_rollback` selects the
kept worker and files; a legacy version without its own immutable source is
prepared from its pinned bytes before switching, so rolling back an app also
rolls back its code.

## The build sandbox

Some code has to be compiled before a browser can run it, such as a chess
engine, an image codec or a solver. `sandbox_shell` runs the compiler in a Linux
container that belongs to the space. Preinstalled:

    Rust 1.98.1      with wasm32-unknown-unknown, wasm-bindgen 0.2.128,
                     wasm-opt 132
    Python 3.13.15   with pip
    Go 1.27.1        GOOS=js GOARCH=wasm, and lib/wasm/wasm_exec.js beside it
    Zig 0.16.0       and with it C and C++: `zig cc`, `zig c++`
    Deno 2.9.1       plus the Node and Bun the base image ships

`zig cc -target wasm32-freestanding -nostdlib -Wl,--no-entry` is the shortest
way from C to a WebAssembly module a browser instantiates with no glue code; the
`wasm32-wasi` target produces one that runs under a WASI shim. C++ takes the
same flags, with `-fno-exceptions`.

**Other tools install for the session.** Commands run as root, so
`apt-get install -y <package>`, `cargo`, `pip`, `npm` and `go get` all work, and
nothing installed affects the next build.

**The container is destroyed when the build ends**, with everything in it. Only
the files `sandbox_ship` copied into the app are kept.

**`sandbox_ship` keeps a build's folder structure.** Name a file, a folder or a
glob in the sandbox. A folder copies every file inside it, so a site built into
`dist/` lands where its pages expect its files:

    sandbox_ship(app, paths: ['dist'])
      dist/index.html        → index.html
      dist/about/index.html  → about/index.html
      dist/_astro/app.js     → _astro/app.js

A file, or each file a glob matched, is copied under its own name, relative to
the folder its matches share, so `pkg/*.wasm` lands beside `index.html` and
`dist/*` lands the same way `dist` does. `into: 'dist'` puts everything shipped
under that folder of the app instead of its root. Two different files that would
land on the same path are refused. `replace: true`, with `into`, makes that
folder contain exactly what this call ships: each file an earlier build left
there is deleted, and kept in its history like any other delete.

**The sandbox has full internet access.** `git clone` from GitHub, a scaffolder
that downloads its template (`npm create astro`), any registry and any API all
work.

**One sandbox at a time.** Your sandbox is private to you in each space, and one
person can have one sandbox awake at a time on the free plan, two on the Plus
plan. A sandbox goes to sleep five minutes after its last command, and a sandbox
in the next space can wake after that. The monthly build time (the sandbox's,
and compiling TypeScript and npm packages at `app_deploy`) is 1 hour on the free
plan, shared by the free spaces you own, and 10 hours for each space on the Plus
plan.

That container is **signed in as you**. Two variables are set in every command's
environment, and the `yak` CLI is installed:

    YAKS_TOKEN   a placeholder for a grant — you, narrowed to this space
    YAKS_HOST    https://yaks.app

So a build script can call the same tools your agent has, as you:

    yak app_list
    yak graph query '.recipe'
    yak apply @rows.ndjson

`yak <tool>` runs any tool this connector lists (it reads the list at run time,
so it always matches the connector), and `yak apply` streams a file of NDJSON
bundles into the graph 50 at a time. `curl` reaches the same MCP endpoint if you
prefer to write the JSON-RPC yourself:

    curl -sS "$YAKS_HOST/mcp" \
      -H "authorization: Bearer $YAKS_TOKEN" \
      -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":
           {"name":"app_list","arguments":{}}}'

The container never holds the grant itself. `$YAKS_TOKEN` is a placeholder, and
yaks.app replaces it with the grant in an outgoing request, only when the
request goes to yaks.app or to your space's own address (`<space>.yaks.app`,
which answers a clone of your app). Sent anywhere else, it stays a placeholder,
so printing it, or a package reading it, reveals nothing.

The grant is minted when the container wakes and **expires with the container**:
it is revoked as soon as the sandbox is destroyed, and it expires on its own
soon after the sandbox would have gone to sleep. It never has more permission
than you: it carries no permission of its own, only your membership, and only in
this space.

## Deploying a site built with Vite, Astro, Eleventy or SvelteKit

A site made with Vite, Astro, Eleventy, SvelteKit or any other tool that writes
a folder of files is built in the sandbox and served as built:

1. Write the project into the sandbox, then install and build in one
   `sandbox_shell` command. Its files last until the sandbox goes to sleep, five
   minutes after its last command, so build and ship in one session.
2. Ship the output into a folder of the app, replacing the last build, and ship
   the source beside it, so the next build starts from this one's source:

       sandbox_ship(app, paths: ['site/dist'], into: 'dist', replace: true)
       sandbox_ship(app, paths: ['site/src'], into: 'src')
       sandbox_ship(app, paths: ['site/package.json', 'site/package-lock.json'])

   A sandbox that went to sleep starts empty. To get the app back, including its
   images, clone the app's last release:
   `git clone https://x:$YAKS_TOKEN@<space>.yaks.app/<app>.git`.
3. Name the folder the app serves in `wrangler.jsonc`:
   `{"assets": {"directory": "dist"}}`, so `dist/index.html` is the app's front
   page and the source is not served
   ([Files and Uploads](https://yaks.app/docs/files.md)).
4. Run `app_deploy`. Only the pages inside that folder are scanned for scripts
   to compile, and a bundler's output needs no compiling.

The app is served at `/<app>/`, not at the root of its host, so build for that
path:

- **Vite**: `vite build --base=./` makes every URL relative, so the build works
  at any address the app is served or installed at.
- **SvelteKit**: `@sveltejs/adapter-static`, whose URLs are relative already. A
  route is a page like `about.html`, served at `/<app>/about`.
- **Eleventy**: links relative to each page (`../style.css`), or `pathPrefix`
  set to `/<app>/`.
- **Astro**: `base: '/<app>'` in `astro.config.mjs`. Its URLs are absolute, so a
  copy installed at another address, or the app set as a space's front page,
  needs its own build.

A bundler cannot resolve `./api/client.js`, because the platform serves it
beside the app and the project does not contain it, so a bundled script imports
it when it runs, relative to the page's address:

    let { apply, query } = await import(
      /* @vite-ignore */ new URL('api/client.js', document.baseURI).href
    )

---

The full guide: <https://yaks.app/docs.md>
