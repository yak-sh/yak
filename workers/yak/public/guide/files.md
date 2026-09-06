# Files and pictures

Bytes are the one thing an app's store does not take in a bundle. This page is
the file half: how you write the app's OWN files with `app_files`, then what
`upload` takes and answers for the bytes its visitors send, where those are
served from, the two rows one upload writes, who may send and who may look, the
20 MB ceiling and the downscale that gets a phone photo under it — and a gallery
that does not show the same picture twice.

## app_files, and what a write answers

The app's own files — `index.html`, the css and js beside it, `vocab.json` — are
written with `app_files`. **Bytes are the write**: a `path` and a `content`, or
a `files: [{path, content}, …]` batch, needs no `op` at all.

**Every write answers what was stored**, so a file transcribed by hand is
checked in the call that made it rather than once the app serves broken:

    wrote index.html → https://jeff.yaks.app/recipes/index.html
      — 4213 bytes, sha256 9f2a…

A `.json` file is parsed in the same breath and the answer says `parsed`, or
says it is not with the position —
`NOT valid JSON — Expected ',' or '}' after
property value in JSON at position 45971`
— which is the bracket, named. The verdict is a sentence, not a refusal: the
file still lands.

**`op: patch` edits one file in place** — `path`, `find`, `replace`. `find` is
exact text, not a pattern, and must match exactly once; anything else refuses
saying how many matches there were, so lengthen `find` until it names one place.
An empty `replace` removes the text. It is the cheap fix for the one line that
came out wrong, where the alternative is re-sending the whole file.

**`op: fetch` writes a URL's body to a path** — `path` and `url`, https only,
under the same 20 MB ceiling. It is how a third-party library is vendored into
the app rather than transcribed:

    app_files(app, op: 'fetch', path: 'chess.js',
              url: 'https://cdnjs.cloudflare.com/…/chess.min.js')
    → fetched … → https://jeff.yaks.app/chess/chess.js — 15234 bytes,
      sha256 3c1f…, text/javascript, integrity sha256-PB8…=

The `integrity` is the same digest in the spelling a `<script integrity>` wants,
so a page that goes on loading the file from a CDN can be pinned to the bytes
this fetch got. What the app SERVES it as comes from the path's extension, not
from the response — name it `.js` and it is javascript.

## Every write keeps what it replaced

**No write and no delete throws bytes away.** Before anything lands at a path,
whatever was there is kept — addressed by its own sha256, beside the app — and
noted in that path's history. So the file you just overwrote is one call away,
and you never have to remember what it used to say.

    app_files(app, op: 'history', path: 'index.html')
    → index.html in jeff/recipes:
      now — 4213 bytes, sha256 9f2a…
      - until 2026-09-06T14:20:11Z — 3980 bytes, sha256 c41d…, by Jeff
      - until 2026-09-04T09:02:47Z — 1204 bytes, sha256 7b19…, by Jeff

An entry reads **"the file was these bytes until then"** — the time and the name
are the write that took them away. So the top entry is one step back from now,
and `now` is what the app is serving this second.

**`op: restore` puts one back.** With just a `path` it is the newest entry —
undo the last write:

    app_files(app, op: 'restore', path: 'index.html')

`sha` names one exactly, off the history. `at` asks for a moment —
`at: '2026-09-05T00:00:00Z'` puts the file back to what it was serving then,
which is the useful form when what you know is _when_ it was still right and not
_what_ it said.

A restore is **itself a write**, so the bytes it replaces are kept in turn and a
restore can be undone by another. Nothing rewrites the history.

The bytes are kept for **30 days**, and always at least the last 20 versions of
a file, whichever reaches further back. After that a version is let go — and
only ever a version nothing else needs: bytes a kept deploy names are never
removed, so `app_rollback` keeps working for every version `app_versions` still
lists.

This is the FILE-sized way back. Beside it: `app_rollback` puts back every file
of a whole deploy at once, `store_restore` puts back everything the app has
_saved_, and `app_restore` brings back an app that was deleted.

## An icon for the home screen

Write an **`icon.png` beside `index.html`** — square, 512×512, on its own
background rather than transparent — and the app has an icon everywhere. The
file is the setting; there is nothing else to call. Bytes are not text, so it
goes in as `base64` in place of `content`, or with `op: fetch` from a URL:

    app_files(app, files: [{path: 'icon.png', base64: '<the bytes>'}])

The page is served with the two links an installed app needs already in its
head, at the app's own root:

    <link rel="apple-touch-icon" href="/recipes/icon.png">
    <link rel="manifest" href="/recipes/manifest.webmanifest">

iOS reads the first and nothing else — an icon named only in a manifest is not
the one it uses — while everything else reads the second, which is generated
from the app: its title as the `name`, its own address as `start_url` and
`scope`, `display: standalone`, the icon at 512 and 192, and the colour the page
states in `<meta name="theme-color">` where it states one.

**What the page declares is kept.** Each link is added only where the page has
none, so an app that writes its own `apple-touch-icon` keeps it and still gets
the manifest link, and an app that ships its own `manifest.webmanifest` is
served that file rather than the generated one.

Until an app writes an icon, `icon.png` answers the platform's own tile, so an
app somebody keeps on their phone is never a blank square. Transparency is the
one trap: iOS fills a transparent icon with solid black, so give the picture a
ground of its own.

## upload, and what it answers

`upload` is on the client every app is served:

    import { upload } from './api/client.js'
    let file = await upload(input.files[0])

It takes a `File` off an `<input type=file>`, or any `Blob` — one a canvas made,
one a `fetch` returned. A second argument names it:
`upload(blob, { name: 'cake.jpg' })`. A `File` carries its own name; a bare
`Blob` has none unless you say one.

The answer is one object:

    { eid:   '9f2a…',                      // the bytes' own address
      url:   '/photos/api/blob/9f2a…',     // where this app serves them
      mime:  'image/jpeg',                 // what the page said they are
      bytes: 51234,                        // how many there are
      w: 1600, h: 1200 }                   // pictures only

`mime` is the blob's own `type` — the browser fills it in for a file off an
input — and `application/octet-stream` when the blob has none. `w` and `h` are
there only when the bytes are a picture that states its size; otherwise both
keys are simply absent.

## Content addressing, and what follows from it

`eid` is the SHA-256 of the bytes, in hex. Nothing else decides it: not the
name, not the mime, not who sent it. Three things follow.

**The same file twice is one upload.** Send the same photo from two pages, two
devices, or twice from one form, and the second send lands on the same eid, the
same object, and the same row — so a page need not remember what it has sent; it
may send again and read the answer.

**The bytes at an address can never change**, so `GET ./api/blob/<eid>` is
served `cache-control: public, max-age=31536000, immutable`.

**The address is not a secret.** Anyone who may read the app may read any blob
in it, and someone holding the identical file can compute its eid without
asking. Never use a blob address as a capability. What content addressing does
not save is the sending: the door reads every byte to hash them, so re-uploading
a 4 MB photo costs 4 MB every time.

## The two rows one upload writes

The door writes two entities through the app's own `/apply`, with the uploader
vouched for — so `.created!` names them the way it names any other row. The
**content** row sits at the bytes' own eid and says what is true of the bytes;
the **use** row says what this app calls them:

    { entity: { eid: '9f2a…' },
      blob:  { bytes: 51234 },
      image: { w: 1600, h: 1200 } }        // pictures only

    { entity: { eid: '…derived…' },
      attachment: { blob: '9f2a…', mime: 'image/jpeg', name: 'cake.jpg' } }

The use row's eid is derived from the content's — `sha256("attachment:" +
sha)`
— so it is stable without being the same eid. That is what makes a second upload
of the same bytes rename the row it has rather than write a second one saying
the same thing. A component may not point at its own entity, which is the other
reason the two are apart.

The rename is a PATCH: an upload that names nothing keeps the name it had. Send
`cake.png`, then the same bytes as `the cake.png`, then a third time off a
canvas with no name at all, and the row says `the cake.png`.

**List the use, not the content.** `query('.attachment!')` is every file the app
holds:

    for (let f of await query('.attachment!')) {
      draw(`./api/blob/${f.attachment.blob}`, f.attachment.name)
    }

`.blob!` is not that list — a long `doc.body` is a blob row too.

## What a picture measures

`image` sits on the CONTENT row — at the very eid your own row points at —
because a dimension is a fact about the bytes, however many attachments name
them. The door reads it out of the file's own header and never by decoding: png,
jpeg, gif and webp each state their size in the first few dozen bytes. Anything
else gets no `image` at all — a guess would be worse than silence, since a page
can ask the bitmap itself but cannot un-believe a row. A header stating a zero
is a broken file, and gets none either.

So a wall holds each photo's space open before a single byte of it arrives:

    let size = new Map((await query('.image!'))
      .map((i) => [i.entity.eid, i.image]))
    let box = size.get(p.photo.blob)              // the eid the row holds
    if (box) { img.width = box.w; img.height = box.h }

Two attributes and the browser reserves the right rectangle, so the page does
not jump as the pictures land; `aspect-ratio: ${box.w} / ${box.h}` does the same
for a fluid layout. The header is all the door reads — no orientation, no
capture date, no camera.

## Drawing a picture from a row

Point your own row at the bytes by their eid:

    await apply({ photo: { caption: 'the cake', blob: file.eid } })

(`photo` is the app's own component —
`{"photo": {"caption": "text", "blob":
"text"}}` in its `vocab.json`. An app's
own columns are `text`, `number`, `bool`, `time` or `url`, so a blob's address
is held as text.) Then build the address from the eid, relative:
`img.src = './api/blob/' + p.photo.blob`.

`file.url` is fine to drop straight into an `<img src>` the moment the upload
answers — it is the picture the person just picked, on the page they picked it
on. It is the wrong thing to SAVE: it is path-absolute and carries this app's
slug (`/photos/api/blob/9f2a…`), so a row holding it breaks the day someone
installs a copy of the app at another address.

## The doors underneath

`upload` is one POST and the bytes come back at one GET — ordinary same-origin
HTTP, which `curl` or a worker can speak too.

    POST ./api/blob
    content-type: image/jpeg     ← the blob's own type, minus parameters
    x-yak-name: cake.jpg         ← optional, percent-encoded, then the bytes
    → {"eid": "9f2a…", "url": "/photos/api/blob/9f2a…",
       "mime": "image/jpeg", "bytes": 51234, "w": 1600, "h": 1200}

    GET ./api/blob/9f2a…    → the bytes

A header is ASCII and a file's name is not, so the name rides percent-encoded
and the door decodes it; the mime is kept to 120 characters and the name to 200.
The GET answers with the mime and the name off the attachment row, the immutable
cache header, `content-security-policy: sandbox; script-src 'none'` and
`x-content-type-options: nosniff` — an uploaded HTML page or SVG opened in a tab
is inert. A path that is not 64 hex characters, or bytes this app never took, is
`404 no_such_file`.

## Who may upload, who may read

Uploading is a write and reading the bytes is a read, so the app's `access`
decides both, exactly as it decides `apply` and `query`: on `public` anyone with
the link reads and an owner or editor uploads; on `open` anyone with the link
does both, so a guest at the party adds their own photo without signing in; on
`private` members read and an owner or editor uploads.

Ask before they pick, not after they wait:

    let who = await me()
    if (!who.writes) show(`<a href="${who.signIn}">Sign in to add one</a>`)

A refused upload throws the platform's sentence — `sign in to change this app`
to a stranger, carrying `signIn`, and
`you can read this app but not change it
— its owner can make you an editor` to
a member who is only a viewer:

    try { await upload(file) }
    catch (e) { e.signIn ? location = e.signIn : show(e.message) }

On an `open` app a signed-out guest's upload has no `created.by` at all. If the
wall wants a byline, ask them for a name and save it in your own row.

## What deleting removes

Deleting the app (`app_delete`) puts it in the trash and keeps every byte of it
for 30 days, so `app_restore` brings the uploads back with everything else.
After that — or straight away, with `forever: true` — the bytes go: every object
under the app's own prefix, uploads included, and there is no undo. Nothing else
removes bytes. Tombstoning your `photo` row removes your row. Tombstoning the
content row at the sha removes the `blob`/`image` row and cascades to the
`attachment` row naming it — and the bytes stay in the bucket, still served at
`./api/blob/<eid>` to anyone holding the address, now with no mime or name to
answer with. An upload is permanent for the life of the app.

## 20 MB, and the downscale

**One upload is 20 MB at most.** The door refuses twice — once on the
`content-length` before it reads anything, once on the bytes it got — with
`413`, code `too_large`, and a sentence a guest can act on: "that file is too
big to send — try a smaller one". An empty body is a 400, code `no_bytes`. A
phone photo is routinely over the ceiling, so downscale before you send:

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

A second `413` is possible on a free-tier space out of room — code `space_full`,
with a sentence naming the space; nothing about the file will fix that one.
There is no server-side resizing, so the page's downscale is the whole of it.

## Dropping files, and more than one

An input is one door; a drop is the other. Both hand you a `FileList`:

    let took = async (files) => {                 // one at a time
      for (let file of files) await add(file)
    }
    drop.addEventListener('dragover', (e) => e.preventDefault())
    drop.addEventListener('drop', (e) => {
      e.preventDefault()
      took(e.dataTransfer.files)
    })

`dragover` must call `preventDefault` or the browser opens the file instead of
giving it to you, and uploading in sequence keeps a dropped folder of twenty
photos off twenty requests at once.

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

      // Only offer the input to someone this app takes a write from.
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

      // What each picture measures, by the eid the rows already hold.
      let size = new Map((await query('.image!'))
        .map((i) => [i.entity.eid, i.image]))

      // And the wall, redrawn on every change — including one made on
      // their phone while this page is open.
      subscribe('.photo!', (photos) => {
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

The line that earns its keep is the look-before-you-write: two visitors sending
the identical picture are one blob and one `attachment` row for free, but a
`photo` row of your own is a row, and two of them are two pictures on the wall.
On a wall left open for hours, read `.image!` inside the subscription, so a
photo added later gets its box too.

## What is not here

- **No server-side resizing and no thumbnails.** What you upload is what is
  served, at one size. The page downscales.
- **No listing of the bucket** and **no deleting bytes** short of deleting the
  app. `.attachment!` is the listing; bytes nobody wrote a row about are
  reachable only by their address.
- **No `image` for anything but png, jpeg, gif and webp** — a pdf, an svg or a
  heic uploads fine and simply carries no size.
- **No progress events.** `upload` answers when it is done, so a page shows
  progress per file, not within one.

The whole guide, everything else an app can do, is at
<https://yaks.app/guide.md>.
