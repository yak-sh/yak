# Who visited

The map is at <https://yaks.app/guide.md>. This page is the whole of visitor
counts: what is recorded, what deliberately is not, the three places you can
read it, and what the numbers do and do not mean.

## What is counted

One count per **page** the platform answers for an app. A page is HTML that came
back 200 — `index.html`, a pretty path like `/about`, a page an app's own
`worker.js` rendered. These are not pages and are never counted:

- a stylesheet, a script, an image, a font, a JSON file
- anything under `./api/` — a store read, a write, a socket, an upload
- a redirect, a refusal, a 404
- the platform's own pages: the space's front door, a sign-in, the trash

So the number is "how many times somebody opened something", not "how many
requests the app served". An app whose page fetches its rows twenty times still
counts one visit.

## What is recorded with it

Six things, and this list is the whole of it:

- the app it was a page of
- the space and the app's slug
- the path that was opened
- the country the request came from, as Cloudflare's own two letters
- the **host** of the site that linked them here, and nothing else of the
  referrer — no path, no query, so a search term somebody arrived on is gone
  before it is written down
- one of three words for the kind of client: `browser`, `bot` or `agent` (an AI
  assistant fetching the page)

## What is never recorded

- **no IP address**, ever, in any form
- **no visitor id**, no cookie, no session, no fingerprint
- **not the user-agent string** — a UA is a fingerprint, and only the one word
  above survives it
- nothing that could be joined back to a person, here or anywhere else

That is a design choice, not a setting: there is no visitor identity in the
data, so no query can produce one. If the person asks "who opened it?" or "did
Dana see it?", the honest answer is that this cannot say, and that is on purpose
— tell them so rather than reaching for something else.

Counts are kept for about three months and then gone.

## Reading it: the tool

    app_stats(app: 'recipes')
    app_stats(app: 'recipes', days: 7)

It answers, for the window:

- **total** visits, and **daily** — one entry per day, oldest first, including
  the days nobody came
- **pages** — the most-opened paths
- **from** — the sites that linked here, busiest first
- **countries** — where the visitors were

`days` defaults to 30 and is clamped to 90, which is as far back as anything is
kept. Only the app's own people may ask: being able to read a public app's pages
is not being able to read its numbers.

## Reading it: the page, and the door

The person sees the same thing without you. Their space's front page carries a
**Who visited** block — a bar per day, then the three lists — for every app they
have. Nothing there is a script; it is a chart drawn as markup.

And the app's own page can read its numbers, for a member:

    let seen = await (await fetch('./api/stats')).json()
    if (seen.on) show(seen.total, seen.daily)

Add `?days=7` for a shorter window. It answers `{on: false}` with a sentence
when the platform has no analytics reader configured, which is the one thing to
handle: say the sentence, do not treat it as a failure. Nothing about this door
is per-visitor either — a member reading it learns exactly what you learn.

## What the numbers mean, and do not

They are **approximate on purpose**. Under load the counter keeps a sample and
records how many each kept row stands for, and every total here is already
multiplied back out — so a big number is a good estimate and a small one is
exact. Do not present them as a ledger.

Bots and AI agents are counted alongside people. A brand-new page with eleven
visits and nobody who has been told about it is usually eleven crawlers, so read
a small number carefully before telling the person it is an audience.

And a quiet app is not a broken one. Before building something to chase the
number, ask the person whether anyone has been given the link — most of the time
the answer is no, and the fix is a link, not a feature.

## When to reach for it

- they ask whether anyone is reading the thing
- they ask which page is worth working on, or where their readers come from
- something was shared somewhere and they want to know whether it landed

Not on every deploy, and not unasked. A count nobody wanted is noise.

## Nearby

- <https://yaks.app/guide/errors.md> — what broke, and rolling back
- <https://yaks.app/guide/sharing.md> — who may read an app, and how one travels
- <https://yaks.app/guide/home.md> — which app answers which address
