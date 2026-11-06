---
name: library
description: "Document Q&A (yaks.app). Document Q&A, a public app where anyone with the link asks questions and gets answers with citations from a library of documents its owner and editors keep: open access with \"models\": \"open\", \"blob\": {\"floor\": \"editor\"} so only editors upload, uploading many PDF and Word files at once, watching their text extraction, adding documents from an agent with library_add, library_list, library_read and library_remove, keeping web articles with a worker route that fetches the page and uploads it as a document, full-text and semantic search, ./api/documents/ask with its citations, linking a cited article to its original address, and what limits a visitor's questions."
---

# Document Q&A

A **document Q&A app** answers questions from a library of documents: a church's
catechism and sermons, a club's rule book, a firm's policies. Its owner and
editors upload the documents and keep web articles; anyone with the link asks a
question and gets an answer that cites the document and page it came from.

Everything here is the platform's own: uploads extract their text, search reads
it, and `./api/documents/ask` answers from it. The app needs a `vocab.json` and
a page; an agent fills its library with the library tools, and a `worker.js`
lets its editors keep web articles from the page.

## The manifest: open, asking, editors upload

    { "models": "open",
      "blob": { "floor": "editor" } }

Make the app with `app_new(access: "open")`. Each line of the manifest does one
thing:

- **`access: "open"`** lets anyone with the link write the app. Asking a model
  is a write to the space's budget, so a `public` app answers its members only.
- **`"models": "open"`** lets anyone who may write the app ask its models, which
  on an `open` app is anyone with the link. Every answer spends the space's
  budget (<https://yaks.app/docs/models.md>, "Who may call a model").
- **`"blob": {"floor": "editor"}`** keeps uploads to the owner and editors.
  Without it, an `open` app takes a visitor's upload, and a visitor's PDF would
  become part of the library and be cited in answers. A visitor's upload is
  refused before any bytes are kept:

      someone signed out may not write attachment in <app> — editor is the least that may

Add the people who keep the library as editors with `member_add`. The owner is
an editor already.

## Filling the library from an agent

The connector's library tools (also the Operator's) add documents to an app's
store through the same upload a page makes, as the person asking, so the `blob`
floor holds: a visitor or viewer is refused, and nothing of theirs is kept.

- **`library_add`** adds up to 20 documents in one call. Each is one of `url`, a
  PDF, Word, OpenDocument or spreadsheet file, web page or plain text file
  fetched from the web; `attachment`, a file the person attached in their
  conversation with the Operator, which their message names as
  `attachment <id>`; or `base64` with `name`, the file's bytes. A fetched
  document keeps its address as `attachment.source`. A web page is kept as its
  article alone, without scripts, styles, menus, headers, footers, sidebars or
  forms, and is named by its title. `name` sets the name an answer cites, and
  `replaces` names a document this one takes the place of, which is removed once
  this one is added. A document is at most 32 MB, or the app's own `maxLength`.
- **`library_list`** lists every document with its eid, name, type, source and
  extraction: `reading`, `searchable` with its page count, or `failed` with the
  reason.
- **`library_read`** answers a document's extracted text, page by page, as
  search reads it.
- **`library_remove`** deletes documents by eid: the file, its row and its
  extracted text.

A site that answers with an error, whose `robots.txt` does not let `yaks.app`
read the address, or that asks not to be copied (`X-Robots-Tag` or
`<meta name="robots">` with `noarchive`, `noai` or `none`) is skipped, and the
answer says why for each one; the rest of the call goes on. A site's terms can
forbid copying where nothing machine-readable says so, so read them before
filling a library from a site. A page drawn by JavaScript has no text without
its scripts and is skipped; saving it from the browser as `.html` and sending
that works.

## Uploading many PDF and Word files

An upload of a PDF, Word `.docx`, `.odt`, spreadsheet, `.csv` or web page
(`.html`) extracts its text in the background into `document_page` rows that
search reads (<https://yaks.app/docs/files.md>, "Searching documents"). The
editor's page takes many files at once and uploads them one at a time:

    <input id="files" type="file" multiple
      accept=".pdf,.docx,.odt,.xlsx,.csv,.html" />
    <ul id="shelf"></ul>
    <script type="module">
      import { me, upload, query, subscribe } from './api/client.js'

      let who = await me()
      document.getElementById('files').hidden =
        !['owner', 'editor'].includes(who.role)

      document.getElementById('files').addEventListener('change', async (e) => {
        for (let file of e.target.files) await upload(file)
        e.target.value = ''
      })

      // Every document, and whether its text is ready.
      let draw = (rows) => {
        document.getElementById('shelf').replaceChildren(...rows.map((r) => {
          let li = document.createElement('li')
          li.textContent = r.attachment.name + ' — ' + (
            r.failed ? r.failed.reason
            : r.document_text ? r.document_text.pages + ' pages searchable'
            : 'reading…')
          return li
        }))
      }
      subscribe('.attachment&?document_text&?failed', draw)
    </script>

`me()` answers the person's `role`, so the file input shows for the owner and
editors and stays hidden for everyone else, whom the floor refuses anyway.
Uploading one file at a time keeps a dropped folder of fifty sermons from making
fifty requests at once. Extraction takes seconds for a text PDF and longer for a
scanned one; `document_text{blob, pages}` appears on the row when it is done,
and `failed{reason}` when it could not be read.

## Keeping web articles from the page

An editor keeps a web article from the app's page the way `library_add` keeps
one: the app's worker fetches the page and uploads its HTML, and the upload's
text is extracted, searched and cited like a Word file's. An app's `worker.js`
may fetch any public address.

The worker removes what is not the article (scripts, styles, menus, headers,
footers, sidebars and forms) with `HTMLRewriter` in the same pass that reads the
title, so the extracted text is the article's:

    // The page as the article alone, and its title.
    let read = async (res) => {
      let title = '', og = ''
      let html = await new HTMLRewriter()
        .on('script, style, noscript, nav, header, footer, aside, form, iframe',
          { element(e) { e.remove() } })
        .on('meta[property="og:title"]',
          { element(e) { og = e.getAttribute('content') ?? '' } })
        .on('title', { text(t) { title += t.text } })
        .transform(res)
        .arrayBuffer()
      return { html, title: (og || title).trim() }
    }

    export default {
      async fetch(req, env) {
        let url = new URL(req.url)
        if (!url.pathname.endsWith('/article') || req.method != 'POST') {
          return new Response('not found', { status: 404 })
        }
        let { url: from } = await req.json()
        if (!/^https?:\/\//.test(from ?? '')) {
          return Response.json({ error: 'that is not a web address' },
            { status: 400 })
        }
        let got = await fetch(from, {
          headers: { 'user-agent': 'yaks.app library', accept: 'text/html' },
        })
        if (!got.ok || !got.headers.get('content-type')?.includes('text/html')) {
          return Response.json({ error: 'that site would not let us read it' })
        }
        let page = await read(got)

        // The upload writes the document's rows as the person asking, so the
        // blob floor refuses a visitor here.
        let up = await env.STORE.fetch('/blob', {
          method: 'POST',
          headers: {
            'content-type': 'text/html',
            'x-yak-name': encodeURIComponent(page.title || from),
          },
          body: page.html,
        })
        if (!up.ok) return new Response(await up.text(), { status: up.status })
        let file = await up.json()

        let saved = await env.STORE.fetch('/apply', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            entities: [{
              entity: { eid: file.attachment },
              attachment: { source: from },
            }],
          }),
        })
        if (!saved.ok) {
          return new Response(await saved.text(), { status: saved.status })
        }
        return Response.json({ eid: file.attachment, title: page.title })
      },
    }

The upload answers `attachment`, the eid of the row that names the file, and
`attachment.source` goes on that row, so the article's address travels with its
citations. The document's name is the article's title, which is what an answer
cites.

The editor's page sends the address:

    let keep = async (address) => {
      let r = await fetch('./article', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: address }),
      })
      let got = await r.json()
      return got.error?.message ?? got.error ?? 'Kept: ' + got.title
    }

Three things to know:

- **A site that refuses** answers the route with `error` and status 200, because
  a site blocking automated requests is not a fault in the app. Tell the editor
  the site would not let the app read it, and suggest saving the page from their
  browser as `.html` and uploading that file.
- **The same address kept twice** with different bytes (a page whose advertising
  changes) is a second document. Query `.attachment.source="<address>"` first if
  the page should skip an address it already holds.
- **A page drawn entirely by JavaScript** arrives empty, since a worker fetches
  HTML and runs none of it. Saving the page from the browser works here too.

Bookmarklets, metadata and clipping on a schedule are in Web Clipping
(<https://yaks.app/docs/clipping.md>).

## Search and answers with citations

`POST ./api/documents/ask` with `{words}` finds the passages that match the
question by words and by meaning, and answers from them alone:

    // The question's answer, and where each part of it came from.
    let ask = async (words) => {
      let r = await fetch('./api/documents/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ words, scope: '.document_page' }),
      })
      if (!r.ok) throw await r.json()
      return r.json()
    }

    let { answer, citations } = await ask('What is the chief end of man?')

`scope: '.document_page'` answers from the library's documents only, so a row a
visitor wrote (a question they saved, say) is never cited. A citation is
`{eid, document: {eid, name, url, source}, page, location}`: the document's
name, the page (`location` is `Page 3` in a PDF, `Document` in a Word file or a
web article), `url`, the stored copy, opened at that page for a PDF, and
`source`, the web address a fetched document came from. If nothing matches, the
answer says so and `citations` is empty.

A cited web article links to its original address, and anything else to its
stored copy:

    let links = (citations) =>
      citations.map((c) => ({
        name: c.document.name,
        where: c.location,
        href: c.document.source ?? c.document.url,
      }))

`POST ./api/documents/search` with `{words}` returns the matching passages
without an answer, up to ten, each with its `text`. Full-text search costs
nothing and answers anyone who may read the app; `semantic: true` and `ask` make
model calls on the space's budget.

## What limits a visitor's questions

Every answer is a model call that spends the space's budget, and when the budget
is spent, `ask` is refused `429` until the owner raises it or the month turns. A
stranger who is not signed in is also limited to 300 requests a minute from one
address for the app's data, `ask` included; past that the answer is `429` with
`Retry-After: 60`.

`pace` does not limit asking. It limits how often one writer may change one
component on one row (<https://yaks.app/docs/components.md>, "Write permissions
and rate limits: `floor` and `pace`"), and a question to `./api/documents/ask`
writes no row. If the app saves each visitor's questions so the owner can read
them, give that component a `pace` to keep one visitor from rewriting a row in a
loop; it does not stop them adding new rows.

## Limitations

- **One answer, no conversation.** `ask` answers each question on its own. A
  follow-up question has to carry what it refers to.
- **Ten passages.** An answer reads at most ten passages, so a question whose
  answer is spread across many documents gets the ten that match it best.
- **A Word file, web article or text file is one passage.** Only a PDF is read
  page by page; a long Word file is cited as a whole, without a page number.
- **Extraction takes files up to 16 MiB.** A larger file is kept, and its row
  gets `failed{reason}`.

---

Related pages: uploads, extraction and the search endpoints are in Files and
Uploads (<https://yaks.app/docs/files.md>); `access`, `floor` and inviting
editors are in Access, Publishing and Installing
(<https://yaks.app/docs/sharing.md>); worker routes and `env.STORE` are in
Backend Code (<https://yaks.app/docs/code.md>); model costs are in AI Models
(<https://yaks.app/docs/models.md>). The whole guide:
<https://yaks.app/docs.md>.
