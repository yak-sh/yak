---
name: files
description: "Files and pictures (yaks.app). app_deploy's reload and the yak-release event, including a custom notice that keeps unsaved input; app_files — what a write returns, the patch and fetch ops, the history every write keeps and the restore that puts one back, the icon.svg that gives an app an icon on a home screen — then upload() for a file off an <input>: where the bytes are served back from, the attachment and image rows it writes, a big file sent in parts that resumes where it stopped, deleting an upload and its bytes, the vocab.json word that says which files the app takes, the downscale, and a gallery that never shows one picture twice."
---

# Files and pictures

Files are the one thing an app's store cannot hold directly: you cannot write
raw bytes into a component the way you write a title or a number. This page
covers files: how you write the app's own files with `app_files`, then what
`upload` accepts and returns for the files its visitors send, where those are
served from, the two rows one upload writes, who may send and who may look, how
to delete one, how the app says which files it takes and the downscale that
makes a phone photo quick to send — and a gallery that does not show the same
picture twice.

## app_files, and what a write returns

The app's own files — `index.html`, the css and js beside it, `vocab.json` — are
written with `app_files`. **Writing a file needs no `op`**: give it a `path` and
a `content`, or a list of them as `files: [{path, content}, …]`. The files stay
in a private draft until `app_deploy` releases them. A refused deploy leaves the
previous files, vocabulary and worker serving together.

`app_files(app, op: 'list')` lists their paths, each with the SHA-256 of its
bytes, then the live version and whether the draft differs from it: the number
`app_deploy` takes as `base`.

**Coming back to an app, read it in one call**: `app_files(app, op: 'read')`
answers every text file in it, each under its path and SHA-256, up to 64 KB in
all, and names the live version `app_deploy` takes as `base`. `paths: [...]`
reads just those files. The answer names each file it left out and why: not
text, no such file, or past the 64 KB. `paths` reads those in another call, and
`path` reads one whole, as its text alone.

**Every write reports what was stored**, so a file transcribed by hand is
checked in the call that made it before the app serves it:

    wrote index.html → https://yourname.yaks.app/recipes/index.html
      — 4213 bytes, sha256 9f2a…

A `.json` file is parsed as well, and the reply reports `parsed` — or reports
that it is not valid JSON, and where:
`NOT valid JSON — Expected ',' or '}' after
property value in JSON at position 45971`
names the bracket that is wrong. That is a note in the reply, not a refusal: the
file is still stored.

**`op: patch` edits one file in place** — `path`, `find`, `replace`. `find` is
exact text, not a pattern, and must match exactly once; anything else refuses
saying how many matches there were, so lengthen `find` until it names one place.
An empty `replace` removes the text. It is the cheap fix for the one line that
came out wrong, where the alternative is re-sending the whole file.

**`op: fetch` writes a URL's body to a path** — `path` and `url`, https only. It
is how a third-party library is vendored into the app rather than transcribed:

    app_files(app, op: 'fetch', path: 'chess.js',
              url: 'https://cdnjs.cloudflare.com/…/chess.min.js')
    → fetched … → https://yourname.yaks.app/chess/chess.js — 15234 bytes,
      sha256 3c1f…, text/javascript, integrity sha256-PB8…=

The `integrity` is the same digest written the way a `<script integrity>`
attribute expects, so a page that goes on loading the file from a CDN can be
pinned to the bytes this fetch got. The content type the app serves it as comes
from the path's extension, not from the response — name it `.js` and it is
javascript.

After `app_deploy`, local scripts, stylesheets, images, audio and video named by
the page use a URL under `./api/assets/<release>/`. Local import-map targets and
scopes, and relative URLs inside stylesheets and module scripts, stay in that
release too, except one that names `./api/`: a module's
`import … from './api/client.js'` still reaches the app's API. Those URLs keep
the same bytes even after another deploy or a rollback, so a browser may keep
them for a year. The page itself, app data, and the ordinary file addresses
still revalidate; they show the current release. A page with its own `<base>`
keeps its chosen URL behavior. App access is checked whenever a request reaches
the server, including a request for an older release.

## Pages and their addresses

Every HTML file is a page, at the address a static host gives it:

    index.html          /<app>/
    about.html          /<app>/about, and /<app>/about.html
    docs/index.html     /<app>/docs/ (and /<app>/docs is sent there)
    404.html            any page that is not there, answered 404

A path with no file behind it and no extension, `/<app>/recipes/42`, is a route:
without a `404.html` the app's `index.html` answers it, so a page that draws
itself at a place opens there. A missing stylesheet, script or picture is a 404,
never a page.

**Choosing what a missing page answers.** The same `wrangler.jsonc` can say it,
in Cloudflare's own key, `assets.not_found_handling`:

    { "assets": { "not_found_handling": "single-page-application" } }

- `"single-page-application"`: a route answers `index.html` with 200, even when
  a `404.html` exists.
- `"404-page"`: the nearest `404.html` answers 404, looking in the missing
  page's folder and then each folder above it; with none, a plain 404.
- `"none"`: a plain 404.

Unset, the rule above holds: the root's `404.html`, else `index.html` for a
route. A missing file with an extension is a 404 in every mode.

Each page resolves its relative URLs from its own folder, as anywhere on the
web: `docs/index.html` names `../style.css`, and reaches the client at
`../api/client.js`.

**Serving a folder.** A `wrangler.jsonc` beside `index.html` can name a folder
of the app for its addresses to serve, in Cloudflare's own words:

    { "assets": { "directory": "dist" } }

Then `dist/index.html` is `/<app>/`, and nothing outside `dist/` is on the web.
That is how a build sits beside the source that made it, and the code page shows
one from the sandbox to the address: <https://yaks.app/docs/code.md>.
`app_deploy` refuses a folder with no files in it.

## Releases and open pages

`app_deploy` makes the draft a new release. An already-open page keeps its
release's file URLs, but its data is live: a newer release may change the
contract that page uses. The platform checks on a release push through the app's
own socket, when that socket opens or reconnects, when the page becomes visible
again, and on a persisted `pageshow` (returning from the browser's back-forward
cache). The return checks run at most once a minute. A page with no socket that
never hides does not hear a release until one of those moments.

The level is derived **from the page's version to the newest version**, not just
from the last deploy:

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

### The default notice

The platform emits a cancelable **`yak-release` event on `window`**, once for
each newly noticed version. Its `detail` includes `{version, reload}`: `version`
is the latest release number and `reload` is `'optional'` or `'required'`. More
fields may be added; read the ones you use rather than assuming that is the
whole object.

Without a takeover, an optional notice says **"A new version of this app is
out"**, with Reload and Dismiss. Dismiss holds for that version in that tab. A
required notice says **"This app has changed. Reload to keep using it"**, with
Reload only, and stays until the person reloads. Neither notice covers the
page's input. **There is no automatic reload**, even for required changes: let
the person save or copy unfinished work before choosing Reload.

### Drawing your own notice

Call `event.preventDefault()` **synchronously in the listener** to suppress the
platform notice, then draw your own. Canceling is a takeover, not an
acknowledgment: your app now owes the person a notice and a Reload action. Keep
a required notice visible, and let only an optional notice be dismissed. Do not
clear or replace the form while drawing it.

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

## Every write keeps what it replaced

**No write and no delete throws bytes away.** Before anything lands at a path,
whatever was there is kept — addressed by its own sha256, beside the app — and
noted in that path's history. So the file you just overwrote is one call away,
and you never have to remember what it used to contain.

    app_files(app, op: 'history', path: 'index.html')
    → index.html in yourname/recipes:
      now — 4213 bytes, sha256 9f2a…
      - until 2026-09-06T14:20:11Z — 3980 bytes, sha256 c41d…, by the owner
      - until 2026-09-04T09:02:47Z — 1204 bytes, sha256 7b19…, by the owner

An entry reads **"the file was these bytes until then"** — the time and the name
are the write that took them away. So the top entry is one step back from now,
and `now` is what the app is serving this second.

**`op: restore` puts one back.** With just a `path` it is the newest entry —
undo the last write:

    app_files(app, op: 'restore', path: 'index.html')

`sha` names one exactly, off the history. `at` asks for a moment —
`at: '2026-09-05T00:00:00Z'` puts the file back to what it was serving then,
which is the useful form when what you know is _when_ it was still right and not
_what_ it contained.

A restore is **itself a write**, so the bytes it replaces are kept in turn and a
restore can be undone by another. Nothing rewrites the history.

The bytes are kept for **30 days**, and always at least the last 20 versions of
a file, whichever reaches further back. After that a version is let go — and
only ever a version nothing else needs: bytes a kept deploy names are never
removed, so `app_rollback` keeps working for every version `app_versions` still
lists.

This is the file-sized way back. Beside it: `app_rollback` puts back every file
of a whole deploy at once, `store_restore` puts back everything the app has
_saved_, and `app_restore` brings back an app that was deleted.

## An icon for the home screen

Write an **`icon.svg` beside `index.html`** and the app has an icon everywhere.
It is text, so it goes in as `content` like a page does:

    app_files(app, files: [{path: 'icon.svg', content:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' +
      '<rect width="24" height="24" fill="#4c773e"/>' +
      '<circle cx="12" cy="12" r="6" fill="#fdf7ee"/></svg>'}])

The platform draws it as `icon.png`, 512×512, which is the address a home screen
reads. The SVG is drawn when it is written, and refused with the reason if it
cannot be an icon:

- its `<svg>` has `xmlns="http://www.w3.org/2000/svg"`, as any SVG file needs;
- its `viewBox` is square;
- it has no `<text>`: there is no font to draw letters with, so a letter is a
  `<path>`;
- it parses.

Fill the square with a background of your own, a `<rect>` the size of the
`viewBox`. Where the picture leaves the square bare it is drawn on white,
because iOS fills a transparent icon with solid black.

The page is served with the two links an installed app needs already in its
head, at the app's own root:

    <link rel="apple-touch-icon" href="/recipes/icon.png">
    <link rel="manifest" href="/recipes/manifest.webmanifest">

iOS reads the first and nothing else — an icon named only in a manifest is not
the one it uses — while everything else reads the second, which is generated
from the app: its title as the `name`, its own address as `start_url` and
`scope`, `display: standalone`, the icon at 512 and 192, and the colour the page
sets in `<meta name="theme-color">` where it sets one.

**What the app writes is kept.** Each link is added only where the page has
none, so an app that writes its own `apple-touch-icon` keeps it and still gets
the manifest link, and an app that ships its own `manifest.webmanifest` is
served that file rather than the generated one. An `icon.png` of the app's own
is served in place of the drawing: a picture fetched with `op: fetch`, or one
`sandbox_ship` copies in. A picture is read the way a browser would read it when
it is written, and one that does not decode is refused: a PNG's bytes cannot be
written out by hand, so an icon an assistant makes is an SVG.

Until an app writes an icon, `icon.png` serves the platform's own default tile,
so an app somebody keeps on their phone is never a blank square.

## upload, and what it returns

`upload` comes from the client library every app is served:

    import { upload } from './api/client.js'
    let file = await upload(input.files[0])

It accepts a `File` from an `<input type=file>`, or any `Blob` — one a canvas
made, one a `fetch` returned. A second argument names it:
`upload(blob, { name: 'cake.jpg' })`. A `File` carries its own name; a bare
`Blob` has none unless you give it one.

It returns one object:

    { eid:   '9f2a…',                      // the bytes' own address
      url:   '/photos/api/blob/9f2a…',     // where this app serves them
      mime:  'image/jpeg',                 // the type the browser reported
      bytes: 51234,                        // how many there are
      w: 1600, h: 1200 }                   // pictures only

`mime` is the blob's own `type` — the browser fills it in for a file off an
input. When the type is empty or `application/octet-stream`, a recognized
filename supplies it instead (`video/mp4` for `.mp4`, `audio/mpeg` for `.mp3`).
An unknown name gets `application/octet-stream`. `w` and `h` are there only when
the bytes are a picture that declares its size; otherwise both keys are simply
absent.

## Content addressing, and what follows from it

`eid` is the SHA-256 of the bytes, in hex. Nothing else decides it: not the
name, not the mime, not who sent it. Three things follow.

**The same file twice is one upload.** Send the same photo from two pages, two
devices, or twice from one form, and the second send lands on the same eid, the
same object, and the same row — so a page need not remember what it has sent; it
may send again and read what comes back.

**The bytes at an address can never change.** The mime and filename can change
if the file is uploaded again, so `GET ./api/blob/<eid>` redirects to a URL that
also names that representation. The alias revalidates, and the versioned URL
keeps its MIME and filename. An app checks access before serving either URL; its
browser responses are private to that browser's cache.

**The address is not a secret.** Anyone who may read the app may read any blob
in it, and someone holding the identical file can compute its eid without
asking. So never treat a blob address as a permission to hold something private.
What content addressing does not save is the sending: the upload endpoint reads
every byte to hash them, so re-uploading a 4 MB photo costs 4 MB every time. A
file big enough to go up in parts is the exception (below): the page names it
first, and bytes the app already holds are not sent again.

## The two rows one upload writes

The upload endpoint writes two entities through the app's own `/apply` endpoint,
recorded as written by the person who uploaded — so `.created` names them the
way it names any other row. The **content** row sits at the bytes' own eid and
records what is true of the bytes; the **use** row records the name this app
gives them:

    { entity: { eid: '9f2a…' },
      blob:  { bytes: 51234 },
      image: { w: 1600, h: 1200 } }        // pictures only

    { entity: { eid: '…derived…' },
      attachment: { blob: '9f2a…', mime: 'image/jpeg', name: 'cake.jpg' } }

The use row's eid is derived from the content's, as
`sha256("attachment:" + sha)`, so it is stable without being the same eid. That
is what makes a second upload of the same bytes rename the row that already
exists rather than write a second one holding the same facts. A component may
not point at its own entity, which is the other reason the two are apart.

The rename is a patch: an upload that names nothing keeps the name it had. Send
`cake.png`, then the same bytes as `the cake.png`, then a third time off a
canvas with no name at all, and the row's name is `the cake.png`.

**List the use, not the content.** `query('.attachment')` is every file the app
holds:

    for (let f of await query('.attachment')) {
      draw(`./api/blob/${f.attachment.blob}`, f.attachment.name)
    }

`.blob` is not that list — a long `doc.body` is a blob row too.

## A picture's width and height

`image` sits on the content row — at the very eid your own row points at —
because a size is a fact about the bytes, however many attachments name them.
The platform reads it out of the file's own header and never by decoding the
image: png, jpeg, gif and webp each declare their size in the first few dozen
bytes. Anything else gets no `image` at all — a guess would be worse than
nothing, since a page can measure the bitmap itself but cannot tell that a
stored number is wrong. A header declaring a zero is a broken file, and gets
none either.

So a wall holds each photo's space open before a single byte of it arrives:

    let size = new Map((await query('.image'))
      .map((i) => [i.entity.eid, i.image]))
    let box = size.get(p.photo.blob)              // the eid the row holds
    if (box) { img.width = box.w; img.height = box.h }

Two attributes and the browser reserves the right rectangle, so the page does
not jump as the pictures land; `aspect-ratio: ${box.w} / ${box.h}` does the same
for a fluid layout. The header is all the platform reads — no orientation, no
capture date, no camera.

## Drawing a picture from a row

Point your own row at the bytes by their eid:

    await apply({ photo: { caption: 'the cake', blob: file.eid } })

`photo` is the app's own component, declared in its `vocab.json`:

    { "$defs": {
        "photo": { "properties": {
          "caption": { "type": "string" },
          "blob":    { "type": "string" } } } } }

An app's own properties are `text`, `number`, `bool`, `time` or `url`, so a
blob's address is held as text. Then build the address from the eid, relative:
`img.src = './api/blob/' + p.photo.blob`.

`file.url` is fine to drop straight into an `<img src>` the moment the upload
returns — it is the picture the person just picked, on the page they picked it
on. It is the wrong thing to save in a row: it is path-absolute and carries this
app's slug (`/photos/api/blob/9f2a…`), so a row holding it breaks the day
someone installs a copy of the app at another address.

## The HTTP endpoints underneath

`upload` is one POST, and the bytes come back from one GET — ordinary
same-origin HTTP, which `curl` or a worker can call too.

    POST ./api/blob
    content-type: image/jpeg     ← the blob's own type, minus parameters
    x-yak-name: cake.jpg         ← optional, percent-encoded, then the bytes
    → {"eid": "9f2a…", "url": "/photos/api/blob/9f2a…",
       "mime": "image/jpeg", "bytes": 51234, "w": 1600, "h": 1200}

    GET ./api/blob/9f2a…    → the bytes
    Range: bytes=100-199    → 206, those 100 bytes

A header is ASCII and a file's name is not, so the name is sent percent-encoded
and the endpoint decodes it; the mime is kept to 120 characters and the name to
200. GET and HEAD return the mime and name from the attachment row. A single
`Range: bytes=…` request gets `206` and `Content-Range`; a range beyond the end
gets `416`. Responses include a revalidating cache header,
`content-security-policy: sandbox; script-src 'none'` and
`x-content-type-options: nosniff` — an uploaded HTML page or SVG opened in a tab
cannot run anything. A path that is not 64 hex characters, or bytes this app
never received, is `404 no_such_file`.

## Big files go up in parts, and resume

`upload` sends a file of 32 MiB or more in parts, four at a time, and an upload
that is cut short carries on instead of starting over. A part that fails because
the connection dropped or the phone went to sleep is sent again once the browser
is back online. If the tab closed, uploading the same file again, from any tab
or device, sends only the parts that had not arrived. The page changes nothing:
the same `upload(file)`, the same answer.

An upload in parts is named by the file's SHA-256 before it begins, so the page
reads the file once to compute it first. `digest(file)` from the client library
is that hash, the eid the upload will answer.

An upload nobody finishes is forgotten after seven days, and its parts never
count toward the space's photos and files.

The endpoints, for a client of your own:

    POST ./api/blob/9f2a…          ← the file's SHA-256, and what it is
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

Each part is hashed as it arrives, on from the SHA-256 state its `x-yak-state`
names: the eight 32-bit words of the hash after every byte before the part, as
64 hex characters, which a SHA-256 written to be fed in pieces holds between
them. The first part starts from SHA-256's own initial value
(`6a09e667bb67ae85…5be0cd19`). The parts are assembled only when each one's
state follows on from the one before it and the last ends at the address, so the
bytes kept are the bytes the address names; parts that do not are dropped with a
`400`, as is a part of the wrong length. `409 upload_gone` says the upload is no
longer under way (seven days passed): POST again to begin it anew. The space's
room and the most bytes the app takes are checked against `bytes` when it
begins, with the same `space_full` and `too_large`, and the type the app takes
once it is whole, with the same `415`.

Deployed audio and video files use media types from their extensions: `.mp4`,
`.m4v`, `.mov`, `.webm`, `.mp3`, `.m4a`, `.aac`, `.wav`, `.ogg`, `.flac`, and
HLS `.m3u8` and `.ts` are recognized. File responses also support HEAD and byte
ranges, so a browser can start playback and seek without downloading the whole
file again.

## Who may upload, who may read

Uploading is a write and reading the bytes is a read, so the app's `access`
decides both, exactly as it decides `apply` and `query`: on `public` anyone with
the link reads and an owner or editor uploads; on `open` anyone with the link
does both, so a guest at the party adds their own photo without signing in; on
`private` members read and an owner or editor uploads.

Ask before they pick, not after they wait:

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

On an `open` app a signed-out guest's upload has no `created.by` at all. If the
wall wants a byline, ask them for a name and save it in your own row.

## Deleting an upload

Delete the content row, at the upload's eid, and the upload is gone:

    await apply({ entity: { eid: file.eid }, $delete: true })

Its `attachment` row goes with it, and the platform deletes the bytes right
after, so `./api/blob/<eid>` and every `file.url` it handed out answer
`404 no_such_file`. There is no undo. A page listing `.attachment` deletes
`f.attachment.blob`, not the attachment row's own eid: deleting the attachment
row alone removes the name and keeps the bytes.

Delete your own row that points at the upload in the same batch, so the page
never draws a picture that is gone:

    await apply([
      { entity: { eid: p.entity.eid }, $delete: true },   // your photo row
      { entity: { eid: p.photo.blob }, $delete: true },   // the upload
    ])

The bytes stay while another attachment still points at them, by `blob` or by
`artifact` (a picture a model made is one). Nothing else keeps them: your own
properties holding the eid are text, and the platform does not read your files
for `./api/blob/` addresses, so delete or change what still uses an upload
before you delete it.

Deleted bytes stop counting toward the space's photos-and-files ceiling. An app
that replaces its uploads (a video rendered again, a photo cropped) deletes the
ones it no longer uses the same way: list `.blob`, keep the eids its files and
rows still use, and delete the rest, from a page with `apply` or from the
assistant with `graph_apply`.

Who may delete an upload is who may delete its row: an owner or editor any
upload, and on an `open` app, anyone else only what they uploaded. A refused
delete throws like any refused `apply`. The same bytes sent twice are one
upload, so deleting it deletes it for everyone who sent it.

Deleting the app (`app_delete`) puts it in the trash and keeps every byte of it
for 30 days, so `app_restore` brings the uploads back with everything else.
After that — or straight away, with `forever: true` — the bytes go: every object
under the app's own prefix, uploads included, and there is no undo.

## Which files the app takes, and the downscale

yaks.app puts no size or type of its own on an upload; the one bound is the
space's room for photos and files. Which files an app takes is for its author to
decide, in its `vocab.json`, in JSON Schema's own words for a file's bytes:

    {
      "blob": { "maxLength": 10485760, "contentMediaType": "image/*" },
      "$defs": { … }
    }

- `maxLength` is the most bytes one file may hold.
- `contentMediaType` is what it may be: one media type, or a list of them
  (`["image/*", "application/pdf"]`), where `image/*` takes every kind of
  picture, the way an `<input accept>` does.

Leave either out and anything is taken. The type is read off the bytes, never
off the name or what the upload says it is, so a web page called `cake.png` is
not a picture. A file too big is refused `413`, code `too_large`, before any of
it is read; one of another type `415`, code `unsupported_media_type`. Each
carries a message a guest can act on: "this app takes image/*, and this file is
application/pdf". In parts, the size is checked when it begins and the type once
it is whole. A letter's attachments are held to the same words, and one the app
does not take is left off the letter. An empty body is a 400, code `no_bytes`.

A phone photo is several megabytes, so a page that shows pictures downscales
them before it sends them, to be quick to send and to show:

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

Three things worth keeping in that shape. `Math.min(1, …)` never blows a small
picture up. A `Blob` off a canvas has no name, so pass the original's, or the
attachment row will have none. And resized bytes are new bytes: a downscale that
picks a different `max` or `quality` next time hashes differently and uploads
again, so pick your numbers once and leave them alone.

A `413` with code `space_full` says the space is out of room, with a message
naming the space; nothing about the file will fix that one. There is no
server-side resizing, so the page's downscale is the whole of it.

## Dropping files, and more than one

A file input is one way in; a drag-and-drop is the other. Both hand you a
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
giving it to you, and uploading one at a time keeps a dropped folder of twenty
photos from making twenty requests at once.

## A gallery, whole

Pick, downscale, upload, look before writing, then draw the wall with each
picture's space held open — the entire page.

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

      // Only offer the input to someone this app accepts a write from.
      let who = await me()
      if (!who.writes) {
        pick.remove()
        say(who.signIn ? 'Sign in to add a photo.' : 'Look only.')
      }

      let add = async (file) => {
        try {
          say(`sending ${file.name}…`)
          let sent = await upload(await smaller(file), { name: file.name })
          // The bytes dedupe themselves; a row of ours does not. Look
          // before writing one, or the photo hangs on the wall twice.
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

      // Each picture's size, by the eid the rows already hold.
      let size = new Map((await query('.image'))
        .map((i) => [i.entity.eid, i.image]))

      // And the wall, redrawn on every change — including one made on
      // their phone while this page is open.
      subscribe('.photo', (photos) => {
        wall.replaceChildren(...photos.map((p) => {
          let img = document.createElement('img')
          img.src = `./api/blob/${p.photo.blob}`
          img.alt = p.photo.caption || ''
          let box = size.get(p.photo.blob)
          if (box) { img.width = box.w; img.height = box.h }
          return img
        }))
      })
    </script>

The line worth keeping is the check before the write: two visitors sending the
identical picture are one blob and one `attachment` row for free, but a `photo`
row of your own is a separate row, and two of them are two pictures on the wall.
On a wall left open for hours, read `.image` inside the subscription, so a photo
added later gets its box too.

## What files do not do

- **No server-side resizing and no thumbnails.** What you upload is what is
  served, at one size. The page downscales.
- **No listing of the bucket** and **no deleting bytes** short of deleting the
  app. `.attachment` is the listing; bytes nobody wrote a row about are
  reachable only by their address.
- **No `image` for anything but png, jpeg, gif and webp** — a pdf, an svg or a
  heic uploads fine and simply carries no size.
- **No progress events.** `upload` returns when it is done, so a page shows
  progress per file, not within one.

The whole guide, everything else an app can do, is at
<https://yaks.app/docs.md>.
