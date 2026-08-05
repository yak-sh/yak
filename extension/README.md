# The browser extension

File a task about the page you are on, see what already references it, and
archive the page as you are seeing it.

## Load it

Chrome (or any Chromium): `chrome://extensions` → **Developer mode** on → **Load
unpacked** → this directory. There is no build step; the files here are what
runs.

By default it talks to `http://127.0.0.1:5173`. To point it elsewhere, open the
popup, expand **server**, type the origin and save — saving asks for that host's
permission, which is why it happens on a click.

## What it does

- **The badge** counts what references the current page. It comes from
  `GET /query?.web.url=<url>&kind=web&backlinks=1` — the generic read door, not
  a route of our own.
- **The box** is the board's quick-add: a plain line files a task
  (`P1 .domain=Eng Ship it` parses), a line opening with `:` runs that verb
  (`:fix` files and starts an agent on it). Enter files, Shift+Enter starts a
  body, Escape closes.
- **capture the page** posts the DOM the tab is showing — after login, after
  JavaScript — which is archived server-side (scrubbed, then stamped
  `frozen_at`). The choice is remembered per site.
- Everything lands in one `POST /page`: the page's entity, the task, and an
  `about` edge from the task to the page.

## What it deliberately does not do

- **It does not normalize the URL.** The address goes over raw both when filing
  and when asking, and the `url` PropType canonicalizes it server-side
  (`src/url.ts`). Two spellings of one page must not be able to disagree, and
  the only way to guarantee that is to have one implementation.
- **It does not parse the `:` line.** Same reason: `src/commands.ts` is the
  vocabulary, for every door.
- Screenshots stay deferred, with the R2 story (T-3696).
