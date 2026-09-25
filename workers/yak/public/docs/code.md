---
doc:
  title: Code of your own
guide:
  slug: code
  brief: worker.js in front of an app's files
  description: >-
    worker.js in front of an app's files: which routes are yours, what env
    holds (STORE, FILES, and the keys the person connected), what the request reports
    about who is asking, the CPU and subrequest limits, and whole workers to
    copy.
---

# Code of your own

An app is pages until you give it a `worker.js`. This page is what that file
gets: which requests reach it, what `env` holds, what the request reports about
who is asking, the limits it runs under, and three workers written out whole.

## When an app needs one, and when it does not

Most apps never need one. A page reads and writes the app's own graph through
`./api/client.js`, and that client already knows who is looking and already
enforces the app's `access`. A worker adds nothing there.

Write one when the app has to do something a page cannot be trusted with, or
cannot do at all:

- **A key.** An API key in a page is a key you have given away — anyone with the
  link can read it out of the source. `connection_need` asks the person for one,
  and the worker calls out with it without ever holding it. This is the reason
  most workers exist.
- **A machine calling in.** A webhook, a form post from somewhere else, a cron
  on another service: none of them run your page, so none of them can use the
  client.
- **An answer that is not the app's data.** A route that talks to another
  service and hands the page back a small shape, so the page is not holding a
  third party's protocol.
- **Bytes the browser should not shape.** A CSV out of the store, a redirect, a
  `content-type` a page cannot set.

Not for routing — an address under the app that names no file and ends in no
extension already serves `index.html`, so a page can read `location.pathname`
and draw that place with no server at all. Not for templating either: the store
is live, and `subscribe` redraws.

## The module

`worker.js` sits beside `index.html`, among the app's files. It is a plain ES
module with a default export — no bundler, no imports from a registry, what you
write is what runs:

    export default {
      async fetch(req, env, ctx) {
        return new Response('hello')
      },
    }

`req` is the visitor's own request, `env` holds the bindings for the app's store
and files along with every key the person has connected, and `ctx` is the
runtime's. There is no build step: the file is uploaded as-is at `app_deploy`
and run as-is.

To use a different server output, put `wrangler.jsonc` (or `wrangler.json`) at
the app root with `{"main":"dist/server.mjs"}`. `main` is the app-relative
server source path, defaulting to `worker.js`; directories and a leading `./`
are allowed. Deploy follows that source's relative imports. The platform's
upload wrapper uses an internal script name the app never configures. The server
source is not served publicly. Use JavaScript ES modules (`.js` or `.mjs`);
compile TypeScript before uploading.

### More than one file

`worker.js` may import the files beside it, and the deploy carries every module
it imports and every module those import. Nothing else goes up: the app's page
scripts stay pages.

That is also how a worker compiled from another language runs on yaks.app. A
`.wasm` arrives as a compiled `WebAssembly.Module`, instantiated once at the top
level rather than per request:

    import wasm from './add.wasm'

    let { exports } = new WebAssembly.Instance(wasm, {})

    export default {
      fetch: () => new Response(String(exports.add(2, 3))),
    }

Bytes are not text, so a `.wasm` is written with `base64` in place of `content`:

    app_files(app, files: [{path: 'add.wasm', base64: '<the bytes>'}])

## The fall-through rule

Every request for the app that is not under `/api/` reaches the worker first,
and **anything it answers with a 404 falls through to the app's files.**

    return new Response('not found', { status: 404 })   // → the files

So a worker owns the routes it names and leaves everything else alone. You never
serve your own `index.html`, your own stylesheet or your own pictures: answer
404 for anything you did not mean to handle and the platform serves it — with
the app's `<base href>` written in, the error reporter injected, and the
pretty-path fallback still working.

A 404 you meant as an answer is indistinguishable from one you meant as a pass,
because the platform reads it as a pass. If a route of yours must report "no
such recipe", use a status that means it — 404 sends the caller to `index.html`
instead. Use 400, or answer 200 with a body that explains, or serve your own
not-found page.

## Which paths are yours

The request keeps its whole address, so `url.pathname` includes the app's own
slug: a visit to `<space>.yaks.app/recipes/mine` reaches the worker as
`/recipes/mine`.

Two consequences worth building around:

- Match the **tail**, not the whole path. An installed copy of your app lives at
  whatever address the installer took it at, so a worker that tests
  `pathname == '/recipes/mine'` stops matching in every copy. Test
  `pathname.endsWith('/mine')`, or read the app's own slug off the `x-yak-app`
  header the platform sets.
- `/api/*` is never yours. That segment is the platform's own endpoints — apply,
  query, me, graph, ws, blob, files/`<path>`, report, plus `client.js` and
  `report.js` — and a request for one is answered by the platform without the
  worker being called at all. Your routes live beside it.

These files are never served to the web at all, worker or no worker:
`worker.js`, `vocab.json`, `wrangler.jsonc` and `wrangler.json`. Those are the
app's inside. `GET /<app>/worker.js` serves the platform's 404 page — the test
is on the decoded path, so `/%77orker.js` is the same file and the same 404 —
and a member reads them back through `app_files` read. Nothing you write in
`worker.js` is visible to a visitor.

## env.STORE — the app's graph, as the person looking

    let r = await env.STORE.fetch('/query?.recipe&?doc')
    let rows = await r.json()

`env.STORE.fetch(path, init)` reaches the same HTTP endpoints `client.js` wraps,
at the app's own `/api/`. Two things about it:

- **It is a path, not a URL.** `'/query?...'` is the app's query endpoint, not
  the hostname's. A leading slash is optional and stripped either way, so
  `'query?...'` is the same call. The query string rides along.
- **It acts as the person looking.** The platform mints a grant naming this
  store, this visitor and their role, good for a minute, and the binding adds it
  to every call the worker makes through `STORE` and `FILES`. So the app's
  `access` decides what your worker can do exactly as it decides what their page
  can do. Reaching past it is `env.APP`, the next section, and it is a
  deliberate exception with a rule of its own — not something `env.STORE` will
  do for you by accident. A grant minted for one app's store is refused by any
  other, and app code never sees the grant itself: the binding strips that
  header before your module is called.

It returns a `Response`, not parsed rows, so read the status yourself:

    let r = await env.STORE.fetch('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entities: [{ doc: { title: 'Lemon cake' } }] }),
    })
    if (!r.ok) return new Response(await r.text(), { status: r.status })

A refusal comes back the way it comes back to a page —
`{"error": {"code": "not_a_writer", "message": "sign in to change this app"}}`
with a 401 or 403 — so passing it straight through gives the page a message it
already knows how to show.

The whole filter grammar works in a worker, because these are the same
endpoints: `.doc`, `.recipe.minutes<=30`, `id=<eid>`, `limit=`, `.count`, a bare
word for full text. Ask for the components you will use.

## env.APP — the app's graph, as the app itself

    let r = await env.APP.fetch('/query?.household.code=' + hash)

`env.APP.fetch(path, init)` reaches the same endpoints at the same addresses as
`env.STORE`, with one difference: it acts as the APP, at `editor`, on the app's
own store. It reads and writes whatever the app's `access` allows — `private`
included — and a write through it is signed by the app, so `created.by` is the
app's own entity and not a guest.

It exists for one shape of app: **the worker is the gatekeeper.** `access` is
one setting covering the whole store, so it cannot express "each household edits
its own row and nobody else's". That rule is code, and the code needs a way in
that is not already refusing. `env.APP` is that way in.

**A private app's worker runs anyway.** `private` sends a stranger to the login
page — but not before your worker has had the request, and not for the calls
your worker makes back through `env.FILES`. So the guest holding an invitation
card reaches your route, and your route can hand them a page. Everything else
about `private` holds: they cannot reach the store endpoints, and they cannot
ask for a file directly.

Everything true of `env.STORE` is true of this one. It is a path, not a URL. The
grant naming your store is refused by every other store. Your code never sees
it: the platform mints it per request and the binding keeps it in a closure, so
there is no header a caller can send you that turns into one.

Two things it is not:

- **Not the owner.** An editor writes the app's data and never its roster. A
  batch — everything written in one `apply` call — touching `member`, `grant` or
  `access` is refused through this binding the same as any other, so a worker
  cannot promote anyone, itself included.
- **Not for the whole worker.** Use `env.STORE` for everything the visitor is
  allowed to do, and `env.APP` only on the path where you have checked
  something. A worker that reaches for `env.APP` everywhere has an `open` app
  with extra steps.

### The RSVP pattern

A wedding site. Every household has an invitation code; that household may see
and change its own reply and nothing else. Set the app `private`, so the store
answers a stranger nothing at all, and let the worker be the way in — it still
runs, and it can still read the app's pages with `env.FILES` to hand one back.

Store a **hash** of the code, never the code. The codes are on paper cards in
the post; the graph is a thing you will export, back up and read over someone's
shoulder, and a code that leaks is a household's row.

    // Seeding, once, as the owner: a household per card.
    { entity: { eid: '$h' },
      doc: { title: 'The Okonkwos' },
      household: { code: '<sha-256 of the code>', seats: 2 } }

The route accepts the code, hashes it, finds the one row that matches, and
touches only that row:

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
        // A wrong code and a missing household are the same answer: 403, and
        // nothing about which it was.
        if (!found) return new Response('no invitation by that code', {
          status: 403,
        })
        // The eid comes from the row the code found — never from the body.
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

**This is the one place where your own check is the permission.** Everywhere
else the store is behind you: you can write a check, forget a case, and the
store still refuses. Through `env.APP` there is nothing behind you. So:

- **The check comes first**, before the first `env.APP` call on that path, with
  nothing between the two.
- **The refusal is 403**, and it reveals nothing more. Not 404, not "no such
  household", not a different message for a wrong code than for a missing one —
  a difference is a way to read the guest list.
- **The eid comes from the row the check found**, never from the request body.
  Taking an eid from the caller and writing it is the whole rule handed back to
  the caller.
- **Nothing else on that path is reached through `env.APP`.** Listing every
  household to find one is the private app made public by your own hand; ask for
  the row, not the table.

Rate-limit the guess if the code is short — a four-character code is ten
thousand tries — or make it long enough not to be worth guessing.

## env.FILES — the app's own files

    let page = await env.FILES.fetch('/index.html')
    let html = await page.text()

The same files the web gets, under the app's root, served the same way. Useful
for reading a template, or for handing a page back yourself with a header of
your own. Three things follow from it being served the same way:

- An HTML page comes back **already transformed** — the `<base href>` is in it
  and the reporter script is injected. You are reading what a visitor would have
  received, not the bytes in storage.
- `worker.js` and `vocab.json` answer 404 to the worker too: it cannot read its
  own manifest this way.
- A path with no extension that names no file gets `index.html`, the same
  pretty-path fallback the browser gets.

A request from your worker never re-enters your worker, so
`env.FILES.fetch('/index.html')` is not a loop.

## The rest of env

Every connection the app uses is on `env` under its name — `env.WEATHER`,
`env.OPENAI` (below). The service binding the platform uses to build `STORE`,
`APP` and `FILES` is there too, as `env.KERNEL`; it is plumbing — it wants
absolute URLs and a grant header it will not hand you — and those three bindings
are what it is for. Reach for those.

An app may carry `wrangler.jsonc` or `wrangler.json` beside `worker.js`. The
supported keys are `main` (the app-relative server source path, `worker.js` by
default; directories such as `dist/server.js` are allowed, and the upload
wrapper is internal), `compatibility_date`, `compatibility_flags`, `vars`,
`d1_databases`, `r2_buckets`, `durable_objects.bindings` with local
`class_name`, `migrations`, and `vectorize`. `ai` is refused: Workers AI is
billed to the platform and not metered per space. D1 databases, R2 buckets and
Vectorize indexes belong to that app; yaks.app creates them at deploy and reuses
them. A new Vectorize index also names its `dimensions` and `metric`, or a
`preset`. `app_deploy` reports unsupported settings and `app_list` names the
bindings. Removing a binding keeps its resource and data until the app is
permanently deleted; the app's 30 days in the trash keep them too. A declared
binding keeps its name, including `STORE`, `FILES` or `APP`; otherwise those
names are the convenience bindings described above.

`vpc_services` reaches a machine of the space owner's own, such as a server on
their computer, without opening a port on it. The owner links the machine to the
space first and opens the paths apps may reach; then
`"vpc_services": [{ "binding": "BOX" }]` gives the worker `env.BOX`, and
`env.BOX.fetch('http://localhost/mail/inbound', init)` is a request to that path
on the machine, made as the app. Only the path and query go on, and a path the
owner has not opened is answered 404. Any `service_id` in the config is ignored:
the machine is the space's. A space with no linked machine, or an app installed
from somewhere else, is refused it.

### Taking money is not one of your keys

A worker that charges somebody does **not** hold a Stripe key. Selling is a
platform endpoint — `POST ./api/pay/checkout`, which your worker calls through
`env.STORE` exactly as a page calls it — and the seller's own connected account
is what the charge lands on. You post a cart of product eids and quantities; the
price is read off each `product` row in the app's own store, so no amount of
money is ever part of the request and there is no key for your worker to leak.
<https://yaks.app/docs/selling.md> is the whole of it.

## Who is asking

The platform sets three headers on the request it hands you, and strips any a
client tried to send under the same names:

- `x-yak-person` — the visitor's eid. **Absent** when nobody is signed in.
- `x-yak-role` — `owner`, `editor` or `viewer`. Absent when they have no role in
  the space, which includes every signed-out visitor and every signed-in
  stranger.
- `x-yak-app` — the app's own slug, so a worker can build its own addresses
  without being told its name.

Reading them is ordinary:

    let person = req.headers.get('x-yak-person')   // null for a guest
    let role = req.headers.get('x-yak-role')

What they prove: the platform wrote them, this request came through the
platform, and nobody upstream can forge them — a client's own `x-yak-person` is
deleted before your code runs.

What they do not prove:

- **Not permission.** The role is membership in the space. What this visitor may
  do to this app's data is the app's `access` on top of that, and `env.STORE`
  already applies it. Do not write your own check and assume it matches; let the
  store refuse and pass the refusal on.
- **Not an identity you can mail.** An eid is not an address and not a name. No
  address ever reaches app code.
- **Not a session.** The platform's session cookie is stripped on the way in —
  the app is owed this visit and not a credential for every space the person
  belongs to. Other cookies are left alone, so a cookie your own page set is
  still there.

## Keys

    connection_need(app, integration: 'weather', hosts: ['api.weatherapi.com'])
    connection_list()          → what is connected, and which app reads which

An app never holds a key. `connection_need` says what it needs — a built
integration by name, or a name of your own with the hosts its key may be sent to
— and the person pastes the key, or signs in, on the space's connections page
(`yaks.app/manage/connections`). It goes from there to the vault; it is never in
this chat, the app's data, its history or any tool's answer. Never ask the
person to paste a key to you, and never invent one.

What the worker reads, as `env.WEATHER` (the integration's name in capitals, or
the `binding` you give), is a **sentinel**: a string that stands for the key.
Put it wherever the service wants its key — a header, the query, the body:

    let got = await fetch(
      'https://api.weatherapi.com/v1/current.json?q=Paris&key=' + env.WEATHER,
    )

Every fetch the worker makes leaves through yaks.app, which sends it on with the
key in the sentinel's place — only to the hosts the connection names, and only
over https. A sentinel is useless anywhere else, so one that leaks is nothing to
worry about. Until the person connects it, `env.WEATHER` is not there; say so
rather than failing.

Only someone with a role on the app may call out through it. A worker that
answers everybody (a public page's weather) needs the person to open the
connection to anyone, on the same page; until then a signed-out visitor's call
comes back `403` from yaks.app, saying so.

A key the service wants transformed before it is sent — a request signature, AWS
SigV4, Basic auth's base64 — never appears verbatim, so it cannot be swapped.
`direct: true` hands the worker the key itself instead. Use it only for that.

A page's own fetches never pass through yaks.app, so a sentinel in one goes out
as it is. An app with no worker sends the call through the platform instead:
`./api/env` answers the sentinels this visitor may call out with, by name, and
`./api/fetch?url=` sends a call on to that address with the key in the
sentinel's place, answering what the service answered:

    let env = await (await fetch('./api/env')).json()
    let got = await fetch('./api/fetch?url=' + encodeURIComponent(
      'https://api.weatherapi.com/v1/current.json?q=Paris&key=' + env.WEATHER,
    ))

It sends only a call carrying a sentinel, and a direct key never reaches a page.

An app that reads each person's own account — their calendar, their inbox — asks
with `each: true`. Link each person to the app's
`./api/connections/<integration>`, where yaks.app draws the Connect button;
`./api/env` then answers their own sentinel, and only they call out through it.

Keys are not copied by an install. An installed copy is a new app; its own
person connects their own. A published app that needs a key should say so in its
`about` line.

## The limits

Each request runs under **50ms of CPU and 50 subrequests**. The compat date the
script is uploaded with is `2025-05-08`.

50ms is CPU, not wall clock, so the time spent waiting on a fetch is not what
spends it. A store read, an outside call, and shaping the answer fit with room
over. What does not fit is a loop: a fetch per row of a listing will find the
subrequest ceiling, and parsing a large body repeatedly will find the CPU one.
If you need many rows, ask the store for them in one filter — that is one
subrequest whatever it returns.

## When it throws

Let it throw. A break you can see is worth more than a `catch` that hides one,
and nothing is swallowed here:

- **A throw out of your `fetch`** becomes an `exception` entity in the app's own
  store — the request line, the version the app was serving, the message and the
  stack — and the visitor gets the platform's soft "Something went wrong. Your
  assistant has been told." page with a 500.
- **A 5xx you return** is filed the same way, since nobody chose it: the entity
  records `the app's worker answered 503` and names the route.
- **A 4xx you return is not a break** and files nothing. That is your deliberate
  no — "no city by that name", or the 401 an outside service gave you for a
  mistyped key — and the rule is the status, so an outside service's refusal
  passed through does not fill the person's error list.

Either way `app_errors` lists what is open and the person's agent hears about it
once, on its next reply from a tool that changes something.

The one thing worth catching is an outside call, so you can answer the page
something better than a stack: catch it, and return a 4xx with a message.

## Three workers

**One route out of the store.** Everything else falls through to the files:

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

**A paid API with a key.** The key is on the script; the page asks the worker,
never the service. Note the outside failure is answered as a message with a 502
— filed, since nobody chose it — while a bad request from the page is a 400,
which is not:

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
        // Only what the page draws — the service's whole shape is not the
        // app's business, and the key stays on this side of it.
        return Response.json({ tempC: now.temp_c, sky: now.condition.text })
      },
    }

**A webhook receiver.** A machine posting in is nobody: it has no session, so
`x-yak-person` is absent and the grant names no person. That matters for what it
can write — `env.STORE` acts as the caller, and a caller with no role writes
only if the app's `access` is `open`. So a webhook that writes wants an `open`
app, which also means anyone with the link writes. Take the trade knowingly, and
shape the route so only the sender can use it: a shared secret in a header,
checked against a secret of yours.

    export default {
      async fetch(req, env) {
        let url = new URL(req.url)
        if (!url.pathname.endsWith('/hook')) {
          return new Response('not found', { status: 404 })
        }
        if (req.method != 'POST') {
          return new Response('post it', { status: 405 })
        }
        // A shared secret, not a guess: the header must match what the
        // sender was given, which lives on the script and nowhere else.
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

## Putting one in front

A worker is a file, so it is written and released like every other file:

    app_files(app, files: [{path: 'worker.js', content: '<the module>'}])
    app_deploy(app)

When the script went up, the deploy reports
`worker: worker.js answers first; a 404 from it serves the files`. Delete
`worker.js` and the next deploy removes the script with it, so what serves is
always what the files describe. A deploy is also what a rollback replays:
`app_rollback` re-uploads the `worker.js` that version pinned, so putting an app
back puts its code back too.

## The build sandbox is signed in as you

Some code has to be compiled before a browser can run it — a chess engine, an
image codec, a solver — and `sandbox_shell` runs the compiler in a Linux
container of the space's own. Already in it:

    Rust 1.98.1      with wasm32-unknown-unknown, wasm-bindgen 0.2.128,
                     wasm-opt 132
    Python 3.13.15   with pip
    Go 1.27.1        GOOS=js GOARCH=wasm, and lib/wasm/wasm_exec.js beside it
    Zig 0.16.0       and with it C and C++: `zig cc`, `zig c++`
    Deno 2.9.1       plus the Node and Bun the base image ships

`zig cc -target wasm32-freestanding -nostdlib -Wl,--no-entry` is the shortest
road from C to a module a browser instantiates with no glue; the `wasm32-wasi`
target gives you one that a WASI shim runs. C++ takes the same flags, with
`-fno-exceptions`.

**Anything else installs for the session.** Commands run as root, so
`apt-get install -y <package>`, `cargo`, `pip`, `npm` and `go get` all work, and
none of it costs the next build anything.

**The container is destroyed when the build ends**, and everything you put in it
goes with it. Only what `sandbox_ship` copied into the app survives.

**Its network reaches the package registries and nothing else**: crates.io,
PyPI, npm, the Go module proxy, Ubuntu's archive, and yaks.app itself. Any other
address is refused, so a build fetches what it needs from a registry, not from a
URL.

**One sandbox at a time.** Each space has its own, and one person holds one
awake at a time on the free plan, two on the Plus plan. A sandbox sleeps five
minutes after its last command, and the next space's wakes then. The month's
sandbox time is 1 hour on the free plan, shared by the free spaces you own, and
10 hours for each space on the Plus plan.

That container is **signed in as you**. Two variables are set in every command's
environment, and the `yak` CLI is installed:

    YAKS_TOKEN   a grant — you, narrowed to this space
    YAKS_HOST    https://yaks.app

So a build script reaches the same tools your agent has, as you:

    yak app_list
    yak graph query '.recipe'
    yak apply @rows.ndjson

`yak <tool>` runs any tool this connector lists — it reads the list at run time,
so it cannot drift — and `yak apply` streams a file of NDJSON bundles into the
graph 50 at a time. `curl` reaches the same MCP endpoint if you would rather
write the JSON-RPC yourself:

    curl -sS "$YAKS_HOST/mcp" \
      -H "authorization: Bearer $YAKS_TOKEN" \
      -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":
           {"name":"app_list","arguments":{}}}'

The grant is minted when the container wakes and **dies with the container** —
it is taken back the moment the sandbox is destroyed, and it expires by itself
soon after the sandbox would have slept. It is never more than you are: it
carries no permission of its own, only your membership, and only in this space.
Nothing else about it needs handling — do not print it, and do not write it into
a file the app serves.

---

The whole guide: <https://yaks.app/docs.md>
