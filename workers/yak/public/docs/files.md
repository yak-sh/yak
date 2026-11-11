---
doc:
  title: Files and Uploads
guide:
  slug: files
  brief: private draft previews, files, releases, uploads, searchable PDFs and web pages, scanned documents, document questions and page citations
  description: >-
    Build and check a private draft with app_preview before app_deploy:
    screenshots at phone and desktop widths, page console and errors,
    isolated test data and a private preview URL, without a local computer.
    app_deploy's reload levels and the yak-release event, including a custom
    notice that keeps unsaved input; app_files — what a write returns, the
    patch and fetch ops, the version history every write keeps and the restore
    op, page URLs and 404 handling, icon.png and icon.svg for the app's icon — then
    upload() for a file from an <input> or a drop: the ./api/blob URL the bytes
    are served from, the attachment and image rows it writes, large files
    uploaded in parts and resumed, who may upload, deleting an upload and its
    bytes, the vocab.json size and type limits, downscaling images before
    upload, a photo gallery without duplicate rows, and publish() for a public
    file served to anyone at a path of the app's URL, before the app's worker
    and regardless of its access.
---

# Files and Uploads

An app's store cannot hold raw bytes: you cannot write a file into a component
the way you write a title or a number. This page covers how you write the app's
own files with `app_files`, then, for the files its visitors send, what `upload`
accepts and returns, the URL they are served from, the two rows one upload
writes, who may upload and who may read, how to delete an upload, how the app
limits which files it accepts, downscaling a phone photo so it uploads quickly,
and a photo gallery that does not show the same picture twice.

## Writing app files with `app_files`

The app's own files — `index.html`, the css and js beside it, `vocab.json` — are
written with `app_files`. **Writing a file needs no `op`**: give it a `path` and
a `content`, or a list of them as `files: [{path, content}, …]`. The files stay
in a private draft until `app_deploy` releases them. A refused deploy leaves the
previous files, vocabulary and worker serving together.

## Checking a draft with `app_preview`

Build and check the app through the connector before releasing it. No local
checkout, shell or computer is needed:

1. Write the files with `app_files`, or copy them from the sandbox with
   `sandbox_ship`.
2. Call `app_preview(app: 'recipes', width: 390, height: 844)` for a phone, then
   `app_preview(app: 'recipes', width: 1280, height: 900)` for a desktop.
3. Read the screenshot, console messages, JavaScript errors, HTTP status and
   WCAG 2.1 AA accessibility report. Fix the reported problems before deploying
   and preview again. Each problem names its rule, element and one-line fix.
4. Release with `app_deploy` and share the released app's URL.

`path: 'about/'` opens another page. `wait` is milliseconds after
DOMContentLoaded to capture asynchronous rendering and diagnostics, from 0 to
3000 (default 1000). `screenshot: false` gives only the private preview URL
without running a browser. Screenshots run on Cloudflare at the requested
viewport size, and return as an image the connector client displays.

The accessibility report uses a vendored axe-core checker, including WCAG 2.0
and 2.1 A and AA rules. `accessibility.problems` lists every affected element;
`accessibility.review` lists elements needing manual review. The chat reply
shows up to 30 problems and five review items, with remaining counts. Findings
never refuse a preview or release. Automated checks do not prove conformance;
check keyboard use, reading order and content as well.

The URL is a private bearer link to the app, one per app, that keeps working
across every `app_deploy`. Anyone holding it can exercise the preview as its
author while that author remains a writer; keep it private. Draft files,
vocabulary, seed data and worker run with the link's own test store, kept across
deploys and for thirty days after the draft last changed. Preview edits do not
change released app data, and do not become released data later. External D1,
R2, Vectorize and Durable Object bindings are unavailable in a draft preview.

### A preview that follows the draft

Leave the preview URL open, on a laptop or a TV, and each write to the draft
shows there as it lands, without calling `app_preview` again:

- a write of only stylesheets the page links swaps each one in place;
- any other write reloads the page, keeping its scroll position and what was
  typed into its fields;
- a change to `worker.js`, `vocab.json` or a seed file sets up the preview's
  worker or test store again first. A seed file applied again rewrites the rows
  it seeded rather than adding new ones;
- an `app_deploy` reloads the page to show what was released, and the page goes
  on following the next draft's writes.

A TV can follow the person instead of one app. It opens `yaks.app/tv` and shows
an eight-letter code; the person types it at `yaks.app/tv/pair` on their phone,
or reads it out for `screen_pair`. The paired TV then shows the draft of the app
they last wrote to, moving to another app when they write there, read-only: its
page's writes are refused and what it keeps stays in the page. Each write is
said over it for a few seconds as it lands ("Wrote styles.css"), and a deploy as
"Released" and the app's title. They unpair it at `yaks.app/tv/pair`, and the TV
shows a new code.

Before either, the page receives a cancelable **`yak-draft` event on `window`**.
Its `detail` is `{app, link, draft, files: [{path, sha, url, entries?}], at}`,
where `url` is the address the file serves at and `sha` is null for a deleted
file. When a saved compile plan names the file, `entries` lists the URLs of the
compiled page entries that import it. A deploy arrives with `draft` null and no
files. Call `event.preventDefault()` synchronously to take the write yourself,
for example by fetching the one module that changed. A page that took the write
and then cannot use it calls `event.reload()`, the reload it would have had,
keeping its scroll and typed fields. This happens only on the preview URL;
released pages keep the reload notice below.

An app on the `@yaks/` packages takes a write of its views in place, with no
reload. Put the page's renderers in a views module that exports `views`, a
`@yaks/render` registry; load it from `index.html` with its own
`<script type="module" src="views.ts"></script>`; and draw the page with `host`
from `@yaks/preact/host` (`"@yaks/preact": "platform"` in `package.json`),
giving it the root element, the views module's address and the page's client
through the `client` option. A write of the views module, or a dependency whose
`entries` name only that module, imports the updated module and draws it in the
same place: the client, its socket and the page graph stay open, and scroll,
focus and everything in the page graph are kept. A `vocab.json` write that only
adds components fetches `api/vocab.json` and extends the client's vocabulary in
place. A changed component shape, a dependency shared with another page entry,
or a module that fails to import or draw reloads the page as above. The
[@yaks/preact README](https://jsr.io/@yaks/preact) has the details.

Calls a draft worker makes to external services still reach those services; the
separate test store isolates app data, not external side effects.

Browser time is estimated at $0.09 per hour ($0.000025 per second), charged to
the space's monthly budget. Each reply reports its browser cost; compilation,
when needed, uses the ordinary compiler allowance. Opening an already prepared
URL does not run a Cloudflare browser or incur browser time.

`app_files(app, op: 'list')` lists their paths, each with the SHA-256 of its
bytes, then the live version and whether the draft differs from it: the number
`app_deploy` takes as `base`.

**To read an existing app, use one call**: `app_files(app, op: 'read')` returns
every text file in it, each under its path and SHA-256, up to 64 KB in all, and
names the live version `app_deploy` takes as `base`. `paths: [...]` reads just
those files. The answer names each file it left out and why: not text, no such
file, or past the 64 KB. `paths` reads those in another call, and `path` reads
one whole, as its text alone.

**Every write reports what was stored**, so a file you wrote out by hand is
checked in the same call, before the app serves it:

    wrote index.html → https://yourname.yaks.app/recipes/index.html
      — 4213 bytes, sha256 9f2a…

A `.json` file is parsed as well, and the reply reports `parsed` — or reports
that it is not valid JSON, and where:
`NOT valid JSON — Expected ',' or '}' after
property value in JSON at position 45971`
gives the position of the error. That is a note in the reply, not a refusal: the
file is still stored.

**`op: patch` edits one file in place** — `path`, `find`, `replace`. `find` is
exact text, not a pattern, and must match exactly once; anything else refuses
saying how many matches there were, so lengthen `find` until it names one place.
An empty `replace` removes the text. Use it to fix one wrong line without
sending the whole file again.

**Many edits are one patch call.** `edits` takes a list of
`{path, find,
replace}`, across any of the app's files, in place of `path`,
`find` and `replace`. They apply in order, so a later edit to a file sees the
earlier ones, and all or none: one that does not match refuses the call, naming
the edit, and nothing is written. The reply gives the line each edit landed on.
Ten changes to a stylesheet are one call, not ten:

    app_files(app, op: 'patch', edits: [
      { path: 'style.css', find: 'color: #333', replace: 'color: #222' },
      { path: 'index.html', find: '<h1>Old</h1>', replace: '<h1>New</h1>' },
    ])

**`op: fetch` writes a URL's body to a path** — `path` and `url`, https only.
Use it to vendor a third-party library into the app instead of writing it out by
hand:

    app_files(app, op: 'fetch', path: 'chess.js',
              url: 'https://cdnjs.cloudflare.com/…/chess.min.js')
    → fetched … → https://yourname.yaks.app/chess/chess.js — 15234 bytes,
      sha256 3c1f…, text/javascript, integrity sha256-PB8…=

The `integrity` is the same digest in the format a `<script integrity>`
attribute expects, so a page that keeps loading the file from a CDN can pin it
to the bytes this fetch received. The app serves the file with a content type
taken from the path's extension, not from the response: a path ending in `.js`
is served as JavaScript.

After `app_deploy`, local scripts, stylesheets, images, audio and video named by
the page use a URL under `./api/assets/<release>/`. Local import-map targets and
scopes, and relative URLs inside stylesheets and module scripts, stay in that
release too, except one that names `./api/`: a module's
`import … from './api/client.js'` still reaches the app's API. Those URLs keep
the same bytes even after another deploy or a rollback, so a browser may cache
them for a year. The page itself, app data, and the ordinary file addresses
still revalidate; they show the current release. A page with its own `<base>`
keeps its chosen URL behavior. App access is checked whenever a request reaches
the server, including a request for an older release.

## Page URLs and 404 handling

Every HTML file is a page, at the URL a static host would give it:

    index.html          /<app>/
    about.html          /<app>/about, and /<app>/about.html
    docs/index.html     /<app>/docs/ (and /<app>/docs is sent there)
    404.html            any page that is not there, answered 404

A path with no file behind it and no extension, `/<app>/recipes/42`, is a route:
without a `404.html` the app's `index.html` answers it, so a page that renders
its own routes opens at that URL. A missing stylesheet, script or picture is a
404, never a page.

**Choosing the response for a missing page.** A `wrangler.jsonc` beside
`index.html` sets it, with Cloudflare's own key, `assets.not_found_handling`:

    { "assets": { "not_found_handling": "single-page-application" } }

- `"single-page-application"`: a route answers `index.html` with 200, even when
  a `404.html` exists.
- `"404-page"`: the nearest `404.html` answers 404, looking in the missing
  page's folder and then each folder above it; with none, a plain 404.
- `"none"`: a plain 404.

When it is unset, the default above applies: the root's `404.html`, else
`index.html` for a route. A missing file with an extension is a 404 in every
mode.

**Redirects.** A `_redirects` file beside `index.html`, in Cloudflare's own
format, sends a page's old address to its new one: a rule a line,
`source
destination [status]`, the first that matches wins, `#` starts a
comment.

    /calendar        /happening       301
    /sermons/*       /sermons/:splat
    /?flow=abc       /signup          301

A source is a path of the app, with `:name` for one segment and a final `*` for
the rest; a trailing slash makes no difference. `?key=value` on it asks the
query to hold that pair, and a bare `?key` asks it to hold the key, so an old
printed link can be told apart by its query. A destination is a path of the app,
which holds at whatever address the app is served, or an https address; `:name`
and `:splat` in it are what the source caught. The status is 301, 302 (the
default), 303, 307 or 308. A rule with no query on its source passes the
visitor's query on; one that named a query takes it. Only a page's address is
redirected, never a file's, and `_redirects` itself is not served.

Each page resolves its relative URLs from its own folder, as anywhere on the
web: `docs/index.html` names `../style.css`, and reaches the client at
`../api/client.js`.

**Serving a folder.** A `wrangler.jsonc` beside `index.html` can name a folder
of the app to serve at the app's URLs, with Cloudflare's own key:

    { "assets": { "directory": "dist" } }

Then `dist/index.html` is `/<app>/`, and nothing outside `dist/` is on the web.
This lets a build's output sit beside the source that made it. Backend Code
shows a build going from the sandbox to the app's URL:
<https://yaks.app/docs/code.md>. `app_deploy` refuses a folder with no files in
it.

## Releases and reload notices for open pages

`app_deploy` makes the draft a new release. An already-open page keeps its
release's file URLs, but its data is live: a newer release may change the
contract that page uses. The platform checks for a new release when one is
pushed through the app's own socket, when that socket opens or reconnects, when
the page becomes visible again, and on a persisted `pageshow` (returning from
the browser's back-forward cache). The return checks run at most once a minute.
A page with no socket that never hides does not learn of a release until one of
those moments.

The reload level is derived by **comparing the page's version with the newest
version**, not just from the last deploy:

- Identical file manifests mean **no notice**, even after a rollback or an
  explicit required mark.
- Dropping or retyping a declared component, tool or property, or crossing any
  release marked `reload: 'required'`, means **required**.
- Other file changes, including additive vocabulary changes, mean **optional**.

A deployer can raise the level for a contract the vocabulary does not describe:

    app_deploy(app: 'recipes', reload: 'required')

Use this when, for example, a worker route or the meaning of a value sent to a
peer changes incompatibly. The only explicit value is `'required'`. Leaving
`reload` out means **derive from the releases**, not "force optional"; a
deployer cannot lower a required change. `app_rollback` compares the page with
the kept version now live, including backward moves; dropping words or crossing
a required mark requires reload. `app_update` carries required marks from the
source releases it crosses. The identical-files rule still takes precedence.
Neither operation rolls back saved data; plan any store migration with the
release.

### The default reload notice

The platform emits a cancelable **`yak-release` event on `window`**, once for
each newly noticed version. Its `detail` includes `{version, reload}`: `version`
is the latest release number and `reload` is `'optional'` or `'required'`. More
fields may be added; read the ones you use rather than assuming that is the
whole object.

Unless the app draws its own notice, an optional notice says **"A new version of
this app is out"**, with Reload and Dismiss. Dismiss holds for that version in
that tab. A required notice says **"This app has changed. Reload to keep using
it"**, with Reload only, and stays until the person reloads. Neither notice
covers the page's input. **There is no automatic reload**, even for required
changes: let the person save or copy unfinished work before choosing Reload.

### Custom reload notice

Call `event.preventDefault()` **synchronously in the listener** to suppress the
platform notice, then draw your own. Canceling the event does not acknowledge
the release; it hands the notice to your app, which must then show the person a
notice and a Reload action. Keep a required notice visible, and let only an
optional notice be dismissed. Do not clear or replace the form while drawing it.

For example, put this notice in normal page flow, beside (not over) your form:

```html
<aside id="release-notice" hidden aria-live="polite">
  <p id="release-message"></p>
  <button id="release-reload" type="button">Reload</button>
  <button id="release-dismiss" type="button">Dismiss</button>
</aside>
```

Run this script after those elements exist. The form and its unsaved values are
untouched; reload happens only on the button click. For a required change, help
the person copy unfinished work before clicking it.

```js ignore
let notice = document.querySelector('#release-notice')
let message = document.querySelector('#release-message')
let reload = document.querySelector('#release-reload')
let dismiss = document.querySelector('#release-dismiss')

window.addEventListener('yak-release', (event) => {
  event.preventDefault()
  let { reload: level } = event.detail
  message.textContent = level == 'required'
    ? 'This app has changed. Copy unfinished work, then reload to keep using it'
    : 'A new version of this app is out'
  dismiss.hidden = level == 'required'
  dismiss.onclick = () => {
    notice.hidden = true
  }
  reload.onclick = () => {
    window.location.reload()
  }
  notice.hidden = false
})
```

This event is for the app's own releases, not for platform releases or a
borrowed app's releases. The script is supplied by the platform; there is no
client library upgrade or app rebuild needed to receive it.

## File history and restore

**No write or delete discards bytes.** Before a write replaces what is at a
path, the previous bytes are kept — addressed by their own sha256, beside the
app — and recorded in that path's history. A file you just overwrote can be
restored with one call, so you do not have to keep your own copy of what it
contained.

    app_files(app, op: 'history', path: 'index.html')
    → index.html in yourname/recipes:
      now — 4213 bytes, sha256 9f2a…
      - until 2026-09-06T14:20:11Z — 3980 bytes, sha256 c41d…, by the owner
      - until 2026-09-04T09:02:47Z — 1204 bytes, sha256 7b19…, by the owner

Each entry means **"the file was these bytes until this time"**: the time and
the name belong to the write that replaced those bytes. So the top entry is the
version before the current one, and `now` is what the app is serving at this
moment.

**`op: restore` restores a version.** With only a `path`, it restores the newest
entry, which undoes the last write:

    app_files(app, op: 'restore', path: 'index.html')

`sha` picks one entry from the history by its hash. `at` picks a time:
`at: '2026-09-05T00:00:00Z'` restores the file the app was serving then. Use
`at` when you know _when_ the file was still right but not _what_ it contained.

A restore is **itself a write**, so the bytes it replaces are kept in turn, and
another restore can undo it. Nothing rewrites the history.

**With no `path`, `op: restore` goes back one write.** Every file the app's
newest write changed returns to what that write replaced, together, and a file
the write made is removed. This is what to do when someone says "go back".
Asking again goes back one more write, rather than putting back the one just
undone:

    app_files(app, op: 'restore')

The bytes are kept for **30 days**, and always at least the last 20 versions of
a file, whichever reaches further back. After that a version is deleted, but
only if nothing else needs it: bytes a kept deploy names are never removed, so
`app_rollback` keeps working for every version `app_versions` still lists.

File history restores one file, or one write. The other restore tools:
`app_rollback` restores every file of a whole deploy at once, `store_restore`
restores everything the app has _saved_, and `app_restore` restores an app that
was deleted.

## The app's icon: `icon.png` and `icon.svg`

The app's icon is the picture beside its name wherever yaks.app lists it (the
space's apps, the Operator's sidebar) and on a home screen. It is the app's
`icon.png`, served once the app is deployed. Until the app has one, that address
serves its space's logo, drawn square on white, or the platform's default yak in
a space without a logo. The space's owner sets its logo on the space's Settings
page, or through `space_set` with `logo`.

A PNG on the web is fetched there:

    app_files(app, op: 'fetch', path: 'icon.png', url: 'https://example.com/logo.png')

Otherwise an **`icon.svg` beside `index.html`** is the app's icon. It is text,
so it is written as `content`, like a page:

    app_files(app, files: [{path: 'icon.svg', content:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<rect width="24" height="24" fill="#4c773e"/>' +
      '<circle cx="12" cy="12" r="6" fill="#fdf7ee"/></svg>'}])

The platform renders it as `icon.png`, 512×512, which is the URL a home screen
reads. The SVG is rendered when it is written, and refused with the reason if it
cannot be an icon:

- its `<svg>` has `xmlns="http://www.w3.org/2000/svg"`, as any SVG file needs;
- its `viewBox` is square;
- it has no `<text>`: there is no font to draw letters with, so a letter is a
  `<path>`;
- it parses.

Fill the square with a background of your own, a `<rect>` the size of the
`viewBox`. Transparent areas are rendered white, because iOS fills a transparent
icon with solid black.

Each page is served with the two links an installed app needs already in its
`<head>`, at the app's own root:

    <link rel="apple-touch-icon" href="/recipes/icon.png">
    <link rel="manifest" href="/recipes/manifest.webmanifest" crossorigin="use-credentials">

iOS reads only the first; it does not use an icon named only in a manifest.
Other browsers and platforms read the second, a manifest generated from the app:
its title as the `name`, its own address as `start_url` and `scope`,
`display: standalone`, the icon at 512 and 192, and the colour the page sets in
`<meta name="theme-color">` where it sets one.

**The app's own links and files take precedence.** Each link is added only where
the page has none, so an app that writes its own `apple-touch-icon` keeps it and
still gets the manifest link, and an app that ships its own
`manifest.webmanifest` is served that file rather than the generated one. A
manifest link on the app's own address that names no `crossorigin` is given
`crossorigin="use-credentials"`, so a private app's manifest is fetched with its
member's sign-in and succeeds. An `icon.png` of the app's own is served instead
of the rendered one: a picture fetched with `op: fetch`, or one `sandbox_ship`
copies in. An image is decoded when it is written, as a browser would decode it,
and one that does not decode is refused. A PNG's bytes cannot be written out by
hand, so an icon an assistant makes is an SVG.

## Uploading a file with `upload`

`upload` is exported by the client library served to every app:

    import { upload } from './api/client.js'
    let file = await upload(input.files[0])

It accepts a `File` from an `<input type=file>`, or any `Blob`, such as one from
a canvas or a `fetch` response. A second argument sets its name:
`upload(blob, { name: 'cake.jpg' })`. A `File` carries its own name; a bare
`Blob` has none unless you give it one.

It returns one object:

    { eid:   '9f2a…',                      // the bytes' own address
      attachment: '…derived…',             // the row naming them in this app
      url:   '/photos/api/blob/9f2a…',     // where this app serves them
      mime:  'image/jpeg',                 // the type the browser reported
      bytes: 51234,                        // how many there are
      w: 1600, h: 1200 }                   // pictures only

`mime` is the blob's own `type` — the browser sets it for a file from an input.
When the type is empty or `application/octet-stream`, a recognized filename
supplies it instead (`video/mp4` for `.mp4`, `audio/mpeg` for `.mp3`). An
unknown name gets `application/octet-stream`. `w` and `h` are there only when
the bytes are an image that declares its size; otherwise both keys are absent.

## Searching documents

Uploading a PDF, Word `.docx`, spreadsheet (`.xlsx`, `.xls`, `.xlsm`, `.xlsb`,
`.ods`, `.numbers`), `.odt`, `.csv`, web page (`.html`, `.htm`, or the type
`text/html`) or plain text (`.txt`, `.md`, or the types `text/plain` and
`text/markdown`) also extracts its text in the background. Use the same
`upload(file)` call above. The original stays downloadable; the app does not
need a conversion service or another search index.

Automatic extraction supports files up to 16 MiB. A larger file is kept and its
attachment gets `failed{reason}` explaining the extraction limit. A file that
still cannot be read once its retries are spent (the model timing out on a
scanned page, say) gets `failed{reason}` naming the error. Scanned pages render
at up to 144 dpi, with their longest edge capped at 2,400 pixels. Tiny or
unreadable print can still need a clearer original.

PDFs are read page by page. Pages containing images are rendered in full and
transcribed, so scanned pages, rotated scans and pages with text over a scan are
searchable too. The renderer preserves the PDF's page numbers. Office conversion
produces one searchable document section, labeled `Document`; it does not invent
printed page numbers for reflowable Word files, sheets or web pages. Plain text
is its own text, read without a conversion. A web article a worker fetched is
kept this way: Document Q&A (<https://yaks.app/docs/library.md>) has the worker
route, and the connector's `library_add` adds documents from web addresses, from
files attached in chat, or from bytes sent along.

Extraction writes `document_page{document, blob, page, location, text}` rows.
`text` is indexed by the app's existing full-text and meaning search. The
`document` reference names the upload's `attachment{blob, mime, name}` row, so
changing its name changes citations without extracting again.
`document_text{blob, pages}` on that attachment marks completed extraction.
Completed pages are reused after an interrupted extraction. The same upload is
extracted once; replacing or deleting it removes its old searchable pages. Pages
inherit the source entity's personal visibility.

An ordinary query finds pages:

    zoning .document_page&*

A page can request hits with citations directly:

```js ignore
let searchDocuments = async (words, semantic = false, scope) => {
  let response = await fetch('./api/documents/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ words, semantic, scope }),
  })
  if (!response.ok) throw await response.json()
  return response.json()
}
```

This search reaches everything an ordinary search does: the app's rows (a
meeting, a notice, a page of the site) and the text inside its documents. It
matches by words, the way a bare word in a query does, and with `semantic: true`
by meaning too, the two rankings merged into one. A hit on a document page is
`{eid, document: {eid, name, url}, page, location, text}`; `document.url` opens
the original PDF at `#page=N`. A hit on a row is
`{eid, title, components,
text}`, where `text` is its components written out. A
hit found by meaning also carries `score`. Each request returns up to ten hits.

`scope` narrows what it reaches. It is a filter line, as a query takes, and
everything is the default:

```js ignore
await searchDocuments('seconded', false, '.document_page') // documents only
await searchDocuments('board', false, '.meeting') // meetings only
```

Full-text search is available to anyone who may read the app. Semantic search
embeds the question and follows the same model permissions as `./api/ai/run`:
members who may write, or a writable app with `models: 'open'`. Search words and
questions are limited to 4,000 characters.

`POST ./api/documents/ask` with `{words: 'your question'}`, and an optional
`scope`, retrieves by words and meaning together and answers from those hits.
Its reply is `{answer, citations}`. Each citation is a hit as above, without its
`text`: a document page or a row. Only retrieved hits can be cited. If nothing
matches, the answer says so. The same model permissions apply.

Text extraction itself makes no model call on a text-only PDF; Office conversion
uses Workers AI's free `toMarkdown` conversion. A scanned page is transcribed
with `@cf/google/gemma-4-26b-a4b-it`, priced at $0.10 per million input tokens
and $0.30 per million output tokens. Page embeddings and semantic
query embeddings use `@cf/qwen/qwen3-embedding-0.6b` ($0.0118 per million input
tokens). Answers are separate model calls. All model costs spend the space's one
budget, alongside the app's other use. Costs vary with page content and answer
length; there is no separate document allowance.

Cloudflare's PDF conversion extracts existing text; it does not OCR scans. The
platform renders and transcribes scanned pages explicitly. See
[Cloudflare's conversion behavior](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/)
and
[model pricing](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/).

## Content addressing

`eid` is the SHA-256 of the bytes, in hex. Nothing else affects it: not the
name, not the mime, not who sent it. This has three consequences.

**Uploading the same file twice gives one upload.** Send the same photo from two
pages, two devices, or twice from one form, and the second upload gets the same
eid, the same object, and the same row — so a page does not need to track what
it has sent; it can send again and read the result.

**The bytes at an address can never change.** The mime and filename can change
if the file is uploaded again, so `GET ./api/blob/<eid>` redirects to a URL that
also names that representation. The alias revalidates, and the versioned URL
keeps its MIME and filename. An app checks access before serving either URL; its
browser responses are private to that browser's cache.

**The address is not a secret.** Anyone who may read the app may read any blob
in it, and someone holding the identical file can compute its eid without
asking. So never use a blob address as access control for something private.
Content addressing does not avoid the transfer: the upload endpoint reads every
byte to hash them, so re-uploading a 4 MB photo costs 4 MB every time. A file
large enough to be uploaded in parts is the exception (below): the page sends
its SHA-256 first, and bytes the app already holds are not sent again.

## The rows an upload writes: `blob` and `attachment`

The upload endpoint writes two entities through the app's own `/apply` endpoint,
recorded as written by the person who uploaded — so `.created` names the
uploader, as for any other row. The **content** row has the bytes' own eid and
records facts about the bytes; the **use** row records the name this app gives
them:

    { entity: { eid: '9f2a…' },
      blob:  { bytes: 51234 },
      image: { w: 1600, h: 1200 } }        // pictures only

    { entity: { eid: '…derived…' },
      attachment: { blob: '9f2a…', mime: 'image/jpeg', name: 'cake.jpg' } }

The use row's eid is derived from the content's, as
`sha256("attachment:" + sha)`, so it is stable but not the same eid. Because of
this, a second upload of the same bytes renames the row that already exists
instead of writing a second row with the same facts. A component may not point
at its own entity, which is the other reason the two rows are separate.

The rename is a patch: an upload with no name keeps the existing name. Send
`cake.png`, then the same bytes as `the cake.png`, then a third time off a
canvas with no name at all, and the row's name is `the cake.png`.

**To list uploads, query the use rows, not the content rows.**
`query('.attachment')` returns every file the app holds:

    for (let f of await query('.attachment')) {
      draw(`./api/blob/${f.attachment.blob}`, f.attachment.name)
    }

`.blob` is not that list — a long `doc.body` is stored as a blob row too.

## Image width and height: `image`

`image` is on the content row — the eid your own row points at — because a size
is a fact about the bytes, however many attachments name them. The platform
reads it from the file's own header and never by decoding the image: png, jpeg,
gif and webp each declare their size in the first few dozen bytes. Any other
format gets no `image` at all, because a guessed size would be worse than none:
a page can measure the bitmap itself but cannot tell that a stored number is
wrong. A header that declares a size of zero is a broken file, and also gets no
`image`.

So a gallery page can reserve each photo's space before any of its bytes arrive:

    let size = new Map((await query('.image'))
      .map((i) => [i.entity.eid, i.image]))
    let box = size.get(p.photo.blob)              // the eid the row holds
    if (box) { img.width = box.w; img.height = box.h }

With `width` and `height` set, the browser reserves the right rectangle, so the
layout does not shift as the images load; `aspect-ratio: ${box.w} / ${box.h}`
does the same for a fluid layout. The platform reads only the header: no
orientation, no capture date, no camera.

## Showing an upload from your own component

Store the upload's eid in a component the app declares:

    await apply({ photo: { caption: 'the cake', blob: file.eid } })

`photo` is the app's own component, declared in its `vocab.json`:

    { "$defs": {
        "photo": { "properties": {
          "caption": { "type": "string" },
          "blob":    { "type": "string" } } } } }

An app's own properties are `text`, `number`, `bool`, `time` or `url`, so a
blob's eid is stored as text. Then build the image URL from the eid, as a
relative URL: `img.src = './api/blob/' + p.photo.blob`.

`file.url` can be used directly as an `<img src>` as soon as the upload returns,
on the page where the person picked the file. Do not save it in a row: it is
path-absolute and includes this app's slug (`/photos/api/blob/9f2a…`), so a row
holding it breaks when someone installs a copy of the app at another address.

## HTTP endpoints for uploads: `./api/blob`

`upload` sends one POST, and the bytes are read back with one GET — ordinary
same-origin HTTP requests, which `curl` or a worker can also make.

    POST ./api/blob
    content-type: image/jpeg     ← the blob's own type, minus parameters
    x-yak-name: cake.jpg         ← optional, percent-encoded, then the bytes
    → {"eid": "9f2a…", "url": "/photos/api/blob/9f2a…",
       "mime": "image/jpeg", "bytes": 51234, "w": 1600, "h": 1200}

    GET ./api/blob/9f2a…    → the bytes
    Range: bytes=100-199    → 206, those 100 bytes

A header must be ASCII and a file's name may not be, so the name is sent
percent-encoded and the endpoint decodes it; the mime is kept to 120 characters
and the name to 200. GET and HEAD return the mime and name from the attachment
row. A single `Range: bytes=…` request gets `206` and `Content-Range`; a range
beyond the end gets `416`. Responses include a revalidating cache header,
`content-security-policy: sandbox; script-src 'none'` and
`x-content-type-options: nosniff` — an uploaded HTML page or SVG opened in a tab
cannot run any script. A path that is not 64 hex characters, or bytes this app
never received, is `404 no_such_file`.

## Large files: uploading in parts and resuming

`upload` sends a file of 32 MiB or more in parts, four at a time, and an
interrupted upload resumes instead of starting over. A part that fails because
the connection dropped or the phone went to sleep is sent again once the browser
is back online. If the tab closed, uploading the same file again, from any tab
or device, sends only the parts that had not arrived. The page code does not
change: it calls the same `upload(file)` and gets the same result.

An upload in parts is identified by the file's SHA-256 before it begins, so the
page reads the whole file once first to compute it. `digest(file)` from the
client library computes that hash, which is the eid the upload will return.

An upload nobody finishes is discarded after seven days, and its parts never
count toward the space's photos and files.

The endpoints, for writing your own client:

    POST ./api/blob/9f2a…          ← the file's SHA-256; its size, name, type
    {"bytes": 41943040, "name": "talk.mp4", "mime": "video/mp4"}
    → {"part": 8388608, "need": [1, 2, 3, 4, 5]}

    PUT ./api/blob/9f2a…/3         ← part 3: from byte 2 × part, part bytes
    x-yak-state: 1f83d9ab…         ← the hash state after bytes 0 to 2 × part
    → {"n": 3}

    POST ./api/blob/9f2a…          ← again, once every part is in
    → {"eid": "9f2a…", "url": "/photos/api/blob/9f2a…/…",
       "mime": "video/mp4", "bytes": 41943040}

`need` lists the parts not received yet. Every part but the last is `part`
bytes, a whole number of MiB. Every call may be sent again. A POST when nothing
is missing assembles the parts and answers what `POST ./api/blob` answers.

Each part is hashed as it arrives, continuing from the SHA-256 state named by
its `x-yak-state` header: the eight 32-bit words of the hash after every byte
before the part, as 64 hex characters, the state an incremental SHA-256
implementation holds between pieces. The first part starts from SHA-256's own
initial value (`6a09e667bb67ae85…5be0cd19`). The parts are assembled only when
each part's starting state matches the end of the part before it and the last
part ends at the file's SHA-256, so the bytes stored are the bytes the address
names; a part that does not match is dropped with a `400`, as is a part of the
wrong length. `409 upload_gone` means the upload is no longer in progress (seven
days passed): POST again to start it over. The space's free storage and the
app's size limit are checked against `bytes` when the upload begins, refused
with the same `space_full` and `too_large`, and the app's accepted type once the
file is complete, refused with the same `415`.

Deployed audio and video files use media types from their extensions: `.mp4`,
`.m4v`, `.mov`, `.webm`, `.mp3`, `.m4a`, `.aac`, `.wav`, `.ogg`, `.flac`, and
HLS `.m3u8` and `.ts` are recognized. File responses also support HEAD and byte
ranges, so a browser can start playback and seek without downloading the whole
file again.

## Upload and read permissions

Uploading is a write and reading the bytes is a read, so the app's `access`
decides both, exactly as it decides `apply` and `query`: on `public` anyone with
the link reads and an owner or editor uploads; on `open` anyone with the link
does both, so a guest at a party can add their own photo without signing in; on
`private` members read and an owner or editor uploads.

Check whether the person may upload before they pick a file, not after the
upload fails:

    let who = await me()
    if (!who.writes) {
      show(who.signIn ? `<a href="${who.signIn}">Sign in to add one</a>`
                      : 'Only members of this app can add one.')
    }

A refused upload throws an error carrying the platform's own message:
`sign in to change this app` to a stranger, with `signIn` on it, and, to a
member who is only a viewer,
`you can read this app but not change it — its owner can make you an editor`:

    try { await upload(file) }
    catch (e) { e.signIn ? location = e.signIn : show(e.message) }

An app can keep uploads to fewer people than its `access` lets write, with a
`floor` in its `vocab.json`'s `blob`: `person` (anyone signed in), `viewer`,
`editor` or `owner`, the same levels a component's `floor` takes:

    { "blob": { "floor": "editor" }, "$defs": { … } }

An `open` library that answers anyone's questions keeps its documents to its
editors this way. An upload from below the floor is refused before any bytes are
kept, naming `attachment`, the row an upload writes:

    someone signed out may not write attachment in <app> — editor is the least that may

On an `open` app a signed-out guest's upload has no `created.by` at all. If the
gallery shows who added each photo, ask them for a name and save it in your own
row.

## Deleting an upload

To delete an upload, delete its content row, at the upload's eid:

    await apply({ entity: { eid: file.eid }, $delete: true })

The same write deletes its `attachment` row, and every other attachment that
points at it by `blob`. From that write on, `./api/blob/<eid>` and every
`file.url` it handed out answer `404 no_such_file`, with two exceptions on an
app anyone may read (`public` or `open`): the platform caches its check that a
`file.url` may be served for 30 seconds, so that URL can go on serving the bytes
for up to 30 seconds after the delete, and a browser that already loaded a
`file.url` keeps its own copy, because that response is cached as immutable.
After the write commits, the platform deletes the bytes from the app's storage.
There is no undo. A page listing `.attachment` deletes `f.attachment.blob`, not
the attachment row's own eid: deleting the attachment row alone removes the name
and keeps the bytes.

Delete your own row that points at the upload in the same batch, so the page
never draws a picture that is gone:

    await apply([
      { entity: { eid: p.entity.eid }, $delete: true },   // your photo row
      { entity: { eid: p.photo.blob }, $delete: true },   // the upload
    ])

The bytes stay while a row still names them: an attachment that points at them
by `artifact` (a picture a model made is one), or the content row written again
by an upload of the same file before the platform deletes them. Nothing else
keeps them: your own properties holding the eid are text, and the platform does
not read your files for `./api/blob/` addresses, so delete or change what still
uses an upload before you delete it.

Deleted bytes stop counting toward the space's storage limit for photos and
files. An app that replaces its uploads (a video rendered again, a photo
cropped) deletes the ones it no longer uses the same way: list `.blob`, keep the
eids its files and rows still use, and delete the rest, from a page with `apply`
or from the assistant with `graph_apply`.

Whoever may delete an upload's row may delete the upload: an owner or editor any
upload, and on an `open` app, anyone else only what they uploaded. A refused
delete throws like any refused `apply`. The same bytes sent twice are one
upload, so deleting it deletes it for everyone who sent it.

Deleting the app (`app_delete`) puts it in the trash and keeps every byte of it
for 30 days, so `app_restore` brings the uploads back with everything else.
After that — or immediately, with `forever: true` — the bytes are deleted: every
object under the app's own prefix, uploads included, and there is no undo.

## Size and type limits, and downscaling images

yaks.app sets no size or type limit of its own on an upload; the only limit is
the space's storage for photos and files. An app's author sets which files the
app accepts, in its `vocab.json`, with JSON Schema's own keywords for a file's
contents:

    {
      "blob": { "maxLength": 10485760, "contentMediaType": "image/*" },
      "$defs": { … }
    }

- `maxLength` is the largest size of one file, in bytes.
- `contentMediaType` is the accepted type: one media type, or a list of them
  (`["image/*", "application/pdf"]`), where `image/*` accepts every image type,
  as in an `<input accept>`.

If either is left out, there is no limit of that kind. The type is detected from
the bytes, never from the name or the type the upload declares, so a web page
named `cake.png` is not an image. A file that is too large is refused with
`413`, code `too_large`, before any of it is read; a file of another type with
`415`, code `unsupported_media_type`. Each carries a message a guest can act on:
"this app takes image/*, and this file is application/pdf". For an upload in
parts, the size is checked when it begins and the type once it is complete. A
letter's attachments are checked against the same keywords, and one the app does
not accept is left off the letter. An empty body is a 400, code `no_bytes`.

A phone photo is several megabytes, so a page that shows images should downscale
them before uploading, which makes them faster to send and to show:

    // A picture, at most 1600px on its long side, as a jpeg.
    let smaller = async (file, max = 1600) => {
      if (!file.type.startsWith('image/')) return file
      let bmp = await createImageBitmap(file)
      let scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
      let cv = new OffscreenCanvas(
        Math.round(bmp.width * scale),
        Math.round(bmp.height * scale),
      )
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height)
      bmp.close()
      return await cv.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
    }

    await upload(await smaller(file), { name: file.name })

Three details of that function matter. `Math.min(1, …)` never enlarges a small
image. A `Blob` from a canvas has no name, so pass the original's, or the
attachment row will have none. And resized bytes are new bytes: a downscale with
a different `max` or `quality` next time produces a different hash and uploads
again, so choose the values once and keep them.

A `413` with code `space_full` means the space is out of storage, with a message
naming the space; changing the file will not fix it. There is no server-side
resizing, so downscaling happens only in the page.

## Drag-and-drop and multiple files

Files arrive from a file input or from a drag-and-drop. Both give you a
`FileList`:

    let took = async (files) => {                 // one at a time
      for (let file of files) await add(file)
    }
    drop.addEventListener('dragover', (e) => e.preventDefault())
    drop.addEventListener('drop', (e) => {
      e.preventDefault()
      took(e.dataTransfer.files)
    })

`dragover` must call `preventDefault` or the browser opens the file instead of
passing it to the page, and uploading one at a time keeps a dropped folder of
twenty photos from making twenty requests at once.

## Example: a complete photo gallery

The whole page: pick files, downscale them, upload, check for an existing row
before writing one, then render the gallery with each image's space reserved.

    <!doctype html>
    <meta charset="utf-8" />
    <title>The wall</title>
    <input type="file" id="pick" accept="image/*" multiple />
    <p id="say"></p>
    <div id="wall"></div>
    <script type="module">
      import { apply, me, query, subscribe, upload }
        from './api/client.js'

      let pick = document.getElementById('pick')
      let wall = document.getElementById('wall')
      let say = (words) => document.getElementById('say').textContent = words
      // smaller() is the downscale from the section above.

      let add = async (file) => {
        try {
          say(`sending ${file.name}…`)
          let sent = await upload(await smaller(file), { name: file.name })
          // Identical bytes are stored once; our photo rows are not.
          // Check before writing one, or the photo is shown twice.
          let [seen] = await query(`.photo.blob=${sent.eid}`)
          if (!seen) {
            await apply({ photo: { caption: file.name, blob: sent.eid } })
          }
          say('')
        } catch (e) {
          e.signIn ? location = e.signIn : say(e.message)
        }
      }

      pick.addEventListener('change', async () => {
        for (let file of pick.files) await add(file)
        pick.value = ''
      })

      // The photos and each image's size, in one subscription, redrawn on
      // every change — including one made on another device while this
      // page is open.
      subscribe('.photo|.image', (rows) => {
        let size = new Map(rows.filter((r) => r.image)
          .map((r) => [r.entity.eid, r.image]))
        wall.replaceChildren(...rows.filter((r) => r.photo).map((p) => {
          let img = document.createElement('img')
          img.src = `./api/blob/${p.photo.blob}`
          img.alt = p.photo.caption || ''
          img.loading = 'lazy'
          let box = size.get(p.photo.blob)
          if (box) { img.width = box.w; img.height = box.h }
          return img
        }))
      })

      // Show the input only to someone this app accepts a write from,
      // checked after the subscription starts rather than before it.
      let who = await me()
      if (!who.writes) {
        pick.remove()
        say(who.signIn ? 'Sign in to add a photo.' : 'Look only.')
      }
    </script>

The important line is the check before the write: when two visitors send the
identical image, the platform stores one blob and one `attachment` row, but a
`photo` row the app declares is a separate row, and two of them show as two
pictures in the gallery. The photos and their sizes come from one subscription,
so the page loads its data in one round trip and a photo added later arrives
with its size ([Performance](./speed.md)).

## Public files: `publish`

A **public file** is a file an app publishes at a path under its own URL. From
then on that URL serves the file to anyone, before the app's worker runs and
regardless of the app's `access`. So a private app can put a page on the public
web without writing any authentication of its own: a private blog editor
publishes its posts, a private notebook publishes one page for a friend.

    import { publicFiles, publish, unpublish } from './api/client.js'

    let page = new Blob([html], { type: 'text/html; charset=utf-8' })
    let post = await publish(page, 'posts/hello')  // at the path you choose
    let link = await publish(page)                 // at a new UUID path
    // each → {path, url, sha, mime, size}; url is where it answers
    await unpublish('posts/hello')                 // the app serves the path again
    let all = await publicFiles()                  // every file it published

- **A path** is from the app's root with no leading slash, in segments of
  letters, digits, `-`, `_` and single dots. It is never under `api/` or a
  segment starting with `_`, and never `index.html` at the root, which would be
  served instead of the app to its own members too. `posts/hello/index.html`
  answers at `posts/hello/`.
- **With no path**, the file goes to a new UUID path: a link known only to the
  people you give it to, and anyone holding it can pass it on.
- **Its type** is the Blob's, so a page goes in a Blob of `text/html`; with
  none, the path's extension decides. A page is served with the reporter and, on
  the free plan, the badge, as every page of the app is.
- **Publishing the same path again replaces the file.** It is part of no
  release, so a deploy or a rollback never moves it.
- **Only the app's owner and editors publish**, as writing its files is theirs:
  never a visitor of an `open` app, a guest invited to the one app, or a
  sandboxed copy's page.
- **It is static**: the bytes as published, the same for everyone. To show newer
  rows, publish the page again. Its scripts run on the app's own address, so
  publish only what you would deploy.
- Each is up to 25 MiB, counted against the space's photos and files.

The HTTP endpoints, under the app's own `/api/`:

    PUT    ./api/public/<path>   the bytes, typed by their content-type
    POST   ./api/public          the same, at a new UUID path
    DELETE ./api/public/<path>
    GET    ./api/public          → [{path, url, sha, mime, size}]

## Limitations

- **No server-side resizing and no thumbnails.** What you upload is what is
  served, at one size. Downscale in the page.
- **No listing of the bucket.** `.attachment` is the listing of uploads, and
  bytes that no row names are not served at any address. To delete an upload's
  bytes, delete its content row (Deleting an upload, above).
- **No `image` for anything but png, jpeg, gif and webp** — a pdf, an svg or a
  heic uploads, but has no size recorded.
- **No progress events.** `upload` returns when it is done, so a page shows
  progress per file, not within one.

The guide's map, with everything else an app can do, is at
<https://yaks.app/docs.md>.
