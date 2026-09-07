// The kernel's own pages, in the home page's voice (workers/yak/public): what
// a person sees when there is nothing at an address, when an app broke, and
// where they sign in. One shell, three sentences, and an optional card of
// markup under them. Shared controls and tokens come from public/controls.css.
// Errors stay in the graph for the person's chatbot (D-32318 §Errors).
//
// Everything interpolated here is escaped by `esc` at the call site: a page
// carries an email address a stranger typed, and web content never speaks
// HTML (the repo's md.ts rule, one floor down).

import type { Frame } from './build.ts'
import { icon, type IconName } from './icons.ts'
import {
  managePath,
  type ManageView,
  MCP,
  MCP_ASK,
  OAUTH,
  PLATFORM,
} from './route.ts'
import { CONNECTOR } from './seo.ts'

// The one escape: `&` first, so an escape is never escaped twice.
export let esc = (s: string) =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')

let home = '<a class="Away" href="https://yaks.app/">yaks.app</a>'

let shell = (
  title: string,
  lead: string | null,
  status: number,
  inner = home,
  // Extra response headers, beside content-type — `Retry-After` on the
  // provisioning page below, nothing else needs one today.
  headers: Record<string, string> = {},
  layout = '',
) =>
  new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title} · yaks.app</title>
<link rel="stylesheet" href="https://yaks.app/controls.css">
<style>
@layer base {
* { box-sizing: border-box }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--ground); color: var(--ink); font: 400 1.05rem/1.6 'Nunito', system-ui, sans-serif }
main { width: 100%; max-width: 34rem; padding: 2rem 1rem; text-align: center; overflow-wrap: anywhere }
h1 { font-size: 1.6rem; font-weight: 800; margin: 0 0 .5rem }
p { color: var(--soft-ink); margin: 0 0 1rem }
a { color: var(--accent); text-underline-offset: .18em }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px }
form { display: grid; gap: .75rem; margin: 1.5rem 0 1rem }
form p { margin: 0; font-size: .95rem }
input { text-align: center }
}
@layer sections {
.Code { letter-spacing: .5em; font-size: 1.4rem; font-weight: 700 }
.Away { font-size: .95rem }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .9rem; background: var(--ground); border-radius: .4rem; padding: .1rem .35rem; overflow-wrap: anywhere }
.Url code { display: inline-block; padding: .5rem 1rem; border-radius: 999px; background: var(--paper); font-size: .95rem }
.Card { --card-pad: 1.1rem 1.25rem; margin: 0 0 1rem; text-align: left }
.Card h2 { font-size: 1.05rem; font-weight: 800; margin: 0 0 .6rem }
.Card ol { display: grid; gap: .4rem; margin: 0; padding-left: 1.2rem; color: var(--soft-ink); font-size: .95rem }
.Card li::marker { color: var(--accent); font-weight: 700 }
.Card pre { margin: 0; white-space: pre-wrap; font: inherit; color: var(--soft-ink); text-align: left }
.Card form { margin: 1rem 0 0 }
.Note { font-size: .9rem; margin: .75rem 0 0 }
details.Note > summary { color: var(--accent); cursor: pointer }
.Pills { display: flex; flex-wrap: wrap; justify-content: center; gap: .625rem; margin: 0 0 1.25rem }
.Pill { display: inline-block; padding: .5rem 1rem; border: 1px solid var(--line); border-radius: 999px; background: var(--paper); color: var(--ink); font-weight: 700; text-decoration: none }
.Pill:hover { border-color: var(--accent) }
.Pill_Tag { margin-left: .5rem; color: var(--soft-ink); font-weight: 400; font-size: .85rem }
.Pick { display: block; margin: .4rem 0; padding: .5rem .6rem; user-select: all }
.Says { display: grid; gap: .5rem; margin: .75rem 0 1rem; padding: 0; list-style: none }
.Copy { display: flex; align-items: center; gap: .5rem }
.Copy .Pick { flex: 1; margin: 0; border-radius: .7rem; background: var(--ground) }
.Copy_Go { --button-pad: .4rem .9rem; --button-fill: var(--paper); --button-ink: var(--accent); flex: none; font-size: .85rem; font-weight: 700 }
.At { display: flex; align-items: center; justify-content: center; gap: .3rem }
.At input { flex: 0 1 13rem; text-align: right }
.At span { color: var(--soft-ink) }
.Attach { margin: 0 0 1rem; text-align: left }
.Attach > summary { font-weight: 800; font-size: 1.05rem; cursor: pointer; padding: .6rem 0; text-align: center }
.Attach > p { margin: .75rem 0 1rem }
.Say { min-height: 1.3rem; margin: 0; font-size: .95rem }
.Say-no { color: var(--warn) }
.Views_App { display: grid; gap: .5rem; padding-top: 1rem }
.Views_App + .Views_App { border-top: 1px solid var(--line) }
.Views_App h3 { margin: 0; font-size: 1rem; font-weight: 800 }
.Views_Total { color: var(--soft-ink); font-weight: 400; font-size: .9rem }
.Views_Chart { display: block; width: 100%; height: 4rem }
.Views_Bar { fill: var(--accent) }
.Views_Span { display: flex; justify-content: space-between; margin: 0; color: var(--soft-ink); font-size: .9rem }
.Views_Tops { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)) }
.Views_Column h4 { margin: 0 0 .25rem; color: var(--soft-ink); font-size: .9rem; font-weight: 700 }
.Views_List { display: grid; gap: .25rem; margin: 0; padding: 0; list-style: none; font-size: .9rem }
.Views_List li { display: flex; justify-content: space-between; gap: .5rem }
.Views_List span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.Bill_Doors { display: flex; flex-wrap: wrap; gap: .625rem; margin: 1rem 0 .5rem }
.Bill_Go-quiet { --button-fill: var(--paper); --button-ink: var(--accent) }
.Drop_Zone { display: grid; place-items: center; gap: .5rem; padding: 1.4rem 1rem; border: 2px dashed var(--soft-ink); border-radius: 1.25rem; background: var(--ground); text-align: center; cursor: pointer }
.Drop_Zone-over { border-color: var(--accent); background: var(--paper) }
.Drop_File { border: 0; padding: 0; background: none; cursor: pointer }
.Drop_Say { color: var(--soft-ink); font-size: .9rem }
.Files { display: grid; gap: .3rem; margin: 0; padding-left: 1.2rem; color: var(--soft-ink); font-size: .95rem }
.Chat_Said { display: grid; gap: .45rem; margin: 0 0 1rem }
.Chat_Said:empty { display: none }
.Chat_Bubble { max-width: 90%; margin: 0; padding: .55rem .9rem; border-radius: 1.1rem; background: var(--ground); color: var(--ink); white-space: pre-wrap }
.Chat_Bubble-you { justify-self: end; background: var(--accent); color: var(--ground) }
.Chat_Bubble a { color: inherit }
.Chat_Tool { display: flex; gap: .4rem; align-items: baseline; margin: 0; padding: 0 .3rem; color: var(--soft-ink); font-size: .9rem }
.Chat_Tool-no { color: var(--warn) }
.Chat_Name { font-weight: 700; flex: none }
.Chat_Of { overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
.Chat_Built { margin: .4rem 0; padding: 1rem; border: 2px solid var(--accent); border-radius: 1.25rem; background: var(--ground); text-align: center }
.Chat_Built p { margin: 0 0 .6rem }
.Chat_Note { margin: 0; color: var(--soft-ink); font-size: .9rem }
.Chat_Ask { margin: 0 }
.Chat_Ask textarea { width: 100%; min-height: 4.5rem; resize: vertical }
.Chat_Ask textarea:disabled { opacity: .6 }
.Fields { display: grid; gap: .55rem; margin: .55rem 0 0 }
.Fields > div { display: grid; grid-template-columns: 6rem minmax(0, 1fr); align-items: center; gap: .65rem }
@media (max-width: 480px) { .Fields > div { grid-template-columns: minmax(0, 1fr); gap: .25rem } }
.Fields dt { color: var(--ink); font-weight: 800 }
.Fields dd { min-width: 0; margin: 0 }
.Fields .Copy { min-width: 0 }
.Connect_Icon { display: flex; align-items: center; gap: .65rem }
.Connect_Icon img { display: block; width: 56px; height: 56px; border: 1px solid var(--line); border-radius: .75rem }
.Connect_Next { margin-top: .9rem; padding-top: .8rem; border-top: 1px solid var(--line) }
.Connect_Next p { margin: 0 0 .35rem; color: var(--ink); font-weight: 800 }
${deskCss}
}
</style>
</head>
<body${layout ? ` class="${layout}"` : ''}><main>${
      lead == null ? '' : `<h1>${title}</h1><p>${lead}</p>`
    }${inner}</main></body>
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
    `<p><a class="Button" href="${
      managePath('trash')
    }">Restore it from your apps</a></p>`,
  )

// A SPACE in the trash, at any address of its own (erase.ts, T-34431).
// Everyone else gets `nothingHere` at every one of them — a deleted space is
// not a stranger's news — so this is its OWNER, told where their space went,
// how long they have, and given the one button that brings it back. A form
// POSTing to `/`, the same door the space page's own forms use (apps.ts
// `saved`), so a restore needs no assistant and no script. A 404 with words
// in it, because the address really is answering nothing.
export let spaceBinned = (at: {
  slug: string
  title: string
  days: number
}) =>
  shell(
    `${esc(at.title)} is in the trash.`,
    `Nothing answers at ${esc(at.slug)}.yaks.app until you restore it — no ` +
      `app here, and no page. Everything the space had is kept for ${at.days} more ${
        at.days == 1 ? 'day' : 'days'
      }, then erased for good.`,
    404,
    `<form method="post" action="/">
<input type="hidden" name="restore-space" value="${esc(at.slug)}">
<button class="Button" type="submit">Restore ${esc(at.slug)}.yaks.app</button>
</form>
<p class="Note">Its apps, their files and everything they saved come back
exactly as they were.</p>${home}`,
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
<input class="Drop_File" type="file" name="file" required aria-label="App files">
<span class="Drop_Say">A .zip of the app's files, or a single index.html</span>
</label>
${
    slug
      ? held('slug', slug)
      : `<input class="Field" name="slug" maxlength="63" ` +
        `autocomplete="off" spellcheck="false" placeholder="what to call it" ` +
        `aria-label="What to call the app">`
  }
<button class="Button" type="submit">${
    slug ? 'Update app' : 'Upload app'
  }</button>
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
<p><textarea class="Field" name="say" rows="3" required placeholder="A recipe box I can share with my sister" aria-label="What do you want to build?"></textarea></p>
<button class="Button" type="submit">Build it</button>
</form>`

// The optional built-in builder, reached from New app.
let chat = (built: boolean, frames?: Frame[]) =>
  `<section class="Card Chat">
<h2>${built ? 'Build another app' : 'What would you like to make?'}</h2>
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
<p><a class="Away" href="${managePath()}">Back to your apps</a></p>
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
<div class="Card"><h2>${at.slug ? 'Update app files' : 'Try again'}</h2>
<p class="Note">${
      at.slug
        ? `Drop another zip — or one index.html — and ${
          esc(at.slug)
        } becomes it.`
        : 'A .zip of the files, or a single index.html.'
    }</p>
${dropZone(at.slug)}
</div>
<p><a class="Away" href="${managePath()}">Back to your apps</a></p>
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
  }</span><button class="Button Copy_Go" type="button"${
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

// Who visited, on the space page (views.ts, T-34497): a block per app, the
// owner's alone. A bar per day for the window, then the three short lists —
// the pages people opened, the sites that sent them, the countries they were
// in — as tables, because a table reads on a phone and needs no script.
//
// The chart is inline SVG with `preserveAspectRatio="none"`: the viewBox is
// one unit per day, the page stretches it to whatever width there is, and a
// rectangle stretched is still a rectangle. No library, no canvas, no script —
// and the whole series is in one `aria-label` for anyone who cannot see it.
let count = (n: number) => n.toLocaleString('en-US')

// Short enough for the ends of an axis: "7 Aug".
let axisDay = (iso: string) => {
  let at = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

let chart = (days: { day: string; views: number }[], total: number) => {
  let most = Math.max(...days.map((d) => d.views), 1)
  let bars = days.map((d, i) =>
    `<rect class="Views_Bar" x="${(i + 0.15).toFixed(2)}" y="${
      (40 - (d.views / most) * 40).toFixed(2)
    }" width="0.7" height="${((d.views / most) * 40).toFixed(2)}"></rect>`
  ).join('')
  return `<svg class="Views_Chart" viewBox="0 0 ${days.length} 40"
preserveAspectRatio="none" role="img" aria-label="${
    count(total)
  } visits over ${days.length} days, ${
    count(days[days.length - 1]?.views ?? 0)
  } on the last day">${bars}</svg>
<p class="Views_Span"><span>${esc(axisDay(days[0]?.day ?? ''))}</span><span>${
    esc(axisDay(days[days.length - 1]?.day ?? ''))
  }</span></p>`
}

let column = (head: string, rows: { name: string; views: number }[]) =>
  rows.length
    ? `<div class="Views_Column"><h4>${head}</h4>
<ul class="Views_List">${
      rows.map((r) =>
        `<li><span>${esc(r.name)}</span><b>${count(r.views)}</b></li>`
      ).join('')
    }</ul></div>`
    : ''

/** One app's numbers, as `spaceIndex` is handed them. */
export type Visits = {
  slug: string
  title: string
  stats: {
    days: number
    total: number
    daily: { day: string; views: number }[]
    pages: { name: string; views: number }[]
    from: { name: string; views: number }[]
    countries: { name: string; views: number }[]
  }
}

let visits = (v: Visits) =>
  `<article class="Views_App"><h3>${esc(v.title || v.slug)} <span
class="Views_Total">${count(v.stats.total)} ${
    v.stats.total == 1 ? 'visit' : 'visits'
  }</span></h3>${
    v.stats.total
      ? chart(v.stats.daily, v.stats.total) +
        `<div class="Views_Tops">${
          column('Pages', v.stats.pages) + column('Came from', v.stats.from) +
          column('Countries', v.stats.countries)
        }</div>`
      : '<p class="Note">Nobody has opened this one yet.</p>'
  }</article>`

// `null` is the platform with no analytics token set (views.ts NOT_ON): one
// sentence, because there is nothing here for the reader to do about it.
let visited = (apps: Visits[] | null, days: number, off: string) =>
  `<section class="Card"><h2>Who visited</h2>
${
    apps == null
      ? `<p class="Note">${esc(off)}</p>`
      : `<p class="Note">The last ${days} days. Counts only — no names, no
addresses, nothing that says who anybody is.</p>${apps.map(visits).join('')}`
  }
</section>`

// Owners get an app library and separate management pages. Visitors only see
// apps they may open; account controls never enter their response.
export type SpacePage = {
  space: string
  title: string
  apps: {
    slug: string
    title: string
    gallery?: string
    home?: boolean
    access?: string | null
  }[]
  trash?: { slug: string; title: string; days: number }[]
  hidden: number
  role: string | null
  person: boolean
  signIn: string
  name?: string
  connected?: boolean
  fixed?: boolean
  views?: Visits[] | null
  viewDays?: number
  viewsOff?: string
  sell?: 'none' | 'setup' | 'ready'
  fee?: string
  say?: string
  no?: boolean
  view?: ManageView
}

let deskCss = `
.Desk { display: block }
.Desk main { display: grid; grid-template-columns: 13.5rem minmax(0, 1fr); align-items: start; max-width: 80rem; min-height: 100vh; margin: auto; padding: 0; text-align: left }
.Desk_Side { position: sticky; top: 0; display: flex; flex-direction: column; gap: 2rem; min-height: 100vh; padding: 2rem 1.25rem; border-right: 1px solid var(--line) }
.Desk_Brand { display: flex; align-items: center; gap: .65rem; color: var(--ink); font-size: 1.25rem; font-weight: 800; text-decoration: none }
.Desk_Brand img { border-radius: .65rem }
.Desk_Count { margin-left: auto; font-size: .8rem; opacity: .8 }
.Desk_Foot { margin-top: auto; display: grid; gap: .5rem; padding: .5rem .8rem; font-size: .85rem }
.Desk_Body { min-width: 0; padding: 2.5rem clamp(1.25rem, 4vw, 3.5rem) }
.Desk_Head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 2rem }
.Desk_Head h1 { font-size: 1.9rem; margin: .15rem 0 0 }
.Desk_Address { font-size: .85rem; text-decoration: none; color: var(--soft-ink) }
.Desk_Head .Button { flex: none; padding: .6rem 1.2rem; font-size: .95rem }
.Desk_Content { max-width: 52rem }
.Desk .Card { --card-pad: 1.5rem }
.Desk .Card h2 { font-size: 1.15rem }
.Desk .Card p:last-child { margin-bottom: 0 }
.Desk .Card form { max-width: 34rem }
.Desk input { text-align: left }
.Desk form button { justify-self: start }
.Desk form label { font-size: .95rem; font-weight: 700 }
.Desk .At { justify-content: start }
.Desk .At input { flex: 1; text-align: left }
.Desk .Say:empty { display: none }
.Desk .Says { margin-bottom: 0 }
.Desk_Connect { display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; margin-bottom: 2rem; padding: 1.25rem 1.5rem; border: 1px solid var(--accent); border-radius: 1rem }
.Desk_ChatLinks { display: flex; flex-direction: column; gap: .5rem; flex: none; font-size: .95rem }
.Desk_Connect h2 { margin: 0 0 .35rem; font-size: 1.1rem }
.Desk_Connect p { margin: 0; font-size: .95rem; max-width: 34rem }
.Desk_Connect .Button { flex: none; padding: .6rem 1.1rem; font-size: .9rem }
.Apps { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: 1rem }
.Apps_Item { display: flex; flex-direction: column; align-items: start; gap: .55rem; min-height: 12rem; padding: 1.25rem; border: 1px solid var(--line); border-radius: 1rem; background: var(--paper); color: var(--ink); text-decoration: none }
.Apps_Item:hover { border-color: var(--accent) }
.Apps_Item img { width: 44px; height: 44px; border-radius: .75rem; margin-bottom: .5rem }
.Apps_Item strong { font-size: 1.05rem; line-height: 1.3 }
.Apps_Path { color: var(--soft-ink); font-size: .85rem }
.Apps_Tags { display: flex; flex-wrap: wrap; gap: .45rem; margin-top: auto; padding-top: .5rem; font-size: .75rem; color: var(--soft-ink) }
.Apps_Tag { padding: .1rem .5rem; border-radius: .35rem; background: var(--ground) }
.Desk_Empty { padding: 2.5rem 1rem; text-align: center }
.Desk_Empty h2 { margin: 0 0 .5rem; font-size: 1.25rem }
.Desk_Empty p { margin: 0 auto 1rem; max-width: 28rem }
.Desk_Options { margin-top: 1.5rem }
.Desk_Options > summary { cursor: pointer; color: var(--accent); font-weight: 700; padding: .5rem 0 }
.Desk_Options > .Card { margin-top: .75rem }
.Desk_Trash { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 0; margin: 0; border-top: 1px solid var(--line) }
.Desk_Trash:first-of-type { border-top: 0 }
.Desk_Trash p { color: var(--ink) }
.Desk_Trash small { display: block; color: var(--soft-ink) }
.Desk .Desk_Trash { max-width: none; margin: 0 }
.Desk_Skip { position: absolute; top: -5rem; left: 1rem; padding: .6rem 1rem; background: var(--paper); z-index: 1 }
.Desk_Skip:focus { top: 1rem }
@media (max-width: 700px) {
  .Desk main { display: block }
  .Desk_Side { position: static; min-height: 0; gap: 1rem; padding: 1rem; border-right: 0; border-bottom: 1px solid var(--line) }
  .Desk_Brand { font-size: 1.1rem }
  .Desk_Brand img { width: 30px; height: 30px }
  .Desk .SideNav { display: flex; flex-wrap: wrap; gap: .3rem }
  .Desk .SideNav a { padding: .45rem .65rem; font-size: .85rem; gap: .4rem }
  .Desk .SideNav hr, .Desk_Foot { display: none }
  .Desk_Body { padding: 1.5rem 1rem }
  .Desk_Head { margin-bottom: 1.5rem }
  .Desk_Head h1 { font-size: 1.55rem }
  .Desk_Connect { align-items: start; flex-direction: column; gap: 1rem; padding: 1.1rem }
  .Desk .Card { --card-pad: 1.1rem }
  .Apps { grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: .75rem }
  .Apps_Item { min-height: 11rem; padding: 1rem }
}
`

let navIcons = {
  apps: 'layout-grid',
  connect: 'bot',
  visits: 'chart-no-axes-column-increasing',
  selling: 'credit-card',
  settings: 'settings-2',
  trash: 'trash-2',
} satisfies Record<string, IconName>

let navigation = (at: SpacePage, view: ManageView) => {
  let link = (key: keyof typeof navIcons, label: string) =>
    `<a href="${managePath(key)}"${
      view == key || (view == 'new' && key == 'apps')
        ? ' aria-current="page"'
        : ''
    }>
${icon(navIcons[key])}${label}${
      key == 'trash' && at.trash?.length
        ? `<span class="Desk_Count">${at.trash.length}</span>`
        : ''
    }</a>`
  return `<a class="Desk_Skip" href="#content">Skip to content</a>
<aside class="Desk_Side">
<a class="Desk_Brand" href="https://yaks.app/"><img src="https://yaks.app/yaks-app.png" width="36" height="36" alt="">yaks.app</a>
<nav class="SideNav" aria-label="Manage your apps">
${link('apps', 'Apps')}${link('connect', 'Chatbots')}<hr>
${link('visits', 'Visits')}${at.sell ? link('selling', 'Selling') : ''}
${link('settings', 'Settings')}${link('trash', 'Trash')}
</nav>
<div class="Desk_Foot"><a href="/" target="_blank" rel="noopener">View homepage ${
    icon('external-link')
  }</a><a href="https://yaks.app/help" target="_blank" rel="noopener">Help</a></div>
</aside>`
}

let connectCard = (at: SpacePage) =>
  `<section class="Desk_Connect"><div><h2>${
    at.connected ? 'Keep building in your chat' : 'Connect your chatbot'
  }</h2><p>${
    at.connected
      ? 'Ask for an app, try it, then keep asking for changes in the same conversation.'
      : 'Build and improve your apps in the conversations you already have with Claude or ChatGPT.'
  }</p></div>${
    at.connected
      ? `<div class="Desk_ChatLinks">${
        external('https://chatgpt.com/', 'Open ChatGPT')
      }${external('https://claude.ai/new', 'Open Claude')}</div>`
      : `<a class="Button" href="${managePath('connect')}">Connect chatbot</a>`
  }</section>`

let library = (at: SpacePage) =>
  `${!at.connected ? connectCard(at) : ''}${
    at.apps.length
      ? `<div class="Apps">${
        at.apps.map((a) =>
          `<a class="Apps_Item" href="/${
            esc(a.slug)
          }/" target="_blank" rel="noopener">
<img src="/${esc(a.slug)}/icon.png" width="44" height="44" alt="">
<strong>${esc(a.title || a.slug)}</strong><span class="Apps_Path">/${
            esc(a.slug)
          }</span>
<span class="Apps_Tags">${
            a.home ? '<span class="Apps_Tag">Homepage</span>' : ''
          }${a.access ? `<span class="Apps_Tag">${esc(a.access)}</span>` : ''}${
            a.gallery ? `<span class="Apps_Tag">${esc(a.gallery)}</span>` : ''
          }</span></a>`
        ).join('')
      }</div>`
      : `<section class="Desk_Empty"><h2>Your apps will live here</h2><p>${
        at.connected
          ? 'Ask your chatbot for your first app. Try this:'
          : 'A recipe box, a book club page, a tool for your day. Start with an idea.'
      }</p>${
        at.connected
          ? copyable(
            'Use yaks.app to build me a recipe box.',
            'a first app request',
          )
          : `<a href="${managePath('new')}">More ways to make an app</a>`
      }</section>`
  }`

let preferences = (at: SpacePage) => {
  let home = at.apps.find((a) => a.home)
  return `<section class="Card"><h2>Profile</h2>
<form method="post" action="${managePath('settings')}">
<label for="your-name">Your name</label>
<input class="Field" id="your-name" name="name" maxlength="60" autocomplete="name" placeholder="Dana" value="${
    esc(at.name ?? '')
  }">
<button class="Button" type="submit">Save name</button></form></section>
<section class="Card"><h2>App address</h2>${
    at.fixed
      ? `<p>${
        esc(at.space)
      }.yaks.app</p><p class="Note">The address is fixed once you've created an app.</p>`
      : `<form method="post" action="${managePath('settings')}">
<label for="your-address">Your address</label>
<span class="At"><input class="Field" id="your-address" name="space" maxlength="63" autocomplete="off" spellcheck="false" value="${
        esc(at.space)
      }"><span>.yaks.app</span></span>
<p class="Note">You can change this until you create your first app.</p><button class="Button" type="submit">Save address</button></form>`
  }</section>
<section class="Card"><h2>Homepage</h2><p>${
    home
      ? `${esc(home.title || home.slug)} opens at your address.`
      : 'Your address opens your app library.'
  }</p><p class="Note">Ask your assistant to make any app your homepage. Manage your apps anytime at <a href="https://yaks.app/manage">yaks.app/manage</a>.</p></section>`
}

let selling = (at: SpacePage) => {
  if (!at.sell) return '<p>Selling is not available here yet.</p>'
  let ready = at.sell == 'ready'
  return `<section class="Card"><h2>${
    ready ? 'Payments are connected' : 'Take payments in your apps'
  }</h2>
<p>${
    ready
      ? 'Payments go to your Stripe account. You manage refunds and disputes there.'
      : at.sell == 'setup'
      ? 'Finish connecting your Stripe account to start accepting payments.'
      : 'Connect your Stripe account to accept payments from your customers.'
  }</p><p class="Note">yaks.app takes ${
    esc(at.fee ?? '')
  } of each sale. <a href="https://yaks.app/pricing" target="_blank" rel="noopener">Pricing</a></p>
<form method="post" action="${
    managePath('selling')
  }"><input type="hidden" name="sell" value="${
    ready ? 'stop' : 'start'
  }"><button type="submit" class="Button${ready ? ' Bill_Go-quiet' : ''}">${
    ready
      ? 'Disconnect Stripe'
      : at.sell == 'setup'
      ? 'Continue setup'
      : 'Connect Stripe'
  }</button></form></section>`
}

let trash = (at: SpacePage) =>
  at.trash?.length
    ? `<section class="Card"><p>Deleted apps can be restored for 30 days.</p>${
      at.trash.map((a) =>
        `<form class="Desk_Trash" method="post" action="${managePath('trash')}">
<input type="hidden" name="restore" value="${esc(a.slug)}">
<p>${esc(a.title || a.slug)}<small>${a.days} ${
          a.days == 1 ? 'day' : 'days'
        } left</small></p>
<button type="submit" class="Button Bill_Go-quiet">Restore</button></form>`
      ).join('')
    }</section>`
    : '<section class="Desk_Empty"><h2>Trash is empty</h2></section>'

let desk = (at: SpacePage) => {
  let view = at.view ?? 'apps'
  let titles = {
    apps: 'Your apps',
    connect: 'Your chatbots',
    new: 'New app',
    visits: 'Visits',
    selling: 'Selling',
    settings: 'Settings',
    trash: 'Trash',
  }
  let body = ''
  if (view == 'apps') body = library(at)
  if (view == 'connect') {
    body = `${
      at.connected ? '<p class="Desk_Status">✓ Chatbot connected</p>' : ''
    }<p>Connect once, then build and keep improving your apps in your usual chats.</p>${doors}${copying}${tabbing}`
  }
  if (view == 'new') {
    body = `${connectCard(at)}
<details class="Desk_Options"><summary>Build an app here</summary>${
      chat(!!at.apps.length)
    }</details>
<details class="Desk_Options"><summary>Upload an existing app</summary><section class="Card"><h2>Upload app files</h2>${dropZone()}</section></details>${chatLive}${dropping}`
  }
  if (view == 'visits') {
    body = at.apps.length
      ? visited(at.views ?? null, at.viewDays ?? 30, at.viewsOff ?? '')
      : '<section class="Desk_Empty"><h2>No visits yet</h2><p>Your app visits will appear here once you have an app.</p></section>'
  }
  if (view == 'selling') body = selling(at)
  if (view == 'settings') body = preferences(at)
  if (view == 'trash') body = trash(at)
  return shell(
    `${titles[view]} · ${esc(at.space)}`,
    null,
    at.no ? 400 : 200,
    `${
      navigation(at, view)
    }<div class="Desk_Body"><header class="Desk_Head"><div>
<a class="Desk_Address" href="/" target="_blank" rel="noopener">${
      esc(at.space)
    }.yaks.app ↗</a><h1>${titles[view]}</h1></div>${
      view == 'apps'
        ? `<a class="Button" href="${managePath('new')}">+ New app</a>`
        : ''
    }</header><div class="Desk_Content" id="content" tabindex="-1">${
      at.say
        ? `<p class="Say${at.no ? ' Say-no' : ''}" role="status">${
          esc(at.say)
        }</p>`
        : ''
    }${body}</div></div>${view == 'apps' ? copying : ''}`,
    { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
    'Desk',
  )
}

export let spaceIndex = (at: SpacePage) => {
  if (at.role == 'owner') return desk(at)
  let mine = at.apps.length
    ? `<nav class="Pills" aria-label="Apps here">${
      at.apps.map((a) =>
        `<a class="Pill" href="/${esc(a.slug)}/">${esc(a.title || a.slug)}${
          a.gallery ? `<span class="Pill_Tag">${esc(a.gallery)}</span>` : ''
        }</a>`
      ).join('')
    }</nav>`
    : ''
  let ask = at.hidden
    ? `<p class="Note">${
      at.hidden == 1 ? 'One app here is' : `${at.hidden} apps here are`
    } private. Ask whoever runs this space to let you in.</p>`
    : ''
  let pitch = at.person
    ? home
    : `<p><a class="Button" href="${esc(at.signIn)}">Sign in</a></p>
<div class="Card"><h2>What is yaks.app?</h2><p>Ask an assistant like Claude or ChatGPT for an app, and it builds one here — a page of your own you can send to anyone.</p><a href="https://yaks.app/">Make one of your own</a></div>`
  return shell(
    esc(at.title || at.space),
    at.apps.length
      ? 'Here is what you can open.'
      : 'Nothing here is open to visitors yet.',
    200,
    `${mine}${ask}${pitch}`,
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
  held('q', q) + held('return', back) +
  (back == '/connect' || back?.endsWith(managePath('connect'))
    ? `<script>if (location.hash) document.currentScript.previousElementSibling.value += location.hash</script>`
    : '')

// Ask for an address. `who` names the app asking, when one is (the OAuth
// consent page IS this page — signing in is the consent), and `why` is the
// soft refusal, when there was one: a sign-in link that had already been used
// lands here, carrying whatever it was going to finish (identity.ts, T-34351).
export let askEmail = (
  q: string | null,
  back: string | null,
  who?: string,
  why?: string,
  status = 200,
) =>
  shell(
    'Sign in or sign up',
    why ?? 'Build an app by asking Claude or ChatGPT.',
    status,
    `<form method="post" action="/login">${carried(q, back)}
<p>${
      who ? `${esc(who)} would like to use your apps. ` : ''
    }Enter your email to get a sign-in code.</p>
<input class="Field" name="email" type="email" required autofocus autocomplete="email" placeholder="you@example.com" aria-label="Your email">
<button class="Button" type="submit">Send me a code</button>
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
<p>${
      q
        ? 'Enter it to finish connecting your assistant.'
        : back
        ? 'Enter it to sign in and continue.'
        : 'Enter it to land on your own space.'
    }</p>
<input type="hidden" name="email" value="${esc(email)}">
<input class="Field Code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus autocomplete="one-time-code" aria-label="Your six-digit code">
<button class="Button" type="submit">Sign in</button>
</form>${home}`,
  )

// Closing a space (T-33166, erase.ts): the page that stands in front of it.
// It NAMES what goes — every app, every domain, everyone who loses their way
// in, and the address — because a person about to lose all of it should read
// the list rather than remember it.
//
// Two acts, and the page says which one this is (T-34431). By default the
// space goes to the TRASH, and then each line names something that STOPS
// rather than something destroyed; `forever` is the letter's other link, and
// only then does the page speak of no undo. The lines themselves are the
// caller's (erase.ts `keeping` and `naming`), so the page never has to know
// which act it is drawing except to title it.
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
  // Whether this link erases the space instead of trashing it (erase.ts
  // `Ticket`). Only a ticket the platform signed can say so.
  forever?: boolean
  // Why this cannot happen at all — a space that is still paying, or one
  // already in the trash (erase.ts `refused`, identity.ts `closing`). The page
  // then names the reason and offers no form.
  stop?: string
  why?: string
  status?: number
}) =>
  shell(
    `Delete ${esc(at.slug)}.yaks.app?`,
    esc(
      at.stop ?? at.why ??
        (at.forever
          ? 'This cannot be undone, and nothing is kept.'
          : 'It goes to the trash for 30 days. Nothing is erased, and you ' +
            'can bring it back any time before then.'),
    ),
    at.status ?? 200,
    `${
      at.lines.length
        ? `<section class="Card"><h2>${
          at.forever ? 'What goes, for good' : 'What stops until you restore it'
        }</h2>
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
<input class="Field" name="confirm" autocomplete="off" spellcheck="false" autofocus aria-label="The name of the space">`
        }
<button class="Button" type="submit">${
          at.forever
            ? `Delete ${esc(at.slug)}.yaks.app forever`
            : `Put ${esc(at.slug)}.yaks.app in the trash`
        }</button>
</form>
<p class="Note">Changed your mind? Close this page — nothing has happened.</p>`
    }
${home}`,
  )

// And after: what went, and the one thing worth knowing next — the address
// belongs to nobody now, theirs to take again or somebody else's to take
// later. A space that went to the TRASH has the opposite next thing: the
// address is still theirs, and so is everything under it.
export let deleted = (said: string, forever = true) =>
  shell(
    "That's done.",
    esc(said),
    200,
    `<p class="Note">${
      forever
        ? `The address is free again. Ask your assistant for a new
space whenever you want one.`
        : `Nothing was erased. The address is held for you, and restoring it
puts everything back exactly as it was.`
    }</p>${home}`,
  )

// An app asking, for a browser that is already signed in: one click is the
// whole consent.
export let askAllow = (email: string, q: string, who: string) =>
  shell(
    'Allow access to your apps on yaks.app',
    `${esc(who)} would like to use your apps on yaks.app as ${esc(email)}.`,
    200,
    `<form method="post" action="/oauth/allow">${carried(q)}
<button class="Button" type="submit">Allow</button>
</form>${home}`,
  )

// The connector page, signed in (T-32972). Provider steps come first. The
// address and plan remain reachable below them in a closed disclosure, so
// neither competes with the setup a person came here to finish.
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
<span class="At"><input class="Field" name="space" maxlength="63" autocomplete="off" spellcheck="false" aria-label="The name your apps live at" value="${
      esc(y.said ?? y.slug)
    }"><span>.yaks.app</span></span>
<button class="Button" type="submit">Save</button>
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
      : '<button class="Button Bill_Go" data-door="checkout">Get Plus — $4 a month</button>',
    y.plan.known
      ? '<button class="Button Bill_Go Bill_Go-quiet" data-door="portal">Manage billing</button>'
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

// Connector forms do not ask the same questions. Keep each answer beside the
// provider step that asks for it, so a person never has to work out whether a
// field belongs to the form they are looking at.
let field = (label: string, value: string, what: string) =>
  `<div><dt>${esc(label)}</dt><dd>${copyable(value, what)}</dd></div>`

let fields = (rows: string) => `<dl class="Fields">${rows}</dl>`

let ICON = `https://${PLATFORM}/yaks-app.png`
let chatgptFields = fields(
  field('Name', CONNECTOR.title, 'the name') +
    field('Description', CONNECTOR.description, 'the description') +
    `<div><dt>Icon</dt><dd class="Connect_Icon">
<a href="${ICON}" download="yaks-app.png" aria-label="Download the yaks.app icon">
<img src="${ICON}" width="56" height="56" alt="The yaks.app icon"></a>
<a href="${ICON}" download="yaks-app.png">Download icon</a>
</dd></div>`,
)

let external = (href: string, label: string) =>
  `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`

let request = copyable(
  'Use yaks.app to build me a personal recipe box where I can save, search and tag recipes.',
  'the sample app request',
)

// An address on this platform, spelled out for somebody to type or paste.
let at = (path: string) => `<code>https://${PLATFORM}${path}</code>`

// What to write in an OAuth box, for the forms that have boxes (T-34414).
// Every value is the authorization server's OWN — route.ts `OAUTH` is what
// identity.ts configures the provider with and what both `/.well-known`
// documents serve — so this page cannot come to teach an address the door
// does not answer.
let ID = 'Leave <b>OAuth Client ID</b> and <b>OAuth Client Secret</b> empty.'

let BOXES = `<b>Authorization URL</b> ${
  at(OAUTH.authorize)
}, <b>Token URL</b> ${at(OAUTH.token)}, <b>Registration URL</b> ${
  at(OAUTH.register)
}, <b>Scope</b> <code>${OAUTH.scope}</code>.`

let OAUTH_HELP = `For clients that need manual setup: ${ID} ${BOXES}`

// Nothing interpolated below is anybody's input, so it is written as the
// markup it is; everything that IS a person's is escaped where it enters.
//
// Each provider's steps were read off its own documentation on 2026-09-05:
// support.claude.com article 11176164, help.openai.com article 12584461,
// code.claude.com/docs/en/mcp, cursor.com/docs/mcp.
let AGENTS = [
  {
    key: 'claude',
    tab: 'Claude',
    title: 'Claude — web, desktop and mobile',
    steps: [
      'Copy this URL:' + fields(field('URL', MCP, 'the connection URL')) +
      'Then open ' +
      external('https://claude.ai/customize/connectors', 'Connectors') +
      ', press <b>+</b> and choose <b>Add custom connector</b>.',
      'Paste it into <b>URL</b>, enter this name, then click <b>Add</b>:' +
      fields(field('Name', CONNECTOR.title, 'the name')),
      'Click <b>Connect</b>, and sign in with your email.',
    ],
    note: 'A remote connector follows you to every Claude — the phone too. ' +
      'On a Team or Enterprise plan an owner adds it once under Organization ' +
      'settings, and everyone else clicks Connect.',
    finish: 'Open ' + external('https://claude.ai/new', 'a new Claude chat'),
  },
  {
    key: 'chatgpt',
    tab: 'ChatGPT',
    title: 'ChatGPT — on the web',
    steps: [
      'Open ' +
      external(
        'https://chatgpt.com/#settings/Security',
        'Security and login settings',
      ) +
      ', scroll down and turn on <b>Developer mode</b>.',
      'Copy this URL:' +
      fields(field('Connection', MCP, 'the connection URL')) +
      'Then open ' +
      external(
        'https://chatgpt.com/plugins#settings/Connectors?create-connector=true&redirectAfter=%2F',
        'Create a connection',
      ) + ' and paste it into <b>Connection</b>.',
      'Add the name, description and icon:' + chatgptFields,
      'Check <b>I understand</b>, then click <b>Create</b>.',
      'Sign in with your email when ChatGPT asks.',
    ],
    finish: 'Open ' + external('https://chatgpt.com/', 'a new ChatGPT chat'),
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
    finish: 'Start a new Claude Code chat',
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
    finish: 'Open a new Agent chat in Cursor',
  },
  {
    key: 'other',
    tab: 'Other',
    title: 'Anything else that speaks MCP',
    steps: [
      'Add a streamable HTTP connection with this URL:' +
      fields(field('URL', MCP, 'the MCP URL')),
      'If it asks for a name, use <b>yaks.app</b>. Then follow its sign-in ' +
      'prompt.',
    ],
    details: OAUTH_HELP +
      ' If your client never offers sign-in, use ' +
      `<code>${MCP_ASK}</code> as the server URL.`,
    finish: 'Start a new chat in your MCP client',
  },
]

// Native radio tabs share their layout with the working style-guide example.
let doors = `<fieldset class="Tabs">
<legend class="Tabs_Legend">Which app do you use?</legend>
${
  AGENTS.map((a, i) =>
    `<div class="Tabs_Item">
<input type="radio" name="agent" id="tab-${a.key}" value="${a.key}"${
      i ? '' : ' checked'
    }>
<label class="Tabs_Tab" for="tab-${a.key}">${a.tab}</label>
<section class="Card Tabs_Panel Tabs_Panel-${a.key}"><h2>${a.title}</h2>
<ol>${a.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
${a.note ? `<p class="Note">${a.note}</p>` : ''}
${
      a.details
        ? `<details class="Note"><summary>More about authentication</summary><div class="Note">${a.details}</div></details>`
        : ''
    }
<div class="Connect_Next"><p>Make your first app</p>
${a.finish}, then ask:${request}
<span class="Note">Try it, then ask for a change in the same chat. Keep shaping it as you use it.</span></div>
</section></div>`
  ).join('')
}
</fieldset>`

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
    'Connect yaks.app',
    'Build and manage your apps from your usual chats.',
    status,
    `${doors}
<details class="Attach"${status != 200 || yours.paid ? ' open' : ''}>
<summary>Your address and plan</summary>
${mine(yours)}${plan(yours)}
</details>
<p class="Note"><a href="https://${
      esc(yours.slug)
    }.${PLATFORM}${managePath()}">Your apps and settings</a></p>
<p class="Note"><a href="https://yaks.app/help">Need help?</a></p>
${home}${copying}${tabbing}${inline}`,
  )
