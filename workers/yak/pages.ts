// The kernel's own pages, in the home page's voice (workers/yak/public): what
// a person sees when there is nothing at an address, when an app broke, and
// where they sign in. One shell, three sentences, and an optional card of
// markup under them. Its parts are @yaks/ui's, drawn by the pencil skin
// (public/_ui.css), and the column and the dashboard's frame are
// public/pages.css.
// Errors are for the person's assistant to fix (D-32318 §Errors); the
// dashboard marks the app they broke in and says what to ask it.
//
// A page is a tree of the kit's parts, rendered once at its edge (`page`), so
// what a person typed is escaped by Preact wherever it lands; a page carries
// an email address a stranger typed, and web content never speaks HTML (the
// repo's md.ts rule, one floor down). Markup the platform made itself (an
// icon, the yak, a QR code, markdown theirs.ts drew) goes in whole (`raw`),
// and so does a page's own script.

import { type Field as Fielded, KEY } from '@yaks/connections'
import {
  At,
  Button,
  Card,
  Chip,
  Chips,
  Copy,
  Empty,
  Field,
  Form,
  Group,
  Icon,
  Loading,
  More,
  Notice,
  Report,
  Rows,
  SideNav,
  State,
  TabSet,
} from '@yaks/ui/parts'
import { type ComponentChildren, h, type VNode } from 'preact'
import type { Frame } from './build-door.ts'
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
import { type IconName, icons } from './icons.ts'
import { day, esc, fileDrop, markup, raw } from './html.ts'
import { holder, tile } from './render/mod.ts'
import type { People, Person } from './people.ts'
import type { Role } from './directory.ts'
import type { Plain } from './unseen.ts'
import { type Invitation, qr } from './referral.ts'
import { shown } from '@yaks/phone'
import { CODE_NOTE, texted } from './signin.ts'
export { esc } from './html.ts'
import {
  accountView,
  chatPath,
  enabling,
  LOGOUT,
  MANAGE,
  managePath,
  type ManageView,
  OAUTH,
} from './route.ts'
import { CONNECTOR } from './seo.ts'
import { AGENT } from './docs.ts'
import { apex, type Host, spaceHost, url } from './host.ts'
import { versionOf } from './running.ts'
import { Yak, yak } from './mascot.ts'
import { links } from './sheets.ts'
import {
  type Budget,
  type Ceiling,
  ceilings,
  count,
  type Gauge,
  PRICE,
  share,
  size,
  WARN,
  YEARLY,
} from './meter.ts'
import type { Card as Billed, Payer, Want } from './billing.ts'
import { columns } from '@yaks/ui/chart'
import type { Accepts } from '@yaks/blob'
import type { VocabDoc } from '@yaks/vocab'
import { kinds } from './data.ts'

type Kids = ComponentChildren

// A page's own script: constant code, which says nothing a person typed.
let run = (code: string) =>
  h('script', { dangerouslySetInnerHTML: { __html: code } })

// A form's hidden field, only when there is something to carry.
let held = (name: string, value?: string | null) =>
  value ? h('input', { type: 'hidden', name, value }) : null

let home = (env: Host) =>
  h('a', { class: 'Away', href: url(env, '/') }, 'yaks.app')

// The meter's prices are whole US dollars, as on the public pricing page.
let plusPrice = () => `$${count(PRICE.plus)}`

// What a plan costs, said on its button: "$49 a month", "$490 a year".
let priced = (want: Want) =>
  `$${count((want.per == 'year' ? YEARLY : PRICE)[want.tier]!)} a ${want.per}`

let billButton = (
  door: string,
  label: string,
  target?: string,
  want?: Want,
) =>
  h(Button, {
    type: 'button',
    mod: door != 'portal' && 'go',
    class: 'Bill_Go',
    'data-door': door,
    'data-target': target,
    'data-plan': want?.tier,
    'data-per': want?.per,
  }, label)

// The style guide's parts (public/style-guide.html, One design language),
// said once: a card's head, a status word, and a field under its label.

/** A card's head: its mark, its title, how it stands, and what acts on the
 * whole card, at the right. */
let heading = (
  title: Kids,
  at: { mark?: Kids; status?: Kids; actions?: Kids; id?: string } = {},
) =>
  h(
    Card.Head,
    null,
    at.mark,
    h(Card.Title, { id: at.id }, title),
    at.status,
    at.actions ? h(Card.Actions, null, at.actions) : null,
  )

/** How something stands, in its role's colour. */
let status = (word: Kids, tone?: 'positive' | 'negative') =>
  h(State, { mod: tone }, word)

/** A field: its label, its control, and what explains it under both. */
let labeled = (id: string, label: Kids, control: Kids, hint: Kids = '') =>
  h(
    Form.Field,
    null,
    h(Form.Label, { for: id }, label),
    control,
    hint ? h(Form.Hint, null, hint) : null,
  )

// A label for what may be left empty.
let optional = (label: Kids) => [
  label,
  ' ',
  h(Form.Optional, null, '(optional)'),
]

// A value as text a script can hold: JSON, with nothing that could close it.
let script = (value: unknown) =>
  JSON.stringify(value).replaceAll('<', '\\u003c')

// The script that moves an open page onto a newer deploy (public/deploy.js),
// told the deploy that drew it. None where the runtime names no deploy.
let deployed = (env: Host) => {
  let v = versionOf(env.CF_VERSION_METADATA)
  return v
    ? `<script src="${url(env, '/deploy.js')}" data-deploy="${
      esc(v.id)
    }" data-deploy-at="${esc(v.at)}" defer></script>`
    : ''
}

// The document every page here is, around the `<main>` it is handed as markup:
// its head, and the scripts the parts in it call for.
let documented = (
  env: Host,
  title: string,
  main: string,
  status: number,
  headers: Record<string, string> = {},
  layout = '',
  head = '',
) =>
  new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title} · yaks.app</title>
${links(env, 'pages.css')}${
      head.includes('rel="apple-touch-icon"')
        ? ''
        : `\n<link rel="apple-touch-icon" href="${
          url(env, '/apple-touch-icon.png')
        }">`
    }${head ? `\n${head}` : ''}
</head>
<body${layout ? ` class="${layout}"` : ''}><main>${main}</main>${
      main.includes('data-chart')
        ? `<script src="${url(env, '/chart.js')}" defer></script>`
        : ''
    }${
      main.includes('data-menu')
        ? `<script src="${url(env, '/menu.js')}" defer></script>`
        : ''
    }${
      main.includes('data-idle')
        ? `<script src="${url(env, '/idle.js')}" defer></script>`
        : ''
    }<script src="${url(env, '/drop.js')}" defer></script>${
      deployed(env)
    }</body>
</html>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    },
  )

/** What a page says about itself: its title, the line under it where it
 * opens with the two, its status, the headers beside its content type (the
 * provisioning page's `Retry-After`, the dashboard's no-store), the class
 * its body wears, and tags for its head beside the platform's own. */
export type Said = {
  title: string
  lead?: Kids
  status?: number
  headers?: Record<string, string>
  layout?: string
  head?: string
}

/** A page: what it says about itself, and its parts, rendered once. A page
 * with a `lead` opens with its title as the heading and the lead under it. */
export let page = (env: Host, at: Said, ...parts: Kids[]) =>
  documented(
    env,
    esc(at.title),
    markup([
      at.lead == null ? null : [h('h1', null, at.title), h('p', null, at.lead)],
      parts,
    ]),
    at.status ?? 200,
    at.headers,
    at.layout,
    at.head,
  )

/** The same page written as markup, for the pages that still are (admin.ts,
 * operator-page.ts): `title` and `lead` are markup too. */
export let shell = (
  env: Host,
  title: string,
  lead: string | null,
  status: number,
  inner = markup(home(env)),
  headers: Record<string, string> = {},
  layout = '',
  head = '',
) =>
  documented(
    env,
    title,
    (lead == null ? '' : `<h1>${title}</h1><p>${lead}</p>`) + inner,
    status,
    headers,
    layout,
    head,
  )

export let lost = (env: Host = {}) =>
  page(env, {
    title: 'Page not found',
    lead: 'Check the address, or return to yaks.app.',
    status: 404,
  }, home(env))

export let nothingHere = (env: Host = {}) =>
  page(env, {
    title: 'Nothing here yet.',
    lead: "There are no apps at this address yet. If it's yours, ask your " +
      'assistant to build one.',
    status: 404,
  }, home(env))

// How long something in the trash is kept: "3 more days".
let more = (n: number) => `${n} more ${n == 1 ? 'day' : 'days'}`

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
  page(
    env,
    {
      title: `${at.title} is in the trash.`,
      lead: `Nothing answers at this address until it is restored. It is ` +
        `kept for ${more(at.days)}, then erased for good.`,
      status: 404,
    },
    h(
      'p',
      null,
      h(Button, {
        mod: 'go',
        href: url(env, managePath('trash', at.space)),
      }, 'Restore it from your apps'),
    ),
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
}, env: Host = {}) => {
  let host = spaceHost(env, at.slug)
  return page(
    env,
    {
      title: `${at.title} is in the trash.`,
      lead: `Nothing answers at ${host} until you restore it — no app ` +
        `here, and no page. Everything the space had is kept for ${
          more(at.days)
        }, then erased for good.`,
      status: 404,
    },
    h(
      'form',
      { method: 'post', action: '/' },
      held('restore-space', at.slug),
      h(Button, { mod: 'go', type: 'submit' }, `Restore ${host}`),
    ),
    h(
      'p',
      { class: 'Note' },
      'Its apps, their files and everything they saved come back exactly as they were.',
    ),
    home(env),
  )
}

// Deploying by dropping a file (T-34230): the one door on this platform that
// makes an app with no assistant in the room. A drop zone (`drop`) and the
// name the app lives at — one plain form that POSTs to `/deploy` (drop.ts)
// and needs no script at all. The script below only fills the name in from
// the file's own; nothing it does is required for the form to work.
//
// `slug` given is an app's own page, where the name is not a question: the
// drop goes to that app and nowhere else. `to` is the space's door, whole,
// on a page that is not at the space's own address (the dashboard's).
let dropZone = (slug?: string, to = '/deploy') =>
  h(
    'form',
    {
      class: 'Deploy',
      method: 'post',
      action: to,
      enctype: 'multipart/form-data',
    },
    fileDrop({
      name: 'file',
      label: 'Website files',
      hint: 'A .zip of your website files, or a single index.html',
      required: true,
    }),
    slug ? held('slug', slug) : h(Field, {
      name: 'slug',
      maxlength: 63,
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: 'Name for your website',
      'aria-label': 'Website name',
    }),
    h(
      Button,
      { mod: 'go', type: 'submit' },
      slug ? 'Update app' : 'Upload website',
    ),
  )

// Constant text, no interpolation, and every write to the page is a field's
// value — the page never speaks HTML on a person's behalf (`inline` below
// takes the same line). A drop says `change` too (public/drop.js).
let dropping = () =>
  run(`
let deploy = document.querySelector('.Deploy')
if (deploy) {
  let file = deploy.querySelector('input[type=file]')
  let slug = deploy.querySelector('input[name=slug]')
  // What to call it, from what the file is called: recipes.zip -> recipes.
  // Never over a name already typed, and never off a bare index.html, whose
  // stem says nothing about the app.
  file.addEventListener('change', () => {
    let f = file.files[0]
    if (!f || !slug || slug.value) return
    let stem = f.name.replace(/\\.[a-z0-9]+$/i, '').toLowerCase()
    if (stem == 'index') return
    slug.value = stem.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 63)
  })
}
`)

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
  let out: Kids[] = []
  let from = 0
  for (let m of text.matchAll(AT)) {
    let to = m[0].replace(/[.,;:!?)\]]+$/, '')
    out.push(text.slice(from, m.index), h('a', { href: to }, to))
    from = m.index + to.length
  }
  return [...out, text.slice(from)]
}

// One tool, as one row: its name, the line it said about itself, and where it
// got to. `null` is a tool still running — the row a `ran` frame replaces.
let toolRow = (name: string, line: string, ok: boolean | null) =>
  h(
    'p',
    { class: ok == false ? 'Chat_Tool Chat_Tool-no' : 'Chat_Tool' },
    h(
      'span',
      { class: 'Chat_Name' },
      `${ok == null ? '…' : ok ? '✓' : '✗'} ${name}`,
    ),
    h('span', { class: 'Chat_Of' }, line),
  )

/** The conversation, as the page draws it. */
let transcript = (frames: Frame[]) => {
  let rows: Kids[] = []
  let at = new Map<string, number>()
  for (let f of frames) {
    if ('said' in f) {
      if (!f.text) continue
      rows.push(
        h('p', {
          class: `Chat_Bubble Chat_Bubble-${
            f.said == 'person' ? 'you' : 'them'
          }`,
        }, linked(f.text)),
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
        h(
          Card,
          { as: 'div', class: 'Chat_Built' },
          h('p', null, 'It is live.'),
          address(f.built),
        ),
      )
    } else if ('busy' in f) {
      rows.push(h('p', { class: 'Chat_Note' }, f.busy))
    }
  }
  return h('div', { class: 'Chat_Said' }, rows)
}

// An address something is live at, to open or copy.
let address = (to: string) =>
  h('p', { class: 'Url' }, h('a', { href: to }, h('code', null, to)))

// The line a person types. `required` is the browser's own guard; the door
// keeps the same one, for whoever posts without it. While a build runs, the
// script shows the yak at its keyboard above the button; its files are the
// apex's, which a space's page names whole.
let chatAsk = (env: Host, to = '/api/build') =>
  h(
    'form',
    { class: 'Chat_Ask', method: 'post', action: to },
    h(
      'p',
      null,
      h(Field, {
        lines: true,
        name: 'say',
        rows: 3,
        required: true,
        placeholder: 'A recipe box I can share with my sister',
        'aria-label': 'What do you want to build?',
      }),
    ),
    h(
      Loading,
      { as: 'p', class: 'Chat_Note', 'data-wait': '', hidden: true },
      h(Yak, { pose: 'typing', base: url(env) }),
      h('span', null, 'Building…'),
    ),
    h(Button, { mod: 'go', type: 'submit' }, 'Build it'),
  )

// The optional built-in builder, reached from New app: the dashboard's page
// is at the apex, so its form names the space's door whole, and the script
// opens its socket wherever the form points.
let chat = (env: Host, to: string) =>
  h(
    Card,
    { class: 'Chat' },
    heading('Build an app here'),
    transcript([]),
    chatAsk(env, to),
  )

// The live half (public/build.js), served at the address of the page it is
// on: the builder's own on a space's hostname (apps.ts serves it there), so a
// space's page needs no asset of the apex, and the public file at the apex.
// A module, because it is one, and nothing on the page waits for it.
let chatLive = (src = '/api/build.js') => h('script', { type: 'module', src })

let back = (env: Host, space: string) =>
  h(
    'p',
    null,
    h('a', {
      class: 'Away',
      href: url(env, managePath('apps', space)),
    }, 'Back to your apps'),
  )

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
  page(
    env,
    {
      title: at.why ? 'That did not go in' : spaceHost(env, at.space),
      lead: at.why ?? 'Here is what happened. Say the next thing below.',
      status: at.why ? 400 : 200,
    },
    h(Card, { class: 'Chat' }, transcript(at.frames ?? []), chatAsk(env)),
    back(env, at.space),
    chatLive(),
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
  page(
    env,
    {
      title: at.why ? 'That did not go in' : `${at.slug ?? at.space} is live`,
      lead: at.why ?? `Version ${at.version} is serving. Here is what went in.`,
      status: at.status ?? 200,
    },
    at.url ? address(at.url) : null,
    at.files?.length
      ? h(
        Card,
        null,
        heading(
          `${at.files.length} ${at.files.length == 1 ? 'file' : 'files'}`,
        ),
        h('ol', { class: 'Files' }, at.files.map((f) => h('li', null, f))),
      )
      : null,
    h(
      Card,
      null,
      heading(at.slug ? 'Update app files' : 'Try again'),
      h(
        Card.Sub,
        null,
        at.slug
          ? `Drop another zip — or one index.html — and ${at.slug} becomes it.`
          : 'A .zip of the files, or a single index.html.',
      ),
      dropZone(at.slug),
    ),
    back(env, at.space),
    dropping(),
  )

// One thing to say, and a button that puts it on the clipboard (T-34420). The
// words are selectable on their own (`.Copy_Text` is `user-select: all`), so a
// browser that ran no script still takes them in one gesture — the button is
// all the script below adds, and it stays hidden until that script un-hides
// it, because a button that does nothing is worse than no button.
//
// One control, everywhere something is meant to be pasted: the three things to
// say below, and each of the three a connector form asks for (T-34412).
let copyable = (said: Kids, what = '') =>
  h(
    Copy,
    null,
    h(Copy.Text, null, said),
    h(Copy.Go, {
      type: 'button',
      'aria-label': what ? `Copy ${what}` : undefined,
      hidden: true,
    }, 'Copy'),
  )

// The button's half. Constant text, no interpolation, and every write to the
// page is textContent — the page never speaks HTML on a person's behalf. The
// words come from the span beside it rather than an attribute of its own, so
// there is one copy of them on the page and nothing to keep in step. Where the
// clipboard is refused — an insecure origin, a browser that asks first — the
// words are selected instead, so the person's own copy keystroke lands.
let copying = () =>
  run(`
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
`)

// Who visited, on the space page (views.ts, T-34497): a block per app, the
// owner's alone. A bar per day for the window, then the three short lists —
// the pages people opened, the sites that sent them, the countries they were
// in — as tables, because a table reads on a phone and needs no script.
//
// Short enough for the ends of an axis: "7 Aug".
let axisDay = (iso: string) => {
  let at = new Date(`${iso}T00:00:00Z`)
  return Number.isNaN(at.getTime()) ? '' : at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

let chart = (days: { day: string; views: number }[]) =>
  h(
    Report.Plot,
    null,
    columns(h as never, {
      from: days[0]?.day ?? '',
      values: days.map((d) => d.views),
      noun: 'visit',
    }) as VNode,
    h(
      Report.Span,
      null,
      h('span', null, axisDay(days[0]?.day ?? '')),
      h('span', null, axisDay(days[days.length - 1]?.day ?? '')),
    ),
  )

let column = (head: string, rows: { name: string; views: number }[]) =>
  rows.length
    ? h(
      Report.Column,
      null,
      h('h3', null, head),
      h(
        Report.List,
        null,
        rows.map((r) =>
          h(
            'li',
            null,
            h('span', { title: r.name }, r.name),
            h('b', null, count(r.views)),
          )
        ),
      ),
    )
    : null

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
  h(
    Report,
    { 'aria-labelledby': `visits-${v.slug}` },
    h(
      Card.Head,
      null,
      h(
        Card.Title,
        { id: `visits-${v.slug}` },
        h('a', {
          href: `${site}/${encodeURIComponent(v.slug)}/`,
          target: '_blank',
          rel: 'noopener',
        }, v.title || v.slug),
      ),
      h(
        Report.Total,
        null,
        `${count(v.stats.total)} `,
        h(Report.Unit, null, v.stats.total == 1 ? 'visit' : 'visits'),
      ),
    ),
    v.stats.total
      ? [
        chart(v.stats.daily),
        h(
          Report.Tops,
          null,
          column('Pages', v.stats.pages),
          column('Came from', v.stats.from),
          column('Countries', v.stats.countries),
        ),
      ]
      : null,
  )

let visited = (apps: Visits[] | null, off: string, site: string) =>
  apps == null ? h(Form.Hint, null, off) : apps.map((v) => visits(v, site))

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

/** A space the side's selector offers: whether it is the person's to own,
 * whether it is the one they open first (`member.own`), and of one they are
 * only a member of, its owner's name. */
export type Picked = {
  slug: string
  title: string
  owner: boolean
  own: boolean
  whose?: string
  // What its Operator is called.
  operator?: string
  // Where its logo is drawn from (route.ts `logoPath`), where it has one.
  logo?: string
}

export type DeskPage = {
  /** the space the page is in, or on a page of the person's own, the one the
   * side's selector holds */
  space: string
  /** each with its open errors, newest first (unseen.ts `plain`) */
  apps: (Listed & { errors?: Plain[] })[]
  trash?: { eid: string; slug: string; title: string; days: number }[]
  name?: string
  email?: string
  agents?: Agent[]
  views?: Visits[] | null
  viewDays?: number
  viewsOff?: string
  sell?: 'none' | 'setup' | 'ready'
  /** the name of the payment provider the space pays and sells through
   * (payments.ts), as the selling and billing cards say it */
  provider?: string
  plan?: Yours['plan']
  paid?: boolean
  /** the Billing page's month: each allowance the space answers to and how
   * much of it is used, its model budget, when the hourly sweep last read
   * them, and whom the payment provider bills (`undefined` when it couldn't
   * be asked) */
  bill?: {
    limits: Partial<Record<Ceiling, Gauge>>
    budget: Budget
    read: string | null
    payer?: Payer | null
  }
  /** on a paid plan, which is what taking payments needs */
  paying?: boolean
  fee?: string
  say?: string
  no?: boolean
  view?: ManageView
  connections?: Connections
  /** who is in the space and its apps, and who has yet to accept */
  people?: People
  /** the other spaces whose Operator works here, and its role (`operator_reach`) */
  operators?: { eid: string; slug: string; title: string; role: string }[]
  /** what was typed into the invitation form, when the invitation was
   * refused and the page is drawn again */
  invite?: { email: string; app: string; role: string; note: string }
  /** what was typed into the settings form, when a change was refused and
   * the page is drawn again */
  typed?: { title: string; space: string; home: string }
  /** what was typed into the new space form, when it was refused */
  made?: { title: string; slug: string }
  /** the apps of other people's spaces this person may open, each with the
   * slug of the space it lives in */
  shared?: (Listed & { space: string })[]
  /** every space this person may work in, this one among them */
  spaces?: Picked[]
  /** the person's own invite to yaks.app (referral.ts `invitation`) */
  referral?: Invitation
  /** the Operator page's content (operator-page.ts `operatorBody`) */
  operator?: string
  /** a member of the space who does not own it: of its pages they may open
   * only the Operator, so the side links only that */
  member?: boolean
}

// What each page of the side is, by the glyph beside its name.
let navIcons = {
  profile: 'user',
  invite: 'qr-code',
  agents: 'bot',
  shared: 'share-2',
  operator: 'bot',
  apps: 'layout-grid',
  people: 'users',
  connections: 'plug',
  visits: 'chart-no-axes-column-increasing',
  selling: 'credit-card',
  billing: 'receipt',
  settings: 'settings-2',
  trash: 'trash-2',
} satisfies Record<string, IconName>

// A glyph the pages draw (icons.ts), as the kit's Icon.
let glyph = (name: IconName) => h(Icon, { of: icons[name] })

// The space a page is in, as the side and the page's head name it.
let picked = (at: DeskPage) =>
  at.spaces?.find((s) => s.slug == at.space) ??
    { slug: at.space, title: '', owner: !at.member, own: false }
let named = (s: Pick<Picked, 'slug' | 'title'>) => s.title || s.slug

// The space's Operator as the side and its page name it ("Pip, your
// Operator"), and as the way back to its chat names it ("Pip").
let yourOperator = (at: DeskPage) => {
  let name = picked(at).operator
  return name
    ? { title: `${name}, your Operator`, back: name }
    : { title: 'Your Operator', back: 'your Operator' }
}

// The settings' one side, Manage (T-136122, T-140507): the way back to the
// Operator's chat on top, then the space being managed, chosen in place, with
// its pages under it on one sheet (T-140072), then what is the person's own
// wherever they are. On a phone the same side opens full screen from the top
// bar's Menu (`:target`, no script).
let navigation = (at: DeskPage, view: ManageView, env: Host) => {
  let link = (
    key: keyof typeof navIcons,
    label: string,
    to = managePath(key, at.space),
  ) => {
    let on = view == key || (view == 'new' && key == 'apps')
    return h(
      SideNav.Link,
      { href: to, mod: on && 'on', 'aria-current': on ? 'page' : undefined },
      glyph(navIcons[key]),
      label,
      key == 'trash' && at.trash?.length
        ? h('span', { class: 'Desk_Count' }, at.trash.length)
        : null,
    )
  }
  let { title, back } = yourOperator(at)
  let operator = link('operator', title)
  let host = spaceHost(env, at.space)
  return {
    label: 'Manage',
    top: h(
      Button,
      { mod: 'go', class: 'Desk_Back', href: chatPath(at.space) },
      glyph('chevron-left'),
      `Back to ${back}`,
    ),
    side: [
      h('h2', { class: 'Desk_Title' }, 'Manage'),
      h(
        'div',
        { class: 'Desk_Section' },
        h('h3', { class: 'Desk_Group', id: 'side-space' }, 'This space'),
        h(
          'div',
          { class: 'Desk_Here' },
          chooser(at, view),
          h(
            SideNav,
            { 'aria-labelledby': 'side-space' },
            at.member ? operator : [
              link('apps', 'Apps'),
              link('people', 'People'),
              operator,
              link('connections', 'Linked accounts'),
              link('visits', 'Visits'),
              at.sell ? link('selling', 'Selling') : null,
              link('billing', 'Billing'),
              link('settings', 'Space settings'),
              link('trash', 'Trash'),
            ],
          ),
        ),
      ),
      h(
        'div',
        { class: 'Desk_Section' },
        h('h3', { class: 'Desk_Group', id: 'side-account' }, 'Your account'),
        h(
          SideNav,
          { 'aria-labelledby': 'side-account' },
          link('profile', 'Profile'),
          link('invite', 'Invite a friend'),
          link('agents', 'Agents'),
          link('shared', 'Shared with you'),
        ),
      ),
      h(
        'div',
        { class: 'Desk_Foot' },
        h(
          'a',
          { href: `https://${host}/`, target: '_blank', rel: 'noopener' },
          `Open ${host} `,
          glyph('external-link'),
        ),
        h(
          'a',
          { href: url(env, '/help'), target: '_blank', rel: 'noopener' },
          'Help',
        ),
        h(
          'form',
          { method: 'post', action: url(env, LOGOUT) },
          h('button', { class: 'Desk_Out', type: 'submit' }, 'Sign out'),
        ),
      ),
    ],
  }
}

/** A side in the dashboard's frame: what it is called, what sits beside its
 * Close on a phone, and what it holds. */
export type Side = { label: string; top?: Kids; side: Kids }

// The dashboard's frame, which every dashboard page is drawn in (`desk`, and
// the platform's admin directory, admin.ts `desk`): the side beside the page;
// on a phone a top bar naming the page, whose Menu opens the same side over
// the whole screen and whose Close shuts it (`:target`, no script).
export let deskFrame = (
  at: Side & { where: Kids; head: Kids; content: Kids; class?: string },
) => [
  h(
    'header',
    { class: 'Desk_Bar' },
    h(Button, { href: '#menu' }, '☰ Menu'),
    h('span', { class: 'Desk_Where' }, at.where),
  ),
  h('a', { class: 'Desk_Skip', href: '#content' }, 'Skip to content'),
  h(
    'aside',
    { class: 'Desk_Side', id: 'menu', 'aria-label': at.label },
    h(
      'div',
      { class: 'Desk_Top' },
      at.top,
      h(Button, { class: 'Desk_Close', href: '#' }, '✕ Close'),
    ),
    at.side,
  ),
  h(
    'div',
    { class: 'Desk_Body' },
    h('header', { class: 'Desk_Head' }, at.head),
    h('div', {
      class: ['Desk_Content', at.class].filter(Boolean).join(' '),
      id: 'content',
      tabindex: '-1',
    }, at.content),
  ),
]

// The space selector (T-135919, T-136122, T-136983, T-137003): the space
// every link under it changes, as a box saying its name, and Change, which
// opens the list over the page; it closes like any menu (public/menu.js).
// Choosing another keeps the page: Billing in one space becomes Billing in
// the other, a page of the person's own stays where it is, and a space they
// are only a member of opens at its Operator.
let chooser = (at: DeskPage, view: ManageView) =>
  choice(
    picked(at),
    at.spaces ?? [],
    (s) =>
      accountView(view)
        ? `${managePath(view)}?space=${encodeURIComponent(s.slug)}`
        : managePath(
          !s.owner ? 'operator' : view == 'new' ? 'apps' : view,
          s.slug,
        ),
    h('a', { class: 'Desk_New', href: managePath('space') }, '+ New space'),
  )

/** A space's logo, or where it has none its first letter. */
let spaceTile = (s: Picked) =>
  s.logo
    ? h('img', {
      class: 'Desk_Tile',
      src: s.logo,
      width: 32,
      height: 32,
      alt: '',
      decoding: 'async',
    })
    : h(
      'span',
      { class: 'Desk_Tile', 'aria-hidden': 'true' },
      named(s).charAt(0).toUpperCase(),
    )

// The space selector over `all`, holding `here`: each space opens at `to`,
// `make` follows the list, and `about` leads the line under each space's name
// (the dashboard's side, and the Operator's chat app, which names each
// space's Operator: operator-page.ts `chatPage`).
export let choice = (
  here: Picked,
  all: Picked[],
  to: (s: Picked) => string,
  make: Kids = null,
  about: (s: Picked) => string = () => '',
) => {
  let box = (s: Picked, line = '') => {
    let said = [about(s), line].filter(Boolean).join(' · ')
    return [
      spaceTile(s),
      h(
        'span',
        { class: 'Desk_Name' },
        h('b', null, named(s)),
        said ? h('small', null, said) : null,
      ),
    ]
  }
  if (all.length < 2) {
    return [
      h('div', { class: 'Desk_Space', title: named(here) }, box(here)),
      make,
    ]
  }
  return h(
    'details',
    { class: 'Desk_Pick', 'data-menu': '' },
    h(
      'summary',
      { class: 'Desk_Space', title: named(here) },
      box(here),
      h('span', { class: 'Desk_Change' }, 'Change', glyph('chevrons-up-down')),
    ),
    h(
      'div',
      { class: 'Desk_Menu' },
      h(
        'div',
        { class: 'Desk_List' },
        h('p', { class: 'Desk_Ask' }, 'Which space do you want to work in?'),
        all.map((s) =>
          h(
            'a',
            {
              class: 'Desk_Row',
              href: to(s),
              'aria-current': s.slug == here.slug ? 'true' : undefined,
            },
            box(
              s,
              s.owner
                ? ''
                : s.whose
                ? `${s.whose}’s space · you’re a member`
                : 'You’re a member',
            ),
            s.slug == here.slug ? h('span', { class: 'Desk_Tick' }, '✓') : null,
          )
        ),
        make,
      ),
    ),
  )
}

let connectCard = (at: DeskPage, env: Host) =>
  h(
    Card,
    { class: 'Desk_Connect', ...state(false, !at.agents?.length) },
    heading('Connect your agent', {
      actions: h(
        Button,
        { mod: 'go', href: managePath('agents') },
        'Connect agent',
      ),
    }),
    h(
      Card.Sub,
      null,
      'Build and improve your apps in the conversations you already have with Claude or ChatGPT.',
    ),
    pasteLink(env),
  )

// What broke in an app, for its owner: each break as its line says it to their
// assistant, how often and when last, and the one thing to do, which is to
// ask that assistant. The app's mark on its tile links here.
let SHOWN = 5
// What the space's Operator made of one break, with the way to its
// conversation in the Operator's chat app.
export let operated = (e: Plain, space: string) => {
  let o = e.operator
  if (!o) return null
  let said = o.failed != null
    ? `The Operator could not fix it. ${o.failed}`.trim()
    : o.answer != null
    ? `The Operator: ${o.answer}`
    : 'The Operator is fixing it.'
  return h(
    Rows.Meta,
    null,
    `${said} `,
    h('a', { href: chatPath(space, e.fix) }, 'See what it did'),
  )
}
export let fixing = (a: DeskPage['apps'][number], space: string) => {
  let errors = a.errors ?? []
  let n = errors.length
  let title = a.title || a.slug
  return h(
    Card,
    { class: 'Fix', id: `fix-${a.slug}` },
    heading(title, {
      status: status(n == 1 ? '1 error' : `${n} errors`, 'negative'),
    }),
    h(
      Rows,
      { as: 'ul' },
      errors.slice(0, SHOWN).map((e) =>
        h(
          Rows.Item,
          { as: 'li' },
          h(
            Rows.Main,
            null,
            h('span', { class: 'Fix_Said' }, e.said || 'No message'),
            h(
              Rows.Meta,
              null,
              `${e.where ? `${e.where} · ` : ''}${
                e.times == 1 ? 'once' : `${e.times} times`
              }${
                day(e.at)
                  ? `, ${e.times == 1 ? '' : 'last '}on ${day(e.at)}`
                  : ''
              }`,
            ),
            operated(e, space),
          ),
        )
      ),
    ),
    n > SHOWN ? h(Rows.Meta, { as: 'p' }, `And ${n - SHOWN} more.`) : null,
    h(
      Form.Field,
      null,
      h(
        Form.Label,
        { as: 'p' },
        `Ask your assistant to fix ${n == 1 ? 'it' : 'them'}`,
      ),
      copyable(
        `Fix the errors in my ${title} app on yaks.app`,
        `the request to fix ${title}`,
      ),
    ),
  )
}

// Nothing in a list yet: what will be there, and how it gets there.
let empty = (title: string, ...says: Kids[]) =>
  h(Empty, null, h('h2', null, title), says)

// What others let this person into (Your account › Shared with you): drawn by
// the same Tile as their own, each with the address it lives at.
let sharedWith = (at: DeskPage, env: Host) =>
  at.shared?.length
    ? h(
      'div',
      { class: 'Apps' },
      at.shared.map((a) => {
        let host = spaceHost(env, a.space)
        return tile(a, { at: `https://${host}`, host, editor: true })
      }),
    )
    : empty(
      'Nothing shared with you yet',
      h(
        'p',
        null,
        'An app someone invites you to, in a space of theirs, appears here.',
      ),
    )

/** The apps view: the space's apps, each marked where it broke with what to
 * ask about it, and with none, the way to make one. */
export let library = (at: DeskPage, env: Host) => {
  let broken = at.apps.filter((a) => a.errors?.length)
  return [
    connectCard(at, env),
    at.apps.length
      ? [
        h(
          'div',
          { class: 'Apps' },
          at.apps.map((a) =>
            tile(a, {
              at: `https://${spaceHost(env, at.space)}`,
              errors: a.errors?.length,
              editor: true,
            })
          ),
        ),
        broken.length
          ? [
            h(Group, null, 'Needs fixing'),
            broken.map((a) => fixing(a, at.space)),
          ]
          : null,
      ]
      : empty(
        'Your apps will live here',
        h(
          'div',
          state(true, !!at.agents?.length),
          h('p', null, 'Ask your agent for your first app. Try this:'),
          firstAsk(),
        ),
        h(
          'div',
          state(false, !at.agents?.length),
          h(
            'p',
            null,
            'A recipe box, a book club page, a tool for your day. Start with an idea.',
          ),
          h(
            'a',
            { href: managePath('new', at.space) },
            'More ways to make an app',
          ),
        ),
      ),
    copying(),
  ]
}

// A form a dashboard card is, and the button that saves it under the card.
let saving = (
  action: string,
  card: Kids,
  label = 'Save',
) =>
  h(
    Form,
    { method: 'post', action },
    card,
    h(Form.Actions, null, send(label)),
  )

// The fields a card holds, one under the other.
let fieldsOf = (...kids: Kids[]) => h(Form, { as: 'div' }, kids)

let option = (value: string, label: string, chosen: boolean) =>
  h('option', { value, selected: chosen }, label)

// Profile (Your account): the person's name, their email, and the space
// `/manage` opens, which is the one their seat marks theirs (`member.own`).
let profile = (at: DeskPage, env: Host) => {
  let mine = (at.spaces ?? []).filter((s) => s.owner)
  let first = mine.find((s) => s.own)?.slug ?? ''
  return saving(
    managePath('profile'),
    h(
      Card,
      null,
      heading('Profile'),
      fieldsOf(
        labeled(
          'your-name',
          'Your name',
          h(Field, {
            id: 'your-name',
            name: 'name',
            maxlength: 60,
            autocomplete: 'name',
            placeholder: 'Dana',
            value: at.name ?? '',
          }),
          'Shown to people in every space you’re in.',
        ),
        h(
          Form.Field,
          null,
          h(Form.Label, { as: 'p' }, 'Email'),
          h('p', null, at.email ?? ''),
        ),
        mine.length > 1
          ? labeled(
            'your-first',
            'Open first',
            h(
              Field,
              { choose: true, id: 'your-first', name: 'first' },
              mine.map((s) => option(s.slug, named(s), s.slug == first)),
            ),
            `The space ${apex(env)}${MANAGE} opens.`,
          )
          : null,
      ),
    ),
  )
}

// Invite (Your account, T-138777): the person's own QR code, shown to a
// friend on their phone, so it is the code first and large. Scanning it opens
// a text to yaks.app with the words written, or, under Email, a letter to the
// sign-up address; sending is signing up, so what sending agrees to is said
// beside the code, where the friend reads it (D-136811). The two ways are
// radios, which switch with no script.
let invitation = (r: Invitation, space: string, env: Host) => {
  let terms = [
    h('a', { href: url(env, '/terms') }, 'Terms'),
    ' · ',
    h('a', { href: url(env, '/privacy') }, 'Privacy'),
  ]
  let ways = [
    ...r.text
      ? [{
        key: 'text',
        tab: 'Text',
        link: r.text,
        label: 'QR code that opens a text to sign up for yaks.app',
        agree: 'Sending it signs you up for yaks.app and agrees to texts ' +
          "from yaks.app: your Operator's answers, and its alerts about " +
          'your space and the apps you build. Message frequency varies. Msg & data rates may apply. Reply STOP to ' +
          'stop, HELP for help. US numbers only.',
      }]
      : [],
    {
      key: 'email',
      tab: 'Email',
      link: r.mail,
      label: 'QR code that opens an email to sign up for yaks.app',
      agree:
        `Sending it to ${r.address} signs you up for yaks.app, and the answer comes by email.`,
    },
  ]
  return [
    h(
      'p',
      { class: 'Invite_Head' },
      'Show this to a friend. They scan it with their phone’s camera and send what opens: that signs them up, with their own space ready and its Operator writing back.',
    ),
    h(
      TabSet,
      { class: 'Invite' },
      h(TabSet.Legend, null, 'Sign up by'),
      ways.map((w, i) =>
        h(
          TabSet.Item,
          null,
          h('input', {
            type: 'radio',
            name: 'way',
            id: `way-${w.key}`,
            value: w.key,
            checked: !i,
          }),
          h(TabSet.Tab, { for: `way-${w.key}` }, w.tab),
          h(
            TabSet.Panel,
            { as: Card, class: 'Invite_Way' },
            h('p', { class: 'Invite_Lead' }, 'Scan to sign up for yaks.app'),
            h(
              'a',
              { class: 'Invite_Code', href: w.link },
              raw(qr(w.link, w.label)),
            ),
            h('p', { class: 'Invite_Words' }, r.said),
            h('p', { class: 'Note' }, `${w.agree} `, terms),
          ),
        )
      ),
    ),
    h(
      Card,
      null,
      heading('A free month for each friend'),
      h(
        'p',
        null,
        `Each friend who signs up and builds their first app gives ${space} one more free month of the Plus plan.`,
        r.joined
          ? ` ${r.joined} ${
            r.joined == 1 ? 'person has' : 'people have'
          } signed up with your invite so far, and ${r.built} built an app.`
          : '',
      ),
    ),
  ]
}

// A new space (from the selector's + New space): its name and its address,
// space_new as the assistant asks it.
let newSpace = (at: DeskPage, env: Host) =>
  saving(
    managePath('space'),
    h(
      Card,
      null,
      heading('New space'),
      h(Card.Sub, null, 'A space has its own address, apps, people and plan.'),
      fieldsOf(
        labeled(
          'space-title',
          'Name',
          h(Field, {
            id: 'space-title',
            name: 'title',
            maxlength: 60,
            placeholder: 'Book club',
            value: at.made?.title ?? '',
          }),
        ),
        labeled(
          'space-slug',
          'Address',
          addressBox('space-slug', 'slug', at.made?.slug ?? '', env, {
            required: true,
          }),
        ),
      ),
    ),
    'Create space',
  )

// A space's Settings: its name, its address and what it opens, one form and
// one Save,
// then deleting it, which asks again on its own page (identity.ts
// `closing`). A refusal draws the page again with what was typed still in
// the fields (`at.typed`).
/** The most bytes a space's logo may be, and the kinds it may be: pictures a
 * browser draws as an image and nothing else, so no SVG with its scripts. */
export let LOGO = {
  size: 1_000_000,
  accept: 'image/png,image/jpeg,image/webp,image/gif',
}

// Settings' Logo: the space's picture, or its letter, beside a drop zone
// that sends its own form as soon as a file is chosen, and Remove where there
// is one to take off.
let logoCard = (at: DeskPage) => {
  let here = picked(at)
  let action = managePath('settings', at.space)
  return h(
    Card,
    null,
    heading('Logo'),
    h(
      Card.Sub,
      null,
      'Shown beside the space’s name. A square picture looks best.',
    ),
    h(
      'form',
      {
        class: 'Desk_Logo',
        method: 'post',
        action,
        enctype: 'multipart/form-data',
      },
      spaceTile(here),
      fileDrop({
        name: 'logo',
        label: 'Logo',
        hint: 'PNG, JPEG, WebP or GIF, up to 1 MB',
        accept: LOGO.accept,
        size: LOGO.size,
        required: true,
        sends: true,
      }),
      h('noscript', null, send('Upload')),
    ),
    here.logo
      ? h(
        'form',
        { method: 'post', action },
        h(
          Button,
          { type: 'submit', name: 'unlogo', value: '1' },
          'Remove logo',
        ),
      )
      : null,
  )
}

let preferences = (at: DeskPage, env: Host) => {
  let home = at.apps.find((a) => a.home)
  let was = at.typed ??
    { title: named(picked(at)), space: at.space, home: home?.slug ?? '' }
  let host = spaceHost(env, at.space)
  return [
    logoCard(at),
    saving(
      managePath('settings', at.space),
      h(
        Card,
        null,
        heading('General'),
        fieldsOf(
          labeled(
            'space-title',
            'Name',
            h(Field, {
              id: 'space-title',
              name: 'title',
              maxlength: 60,
              value: was.title,
            }),
          ),
          labeled(
            'your-address',
            'Address',
            addressBox('your-address', 'space', was.space, env),
            MOVES,
          ),
          at.apps.length
            ? labeled(
              'your-home',
              `What ${host} opens`,
              h(
                Field,
                { choose: true, id: 'your-home', name: 'home' },
                option('', 'Your app library', !was.home),
                at.apps.map((a) =>
                  option(a.slug, a.title || a.slug, a.slug == was.home)
                ),
              ),
            )
            : h('p', null, `${host} opens its app library.`),
        ),
      ),
    ),
    h(
      Card,
      { class: 'Desk_Danger' },
      heading('Delete this space', {
        actions: h(Button, {
          href: url(env, `/space/${encodeURIComponent(at.space)}/delete`),
        }, 'Delete space…'),
      }),
      h(
        Card.Sub,
        null,
        'Its apps, people and data go to the trash for 30 days.',
      ),
    ),
  ]
}

let selling = (at: DeskPage, env: Host) => {
  let by = at.provider
  if (!at.sell || !by) return h('p', null, 'Selling is not available here yet.')
  let ready = at.sell == 'ready'
  let connected = at.sell != 'none'
  let stop = ready || (!at.paying && connected)
  let account = at.paying || connected
    ? h(
      'form',
      { method: 'post', action: managePath('selling', at.space) },
      held('sell', stop ? 'stop' : 'start'),
      h(
        Button,
        { type: 'submit', mod: !stop && 'go' },
        stop
          ? `Disconnect ${by}`
          : at.sell == 'setup'
          ? 'Continue setup'
          : `Connect ${by}`,
      ),
    )
    : null
  let subscribe = at.paying ? null : billButton(
    'checkout',
    `Subscribe — ${plusPrice()} a month`,
    managePath('selling', at.space),
  )
  return [
    h(
      Card,
      { class: 'Bill' },
      heading(
        !at.paying
          ? 'Take payments with Plus'
          : ready
          ? 'Payments are connected'
          : 'Take payments in your apps',
        {
          status: ready
            ? status('Connected', 'positive')
            : at.sell == 'setup'
            ? status('Setup unfinished', 'negative')
            : null,
          actions: subscribe || account ? [subscribe, account] : null,
        },
      ),
      h(
        'p',
        null,
        !at.paying
          ? connected
            ? `Your ${by} account is connected. Upgrade to Plus to accept new payments.`
            : `Connect ${by} and accept payments from your customers on Plus.`
          : ready
          ? `Payments go to your ${by} account. You manage refunds and disputes there.`
          : at.sell == 'setup'
          ? `Finish connecting your ${by} account to start accepting payments.`
          : `Connect your ${by} account to accept payments from your customers.`,
      ),
      at.paying
        ? h(
          Form.Hint,
          null,
          `yaks.app takes ${at.fee ?? ''} of each sale. `,
          h(
            'a',
            { href: url(env, '/pricing'), target: '_blank', rel: 'noopener' },
            'Pricing',
          ),
        )
        : [
          at.fee
            ? h(
              Form.Hint,
              null,
              `${at.fee} per sale, plus ${by} processing fees.`,
            )
            : null,
          h(Notice, { class: 'Bill_Say', role: 'status' }),
        ],
    ),
    at.paying ? null : billing(),
  ]
}

let trash = (at: DeskPage) =>
  at.trash?.length
    ? h(
      Card,
      null,
      heading('Deleted apps'),
      h(
        Card.Sub,
        null,
        'Each is kept for 30 days, then erased for good. Restoring one brings back everything it held, at its old address if free or a numbered address otherwise.',
      ),
      h(
        Rows,
        { as: 'ul' },
        at.trash.map((a) =>
          h(
            Rows.Item,
            { as: 'li' },
            h(
              Rows.Main,
              null,
              h(Rows.Name, { as: 'span' }, a.title || a.slug),
              h(
                Rows.Meta,
                null,
                `${a.days} ${a.days == 1 ? 'day' : 'days'} left`,
              ),
            ),
            h(
              Rows.Actions,
              {
                as: 'form',
                method: 'post',
                action: managePath('trash', at.space),
              },
              held('restore', a.eid),
              h(Button, { type: 'submit' }, 'Restore'),
            ),
          )
        ),
      ),
    )
    : empty(
      'Trash is empty',
      h('p', null, 'A deleted app waits here for 30 days.'),
    )

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
    ? h(Card.Mark, {
      as: 'img',
      src: `data:image/svg+xml,${encodeURIComponent(f.logo)}`,
      alt: '',
      width: 24,
      height: 24,
    })
    : null

// A line about a service and a link to its site, where it has them. Only an
// https address is linked, so a site can never be a script.
let about = (f: Face) => {
  let site = /^https:\/\/\S+$/.test(f.site)
    ? h(
      'a',
      { href: f.site, rel: f.theirs ? 'nofollow ugc' : undefined },
      f.site.replace(/^https:\/\//, '').replace(/\/$/, ''),
    )
    : null
  return f.tagline || site
    ? h(Card.Sub, null, f.tagline, f.tagline && site ? ' ' : '', site)
    : null
}

// How a person gets a service's key, as its integration says, open while the
// key is still wanted. The words are markdown theirs.ts drew.
let howTo = (f: Face, open: boolean) =>
  f.instructions
    ? h(
      More,
      { open },
      h('summary', null, 'How to get the key'),
      h(More.Body, null, raw(f.instructions)),
    )
    : null

// Where a key may be sent, said once beside wherever it is pasted.
// Addresses, each as code, a comma apart.
let codes = (hosts: string[]) =>
  hosts.flatMap((x, i) => [i ? ', ' : null, h('code', null, x)])
let reach = (hosts: string[]) =>
  hosts.length
    ? ['yaks.app keeps it and only ever sends it to ', codes(hosts), '.']
    : null

// The box a key is pasted in and the button that saves it, one line under
// its label; or, for a service that asks for several fields, a box for each
// under its own label, masked unless the field is shown, and the button under
// them. connections.ts `givenOf` reads what was typed.
let keyBox = (
  id: string,
  label: Kids,
  send: Kids,
  hint: Kids = '',
  fields: Fielded[] = [KEY],
) => {
  let box = (at: string, name: string, shown = false) =>
    h(Field, {
      id: at,
      name,
      type: shown ? 'text' : 'password',
      autocomplete: 'off',
      spellcheck: 'false',
      required: true,
    })
  if (fields.length == 1) {
    return labeled(
      id,
      fields[0] == KEY ? label : fields[0].label,
      h(Form.Line, null, box(id, 'key', fields[0].shown), send),
      hint,
    )
  }
  return [
    ...fields.map((f) =>
      labeled(
        `${id}-${f.name}`,
        f.label,
        box(`${id}-${f.name}`, `key.${f.name}`, f.shown),
      )
    ),
    h(Form.Actions, null, send),
    hint ? h(Form.Hint, null, hint) : null,
  ]
}

// A button a connection's form sends: quiet unless it is the card's one
// next step.
let press = (value: string, label: string, quiet = true) =>
  h(Button, { mod: !quiet && 'go', type: 'submit', name: 'do', value }, label)

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

// What a row's line says, each part a dot apart.
let dotted = (parts: Kids[]) =>
  parts.filter(Boolean).flatMap((p, i) => i ? [' · ', p] : [p])

// The kids given, or nothing where none of them is anything.
let any = (...kids: Kids[]) => kids.some(Boolean) ? kids : null

// One connection, as a card: its head says what it is and how it stands and
// holds what acts on all of it (connecting, disconnecting); under it the key
// it still wants, how to get one, the apps using it and the copies borrowing
// it, a box to let one more use it, and folded away what few people need:
// lending it to the copies people install, the name its code reads, a new
// key, and for a service this space added, what it says and whether it is
// listed. The space's side of an app that asks each person to connect
// their own is only the ask: nothing here connects it, and it stays while
// the app asks. Its forms post to the page it is on, `action`.
let connection = (c: Shown, on: boolean, action: string) => {
  let ask = c.each && !c.own
  let id = (what: string) => `${what}-${c.eid}`
  let form = (kids: Kids, at: Record<string, unknown> = {}) =>
    h(
      'form',
      { method: 'post', action, ...at },
      held('connection', c.eid),
      kids,
    )
  let open = c.status != 'connected' || !!c.failed
  // A key is pasted here for a keyed connection this deploy can keep one for.
  let keying = !ask && on && c.keyed
  // A connection an app shares and is waiting on is connected, not removed:
  // removing it would only leave the app a new one waiting. A person's own,
  // for an app that asks each person, is theirs to remove.
  let waiting = c.status == 'needed' && c.apps.length && !c.each
  let actions = any(
    !ask && !c.keyed && open ? form(press('signin', 'Connect', false)) : null,
    ask || waiting ? null : form(
      press('disconnect', c.status == 'needed' ? 'Remove' : 'Disconnect'),
    ),
  )
  let stands = ask ? status('Each person connects their own') : status(
    `${STATUS[c.status]}${c.account ? ` as ${c.account}` : ''}`,
    c.status == 'connected' ? 'positive' : 'negative',
  )
  let notice = c.failed
    ? said(sentence(c.failed), true)
    : c.saving
    ? said(sentence(c.saving))
    : null
  let paste = keying && open
    ? form(
      keyBox(
        id('key'),
        'Paste the key',
        press('key', 'Save key', false),
        reach(c.hosts),
        c.face.fields,
      ),
    )
    : null
  let forApp = (a: Using, kids: Kids, at: Record<string, unknown> = {}) =>
    form([held('app', a.app), kids], at)
  // An app that uses it: what its code reads and, for one it shares, who may
  // call out through it there, which the person opens to anyone or closes to
  // members, and the calls it made through it this month against any cap. A
  // person's own is only ever theirs to call out through. A copy another
  // space borrows it for is that space, its calls against the cap it was lent
  // under, and the button that takes the loan back.
  let using = (a: Using) =>
    h(
      Rows.Item,
      { as: 'li' },
      h(
        Rows.Main,
        null,
        h(Rows.Name, null, a.borrower ?? a.title),
        h(
          Rows.Meta,
          null,
          dotted(
            a.borrower != null ? [`Their copy of ${a.title}`, calls(a)] : [
              [
                h('code', null, `env.${a.binding}`),
                a.direct ? ', the key itself' : '',
              ],
              c.each ? '' : callers(a),
              calls(a),
              a.lends == null
                ? ''
                : `Lent to installed copies, ${callsOf(a.lends)} a month each`,
            ],
          ),
        ),
      ),
      c.each ? null : h(
        Rows.Actions,
        null,
        forApp(
          a,
          a.borrower != null ? press('recall', 'Recall') : opening(a),
        ),
      ),
    )
  // The space's own apps first, then the copies borrowing it.
  let rows = [...c.apps].sort((a, b) =>
    Number(a.borrower != null) - Number(b.borrower != null)
  )
  let apps = ask
    ? c.apps.length
      ? h(
        Card.Sub,
        null,
        `Each person who uses ${
          c.apps.map((a) => a.title).join(', ')
        } connects their own account, from the app.`,
      )
      : null
    : c.apps.length
    ? h(Rows, { as: 'ul' }, rows.map(using))
    : h(Card.Sub, null, 'No app uses it yet.')
  // Letting one more app use it: the app, and, folded under the advanced
  // options, the name its code reads it by, which most never change.
  let attaching = c.status == 'connected' && !c.own && c.available.length > 0
  let attach = attaching
    ? form(
      labeled(
        id('attach'),
        'Let an app use it',
        h(
          Form.Line,
          null,
          h(
            Field,
            { choose: true, id: id('attach'), name: 'app', required: true },
            h('option', { value: '' }, 'Choose an app'),
            c.available.map((a) => h('option', { value: a.app }, a.title)),
          ),
          press('attach', 'Attach', false),
        ),
        'Only its members can call out through it, and its code is handed a sentinel, never the key.',
      ),
      { id: id('attaching') },
    )
    : null
  let named = attaching
    ? labeled(
      id('bind'),
      'Name its code reads it by',
      h(Field, {
        id: id('bind'),
        form: id('attaching'),
        name: 'binding',
        autocomplete: 'off',
        spellcheck: 'false',
        pattern: '[A-Za-z_][A-Za-z0-9_]*',
        placeholder: c.binding,
      }),
      [
        'Left empty, its code reads ',
        h('code', null, `env.${c.binding}`),
        '. An agent can rename it later.',
      ],
    )
    : null
  let replace = keying && !open
    ? form(
      keyBox(
        id('key'),
        'Replace the key',
        press('key', 'Save key'),
        reach(c.hosts),
        c.face.fields,
      ),
    )
    : null
  // Where a key nobody pastes here goes, and what a sign-in granted.
  let reached = !keying && (c.hosts.length || c.scopes.length)
    ? h(
      Form.Hint,
      null,
      c.hosts.length
        ? ['Its key is only ever sent to ', codes(c.hosts), '.']
        : null,
      c.hosts.length && c.scopes.length ? ' ' : null,
      c.scopes.length ? `Granted: ${c.scopes.join(', ')}.` : null,
    )
    : null
  // Whether a service this space added is in the integration directory, for
  // anyone to add with their own key: its owner lists it or takes it out.
  let listing = c.about
    ? h(
      Form.Field,
      null,
      h(Form.Label, { as: 'span' }, 'Integration directory'),
      h(
        Form.Hint,
        null,
        c.listed
          ? [
            'Listed in the ',
            h('a', {
              href: `${INTEGRATIONS.path}#${encodeURIComponent(c.integration)}`,
            }, 'integration directory'),
            ', for anyone to add with their own key.',
          ]
          : 'Once listed, anyone could add it to a space of theirs, with their own key.',
      ),
      form(
        h(
          Form.Actions,
          null,
          c.listed
            ? press('unlist', 'Take it out')
            : press('list', 'List in the integration directory'),
        ),
      ),
    )
    : null
  // What is said about a service this space added, its owner's to change.
  let told = c.about
    ? h(
      More,
      null,
      h('summary', null, `Change what ${c.face.title} says`),
      form(
        h(
          More.Body,
          { as: Form },
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
              h(Field, {
                id: id(k),
                name: k,
                value: c.about![k] ?? '',
                placeholder: hint,
                ...k == 'site' && { type: 'url', pattern: 'https://.*' },
              }),
            )
          ),
          labeled(
            id('instructions'),
            'How to get the key',
            h(Field, {
              lines: true,
              id: id('instructions'),
              name: 'instructions',
              rows: 6,
              placeholder:
                'Where to sign up, which page gives the key, and what to paste',
              value: c.about.instructions ?? '',
            }),
            'Written for whoever connects it and the agent helping them, in markdown. Where its key may be sent stays as it is.',
          ),
          h(Form.Actions, null, press('about', 'Save', false)),
        ),
      ),
    )
    : null
  // Lending it to the copies people install of an app here: the calls a
  // month each copy may make, saved again to change it, and the button that
  // stops lending and takes every loan back. Only a shared sentinel the app
  // holds is lent, never the key itself.
  let lendable = c.status == 'connected' && !c.own && !c.each
  let lend = (a: Using) => {
    let field = `${id('lend')}-${a.app}`
    let stop = `${field}-stop`
    return [
      forApp(
        a,
        labeled(
          field,
          `Lend to copies of ${a.title}`,
          h(
            Form.Line,
            null,
            h(Field, {
              id: field,
              name: 'cap',
              type: 'number',
              min: 1,
              step: 1,
              inputmode: 'numeric',
              value: a.lends ?? 100,
              required: true,
            }),
            press('lend', a.lends == null ? 'Lend' : 'Save'),
            a.lends == null ? null : h(
              Button,
              { type: 'submit', form: stop, name: 'do', value: 'lend' },
              'Stop lending',
            ),
          ),
          'The calls a month each copy someone installs may make through it. A copy keeps its own data, never sees the key, and can connect its own instead.',
        ),
      ),
      a.lends == null ? null : forApp(a, null, { id: stop, hidden: true }),
    ]
  }
  let lent = lendable
    ? c.apps.filter((a) => a.borrower == null && !a.direct).map(lend)
    : []
  let folded = any(...lent, named, replace, reached, listing, told)
  return h(
    Card,
    { 'data-connection': c.eid },
    heading(c.face.title, { mark: logo(c.face), status: stands, actions }),
    about(c.face),
    notice,
    howTo(c.face, open && !ask),
    paste,
    apps,
    attach,
    folded
      ? h(
        More,
        null,
        h('summary', null, 'Advanced options'),
        h(More.Body, null, folded),
      )
      : null,
  )
}

// A connection an app here borrows from the space that lent it with the app,
// as a card: its head says whose it is, its row what the app has spent of the
// cap it was lent under and who may call out through it, which is this space's
// to say, and what replaces it is the space's own: a
// connection it holds already, a sign-in, or a key pasted under the fold.
let borrowing = (
  b: Borrowed,
  on: boolean,
  action: string,
  mine?: Shown,
) => {
  let form = (kids: Kids, connection = b.eid) =>
    h(
      'form',
      { method: 'post', action },
      held('connection', connection),
      held('app', b.app.app),
      kids,
    )
  let actions = mine
    ? form(press('attach', 'Use your own'), mine.eid)
    : on && !b.keyed
    ? form(press('own', 'Connect your own'))
    : null
  let id = `own-${b.eid}-${b.app.app}`
  let own = on && b.keyed && !mine
    ? h(
      More,
      null,
      h('summary', null, 'Use your own key'),
      h(
        More.Body,
        null,
        b.face.instructions ? raw(b.face.instructions) : null,
        form(
          keyBox(
            id,
            'Paste your key',
            press('own', 'Save key', false),
            reach(b.hosts),
            b.face.fields,
          ),
        ),
      ),
    )
    : null
  return h(
    Card,
    { 'data-borrowed': b.eid },
    heading(b.face.title, {
      mark: logo(b.face),
      status: status(`Borrowed from ${b.lender}`, 'positive'),
      actions,
    }),
    about(b.face),
    h(
      Card.Sub,
      null,
      `${b.app.title} calls out with ${b.lender}’s key until you use your own. The key stays hidden, and neither of you sees the other’s data.`,
    ),
    h(
      Rows,
      { as: 'ul' },
      h(
        Rows.Item,
        { as: 'li' },
        h(
          Rows.Main,
          null,
          h(Rows.Name, null, b.app.title),
          h(
            Rows.Meta,
            null,
            dotted([
              h('code', null, `env.${b.app.binding}`),
              callers(b.app),
              calls(b.app),
            ]),
          ),
        ),
        h(Rows.Actions, null, form(opening(b.app))),
      ),
    ),
    own,
  )
}

// The page: one space's connections — what its apps asked for, what is
// connected and what they borrow — then what it could connect next and a box
// for a key no app asked for yet. On the person's own space, what is theirs
// comes first: what they connected for apps that ask each person, and the
// services that hold a grant from them.
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
  let action = enabling(managePath('connections', at.space), c.enable)
  // A built service nothing here is connected to yet: a key to paste, or a
  // sign-in to start from its head.
  let offer = (i: Connections['built'][number]) =>
    h(
      Card,
      { as: 'form', method: 'post', action },
      held('integration', i.name),
      heading(i.face.title, {
        mark: logo(i.face),
        actions: i.keyed ? null : press('add', 'Connect', false),
      }),
      about(i.face),
      howTo(i.face, true),
      i.keyed
        ? keyBox(
          `add-${i.name}`,
          'Paste the key',
          press('add', 'Save key', false),
          '',
          i.face.fields,
        )
        : null,
    )
  let add = h(
    Card,
    { as: 'form', method: 'post', action },
    heading('Add a key'),
    h(
      Card.Sub,
      null,
      "For a service your apps call that isn't listed above. Services others have added are in the ",
      h('a', { href: url(env, INTEGRATIONS.path) }, 'integration directory'),
      '.',
    ),
    fieldsOf(
      labeled(
        'new-name',
        'Service',
        h(Field, {
          id: 'new-name',
          name: 'integration',
          maxlength: 60,
          placeholder: 'Weather API',
          required: true,
        }),
      ),
      labeled(
        'new-hosts',
        'Where it may be sent',
        h(Field, {
          id: 'new-hosts',
          name: 'hosts',
          autocomplete: 'off',
          spellcheck: 'false',
          placeholder: 'api.example.com',
          required: true,
        }),
        'yaks.app keeps the key and only ever sends it to these addresses.',
      ),
      labeled(
        'new-key',
        'Key',
        h(Field, {
          id: 'new-key',
          name: 'key',
          type: 'password',
          autocomplete: 'off',
          spellcheck: 'false',
          required: true,
        }),
      ),
      labeled(
        'new-instructions',
        optional('How to get the key'),
        h(Field, {
          lines: true,
          id: 'new-instructions',
          name: 'instructions',
          rows: 3,
          placeholder:
            'Where to sign up, which page gives the key, and what to paste',
        }),
      ),
      h(Form.Actions, null, press('add', 'Save key', false)),
    ),
  )
  // The service the page was opened to add comes first under its space.
  let group = (title: string, cards: Kids[], lead: Kids = null) =>
    lead || cards.length ? [h(Group, null, title), lead, cards] : null
  let yours = [
    ...first.filter((one) => one.own).map((one) =>
      connection(one, c.on, action)
    ),
    ...c.services.map((s) =>
      h(
        Card,
        null,
        heading(s.name, { status: status('Connected', 'positive') }),
        h(
          Card.Sub,
          null,
          `Signed in with your yaks.app account on ${
            day(new Date(s.connectedAt * 1000).toISOString())
          }.`,
        ),
      )
    ),
  ]
  // What the space holds already that could replace a loan: a connected
  // connection through the same service.
  let mine = (b: Borrowed) =>
    first.find((one) =>
      !one.own && one.integration == b.integration &&
      one.status == 'connected' && !one.failed && !one.each
    )
  let here = [
    ...first.filter((one) => !one.own).map((one) =>
      connection(one, c.on, action)
    ),
    ...c.borrowed.map((b) => borrowing(b, c.on, action, mine(b))),
    ...c.built.map(offer),
    ...c.on ? [add] : [],
  ]
  let asked = c.asked ? offer(c.asked) : null
  return [
    c.on ? null : h(
      Card,
      null,
      heading("Keys can't be saved here yet"),
      h(
        Card.Sub,
        null,
        'This server has nowhere safe to keep a key, so connecting is switched off.',
      ),
    ),
    c.list.length || c.services.length || c.borrowed.length ? null : empty(
      'No connections yet',
      h(
        'p',
        null,
        'When an app needs an outside service, like a calendar or an API key, it shows up here for you to connect.',
      ),
    ),
    yours.length
      ? [group('Yours', yours), group(spaceHost(env, at.space), here, asked)]
      : [asked, here],
  ]
}

// Inviting someone (apps.ts `saved`, which asks member_add): their address,
// the whole space or one app, what they may do there, and a note for the
// letter if the owner wants one.
let inviting = (at: DeskPage) => {
  let was = at.invite ?? { email: '', app: '', role: '', note: '' }
  return h(
    Card,
    null,
    heading('Invite someone'),
    h(
      Form,
      { method: 'post', action: managePath('people', at.space) },
      labeled(
        'invite-email',
        'Email address',
        h(Field, {
          id: 'invite-email',
          name: 'invite',
          type: 'email',
          required: true,
          autocomplete: 'off',
          spellcheck: 'false',
          placeholder: 'friend@example.com',
          value: was.email,
        }),
      ),
      labeled(
        'invite-app',
        'Invite them to',
        h(
          Field,
          { choose: true, id: 'invite-app', name: 'app' },
          option('', 'Every app here', !was.app),
          at.apps.map((a) =>
            option(a.slug, a.title || a.slug, was.app == a.slug)
          ),
        ),
        'Invited to one app, they can open that app and nothing else here.',
      ),
      labeled(
        'invite-role',
        'They can',
        h(
          Field,
          { choose: true, id: 'invite-role', name: 'role' },
          option('editor', 'Change things', was.role != 'viewer'),
          option('viewer', 'Only look', was.role == 'viewer'),
        ),
      ),
      labeled(
        'invite-note',
        optional('A note for the email'),
        h(Field, {
          lines: true,
          id: 'invite-note',
          name: 'note',
          rows: 2,
          maxlength: 500,
          value: was.note,
        }),
      ),
      h(Form.Actions, null, send('Send invitation')),
    ),
  )
}

// The Operators of other spaces working here (operator-reach.ts, T-136179):
// each with what it may do and a Remove, then the owner's other spaces whose
// Operator they may let in, as apps.ts `saved` takes it.
let operating = (at: DeskPage) => {
  let ins = at.operators ?? []
  let offered = (at.spaces ?? []).filter((s) =>
    s.slug != at.space && !ins.some((o) => o.slug == s.slug)
  )
  let action = managePath('people', at.space)
  let rows = ins.map((o) =>
    h(
      Rows.Item,
      { as: 'li' },
      h(
        'span',
        null,
        `${named(o)}'s Operator · ${
          o.role == 'viewer' ? 'only looks' : 'changes things'
        }`,
      ),
      h(
        Rows.Actions,
        null,
        h(
          'form',
          { method: 'post', action },
          held('unreach', o.eid),
          h(Button, {
            type: 'submit',
            'aria-label': `Remove ${named(o)}'s Operator`,
          }, 'Remove'),
        ),
      ),
    )
  )
  let form = offered.length
    ? h(
      Form,
      { method: 'post', action },
      labeled(
        'operator-space',
        "Let this space's Operator work here",
        h(
          Field,
          { choose: true, id: 'operator-space', name: 'operator' },
          offered.map((s, i) => option(s.slug, named(s), i == 0)),
        ),
        'Whoever may ask that Operator can have it work here.',
      ),
      labeled(
        'operator-role',
        'It can',
        h(
          Field,
          { choose: true, id: 'operator-role', name: 'role' },
          option('editor', 'Change things', true),
          option('viewer', 'Only look', false),
        ),
      ),
      h(Form.Actions, null, send('Let it in')),
    )
    : null
  return rows.length || form
    ? h(
      Card,
      null,
      heading('Operators from other spaces'),
      rows.length ? h(Rows, { as: 'ul' }, rows) : null,
      form,
    )
    : null
}

// Who is in the space and in each of its apps, and who has yet to accept
// (people.ts): the way to invite someone, then a list for the space and one
// for each app anybody is a guest of or invited to, each row drawn by its
// renderer (render/held.ts) beside what the owner may do to it (apps.ts
// `saved`): send an invitation's letter again, and take anyone but an owner
// off, which for an invitation withdraws it (member_remove).
export let people = (at: DeskPage) => {
  let r = at.people
  if (!r) return null
  let act = (fields: Kids, label: string, aria: string) =>
    h(
      'form',
      { method: 'post', action: managePath('people', at.space) },
      fields,
      h(Button, { type: 'submit', 'aria-label': aria }, label),
    )
  let actions = (p: Person, app?: string) => {
    let them = p.email ?? p.name
    let waits = p.held == 'invite'
    let again = waits
      ? act(
        held('again', p.eid),
        'Send again',
        `Send the invitation to ${them} again`,
      )
      : null
    let off = p.email && (p.held != 'seat' || p.role != 'owner')
      ? act(
        [held('remove', p.email), held('app', app)],
        waits ? 'Withdraw' : 'Remove',
        waits ? `Withdraw the invitation to ${them}` : `Remove ${them}`,
      )
      : null
    return again || off ? h(Rows.Actions, null, again, off) : null
  }
  let list = (title: string, all: Person[], app?: string) =>
    all.length
      ? h(
        Card,
        null,
        heading(title),
        h(
          Rows,
          { as: 'ul' },
          all.map((p) =>
            h(Rows.Item, { as: 'li' }, holder(p), actions(p, app))
          ),
        ),
      )
      : null
  return [
    inviting(at),
    list('Members · every app', [...r.members, ...r.invited]),
    operating(at),
    r.apps.map((a) =>
      list(
        `${a.app.title} · this app only`,
        [...a.guests, ...a.invited],
        a.app.slug,
      )
    ),
  ]
}

// The dashboard's page for one space, at the apex (apps.ts `manage`). What
// it aims at the space itself — an app, the drop zone, the builder — it names
// by the space's own address.
export let desk = (at: DeskPage, env: Host = {}) => {
  let view = at.view ?? 'apps'
  let site = `https://${spaceHost(env, at.space)}`
  let titles = {
    profile: 'Profile',
    invite: 'Invite a friend',
    agents: 'Agents',
    shared: 'Shared with you',
    space: 'New space',
    operator: yourOperator(at).title,
    updates: 'Updates',
    apps: 'Apps',
    people: 'People',
    connections: 'Linked accounts',
    new: 'New app',
    visits: 'Visits',
    selling: 'Selling',
    settings: 'Space settings',
    billing: 'Billing',
    trash: 'Trash',
  } satisfies Record<ManageView, string>
  // The line over the title names whose the page is: the person's own, or
  // the space it changes.
  let whose = accountView(view) ? 'Your account' : named(picked(at))
  let body: Kids = null
  if (view == 'profile') body = profile(at, env)
  if (view == 'invite' && at.referral) {
    let own = at.spaces?.find((s) => s.own)
    body = invitation(at.referral, own ? named(own) : 'your space', env)
  }
  if (view == 'shared') body = sharedWith(at, env)
  if (view == 'space') body = newSpace(at, env)
  if (view == 'apps') body = library(at, env)
  if (view == 'agents') {
    body = [
      agentSetup(at.agents ?? [], env, managePath('agents')),
      copying(),
      tabbing(),
    ]
  }
  if (view == 'new') {
    body = [
      h(
        Card,
        { class: 'Desk_Start', ...state(true, !!at.agents?.length) },
        heading('Ask your agent for a new yaks app'),
        agentList(at.agents ?? [], 'links'),
        h(Form.Field, null, h(Form.Label, { as: 'p' }, 'Try this'), firstAsk()),
      ),
      connectCard(at, env),
      h(
        'div',
        { class: 'Desk_Options' },
        chat(env, `${site}/api/build`),
        h(
          Card,
          null,
          heading('Upload your website'),
          dropZone(undefined, `${site}/deploy`),
        ),
      ),
      chatLive('/build.js'),
      dropping(),
    ]
  }
  if (view == 'visits') {
    body = at.apps.length
      ? visited(at.views ?? null, at.viewsOff ?? '', site)
      : empty(
        'No visits yet',
        h('p', null, 'Your app visits will appear here once you have an app.'),
      )
  }
  if (view == 'selling') body = selling(at, env)
  if (view == 'settings') body = preferences(at, env)
  if (view == 'billing') {
    body = [
      plan(
        {
          slug: at.space,
          title: named(picked(at)),
          plan: at.plan ?? { tier: 'free', ends: '', known: false },
          paid: at.paid,
          provider: at.provider,
          payer: at.bill?.payer,
        },
        env,
        managePath('billing', at.space),
      ),
      at.bill ? allowances(at.bill, env, at.space) : null,
      billing(),
    ]
  }
  if (view == 'trash') body = trash(at)
  if (view == 'connections') body = connections(at, env)
  if (view == 'people') body = people(at)
  // The Operator's page is drawn by operator-page.ts, as markup.
  if (view == 'operator') body = at.operator ? raw(at.operator) : null
  return page(
    env,
    {
      title: `${titles[view]} · ${whose}`,
      status: at.no ? 400 : 200,
      headers: {
        'cache-control': 'private, no-store',
        'x-robots-tag': 'noindex',
      },
      layout: 'Desk',
    },
    deskFrame({
      ...navigation(at, view, env),
      where: [h('b', null, titles[view]), h('small', null, whose)],
      head: [
        h(
          'div',
          null,
          h('p', { class: 'Desk_Whose' }, whose),
          h('h1', null, titles[view]),
          view == 'visits'
            ? h('p', { class: 'Desk_Period' }, `Last ${at.viewDays ?? 30} days`)
            : null,
        ),
        view == 'apps'
          ? h(
            Button,
            { mod: 'go', href: managePath('new', at.space) },
            '+ New app',
          )
          : null,
      ],
      content: [said(at.say, at.no), body],
    }),
    ['apps', 'new'].includes(view) ? copying() : null,
    ['apps', 'new', 'agents'].includes(view)
      ? agentLive('/oauth/agents')
      : null,
  )
}

/** The data editor's page (public/data.js draws what is in it): what an
 * app's words keep (data.ts `kinds`) and the files it takes, handed to the
 * script as data. */
export let editor = (
  env: Host,
  at: { app: string; at: string; words: VocabDoc; version: string },
) =>
  page(
    env,
    {
      title: `Data · ${at.app}`,
      headers: {
        'cache-control': 'private, no-store',
        'x-robots-tag': 'noindex',
      },
      layout: 'Data',
    },
    h(
      'header',
      { class: 'Desk_Head' },
      h(
        'div',
        null,
        h('a', { class: 'Desk_Address', href: `${at.at}/` }, `${at.app} ↗`),
        h('h1', null, 'Data'),
      ),
    ),
    h(
      'div',
      { id: 'data' },
      h(
        'noscript',
        null,
        h(Notice, { mod: 'negative' }, 'This page needs JavaScript.'),
      ),
    ),
    h('script', {
      type: 'module',
      dangerouslySetInnerHTML: {
        __html: `
import { open } from ${script(`${at.at}/_web/data.js?v=${at.version}`)}
import * as client from ${script(`${at.at}/api/client.js`)}
await open({
  root: document.getElementById('data'),
  client,
  view: window,
  files: ${script(`${at.at}/api/blob/`)},
  kinds: ${script(kinds(at.words.$defs))},
  accepts: ${
          script(
            [(at.words.blob as Accepts | undefined)?.contentMediaType ?? []]
              .flat().join(',') || null,
          )
        },
})
`,
      },
    }),
  )

export let spaceIndex = (at: SpacePage, env: Host = {}) => {
  let mine = at.apps.length
    ? h(
      Chips,
      { as: 'nav', 'aria-label': 'Apps here' },
      at.apps.map((a) =>
        h(
          Chip,
          { href: `/${a.slug}/` },
          a.title || a.slug,
          a.gallery ? h(Chip.Tag, null, a.gallery) : null,
        )
      ),
    )
    : null
  let ask = at.hidden
    ? h(
      'p',
      { class: 'Note' },
      `${
        at.hidden == 1 ? 'One app here is' : `${at.hidden} apps here are`
      } private. Ask whoever runs this space to let you in.`,
    )
    : null
  let pitch = at.manage
    ? h(
      'p',
      null,
      h(Button, { mod: 'go', href: at.manage }, 'Manage your apps'),
    )
    : at.person
    ? home(env)
    : [
      h('p', null, h(Button, { mod: 'go', href: at.signIn }, 'Sign in')),
      h(
        Card,
        null,
        heading('What is yaks.app?'),
        h(
          Card.Sub,
          null,
          'Ask an assistant like Claude or ChatGPT for an app, and it builds one here — a page of your own you can send to anyone.',
        ),
        h('p', null, h('a', { href: url(env, '/') }, 'Make one of your own')),
      ),
    ]
  return page(
    env,
    {
      title: at.title || at.space,
      lead: at.apps.length
        ? 'Here is what you can open.'
        : 'Nothing here is open to visitors yet.',
    },
    mine,
    ask,
    pitch,
  )
}

export let oops = (env: Host = {}, requestId?: string) =>
  page(env, {
    title: 'Something went wrong.',
    lead:
      'Try again shortly. If the problem continues, ask your assistant to check the app.' +
      (requestId ? ` Request ID: ${requestId}.` : ''),
    status: 500,
    headers: requestId ? { 'x-request-id': requestId } : {},
  }, home(env))

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
  page(
    env,
    {
      title: stage == 'error'
        ? 'This domain needs a fix'
        : 'Setting up this domain',
      lead: stage == 'error'
        ? `${host} needs attention before it can serve — here is what ` +
          'Cloudflare says.'
        : `${host} is being connected to yaks.app. This is usually a ` +
          'matter of minutes, not hours.',
      status: 503,
      headers: { 'retry-after': '30' },
    },
    h(Card, null, heading(host), h('pre', null, said)),
    home(env),
  )

// A door a later leaf fills (the connector): plain, not a mystery.
export let soon = (what: string, env: Host = {}) =>
  page(env, {
    title: `${what} is not available yet.`,
    lead: 'This feature is still being built.',
    status: 404,
  }, home(env))

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
let carried = (q: string | null, back?: string | null) => [
  held('q', q),
  held('return', back),
  back &&
    ['/connect', '/manage/connect', managePath('agents')].includes(
      pathOf(back),
    )
    ? run(
      'if (location.hash) document.currentScript.previousElementSibling.value += location.hash',
    )
    : null,
]

// The sign-in card's first line. When `back` is a page on a space, it names
// that address: somebody who tapped "sign in" on a friend's app reads where
// they are going, not a pitch for building apps. Only a host under the apex is
// named; any other address is the door's to judge, and the card says nothing.
let welcome = (back: string | null, env: Host) => {
  let to = back && URL.canParse(back) ? new URL(back) : null
  return to?.hostname.endsWith(`.${apex(env)}`)
    ? `Sign in to continue to ${to.hostname + to.pathname.replace(/\/$/, '')}.`
    : 'Build an app by asking Claude or ChatGPT.'
}

// One button that sends the form it is in.
let send = (label: Kids) => h(Button, { mod: 'go', type: 'submit' }, label)

// Ask for an address. `who` names the app asking, when one is (the OAuth
// consent page is this page — signing in is the consent), and `why` is the
// soft refusal, when there was one: a sign-in link that had already been used
// lands here, carrying whatever it was going to finish (identity.ts, T-34351).
//
// `texts` is whether a code can go by text (identity.ts `textable`): then the
// one box takes an email address or a US mobile number (T-136826), and what
// giving a number agrees to sits under it, where it is read before sending.
// The note stands aside once the box holds an address, so a person typing
// their email reads nothing about texts; without script it stays.
export let askEmail = (at: {
  q?: string | null
  back?: string | null
  who?: string
  why?: string
  status?: number
  texts?: boolean
}, env: Host = {}) =>
  page(
    env,
    {
      title: 'Sign in or sign up',
      lead: at.why ?? welcome(at.back ?? null, env),
      status: at.status ?? 200,
    },
    h(
      'form',
      { method: 'post', action: '/login' },
      carried(at.q ?? null, at.back),
      h(
        'p',
        null,
        at.who ? `${at.who} would like to use your apps. ` : '',
        `Enter your ${
          at.texts ? 'email or mobile number' : 'email'
        } to get a sign-in code.`,
      ),
      at.texts
        ? [
          h(Field, {
            name: 'address',
            type: 'text',
            required: true,
            autofocus: true,
            autocomplete: 'email',
            autocapitalize: 'off',
            spellcheck: 'false',
            placeholder: 'you@example.com or 269-555-0142',
            'aria-label': 'Your email or mobile number',
            'aria-describedby': 'by-text',
          }),
          h(
            'p',
            { class: 'Note', id: 'by-text' },
            `${CODE_NOTE} Terms: `,
            h('a', { href: url(env, '/terms') }, 'yaks.app/terms'),
            ' Privacy: ',
            h('a', { href: url(env, '/privacy') }, 'yaks.app/privacy'),
          ),
          run(
            "{let n=document.currentScript.previousElementSibling,f=n.previousElementSibling,s=()=>n.hidden=f.value.includes('@');f.addEventListener('input',s);s()}",
          ),
        ]
        : h(Field, {
          name: 'address',
          type: 'email',
          required: true,
          autofocus: true,
          autocomplete: 'email',
          placeholder: 'you@example.com',
          'aria-label': 'Your email',
        }),
      send('Send me a code'),
    ),
    home(env),
  )

// Ask for the code just sent, and nothing else (T-34236). Signing up is two
// steps and both are the address: give it, then prove it. What a person is
// called and where their apps live are theirs to set on their own space page,
// once they are standing on it — a question in front of the door is a step
// somebody has to get past to see anything at all. `why` is the soft refusal,
// when there was one. A code that expired while they looked for the letter, or
// one that never came, is answered by a second door to the same address: the
// first step again, without typing it again. A number was texted, and the
// card says so.
export let askCode = (at: {
  address: string
  q?: string | null
  back?: string | null
  why?: string
  status?: number
}, env: Host = {}) => {
  let { address } = at
  let q = at.q ?? null, back = at.back ?? null
  let text = texted(address)
  return page(
    env,
    {
      title: text ? 'Check your texts' : 'Check your email',
      lead: at.why ??
        `We ${text ? 'texted' : 'sent'} a six-digit code to ${
          text ? shown(address) : address
        }. It lasts ten minutes.`,
      status: at.status ?? 200,
    },
    h(
      'form',
      { method: 'post', action: '/login/code' },
      carried(q, back),
      h(
        'p',
        null,
        q
          ? 'Enter it to finish connecting your assistant.'
          : back
          ? 'Enter it to sign in and continue.'
          : 'Enter it to land on your own space.',
      ),
      held('address', address),
      h(Field, {
        class: 'Code',
        name: 'code',
        inputmode: 'numeric',
        pattern: '[0-9]{6}',
        maxlength: 6,
        required: true,
        autofocus: true,
        autocomplete: 'one-time-code',
        'aria-label': 'Your six-digit code',
      }),
      send('Sign in'),
    ),
    h(
      'form',
      { class: 'Again', method: 'post', action: '/login' },
      carried(q, back),
      held('address', address),
      h(Button, { type: 'submit' }, 'Send a new code'),
    ),
    home(env),
  )
}

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
}, env: Host = {}) => {
  let host = spaceHost(env, at.slug)
  return page(
    env,
    {
      title: `Delete ${host}?`,
      lead: at.stop ?? at.why ??
        (at.forever
          ? 'This cannot be undone, and nothing is kept.'
          : 'It goes to the trash for 30 days. Nothing is erased, and you ' +
            'can bring it back any time before then.'),
      status: at.status ?? 200,
    },
    at.lines.length
      ? h(
        Card,
        null,
        heading(
          at.forever
            ? 'What goes, for good'
            : 'What stops until you restore it',
        ),
        h('ol', null, at.lines.map((l) => h('li', null, l))),
      )
      : null,
    at.stop ? null : [
      h(
        'form',
        { method: 'post', action: `/space/${at.slug}/delete` },
        held('t', at.token),
        at.token ? null : [
          h(
            Form.Label,
            { for: 'confirm' },
            'Type ',
            h('b', null, at.slug),
            ' to confirm',
          ),
          h(Field, {
            id: 'confirm',
            name: 'confirm',
            autocomplete: 'off',
            spellcheck: 'false',
            autofocus: true,
          }),
        ],
        send(
          at.forever ? `Delete ${host} forever` : `Put ${host} in the trash`,
        ),
      ),
      h(
        'p',
        { class: 'Note' },
        'Changed your mind? Close this page — nothing has happened.',
      ),
    ],
    home(env),
  )
}

// And after: what went, and the one thing worth knowing next — the address
// belongs to nobody now, theirs to take again or somebody else's to take
// later. A space that went to the trash has the opposite next thing: the
// address is still theirs, and so is everything under it.
export let deleted = (said: string, forever = true, env: Host = {}) =>
  page(
    env,
    { title: "That's done.", lead: said },
    h(
      'p',
      { class: 'Note' },
      forever
        ? 'The address is free again. Ask your assistant for a new space whenever you want one.'
        : 'Nothing was erased. The address is held for you, and restoring it puts everything back exactly as it was.',
    ),
    home(env),
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
  let what = o.app ? o.app.title || o.app.slug : `${o.space.title} at ${host}`
  return page(
    env,
    {
      title: 'You have an invitation',
      lead: `${o.by || 'Someone'} invited you to ${
        o.see ? 'see' : 'use'
      } ${what}.`,
    },
    o.app
      ? h(
        'div',
        { class: 'Apps Apps-one' },
        tile(o.app, {
          at: `https://${host}`,
          host,
          icon: o.app.open ? undefined : url(env, '/connector-512.png'),
        }),
      )
      : null,
    h(
      'form',
      { method: 'post', action: '/login' },
      held('address', o.email),
      held('return', o.back),
      h(
        'p',
        null,
        `It was sent to ${o.email}. Sign in with that address to accept it.`,
      ),
      send('Email me a sign-in code'),
    ),
    home(env),
  )
}

// A private app opened by someone invited to it who has not accepted yet: the
// click in the letter is what is left, and no page of the app may make it for
// them (invite.ts). Its title is theirs to read; the letter named it.
export let invitedTo = (title: string, env: Host = {}) =>
  page(env, {
    title: 'Your invitation is waiting',
    lead:
      `Accept the invitation to ${title} from the letter yaks.app sent you, then open this link again.`,
    status: 403,
  }, home(env))

// A private app opened by somebody its own data lists (join.ts): one press
// and they are in, at the role the app says. The form posts to the app's own
// join door, which asks the rows again rather than trusting this page.
export let joinable = (
  at: { title: string; role: Role; action: string },
  env: Host = {},
) =>
  page(
    env,
    {
      title: `Join ${at.title}`,
      lead: `You are listed in ${at.title}. Join to ${
        at.role == 'viewer' ? 'see' : 'use'
      } it.`,
      status: 403,
    },
    h('form', { method: 'post', action: at.action }, send('Join')),
    home(env),
  )

// An invitation that is no longer open: withdrawn, or for a space or an app
// that is gone. Which one is nobody's business but the inviter's.
export let closed = (env: Host = {}) =>
  page(env, {
    title: 'This invitation is no longer open.',
    lead: 'Ask whoever invited you to send a new one.',
    status: 410,
  }, home(env))

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
  page(
    env,
    {
      title: `Connect ${at.face.title}`,
      lead:
        `${at.app} asks each person who uses it to connect their own ${at.face.title} account. Yours is used only when you use the app, and you can disconnect it from your own connections page.`,
    },
    h(
      Card,
      null,
      heading(at.face.title, {
        mark: logo(at.face),
        status: at.status == 'needed'
          ? null
          : at.status == 'broken'
          ? status('Yours needs reconnecting', 'negative')
          : status('Yours is connected', 'positive'),
        actions: at.on && !at.keyed
          ? h(
            'form',
            { method: 'post' },
            send(at.status == 'needed' ? 'Connect' : 'Connect again'),
          )
          : null,
      }),
      about(at.face),
      howTo(at.face, at.status != 'connected'),
      said(at.say, at.no),
      !at.on ? h(Card.Sub, null, "Keys can't be saved here yet.") : at.keyed
        ? h(
          'form',
          { method: 'post' },
          keyBox('key', 'Paste your key', send('Save key'), '', at.face.fields),
        )
        : null,
    ),
    h('p', { class: 'Note' }, h('a', { href: at.back }, `Back to ${at.app}`)),
  )

// What a press answered, said back on the page it drew again.
let said = (say?: string, no?: boolean) =>
  say ? h(Notice, { mod: no && 'negative', role: 'status' }, say) : null

// A one-click link, opened (identity.ts LINK). Opening it spends nothing: a
// messaging app or mail scanner that fetches the address to draw a preview
// would otherwise sign itself in and leave the person a dead link. The button
// carries the pass on, and pressing it is what spends the code.
export let askLink = (t: string, env: Host = {}) =>
  page(
    env,
    {
      title: 'Sign in to yaks.app',
      lead: 'This link signs you in once, for ten minutes.',
      headers: {
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
      },
    },
    h(
      'form',
      { method: 'post', action: '/login/link' },
      held('t', t),
      send('Sign in'),
    ),
    home(env),
  )

// A custom domain asking to sign in: consent names its host and its space.
export let askHandoff = (
  host: string,
  back: string,
  consent: string,
  env: Host = {},
) =>
  page(
    env,
    {
      title: `Sign in to ${host}`,
      lead: 'This signs you in to this space only.',
      headers: {
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
      },
    },
    h(
      'form',
      { method: 'post', action: '/login/handoff' },
      held('return', back),
      held('consent', consent),
      send(`Continue to ${host}`),
    ),
    home(env),
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
  page(
    env,
    {
      title: 'Allow access to your apps on yaks.app',
      lead: `${who} would like to use your apps on yaks.app as ${email}.`,
    },
    h(
      'form',
      { method: 'post', action: '/oauth/allow' },
      carried(q),
      held('consent', consent),
      send('Allow'),
    ),
    home(env),
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
  // What this space pays (billing.ts `Card`, T-33125). This is the surface
  // that starts a purchase, and it is signed-in web only: the agent surface
  // may name the pricing page and nothing else (C-33033).
  plan: Billed
  // The name of the payment provider that bills it (payments.ts), as the
  // plan card says it.
  provider?: string
  // `?paid=1` on the way back from the provider's checkout. The webhook is what actually moves
  // the tier and it may not have landed yet, so the line says "in a moment"
  // rather than claiming something this request cannot see.
  paid?: boolean
}

// A space's address, its name typed in the box and the apex after it.
let addressBox = (
  id: string,
  name: string,
  value: string,
  env: Host,
  more = {},
) =>
  h(
    At,
    null,
    h(Field, {
      id,
      name,
      maxlength: 63,
      autocomplete: 'off',
      spellcheck: 'false',
      ...more,
      value,
    }),
    h(At.End, null, `.${apex(env)}`),
  )

// The address card, for a person who is signed in. The form posts, so it
// works with no script at all; the script below turns that into an inline
// answer, which is what a person choosing a name expects.
let mine = (y: Yours, env: Host) =>
  h(
    Card,
    null,
    heading('Where your apps live'),
    h(
      'p',
      { class: 'Now' },
      'Your apps live at ',
      h('b', null, spaceHost(env, y.slug)),
      '.',
    ),
    h(
      Form,
      { class: 'Addr', method: 'post', action: '/connect' },
      labeled(
        'your-space',
        'Your address',
        h(
          Form.Line,
          null,
          addressBox('your-space', 'space', y.said ?? y.slug, env),
          send('Save'),
        ),
        MOVES,
      ),
      h(Notice, { mod: y.no && 'negative', role: 'status' }, y.say ?? ''),
    ),
  )

// What changing an address does, said on both cards that change it: the
// apps go along, and the old address redirects only until somebody else takes
// the name, which is free the moment it is left (D-131924).
let MOVES = 'You can change it at any time. Every app moves with it, and ' +
  'the old address sends people to the new one until someone else takes ' +
  'that name.'

// The plan card, for a person who is signed in (T-33125). One card: the paid
// plans when they are free, manage-billing when they are paying. Each button
// POSTs to billing.ts and follows the URL the payment provider answers, so no
// provider's address is written into this page and nothing here knows a key. The Organization
// plan (D-134567) is offered only where its prices exist (billing.ts `Card`).
//
// A day, not a timestamp: "runs until 14 October 2026" is what somebody wants
// to know, and the hour is noise on a monthly bill.
let plan = (
  y: Pick<Yours, 'slug' | 'plan' | 'paid' | 'provider'> & {
    title?: string
    payer?: Payer | null
  },
  env: Host,
  target?: string,
) => {
  let { tier } = y.plan
  let ends = y.plan.ends ? day(y.plan.ends) : ''
  let limits = ceilings(tier)!
  let allowance = `${
    limits.apps == null ? 'Unlimited apps' : `${limits.apps} apps`
  }, unlimited visitors, ${size(limits.bytes)} of app data${
    tier == 'organization' ? `, AI use included, and email support` : ''
  }`
  let host = spaceHost(env, y.slug)
  let head = tier == 'free'
    ? h(
      'p',
      null,
      `${host} is on the `,
      h('b', null, 'free'),
      ` plan — ${allowance}. `,
      h('a', { href: url(env, '/pricing') }, 'Compare plans'),
      '.',
    )
    : h(
      'p',
      null,
      `${host} is on `,
      h('b', null, NAMES[tier]),
      ` — ${allowance}.`,
      ends ? ` It runs until ${ends} and then stops renewing.` : '',
      y.plan.free
        ? ` It’s free through ${day(y.plan.free)}: a month for each person ` +
          'you invited who built their first app. Subscribe now to keep it ' +
          'after that; nothing is charged before then.'
        : '',
    )
  // The button names the space it buys for: a plan is a space's, never the
  // person's (D-131886), and someone with two spaces pays for the one named.
  let space = y.title || host
  let buy = (want: Want) =>
    billButton(
      'checkout',
      `${y.plan.free && want.tier == 'plus' ? 'Keep' : 'Get'} ${
        NAMES[want.tier]
      } for ${space} — ${priced(want)}`,
      target,
      want,
    )
  // Someone the provider has met can always reach their own billing, whatever plan
  // they are on today: an invoice from a month they paid for is theirs to
  // read after they cancel.
  let doors = [
    ...(tier == 'free' || y.plan.free
      ? [
        buy({ tier: 'plus', per: 'month' }),
        ...(y.plan.organization ?? []).map((per) =>
          buy({ tier: 'organization', per })
        ),
      ]
      : []),
    y.plan.known ? billButton('portal', 'Manage billing', target) : null,
  ].filter(Boolean)
  // Where the Organization plan has no price yet, a free space still hears
  // how to get it: the pricing page offers it everywhere.
  let ask = tier == 'free' && !y.plan.organization?.length
    ? h(
      Form.Hint,
      null,
      'The Organization plan is not on sale here yet. Email ',
      h('a', { href: 'mailto:hello@yaks.app' }, 'hello@yaks.app'),
      ' to start on it.',
    )
    : null
  return h(
    Card,
    { class: 'Bill', id: 'plan' },
    heading('Plan', {
      status: tier == 'free'
        ? status('Free')
        : status(tier == 'plus' ? 'Plus' : 'Organization', 'positive'),
      actions: doors.length ? doors : null,
    }),
    head,
    billedLine(y.plan, y.payer, y.provider),
    ask,
    y.paid
      ? h(
        Notice,
        null,
        'Thanks — that went through. Your space moves to its new plan in a moment.',
      )
      : null,
    h(Notice, { class: 'Bill_Say', role: 'status' }),
  )
}

// Whom the plan is billed to, where the payment provider has met the space:
// the address its receipts go to, or, when the provider couldn't be asked just
// now (`undefined`), only that it bills the space. A space the provider never
// met is billed to nobody. A page not told the provider's name leaves it out.
let billedLine = (card: Billed, payer?: Payer | null, provider?: string) => {
  if (!card.known) {
    return card.tier == 'free' ? h(Form.Hint, null, 'Nothing is billed.') : null
  }
  let through = provider ? ` through ${provider}` : ''
  return payer?.email
    ? h(
      'p',
      null,
      'Billed to ',
      h('b', null, payer.email),
      payer.name ? ` (${payer.name})` : '',
      `${through}. Manage billing changes the card, the address and who receives the receipts.`,
    )
    : h(
      'p',
      null,
      `Billed${through}. Manage billing shows the card and the receipts.`,
    )
}

// Each allowance as the Billing page names it, how its figures read, and what
// a person needs to know about counting it.
let ALLOWANCES: [Ceiling, string, (n: number) => string, string][] = [
  ['apps', 'Apps', count, ''],
  [
    'requests',
    'Request units',
    count,
    'Visitors are always served, past it too.',
  ],
  ['bytes', 'App data', size, ''],
  ['files', 'Photos and files', size, ''],
  ['emails', 'Emails', count, 'Sent and received.'],
  [
    'builds',
    'Built-in builds',
    count,
    'Building with your own agent isn’t counted.',
  ],
  ['seconds', 'Build seconds', count, 'The sandbox, and compiling at deploy.'],
]

// One allowance as a row: its name, how much of it is used, and, from four
// fifths of it, how it stands.
let gaugeRow = (name: string, figure: string, hint: string, share: number) =>
  h(
    Rows.Item,
    { as: 'li' },
    h(
      Rows.Main,
      null,
      h(Rows.Name, { as: 'span' }, name),
      h(Rows.Meta, null, figure, hint ? ` · ${hint}` : ''),
    ),
    share >= 1
      ? status('At the limit', 'negative')
      : share >= WARN
      ? status('Near the limit', 'negative')
      : null,
  )

/** The Billing page's month (T-131895): every allowance the space answers to
 * and how much of it is used, with its budget for models and voice. */
let allowances = (
  bill: NonNullable<DeskPage['bill']>,
  env: Host,
  slug: string,
) => {
  let rows = ALLOWANCES.filter(([what]) => bill.limits[what])
    .map(([what, name, read, hint]) => {
      let g = bill.limits[what]!
      // Request units are read by the hourly sweep, so before its first
      // reading of the month there is no figure, and zero would be a claim.
      let figure = what == 'requests' && !bill.read
        ? `None counted yet this month, of ${read(g.limit)}`
        : `${read(g.used)} of ${read(g.limit)}`
      return gaugeRow(name, figure, hint, g.used / g.limit)
    })
  let { spent, limit } = bill.budget
  let read = bill.read ? `, last read at ${bill.read.slice(11, 16)} UTC` : ''
  return h(
    Card,
    null,
    heading('This month'),
    h(
      Card.Sub,
      null,
      `What ${
        spaceHost(env, slug)
      } has used since the 1st, counted hourly${read}. Each starts again on the 1st, except what the space holds.`,
    ),
    h(
      Rows,
      { as: 'ul' },
      rows,
      gaugeRow(
        'Models and voice',
        `${share(spent, limit)} used`,
        'The builder’s and your apps’ models and voices, from this space’s budget.',
        limit ? spent / limit : 0,
      ),
    ),
  )
}

// A paid plan as it is said: "the Plus plan", never bare "Plus" (M-37846).
let NAMES = { plus: 'the Plus plan', organization: 'the Organization plan' }

// Connector forms do not ask the same questions. Keep each answer beside the
// provider step that asks for it, so a person never has to work out whether a
// field belongs to the form they are looking at.
let field = (label: string, value: Kids, what?: string) =>
  h(
    'div',
    null,
    h('dt', null, label),
    what == null ? value : h('dd', null, copyable(value, what)),
  )

let fields = (...rows: Kids[]) => h('dl', { class: 'Fields' }, rows)

let chatgptFields = (env: Host) =>
  fields(
    field('Name', CONNECTOR.title, 'the name'),
    field('Description', CONNECTOR.description, 'the description'),
    field(
      'Icon',
      h(
        'dd',
        { class: 'Connect_Icon' },
        h(
          'a',
          {
            href: url(env, '/yaks-app.png'),
            download: 'yaks-app.png',
            'aria-label': 'Download the yaks.app icon',
          },
          h('img', {
            src: url(env, '/yaks-app.png'),
            width: 56,
            height: 56,
            alt: 'The yaks.app icon',
          }),
        ),
        h(
          'a',
          { href: url(env, '/yaks-app.png'), download: 'yaks-app.png' },
          'Download icon',
        ),
      ),
    ),
  )

let external = (href: string, label: string) =>
  h('a', { href, target: '_blank', rel: 'noopener' }, label)

let b = (words: string) => h('b', null, words)
let code = (words: string) => h('code', null, words)

// What a person asks for their first app. The assistant already knows them,
// so the ask hands it their own situation rather than a scenario we made up
// for them (the app-ideas prompt's own question, prompts/app-ideas.md).
let firstAsk = () =>
  copyable(
    "Any yaks.app ideas you think I'd like, based on our chat history?",
    'the first app request',
  )

// An address on this platform, written out for somebody to type or paste.
let at = (path: string, env: Host) => code(url(env, path))

// What to write in an OAuth box, for the forms that have boxes (T-34414).
// Every value is the authorization server's own — route.ts `OAUTH` is what
// identity.ts configures the provider with and what both `/.well-known`
// documents serve — so this page cannot come to teach an address the door
// does not answer.
let oauthHelp = (env: Host) => [
  'For clients that need manual setup: Leave ',
  b('OAuth Client ID'),
  ' and ',
  b('OAuth Client Secret'),
  ' empty. ',
  b('Authorization URL'),
  ' ',
  at(OAUTH.authorize, env),
  ', ',
  b('Token URL'),
  ' ',
  at(OAUTH.token, env),
  ', ',
  b('Registration URL'),
  ' ',
  at(OAUTH.register, env),
  ', ',
  b('Scope'),
  ' ',
  code(OAUTH.scope),
  '.',
]

// This repository is itself a plugin marketplace (T-34666): `.agents/plugins/
// marketplace.json` offers `plugins/yaks.app/`, whose `.mcp.json` names the
// same MCP address every other door on this page hands out. So the shorthand
// is a third route to the same server, not a different product.
let REPO = 'yak-sh/yak'

// Claude's Add custom connector dialog, opened with the name and URL filled in
// (claude.com/docs/connectors/building/directory-vs-custom).
export let claudeAdd = (env: Host) =>
  'https://claude.ai/customize/connectors?modal=add-custom-connector' +
  `&connectorName=${encodeURIComponent(CONNECTOR.title)}` +
  `&connectorUrl=${encodeURIComponent(url(env, '/mcp'))}`

// One client's way to connect: its steps (or, where it has more than one
// interface, its paths of steps), what to know before and after, and the
// chat to open once it is done.
type Client = {
  key: string
  tab: string
  title: string
  intro?: Kids
  paths?: { title: string; steps: Kids[] }[]
  steps?: Kids[]
  note?: Kids
  details?: { summary: string; text: Kids }
  finish: Kids
}

// Keep setup paths and field labels matched to each client's form, including
// differences between its desktop and mobile interfaces.
let clients = (env: Host): Client[] => [
  {
    key: 'claude',
    tab: 'Claude',
    title: 'Claude',
    paths: [
      {
        title: 'Web + Desktop',
        steps: [
          [
            'Open ',
            external(claudeAdd(env), 'Customize → Connectors → Add'),
            '.',
          ],
          [
            'Check it has these values:',
            fields(
              field('Name', CONNECTOR.title, 'the name'),
              field(
                'Remote MCP server URL',
                url(env, '/mcp'),
                'the connection URL',
              ),
            ),
          ],
          ['Click ', b('Continue'), '.'],
        ],
      },
      {
        title: 'Mobile App',
        steps: [
          [
            'Claude’s help pages only describe adding a connector on ' +
            'claude.ai or the desktop app, so add yaks.app there first, ' +
            'using the ',
            b('Web + Desktop'),
            ' steps.',
          ],
          [
            'Then open the Claude app on your phone. Your connector works ' +
            'there too: in a chat, tap ',
            b('+'),
            ' in the message box, then ',
            b('Connectors'),
            ', and make sure yaks.app is switched on.',
          ],
        ],
      },
    ],
    // Claude's own limits on custom connectors, from its documentation
    // (claude.com/docs/connectors/custom/remote-mcp): the two that stop
    // somebody partway through these steps.
    note: [
      'Claude’s free plan allows one custom connector. On a Team or ' +
      'Enterprise plan, an owner adds it under ',
      b('Organization settings'),
      ' → ',
      b('Connectors'),
      ', and then you press ',
      b('Connect'),
      ' beside it in ',
      b('Customize'),
      ' → ',
      b('Connectors'),
      '.',
    ],
    finish: ['Open ', external('https://claude.ai/new', 'a new Claude chat')],
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
      [
        'Copy this URL:',
        fields(field('Connection', url(env, '/mcp'), 'the connection URL')),
      ],
      [
        'Open ',
        external('https://chatgpt.com/plugins', 'ChatGPT Plugins'),
        ', tap the ',
        b('+'),
        ' button, then ',
        b('Add custom MCP server'),
        '.',
      ],
      ['Add the name and description:', chatgptFields(env)],
      ['Under ', b('Connection'), ', paste the URL you copied.'],
      [
        'Read the warning, tap ',
        b('I understand and want to continue'),
        ', then ',
        b('Create as a plugin'),
        '.',
      ],
      'Sign in with your email when ChatGPT asks.',
    ],
    // The repository's plugin names production; a staging visitor needs the
    // manual setup above to stay with this deployment.
    details: apex(env) == apex()
      ? {
        summary: 'Connect from the ChatGPT desktop app',
        text: [
          'This way, yaks.app stays up to date without waiting for a review. ' +
          'In the ChatGPT desktop app, choose ',
          b('Add plugin marketplace'),
          ', then copy and paste this:',
          fields(field('Repository', REPO, 'the repository')),
          'You can also add it in your workspace’s plugin settings.',
        ],
      }
      : undefined,
    finish: ['Open ', external('https://chatgpt.com/', 'a new ChatGPT chat')],
  },
  {
    key: 'claude-code',
    tab: 'Claude Code',
    title: 'Claude Code',
    steps: [
      [
        'In your terminal: ',
        h(
          Copy.Text,
          { as: 'code' },
          `claude mcp add --transport http yaks ${url(env, '/mcp')}`,
        ),
      ],
      [
        'Start Claude Code, run ',
        code('/mcp'),
        ', pick ',
        b('yaks'),
        ' and choose ',
        b('Authenticate'),
        '. It opens your browser to sign in.',
      ],
    ],
    note: [
      'Add ',
      code('--scope user'),
      ' to that first line to have it in every project, not just this one.',
    ],
    finish: 'Start a new Claude Code chat',
  },
  {
    key: 'cursor',
    tab: 'Cursor',
    title: 'Cursor',
    steps: [
      [
        'Open ',
        b('Cursor Settings'),
        ' → ',
        b('Tools & Integrations'),
        ' and press ',
        b('New MCP Server'),
        '. It opens ',
        code('~/.cursor/mcp.json'),
        '.',
      ],
      [
        'Add the server, with the URL as its one field: ',
        h(
          Copy.Text,
          { as: 'code' },
          `{ "mcpServers": { "yaks": { "url": "${url(env, '/mcp')}" } } }`,
        ),
      ],
      [
        'Back in ',
        b('Tools & Integrations'),
        ', click ',
        b('yaks'),
        ' and sign in.',
      ],
    ],
    note: [
      'A ',
      code('.cursor/mcp.json'),
      ' in a project folder does the same thing for that project alone.',
    ],
    finish: 'Open a new Agent chat in Cursor',
  },
  {
    key: 'grok',
    tab: 'Grok',
    title: 'Grok',
    steps: [
      [
        'Open ',
        external('https://grok.com/connectors', 'Grok Connectors'),
        ' and choose ',
        b('New Connector'),
        ', then ',
        b('Custom'),
        '.',
      ],
      [
        'Enter this server URL:',
        fields(field('URL', url(env, '/mcp?auth=required'), 'the MCP URL')),
      ],
      'Connect and follow the prompt to sign in to yaks.app.',
    ],
    finish: 'Start a new Grok chat',
  },
  {
    key: 'other',
    tab: 'Other',
    title: 'Anything else that speaks MCP',
    steps: [
      [
        'Add a streamable HTTP connection with this URL:',
        fields(field('URL', url(env, '/mcp'), 'the MCP URL')),
      ],
      [
        'If it asks for a name, use ',
        b('yaks.app'),
        '. Then follow its sign-in prompt.',
      ],
    ],
    details: {
      summary: 'More about authentication',
      text: [
        ...oauthHelp(env),
        ' Sign-in is required when connecting. To use the signed-out tools in ' +
        'a client that supports mixed authentication, use ',
        code(url(env, '/mcp?auth=mixed')),
        '. ',
        code(url(env, '/mcp?auth=required')),
        ' also requires sign-in.',
      ],
    },
    finish: 'Start a new chat in your MCP client',
  },
]

let steps = (items: Kids[]) => h('ol', null, items.map((s) => h('li', null, s)))

// Native radio tabs share their layout with the working style-guide example.
let doors = (env: Host) =>
  h(
    TabSet,
    null,
    h(TabSet.Legend, null, 'Which app do you use?'),
    clients(env).map((a, i) =>
      h(
        TabSet.Item,
        null,
        h('input', {
          type: 'radio',
          name: 'agent',
          id: `tab-${a.key}`,
          value: a.key,
          checked: !i,
        }),
        h(TabSet.Tab, { for: `tab-${a.key}` }, a.tab),
        h(
          TabSet.Panel,
          { as: Card, mod: a.key },
          h(Card.Title, null, a.title),
          a.intro ? h('p', null, a.intro) : null,
          a.paths
            ? a.paths.map((p) => [
              h('h3', { class: 'Connect_Path' }, p.title),
              steps(p.steps),
            ])
            : steps(a.steps!),
          a.note ? h('p', { class: 'Note' }, a.note) : null,
          a.details
            ? h(
              More,
              null,
              h('summary', null, a.details.summary),
              h(More.Body, { class: 'Note' }, a.details.text),
            )
            : null,
          h(
            'div',
            { class: 'Connect_Next' },
            h('p', null, 'Make your first app'),
            a.finish,
            ', then ask:',
            firstAsk(),
            h(
              'span',
              { class: 'Note' },
              'Pick one to build, then ask for changes in the same chat. Keep shaping it as you use it.',
            ),
          ),
        ),
      )
    ),
  )

// Shows a part only while an agent is connected, or only while none is
// (connected_ui.ts `agentLive` keeps it true as agents come and go).
let state = (connected: boolean, show: boolean) => ({
  [`data-${connected ? 'connected' : 'disconnected'}`]: '',
  hidden: !show,
})

// The one link a person pastes into their own agent, which reads from it how
// to connect itself (docs.ts `AGENT`, public/agent.md).
let pasteLink = (env: Host) =>
  h(
    Form.Field,
    null,
    h(Form.Label, { as: 'p' }, 'Paste this link into your AI agent'),
    copyable(url(env, AGENT.path), 'the link for your agent'),
    h(
      'span',
      { class: 'Note' },
      'Claude, ChatGPT, Claude Code, Cursor or another agent reads from it how to connect to yaks.app, does what it can itself, and tells you the one step that’s yours.',
    ),
  )

// `back` is where a row's Disconnect returns to: the page it is on.
let agentSetup = (agents: Agent[], env: Host, back: string) => [
  agentList(agents, 'rows', back),
  h(
    'p',
    state(true, !!agents.length),
    'Ask for an app, or keep improving one in the same chat.',
  ),
  h(
    'p',
    state(false, !agents.length),
    'Connect once, then build and keep improving your apps in your usual chats.',
  ),
  h(
    'section',
    { class: 'Connect_Setup' },
    h(Group, state(true, !!agents.length), 'Connect another agent'),
    pasteLink(env),
    h('p', null, 'Or connect it yourself, with the steps for your app:'),
    doors(env),
  ),
]

// The only script a tab needs, and it is not what switches one: the radios do
// that with no script at all. This keeps the chosen one in the address, so a
// link can name a tab and a reload comes back to it. Matched by value, never
// built into a selector — a hash is whatever a stranger put in it.
let tabbing = () =>
  run(`
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
`)

// One listener, no framework: the form answers in place. Constant text, no
// interpolation, and every write to the page is textContent — the page never
// speaks HTML on a person's behalf.
let inline = () =>
  run(`
let f = document.querySelector('.Addr')
if (f) f.addEventListener('submit', async (e) => {
  e.preventDefault()
  let say = f.querySelector('.Notice')
  let go = f.querySelector('button')
  let now = document.querySelector('.Now b')
  go.disabled = true
  say.className = 'Notice'
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
      say.className = 'Notice Notice-negative'
      say.textContent = out.error
    }
  } catch (_) {
    say.className = 'Notice Notice-negative'
    say.textContent = "That didn't go through. Try again?"
  }
  go.disabled = false
})
`)

// The billing buttons: ask our own door for the payment provider's URL and
// follow it. The
// URL is minted per person and expires, so it is never written into the page.
let billing = () =>
  run(`
for (let b of document.querySelectorAll('.Bill_Go')) {
  b.addEventListener('click', async () => {
    let say = b.closest('.Bill').querySelector('.Bill_Say')
    b.disabled = true
    say.className = 'Notice Bill_Say Loading'
    say.innerHTML = ${
    JSON.stringify(yak('calculating') + '<span>One moment…</span>')
  }
    try {
      let r = await fetch(b.dataset.target || '/api/billing/' + b.dataset.door, {
        method: 'POST',
        body: new URLSearchParams({
          billing: b.dataset.door,
          ...(b.dataset.plan ? { plan: b.dataset.plan, per: b.dataset.per } : {}),
        }),
      })
      let out = await r.json()
      if (out.url) { location = out.url; return }
      say.className = 'Notice Bill_Say Notice-negative'
      say.textContent = out.error ? out.error.message : 'That did not go through.'
    } catch (_) {
      say.className = 'Notice Bill_Say Notice-negative'
      say.textContent = "That didn't go through. Try again?"
    }
    b.disabled = false
  })
}
`)

export let connect = (yours: Yours, status = 200, env: Host = {}) =>
  page(
    env,
    {
      title: 'Connect yaks.app',
      lead: 'Build and manage your apps from your usual chats.',
      status,
    },
    agentSetup(yours.agents ?? [], env, '/connect'),
    h(
      More,
      { class: 'Attach', open: status != 200 || yours.paid },
      h('summary', null, 'Your address and plan'),
      h(More.Body, null, mine(yours, env), plan(yours, env)),
    ),
    h(
      'p',
      { class: 'Note' },
      h('a', { href: url(env, MANAGE) }, 'Your apps and settings'),
    ),
    h(
      'p',
      { class: 'Note' },
      h('a', { href: url(env, '/help') }, 'Need help?'),
    ),
    home(env),
    copying(),
    tabbing(),
    inline(),
    billing(),
    agentLive('/oauth/agents'),
  )
