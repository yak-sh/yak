---
doc:
  title: Visitor Analytics
guide:
  slug: stats
  brief: page view counts for an app, by page, referrer and country
  description: >-
    Visitor analytics for an app: what counts as a visit (a page view), the
    six fields each one records (app, space and slug, path, country, referrer
    hostname, client label) and what is never recorded (no IP address, no
    visitor id or cookie, no user-agent string), the app_stats tool and its
    days window, the Visits page in the app manager, the ./api/stats endpoint
    a page reads its own counts from, sampling, and why a small number is
    usually crawlers.
---

# Visitor Analytics

The guide's index is at <https://yaks.app/docs.md>. This page covers all of
visitor analytics: what is recorded, what is deliberately not recorded, the
three places to read the counts, and how to interpret them.

## What counts as a visit

The platform counts one visit for each **page** it serves for an app. A page is
an HTML response with status 200: `index.html`, a pretty path like `/about`, or
a page rendered by an app's own `worker.js`. These are not pages and are never
counted:

- a stylesheet, a script, an image, a font, a JSON file
- anything under `./api/`: a store read, a write, a socket, an upload
- a redirect, a refusal, a 404
- the platform's own pages: the space's index, a sign-in, the trash

So the count is the number of times someone opened a page, not the number of
requests the app served. A page that fetches its rows twenty times still counts
as one visit.

## Fields recorded with each visit

Each visit records these six fields and nothing else:

- the app the page belongs to
- the space and the app's slug
- the path that was opened
- the country the request came from, as Cloudflare's two-letter country code
- the **hostname** of the site that linked to the app, and no other part of the
  referrer: no path and no query string, so a search term a visitor arrived with
  is dropped before anything is written
- one of three labels for the kind of client: `browser`, `bot` or `agent` (an AI
  assistant fetching the page)

## What is never recorded

- **no IP address**, in any form
- **no visitor id**, no cookie, no session, no fingerprint
- **no user-agent string**: a user-agent string is a fingerprint, so only the
  client label above is derived from it and kept
- nothing that could be joined back to a person, on yaks.app or anywhere else

This is a design choice, not a setting: the data holds no visitor identity, so
no query can produce one. If the person asks "who opened it?" or "did Dana see
it?", tell them that visitor analytics cannot answer that, by design, rather
than looking for another way to find out.

Counts are kept for about three months and then deleted.

## Reading visits with `app_stats`

    app_stats(app: 'recipes')
    app_stats(app: 'recipes', days: 7)

It returns, for the window of days:

- **total** visits, and **daily**: one entry per day, oldest first, including
  days with no visits
- **pages**: the most-opened paths
- **from**: the sites that linked to the app, most visits first
- **countries**: the visitors' countries

`days` defaults to 30 and is capped at 90, which is how far back counts are
kept. Only the app's own people may call it: permission to read a public app's
pages does not include permission to read its visit counts.

## The Visits page and the `./api/stats` endpoint

The **Visits** page in the person's app manager shows each app's total, a daily
chart, and the same three lists.

An app's own page can also read its counts from `./api/stats` when the person
viewing it is a member:

    let seen = await (await fetch('./api/stats')).json()
    if (seen.on) show(seen.total, seen.daily)

Add `?days=7` for a shorter window. When the platform has no analytics reader
configured, it returns `{on: false}` with a message. That is the one case to
handle: show the message, and do not treat it as an error. This endpoint returns
no per-visitor data either: a member reading it gets the same numbers you get.

## Accuracy, sampling and bots

The counts are **approximate by design**. Under load the counter keeps a sample
of visits and records how many visits each kept row represents, and every total
in the report is already scaled back up by that number. A large count is a good
estimate and a small one is exact. Do not present the counts as an exact record.

Bots and AI agents are counted alongside people. A new page with eleven visits
that nobody has been told about has usually been opened by eleven crawlers, so
treat a small number with caution before telling the person it is an audience.

An app with few visits is not broken. Before building a feature to raise the
number, ask the person whether anyone has been given the link. Usually nobody
has, and the fix is to share the link, not to add a feature.

## When to check visits

- the person asks whether anyone is reading the app
- they ask which page is worth working on, or where their readers come from
- they shared the app somewhere and want to know whether people opened it

Do not check visits on every deploy, and do not report them unasked: a count
nobody asked for is noise.

## Related pages

- <https://yaks.app/docs/errors.md> — Errors and Rollback: what broke, and
  rolling back
- <https://yaks.app/docs/sharing.md> — Access, Publishing and Installing: who
  may read an app, and how it is published and installed
- <https://yaks.app/docs/home.md> — Front Page and Routing: which app answers
  which address
