// The kernel's own pages, in the home page's voice (workers/yak/public): what
// a person sees when there is nothing at an address, when an app broke, and
// where they sign in. One shell, three sentences, and an optional card of
// markup under them; the palette is the home page's, inlined so a space's
// hostname needs no asset of the apex. Never a stack trace — the exception
// entity carries that to the person's agent (D-32318 §Errors).
//
// Everything interpolated here is escaped by `esc` at the call site: a page
// carries an email address a stranger typed, and web content never speaks
// HTML (the repo's md.ts rule, one floor down).

import type { Frame } from './build.ts'
import { MCP, MCP_ASK, OAUTH, PLATFORM } from './route.ts'
import { CONNECTOR } from './seo.ts'

// The one escape: `&` first, so an escape is never escaped twice.
export let esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

let home = '<a class="Away" href="https://yaks.app/">yaks.app</a>'

let shell = (
  title: string,
  lead: string,
  status: number,
  inner = home,
  // Extra response headers, beside content-type — `Retry-After` on the
  // provisioning page below, nothing else needs one today.
  headers: Record<string, string> = {},
) =>
  new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title} · yaks.app</title>
<style>
:root { color-scheme: light; --ground: #fdf7ee; --paper: #fffbf5; --ink: #523828; --soft-ink: #785b47; --line: #efe3d2; --meadow: #4c773e; --warn: #a8503f }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; --ground: #2b231f; --paper: #372c26; --ink: #f1e6d8; --soft-ink: #c9b19c; --line: #4d3d34; --meadow: #a7c080; --warn: #e67e80 } }
* { box-sizing: border-box }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--ground); color: var(--ink); font: 400 1.05rem/1.6 'Nunito', system-ui, sans-serif }
main { width: 100%; max-width: 34rem; padding: 2rem 1rem; text-align: center; overflow-wrap: anywhere }
h1 { font-size: 1.6rem; font-weight: 800; margin: 0 0 .5rem }
p { color: var(--soft-ink); margin: 0 0 1rem }
a { color: var(--meadow); text-underline-offset: .18em }
:focus-visible { outline: 3px solid var(--meadow); outline-offset: 3px }
form { display: grid; gap: .75rem; margin: 1.5rem 0 1rem }
form p { margin: 0; font-size: .95rem }
input { min-width: 0; max-width: 100%; font: inherit; text-align: center; padding: .7rem 1rem; border: 2px solid var(--soft-ink); border-radius: 1.25rem; background: var(--paper); color: var(--ink) }
button { font: inherit; font-weight: 800; padding: .75rem 1.75rem; border: 0; border-radius: 999px; background: var(--meadow); color: var(--ground); cursor: pointer }
button:hover, .Button:hover { text-decoration: underline; text-underline-offset: .2em }
button:disabled, input:disabled { opacity: .6; cursor: not-allowed; text-decoration: none }
.Code { letter-spacing: .5em; font-size: 1.4rem; font-weight: 700 }
.Away { font-size: .95rem }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9rem; background: var(--ground); border-radius: .4rem; padding: .1rem .35rem; overflow-wrap: anywhere }
.Url code { display: inline-block; padding: .5rem 1rem; border-radius: 999px; background: var(--paper); font-size: .95rem }
.Card { margin: 0 0 1rem; padding: 1.1rem 1.25rem; border-radius: 1.25rem; background: var(--paper); text-align: left }
.Card h2 { font-size: 1.05rem; font-weight: 800; margin: 0 0 .6rem }
.Card ol { display: grid; gap: .4rem; margin: 0; padding-left: 1.2rem; color: var(--soft-ink); font-size: .95rem }
.Card li::marker { color: var(--meadow); font-weight: 700 }
.Card pre { margin: 0; white-space: pre-wrap; font: inherit; color: var(--soft-ink); text-align: left }
.Card form { margin: 1rem 0 0 }
.Note { font-size: .9rem; margin: .75rem 0 0 }
.Pills { display: flex; flex-wrap: wrap; justify-content: center; gap: .625rem; margin: 0 0 1.25rem }
.Pill { display: inline-block; padding: .5rem 1rem; border: 1px solid var(--line); border-radius: 999px; background: var(--paper); color: var(--ink); font-weight: 700; text-decoration: none }
.Pill:hover { border-color: var(--meadow) }
.Button { display: inline-block; padding: .75rem 1.75rem; border-radius: 999px; background: var(--meadow); color: var(--ground); font-weight: 800; text-decoration: none }
.Pick { display: block; margin: .4rem 0; padding: .5rem .6rem; user-select: all }
.Says { display: grid; gap: .5rem; margin: .75rem 0 1rem; padding: 0; list-style: none }
.Copy { display: flex; align-items: center; gap: .5rem }
.Copy .Pick { flex: 1; margin: 0; border-radius: .7rem; background: var(--ground) }
.Copy_Go { flex: none; padding: .4rem .9rem; font-size: .85rem; font-weight: 700; background: transparent; color: var(--meadow); border: 1px solid var(--line) }
.At { display: flex; align-items: center; justify-content: center; gap: .3rem }
.At input { flex: 0 1 13rem; text-align: right }
.At span { color: var(--soft-ink) }
.Attach { margin: 0 0 1rem; text-align: left }
.Attach > summary { font-weight: 800; font-size: 1.05rem; cursor: pointer; padding: .6rem 0; text-align: center }
.Attach > p { margin: .75rem 0 1rem }
.Say { min-height: 1.3rem; margin: 0; font-size: .95rem }
.Say-no { color: var(--warn) }
.Bill_Doors { display: flex; flex-wrap: wrap; gap: .625rem; margin: 1rem 0 .5rem }
.Bill_Go-quiet { background: transparent; color: var(--meadow); border: 1px solid var(--line) }
.Drop_Zone { display: grid; place-items: center; gap: .5rem; padding: 1.4rem 1rem; border: 2px dashed var(--soft-ink); border-radius: 1.25rem; background: var(--ground); text-align: center; cursor: pointer }
.Drop_Zone-over { border-color: var(--meadow); background: var(--paper) }
.Drop_File { border: 0; padding: 0; background: none; cursor: pointer }
.Drop_Say { color: var(--soft-ink); font-size: .9rem }
.Files { display: grid; gap: .3rem; margin: 0; padding-left: 1.2rem; color: var(--soft-ink); font-size: .95rem }
.Chat_Said { display: grid; gap: .45rem; margin: 0 0 1rem }
.Chat_Said:empty { display: none }
.Chat_Bubble { max-width: 90%; margin: 0; padding: .55rem .9rem; border-radius: 1.1rem; background: var(--ground); color: var(--ink); white-space: pre-wrap }
.Chat_Bubble-you { justify-self: end; background: var(--meadow); color: var(--ground) }
.Chat_Bubble a { color: inherit }
.Chat_Tool { display: flex; gap: .4rem; align-items: baseline; margin: 0; padding: 0 .3rem; color: var(--soft-ink); font-size: .9rem }
.Chat_Tool-no { color: var(--warn) }
.Chat_Name { font-weight: 700; flex: none }
.Chat_Of { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.Chat_Built { margin: .4rem 0; padding: 1rem; border: 2px solid var(--meadow); border-radius: 1.25rem; background: var(--ground); text-align: center }
.Chat_Built p { margin: 0 0 .6rem }
.Chat_Note { margin: 0; color: var(--soft-ink); font-size: .9rem }
.Chat_Ask { margin: 0 }
.Chat_Ask textarea { min-width: 0; width: 100%; min-height: 4.5rem; font: inherit; padding: .7rem 1rem; border: 2px solid var(--soft-ink); border-radius: 1.25rem; background: var(--paper); color: var(--ink); resize: vertical }
.Chat_Ask textarea:disabled { opacity: .6 }
.Face { display: flex; align-items: flex-start; gap: 1rem }
.Face_Icon { flex: none; width: 72px; height: 72px; border: 1px solid var(--line); border-radius: 1rem }
.Face_Rows { display: grid; gap: .5rem; min-width: 0 }
.Face_Rows p { display: flex; align-items: center; gap: .5rem; margin: 0; min-width: 0; font-size: .9rem }
.Face_Rows b { flex: none; min-width: 5rem; color: var(--ink) }
.Face_Rows .Copy { min-width: 0; flex: 1 }
.Tabs { position: relative }
.Tabs > input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none }
.Tabs_Strip { display: flex; flex-wrap: wrap; gap: .4rem; margin: 0 0 .75rem }
.Tabs_Tab { padding: .45rem .9rem; border: 1px solid var(--line); border-radius: 999px; background: var(--paper); color: var(--ink); font-size: .9rem; font-weight: 700; cursor: pointer }
.Tabs_Tab:hover { border-color: var(--meadow) }
.Tabs_Panel { display: none }
${tabsCss}
</style>
</head>
<body><main><h1>${title}</h1><p>${lead}</p>${inner}</main></body>
</html>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    },
  )

export let lost = () =>
  shell(
    'Page not found',
    'Check the address, or return to yaks.app.',
    404,
  )

export let nothingHere = () =>
  shell(
    'Nothing here yet.',
    "There are no apps at this address yet. If it's yours, ask your " +
      'assistant to build one.',
    404,
  )

// An app in the trash, at its own address (erase.ts, T-34430). Everyone else
// gets `nothingHere` — a deleted app is not a stranger's news — so this is
// the space's OWNER, told the one thing that is actually true of this
// address: nothing serves here, and it is theirs to take back from the page
// their apps are listed on. A 404 with words in it, because the address
// really is answering nothing.
export let binned = (at: { title: string; days: number }) =>
  shell(
    `${esc(at.title)} is in the trash.`,
    `Nothing answers at this address until it is restored. It is kept for ${at.days} more ${
      at.days == 1 ? 'day' : 'days'
    }, then erased for good.`,
    404,
    '<p><a class="Button" href="/">Restore it from your apps</a></p>',
  )

// Deploying by DROPPING a file (T-34230): the one door on this platform that
// makes an app with no assistant in the room. A file input, which a file can
// also be dragged onto, and the name the app lives at — one plain form that
// POSTs to `/deploy` (drop.ts) and needs no script at all. The script below
// only fills the name in from the file's own and lets a drag land on the
// label; nothing it does is required for the form to work.
//
// `slug` given is an app's OWN page, where the name is not a question: the
// drop goes to that app and nowhere else.
let dropZone = (slug?: string) =>
  `<form class="Drop" method="post" action="/deploy" enctype="multipart/form-data">
<label class="Drop_Zone">
<input class="Drop_File" type="file" name="file" required aria-label="The file to deploy">
<span class="Drop_Say">A .zip of the app's files, or a single index.html</span>
</label>
${
    slug ? held('slug', slug) : `<input name="slug" maxlength="63" ` +
      `autocomplete="off" spellcheck="false" placeholder="what to call it" ` +
      `aria-label="What to call the app">`
  }
<button type="submit">Deploy${slug ? ` to ${esc(slug)}` : ''}</button>
</form>`

// Constant text, no interpolation, and every write to the page is textContent
// or a class — the page never speaks HTML on a person's behalf (`inline`
// below takes the same line).
let dropping = `<script>
let drop = document.querySelector('.Drop')
if (drop) {
  let file = drop.querySelector('input[type=file]')
  let zone = drop.querySelector('.Drop_Zone')
  let say = drop.querySelector('.Drop_Say')
  let slug = drop.querySelector('input[name=slug]')
  // What to call it, from what the file is called: recipes.zip -> recipes.
  // Never over a name already typed, and never off a bare index.html, whose
  // stem says nothing about the app.
  let named = (f) => {
    say.textContent = f.name
    if (!slug || slug.value) return
    let stem = f.name.replace(/\\.[a-z0-9]+$/i, '').toLowerCase()
    if (stem == 'index') return
    slug.value = stem.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 63)
  }
  file.addEventListener('change', () => {
    if (file.files[0]) named(file.files[0])
  })
  zone.addEventListener('dragover', (e) => {
    e.preventDefault()
    zone.classList.add('Drop_Zone-over')
  })
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('Drop_Zone-over')
  })
  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    zone.classList.remove('Drop_Zone-over')
    if (!e.dataTransfer.files.length) return
    file.files = e.dataTransfer.files
    named(e.dataTransfer.files[0])
  })
}
</script>`

// ---- the builder's chat (T-34242) -------------------------------------------
//
// The other door with no assistant in the room, beside the drop zone: a person
// says what they want and the platform's own builder makes it (build.ts,
// T-34240). One form, one textarea, and it POSTs to the builder's address the
// way the drop zone POSTs to `/deploy` — so a browser that ran no script says
// a line, waits for the round, and reads the whole conversation back as a
// page. The script beside it (public/build.js) opens the socket instead and
// draws the same frames as they happen; nothing it does is required.
//
// One RENDERER, drawn twice. The frames below are build.ts's wire, whole, and
// the rules here are the rules the script keeps: a tool is one row that turns
// into its own result, the address is a card, `busy` is a line, and `done`
// draws nothing because the sentence it carries is already a line above it.

// A https address inside a sentence the builder said — the app it just made,
// the pricing page a refusal ends with — as a link. Refused by SHAPE, not by a
// scheme list (the repo's md.ts rule): `https://`, then nothing that could
// close the attribute or open a tag, and no trailing punctuation of the
// sentence it sits in.
let AT = /https:\/\/[^\s<>"'`]+/g
let linked = (text: string) => {
  let out = ''
  let from = 0
  for (let m of text.matchAll(AT)) {
    let url = m[0].replace(/[.,;:!?)\]]+$/, '')
    out += esc(text.slice(from, m.index)) +
      `<a href="${esc(url)}">${esc(url)}</a>`
    from = m.index + url.length
  }
  return out + esc(text.slice(from))
}

// One tool, as one row: its name, the line it said about itself, and where it
// got to. `null` is a tool still running — the row a `ran` frame replaces.
let toolRow = (name: string, line: string, ok: boolean | null) =>
  `<p class="Chat_Tool${ok == false ? ' Chat_Tool-no' : ''}">` +
  `<span class="Chat_Name">${ok == null ? '…' : ok ? '✓' : '✗'} ${
    esc(name)
  }</span><span class="Chat_Of">${esc(line)}</span></p>`

/** The conversation, as the page draws it. */
let transcript = (frames: Frame[]) => {
  let rows: string[] = []
  let at = new Map<string, number>()
  for (let f of frames) {
    if ('said' in f) {
      if (!f.text) continue
      rows.push(
        `<p class="Chat_Bubble Chat_Bubble-${
          f.said == 'person' ? 'you' : 'them'
        }">${linked(f.text)}</p>`,
      )
    } else if ('tool' in f) {
      at.set(f.call, rows.length)
      rows.push(toolRow(f.tool, f.line, null))
    } else if ('ran' in f) {
      let was = at.get(f.call)
      let row = toolRow(f.ran, f.line, f.ok)
      if (was == null) rows.push(row)
      else rows[was] = row
    } else if ('built' in f) {
      rows.push(
        `<div class="Chat_Built"><p>It is live.</p>
<p class="Url"><a href="${esc(f.built)}"><code>${esc(f.built)}</code></a></p>
</div>`,
      )
    } else if ('busy' in f) {
      rows.push(`<p class="Chat_Note">${esc(f.busy)}</p>`)
    }
  }
  return `<div class="Chat_Said">${rows.join('')}</div>`
}

// The line a person types. `required` is the browser's own guard; the door
// keeps the same one, for whoever posts without it.
let chatAsk = () =>
  `<form class="Chat_Ask" method="post" action="/api/build">
<p><textarea name="say" rows="3" required placeholder="A recipe box I can share with my sister" aria-label="What do you want to build?"></textarea></p>
<button type="submit">Build it</button>
</form>`

/**
 * The builder's block on a space page. FIRST on a space with nothing in it
 * (spaceIndex): the question is the whole of what there is to do here, and it
 * is the one door that needs no assistant of the person's own.
 */
let chat = (built: boolean, frames?: Frame[]) =>
  `<section class="Card Chat">
<h2>${built ? 'Build something else' : 'What do you want to build?'}</h2>
<p class="Note">${
    built
      ? 'Say what you want and it is made here, at this address.'
      : 'Say it in your own words — a recipe box, a sign-up sheet, a page ' +
        'for your business — and it is built here, at this address.'
  }</p>
${transcript(frames ?? [])}${chatAsk()}
</section>`

// The live half (public/build.js), at the builder's own address so a space's
// hostname needs no asset of the apex (apps.ts serves it there). A module,
// because it is one, and nothing on the page waits for it.
let chatLive = '<script type="module" src="/api/build.js"></script>'

/**
 * What a posted line answers (T-34242), and it is a PAGE for the same reason a
 * drop's is: whoever typed it ran no script, so the conversation has to come
 * back as something to read. The round is over by the time this is written —
 * the frames are the whole of it, ending in the address where one was built.
 */
export let building = (at: {
  space: string
  frames?: Frame[]
  why?: string
}) =>
  shell(
    at.why ? 'That did not go in' : `${esc(at.space)}.yaks.app`,
    at.why ? esc(at.why) : 'Here is what happened. Say the next thing below.',
    at.why ? 400 : 200,
    `<section class="Card Chat">
${transcript(at.frames ?? [])}${chatAsk()}
</section>
<p><a class="Away" href="/">Everything at ${esc(at.space)}.yaks.app</a></p>
${chatLive}`,
  )

// What a drop answers, either way it went (T-34230), and it is a PAGE because
// the form that sent it is a plain form: whoever dropped the file reads this,
// script or no script. What is live and where, the files that went in, and the
// same drop zone again with this app's name fixed — which makes it the app's
// own page for a person with no assistant open.
export let dropped = (at: {
  space: string
  slug?: string
  url?: string
  version?: number
  files?: string[]
  why?: string
  status?: number
}) =>
  shell(
    at.why ? 'That did not go in' : `${esc(at.slug ?? at.space)} is live`,
    at.why
      ? esc(at.why)
      : `Version ${at.version} is serving. Here is what went in.`,
    at.status ?? 200,
    `${
      at.url
        ? `<p class="Url"><a href="${esc(at.url)}"><code>${
          esc(at.url)
        }</code></a></p>`
        : ''
    }
${
      at.files?.length
        ? `<section class="Card"><h2>${at.files.length} ${
          at.files.length == 1 ? 'file' : 'files'
        }</h2>
<ol class="Files">${at.files.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>
</section>`
        : ''
    }
<div class="Card"><h2>${at.slug ? 'Deploy again' : 'Try again'}</h2>
<p class="Note">${
      at.slug
        ? `Drop another zip — or one index.html — and ${
          esc(at.slug)
        } becomes it.`
        : 'A .zip of the files, or a single index.html.'
    }</p>
${dropZone(at.slug)}
</div>
<p><a class="Away" href="/">Everything at ${esc(at.space)}.yaks.app</a></p>
${dropping}`,
  )

// One thing to say, and a button that puts it on the clipboard (T-34420). The
// words are selectable on their own (`.Pick` is `user-select: all`), so a
// browser that ran no script still takes them in one gesture — the button is
// all the script below adds, and it stays HIDDEN until that script un-hides
// it, because a button that does nothing is worse than no button.
//
// One control, everywhere something is meant to be pasted: the three things to
// say below, and each of the three a connector form asks for (T-34412).
let copyable = (said: string, what = '') =>
  `<span class="Copy"><span class="Pick">${
    esc(said)
  }</span><button class="Copy_Go" type="button"${
    what ? ` aria-label="Copy ${esc(what)}"` : ''
  } hidden>Copy</button></span>`

// The button's half. Constant text, no interpolation, and every write to the
// page is textContent — the page never speaks HTML on a person's behalf. The
// words come from the span beside it rather than an attribute of its own, so
// there is one copy of them on the page and nothing to keep in step. Where the
// clipboard is refused — an insecure origin, a browser that asks first — the
// words are SELECTED instead, so the person's own copy keystroke lands.
let copying = `<script>
for (let go of document.querySelectorAll('.Copy_Go')) {
  let said = go.previousElementSibling
  go.hidden = false
  go.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(said.textContent)
      go.textContent = 'Copied'
    } catch (_) {
      let range = document.createRange()
      range.selectNodeContents(said)
      let sel = getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      go.textContent = 'Copy it'
    }
    setTimeout(() => { go.textContent = 'Copy' }, 2000)
  })
}
</script>`

// The space's own address when no app is its front page (T-33040). A space
// that EXISTS is not a 404: this is a door, not a failure — and for its owner
// it is where a fresh sign-in lands (T-34233), so it is also the page that
// gets them from an account to a working assistant. One page, of blocks that
// appear when they are true of whoever is looking —
//
//   what to call you, and where     the owner; FIRST while nothing is built
//   what to do next                 the owner, once an assistant has connected
//   what do you want to build?      the owner
//   attaching an assistant          the owner; OPEN until one ever has
//   the apps this person may open   whenever there are any
//   asking for the rest             only when something is actually held back
//   this page is a choice, and      the owner, and nobody else
//     a file to drop
//   signing in                      signed out
//   what this place is              signed out; a stranger, not a neighbour
//
// The owner's blocks come FIRST (T-34236, T-34242), and their order turns on
// whether anything is built here. With NOTHING built, whoever is reading has
// just typed their sign-in code and landed: what they are called and where
// they live leads, above the builder's question and above anything
// collapsible (T-34419) — under both, and under the connect steps at their
// full height, it was two screens down on a phone and nobody found it. Once
// something IS built they are back on a page they know: connecting leads
// again — that is the way to keep working on what is there — and the form
// keeps the place it has always had.
//
// The connect instructions collapse to their own one line once an agent has
// ever been let in, rather than disappearing: the second assistant is added
// the same way as the first. What takes their place is `next` (T-34420) —
// things to SAY, because a person who has just connected one is looking at a
// page with nothing on it to do.
//
// The filtering is the part to get right: an app someone may not read is not
// NAMED here (apps.ts asks `reads` per app), and the line about asking for
// access appears only when something is being held back — so the page never
// implies a private app that is not there.
//
// `pitch` is one block on purpose: white-labelling (T-33069) turns our own
// voice off on a paid space, and that has to be a condition around a block
// rather than an edit to a page.
export let spaceIndex = (at: {
  space: string
  title: string
  apps: { slug: string; title: string }[]
  // What the owner deleted and can still have back, with the days each has
  // left (erase.ts, T-34430). Empty for everybody else — nobody but the owner
  // is told an app was ever here.
  trash?: { slug: string; title: string; days: number }[]
  hidden: number
  role: string | null
  person: boolean
  signIn: string
  // The owner's own three facts: what they are called, whether any agent has
  // ever been let in as them, and whether the address is still theirs to move
  // (an app's URL is this slug, so a space with apps in it stays put, T-32576).
  name?: string
  connected?: boolean
  fixed?: boolean
  // What the last save said, when one was refused.
  say?: string
  no?: boolean
}) => {
  let owner = at.role == 'owner'
  let mine = at.apps.length
    ? `<nav class="Pills" aria-label="Apps here">${
      at.apps.map((a) =>
        `<a class="Pill" href="/${esc(a.slug)}/">${esc(a.title || a.slug)}</a>`
      ).join('')
    }</nav>`
    : ''
  // Under the pills, and the owner's alone: what was deleted, how long it has
  // left, and one button that brings it back. A form per app POSTing to this
  // page's own address — the same door the settings form uses (apps.ts
  // `saved`), so restoring needs no script and no assistant.
  let bin = owner && at.trash?.length
    ? `<section class="Card"><h2>In the trash</h2>
<p class="Note">Deleted apps are kept for 30 days — everything they saved is
still here — and then erased for good.</p>
${
      at.trash.map((a) =>
        `<form method="post" action="/">
<input type="hidden" name="restore" value="${esc(a.slug)}">
<p>${esc(a.title || a.slug)} — ${a.days} ${
          a.days == 1 ? 'day' : 'days'
        } left</p>
<button type="submit">Restore</button>
</form>`
      ).join('')
    }
</section>`
    : ''
  let ask = at.hidden && !owner
    ? `<p class="Note">${
      at.hidden == 1 ? 'One app here is' : `${at.hidden} apps here are`
    } private. Ask whoever runs this space to let you in.</p>`
    : ''
  let inn = at.person
    ? ''
    : `<p><a class="Button" href="${esc(at.signIn)}">Sign in</a></p>`
  let pitch = at.person ? '' : `<div class="Card">
<h2>What is yaks.app?</h2>
<p class="Note">Ask an assistant like Claude or ChatGPT for an app, and it
builds one here — a page of your own you can send to anyone.</p>
<p><a class="Away" href="https://yaks.app/">Make one of your own</a></p>
</div>`
  let yours = owner
    ? `<div class="Card">
<h2>Choose what appears here</h2>
<p class="Note">${
      at.apps.length
        ? 'Ask your assistant to make one of these apps the front page, and ' +
          'it opens here instead of this list.'
        : 'Ask your assistant to build something here — a list, a site, a ' +
          'game — and it lives at this address.'
    }</p>
</div>
<div class="Card">
<h2>Or deploy a file</h2>
<p class="Note">Have a zip of a site, or one page of HTML? Drop it here and
it becomes an app at this address — no assistant needed.</p>
${dropZone()}
</div>`
    : ''
  // Attaching an assistant, in full, on the page they land on. Open while
  // nobody has ever connected — there is nothing else to do here yet — and
  // shut afterwards, because the instructions are still how a SECOND one is
  // added. `<details>` and no script: the browser owns the toggle.
  let attach = owner
    ? `<details class="Attach"${at.connected ? '' : ' open'}>
<summary>Connect your assistant</summary>
<p>Add yaks.app in your assistant's settings using the steps below. Then ask
it to build an app here.</p>
${doors}
<p class="Note">Menus move. If yours doesn't look like this, search its
settings for "connector" or "MCP" — the link is the same wherever it goes.
<a href="https://yaks.app/connect">The connect page</a> says the same thing,
with your plan beside it.</p>
</details>`
    : ''
  // The two things a sign-in no longer asks (T-34236), asked here instead,
  // where a person can see what they are naming. One form, one POST to this
  // page's own address, and no script: changing the address MOVES this
  // hostname, so the answer is a redirect to wherever the space now lives —
  // which a fetch could not do in place anyway.
  let settings = owner
    ? `<section class="Card"><h2>You and your address</h2>
<form method="post" action="/">
<p>What your apps call you. Leave it empty and the front of your email does.</p>
<input name="name" maxlength="60" autocomplete="name" placeholder="Dana" aria-label="What should we call you?" value="${
      esc(at.name ?? '')
    }">
${
      at.fixed
        ? `<p class="Note">Your apps live at <b>${
          esc(at.space)
        }.yaks.app</b>. That address stays put now that something is built
there.</p>`
        : `<p>Where your apps live. Yours to change while nothing is built
there.</p>
<span class="At"><input name="space" maxlength="63" autocomplete="off" spellcheck="false" aria-label="The name your apps live at" value="${
          esc(at.space)
        }"><span>.yaks.app</span></span>`
    }
<button type="submit">Save</button>
<p class="Say${at.no ? ' Say-no' : ''}" role="status">${esc(at.say ?? '')}</p>
</form>
</section>`
    : ''
  // What to do next (T-34420), once an assistant has been let in. The connect
  // steps shut the moment one ever connects, and nothing said what the person
  // had just gained — so this is what stands where they were: three things to
  // say, in the words somebody would use, each one ready to paste into
  // whatever they were talking to. Once something is built it is a line rather
  // than a block, because the apps right below it say the rest.
  let next = !owner || !at.connected
    ? ''
    : at.apps.length
    ? `<p class="Note">Your assistant is connected. Ask it for another app
whenever you want one — here is what you have.</p>`
    : `<section class="Card"><h2>What to do next</h2>
<p class="Note">Your assistant can build here now. Say one of these to it — or
anything like it, in your own words.</p>
<ul class="Says">${
      [
        'Make me a page for my book club',
        'Build a place to keep recipes',
        'Set up a sign-up sheet for the potluck',
      ].map((s) => `<li>${copyable(s)}</li>`).join('')
    }</ul>
<p class="Note">It builds the page and hands you back a link at
<b>${esc(at.space)}.yaks.app</b> — yours to open, or to send to anyone.</p>
<p class="Note">No assistant open? The box below does the first one without
one.</p>
</section>`
  // The builder's own block: the one door that needs no assistant at all.
  let asking = owner ? chat(!!at.apps.length) : ''
  let block = at.apps.length
    ? `${attach}${asking}${settings}${next}`
    : `${settings}${next}${asking}${attach}`
  let lead = at.apps.length
    ? 'Here is what you can open.'
    : owner
    ? 'Nothing has been built here yet.'
    : 'Nothing here is open to visitors yet.'
  return shell(
    esc(at.title || at.space),
    lead,
    at.no ? 400 : 200,
    `${block}${mine}${bin}${ask}${yours}${inn}${pitch}${at.person ? home : ''}${
      owner ? dropping + chatLive + copying + tabbing : ''
    }`,
  )
}

export let oops = () =>
  shell(
    'Something went wrong.',
    'Try again shortly. If the problem continues, ask your assistant to check the app.',
    500,
  )

// A custom domain that reached the Worker before there was anything to
// answer with (index.ts `settling`, T-33036): mid-provisioning, or one
// Cloudflare has stopped serving. `said` is Cloudflare's own three-line
// reading (domains.ts `reading`) — DNS, validation, certificate — handed on
// whole rather than summarized, because it already says which step is
// pending more specifically than a page here could invent. 503, not 404 or
// 500: the address is right and nothing is broken, it is just not done —
// and a short Retry-After is the whole point of choosing that code, for the
// rare visitor whose client honors it.
export let provisioning = (
  host: string,
  said: string,
  stage: 'pending' | 'error',
) =>
  shell(
    stage == 'error' ? 'This domain needs a fix' : 'Setting up this domain',
    stage == 'error'
      ? `${esc(host)} needs attention before it can serve — here is what ` +
        'Cloudflare says.'
      : `${esc(host)} is being connected to yaks.app. This is usually a ` +
        'matter of minutes, not hours.',
    503,
    `<section class="Card"><h2>${esc(host)}</h2><pre>${
      esc(said)
    }</pre></section>${home}`,
    { 'retry-after': '30' },
  )

// A door a later leaf fills (the connector): plain, not a mystery.
export let soon = (what: string) =>
  shell(
    `${what} is not available yet.`,
    'This feature is still being built.',
    404,
  )

// A hidden field, only when there is something to carry.
let held = (name: string, value?: string | null) =>
  value ? `<input type="hidden" name="${name}" value="${esc(value)}">` : ''

// What each card carries forward: the authorize request's own query string,
// so the code form lands back where it started, and the page the person was
// on before they were asked to sign in, so the code hands them back to it
// (T-32593). Whether that address is one to follow is the login door's to
// decide, never this page's.
let carried = (q: string | null, back?: string | null) =>
  held('q', q) + held('return', back)

// Ask for an address. `who` names the app asking, when one is (the OAuth
// consent page IS this page — signing in is the consent).
export let askEmail = (
  q: string | null,
  back: string | null,
  who?: string,
  status = 200,
) =>
  shell(
    'Sign in to yaks.app',
    who
      ? `${esc(who)} would like to use your apps. Enter your email and ` +
        "we'll send a code."
      : "Enter your email and we'll send you a six-digit code.",
    status,
    `<form method="post" action="/login">${carried(q, back)}
<input name="email" type="email" required autofocus autocomplete="email" placeholder="you@example.com" aria-label="Your email">
<button type="submit">Send me a code</button>
</form>${home}`,
  )

// Ask for the code just mailed, and nothing else (T-34236). Signing up is two
// steps and both are the address: give it, then prove it. What a person is
// called and where their apps live are theirs to set on their own space page,
// once they are standing on it — a question in front of the door is a step
// somebody has to get past to see anything at all. `why` is the soft refusal,
// when there was one.
export let askCode = (
  email: string,
  q: string | null,
  back: string | null,
  why?: string,
  status = 200,
) =>
  shell(
    'Check your email',
    why ?? `We sent a six-digit code to ${esc(email)}. It lasts ten minutes.`,
    status,
    `<form method="post" action="/login/code">${carried(q, back)}
<input type="hidden" name="email" value="${esc(email)}">
<input class="Code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus autocomplete="one-time-code" aria-label="Your six-digit code">
<button type="submit">Sign in</button>
</form>${home}`,
  )

// Closing a space (T-33166, erase.ts): the page that stands in front of the
// one act on this platform that cannot be undone. It NAMES what dies —
// every app, every domain, everyone who loses their way in, and the address
// going back into circulation — because a person about to lose all of it
// should read the list rather than remember it.
//
// Two ways to say yes, and the page shows whichever the visitor arrived with.
// Off the letter, with its ticket in hand, one button: opening the letter and
// following the link is the deliberate act, and the ticket is what carries it
// (it expires, and the act it opens can only happen once). Straight off the
// web, with no ticket, they type the name back — the guard that makes this
// hard to do by accident when nothing was mailed at all.
//
// The form POSTs to its own address and needs no script, like every other
// card here. Whoever may not delete this space never sees this page: the door
// answers them exactly what it answers for a space that does not exist.
export let askDelete = (at: {
  slug: string
  lines: string[]
  token?: string | null
  // Why this cannot happen at all — a space that is still paying (erase.ts
  // `refused`). The page then names the reason and offers no form.
  stop?: string
  why?: string
  status?: number
}) =>
  shell(
    `Delete ${esc(at.slug)}.yaks.app?`,
    esc(
      at.stop ?? at.why ?? 'This cannot be undone, and nothing is kept.',
    ),
    at.status ?? 200,
    `${
      at.lines.length
        ? `<section class="Card"><h2>What goes, for good</h2>
<ol>${at.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>
</section>`
        : ''
    }
${
      at.stop
        ? ''
        : `<form method="post" action="/space/${esc(at.slug)}/delete">
${held('t', at.token)}
${
          at.token ? '' : `<p>Type <b>${esc(at.slug)}</b> to confirm.</p>
<input name="confirm" autocomplete="off" spellcheck="false" autofocus aria-label="The name of the space">`
        }
<button type="submit">Delete ${esc(at.slug)}.yaks.app forever</button>
</form>
<p class="Note">Changed your mind? Close this page — nothing has happened.</p>`
    }
${home}`,
  )

// And after: what went, and the one thing worth knowing next — the address
// belongs to nobody now, theirs to take again or somebody else's to take
// later.
export let deleted = (said: string) =>
  shell(
    "That's done.",
    esc(said),
    200,
    `<p class="Note">The address is free again. Ask your assistant for a new
space whenever you want one.</p>${home}`,
  )

// An app asking, for a browser that is already signed in: one click is the
// whole consent.
export let askAllow = (email: string, q: string, who: string) =>
  shell(
    'Allow access to your yaks.app apps',
    `${esc(who)} would like to use your yaks.app apps as ${esc(email)}.`,
    200,
    `<form method="post" action="/oauth/allow">${carried(q)}
<button type="submit">Allow</button>
</form>${home}`,
  )

// The connector page, signed in (T-32972). Three things live on it and none
// waits for the others — the address their apps will live at, theirs to change
// while nothing is built there (T-32967), what the space pays, and how to hand
// this platform to the assistant they already talk to. Connecting is never
// gated on choosing.
//
// Signed in is the only way anyone reads it: a fresh sign-in lands on their own
// space (T-34233) and the owner block there carries these same steps, so a
// stranger asking for `/connect` is sent to sign in first (identity.ts
// `theirs`, T-34408).
//
// The provider steps were read off each provider's own documentation on
// 2026-09-03 (claude.com/docs/connectors/custom/remote-mcp,
// code.claude.com/docs/en/mcp-quickstart,
// developers.openai.com/api/docs/guides/developer-mode). Menus move: the last
// line says so, and says what to search for instead, because a stale
// instruction with no way past it is worse than none.
export type Yours = {
  slug: string
  // A space with apps in it keeps its address: an app's URL is this slug,
  // and moving one wants the redirect a rename already wants (T-32576).
  fixed: boolean
  said?: string
  say?: string
  no?: boolean
  // What this space pays (billing.ts, T-33125): whether it is on Plus, the
  // day it lapses if it is leaving, and whether Stripe has ever known this
  // space — which is what makes the manage door worth offering. THIS is the
  // surface that starts a purchase, and it is signed-in web only: the agent
  // surface may name the pricing page and nothing else (C-33033).
  plan: { plus: boolean; ends: string; known: boolean }
  // `?paid=1` on the way back from Stripe. The webhook is what actually moves
  // the tier and it may not have landed yet, so the line says "in a moment"
  // rather than claiming something this request cannot see.
  paid?: boolean
}

// The address card, for a person who is signed in. The form posts, so it
// works with no script at all; the script below turns that into an inline
// answer, which is what a person choosing a name expects.
let mine = (y: Yours) =>
  y.fixed
    ? `<section class="Card"><h2>Where your apps live</h2>
<p>Your apps live at <b>${esc(y.slug)}.yaks.app</b>.</p>
<p class="Note">This address cannot be changed after you build your first app.</p>
</section>`
    : `<section class="Card"><h2>Where your apps live</h2>
<p class="Now">Your apps live at <b>${esc(y.slug)}.yaks.app</b>. It's yours to
change while nothing is built there.</p>
<form class="Addr" method="post" action="/connect">
<span class="At"><input name="space" maxlength="63" autocomplete="off" spellcheck="false" aria-label="The name your apps live at" value="${
      esc(y.said ?? y.slug)
    }"><span>.yaks.app</span></span>
<button type="submit">Save</button>
<p class="Say${y.no ? ' Say-no' : ''}" role="status">${esc(y.say ?? '')}</p>
</form>
</section>`

// The plan card, for a person who is signed in (T-33125). One card with one
// button: Plus when they are free, manage-billing when they are paying. The
// button POSTs to billing.ts and follows the URL Stripe answers, so no Stripe
// address is written into this page and nothing here knows a key.
//
// A day, not a timestamp: "runs until 14 October 2026" is what somebody wants
// to know, and the hour is noise on a monthly bill.
let day = (iso: string) => {
  let at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

let plan = (y: Yours) => {
  let ends = y.plan.ends ? day(y.plan.ends) : ''
  let head = y.plan.plus
    ? `<p>${y.slug}.yaks.app is on <b>Plus</b>.${
      ends ? ` It runs until ${esc(ends)} and then stops renewing.` : ''
    }</p>`
    : `<p>${y.slug}.yaks.app is on the <b>free</b> plan — five apps, 50,000
visits a month, 1 GB. <a href="https://yaks.app/pricing">Compare plans</a>.</p>`
  // Someone Stripe has met can always reach their own billing, whatever plan
  // they are on today: an invoice from a month they paid for is theirs to
  // read after they cancel.
  let doors = [
    y.plan.plus
      ? ''
      : '<button class="Bill_Go" data-door="checkout">Get Plus — $4 a month</button>',
    y.plan.known
      ? '<button class="Bill_Go Bill_Go-quiet" data-door="portal">Manage billing</button>'
      : '',
  ].filter(Boolean).join('')
  return `<section class="Card Bill"><h2>Your plan</h2>
${head}
${
    y.paid
      ? '<p class="Note">Thanks — that went through. Your space moves to Plus ' +
        'in a moment.</p>'
      : ''
  }
<p class="Bill_Doors">${doors}</p>
<p class="Say Bill_Say" role="status"></p>
</section>`
}

// The three things every connector form asks for, ready to copy, and the
// picture beside them (T-34415, seo.ts CONNECTOR). It sits above the tabs
// because it is the same answer in all of them — only the form around it
// changes — and because ChatGPT's form asks for all three by hand.
let face = `<section class="Card"><h2>What the form asks for</h2>
<div class="Face">
<img class="Face_Icon" src="${
  CONNECTOR.icons[0].src
}" width="72" height="72" alt="The yaks.app yak">
<div class="Face_Rows">
<p><b>URL</b> ${copyable(MCP, 'the MCP URL')}</p>
<p><b>Name</b> ${copyable(CONNECTOR.title, 'the name')}</p>
<p><b>Description</b> ${copyable(CONNECTOR.description, 'the description')}</p>
</div>
</div>
<p class="Note">Some forms want an icon too:
<a href="${CONNECTOR.icons[1].src}">save the square yak</a>.</p>
</section>`

// An address on this platform, spelled out for somebody to type or paste.
let at = (path: string) => `<code>https://${PLATFORM}${path}</code>`

// What to write in an OAuth box, for the forms that have boxes (T-34414).
// Every value is the authorization server's OWN — route.ts `OAUTH` is what
// identity.ts configures the provider with and what both `/.well-known`
// documents serve — so this page cannot come to teach an address the door
// does not answer.
//
// The honest answer for every assistant here is "nothing": they all register
// themselves (RFC 7591) at the registration endpoint below, which is why the
// client boxes stay empty and there is no secret anywhere. The values are for
// the form that refuses an empty box, and for whatever asks instead of
// looking.
let ID =
  'Leave <b>OAuth Client ID</b> and <b>OAuth Client Secret</b> empty. There ' +
  'is no secret to enter: the connector registers itself the first time it ' +
  'knocks, and what protects it is PKCE, not a password. Nothing needs ' +
  'allow-listing here either — we take whichever redirect address it ' +
  'registers.'

let BOXES = `<b>Authorization URL</b> ${
  at(OAUTH.authorize)
}, <b>Token URL</b> ${at(OAUTH.token)}, <b>Registration URL</b> ${
  at(OAUTH.register)
}, <b>Scope</b> <code>${OAUTH.scope}</code>.`

let URLS = `If a box will not take an empty value: ${BOXES}`

// Nothing interpolated below is anybody's input, so it is written as the
// markup it is; everything that IS a person's is escaped where it enters.
//
// Step one is the URL, on the clipboard, in EVERY tab, and step two is the way
// out to that agent's own form — owner, 2026-09-05: "the connect instructions
// should have you copy the mcp url first (click to copy, also) before the link
// to .../plugins. so you don't have to click back an extra time" (T-34412).
//
// Each provider's steps were read off its own documentation on 2026-09-05:
// support.claude.com article 11176164, help.openai.com article 12584461,
// code.claude.com/docs/en/mcp, cursor.com/docs/mcp. Menus move: the line under
// the tabs says so, and says what to search for instead.
let AGENTS = [
  {
    key: 'claude',
    tab: 'Claude',
    title: 'Claude — web, desktop and mobile',
    steps: [
      'Open <a href="https://claude.ai/customize/connectors">Connectors</a> ' +
      'in your settings, press <b>+</b> and choose <b>Add custom ' +
      'connector</b>.',
      'Paste the URL, give it the name above, and click <b>Add</b>.',
      'Click <b>Connect</b>, and sign in with your email.',
    ],
    note: 'A remote connector follows you to every Claude — the phone too. ' +
      'On a Team or Enterprise plan an owner adds it once under Organization ' +
      'settings, and everyone else clicks Connect.',
    oauth: 'Nothing to fill in. Claude finds all of this itself; the two ' +
      'boxes under <b>Advanced settings</b> are the only ones it could ask ' +
      'about. ' + ID,
  },
  {
    key: 'chatgpt',
    tab: 'ChatGPT',
    title: 'ChatGPT — on the web',
    // The longer address, and only here (T-34416): ChatGPT decides whether a
    // server needs signing in by calling it with nobody signed in, so it is
    // the one client that must be given `?auth=required`. Step one hands it
    // over whole, which is the point of copying the URL before leaving.
    url: MCP_ASK,
    steps: [
      'Open <a href="https://chatgpt.com/plugins">chatgpt.com/plugins</a>. ' +
      'If it is not there, turn on <b>Developer mode</b> first, under ' +
      '<b>Settings</b> → <b>Connectors</b> → <b>Advanced settings</b>.',
      'Press <b>Create</b>, and paste that URL as the MCP server URL — all ' +
      'of it, the <code>?auth=required</code> included.',
      'Give it the name, description and icon above: this form asks for all ' +
      'three and reads none of them off the server.',
      'Create it and sign in when it asks. It appears under <b>Developer ' +
      'mode</b> below the message box.',
    ],
    note: 'Without <code>?auth=required</code> ChatGPT connects as a ' +
      'stranger and never offers you the sign-in. The web app, not the phone ' +
      'one. On a Business or Enterprise workspace an admin may have to allow ' +
      'developer mode first.',
    oauth: 'Set <b>Authentication</b> to <b>OAuth</b> — not "no ' +
      'authentication", and not an API key, which we do not take. ' + ID +
      ' ' + URLS,
  },
  {
    key: 'claude-code',
    tab: 'Claude Code',
    title: 'Claude Code',
    steps: [
      `In your terminal: <code class="Pick">claude mcp add --transport http yaks ${MCP}</code>`,
      'Start Claude Code, run <code>/mcp</code>, pick <b>yaks</b> and choose ' +
      '<b>Authenticate</b>. It opens your browser to sign in.',
    ],
    note: 'Add <code>--scope user</code> to that first line to have it in ' +
      'every project, not just this one.',
    oauth: 'Nothing to fill in — there is no form. <b>Authenticate</b> opens ' +
      'the browser, you sign in, and the terminal has the tools.',
  },
  {
    key: 'cursor',
    tab: 'Cursor',
    title: 'Cursor',
    steps: [
      'Open <b>Cursor Settings</b> → <b>Tools &amp; Integrations</b> and ' +
      'press <b>New MCP Server</b>. It opens <code>~/.cursor/mcp.json</code>.',
      'Add the server, with the URL as its one field: <code class="Pick">' +
      '{ "mcpServers": { "yaks": { "url": "' + MCP + '" } } }</code>',
      'Back in <b>Tools &amp; Integrations</b>, click <b>yaks</b> and sign in.',
    ],
    note: 'A <code>.cursor/mcp.json</code> in a project folder does the same ' +
      'thing for that project alone.',
    oauth: 'Nothing to fill in — that one field is the whole entry. Cursor ' +
      'registers itself and opens the browser when you click sign in.',
  },
  {
    key: 'other',
    tab: 'Any MCP client',
    title: 'Anything else that speaks MCP',
    steps: [
      'Give it that URL, over streamable HTTP. It will walk you through ' +
      'signing in.',
      'If it asks what to call the server, the name and description above ' +
      'are what this one answers to.',
    ],
    note: '',
    oauth:
      `Anything that reads ${
        at('/.well-known/oauth-authorization-server')
      } needs nothing typed at all. For one that asks instead: ${BOXES} ` +
      'Authorization code with PKCE (<code>S256</code>), a refresh token ' +
      'that does not expire, and no client secret — the client registers ' +
      'itself.',
  },
]

// The tab strip and its panels: radios, a row of labels, and a panel each,
// all siblings so plain CSS `:checked ~` shows one at a time. The browser owns
// the switching — no script runs for a tab to work, and the script below only
// keeps the chosen one in the address.
let tabsCss = AGENTS.map((a) =>
  `#tab-${a.key}:checked ~ .Tabs_Strip label[for="tab-${a.key}"] { border-color: var(--meadow); background: var(--meadow); color: var(--ground) }
#tab-${a.key}:focus-visible ~ .Tabs_Strip label[for="tab-${a.key}"] { outline: 3px solid var(--meadow); outline-offset: 3px }
#tab-${a.key}:checked ~ .Tabs_Panel-${a.key} { display: block }`
).join('\n')

let doors = `${face}
<div class="Tabs">
${
  AGENTS.map((a, i) =>
    `<input type="radio" name="agent" id="tab-${a.key}" value="${a.key}"${
      i ? '' : ' checked'
    }>`
  ).join('\n')
}
<nav class="Tabs_Strip" aria-label="Assistants">${
  AGENTS.map((a) =>
    `<label class="Tabs_Tab" for="tab-${a.key}">${a.tab}</label>`
  ).join('')
}</nav>
${
  AGENTS.map((a) =>
    `<section class="Card Tabs_Panel Tabs_Panel-${a.key}"><h2>${a.title}</h2>
<ol><li>Copy the URL:${copyable(a.url ?? MCP, 'the MCP URL')}</li>${
      a.steps.map((s) => `<li>${s}</li>`).join('')
    }</ol>
${a.note ? `<p class="Note">${a.note}</p>` : ''}
<p class="Note"><b>OAuth settings.</b> ${a.oauth}</p>
</section>`
  ).join('')
}
</div>`

// The only script a tab needs, and it is not what switches one: the radios do
// that with no script at all. This keeps the CHOSEN one in the address, so a
// link can name a tab and a reload comes back to it. Matched by VALUE, never
// built into a selector — a hash is whatever a stranger put in it.
let tabbing = `<script>
let tabs = document.querySelector('.Tabs')
if (tabs) {
  let all = [...tabs.querySelectorAll('input[name=agent]')]
  let pick = () => {
    let want = all.find((r) => r.value == decodeURIComponent(location.hash.slice(1)))
    if (want) want.checked = true
  }
  pick()
  addEventListener('hashchange', pick)
  tabs.addEventListener('change', (e) => {
    if (e.target.name == 'agent') {
      history.replaceState(null, '', '#' + e.target.value)
    }
  })
}
</script>`

// One listener, no framework: the form answers in place. Constant text, no
// interpolation, and every write to the page is textContent — the page never
// speaks HTML on a person's behalf.
let inline = `<script>
let f = document.querySelector('.Addr')
if (f) f.addEventListener('submit', async (e) => {
  e.preventDefault()
  let say = f.querySelector('.Say')
  let go = f.querySelector('button')
  let now = document.querySelector('.Now b')
  go.disabled = true
  say.className = 'Say'
  say.textContent = 'Saving…'
  try {
    let r = await fetch('/connect', {
      method: 'POST',
      headers: { accept: 'application/json' },
      body: new FormData(f),
    })
    let out = await r.json()
    if (out.address) {
      now.textContent = out.address
      f.querySelector('input').value = out.slug
      say.textContent = 'Saved. Your apps live at ' + out.address + '.'
    } else {
      say.className = 'Say Say-no'
      say.textContent = out.error
    }
  } catch (_) {
    say.className = 'Say Say-no'
    say.textContent = "That didn't go through. Try again?"
  }
  go.disabled = false
})

// The billing buttons: ask our own door for a Stripe URL and follow it. The
// URL is minted per person and expires, so it is never written into the page.
for (let b of document.querySelectorAll('.Bill_Go')) {
  b.addEventListener('click', async () => {
    let say = document.querySelector('.Bill_Say')
    b.disabled = true
    say.className = 'Say Bill_Say'
    say.textContent = 'One moment…'
    try {
      let r = await fetch('/api/billing/' + b.dataset.door, { method: 'POST' })
      let out = await r.json()
      if (out.url) { location = out.url; return }
      say.className = 'Say Bill_Say Say-no'
      say.textContent = out.error ? out.error.message : 'That did not go through.'
    } catch (_) {
      say.className = 'Say Bill_Say Say-no'
      say.textContent = "That didn't go through. Try again?"
    }
    b.disabled = false
  })
}
</script>`

export let connect = (yours: Yours, status = 200) =>
  shell(
    'Connect your assistant',
    'Add yaks.app in your assistant’s settings using the steps below. Then ask it to build an app.',
    status,
    `${mine(yours)}${plan(yours)}${doors}
<p class="Note">Menus move. If yours doesn't look like this, search its
settings for "connector" or "MCP" — the link is the same wherever it
goes.</p>
<p class="Note">New here? <a href="https://yaks.app/help">Help</a> answers the
questions people ask most: what you can make, where your apps live, and who
can see them.</p>
${home}${copying}${tabbing}${inline}`,
  )
