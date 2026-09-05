# Code of your own

An app is pages until you give it a `worker.js`. This page is what that file
gets: which requests reach it, what `env` holds, what the request says about who
is asking, the limits it runs under, and three workers written out whole.

## When an app needs one, and when it does not

Most apps never need one. A page reads and writes the app's own graph through
`./api/client.js`, and that door already knows who is looking and already
enforces the app's `access`. A worker adds nothing there.

Write one when the app has to do something a page cannot be trusted with, or
cannot do at all:

- **A key.** An API key in a page is a key you have given away — anyone with the
  link can read it out of the source. `app_secret_set` puts one on the app's
  script, where only the worker sees it. This is the reason most workers exist.
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

`req` is the visitor's own request, `env` holds the app's doors and its secrets,
`ctx` is the runtime's. There is no build step: the file is uploaded as-is at
`app_deploy` and run as-is.

### More than one file

`worker.js` may import the files beside it, and the deploy carries every module
it names and every module those name. Nothing else goes up: the app's page
scripts stay pages.

That is also how a worker compiled from another language runs here. A `.wasm`
arrives as a compiled `WebAssembly.Module`, instantiated once at the top level
rather than per request:

    import wasm from './add.wasm'

    let { exports } = new WebAssembly.Instance(wasm, {})

    export default {
      fetch: () => new Response(String(exports.add(2, 3))),
    }

Bytes are not text, so a `.wasm` is written with `base64` in place of `content`:

    app_files(app, files: [{path: 'add.wasm', base64: '<the bytes>'}])

## The fall-through rule

Every request for the app that is not under `/api/` reaches the worker first,
and **anything it answers 404 falls through to the app's files.**

    return new Response('not found', { status: 404 })   // → the files

So a worker owns the routes it names and leaves everything else alone. You never
serve your own `index.html`, your own stylesheet or your own pictures: answer
404 for anything you did not mean to handle and the platform serves it — with
the app's `<base href>` written in, the reporter injected, and the pretty-path
fallback still working.

A 404 you meant as an answer is indistinguishable from one you meant as a pass,
because the platform reads it as a pass. If a route of yours must say "no such
recipe", say it with a status that means it — 404 sends the caller to
`index.html` instead. Use 400, or answer 200 with a body that says so, or serve
your own not-found page.

## Which paths are yours

The request keeps its whole address, so `url.pathname` includes the app's own
slug: a visit to `<space>.yaks.app/recipes/mine` reaches the worker as
`/recipes/mine`.

Two consequences worth building around:

- Match the **tail**, not the whole path. An installed copy of your app lives at
  whatever address the installer took it at, so a worker that tests
  `pathname == '/recipes/mine'` stops matching in every copy. Test
  `pathname.endsWith('/mine')`, or read the app's own slug off the `x-yak-app`
  header the kernel sets.
- `/api/*` is never yours. That segment is the platform's doors — apply, query,
  me, graph, ws, blob, files/`<path>`, report, plus `client.js` and `report.js`
  — and a request for one is answered by the kernel without the worker being
  called at all. Your routes live beside it.

Three files are never served to the web at all, worker or no worker:
`worker.js`, `vocab.json` and `tools.json`. Those are the app's inside.
`GET /<app>/worker.js` answers the platform's 404 page — the test is on the
decoded path, so `/%77orker.js` is the same file and the same 404 — and a member
reads them back through `app_files` read. Nothing you write in `worker.js` is
visible to a visitor.

## env.STORE — the app's graph, as the person looking

    let r = await env.STORE.fetch('/query?.recipe!&.doc?')
    let rows = await r.json()

`env.STORE.fetch(path, init)` is the same set of doors `client.js` wraps, at the
app's own `/api/`. Two things about it:

- **It is a path, not a URL.** `'/query?...'` is the app's query door, not the
  hostname's. A leading slash is optional and stripped either way, so
  `'query?...'` is the same call. The query string rides along.
- **It acts as the person looking.** The kernel seals a grant naming this store,
  this visitor and their role, good for a minute, and the shim adds it to every
  call the worker makes through `STORE` and `FILES`. So the app's `access`
  decides what your worker can do exactly as it decides what their page can do.
  Reaching past it is `env.APP`, the next section, and it is a deliberate door
  with a rule of its own — not something `env.STORE` will do for you by
  accident. A grant minted for one app's store is refused by any other, and app
  code never sees the grant itself: the shim takes the header off before your
  module is called.

It answers a `Response`, not parsed rows, so read the status yourself:

    let r = await env.STORE.fetch('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entities: [{ doc: { title: 'Lemon cake' } }] }),
    })
    if (!r.ok) return new Response(await r.text(), { status: r.status })

A refusal comes back the way it comes back to a page —
`{"error": {"code": "not_a_writer", "message": "sign in to change this app"}}`
with a 401 or 403 — so passing it straight through gives the page the sentence
it already knows how to show.

The whole filter grammar works here, because it is the same door: `.doc!`,
`.recipe.minutes<=30`, `id=<eid>`, `limit=`, `.count!`, a bare word for full
text. Ask for the components you will use.

## env.APP — the app's graph, as the app itself

    let r = await env.APP.fetch('/query?.household.code=' + hash)

`env.APP.fetch(path, init)` is the same doors at the same addresses as
`env.STORE`, with one difference: it acts as the APP, at `editor`, on the app's
own store. It reads and writes whatever the app's `access` says — `private`
included — and a write through it is signed by the app, so `created.by` is the
app's own entity and not a guest.

It exists for one shape of app: **the worker is the gatekeeper.** `access` is
one word about the whole store, so it cannot say "each household edits its own
row and nobody else's". That rule is code, and code needs a door that is not
already refusing. `env.APP` is that door.

**A private app's worker runs anyway.** `private` sends a stranger to the login
page — but not before your worker has had the request, and not for the calls
your worker makes back through `env.FILES`. So the guest holding an invitation
card reaches your route, and your route can hand them a page. Everything else
about `private` holds: they cannot reach the store doors, and they cannot ask
for a file directly.

Everything true of `env.STORE` is true of this one. It is a path, not a URL. The
grant naming your store is refused by every other store. Your code never sees
it: the kernel mints it per request and the shim keeps it in a closure, so there
is no header a caller can send you that turns into one.

Two things it is not:

- **Not the owner.** An editor writes the app's data and never its roster. A
  batch touching `member`, `grant` or `access` is refused through this door the
  same as any other, so a worker cannot promote anyone, itself included.
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

The route takes the code, hashes it, finds the one row that matches, and touches
only that row:

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
        // THE CHECK COMES FIRST. Nothing below it may run without it.
        if (!code) return new Response('no code', { status: 403 })
        let r = await env.APP.fetch(
          '/query?.household.code=' + await hashed(code) + '&.doc?&limit=1',
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

**This is the one place where your own check IS the permission.** Everywhere
else the store is behind you: you can write a check, forget a case, and the
store still refuses. Through `env.APP` there is nothing behind you. So:

- **The check comes first**, before the first `env.APP` call on that path, with
  nothing between the two.
- **The refusal is 403**, and it says nothing more. Not 404, not "no such
  household", not a different sentence for a wrong code than for a missing one —
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

The same door the web gets, under the app's root. Useful for reading a template,
or for handing a page back yourself with a header of your own. Three things
follow from it being the same door:

- An HTML page comes back **already transformed** — the `<base href>` is in it
  and the reporter script is injected. You are reading what a visitor would have
  received, not the bytes in storage.
- `worker.js`, `vocab.json` and `tools.json` answer 404 here too. The worker
  cannot read its own manifest this way.
- A path with no extension that names no file gets `index.html`, the same
  pretty-path fallback the browser gets.

A request from your worker never re-enters your worker, so
`env.FILES.fetch('/index.html')` is not a loop.

## The rest of env

Every secret you set is on `env` under the name you gave it — `env.WEATHER_KEY`,
`env.STRIPE`. The service binding the platform uses to build `STORE`, `APP` and
`FILES` is there too, as `env.KERNEL`; it is plumbing, it wants absolute URLs
and a grant header it will not give you, and the three doors are what it is for.
Reach for those.

There is nothing else. No KV, no D1, no R2 binding, no environment variables of
your own: the app's graph is its storage.

## Who is asking

The kernel sets three headers on the request it hands you, and strips any a
client tried to send under the same names:

- `x-yak-person` — the visitor's eid. **Absent** when nobody is signed in.
- `x-yak-role` — `owner`, `editor` or `viewer`. Absent when they have no role in
  the space, which includes every signed-out visitor and every signed-in
  stranger.
- `x-yak-app` — the app's own slug, so a worker can spell its own addresses
  without being told its name.

  let person = req.headers.get('x-yak-person') // null for a guest let role =
  req.headers.get('x-yak-role')

What they prove: the kernel wrote them, this request came through the kernel,
and nobody upstream can forge them — a client's own `x-yak-person` is deleted
before your code runs.

What they do not prove:

- **Not permission.** The role is membership in the SPACE. What this visitor may
  do to this app's data is the app's `access` on top of that, and `env.STORE`
  already applies it. Do not write your own check and assume it matches; let the
  store refuse and pass the refusal on.
- **Not an identity you can mail.** An eid is not an address and not a name. No
  address ever reaches app code.
- **Not a session.** The platform's session cookie is stripped on the way in —
  the app is owed this visit and not a credential for every space the person
  belongs to. Other cookies are left alone, so a cookie your own page set is
  still there.

## Secrets

    app_secret_set(app, name: 'WEATHER_KEY', value: '<the key>')
    app_secret_list(app)      → the names, never a value
    app_secret_remove(app, name: 'WEATHER_KEY')

The value goes onto the app's own script and nowhere else. It is not in the
app's data, not in its history, not in any version, and **no tool can read it
back** — `app_secret_list` answers names only, and does so by reading the name
off each row and dropping everything else, so no future API that decided to echo
a value could leak one through it. Ask the person for the value. Never invent
one.

The name is a binding your code spells as `env.NAME`, so it must be a JavaScript
identifier: letters, digits and underscores, not starting with a digit, up to 64
characters. Setting a name that is already there replaces it.

Order matters a little. A secret lives on the script, so there must be a script:
set one before the app has ever deployed a `worker.js` and the refusal says so
and tells you to write one first. `app_secret_list` on an app with no script
answers that it has no secrets rather than failing. Secrets survive later
deploys — the upload keeps them explicitly — so you set a key once and redeploy
as often as you like.

Two things secrets are not:

- Not copied by an install. An installed copy is a new script; its own owner
  sets their own keys. A published app that needs a key should say so in its
  `about` line.
- Not readable by the page. That is the point. If the page needs the answer, the
  worker fetches it and hands back only the part the page needs.

Without the platform's Cloudflare token configured, the three secret tools
refuse outright — there is nowhere to put a value — while a deploy still puts
the app's files out and tells you the worker was not uploaded.

## The limits

Each request runs under **50ms of CPU and 50 subrequests**. The compat date the
script is uploaded with is `2025-05-08`.

50ms is CPU, not wall clock, so the time spent waiting on a fetch is not what
spends it. A store read, an outside call, and shaping the answer fit with room
over. What does not fit is a loop: a fetch per row of a listing will find the
subrequest ceiling, and parsing a large body repeatedly will find the CPU one.
If you need many rows, ask the store for them in one filter — that is one
subrequest whatever it answers.

## When it throws

Let it throw. A break you can see is worth more than a `catch` that hides one,
and nothing is swallowed here:

- **A throw out of your `fetch`** becomes an `exception` entity in the app's own
  store — the request line, the version the app was serving, the message and the
  stack — and the visitor gets the platform's soft "Something went wrong. Your
  assistant has been told." page with a 500.
- **A 5xx you return** is filed the same way, since nobody chose it: the entity
  says `the app's worker answered 503` and names the route.
- **A 4xx you return is not a break** and files nothing. That is your deliberate
  no — "no city by that name", or the 401 an outside service gave you for a
  mistyped key — and the rule is the status, so an outside service's refusal
  passed through does not fill the person's error list.

Either way `app_errors` lists what is open and the person's agent hears about it
once, on its next reply.

The one thing worth catching is an outside call, so you can answer the page
something better than a stack: catch it, and return a 4xx with a sentence.

## Three workers

**One route out of the store.** Everything else falls through to the files:

    export default {
      async fetch(req, env) {
        let url = new URL(req.url)
        if (!url.pathname.endsWith('/titles')) {
          return new Response('not found', { status: 404 })
        }
        let r = await env.STORE.fetch('/query?.recipe!&.doc?')
        if (!r.ok) return new Response(await r.text(), { status: r.status })
        let rows = await r.json()
        return Response.json(rows.map((row) => row.doc.title))
      },
    }

**A paid API with a key.** The key is on the script; the page asks the worker,
never the service. Note the outside failure is answered as a sentence with a 502
— filed, since nobody chose it — while a bad ask from the page is a 400, which
is not:

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

(`ticket` is the app's own component, declared in its `vocab.json` and planted
by `app_deploy`.)

## Putting one in front

A worker is a file, so it is written and released like every other file:

    app_files(app, files: [{path: 'worker.js', content: '<the module>'}])
    app_deploy(app)

The deploy answers
`worker: worker.js answers first; a 404 from it serves
the files` when the
script went up. Delete `worker.js` and the next deploy takes the script away
with it, so what serves is always what the files say. A deploy is also what a
rollback replays: `app_rollback` re-uploads the `worker.js` that version pinned,
so putting an app back puts its code back too.

---

The whole guide: <https://yaks.app/guide.md>
