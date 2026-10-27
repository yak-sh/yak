---
doc:
  title: Web Clipping
guide:
  slug: clipping
  brief: web clipping, saving a page from another site
  description: >-
    Web clipping, saving a page somebody is reading on another site into the
    app's store: a worker route that fetches the URL and reads its JSON-LD,
    Open Graph and meta tags and title with HTMLRewriter, one row per URL, a
    recipe example that keeps the picture, a bookmarklet that opens the app's
    clip page, why a script on another site cannot write to an app (no
    cross-origin writes), and what to tell the person when a site blocks the
    fetch.
---

# Web Clipping

**Web clipping** saves a page the person is reading on another website (a
recipe, a flat to rent, a paper, a jacket) into their app. This page shows how
to build it with what the platform has today: a route on the app's own
`worker.js` that fetches the address and reads the metadata the page carries
about itself, and a bookmarklet on their bookmarks bar that starts it.

The code is the same whatever they are saving. The worked example at the end is
recipes, because a recipe page carries more metadata than most and so uses all
three levels; the first half of the page is what you write for any site.

## Why the app fetches the page: no cross-origin writes

The obvious design, a button on the other site that posts into the app, cannot
be built on yaks.app yet. This is why.

An app's endpoints under `./api/` accept **same-origin requests carrying the
person's cookie**. The person's sign-in cookie is `SameSite=Lax` and the
platform checks the browser's own `Origin` header against the address the
request arrived at, so a script running on `some-recipe-site.example` cannot
`apply` into their app — with or without their cookie, the write is refused. The
one endpoint open to a page on another site is `./api/query`, answered as a
signed-out stranger with the credentials stripped: a read, never a write.

So the bookmarklet **opens the app** rather than posting into it. It passes the
app the address of the page they are on, and the app, which is signed in because
it runs in their own tab on its own origin, does the reading and the writing. So
the flow is: press the bookmarklet, the app opens, and it shows what was saved.

Do not build around an API token or a browser extension. Neither exists on
yaks.app today, and a page that tells the person to paste an API key somewhere
teaches them a bad habit, for an endpoint that refuses cross-origin writes
anyway.

## Page metadata: JSON-LD, Open Graph and the title

Almost every page carries a machine-readable description of itself, and there
are three levels of it. Use the best one the page offers.

**1. JSON-LD** — a `<script type="application/ld+json">` block holding
schema.org objects. This is the most structured level: a recipe arrives with its
ingredients in a list, an article with its author and date, a product with its
price. Most publishing software emits it by default.

**2. Open Graph and meta tags** — `og:title`, `og:description`, `og:image`,
`og:site_name`, `article:published_time`, and plain `<meta name=description>`.
Nearly universal, because it is what a link preview in a chat app reads. It
gives you a title, a sentence and a picture, and nothing structured.

**3. The `<title>` and the text on the page.** The fallback. You always have the
address and usually the title, and that alone is worth saving: a link with a
title is more useful than a bare link.

Handle all three. A clipper that only reads JSON-LD works on the sites that have
it and silently does nothing on the rest, which the person reports as "it's
broken".

## Parsing the page with `HTMLRewriter`

`HTMLRewriter` is in the Workers runtime, so there is no parser to install. It
streams, which keeps parsing a page with a megabyte of advertising within the
worker's 50ms CPU limit; a regex over the whole body does not.

    // The page's JSON-LD blocks, meta tags and title, in one pass.
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
`.arrayBuffer()` at the end is not there for the bytes: reading the body is what
streams it through the rewriter, so the handlers run.

The helpers below handle JSON-LD's two variable shapes. A document may be one
object, a list of them, or a `@graph` wrapping the list; and any value in it may
be a string, an object, or a list of either.

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

    // The first text in a value.
    let str = (v) =>
      typeof v == 'string' ? v.trim()
      : Array.isArray(v) ? str(v[0])
      : v && typeof v == 'object' ? str(v.text ?? v.name ?? v.url)
      : ''

    // The first URL in a value.
    let src = (v) =>
      typeof v == 'string' ? v.trim()
      : Array.isArray(v) ? src(v[0])
      : v && typeof v == 'object' ? src(v.url ?? v.contentUrl)
      : ''

    let typed = (node, want) =>
      [].concat(node['@type'] ?? []).includes(want)

`try { } catch { continue }` is needed: many sites ship JSON-LD with a trailing
comma or a raw newline in a string, and one invalid block must not lose you the
page.

## Storing the source URL, one row per URL

Whatever else the app keeps, store **where the page came from**, in a component
of its own declared in the app's `vocab.json`:

    { "$defs": {
        "source": { "properties": {
          "url": { "type": "string", "format": "uri" },
          "at":  { "type": "string", "format": "date-time" } } } } }

It has two properties for two facts: the address the text came from, and when
this app made its copy. `source.url` is what tells a page where to send somebody
who wants the original, and `.source` is the filter for everything clipped
rather than typed.

**The same address clipped twice should be one row.** The cheapest way is to use
the address's hash as the entity's eid: an eid you mint yourself creates the
entity on the first write and patches it on every later write, so nothing has to
be looked up and nothing can be saved twice:

    // The eid for an address: the same address always gets the same eid.
    let idOf = async (key) => {
      let bytes = await crypto.subtle.digest(
        'SHA-256', new TextEncoder().encode(key))
      return [...new Uint8Array(bytes)]
        .map((b) => b.toString(16).padStart(2, '0')).join('')
    }

    let eid = await idOf('clip:' + from)

The other way is to query first, with `query('.source.url="' + from + '"')`
(quoted because an address often contains `&`), and patch the row it returns.
That costs a subrequest, and two clips at the same moment can create two rows,
so prefer the hash.

## A generic clipping worker

Here is the generic worker in full. It fetches the page, reads the three levels
of metadata, and writes one bundle:

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
        // A site that blocks automated requests is not an error in this app,
        // so save the title the browser sent and report that. (Returning 5xx
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

Note the status the route returns when the site refuses. A 5xx from a worker is
filed as an error in the person's app and reported to their agent, but a site
that blocks automated requests is common and is not an error in the app. So the
route returns 200 with `thin: true`, the clip page explains what happened, and
the person keeps the link.

## Example: clipping recipes

A recipe page's JSON-LD is a schema.org `Recipe`, and the useful fields are
`name`, `recipeIngredient`, `recipeInstructions`, `recipeYield`, `totalTime` and
`image`. The app declares what it will filter on:

    { "$defs": {
        "recipe": { "properties": {
          "serves":  { "type": "number" },
          "minutes": { "type": "number" },
          "image":   { "type": "string" } } },
        "source": { "properties": {
          "url": { "type": "string", "format": "uri" },
          "at":  { "type": "string", "format": "date-time" } } } } }

The ingredients and the method go in `doc.body`, as markdown. That follows the
guide's rule: a property for what you filter, sort or draw as a field, and the
body for the text a person reads. Here it has a concrete benefit: `search()`
reads `doc` and nothing else, so ingredients in the body let a search such as
"what can I do with a lemon" find the recipe, and the same list in a property of
its own would not be searched.

    let minutes = (iso) => {
      let m = /^P(?:.*?T)?(?:(\d+)H)?(?:(\d+)M)?/.exec(String(iso ?? ''))
      return m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : 0
    }

    // recipeInstructions is a string, a list of strings, a list of
    // HowToStep, or HowToSections holding those. This flattens all four into
    // one list of steps.
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

**Storing the picture.** The site's copy can move, expire or go behind a login,
so fetch the bytes and upload them to the app's own store. The blob endpoint
accepts them from a worker exactly as it accepts them from a page:

    let kept = async (env, at) => {
      if (!at) return ''
      let got = await fetch(at)
      if (!got.ok) return ''
      let bytes = await got.arrayBuffer()
      if (bytes.byteLength > 20_000_000) return ''   // the endpoint's ceiling
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

`kept` returns the eid of the uploaded bytes, which is what `recipe.image`
holds: the same `text` property a photo an app uploaded would use, displayed
with `./api/blob/<eid>`. Each fetch here is a subrequest, and the limit is 50
per request: the page, the picture, the upload and the write make four.

Then the middle of the route gains two lines. Where the generic worker built
`title` and `body` from the meta tags, a recipe page overrides them:

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

A page with no `Recipe` in it is still saved, as a `doc` with a `source` that
search finds and the person can edit later. Aim for that behaviour in any
clipper you write: never refuse to save something because you did not recognise
it.

## The clip page (`clip.html`)

The page the bookmarklet opens. It calls the route, shows what was saved, and
has a box for pasting an address by hand. Save it as `clip.html` beside
`index.html`. `/clip` is the worker's route and `clip.html` is a file, so they
are two different addresses, and the worker's routes are matched before the
app's files are looked at.

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

(Have the route return `image` beside `eid` and `title` if you want the picture
drawn here.)

## The bookmarklet

A **bookmarklet** is a bookmark whose address is a `javascript:` URL. The person
drags it to their bookmarks bar once; after that, one press on any page sends
its address to the clip page in a new tab.

Put the link on a page of the app, usually the app's home page, with a line
telling them to drag it to the bookmarks bar:

    <p>Drag this to your bookmarks bar:
      <a id="tool">Clip to my recipe box</a> — then press it on any page.</p>
    <script type="module">
      let at = new URL('./clip.html', location.href).href
      document.getElementById('tool').href =
        'javascript:void(open(' + JSON.stringify(at) +
        '+"?url="+encodeURIComponent(location.href)' +
        '+"&title="+encodeURIComponent(document.title)))'
    </script>

Building the `href` in a script, rather than typing it into the HTML, gets the
app's own address right in an installed copy, which is served at whatever
address the person who installed it chose. `open(...)` leaves the person's page
where it is and puts the app in a new tab; `location.href = …` instead if you
would rather take them straight there.

Two things to know. A bookmarklet cannot be installed for somebody: every
browser makes the person drag it themselves, so the app has to tell them to drag
it. And because the bookmarklet sends `document.title`, it still helps on a site
the worker cannot read: the browser is already on the page, so the title is sent
even when the fetch is refused.

## When a site blocks the fetch

Many sites answer an automated request with a 403, a challenge page, or empty
HTML. A worker cannot get around that, and it is not a bug in the app.

Tell the person, in plain language rather than a status code: **that site would
not let us read it, so we saved the link and the title.** Then show them the row
with its address, and let them add a note. The ingredients are missing, but the
recipe's link and title are saved.

Do not retry, do not send a user agent that claims to be a browser, and do not
return 5xx, which files an error in their app and tells their agent about it,
once per clipped page.

## Clipping on a phone

The bookmarklet works on desktop browsers: mobile browsers make bookmarks hard
to press and some will not run one at all. What works on a phone today is the
paste box on the clip page: the person shares or copies the address in their
browser, opens the app, and pastes. Put the box on the app's home page too, and
it takes two taps.

A web app manifest can declare a `share_target`, and the platform does serve a
`.webmanifest`, but it only takes effect once a browser has installed the app to
the home screen, which is not something to promise a person today. Give them the
paste box, and say that sharing from the phone's share sheet is coming, rather
than shipping a button that does nothing on their phone.

## Limitations

- **No writing into an app from another site.** No API token, and no endpoint
  that accepts a cross-origin write. The bookmarklet is the only mechanism.
- **No browser extension.** An app is pages and a worker; there is nothing that
  packages one.
- **No headless browser.** The worker fetches HTML. A page that draws itself
  entirely in JavaScript arrives empty, and the meta tags are all you get.
- **No scheduled re-clip.** Nothing runs on a timer; a page is read when
  somebody presses the button.

---

Related pages: worker routes, `env.STORE` and the limits are in Backend Code
(<https://yaks.app/docs/code.md>); declaring `recipe` and `source` is in
Components and vocab.json (<https://yaks.app/docs/components.md>); the blob
endpoint and pictures are in Files and Uploads
(<https://yaks.app/docs/files.md>); the query syntax, including quoting an
address, is in Query Syntax (<https://yaks.app/docs/querying.md>). The whole
guide: <https://yaks.app/docs.md>.
