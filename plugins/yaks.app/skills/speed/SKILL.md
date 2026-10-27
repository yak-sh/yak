---
name: speed
description: "Performance (yaks.app). Frontend performance for a yaks app: loading a page's data in one round trip instead of a request waterfall by subscribing to what it renders, querying every kind of row in one line with |, calling me() in parallel with the reads, and awaiting subscribe(...).ready when the rows must come first. Measuring a slow page with the browser's resource timings and the Server-Timing header on every response (gateway, cold, hops), and other causes of slowness: module import chains and modulepreload, images, and work done in a subscribe callback on every change."
---

# Performance

A page waits on the network in **round trips**. A round trip is the set of
requests that can be sent at the same time, to yaks.app and back, each taking
about a tenth of a second on a good connection and longer on a phone. A request
that is sent only after another one has answered starts a round trip of its own.
The time a page takes to show its data depends mostly on how many round trips it
waits through, not on how many requests it makes. The page below waits through
one.

## Loading data in one round trip

The examples are a kitchen app whose `vocab.json` declares a `recipe` and a
`chore` ([Query Syntax](./querying.md)):

    <!doctype html>
    <title>Kitchen</title>
    <p id="hello"></p>
    <ul id="list"></ul>
    <script type="module">
      import { me, subscribe } from './api/client.js'

      let list = document.getElementById('list')
      let hello = document.getElementById('hello')

      // Everything the page draws, in one query line, kept live.
      subscribe('(.recipe|.chore)&?doc', (rows) => {
        list.replaceChildren(...rows.map((row) => {
          let li = document.createElement('li')
          li.textContent = (row.recipe ? 'Cook: ' : 'Do: ') + row.doc.title
          return li
        }))
      })

      // Who is looking, requested at the same time as the rows, not before.
      let who = await me()
      hello.textContent = who.person ? `Hello, ${who.name}.` : 'Reading only.'
    </script>

Both requests are sent as soon as the script runs, and the list is drawn when
the first response comes back. The page does this with three practices.

**Subscribe to what you draw instead of querying it first.** A subscription's
first rows arrive over the connection the page already has while its socket
opens, so one `subscribe` call both loads the rows and keeps them live. A
`query` of the same line before it asks the store twice, and the second request
waits for the first. When the page needs its rows before it can continue, it
awaits the subscription's `ready`, which resolves to the first rows its callback
receives.

    let chores = subscribe('.chore&?doc', draw)
    let [who, rows] = await Promise.all([me(), chores.ready])

**Query every kind of row in one line.** `|` means "or", so
`(.recipe|.chore)&?doc` returns recipes and chores together. Each row carries
its own components, and `row.recipe` tells you which kind it is. Seven kinds
queried one at a time make seven requests and seven subscriptions on the socket,
which holds only about 2 KB of subscription declarations
([Frontend Data](./store.md)). In one line they make one request and one
subscription.

**Call `me()` in parallel with your reads, not before them.** A read does not
need to know who is looking: the store answers each person with the rows the app
lets them read. `let who = await me()` at the top of the script delays every
read below it by one round trip. Only a read that names the person, such as a
query for their own rows by `created.by`, has to wait for the answer. Send every
other read that does not depend on another read together, in one `Promise.all`,
not one `await` after another.

## Measuring request timing

Measure the page's requests before guessing at the cause. Paste this into the
browser's console on the page:

    console.table(performance.getEntriesByType('resource').map((r) => ({
      what: r.name.split('/').slice(-2).join('/'),
      start: Math.round(r.startTime),
      ms: Math.round(r.duration),
      server: r.serverTiming.map((t) => `${t.name}=${t.duration}`).join(' '),
    })))

Requests with about the same `start` are in one round trip. A request that
starts near where another one ended was waiting on it, and that is the round
trip to remove. For the page above, the table shows the client's module, then
`me` and one `query` starting together.

`server` is the `Server-Timing` header that every response from yaks.app
carries; the browser's network panel also shows it under each request's Timing.
`gateway` is the total time the request spent at yaks.app, so the rest of `ms`
is the network time to yaks.app and back. `cold` means the request was the first
one answered by a newly started instance of the platform. `hops` is a count, not
milliseconds: the number of trips made to the app's store to answer the request,
so a single read with several hops is the one to investigate. Each `*_wait` is
the time spent waiting on one service. From a shell, a public app's response
carries the same header:

    curl -sD - -o /dev/null \
      'https://<space>.yaks.app/<app>/api/query?.recipe&?doc' |
      grep -i server-timing

## Other causes of a slow page

**Module import chains.** The browser learns what a module imports only after
that module arrives, so on a first visit each level of imports adds a round trip
before any of your code runs. Import `./api/client.js` with a static `import`
from the page's own script, not with `await import()`, which does not start
until the module that calls it has run. A page made of several modules lists
each one in its `<head>`, so the browser fetches them all in parallel with the
page:

    <link rel="modulepreload" href="./main.js">
    <link rel="modulepreload" href="./view.js">

**Images.** Give each `<img>` its `width` and `height`, which `upload` returns
and the image's `image` row keeps ([Files and Uploads](./files.md)), so the
layout does not shift as each image arrives. Add `loading="lazy"` to images
below the first screen. Every `./api/blob/<eid>` is a redirect that the browser
requests again on each page load before it fetches the bytes, so with lazy
loading a page of fifty images with six in view makes six of those requests, not
fifty. On a `public` or `open` app the browser caches the bytes; on a `private`
app it fetches the bytes again too. Downscale a photo before it is uploaded: a
phone's photos are several megabytes.

**Work done on every change.** A subscription passes its whole result set to its
callback on every change, from any tab, phone or agent, so the callback runs
often. Keep the callback to drawing: a `query` inside it sends a request every
time anything changes, and `innerHTML +=` in a loop parses the whole list again
for every row, where one `replaceChildren` builds it once. Request only what you
draw: a row carries the components its query line names, so use `?doc` for a
list of titles rather than `*`, and `limit=50` for the newest fifty rather than
all of them.

The full guide, with everything else an app can do, is at
<https://yaks.app/docs.md>.
