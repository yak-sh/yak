# The front page, and routing the space

A space has one address of its own — `<space>.yaks.app/` — and one app may
answer at it. That app is the space's FRONT PAGE: it is served there rather than
redirected to, and every path in the space no other app claims is its to answer.

So it is the space's router as well as its homepage. By default it routes by
being the fall-through — the app whose name owns a path gets it, and everything
left over comes here. It can also opt in to seeing paths another app owns,
before that app does.

Back to the map: <https://yaks.app/guide.md>

## Which app it is

    app_set(app, home: true)      this app is what <space>.yaks.app/ opens
    app_set(app, home: false)     the space has no front page again

No app becomes the front page by being made first. Until somebody says otherwise
a space has none, and its bare address lists the apps a visitor may open;
`app_list` says which app it is, if any. Only the space owner may move it, since
everyone handed the space itself lands there.

It is a word the app WEARS, `home`, and at most one app in a space wears it.
Moving it takes effect on the next request: nothing is copied, no file moves, no
address is rewritten. What changes is which app answers the bare hostname — and
the front page's own `/<app>/`, which becomes a redirect to it.

That redirect is temporary, not permanent, because the word is a thing the owner
moves. Hand out the bare address; a link somebody already holds to `/<app>/`
still arrives.

**Getting back to the default.** `app_set(app, home: false)` puts the space back
to its default page, and so does deleting the app: the word is on the app, so a
trashed app is nobody's front page and an erased one takes the word with it.
Restoring it makes it the front page again — the word was never removed, only
ignored while it sat in the trash. `app_rollback` puts an earlier version of a
front page back where it went wrong, and setting `home: true` on another app
moves the word there instead. With no front page, `/` is the platform's list of
the space's apps again, a path no app claims is a 404, and a letter to
`<space>@yaks.app` is refused by name — the sender is told to write to
`<space>.<app>@yaks.app`.

## The order a request is answered in

For a request to `<space>.yaks.app<path>` — or to a domain of the person's own,
mounted at its root (<https://yaks.app/guide/domains.md>) — five rungs, the
first that answers winning:

1. **The platform's own paths.** `/login`, `/connect`, `/mcp`, and every app's
   `/api/…` store doors. The kernel answers these and no app routes them.
2. **An app's slug**, which owns the first path segment. `/garden/…` is the
   garden app — its own `worker.js` first where it has one, its files behind
   that. An address the app used to live at redirects here.
3. **The front page's files**, for every path no app claims. `/photo.png` is its
   file and `/about` its page, at the bare hostname.
4. **The space's index** at `/`, when the space has no front page or the front
   page has nothing at `/`. A space that exists is a door, never a 404.
5. **Everything else** goes to the front page's `worker.js` where it has one,
   and is a 404 where it does not.

Rungs 3 and 5 are one ask, and the front page is asked exactly the way rung 2
asks any app: its worker first, its files behind it. A worker answering 404 is
how it PASSES — it owns the routes it names and leaves the pages, stylesheets
and pictures to the platform (<https://yaks.app/guide/code.md>).

So rung 4 is what is left when neither half of the front page has anything at
`/`, and rung 5's 404 is what is left when there is no front page at all.

Rung 2 is the one to hold on to when you are writing the pages: an app's slug
beats the front page at that address. A front page wanting a page at `/garden`
has to be in a space with no app called garden — or say so with `first`.

## Answering first

`first` is the opt-in: the paths the front page's worker sees BEFORE the app
whose name owns them, as globs.

    app_set(app: 'home', first: ['/recipes/*', '/*/print'])

Now `/recipes/lemon` reaches the front page's worker instead of the recipes app,
and so does `/garden/print`. What the worker does with one is its own: a
redirect, a decoration, a page of its own — or a 404, which passes it back down
to the app that owns it, the same pass a worker speaks everywhere else here.

`*` is any run of characters, slashes included. One wildcard, no second
spelling: `/recipes/*` is everything under `/recipes/`, `/*/print` is `/print`
under anything.

The globs are columns of the same word that says which app is home,
`home{first}` — a JSON list in one text column, since a column holds a scalar:

    { "entity": { "eid": "<the app>" },
      "home": { "first": "[\"/recipes/*\", \"/*/print\"]" } }

One word, one spelling: an app is the front page BECAUSE it wears `home`, and
what it routes first is written on the same row. So only a front page can carry
globs at all — `app_set(app, first: [...])` on an app that is not one is
refused, and pass `home: true` with it to make it the front page and route in
one call.

`app_set(app, first: [])` puts every path back where it was, leaving the app the
front page it was. Empty is the ordinary state — a front page is plain files
like any other app until somebody says otherwise — so reach for `first` when the
front page is meant to route the whole space, and not before. Setting
`home: false` takes the word off altogether, globs with it.

## What is never routable

A glob may not name a path the platform answers itself. These, and a glob
overlapping one is refused whole, before anything is written:

    /login      /login/*      /connect      /mcp
    /api/*      /*/api/*      /platform     /platform/*

`/api/*` is there beside `/*/api/*` because the front page is served at the bare
hostname, where its own store door is `/api/…` with no slug in front of it — one
door, two spellings of its address.

The refusal names the glob and the path it collided with, so `/*` is refused for
naming `/login` rather than for being broad. `/recipes/*` is fine even though a
request under it could have gone somewhere else: a glob that merely CONTAINS a
platform path still loses to it at the door.

## Two rules

**It fails open.** The kernel stays the outer router and the front page's worker
is middleware it consults. One that throws, answers 404, or takes longer than a
second is skipped, and the kernel routes as if it were not there — the request
lands on the app that owns it, exactly as it did before anyone wrote a `first`.
A break is recorded as an `exception` on the front page, so `app_errors` lists
it and the person's agent hears about it (<https://yaks.app/guide/errors.md>).

A broken router means the customizations stop applying. It never means the space
is down.

**It acts as the visitor.** The request the front page's worker sends onward
carries the person looking, never the app it is routing to. `env.STORE` there
reads and writes as them, the way it does in any app's worker, so a route may
redirect, decorate or short-circuit — and cannot read a store the visitor could
not have read themselves. Routing is not a way around another app's `access`.

## Mail at the space's own address

`<space>@yaks.app` is the front page's mailbox — the same address every app has,
with the app part left off (`<space>.<app>@yaks.app` is any other one). A letter
written there lands in the FRONT PAGE's store, as the entity every arrival lands
as: `doc` for the subject and the words, `mail` for the envelope, attachments
filed as blobs and hung off it. <https://yaks.app/guide/mail.md> is the whole
shape.

Custom mail behavior for the space is what the front page does about those rows.
A letter is an ordinary write to its store, so anything subscribed sees one
land, and the front page's own code decides what happens next — file it, answer
it, turn it into a row of the app's own. There is no mail router and no hook to
register; the letters are simply in a store you can read.

    subscribe('.mail!&.doc?', triage)

Nothing about the mailbox itself changes here. `mail_list` reads the same rows
back from an agent's side, `mail_send` sends from the same address, and a space
with no front page is told so by name when somebody writes to it, so the sender
knows to write to `<space>.<app>@yaks.app` instead.

## What a front page is not

- **A way to shadow another app.** Rung 2 is the rule; `first` is the exception
  the owner writes down, glob by glob, and it is refused wherever it names the
  platform's own paths.
- **A gateway with more rights than a visitor.** It routes as whoever is
  looking. If they may not read the app the request was going to, neither may
  the route in front of it.
- **Something a space needs.** Most spaces have no front page at all, and their
  bare address lists the apps instead. Make one when there is a homepage to
  make.
