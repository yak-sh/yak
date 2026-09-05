# Saving a page from another site

Somebody is reading something on somebody else's website — a recipe, a flat to
rent, a paper, a jacket — and wants it in their app. This page is how that is
built with what the platform has today: a route on the app's own `worker.js`
that fetches the address and reads what the page says about itself, and a link
on their bookmarks bar that starts it.

It is the same shape whatever they are saving. Recipes are the worked example at
the end because a recipe page says more about itself than most, so it shows
every rung; the first half is what you write for anything.

## Why the app fetches it, and the other page does not send it

The obvious design — a button on the other site that posts into the app — is not
one you can build here yet, and it is worth knowing why before you try.

An app's doors under `./api/` take **same-origin, cookie-carrying requests**.
The person's sign-in cookie is `SameSite=Lax` and the kernel checks the
browser's own `Origin` against the address it was asked at, so a script running
on `some-recipe-site.example` cannot `apply` into their app — with or without
their cookie, the write is refused. The one door open to another page is
`./api/query`, answered as a stranger with the credentials taken off: a read,
never a write.

So the bookmarklet **launches** rather than posts. It hands the app the address
of the page they are on, and the app — which is signed in, because it is their
own tab on their own site — does the reading and the writing. That is the whole
trick, and it is why the flow is: press the button, land in the app, see what
was saved.

Do not build around a token or an extension. Neither exists here today, and a
page that tells the person to paste an API key somewhere is a page teaching them
a bad habit for a door that is closed anyway.

## What a page says about itself

Almost every page carries a machine-readable description of itself, and there
are three rungs. Take the highest one the page offers.

**1. JSON-LD** — a `<script type="application/ld+json">` block holding
schema.org objects. This is the good one: a recipe arrives with its ingredients
in a list, an article with its author and date, a product with its price. Most
publishing software emits it without anyone asking.

**2. Open Graph and meta tags** — `og:title`, `og:description`, `og:image`,
`og:site_name`, `article:published_time`, and plain `<meta name=description>`.
Nearly universal, because it is what a link preview in a chat app reads. It
gives you a title, a sentence and a picture, and nothing structured.

**3. The `<title>` and the words on the page.** The floor. You always have the
address and usually the title, and that alone is worth saving — a link with a
name is better than a link.

Write all three. A clipper that only understands JSON-LD works on the sites that
have it and silently does nothing on the rest, which the person experiences as
"it's broken".

## Reading a page, in one pass

`HTMLRewriter` is in the Workers runtime, so there is no parser to install. It
streams, which is what keeps a page with a megabyte of advertising inside the
worker's 50ms of CPU — a regex over the whole body does not.

    // Everything a page says about itself, from one read of it.
    let read = async (res) => {
      let ld = [], meta = {}, title = '', chunk = ''
      await new HTMLRewriter()
        .on('script[type="application/ld+json"]', {
          text(t) {
            chunk += t.text
            if (t.lastInTextNode) { ld.push(chunk); chunk = '' }
          },
        })
        .on('meta', {
          element(e) {
            let key = e.getAttribute('property') || e.getAttribute('name')
            let val = e.getAttribute('content')
            if (key && val && !meta[key]) meta[key] = val
          },
        })
        .on('title', { text(t) { title += t.text } })
        .transform(res)
        .arrayBuffer()
      return { ld, meta, title: title.trim() }
    }

A text node arrives in chunks, so `lastInTextNode` is what tells you a script
block has ended; without it, a long JSON-LD block comes out cut in half. And
`.arrayBuffer()` at the end is not there for the bytes — it is what pulls the
body through the rewriter, so the handlers run.

Two small helpers make the JSON-LD workable. A document may be one object, a
list of them, or a `@graph` wrapping the list; and any value in it may be a
string, an object, or a list of either.

    // Every object the page's JSON-LD holds, flattened.
    let things = (blocks) => {
      let out = []
      for (let text of blocks) {
        let doc
        try { doc = JSON.parse(text) } catch { continue }
        for (let node of [].concat(doc)) {
          out.push(node, ...[].concat(node['@graph'] ?? []))
        }
      }
      return out.filter((n) => n && typeof n == 'object')
    }

    // The first thing in a value that reads as words.
    let str = (v) =>
      typeof v == 'string' ? v.trim()
      : Array.isArray(v) ? str(v[0])
      : v && typeof v == 'object' ? str(v.text ?? v.name ?? v.url)
      : ''

    // The first thing in a value that reads as an address.
    let src = (v) =>
      typeof v == 'string' ? v.trim()
      : Array.isArray(v) ? src(v[0])
      : v && typeof v == 'object' ? src(v.url ?? v.contentUrl)
      : ''

    let typed = (node, want) =>
      [].concat(node['@type'] ?? []).includes(want)

`try { } catch { continue }` earns its place: a good many sites ship JSON-LD
with a trailing comma or a raw newline in a string, and one bad block must not
lose you the page.

## What to save

Whatever else the app keeps, keep **where it came from**. That is a component of
its own, in the app's `vocab.json`:

    { "source": { "url": "url", "at": "time" } }

Two columns, because they are two facts: the address the words came from, and
when this app took its copy. `source.url` is what tells a page where to send
somebody who wants the original, and `.source!` is the filter for everything
clipped rather than typed.

**The same address clipped twice should be one row.** The cheapest way is to
make the entity's own eid the address's hash — an eid you mint yourself defines
the entity the first time and patches it every time after, so nothing has to be
looked up and nothing can be saved twice:

    // The row this address gets, forever.
    let idOf = async (key) => {
      let bytes = await crypto.subtle.digest(
        'SHA-256', new TextEncoder().encode(key))
      return [...new Uint8Array(bytes)]
        .map((b) => b.toString(16).padStart(2, '0')).join('')
    }

    let eid = await idOf('clip:' + from)

The other way is to ask first — `query('.source.url="' + from + '"')`, quoted
because an address is full of `&` — and patch what comes back. It costs a
subrequest and it lets two clips at once make two rows, so prefer the hash.

## A worker that clips anything

Here is the generic half, whole. It fetches, reads the three rungs, and writes
one bundle:

    export default {
      async fetch(req, env) {
        let url = new URL(req.url)
        if (!url.pathname.endsWith('/clip')) {
          return new Response('not found', { status: 404 })
        }
        let from = url.searchParams.get('url') ?? ''
        let told = url.searchParams.get('title') ?? ''
        if (!/^https?:\/\//.test(from)) {
          return Response.json({ error: 'that is not a web address' },
            { status: 400 })
        }

        let got = await fetch(from, {
          headers: { 'user-agent': 'yaks.app clipper', accept: 'text/html' },
        })
        // A site that will not answer a robot is not this app breaking, so
        // save what the browser already told us and say so. (Answering 5xx
        // would file an exception in the person's app every time.)
        let page = got.ok
          ? await read(got)
          : { ld: [], meta: {}, title: told }

        let ld = things(page.ld)[0] ?? {}
        let m = page.meta
        let title = str(ld.name ?? ld.headline) || m['og:title'] ||
          page.title || told || from
        let body = str(ld.description) || m['og:description'] ||
          m.description || ''

        let eid = await idOf('clip:' + from)
        let saved = await env.STORE.fetch('/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entities: [{
              entity: { eid },
              doc: { title, body },
              source: { url: from, at: new Date().toISOString() },
            }],
          }),
        })
        if (!saved.ok) {
          return new Response(await saved.text(), { status: saved.status })
        }
        return Response.json({ eid, title, thin: !got.ok })
      },
    }

The status on a refusing site is the line worth reading twice. A 5xx out of a
worker is filed as a break in the person's app and reported to their agent; a
site that blocks robots is not a break, it is Tuesday. So the route answers 200
with `thin: true`, the clip page says what happened, and the person keeps the
link.

## The recipe example

A recipe page's JSON-LD is a schema.org `Recipe`, and the fields worth taking
are `name`, `recipeIngredient`, `recipeInstructions`, `recipeYield`, `totalTime`
and `image`. The app declares what it will filter on:

    { "recipe": { "serves": "number", "minutes": "number", "image": "text" },
      "source": { "url": "url", "at": "time" } }

The ingredients and the method go in `doc.body`, as markdown. That is the
guide's own rule — a column for what you filter, sort or draw as a field; the
body for the words a person reads — and here it buys something concrete:
`search()` reads `doc` and nothing else, so ingredients in the body are what
makes "what can I do with a lemon" answerable, and the same list in a column of
its own would be invisible to it.

    let minutes = (iso) => {
      let m = /^P(?:.*?T)?(?:(\d+)H)?(?:(\d+)M)?/.exec(String(iso ?? ''))
      return m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : 0
    }

    // recipeInstructions is a string, a list of strings, a list of
    // HowToStep, or HowToSections holding those. All four, flattened.
    let steps = (v) => {
      if (typeof v == 'string') {
        return v.split('\n').map((s) => s.trim()).filter(Boolean)
      }
      return [].concat(v ?? []).flatMap((s) =>
        typeof s == 'string' ? [s.trim()]
        : typed(s, 'HowToSection') ? steps(s.itemListElement)
        : [str(s)]
      ).filter(Boolean)
    }

    let cooking = (ld) => {
      let r = things(ld).find((n) => typed(n, 'Recipe'))
      if (!r) return null
      let bits = [].concat(r.recipeIngredient ?? []).map(str).filter(Boolean)
      let how = steps(r.recipeInstructions)
      return {
        title: str(r.name),
        serves: parseInt(str(r.recipeYield), 10) || null,
        minutes: minutes(r.totalTime ?? r.cookTime) || null,
        picture: src(r.image),
        body: [
          ...(bits.length ? ['## Ingredients', '', ...bits.map((b) => `- ${b}`),
            ''] : []),
          ...(how.length ? ['## Method', '',
            ...how.map((s, i) => `${i + 1}. ${s}`)] : []),
        ].join('\n'),
      }
    }

**The picture, kept.** The site's copy can move, expire or go behind a login, so
fetch the bytes and put them in the app's own store. The blob door takes them
from a worker exactly as it takes them from a page:

    let kept = async (env, at) => {
      if (!at) return ''
      let got = await fetch(at)
      if (!got.ok) return ''
      let bytes = await got.arrayBuffer()
      if (bytes.byteLength > 20_000_000) return ''      // the door's ceiling
      let saved = await env.STORE.fetch('/blob', {
        method: 'POST',
        headers: {
          'content-type': got.headers.get('content-type') ?? 'image/jpeg',
          'x-yak-name': encodeURIComponent(
            new URL(at).pathname.split('/').pop() || 'picture'),
        },
        body: bytes,
      })
      return saved.ok ? (await saved.json()).eid : ''
    }

It answers the bytes' own eid, which is what `recipe.image` holds — the same
`text` column a photo an app uploaded would use, drawn back with
`./api/blob/<eid>`. Every one of these is a subrequest, and the budget is 50 per
request: the page, the picture, the upload and the write is four.

Then the route's middle grows two lines. Where the generic worker built `title`
and `body` from the meta tags, a recipe page overrides them:

    let dish = cooking(page.ld)
    let title = dish?.title || str(ld.name) || m['og:title'] ||
      page.title || told || from
    let body = dish?.body || str(ld.description) || m['og:description'] || ''
    let image = await kept(env, dish?.picture || m['og:image'] || '')

    // …and the bundle carries the recipe when there was one:
    entities: [{
      entity: { eid },
      doc: { title, body },
      ...(dish ? { recipe: {
        serves: dish.serves, minutes: dish.minutes, image } } : {}),
      source: { url: from, at: new Date().toISOString() },
    }]

A page with no `Recipe` in it still lands — as a `doc` with a `source`, findable
by search, upgradable later. That is the behaviour to aim for in any clipper you
write: never refuse to save something because you did not recognise it.

## The clip page

The page the bookmarklet opens. It calls the route, shows what was saved, and
carries a box for pasting an address by hand. Save it as `clip.html` beside
`index.html` — `/clip` is the worker's route and `clip.html` is a file, two
different addresses, and the worker answers its own before the files are asked.

    <!doctype html>
    <meta charset="utf-8" />
    <title>Clip a page</title>
    <p id="say">…</p>
    <div id="what"></div>
    <form id="by-hand" hidden>
      <input name="url" type="url" placeholder="paste an address" size="40" />
      <button>Clip it</button>
    </form>
    <p><a href="./">Back to everything saved</a></p>
    <script type="module">
      let say = (words) => document.getElementById('say').textContent = words
      let what = document.getElementById('what')
      let form = document.getElementById('by-hand')

      let clip = async (from, told) => {
        say('Reading it…')
        let r = await fetch('./clip?url=' + encodeURIComponent(from) +
          '&title=' + encodeURIComponent(told ?? ''))
        let got = await r.json()
        if (got.error) return say(got.error)
        say(got.thin
          ? 'That site would not let us read it, so the link is saved.'
          : 'Saved.')
        what.innerHTML = ''
        let h = document.createElement('h2')
        h.textContent = got.title
        what.append(h)
        if (got.image) {
          let img = document.createElement('img')
          img.src = './api/blob/' + got.image
          img.width = 320
          what.append(img)
        }
      }

      let asked = new URLSearchParams(location.search)
      if (asked.get('url')) {
        await clip(asked.get('url'), asked.get('title'))
      } else {
        say('Paste an address, or use the Clip button on your bookmarks bar.')
      }
      form.hidden = false
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        clip(new FormData(form).get('url'))
      })
    </script>

(Have the route answer `image` beside `eid` and `title` if you want the picture
drawn here.)

## The bookmarklet

A bookmark whose address is a little program. The person drags it to their
bookmarks bar once; after that, one press on any page sends its address to the
clip page in a new tab.

Put the link on a page of the app — the app's own home is the natural place —
with a line telling them to drag it up:

    <p>Drag this to your bookmarks bar:
      <a id="tool">Clip to my recipe box</a> — then press it on any page.</p>
    <script type="module">
      let at = new URL('./clip.html', location.href).href
      document.getElementById('tool').href =
        'javascript:void(open(' + JSON.stringify(at) +
        '+"?url="+encodeURIComponent(location.href)' +
        '+"&title="+encodeURIComponent(document.title)))'
    </script>

Building the `href` in script rather than typing it into the HTML gets the app's
own address right in an installed copy, which lives at whatever address its
installer took it at. `open(...)` leaves the person's page where it is and puts
the app in a new tab; `location.href = …` instead if you would rather take them
straight there.

Two things to know. A bookmarklet cannot be installed for somebody — every
browser makes the person drag it themselves, so the app has to say so in a
sentence. And `document.title` is why the launcher still helps on a site the
worker cannot read: the browser is already on the page, so the title comes along
even when the fetch is refused.

## When a site says no

Plenty of sites answer a robot with a 403, a challenge page, or HTML with
nothing in it. There is no way around that from a worker, and it is not a bug in
the app.

What to tell the person, in the app's own words rather than a status code:
**that site would not let us read it, so we saved the link and the title.** Then
show them the row with its address, and let them add a note. They lose the
ingredients, not the recipe.

Do not retry, do not pretend to be a browser you are not, and do not answer 5xx
— that files a break in their app and tells their agent about it, once per
clipped page.

## On a phone

The bookmarklet is a desktop gesture: mobile browsers make bookmarks hard to
press and some will not run one at all. What works today is the paste box on the
clip page — the person shares or copies the address in their browser, opens the
app, and pastes. Put the box on the app's home too, and it is two taps.

A web app manifest can declare a `share_target`, and the platform does serve a
`.webmanifest` — but it only takes effect once a browser has INSTALLED the app
to the home screen, which is not something to promise a person today. Give them
the paste box, and say the sharing sheet is coming rather than shipping a button
that does nothing on their phone.

## What is not here yet

- **No writing into an app from another site.** No API token, no CORS write
  door. The launcher is the whole of it.
- **No browser extension.** An app is pages and a worker; there is nothing that
  packages one.
- **No headless browser.** The worker fetches HTML. A page that draws itself
  entirely in JavaScript arrives empty, and the meta tags are all you get.
- **No scheduled re-clip.** Nothing runs on a timer; a page is read when
  somebody presses the button.

---

Related: worker routes, `env.STORE` and the limits are
<https://yaks.app/guide/code.md>; declaring `recipe` and `source` is
<https://yaks.app/guide/components.md>; the blob door and pictures are
<https://yaks.app/guide/files.md>; the filter line, including quoting an
address, is <https://yaks.app/guide/querying.md>. The whole guide:
<https://yaks.app/guide.md>.
