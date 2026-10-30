// The kernel's own pages, in the home page's voice (workers/yak/public): what
// a person sees when there is nothing at an address, when an app broke, and
// where they sign in. One shell, three sentences, and an optional card of
// markup under them. Shared controls and tokens come from public/controls.css,
// and the column and the dashboard's frame from public/pages.css.
// Errors are for the person's assistant to fix (D-32318 §Errors); the
// dashboard marks the app they broke in and says what to ask it.
//
// Template values are escaped by `esc` at the call site; registry views use
// the HTML host's escaping. A page carries an email address a stranger typed,
// and web content never speaks HTML (the repo's md.ts rule, one floor down).

import type { Frame } from './build.ts'
import type { Agent } from './connected.ts'
import type {
  Borrowed,
  Connections,
  Face,
  Shown,
  Using,
} from './connections.ts'
import { INTEGRATIONS } from './integrations.ts'
import { agentList, agentLive } from './connected_ui.ts'
import { icon, type IconName } from './icons.ts'
import { day, esc } from './html.ts'
import { holder, tile } from './render/mod.ts'
import type { People, Person } from './people.ts'
import type { Plain } from './unseen.ts'
export { esc } from './html.ts'
import {
  enabling,
  MANAGE,
  managePath,
  type ManageView,
  OAUTH,
} from './route.ts'
import { CONNECTOR } from './seo.ts'
import { apex, type Host, spaceHost, url } from './host.ts'
import { count, FREE, PLUS, PRICE, size } from './meter.ts'

let home = (env: Host) => `<a class="Away" href="${url(env, '/')}">yaks.app</a>`

// The meter's prices are whole US dollars, as on the public pricing page.
let plusPrice = () => `$${count(PRICE.plus)}`

let billButton = (door: string, label: string, target?: string) =>
  `<button type="button" class="Button Bill_Go${
    door == 'portal' ? ' Button-quiet' : ''
  }" data-door="${esc(door)}"${target ? ` data-target="${esc(target)}"` : ''}>${
    esc(label)
  }</button>`

// The style guide's parts (public/style-guide.html, One design language),
// said once: a card's head, a status word, and a field under its label.

/** A card's head: its mark, its title, how it stands, and what acts on the
 * whole card, at the right. */
let heading = (
  title: string,
  at: { mark?: string; status?: string; actions?: string; id?: string } = {},
) =>
  `<header class="Card_Head">${at.mark ?? ''}<h2 class="Card_Title"${
    at.id ? ` id="${at.id}"` : ''
  }>${title}</h2>${at.status ?? ''}${
    at.actions ? `<div class="Card_Actions">${at.actions}</div>` : ''
  }</header>`

/** How something stands, in its role's colour. */
let status = (word: string, tone?: 'good' | 'warn') =>
  `<span class="Status${tone ? ` Status-${tone}` : ''}">${word}</span>`

/** A field: its label, its control, and what explains it under both. */
let labeled = (id: string, label: string, control: string, hint = '') =>
  `<div class="Form_Field"><label class="Form_Label" for="${id}">${label}</label>${control}${
    hint ? `<p class="Form_Hint">${hint}</p>` : ''
  }</div>`

export let shell = (
  env: Host,
  title: string,
  lead: string | null,
  status: number,
  inner = home(env),
  // Extra response headers, beside content-type — `Retry-After` on the
  // provisioning page below, the admin's no-store on its directory.
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&display=swap">
<link rel="stylesheet" href="${url(env, '/controls.css')}">
<link rel="stylesheet" href="${url(env, '/pages.css')}">
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

export let lost = (env: Host = {}) =>
  shell(
    env,
    'Page not found',
    'Check the address, or return to yaks.app.',
    404,
  )

export let nothingHere = (env: Host = {}) =>
  shell(
    env,
    'Nothing here yet.',
    "There are no apps at this address yet. If it's yours, ask your " +
      'assistant to build one.',
    404,
  )

// An app in the trash, at its own address (erase.ts, T-34430). Everyone else
// gets `nothingHere` — a deleted app is not a stranger's news — so this is
// the space's owner, told the one thing that is actually true of this
// address: nothing serves here, and it is theirs to take back from the page
// their apps are listed on. A 404 with words in it, because the address
// really is answering nothing.
export let binned = (
  at: { space: string; title: string; days: number },
  env: Host = {},
) =>
  shell(
    env,
    `${esc(at.title)} is in the trash.`,
    `Nothing answers at this address until it is restored. It is kept for ${at.days} more ${
      at.days == 1 ? 'day' : 'days'
    }, then erased for good.`,
    404,
    `<p><a class="Button" href="${
      url(env, managePath('trash', at.space))
    }">Restore it from your apps</a></p>`,
  )

// A space in the trash, at any address of its own (erase.ts, T-34431).
// Everyone else gets `nothingHere` at every one of them — a deleted space is
// not a stranger's news — so this is its owner, told where their space went,
// how long they have, and given the one button that brings it back. A form
// POSTing to `/`, which every address of a space in the trash answers with
// this (apps.ts `closed`), so a restore needs no assistant and no script. A
// 404 with words in it, because the address really is answering nothing.
export let spaceBinned = (at: {
  slug: string
  title: string
  days: number
}, env: Host = {}) =>
  shell(
    env,
    `${esc(at.title)} is in the trash.`,
    `Nothing answers at ${
      esc(spaceHost(env, at.slug))
    } until you restore it — no ` +
      `app here, and no page. Everything the space had is kept for ${at.days} more ${
        at.days == 1 ? 'day' : 'days'
      }, then erased for good.`,
    404,
    `<form method="post" action="/">
<input type="hidden" name="restore-space" value="${esc(at.slug)}">
<button class="Button" type="submit">Restore ${
      esc(spaceHost(env, at.slug))
    }</button>
</form>
<p class="Note">Its apps, their files and everything they saved come back
exactly as they were.</p>${home(env)}`,
  )

// Deploying by dropping a file (T-34230): the one door on this platform that
// makes an app with no assistant in the room. A file input, which a file can
// also be dragged onto, and the name the app lives at — one plain form that
// POSTs to `/deploy` (drop.ts) and needs no script at all. The script below
// only fills the name in from the file's own and lets a drag land on the
// label; nothing it does is required for the form to work.
//
// `slug` given is an app's own page, where the name is not a question: the
// drop goes to that app and nowhere else. `to` is the space's door, whole,
// on a page that is not at the space's own address (the dashboard's).
let dropZone = (slug?: string, to = '/deploy') =>
  `<form class="Drop" method="post" action="${
    esc(to)
  }" enctype="multipart/form-data">
<label class="Drop_Zone">
<input class="Drop_File" type="file" name="file" required aria-label="Website files">
<span class="Drop_Say">A .zip of your website files, or a single index.html</span>
</label>
${
    slug
      ? held('slug', slug)
      : `<input class="Field" name="slug" maxlength="63" ` +
        `autocomplete="off" spellcheck="false" placeholder="Name for your website" ` +
        `aria-label="Website name">`
  }
<button class="Button" type="submit">${
    slug ? 'Update app' : 'Upload website'
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
// One renderer, drawn twice. The frames below are build.ts's wire, whole, and
// the rules here are the rules the script keeps: a tool is one row that turns
// into its own result, the address is a card, `busy` is a line, and `done`
// draws nothing because the sentence it carries is already a line above it.

// A https address inside a sentence the builder said — the app it just made,
// the pricing page a refusal ends with — as a link. Refused by shape, not by a
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
let chatAsk = (to = '/api/build') =>
  `<form class="Chat_Ask" method="post" action="${esc(to)}">
<p><textarea class="Field" name="say" rows="3" required placeholder="A recipe box I can share with my sister" aria-label="What do you want to build?"></textarea></p>
<button class="Button" type="submit">Build it</button>
</form>`

// The optional built-in builder, reached from New app: the dashboard's page
// is at the apex, so its form names the space's door whole, and the script
// opens its socket wherever the form points.
let chat = (to: string) =>
  `<section class="Card Chat">${heading('Build an app here')}
${transcript([])}${chatAsk(to)}
</section>`

// The live half (public/build.js), served at the address of the page it is
// on: the builder's own on a space's hostname (apps.ts serves it there), so a
// space's page needs no asset of the apex, and the public file at the apex.
// A module, because it is one, and nothing on the page waits for it.
let chatLive = (src = '/api/build.js') =>
  `<script type="module" src="${src}"></script>`

/**
 * What a posted line answers (T-34242), and it is a page for the same reason a
 * drop's is: whoever typed it ran no script, so the conversation has to come
 * back as something to read. The round is over by the time this is written —
 * the frames are the whole of it, ending in the address where one was built.
 */
export let building = (at: {
  space: string
  frames?: Frame[]
  why?: string
}, env: Host = {}) =>
  shell(
    env,
    at.why ? 'That did not go in' : `${esc(spaceHost(env, at.space))}`,
    at.why ? esc(at.why) : 'Here is what happened. Say the next thing below.',
    at.why ? 400 : 200,
    `<section class="Card Chat">
${transcript(at.frames ?? [])}${chatAsk()}
</section>
<p><a class="Away" href="${
      url(env, managePath('apps', at.space))
    }">Back to your apps</a></p>
${chatLive()}`,
  )

// What a drop answers, either way it went (T-34230), and it is a page because
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
}, env: Host = {}) =>
  shell(
    env,
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
        ? `<section class="Card">${
          heading(
            `${at.files.length} ${at.files.length == 1 ? 'file' : 'files'}`,
          )
        }
<ol class="Files">${at.files.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>
</section>`
        : ''
    }
<section class="Card">${heading(at.slug ? 'Update app files' : 'Try again')}
<p class="Card_Sub">${
      at.slug
        ? `Drop another zip — or one index.html — and ${
          esc(at.slug)
        } becomes it.`
        : 'A .zip of the files, or a single index.html.'
    }</p>
${dropZone(at.slug)}
</section>
<p><a class="Away" href="${
      url(env, managePath('apps', at.space))
    }">Back to your apps</a></p>
${dropping}`,
  )

// One thing to say, and a button that puts it on the clipboard (T-34420). The
// words are selectable on their own (`.Pick` is `user-select: all`), so a
// browser that ran no script still takes them in one gesture — the button is
// all the script below adds, and it stays hidden until that script un-hides
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
// words are selected instead, so the person's own copy keystroke lands.
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
    `<rect class="Stats_Bar" x="${(i + 0.15).toFixed(2)}" y="${
      (40 - (d.views / most) * 40).toFixed(2)
    }" width="0.7" height="${((d.views / most) * 40).toFixed(2)}"></rect>`
  ).join('')
  return `<figure class="Stats_Plot"><svg class="Stats_Chart" viewBox="0 0 ${days.length} 40"
preserveAspectRatio="none" role="img" aria-label="${
    count(total)
  } visits over ${days.length} days, ${
    count(days[days.length - 1]?.views ?? 0)
  } on the last day">${bars}</svg>
<figcaption class="Stats_Span"><span>${
    esc(axisDay(days[0]?.day ?? ''))
  }</span><span>${
    esc(axisDay(days[days.length - 1]?.day ?? ''))
  }</span></figcaption></figure>`
}

let column = (head: string, rows: { name: string; views: number }[]) =>
  rows.length
    ? `<div class="Stats_Column"><h3>${head}</h3>
<ul class="Stats_List">${
      rows.map((r) =>
        `<li><span title="${esc(r.name)}">${esc(r.name)}</span><b>${
          count(r.views)
        }</b></li>`
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

let visits = (v: Visits, site: string) =>
  `<article class="Card Stats" aria-labelledby="visits-${
    esc(v.slug)
  }"><header class="Card_Head"><h2 class="Card_Title" id="visits-${
    esc(v.slug)
  }"><a href="${site}/${
    encodeURIComponent(v.slug)
  }/" target="_blank" rel="noopener">${esc(v.title || v.slug)}</a></h2>
<p class="Stats_Total">${count(v.stats.total)} <span class="Stats_Unit">${
    v.stats.total == 1 ? 'visit' : 'visits'
  }</span></p></header>${
    v.stats.total
      ? chart(v.stats.daily, v.stats.total) +
        `<div class="Stats_Tops">${
          column('Pages', v.stats.pages) + column('Came from', v.stats.from) +
          column('Countries', v.stats.countries)
        }</div>`
      : ''
  }</article>`

let visited = (apps: Visits[] | null, off: string, site: string) =>
  apps == null
    ? `<p class="Form_Hint">${esc(off)}</p>`
    : apps.map((v) => visits(v, site)).join('')

// A space's front door shows the apps whoever is asking may open, and to
// its owner the way to the dashboard; account controls never enter it. The
// dashboard (`desk`) is the owner's alone, at the apex.
export type SpacePage = {
  space: string
  title: string
  apps: Listed[]
  hidden: number
  role: string | null
  person: boolean
  signIn: string
  /** the dashboard's address, shown to the space's owner */
  manage?: string
}

type Listed = {
  eid: string
  slug: string
  title: string
  gallery?: string
  home?: boolean
  access?: string | null
}

export type DeskPage = {
  space: string
  /** the space the address named (`?space=`), carried by every link on the
   * page; none is the person's own */
  pick?: string
  /** each with its open errors, newest first (unseen.ts `plain`) */
  apps: (Listed & { errors?: Plain[] })[]
  trash?: { slug: string; title: string; days: number }[]
  name?: string
  agents?: Agent[]
  views?: Visits[] | null
  viewDays?: number
  viewsOff?: string
  sell?: 'none' | 'setup' | 'ready'
  plan?: Yours['plan']
  paid?: boolean
  plus?: boolean
  fee?: string
  say?: string
  no?: boolean
  view?: ManageView
  connections?: Connections
  /** who is in the space and its apps, and who has yet to accept */
  people?: People
  /** what was typed into the invitation form, when the invitation was
   * refused and the page is drawn again */
  invite?: { email: string; app: string; role: string; note: string }
  /** the apps of other people's spaces this person may open, each with the
   * slug of the space it lives in */
  shared?: (Listed & { space: string })[]
}

let navIcons = {
  apps: 'layout-grid',
  people: 'users',
  connect: 'bot',
  connections: 'plug',
  visits: 'chart-no-axes-column-increasing',
  selling: 'credit-card',
  billing: 'credit-card',
  settings: 'settings-2',
  trash: 'trash-2',
} satisfies Record<string, IconName>

let navigation = (at: DeskPage, view: ManageView, env: Host) => {
  let link = (key: keyof typeof navIcons, label: string) =>
    `<a href="${managePath(key, at.pick)}"${
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
<a class="Desk_Brand" href="${url(env, '/')}"><img src="${
    url(env, '/yaks-app.png')
  }" width="36" height="36" alt="">yaks.app</a>
<nav class="SideNav" aria-label="Manage your apps">
${link('apps', 'Apps')}${link('people', 'People')}${link('connect', 'Agents')}${
    link('connections', 'Connections')
  }<hr>
${link('visits', 'Visits')}${at.sell ? link('selling', 'Selling') : ''}
${link('billing', 'Billing')}${link('settings', 'Settings')}${
    link('trash', 'Trash')
  }
</nav>
<div class="Desk_Foot"><a href="https://${
    esc(spaceHost(env, at.space))
  }/" target="_blank" rel="noopener">View homepage ${
    icon('external-link')
  }</a><a href="${
    url(env, '/help')
  }" target="_blank" rel="noopener">Help</a></div>
</aside>`
}

let state = (connected: boolean, show: boolean) =>
  `data-${connected ? 'connected' : 'disconnected'}${show ? '' : ' hidden'}`

let connectCard = (at: DeskPage) =>
  `<section class="Card Desk_Connect" ${state(false, !at.agents?.length)}>
<header class="Card_Head"><h2 class="Card_Title">Connect your agent</h2><div class="Card_Actions"><a class="Button" href="${
    managePath('connect', at.pick)
  }">Connect agent</a></div></header>
<p class="Card_Sub">Build and improve your apps in the conversations you already have with Claude or ChatGPT.</p></section>`

// What broke in an app, for its owner: each break as its line says it to their
// assistant, how often and when last, and the one thing to do, which is to
// ask that assistant. The app's mark on its tile links here.
let SHOWN = 5
let fixing = (a: DeskPage['apps'][number]) => {
  let errors = a.errors ?? []
  let n = errors.length
  let title = a.title || a.slug
  return `<section class="Card Fix" id="fix-${
    esc(a.slug)
  }"><header class="Card_Head"><h2 class="Card_Title">${
    esc(title)
  }</h2><span class="Status Status-warn">${
    n == 1 ? '1 error' : `${n} errors`
  }</span></header><ul class="Rows">${
    errors.slice(0, SHOWN).map((e) =>
      `<li class="Rows_Item"><div class="Rows_Main"><span class="Fix_Said">${
        esc(e.said || 'No message')
      }</span><span class="Rows_Meta">${e.where ? `${esc(e.where)} · ` : ''}${
        e.times == 1 ? 'once' : `${e.times} times`
      }${
        day(e.at) ? `, ${e.times == 1 ? '' : 'last '}on ${day(e.at)}` : ''
      }</span></div></li>`
    ).join('')
  }</ul>${
    n > SHOWN ? `<p class="Rows_Meta">And ${n - SHOWN} more.</p>` : ''
  }<div class="Form_Field"><p class="Form_Label">Ask your assistant to fix ${
    n == 1 ? 'it' : 'them'
  }</p>${
    copyable(
      `Fix the errors in my ${title} app on yaks.app`,
      `the request to fix ${title}`,
    )
  }</div></section>`
}

// What others let this person into: drawn by the same Tile as their own, each
// with the address it lives at, since none of them lives at this space's.
let sharedWith = (at: DeskPage, env: Host) =>
  at.shared?.length
    ? `<h2 class="Group">Shared with you</h2><div class="Apps">${
      at.shared.map((a) => {
        let host = spaceHost(env, a.space)
        return tile(a, { at: `https://${host}`, host })
      }).join('')
    }</div>`
    : ''

/** The apps view: the person's apps, each marked where it broke with what to
 * ask about it, then what was shared with them; with none of their own, what
 * was shared comes first, above the way to make one. */
export let library = (at: DeskPage, env: Host) => {
  let broken = at.apps.filter((a) => a.errors?.length)
  return `${connectCard(at)}${
    at.apps.length
      ? `<div class="Apps">${
        at.apps.map((a) =>
          tile(a, {
            at: `https://${spaceHost(env, at.space)}`,
            errors: a.errors?.length,
          })
        ).join('')
      }</div>${
        broken.length
          ? `<h2 class="Group">Needs fixing</h2>${broken.map(fixing).join('')}`
          : ''
      }${sharedWith(at, env)}`
      : `${
        sharedWith(at, env)
      }<section class="Empty"><h2>Your apps will live here</h2>
<div ${
        state(true, !!at.agents?.length)
      }><p>Ask your agent for your first app. Try this:</p>${firstAsk}</div>
<div ${
        state(false, !at.agents?.length)
      }><p>A recipe box, a book club page, a tool for your day. Start with an idea.</p>
<a href="${
        managePath('new', at.pick)
      }">More ways to make an app</a></div></section>`
  }${copying}`
}

let preferences = (at: DeskPage, env: Host) => {
  let home = at.apps.find((a) => a.home)
  let to = managePath('settings', at.pick)
  return `<section class="Card">${heading('Profile')}
<form class="Form" method="post" action="${to}">${
    labeled(
      'your-name',
      'Your name',
      `<div class="Form_Line"><input class="Field" id="your-name" name="name" maxlength="60" autocomplete="name" placeholder="Dana" value="${
        esc(at.name ?? '')
      }"><button class="Button" type="submit">Save name</button></div>`,
    )
  }</form></section>
<section class="Card">${heading('App address')}
<form class="Form" method="post" action="${to}">${
    labeled(
      'your-address',
      'Your address',
      `<div class="Form_Line"><span class="At"><input class="Field" id="your-address" name="space" maxlength="63" autocomplete="off" spellcheck="false" value="${
        esc(at.space)
      }"><span>.${
        apex(env)
      }</span></span><button class="Button" type="submit">Save address</button></div>`,
      MOVES,
    )
  }</form></section>
<section class="Card">${heading('Homepage')}<p>${
    home
      ? `${esc(home.title || home.slug)} opens at your address.`
      : 'Your address opens your app library.'
  }</p><p class="Form_Hint">Ask your assistant to make any app your homepage. Manage your apps anytime at <a href="${
    url(env, MANAGE)
  }">${apex(env)}${MANAGE}</a>.</p></section>`
}

let selling = (at: DeskPage, env: Host) => {
  if (!at.sell) return '<p>Selling is not available here yet.</p>'
  let ready = at.sell == 'ready'
  let connected = at.sell != 'none'
  let stop = ready || (!at.plus && connected)
  let stripe = at.plus || connected
    ? `<form method="post" action="${
      managePath('selling', at.pick)
    }"><input type="hidden" name="sell" value="${
      stop ? 'stop' : 'start'
    }"><button type="submit" class="Button${stop ? ' Button-quiet' : ''}">${
      stop
        ? 'Disconnect Stripe'
        : at.sell == 'setup'
        ? 'Continue setup'
        : 'Connect Stripe'
    }</button></form>`
    : ''
  let subscribe = at.plus ? '' : billButton(
    'checkout',
    `Subscribe — ${plusPrice()} a month`,
    managePath('selling', at.pick),
  )
  return `<section class="Card Bill">${
    heading(
      !at.plus
        ? 'Take payments with Plus'
        : ready
        ? 'Payments are connected'
        : 'Take payments in your apps',
      {
        status: ready
          ? status('Connected', 'good')
          : at.sell == 'setup'
          ? status('Setup unfinished', 'warn')
          : '',
        actions: subscribe + stripe,
      },
    )
  }
<p>${
    !at.plus
      ? connected
        ? 'Your Stripe account is connected. Upgrade to Plus to accept new payments.'
        : 'Connect Stripe and accept payments from your customers on Plus.'
      : ready
      ? 'Payments go to your Stripe account. You manage refunds and disputes there.'
      : at.sell == 'setup'
      ? 'Finish connecting your Stripe account to start accepting payments.'
      : 'Connect your Stripe account to accept payments from your customers.'
  }</p>${
    at.plus
      ? `<p class="Form_Hint">yaks.app takes ${
        esc(at.fee ?? '')
      } of each sale. <a href="${
        url(env, '/pricing')
      }" target="_blank" rel="noopener">Pricing</a></p>`
      : `${
        at.fee
          ? `<p class="Form_Hint">${
            esc(at.fee)
          } per sale, plus Stripe processing fees.</p>`
          : ''
      }<p class="Say Bill_Say" role="status"></p>`
  }</section>${at.plus ? '' : billing}`
}

let trash = (at: DeskPage) =>
  at.trash?.length
    ? `<section class="Card">${
      heading('Deleted apps')
    }<p class="Card_Sub">Each is kept for 30 days, then erased for good. Restoring one brings back everything it held.</p><ul class="Rows">${
      at.trash.map((a) =>
        `<li class="Rows_Item"><div class="Rows_Main"><span class="Rows_Name">${
          esc(a.title || a.slug)
        }</span><span class="Rows_Meta">${a.days} ${
          a.days == 1 ? 'day' : 'days'
        } left</span></div><form class="Rows_Actions" method="post" action="${
          managePath('trash', at.pick)
        }"><input type="hidden" name="restore" value="${
          esc(a.slug)
        }"><button type="submit" class="Button Button-quiet">Restore</button></form></li>`
      ).join('')
    }</ul></section>`
    : '<section class="Empty"><h2>Trash is empty</h2><p>A deleted app waits here for 30 days.</p></section>'

// A sentence out of a lowercase line: what a failed seal wrote beside it. An
// email address that opens it stays as it was typed.
/// sentence('no app x in y') -> 'No app x in y.'
/// sentence('ana@x.test is you') -> 'ana@x.test is you.'
export let sentence = (text: string) =>
  (/^\S+@/.test(text) ? text : text.charAt(0).toUpperCase() + text.slice(1)) +
  (/[.!?]$/.test(text) ? '' : '.')

// How a connection stands, as its head says it.
let STATUS = {
  needed: 'Needs connecting',
  connected: 'Connected',
  broken: 'Needs reconnecting',
}

// A service's logo, drawn as an image of its own SVG and never as markup: an
// SVG an <img> loads runs no script and fetches nothing.
let logo = (f: Face) =>
  f.logo
    ? `<img class="Card_Mark" src="data:image/svg+xml,${
      esc(encodeURIComponent(f.logo))
    }" alt="" width="24" height="24">`
    : ''

// A line about a service and a link to its site, where it has them. Only an
// https address is linked, so a site can never be a script.
let about = (f: Face) => {
  let site = /^https:\/\/\S+$/.test(f.site)
    ? `<a href="${esc(f.site)}"${f.theirs ? ' rel="nofollow ugc"' : ''}>${
      esc(f.site.replace(/^https:\/\//, '').replace(/\/$/, ''))
    }</a>`
    : ''
  return f.tagline || site
    ? `<p class="Card_Sub">${esc(f.tagline)}${
      f.tagline && site ? ' ' : ''
    }${site}</p>`
    : ''
}

// How a person gets a service's key, as its integration says, open while the
// key is still wanted.
let howTo = (f: Face, open: boolean) =>
  f.instructions
    ? `<details class="More"${
      open ? ' open' : ''
    }><summary>How to get the key</summary><div class="More_Body">${f.instructions}</div></details>`
    : ''

// Where a key may be sent, said once beside wherever it is pasted.
let reach = (hosts: string[]) =>
  hosts.length
    ? `yaks.app keeps it and only ever sends it to ${
      hosts.map((h) => `<code>${esc(h)}</code>`).join(', ')
    }.`
    : ''

// The box a key is pasted in and the button that saves it, one line under
// its label.
let keyBox = (id: string, label: string, send: string, hint = '') =>
  labeled(
    id,
    label,
    `<div class="Form_Line"><input class="Field" id="${id}" name="key" type="password" autocomplete="off" spellcheck="false" required>${send}</div>`,
    hint,
  )

// A button a connection's form sends: quiet unless it is the card's one
// next step.
let press = (value: string, label: string, quiet = true) =>
  `<button class="Button${
    quiet ? ' Button-quiet' : ''
  }" type="submit" name="do" value="${value}">${label}</button>`

let callsOf = (n: number) => `${n} ${n == 1 ? 'call' : 'calls'}`

// Who may call out through an app's link, and the button that changes it:
// the app's space's to say, a copy's borrowed link included.
let callers = (a: Using) =>
  a.anyone ? 'Anyone may call out' : 'Only members call out'
let opening = (a: Using) =>
  press(
    a.anyone ? 'close' : 'open',
    a.anyone ? 'Members only' : 'Open to anyone',
  )

// The calls an app made through a connection this month, against its cap.
let calls = (a: { calls: number; cap: number | null }) =>
  a.cap == null
    ? `${callsOf(a.calls)} this month`
    : `${a.calls} of ${callsOf(a.cap)} this month`

// One connection, as a card: its head says what it is and how it stands and
// holds what acts on all of it (connecting, disconnecting); under it the key
// it still wants, how to get one, the apps using it and the copies borrowing
// it, a box to let one more use it, and folded away what few people need:
// lending it to the copies people install, the name its code reads, a new
// key, and for a service this space added, what it says and whether it is
// listed. The space's side of an app that asks each person to connect
// their own is only the ask: nothing here connects it, and it stays while
// the app asks. Its forms post for the space that keeps it, or for the
// page's own when it is the person's.
let connection = (
  c: Shown,
  on: boolean,
  pick?: string,
  enable?: string[],
) => {
  let ask = c.each && !c.own
  let id = (what: string) => `${what}-${esc(c.eid)}`
  let form = (inner: string, at = '') =>
    `<form method="post" action="${
      esc(enabling(managePath('connections', c.space ?? pick), enable))
    }"${at}><input type="hidden" name="connection" value="${
      esc(c.eid)
    }">${inner}</form>`
  let open = c.status != 'connected' || !!c.failed
  // A key is pasted here for a keyed connection this deploy can keep one for.
  let keying = !ask && on && c.keyed
  // A connection an app shares and is waiting on is connected, not removed:
  // removing it would only leave the app a new one waiting. A person's own,
  // for an app that asks each person, is theirs to remove.
  let waiting = c.status == 'needed' && c.apps.length && !c.each
  let actions =
    (!ask && !c.keyed && open ? form(press('signin', 'Connect', false)) : '') +
    (ask || waiting ? '' : form(
      press('disconnect', c.status == 'needed' ? 'Remove' : 'Disconnect'),
    ))
  let stands = ask ? status('Each person connects their own') : status(
    `${STATUS[c.status]}${c.account ? ` as ${esc(c.account)}` : ''}`,
    c.status == 'connected' ? 'good' : 'warn',
  )
  let said = c.failed
    ? `<p class="Say Say-no" role="status">${esc(sentence(c.failed))}</p>`
    : c.saving
    ? `<p class="Say" role="status">${esc(sentence(c.saving))}</p>`
    : ''
  let paste = keying && open
    ? form(
      keyBox(
        id('key'),
        'Paste the key',
        press('key', 'Save key', false),
        reach(c.hosts),
      ),
    )
    : ''
  let forApp = (a: Using, inner: string, at = '') =>
    form(`<input type="hidden" name="app" value="${esc(a.app)}">${inner}`, at)
  // An app that uses it: what its code reads and, for one it shares, who may
  // call out through it there, which the person opens to anyone or closes to
  // members, and the calls it made through it this month against any cap. A
  // person's own is only ever theirs to call out through. A copy another
  // space borrows it for is that space, its calls against the cap it was lent
  // under, and the button that takes the loan back.
  let using = (a: Using) =>
    `<li class="Rows_Item"><div class="Rows_Main"><strong class="Rows_Name">${
      esc(a.borrower ?? a.title)
    }</strong><span class="Rows_Meta">${
      (a.borrower != null ? [`Their copy of ${esc(a.title)}`, calls(a)] : [
        `<code>env.${esc(a.binding)}</code>${
          a.direct ? ', the key itself' : ''
        }`,
        c.each ? '' : callers(a),
        calls(a),
        a.lends == null
          ? ''
          : `Lent to installed copies, ${callsOf(a.lends)} a month each`,
      ]).filter(Boolean).join(' · ')
    }</span></div>${
      c.each ? '' : `<div class="Rows_Actions">${
        forApp(
          a,
          a.borrower != null ? press('recall', 'Recall') : opening(a),
        )
      }</div>`
    }</li>`
  // The space's own apps first, then the copies borrowing it.
  let rows = [...c.apps].sort((a, b) =>
    Number(a.borrower != null) - Number(b.borrower != null)
  )
  let apps = ask
    ? c.apps.length
      ? `<p class="Card_Sub">Each person who uses ${
        c.apps.map((a) => esc(a.title)).join(', ')
      } connects their own account, from the app.</p>`
      : ''
    : c.apps.length
    ? `<ul class="Rows">${rows.map(using).join('')}</ul>`
    : '<p class="Card_Sub">No app uses it yet.</p>'
  // Letting one more app use it: the app, and, folded under the advanced
  // options, the name its code reads it by, which most never change.
  let attaching = c.status == 'connected' && !c.own && c.available.length > 0
  let attach = attaching
    ? form(
      labeled(
        id('attach'),
        'Let an app use it',
        `<div class="Form_Line"><select class="Field" id="${
          id('attach')
        }" name="app" required><option value="">Choose an app</option>${
          c.available.map((a) =>
            `<option value="${esc(a.app)}">${esc(a.title)}</option>`
          ).join('')
        }</select>${press('attach', 'Attach', false)}</div>`,
        'Only its members can call out through it, and its code is handed a sentinel, never the key.',
      ),
      ` id="${id('attaching')}"`,
    )
    : ''
  let named = attaching
    ? labeled(
      id('bind'),
      'Name its code reads it by',
      `<input class="Field" id="${id('bind')}" form="${
        id('attaching')
      }" name="binding" autocomplete="off" spellcheck="false" pattern="[A-Za-z_][A-Za-z0-9_]*" placeholder="${
        esc(c.binding)
      }">`,
      `Left empty, its code reads <code>env.${
        esc(c.binding)
      }</code>. An agent can rename it later.`,
    )
    : ''
  let replace = keying && !open
    ? form(
      keyBox(
        id('key'),
        'Replace the key',
        press('key', 'Save key'),
        reach(c.hosts),
      ),
    )
    : ''
  // Where a key nobody pastes here goes, and what a sign-in granted.
  let reached = !keying && (c.hosts.length || c.scopes.length)
    ? `<p class="Form_Hint">${
      c.hosts.length
        ? `Its key is only ever sent to ${
          c.hosts.map((h) => `<code>${esc(h)}</code>`).join(', ')
        }.`
        : ''
    }${c.hosts.length && c.scopes.length ? ' ' : ''}${
      c.scopes.length ? `Granted: ${c.scopes.map(esc).join(', ')}.` : ''
    }</p>`
    : ''
  // Whether a service this space added is in the integration directory, for
  // anyone to add with their own key: its owner lists it or takes it out.
  let listing = c.about
    ? `<div class="Form_Field"><span class="Form_Label">Integration directory</span><p class="Form_Hint">${
      c.listed
        ? `Listed in the <a href="${
          esc(`${INTEGRATIONS.path}#${encodeURIComponent(c.integration)}`)
        }">integration directory</a>, for anyone to add with their own key.`
        : 'Once listed, anyone could add it to a space of theirs, with their own key.'
    }</p>${
      form(
        `<div class="Form_Actions">${
          c.listed
            ? press('unlist', 'Take it out')
            : press('list', 'List in the integration directory')
        }</div>`,
      )
    }</div>`
    : ''
  // What is said about a service this space added, its owner's to change.
  let told = c.about
    ? `<details class="More"><summary>Change what ${
      esc(c.face.title)
    } says</summary>${
      form(
        `<div class="More_Body Form">${
          (
            [
              ['title', 'Its name', 'What people call it'],
              ['tagline', 'One line about it', 'What it is, in a line'],
              ['site', 'Its site', 'https://…'],
            ] as const
          ).map(([k, label, hint]) =>
            labeled(
              id(k),
              label,
              `<input class="Field" id="${id(k)}" name="${k}" value="${
                esc(c.about![k] ?? '')
              }" placeholder="${esc(hint)}"${
                k == 'site' ? ' type="url" pattern="https://.*"' : ''
              }>`,
            )
          ).join('')
        }${
          labeled(
            id('instructions'),
            'How to get the key',
            `<textarea class="Field" id="${
              id('instructions')
            }" name="instructions" rows="6" placeholder="Where to sign up, which page gives the key, and what to paste">${
              esc(c.about.instructions ?? '')
            }</textarea>`,
            'Written for whoever connects it and the agent helping them, in markdown. Where its key may be sent stays as it is.',
          )
        }<div class="Form_Actions">${
          press('about', 'Save', false)
        }</div></div>`,
      )
    }</details>`
    : ''
  // Lending it to the copies people install of an app here: the calls a
  // month each copy may make, saved again to change it, and the button that
  // stops lending and takes every loan back. Only a shared sentinel the app
  // holds is lent, never the key itself.
  let lendable = c.status == 'connected' && !c.own && !c.each
  let lend = (a: Using) => {
    let field = `${id('lend')}-${esc(a.app)}`
    let stop = `${field}-stop`
    return forApp(
      a,
      labeled(
        field,
        `Lend to copies of ${esc(a.title)}`,
        `<div class="Form_Line"><input class="Field" id="${field}" name="cap" type="number" min="1" step="1" inputmode="numeric" value="${
          a.lends ?? 100
        }" required>${press('lend', a.lends == null ? 'Lend' : 'Save')}${
          a.lends == null
            ? ''
            : `<button class="Button Button-quiet" type="submit" form="${stop}" name="do" value="lend">Stop lending</button>`
        }</div>`,
        'The calls a month each copy someone installs may make through it. A copy keeps its own data, never sees the key, and can connect its own instead.',
      ),
    ) + (a.lends == null ? '' : forApp(a, '', ` id="${stop}" hidden`))
  }
  let lent = lendable
    ? c.apps.filter((a) => a.borrower == null && !a.direct).map(lend).join('')
    : ''
  let folded = lent + named + replace + reached + listing + told
  return `<section class="Card" data-connection="${esc(c.eid)}">${
    heading(esc(c.face.title), {
      mark: logo(c.face),
      status: stands,
      actions,
    })
  }${about(c.face)}${said}${
    howTo(c.face, open && !ask)
  }${paste}${apps}${attach}${
    folded
      ? `<details class="More"><summary>Advanced options</summary><div class="More_Body">${folded}</div></details>`
      : ''
  }</section>`
}

// A connection an app here borrows from the space that lent it with the app,
// as a card: its head says whose it is, its row what the app has spent of the
// cap it was lent under and who may call out through it, which is this space's
// to say, and what replaces it is the space's own: a
// connection it holds already, a sign-in, or a key pasted under the fold.
let borrowing = (
  b: Borrowed,
  on: boolean,
  mine?: Shown,
  enable?: string[],
) => {
  let form = (inner: string, connection = b.eid) =>
    `<form method="post" action="${
      esc(enabling(managePath('connections', b.space), enable))
    }"><input type="hidden" name="connection" value="${
      esc(connection)
    }"><input type="hidden" name="app" value="${
      esc(b.app.app)
    }">${inner}</form>`
  let actions = mine
    ? form(press('attach', 'Use your own'), mine.eid)
    : on && !b.keyed
    ? form(press('own', 'Connect your own'))
    : ''
  let id = `own-${esc(b.eid)}-${esc(b.app.app)}`
  let own = on && b.keyed && !mine
    ? `<details class="More"><summary>Use your own key</summary><div class="More_Body">${b.face.instructions}${
      form(
        keyBox(
          id,
          'Paste your key',
          press('own', 'Save key', false),
          reach(b.hosts),
        ),
      )
    }</div></details>`
    : ''
  return `<section class="Card" data-borrowed="${esc(b.eid)}">${
    heading(esc(b.face.title), {
      mark: logo(b.face),
      status: status(`Borrowed from ${esc(b.lender)}`, 'good'),
      actions,
    })
  }${about(b.face)}<p class="Card_Sub">${esc(b.app.title)} calls out with ${
    esc(b.lender)
  }’s key until you use your own. The key stays hidden, and neither of you sees the other’s data.</p><ul class="Rows"><li class="Rows_Item"><div class="Rows_Main"><strong class="Rows_Name">${
    esc(b.app.title)
  }</strong><span class="Rows_Meta"><code>env.${esc(b.app.binding)}</code> · ${
    callers(b.app)
  } · ${calls(b.app)}</span></div><div class="Rows_Actions">${
    form(opening(b.app))
  }</div></li></ul>${own}</section>`
}

// The page: the person's own connections and the services that hold a
// grant, then each of their spaces' — what its apps asked for and what is
// connected — with, under the space the page is for, what it could connect
// next and a box for a key no app asked for yet.
let connections = (at: DeskPage, env: Host) => {
  let c: Connections = at.connections ?? {
    on: false,
    list: [],
    services: [],
    built: [],
    borrowed: [],
  }
  let first = [...c.list].sort((a, b) =>
    Number(a.status == 'connected' && !a.failed) -
    Number(b.status == 'connected' && !b.failed)
  )
  let action = esc(enabling(managePath('connections', at.pick), c.enable))
  // A built service nothing here is connected to yet: a key to paste, or a
  // sign-in to start from its head.
  let offer = (i: Connections['built'][number]) =>
    `<form class="Card" method="post" action="${action}"><input type="hidden" name="integration" value="${
      esc(i.name)
    }">${
      heading(esc(i.face.title), {
        mark: logo(i.face),
        actions: i.keyed ? '' : press('add', 'Connect', false),
      })
    }${about(i.face)}${howTo(i.face, true)}${
      i.keyed
        ? keyBox(
          `add-${esc(i.name)}`,
          'Paste the key',
          press('add', 'Save key', false),
        )
        : ''
    }</form>`
  let add = `<form class="Card" method="post" action="${action}">${
    heading('Add a key')
  }<p class="Card_Sub">For a service your apps call that isn't listed above. Services others have added are in the <a href="${
    esc(url(env, INTEGRATIONS.path))
  }">integration directory</a>.</p><div class="Form">${
    labeled(
      'new-name',
      'Service',
      '<input class="Field" id="new-name" name="integration" maxlength="60" placeholder="Weather API" required>',
    )
  }${
    labeled(
      'new-hosts',
      'Where it may be sent',
      '<input class="Field" id="new-hosts" name="hosts" autocomplete="off" spellcheck="false" placeholder="api.example.com" required>',
      'yaks.app keeps the key and only ever sends it to these addresses.',
    )
  }${
    labeled(
      'new-key',
      'Key',
      '<input class="Field" id="new-key" name="key" type="password" autocomplete="off" spellcheck="false" required>',
    )
  }${
    labeled(
      'new-instructions',
      'How to get the key <span class="Form_Optional">(optional)</span>',
      '<textarea class="Field" id="new-instructions" name="instructions" rows="3" placeholder="Where to sign up, which page gives the key, and what to paste"></textarea>',
    )
  }<div class="Form_Actions">${
    press('add', 'Save key', false)
  }</div></div></form>`
  // The service the page was opened to add comes first under its space.
  let group = (title: string, cards: string, lead = '') =>
    lead + cards ? `<h2 class="Group">${esc(title)}</h2>${lead}${cards}` : ''
  let yours = first.filter((one) => one.own)
    .map((one) => connection(one, c.on, at.pick, c.enable)).join('') +
    c.services.map((s) =>
      `<section class="Card">${
        heading(esc(s.name), { status: status('Connected', 'good') })
      }<p class="Card_Sub">Signed in with your yaks.app account on ${
        esc(day(new Date(s.connectedAt * 1000).toISOString()))
      }.</p></section>`
    ).join('')
  let spaces = [
    ...new Set([
      at.space,
      ...first.flatMap((one) => one.space ?? []),
      ...c.borrowed.map((b) => b.space),
    ]),
  ]
  // What a space holds already that could replace a loan: a connected
  // connection through the same service.
  let mine = (b: Borrowed) =>
    first.find((one) =>
      one.space == b.space && one.integration == b.integration &&
      one.status == 'connected' && !one.failed && !one.each
    )
  return `${
    c.on
      ? ''
      : `<section class="Card">${
        heading("Keys can't be saved here yet")
      }<p class="Card_Sub">This server has nowhere safe to keep a key, so connecting is switched off.</p></section>`
  }${
    c.list.length || c.services.length || c.borrowed.length
      ? ''
      : `<section class="Empty"><h2>No connections yet</h2><p>When an app needs an outside service, like a calendar or an API key, it shows up here for you to connect.</p></section>`
  }${group('Yours', yours)}${
    spaces.map((space) =>
      group(
        spaceHost(env, space),
        first.filter((one) => one.space == space)
          .map((one) => connection(one, c.on, undefined, c.enable)).join('') +
          c.borrowed.filter((b) => b.space == space)
            .map((b) => borrowing(b, c.on, mine(b), c.enable)).join('') +
          (space == at.space
            ? c.built.map(offer).join('') + (c.on ? add : '')
            : ''),
        space == at.space && c.asked ? offer(c.asked) : '',
      )
    ).join('')
  }`
}

let option = (value: string, label: string, chosen: boolean) =>
  `<option value="${esc(value)}"${chosen ? ' selected' : ''}>${label}</option>`

// Inviting someone (apps.ts `saved`, which asks member_add): their address,
// the whole space or one app, what they may do there, and a note for the
// letter if the owner wants one.
let inviting = (at: DeskPage) => {
  let was = at.invite ?? { email: '', app: '', role: '', note: '' }
  return `<section class="Card">${heading('Invite someone')}
<form class="Form" method="post" action="${managePath('people', at.pick)}">${
    labeled(
      'invite-email',
      'Email address',
      `<input class="Field" id="invite-email" name="invite" type="email" required autocomplete="off" spellcheck="false" placeholder="friend@example.com" value="${
        esc(was.email)
      }">`,
    )
  }${
    labeled(
      'invite-app',
      'Invite them to',
      `<select class="Field" id="invite-app" name="app">${
        option('', 'Every app here', !was.app)
      }${
        at.apps.map((a) =>
          option(a.slug, esc(a.title || a.slug), was.app == a.slug)
        ).join('')
      }</select>`,
      'Invited to one app, they can open that app and nothing else here.',
    )
  }${
    labeled(
      'invite-role',
      'They can',
      `<select class="Field" id="invite-role" name="role">${
        option('editor', 'Change things', was.role != 'viewer')
      }${option('viewer', 'Only look', was.role == 'viewer')}</select>`,
    )
  }${
    labeled(
      'invite-note',
      'A note for the email <span class="Form_Optional">(optional)</span>',
      `<textarea class="Field" id="invite-note" name="note" rows="2" maxlength="500">${
        esc(was.note)
      }</textarea>`,
    )
  }<div class="Form_Actions"><button class="Button" type="submit">Send invitation</button></div></form></section>`
}

// Who is in the space and in each of its apps, and who has yet to accept
// (people.ts): the way to invite someone, then a list for the space and one
// for each app anybody is a guest of or invited to, each row drawn by its
// renderer (render/held.ts) beside what the owner may do to it (apps.ts
// `saved`): send an invitation's letter again, and take anyone but an owner
// off, which for an invitation withdraws it (member_remove).
export let people = (at: DeskPage) => {
  let r = at.people
  if (!r) return ''
  let hidden = (name: string, value: string) =>
    `<input type="hidden" name="${name}" value="${esc(value)}">`
  let press = (fields: string, label: string, aria: string) =>
    `<form method="post" action="${
      managePath('people', at.pick)
    }">${fields}<button class="Button Button-quiet" type="submit" aria-label="${aria}">${label}</button></form>`
  let actions = (p: Person, app?: string) => {
    let them = esc(p.email ?? p.name)
    let waits = p.held == 'invite'
    let again = waits
      ? press(
        hidden('again', p.eid),
        'Send again',
        `Send the invitation to ${them} again`,
      )
      : ''
    let off = p.email && (p.held != 'seat' || p.role != 'owner')
      ? press(
        hidden('remove', p.email) + (app ? hidden('app', app) : ''),
        waits ? 'Withdraw' : 'Remove',
        waits ? `Withdraw the invitation to ${them}` : `Remove ${them}`,
      )
      : ''
    return again || off ? `<div class="Rows_Actions">${again}${off}</div>` : ''
  }
  let list = (title: string, all: Person[], app?: string) =>
    all.length
      ? `<section class="Card">${heading(esc(title))}<ul class="Rows">${
        all.map((p) =>
          `<li class="Rows_Item">${holder(p)}${actions(p, app)}</li>`
        ).join('')
      }</ul></section>`
      : ''
  return `${inviting(at)}${
    list('Members · every app', [...r.members, ...r.invited])
  }${
    r.apps.map((a) =>
      list(
        `${a.app.title} · this app only`,
        [...a.guests, ...a.invited],
        a.app.slug,
      )
    ).join('')
  }`
}

// The dashboard's page for one space, at the apex (apps.ts `manage`). What
// it aims at the space itself — an app, the drop zone, the builder — it names
// by the space's own address.
export let desk = (at: DeskPage, env: Host = {}) => {
  let view = at.view ?? 'apps'
  let site = `https://${spaceHost(env, at.space)}`
  let titles = {
    apps: 'Your apps',
    people: 'People',
    connect: 'Your agents',
    connections: 'Connections',
    new: 'New app',
    visits: 'Visits',
    selling: 'Selling',
    settings: 'Settings',
    billing: 'Billing',
    trash: 'Trash',
  }
  let body = ''
  if (view == 'apps') body = library(at, env)
  if (view == 'connect') {
    body = `${
      agentSetup(at.agents ?? [], env, managePath('connect', at.pick))
    }${copying}${tabbing}`
  }
  if (view == 'new') {
    body = `<section class="Card Desk_Start" ${
      state(true, !!at.agents?.length)
    }>${heading('Ask your agent for a new yaks app')}${
      agentList(at.agents ?? [], 'links')
    }<div class="Form_Field"><p class="Form_Label">Try this</p>${firstAsk}</div></section>${
      connectCard(at)
    }
<div class="Desk_Options">${chat(`${site}/api/build`)}
<section class="Card">${heading('Upload your website')}${
      dropZone(undefined, `${site}/deploy`)
    }</section></div>${chatLive('/build.js')}${dropping}`
  }
  if (view == 'visits') {
    body = at.apps.length
      ? visited(at.views ?? null, at.viewsOff ?? '', site)
      : '<section class="Empty"><h2>No visits yet</h2><p>Your app visits will appear here once you have an app.</p></section>'
  }
  if (view == 'selling') body = selling(at, env)
  if (view == 'settings') body = preferences(at, env)
  if (view == 'billing') {
    body = plan(
      {
        slug: at.space,
        plan: at.plan ?? { plus: false, ends: '', known: false },
        paid: at.paid,
      },
      env,
      managePath('billing', at.pick),
    ) + billing
  }
  if (view == 'trash') body = trash(at)
  if (view == 'connections') body = connections(at, env)
  if (view == 'people') body = people(at)
  return shell(
    env,
    `${titles[view]} · ${esc(at.space)}`,
    null,
    at.no ? 400 : 200,
    `${
      navigation(at, view, env)
    }<div class="Desk_Body"><header class="Desk_Head"><div>
<a class="Desk_Address" href="${site}/" target="_blank" rel="noopener">${
      esc(spaceHost(env, at.space))
    } ↗</a><h1>${titles[view]}</h1>${
      view == 'visits'
        ? `<p class="Desk_Period">Last ${at.viewDays ?? 30} days</p>`
        : ''
    }</div>${
      view == 'apps'
        ? `<a class="Button" href="${managePath('new', at.pick)}">+ New app</a>`
        : ''
    }</header><div class="Desk_Content" id="content" tabindex="-1">${
      at.say
        ? `<p class="Say${at.no ? ' Say-no' : ''}" role="status">${
          esc(at.say)
        }</p>`
        : ''
    }${body}</div></div>${['apps', 'new'].includes(view) ? copying : ''}${
      ['apps', 'new', 'connect'].includes(view)
        ? agentLive('/oauth/agents')
        : ''
    }`,
    { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
    'Desk',
  )
}

export let spaceIndex = (at: SpacePage, env: Host = {}) => {
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
  let pitch = at.manage
    ? `<p><a class="Button" href="${esc(at.manage)}">Manage your apps</a></p>`
    : at.person
    ? home(env)
    : `<p><a class="Button" href="${esc(at.signIn)}">Sign in</a></p>
<section class="Card">${
      heading('What is yaks.app?')
    }<p class="Card_Sub">Ask an assistant like Claude or ChatGPT for an app, and it builds one here — a page of your own you can send to anyone.</p><p><a href="${
      url(env, '/')
    }">Make one of your own</a></p></section>`
  return shell(
    env,
    esc(at.title || at.space),
    at.apps.length
      ? 'Here is what you can open.'
      : 'Nothing here is open to visitors yet.',
    200,
    `${mine}${ask}${pitch}`,
  )
}

export let oops = (env: Host = {}, requestId?: string) =>
  shell(
    env,
    'Something went wrong.',
    'Try again shortly. If the problem continues, ask your assistant to check the app.' +
      (requestId ? ` Request ID: ${esc(requestId)}.` : ''),
    500,
    home(env),
    requestId ? { 'x-request-id': requestId } : {},
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
  env: Host = {},
) =>
  shell(
    env,
    stage == 'error' ? 'This domain needs a fix' : 'Setting up this domain',
    stage == 'error'
      ? `${esc(host)} needs attention before it can serve — here is what ` +
        'Cloudflare says.'
      : `${esc(host)} is being connected to yaks.app. This is usually a ` +
        'matter of minutes, not hours.',
    503,
    `<section class="Card">${heading(esc(host))}<pre>${
      esc(said)
    }</pre></section>${home(env)}`,
    { 'retry-after': '30' },
  )

// A door a later leaf fills (the connector): plain, not a mystery.
export let soon = (what: string, env: Host = {}) =>
  shell(
    env,
    `${what} is not available yet.`,
    'This feature is still being built.',
    404,
  )

// A hidden field, only when there is something to carry.
let held = (name: string, value?: string | null) =>
  value ? `<input type="hidden" name="${name}" value="${esc(value)}">` : ''

// The path of an address, whole or bare; nothing, for one that is neither.
let pathOf = (href: string) => {
  try {
    return new URL(href, 'https://x').pathname
  } catch {
    return ''
  }
}

// What each card carries forward: the authorize request's own query string,
// so the code form lands back where it started, and the page the person was
// on before they were asked to sign in, so the code hands them back to it
// (T-32593). Whether that address is one to follow is the login door's to
// decide, never this page's.
let carried = (q: string | null, back?: string | null) =>
  held('q', q) + held('return', back) +
  (back && ['/connect', managePath('connect')].includes(pathOf(back))
    ? `<script>if (location.hash) document.currentScript.previousElementSibling.value += location.hash</script>`
    : '')

// The sign-in card's first line. When `back` is a page on a space, it names
// that address: somebody who tapped "sign in" on a friend's app reads where
// they are going, not a pitch for building apps. Only a host under the apex is
// named; any other address is the door's to judge, and the card says nothing.
let welcome = (back: string | null, env: Host) => {
  let to = back && URL.canParse(back) ? new URL(back) : null
  return to?.hostname.endsWith(`.${apex(env)}`)
    ? `Sign in to continue to ${
      esc(to.hostname + to.pathname.replace(/\/$/, ''))
    }.`
    : 'Build an app by asking Claude or ChatGPT.'
}

// Ask for an address. `who` names the app asking, when one is (the OAuth
// consent page is this page — signing in is the consent), and `why` is the
// soft refusal, when there was one: a sign-in link that had already been used
// lands here, carrying whatever it was going to finish (identity.ts, T-34351).
export let askEmail = (
  q: string | null,
  back: string | null,
  who?: string,
  why?: string,
  status = 200,
  env: Host = {},
) =>
  shell(
    env,
    'Sign in or sign up',
    why ?? welcome(back, env),
    status,
    `<form method="post" action="/login">${carried(q, back)}
<p>${
      who ? `${esc(who)} would like to use your apps. ` : ''
    }Enter your email to get a sign-in code.</p>
<input class="Field" name="email" type="email" required autofocus autocomplete="email" placeholder="you@example.com" aria-label="Your email">
<button class="Button" type="submit">Send me a code</button>
</form>${home(env)}`,
  )

// Ask for the code just mailed, and nothing else (T-34236). Signing up is two
// steps and both are the address: give it, then prove it. What a person is
// called and where their apps live are theirs to set on their own space page,
// once they are standing on it — a question in front of the door is a step
// somebody has to get past to see anything at all. `why` is the soft refusal,
// when there was one. A code that expired while they looked for the letter, or
// one that never came, is answered by a second door to the same address: the
// first step again, without typing it again.
export let askCode = (
  email: string,
  q: string | null,
  back: string | null,
  why?: string,
  status = 200,
  env: Host = {},
) =>
  shell(
    env,
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
</form><form class="Again" method="post" action="/login">${carried(q, back)}
<input type="hidden" name="email" value="${esc(email)}">
<button class="Button Button-quiet" type="submit">Send a new code</button>
</form>${home(env)}`,
  )

// Closing a space (T-33166, erase.ts): the page that stands in front of it.
// It names what goes — every app, every domain, everyone who loses their way
// in, and the address — because a person about to lose all of it should read
// the list rather than remember it.
//
// Two acts, and the page says which one this is (T-34431). By default the
// space goes to the trash, and then each line names something that stops
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
}, env: Host = {}) =>
  shell(
    env,
    `Delete ${esc(spaceHost(env, at.slug))}?`,
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
        ? `<section class="Card">${
          heading(
            at.forever
              ? 'What goes, for good'
              : 'What stops until you restore it',
          )
        }
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
          at.token
            ? ''
            : `<label class="Form_Label" for="confirm">Type <b>${
              esc(at.slug)
            }</b> to confirm</label>
<input class="Field" id="confirm" name="confirm" autocomplete="off" spellcheck="false" autofocus>`
        }
<button class="Button" type="submit">${
          at.forever
            ? `Delete ${esc(spaceHost(env, at.slug))} forever`
            : `Put ${esc(spaceHost(env, at.slug))} in the trash`
        }</button>
</form>
<p class="Note">Changed your mind? Close this page — nothing has happened.</p>`
    }
${home(env)}`,
  )

// And after: what went, and the one thing worth knowing next — the address
// belongs to nobody now, theirs to take again or somebody else's to take
// later. A space that went to the trash has the opposite next thing: the
// address is still theirs, and so is everything under it.
export let deleted = (said: string, forever = true, env: Host = {}) =>
  shell(
    env,
    "That's done.",
    esc(said),
    200,
    `<p class="Note">${
      forever
        ? `The address is free again. Ask your assistant for a new
space whenever you want one.`
        : `Nothing was erased. The address is held for you, and restoring it
puts everything back exactly as it was.`
    }</p>${home(env)}`,
  )

/** An invitation as its link may tell it to somebody not yet in: what the
 * letter said and no more (invite.ts `door`). */
export type Offer = {
  /** the address it went to */
  email: string
  /** the letter's link, which signing in comes back to */
  back: string
  /** who sent its latest letter, by name */
  by: string | null
  /** to see, rather than use */
  see: boolean
  space: { slug: string; title: string }
  /** the one app it is to, and whether a visitor may already open it */
  app: { eid: string; slug: string; title: string; open: boolean } | null
}

// An invitation opened by somebody who is not signed in as the person it is
// for (invite.ts): who invited them to what, the app drawn as the dashboard
// draws it, the address it went to, and the one button that mails that
// address a code and brings them back to accept it.
export let invited = (o: Offer, env: Host = {}) => {
  let host = spaceHost(env, o.space.slug)
  let what = o.app
    ? esc(o.app.title || o.app.slug)
    : `${esc(o.space.title)} at ${esc(host)}`
  return shell(
    env,
    'You have an invitation',
    `${o.by ? esc(o.by) : 'Someone'} invited you to ${
      o.see ? 'see' : 'use'
    } ${what}.`,
    200,
    `${
      o.app
        ? `<div class="Apps Apps-one">${
          tile(o.app, {
            at: `https://${host}`,
            host,
            icon: o.app.open ? undefined : url(env, '/connector-512.png'),
          })
        }</div>`
        : ''
    }<form method="post" action="/login">${held('email', o.email)}${
      held('return', o.back)
    }
<p>It was sent to ${esc(o.email)}. Sign in with that address to accept it.</p>
<button class="Button" type="submit">Email me a sign-in code</button>
</form>${home(env)}`,
  )
}

// A private app opened by someone invited to it who has not accepted yet: the
// click in the letter is what is left, and no page of the app may make it for
// them (invite.ts). Its title is theirs to read; the letter named it.
export let invitedTo = (title: string, env: Host = {}) =>
  shell(
    env,
    'Your invitation is waiting',
    `Accept the invitation to ${
      esc(title)
    } from the letter yaks.app sent you, then open this link again.`,
    403,
  )

// An invitation that is no longer open: withdrawn, or for a space or an app
// that is gone. Which one is nobody's business but the inviter's.
export let closed = (env: Host = {}) =>
  shell(
    env,
    'This invitation is no longer open.',
    'Ask whoever invited you to send a new one.',
    410,
  )

// The Connect button an app that asks each person to connect their own
// account is given (connections.ts `own`): which app, which service and how it
// looks, whether this person's is connected, and the one form that connects
// it — a key pasted, or a sign-in at the service. The form posts back to this
// page.
export let askConnect = (at: {
  app: string
  face: Face
  keyed: boolean
  /** whether a key can be kept here at all */
  on: boolean
  status: Shown['status']
  /** the app's own address, to go back to */
  back: string
  say?: string
  no?: boolean
}, env: Host = {}) =>
  shell(
    env,
    `Connect ${esc(at.face.title)}`,
    `${esc(at.app)} asks each person who uses it to connect their own ${
      esc(at.face.title)
    } account. Yours is used only when you use the app, and you can disconnect it from your own connections page.`,
    200,
    `<section class="Card">${
      heading(esc(at.face.title), {
        mark: logo(at.face),
        status: at.status == 'needed'
          ? ''
          : at.status == 'broken'
          ? status('Yours needs reconnecting', 'warn')
          : status('Yours is connected', 'good'),
        actions: at.on && !at.keyed
          ? `<form method="post"><button class="Button" type="submit">${
            at.status == 'needed' ? 'Connect' : 'Connect again'
          }</button></form>`
          : '',
      })
    }${about(at.face)}${howTo(at.face, at.status != 'connected')}${
      at.say
        ? `<p class="Say${at.no ? ' Say-no' : ''}" role="status">${
          esc(at.say)
        }</p>`
        : ''
    }${
      !at.on
        ? `<p class="Card_Sub">Keys can't be saved here yet.</p>`
        : at.keyed
        ? `<form method="post">${
          keyBox(
            'key',
            'Paste your key',
            '<button class="Button" type="submit">Save key</button>',
          )
        }</form>`
        : ''
    }</section><p class="Note"><a href="${esc(at.back)}">Back to ${
      esc(at.app)
    }</a></p>`,
  )

// A custom domain asking to sign in: consent names its host and its space.
export let askHandoff = (
  host: string,
  back: string,
  consent: string,
  env: Host = {},
) =>
  shell(
    env,
    `Sign in to ${esc(host)}`,
    'This signs you in to this space only.',
    200,
    `<form method="post" action="/login/handoff">${held('return', back)}${
      held('consent', consent)
    }
<button class="Button" type="submit">Continue to ${esc(host)}</button>
</form>${home(env)}`,
    { 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' },
  )

// An app asking, for a browser that is already signed in: one click is the
// whole consent. `consent` is the form's own token (identity.ts `consenting`).
export let askAllow = (
  email: string,
  q: string,
  who: string,
  consent: string,
  env: Host = {},
) =>
  shell(
    env,
    'Allow access to your apps on yaks.app',
    `${esc(who)} would like to use your apps on yaks.app as ${esc(email)}.`,
    200,
    `<form method="post" action="/oauth/allow">${carried(q)}${
      held('consent', consent)
    }
<button class="Button" type="submit">Allow</button>
</form>${home(env)}`,
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
  agents?: Agent[]
  said?: string
  say?: string
  no?: boolean
  // What this space pays (billing.ts, T-33125): whether it is on Plus, the
  // day it lapses if it is leaving, and whether Stripe has ever known this
  // space — which is what makes the manage door worth offering. This is the
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
let mine = (y: Yours, env: Host) =>
  `<section class="Card">${heading('Where your apps live')}
<p class="Now">Your apps live at <b>${esc(spaceHost(env, y.slug))}</b>.</p>
<form class="Form Addr" method="post" action="/connect">${
    labeled(
      'your-space',
      'Your address',
      `<div class="Form_Line"><span class="At"><input class="Field" id="your-space" name="space" maxlength="63" autocomplete="off" spellcheck="false" value="${
        esc(y.said ?? y.slug)
      }"><span>.${
        apex(env)
      }</span></span><button class="Button" type="submit">Save</button></div>`,
      MOVES,
    )
  }
<p class="Say${y.no ? ' Say-no' : ''}" role="status">${esc(y.say ?? '')}</p>
</form>
</section>`

// What changing an address does, said on both cards that change it: the
// apps go along, and the old address redirects only until somebody else takes
// the name, which is free the moment it is left (D-131924).
let MOVES = 'You can change it at any time. Every app moves with it, and ' +
  'the old address sends people to the new one until someone else takes ' +
  'that name.'

// The plan card, for a person who is signed in (T-33125). One card with one
// button: Plus when they are free, manage-billing when they are paying. The
// button POSTs to billing.ts and follows the URL Stripe answers, so no Stripe
// address is written into this page and nothing here knows a key.
//
// A day, not a timestamp: "runs until 14 October 2026" is what somebody wants
// to know, and the hour is noise on a monthly bill.
let plan = (
  y: Pick<Yours, 'slug' | 'plan' | 'paid'>,
  env: Host,
  target?: string,
) => {
  let ends = y.plan.ends ? day(y.plan.ends) : ''
  let limits = y.plan.plus ? PLUS : FREE
  let allowance = `${
    limits.apps == null ? 'Unlimited apps' : `${limits.apps} apps`
  }, ${count(limits.requests)} request units a month, ${
    size(limits.bytes)
  } of app data`
  let head = y.plan.plus
    ? `<p>${esc(spaceHost(env, y.slug))} is on <b>Plus</b> — ${allowance}.${
      ends ? ` It runs until ${esc(ends)} and then stops renewing.` : ''
    }</p>`
    : `<p>${
      esc(spaceHost(env, y.slug))
    } is on the <b>free</b> plan — ${allowance}. <a href="${
      url(env, '/pricing')
    }">Compare plans</a>.</p>`
  // Someone Stripe has met can always reach their own billing, whatever plan
  // they are on today: an invoice from a month they paid for is theirs to
  // read after they cancel.
  let doors = [
    y.plan.plus
      ? ''
      : billButton('checkout', `Get Plus — ${plusPrice()} a month`, target),
    y.plan.known ? billButton('portal', 'Manage billing', target) : '',
  ].filter(Boolean).join('')
  return `<section class="Card Bill" id="plan">${
    heading('Your plan', {
      status: y.plan.plus ? status('Plus', 'good') : status('Free'),
      actions: doors,
    })
  }
${head}
${
    y.paid
      ? '<p class="Say">Thanks — that went through. Your space moves to Plus ' +
        'in a moment.</p>'
      : ''
  }
<p class="Say Bill_Say" role="status"></p>
</section>`
}

// Connector forms do not ask the same questions. Keep each answer beside the
// provider step that asks for it, so a person never has to work out whether a
// field belongs to the form they are looking at.
let field = (label: string, value: string, what: string) =>
  `<div><dt>${esc(label)}</dt><dd>${copyable(value, what)}</dd></div>`

let fields = (rows: string) => `<dl class="Fields">${rows}</dl>`

let chatgptFields = (env: Host) =>
  fields(
    field('Name', CONNECTOR.title, 'the name') +
      field('Description', CONNECTOR.description, 'the description') +
      `<div><dt>Icon</dt><dd class="Connect_Icon">
<a href="${
        url(env, '/yaks-app.png')
      }" download="yaks-app.png" aria-label="Download the yaks.app icon">
<img src="${
        url(env, '/yaks-app.png')
      }" width="56" height="56" alt="The yaks.app icon"></a>
<a href="${url(env, '/yaks-app.png')}" download="yaks-app.png">Download icon</a>
</dd></div>`,
  )

let external = (href: string, label: string) =>
  `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`

// What a person asks for their first app. The assistant already knows them,
// so the ask hands it their own situation rather than a scenario we made up
// for them (the app-ideas prompt's own question, prompts/app-ideas.md).
let firstAsk = copyable(
  "Any yaks.app ideas you think I'd like, based on our chat history?",
  'the first app request',
)

// An address on this platform, written out for somebody to type or paste.
let at = (path: string, env: Host) => `<code>${url(env, path)}</code>`

// What to write in an OAuth box, for the forms that have boxes (T-34414).
// Every value is the authorization server's own — route.ts `OAUTH` is what
// identity.ts configures the provider with and what both `/.well-known`
// documents serve — so this page cannot come to teach an address the door
// does not answer.
let ID = 'Leave <b>OAuth Client ID</b> and <b>OAuth Client Secret</b> empty.'

let boxes = (env: Host) =>
  `<b>Authorization URL</b> ${at(OAUTH.authorize, env)}, <b>Token URL</b> ${
    at(OAUTH.token, env)
  }, <b>Registration URL</b> ${
    at(OAUTH.register, env)
  }, <b>Scope</b> <code>${OAUTH.scope}</code>.`

let oauthHelp = (env: Host) =>
  `For clients that need manual setup: ${ID} ${boxes(env)}`

// This repository is itself a plugin marketplace (T-34666): `.agents/plugins/
// marketplace.json` offers `plugins/yaks.app/`, whose `.mcp.json` names the
// same MCP address every other door on this page hands out. So the shorthand
// is a third route to the same server, not a different product.
let REPO = 'yak-sh/yak'

// Nothing interpolated below is anybody's input, so it is written as the
// markup it is; everything that is a person's is escaped where it enters.
//
// Keep setup paths and field labels matched to each client's form, including
// differences between its desktop and mobile interfaces.
let clients = (env: Host) => [
  {
    key: 'claude',
    tab: 'Claude',
    title: 'Claude',
    paths: [
      {
        title: 'Web + Desktop',
        steps: [
          'Open ' + external(
            'https://claude.ai/customize/connectors/directory?modal=add-custom-connector',
            'Customize → Connectors → Add',
          ) + '.',
          'Paste these values:' + fields(
            field('Name', CONNECTOR.title, 'the name') +
              field(
                'Remote MCP server URL',
                url(env, '/mcp'),
                'the connection URL',
              ),
          ),
          'Click <b>Continue</b>.',
        ],
      },
      {
        title: 'Mobile App',
        steps: [
          'Claude’s help pages only describe adding a connector on ' +
          'claude.ai or the desktop app, so add yaks.app there first, ' +
          'using the <b>Web + Desktop</b> steps.',
          'Then open the Claude app on your phone. Your connector works ' +
          'there too: in a chat, tap <b>+</b> in the message box, then ' +
          '<b>Connectors</b>, and make sure yaks.app is switched on.',
        ],
      },
    ],
    // Claude's own limits on custom connectors, from its documentation
    // (claude.com/docs/connectors/custom/remote-mcp): the two that stop
    // somebody partway through these steps.
    note: 'Claude’s free plan allows one custom connector. On a Team or ' +
      'Enterprise plan, an owner adds it under <b>Organization settings</b> ' +
      '→ <b>Connectors</b>, and then you press <b>Connect</b> beside it ' +
      'in <b>Customize</b> → <b>Connectors</b>.',
    finish: 'Open ' + external('https://claude.ai/new', 'a new Claude chat'),
  },
  {
    key: 'chatgpt',
    tab: 'ChatGPT',
    title: 'ChatGPT — on the web',
    // Who can, before anyone starts: OpenAI's help page on developer mode
    // (help.openai.com/en/articles/12584461) puts full MCP, writes included,
    // in beta for Business, Enterprise and Edu, turned on by an admin; Pro
    // connects with read and fetch only; Free and Plus go unnamed; and MCP
    // apps are web only.
    intro: 'On ChatGPT Business, Enterprise or Edu, you can add yaks.app ' +
      'and build with it once an admin turns it on. On Pro it connects but ' +
      'can only read, so it can’t build. Free and Plus can’t add it this ' +
      'way today, but Claude works on any plan. It works on the web, not in ' +
      'the phone app.',
    steps: [
      'Copy this URL:' +
      fields(field('Connection', url(env, '/mcp'), 'the connection URL')),
      'Open ' +
      external('https://chatgpt.com/plugins', 'ChatGPT Plugins') +
      ', tap the <b>+</b> button, then <b>Add custom MCP server</b>.',
      'Add the name and description:' + chatgptFields(env),
      'Under <b>Connection</b>, paste the URL you copied.',
      'Read the warning, tap <b>I understand and want to continue</b>, then ' +
      '<b>Create as a plugin</b>.',
      'Sign in with your email when ChatGPT asks.',
    ],
    // The repository's plugin names production; a staging visitor needs the
    // manual setup above to stay with this deployment.
    details: apex(env) == apex()
      ? {
        summary: 'Connect from the ChatGPT desktop app',
        text:
          'This way, yaks.app stays up to date without waiting for a review. ' +
          'In the ChatGPT desktop app, choose ' +
          '<b>Add plugin marketplace</b>, then copy and paste this:' +
          fields(field('Repository', REPO, 'the repository')) +
          'You can also add it in your workspace’s plugin settings.',
      }
      : undefined,
    finish: 'Open ' + external('https://chatgpt.com/', 'a new ChatGPT chat'),
  },
  {
    key: 'claude-code',
    tab: 'Claude Code',
    title: 'Claude Code',
    steps: [
      `In your terminal: <code class="Pick">claude mcp add --transport http yaks ${
        url(env, '/mcp')
      }</code>`,
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
      '{ "mcpServers": { "yaks": { "url": "' + url(env, '/mcp') +
      '" } } }</code>',
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
      fields(field('URL', url(env, '/mcp'), 'the MCP URL')),
      'If it asks for a name, use <b>yaks.app</b>. Then follow its sign-in ' +
      'prompt.',
    ],
    details: {
      summary: 'More about authentication',
      text: oauthHelp(env) +
        ' If your client never offers sign-in, use ' +
        `<code>${url(env, '/mcp?auth=required')}</code> as the server URL.`,
    },
    finish: 'Start a new chat in your MCP client',
  },
]

let steps = (items: string[]) =>
  `<ol>${items.map((s) => `<li>${s}</li>`).join('')}</ol>`

// Native radio tabs share their layout with the working style-guide example.
let doors = (env: Host) =>
  `<fieldset class="Tabs">
<legend class="Tabs_Legend">Which app do you use?</legend>
${
    clients(env).map((a, i) =>
      `<div class="Tabs_Item">
<input type="radio" name="agent" id="tab-${a.key}" value="${a.key}"${
        i ? '' : ' checked'
      }>
<label class="Tabs_Tab" for="tab-${a.key}">${a.tab}</label>
<section class="Card Tabs_Panel Tabs_Panel-${a.key}"><h2 class="Card_Title">${a.title}</h2>
${a.intro ? `<p>${a.intro}</p>` : ''}
${
        a.paths
          ? a.paths.map((p) =>
            `<h3 class="Connect_Path">${p.title}</h3>${steps(p.steps)}`
          ).join('')
          : steps(a.steps)
      }
${a.note ? `<p class="Note">${a.note}</p>` : ''}
${
        a.details
          ? `<details class="More"><summary>${a.details.summary}</summary><div class="More_Body Note">${a.details.text}</div></details>`
          : ''
      }
<div class="Connect_Next"><p>Make your first app</p>
${a.finish}, then ask:${firstAsk}
<span class="Note">Pick one to build, then ask for changes in the same chat. Keep shaping it as you use it.</span></div>
</section></div>`
    ).join('')
  }
</fieldset>`

// `back` is where a row's Disconnect returns to: the page it is on.
let agentSetup = (agents: Agent[], env: Host, back: string) =>
  `${agentList(agents, 'rows', back)}
<p ${
    state(true, !!agents.length)
  }>Ask for an app, or keep improving one in the same chat.</p>
<p ${
    state(false, !agents.length)
  }>Connect once, then build and keep improving your apps in your usual chats.</p>
<details class="More Connect_Setup" data-agent-setup${
    agents.length ? '' : ' open'
  }>
<summary ${state(true, !!agents.length)}>Connect another agent</summary>
${doors(env)}</details>`

// The only script a tab needs, and it is not what switches one: the radios do
// that with no script at all. This keeps the chosen one in the address, so a
// link can name a tab and a reload comes back to it. Matched by value, never
// built into a selector — a hash is whatever a stranger put in it.
let tabbing = `<script>
let tabs = document.querySelector('.Tabs')
if (tabs) {
  let all = [...tabs.querySelectorAll('input[name=agent]')]
  let pick = () => {
    let want = all.find((r) => r.value == decodeURIComponent(location.hash.slice(1)))
    if (want) {
      want.checked = true
      let setup = tabs.closest('details')
      if (setup) setup.open = true
    }
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
</script>`

// The billing buttons: ask our own door for a Stripe URL and follow it. The
// URL is minted per person and expires, so it is never written into the page.
let billing = `<script>
for (let b of document.querySelectorAll('.Bill_Go')) {
  b.addEventListener('click', async () => {
    let say = b.closest('.Bill').querySelector('.Bill_Say')
    b.disabled = true
    say.className = 'Say Bill_Say'
    say.textContent = 'One moment…'
    try {
      let r = await fetch(b.dataset.target || '/api/billing/' + b.dataset.door, {
        method: 'POST',
        body: new URLSearchParams({ billing: b.dataset.door }),
      })
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

export let connect = (yours: Yours, status = 200, env: Host = {}) =>
  shell(
    env,
    'Connect yaks.app',
    'Build and manage your apps from your usual chats.',
    status,
    `${agentSetup(yours.agents ?? [], env, '/connect')}
<details class="More Attach"${status != 200 || yours.paid ? ' open' : ''}>
<summary>Your address and plan</summary>
<div class="More_Body">${mine(yours, env)}${plan(yours, env)}</div>
</details>
<p class="Note"><a href="${url(env, MANAGE)}">Your apps and settings</a></p>
<p class="Note"><a href="${url(env, '/help')}">Need help?</a></p>
${home(env)}${copying}${tabbing}${inline}${billing}${
      agentLive('/oauth/agents')
    }`,
  )
