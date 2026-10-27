---
doc:
  title: Front Page and Routing
guide:
  slug: home
  brief: the app at a space's root address, and how a space routes requests
  description: >-
    The front page (homepage) app served at <space>.yaks.app/ and how requests
    in a space are routed: app_set home, the five-step routing order, the first
    globs that send another app's paths to the front page's worker, the
    reserved platform paths, fail-open routing, changing a space's address with
    space_set, reserved names, and email sent to <space>@yaks.app.
---

# Front Page and Routing

A space has one address of its own, `<space>.yaks.app/`, and one app can be
served there. That app is the space's _front page_: it is served at that address
(not redirected to), and it also answers every path in the space that no other
app claims.

So the front page is the space's router as well as its homepage. By default it
is the fallback: a path whose first segment is an app's slug goes to that app,
and every other path goes to the front page. It can also opt in to receiving
paths another app owns, before that app does.

Back to the map: <https://yaks.app/docs.md>

## Choosing the front page

    app_set(app, home: true)      this app is what <space>.yaks.app/ opens
    app_set(app, home: false)     the space has no front page again

No app becomes the front page automatically, not even the first one created.
Until someone sets one, a space has no front page, and its bare address lists
the apps a visitor may open; `app_list` reports which app is the front page, if
any. Only the space owner may change it, since everyone given the space's
address lands there.

**Managing your apps.** <https://yaks.app/manage> opens your account's app
library and the pages beside it: assistant setup, connections, settings,
billing, and trash. It shows your own space; `?space=<space>` names another you
own. It is served at the platform's address, not a space's, so no app, front
page or not, can replace it.

The front page is marked by a component stored on the app, `home`, and at most
one app in a space has it. Moving it takes effect on the next request: nothing
is copied, no file moves, no address is rewritten. What changes is which app
answers the bare hostname, and the front page's own `/<app>/` path, which
becomes a redirect to the bare hostname.

That redirect is temporary, not permanent, because the owner can move `home` to
another app at any time. Share the bare address; an existing link to `/<app>/`
still works.

**Removing the front page.** `app_set(app, home: false)` returns the space to
its default page, and so does deleting the app: `home` is stored on the app, so
a trashed app is not the front page and an erased one takes `home` with it.
Restoring the app makes it the front page again: `home` was never removed, only
ignored while the app was in the trash. `app_rollback` restores an earlier
version of a front page that broke, and setting `home: true` on another app
moves `home` there instead. With no front page, `/` is the platform's list of
the space's apps again, a path no app claims is a 404, and an email to
`<space>@yaks.app` is refused with a message telling the sender to write to
`<space>.<app>@yaks.app`.

## Request routing order

This applies to a request to `<space>.yaks.app<path>`, and to a request to a
custom domain, which goes through the same five steps whether the domain serves
the space or one app at its root (<https://yaks.app/docs/domains.md>). The first
step that answers handles the request:

1. **The platform's own paths.** Every app's store endpoints, `/<app>/api/…`,
   and the front page's, `/api/…`; `/_yaks` and every path under it, where a
   service's webhooks arrive; `/<app>.git/…`, the address `git clone` uses;
   `POST /deploy`, a zip dropped on the space's page; and, on a
   `<space>.yaks.app` hostname, `/.well-known/…`, where nothing is served. The
   platform answers these and no app routes them.
2. **An app's slug**, which owns the first path segment. `/garden/…` goes to the
   garden app: its own `worker.js` first, if it has one, then its files. An
   address the app used to have redirects to it. The exception is a path the
   front page names in its `first` globs, which the front page's `worker.js`
   receives before the app does (see `first` below).
3. **The front page, for every path no app claims**, at the bare hostname: its
   `worker.js` first, if it has one, then its files. `/photo.png` serves its
   file and `/about` its page.
4. **The space's index at `/`**, the list of the space's apps the visitor may
   open, when the space has no front page, or when the front page answers `/`
   with a 404 because its worker passes and it has no `index.html`. A space that
   exists always answers `/` with a page, never a 404.
5. **Every other path is a missing page.** With no front page, a path no app
   claims is a 404. With a front page, a path its worker passes on and none of
   its files matches is answered the way any app answers an address with no
   file: by default its `404.html` with status 404, else its `index.html` for a
   route, and a 404 for a missing file with an extension ("Page URLs and 404
   handling", <https://yaks.app/docs/files.md>).

A worker passes a request on by returning 404, so it answers the routes it
handles and leaves the pages, stylesheets and images to the platform
(<https://yaks.app/docs/code.md>). The front page's worker is asked before its
files, so it receives every path in step 3, including the paths its files have.

`/login`, `/connect` and `/mcp` are the platform's at `yaks.app` itself. On a
space's hostname no app claims them, so the front page answers them (step 3),
and a `first` glob may not name them (see Reserved platform paths).

Remember step 2 when writing the front page: an app's slug takes precedence over
the front page at that path. A front page that wants a page at `/garden` has to
be in a space with no app called garden, or claim the path with `first`.

## Routing other apps' paths to the front page: `first`

`first` is a list of globs: the paths the front page's worker receives before
the app whose slug owns them. It is off until the owner sets it.

    app_set(app: 'home', first: ['/recipes/*', '/*/print'])

With that setting, `/recipes/lemon` goes to the front page's worker instead of
the recipes app, and so does `/garden/print`. The worker decides what to do with
such a request: redirect it, decorate it, serve a page of its own, or return
404, which passes the request on to the app that owns it, as a 404 from a worker
does everywhere else on yaks.app.

`*` matches any sequence of characters, including slashes. It is the only
wildcard, and there is no other pattern syntax: `/recipes/*` matches everything
under `/recipes/`, and `/*/print` matches `/print` under any path.

The globs are stored in a property of the same `home` component that marks the
front page, `home{first}`: a JSON list in one text property, since a property
holds a single value:

    { "entity": { "eid": "<the app>" },
      "home": { "first": "[\"/recipes/*\", \"/*/print\"]" } }

An app is the front page _because_ it has `home`, and its `first` globs are
stored in the same component. So only a front page can have globs:
`app_set(app, first: [...])` on an app that is not the front page is refused,
and passing `home: true` in the same call makes the app the front page and sets
its routing at once.

`app_set(app, first: [])` routes every path back to its default, and the app
stays the front page. Empty is the default state: a front page is plain files
like any other app until someone changes that. Use `first` only when the front
page is meant to route the whole space. Setting `home: false` removes the `home`
component entirely, including its globs.

## Reserved platform paths

A glob may not name a reserved path. A glob that overlaps one is refused, along
with the whole call, before anything is written. These are the reserved paths:

    /login      /login/*      /connect      /mcp        /deploy
    /_yaks      /_yaks/*
    /api/*      /*/api/*      /platform     /platform/*

On a space's hostname the platform answers some of them itself, ahead of every
app (step 1 of the routing order):

- `/api/*` and `/*/api/*`, the store endpoints. `/api/*` is listed beside
  `/*/api/*` because the front page is served at the bare hostname, where its
  own store endpoints are `/api/…` with no slug in front of them: the same
  endpoints, at two addresses.
- `/_yaks` and every path under it, where a service's webhooks arrive.
- `POST /deploy`, a zip dropped on the space's page. A request to `/deploy` with
  any other method goes to the app named `deploy`, or to the front page.

The others are reserved, but the platform does not answer them on a space's
hostname:

- `/login`, `/login/*`, `/connect` and `/mcp` are the platform's sign-in pages,
  connector page and MCP endpoint at `yaks.app` itself. On a space's hostname no
  app claims them, so the front page answers them (step 3).
- `/platform` and `/platform/*` are the path of the app that holds yaks.app's
  own directory, in the platform's own space, where nothing is served.

The refusal names the glob and the reserved path it overlaps, so `/*` is refused
because it covers `/login`, not because it is broad. `/recipes/*` is accepted
even though some paths under it are reserved, such as `/recipes/api/query`. The
front page's worker is never asked first about a reserved path, so a request to
one goes where it would go with no `first`.

## Fail-open routing and visitor permissions

**Routing through `first` fails open.** The platform remains the outer router.
On a path named in `first`, the front page's worker is middleware the platform
calls before the app that owns the path. A worker there that throws, returns
404, or takes longer than one second is skipped, and the platform routes the
request as if the worker were not there: the request goes to the app that owns
it, exactly as it would with no `first`. A 5xx answer is not skipped: the
visitor receives it. A failure is recorded as an `exception` on the front page,
so `app_errors` lists it and the person's agent is notified
(<https://yaks.app/docs/errors.md>).

When the front page's worker breaks, its `first` routing stops applying, and the
apps that own those paths serve them as usual.

**The front page's own paths do not fail open.** On a path no app claims (step 3
of the routing order), the front page's worker runs the way any app's worker
runs on that app's own paths. A worker that throws there ends the request with a
500 error page, and the throw is recorded the same way. A 404 from the worker
still passes the request on to the front page's files. The one-second limit
applies only on paths named in `first`.

**The worker acts as the visitor.** A request the front page's worker forwards
carries the visitor's identity, never the identity of the app it routes to.
`env.STORE` there reads and writes as the visitor, as it does in any app's
worker, so a route may redirect, decorate or short-circuit a request, and cannot
read a store the visitor could not read themselves. Routing does not bypass
another app's `access`.

## Changing the space's address

    space_set(slug: 'ada-cooks')     the space is now ada-cooks.yaks.app
    space_set(title: 'Ada cooks')    changes only the space's display name

A title, of a space or an app, is its display name: one line, up to 80
characters. A newline in a title is converted to a space, and a longer title is
refused with its character count.

Only the space's owner may change the address, at any time, with `space_set` or
from the address card on the space's settings page. Every app in the space moves
with the address, with its files and data, and each keeps its path, so
`ada.yaks.app/cookbook/` becomes `ada-cooks.yaks.app/cookbook/`.

**The old address keeps working until another space takes it.** It redirects to
the new address with the path and the query string kept, so a link somebody was
given a year ago still opens the same page. Email to `<old>.<app>@yaks.app` is
still delivered, and so are webhooks and `git` fetches sent to the old address.
The old name is available to other spaces as soon as the space leaves it: if
another space takes it, everything sent to it reaches that space from then on.
Tell the people who use the old address about the new one.

    space_set(forget: 'ada')         the old address stops redirecting now

`forget` is the only part of a move that breaks something immediately: every
link and every email still sent to that address stops reaching anything. Only
use it when the person has said they no longer need the old address.

`app_set(app, slug)` does the same for one app's path within the space.

A few names are reserved for yaks.app itself, because at `<slug>.yaks.app` or
`<slug>@yaks.app` they would look like addresses of the platform: `login`,
`support`, `security`, `billing`, `status`, `admin`, `www`, `mail`, `docs`,
`api` and similar names. `space_new`, `space_set`, `app_new`, `app_set` and
`app_install` refuse one with a message saying so, and signing in as `support@…`
gives the space `support2`.

A move never changes the app's data (its store is named for the app, not for the
address), any custom domain attached to the space or one of its apps, the
members, what is published, or what the stats have counted.

## Email to the space's address

`<space>@yaks.app` is the front page's email address: the same form of address
every app has, without the app part (any other app's is
`<space>.<app>@yaks.app`). An email sent there is stored in the front page's
store as the same entity every incoming email becomes: `doc` for the subject and
the text, `mail` for the envelope, and attachments stored as blobs and linked to
it. <https://yaks.app/docs/mail.md> describes the whole shape.

Custom email handling for the space is whatever the front page's code does with
those rows. An incoming email is an ordinary write to its store, so any
subscription sees it arrive, and the front page's own code decides what happens
next: file it, reply to it, or turn it into a row of the app's own. There is no
mail router and no hook to register; the emails are rows in a store you can
read.

    subscribe('.mail&?doc', triage)

The front page's mailbox works the same as any app's. `mail_list` reads the same
rows from an agent's side, `store_mail_send` sends from the same address, and
when somebody emails a space with no front page, the refusal names the space so
the sender knows to write to `<space>.<app>@yaks.app` instead.

## What a front page does not do

- **It does not take over another app's paths by default.** Step 2 is the rule;
  `first` is the exception the owner sets explicitly, glob by glob, and it is
  refused wherever it names a reserved path.
- **It has no more rights than the visitor.** It routes as the visitor. If the
  visitor may not read the app the request was going to, neither may the front
  page's route.
- **It is not required.** Most spaces have no front page at all, and their bare
  address lists the apps instead. Set one when the space needs a homepage.
