---
name: speed
description: "A page that loads at once (yaks.app). How a page loads its data in one round rather than a waterfall: subscribe to what it draws, every kind in one line with |, ask me() beside it, and wait on a subscription's ready when the rows must come first. How to see a slow page for yourself, its rounds and the Server-Timing on every answer, and what else slows one: chains of module imports, pictures, and work done on every change."
---

# A page that loads at once

A page waits on the network in **rounds**. A round is every request that can
leave at once, to yaks.app and back, each a tenth of a second or so from a good
connection and more from a phone. A request that leaves only once another has
answered is a round of its own. So how long a page takes to show its data is
mostly how many rounds it waits through, not how many requests it makes, and the
page below waits through one.

## One round

The examples are a kitchen app whose `vocab.json` declares a `recipe` and a
`chore` ([querying](./querying.md)):

    <!doctype html>
    <title>Kitchen</title>
    <p id="hello"></p>
    <ul id="list"></ul>
    <script type="module">
      import { me, subscribe } from './api/client.js'

      let list = document.getElementById('list')
      let hello = document.getElementById('hello')

      // Everything the page draws, in one line, kept live.
      subscribe('(.recipe|.chore)&?doc', (rows) => {
        list.replaceChildren(...rows.map((row) => {
          let li = document.createElement('li')
          li.textContent = (row.recipe ? 'Cook: ' : 'Do: ') + row.doc.title
          return li
        }))
      })

      // Who is looking, asked at the same moment, not first.
      let who = await me()
      hello.textContent = who.person ? `Hello, ${who.name}.` : 'Reading only.'
    </script>

Both requests leave as soon as the script runs, and the list is drawn when the
first answer comes back. Three habits make it so.

**Subscribe to what you draw, rather than querying it first.** A subscription's
first rows come over the page's own connection while its socket opens, so one
`subscribe` is both the load and the live view. A `query` of the same line ahead
of it asks the store twice, and the second ask waits for the first. When the
page needs its rows before it can go on, it waits on the subscription itself:
`ready` is the first rows its callback is handed.

    let chores = subscribe('.chore&?doc', draw)
    let [who, rows] = await Promise.all([me(), chores.ready])

**Every kind in one line.** `|` is "or", so `(.recipe|.chore)&?doc` answers
recipes and chores together, each row carrying its own components, and
`row.recipe` says which one it is. Seven kinds asked one at a time are seven
requests and seven subscriptions on the socket, which keeps only about 2 KB of
them ([the store](./store.md)); in one line they are one of each.

**`me()` beside your reads, never ahead of them.** A read does not wait to learn
who is looking: the store answers each person with what the app lets them read.
`let who = await me()` at the top of the script holds back every read below it
by a round. Only a read that names the person, such as their own rows by
`created.by`, has to wait for the answer; anything else that does not depend on
another read goes out together, in one `Promise.all`, never one `await` after
another.

## Seeing a slow page

Count before you guess. Paste this into the browser's console on the page:

    console.table(performance.getEntriesByType('resource').map((r) => ({
      what: r.name.split('/').slice(-2).join('/'),
      start: Math.round(r.startTime),
      ms: Math.round(r.duration),
      server: r.serverTiming.map((t) => `${t.name}=${t.duration}`).join(' '),
    })))

Requests whose `start` is about the same are one round. One that starts near
where another ended was waiting on it, and that is the round to remove. The page
above shows the client's module, then `me` and one `query` starting together.

`server` is the `Server-Timing` every answer from yaks.app carries, which the
network panel also draws under each request's Timing. `gateway` is the whole
time the request spent at yaks.app, so whatever is left of `ms` was the trip
there and back. `cold` means a fresh copy of the platform started to answer it.
`hops` is a count rather than milliseconds: the trips the answer made to the
app's store, so one read that costs several is the one to look at. Each `*_wait`
is time spent waiting on one service. From a shell, a public app's answer shows
the same header:

    curl -sD - -o /dev/null \
      'https://<space>.yaks.app/<app>/api/query?.recipe&?doc' |
      grep -i server-timing

## Beyond the data

**Chains of modules.** The browser learns what a module imports only once that
module arrives, so on a first visit each level of imports is a round before any
of your code runs. Import `./api/client.js` statically from the page's own
script, never through `await import()`, which waits until the module asking for
it has run. A page made of several modules names each in its head, and the
browser fetches them all beside the page:

    <link rel="modulepreload" href="./main.js">
    <link rel="modulepreload" href="./view.js">

**Pictures.** Give each `<img>` its `width` and `height`, which `upload` answers
and the picture's `image` row keeps ([files](./files.md)), so the page does not
jump as each one arrives, and `loading="lazy"` once it is below the first
screen. Every `./api/blob/<eid>` is a redirect the browser asks again on each
load before it reaches the bytes, so lazy pictures are what keep a page of fifty
from asking fifty times when only six are in view. On a `public` or `open` app
the browser keeps the bytes themselves; on a `private` one it fetches them again
too. And downscale a photo before it is uploaded, since a phone's are several
megabytes.

**Work on every change.** A subscription hands over its whole set on every
change, from any tab, phone or agent, so its callback runs often. Keep it to
drawing: a `query` inside it is a request every time anything changes, and
`innerHTML +=` in a loop parses the whole list again for every row, where one
`replaceChildren` builds it once. Ask for what you draw, too: a row carries the
components its line names, so `?doc` for a list of titles rather than `*`, and
`limit=50` for the newest fifty rather than all of them.

The whole guide, everything else an app can do, is at
<https://yaks.app/docs.md>.
