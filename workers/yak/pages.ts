import { Head } from '@yaks/ui/parts'
import { Time } from '@yaks/ui/parts'
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

import type { Stamp, Writers } from './stamps.ts'
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
  Loading,
  More,
  Notice,
  Rows,
  State,
} from '@yaks/ui/parts'

import { type ComponentChildren, h } from 'preact'

import type { Frame } from './build-door.ts'

import type { Agent } from './connected.ts'

import type { Connections, Face } from './connections.ts'

import { day, esc, fileDrop, markup, raw } from './html.ts'

import type { People } from './people.ts'

import type { Role } from './directory.ts'

import type { Plain } from './unseen.ts'

import { type Invitation, qr } from './referral.ts'

export { esc } from './html.ts'

import { chatPath, managePath, type ManageView } from '@yaks/platform/routes'

import { apex, type Host, spaceHost, url } from '@yaks/platform/host'

import { versionOf } from './running.ts'

import { Yak, yak } from './mascot.ts'

import { asset, links } from './sheets.ts'
import { type Preview, tags as previewTags } from './link-preview.ts'
import { decodeHTML } from 'entities'

import {
  BLOCK,
  type Budget,
  type Ceiling,
  ceilings,
  count,
  dollars,
  type Gauge,
  PRICE,
  size,
  YEARLY,
} from './meter.ts'

import type { Card as Billed, Payer, Want } from './billing.ts'

import type { Accepts } from '@yaks/blob'

import type { VocabDoc } from '@yaks/vocab'

import { kinds } from './data.ts'

export type Kids = ComponentChildren

// A page's own script: constant code, which says nothing a person typed.
export let run = (code: string) =>
  h('script', { dangerouslySetInnerHTML: { __html: code } })

// A form's hidden field, only when there is something to carry.
export let held = (name: string, value?: string | null) =>
  value ? h('input', { type: 'hidden', name, value }) : null

export let home = (env: Host) =>
  h('a', { class: 'Away', href: url(env, '/') }, 'yaks.app')

// What a plan costs, said on its button: "$49 a month", "$490 a year".
let priced = (want: Want) =>
  `$${count((want.per == 'year' ? YEARLY : PRICE)[want.tier]!)} a ${want.per}`

export let billButton = (
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
export let heading = (
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
export let status = (word: Kids, tone?: 'positive' | 'negative') =>
  h(State, { mod: tone }, word)

/** A field: its label, its control, and what explains it under both. */
export let labeled = (
  id: string,
  label: Kids,
  control: Kids,
  hint: Kids = '',
) =>
  h(
    Form.Field,
    null,
    h(Form.Label, { for: id }, label),
    control,
    hint ? h(Form.Hint, null, hint) : null,
  )

/** A value as text a script can hold: JSON, with nothing that could close
 * it. */
export let script = (value: unknown) =>
  JSON.stringify(value).replaceAll('<', '\\u003c')

// The script that moves an open page onto a newer deploy (public/deploy.js),
// told the deploy that drew it. None where the runtime names no deploy.
let deployed = (env: Host) => {
  let v = versionOf(env.CF_VERSION_METADATA)
  return v
    ? `<script src="${asset(env, 'deploy.js')}" data-deploy="${
      esc(v.id)
    }" data-deploy-at="${esc(v.at)}" defer></script>`
    : ''
}

// The document every page here is, around the `<main>` it is handed as markup:
// its head, and the scripts the parts in it call for. `later` is markup the
// end of the `<main>` waits on: everything before it is sent at once, and the
// rest once it settles (`staged`).
let documented = (
  env: Host,
  title: string,
  main: string,
  status: number,
  headers: Record<string, string> = {},
  layout = '',
  head = '',
  later?: Promise<string>,
  assets?: string,
  preview?: Preview,
) => {
  let file = (name: string) => asset(env, name, undefined, assets)
  let open = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${preview ? esc(preview.title) : `${title} · yaks.app`}</title>
${previewTags(env, preview ?? { title: `${decodeHTML(title)} · yaks.app` })}
${links(env, 'pages.css', undefined, assets)}${
    head.includes('rel="apple-touch-icon"')
      ? ''
      : `\n<link rel="apple-touch-icon" href="${file('apple-touch-icon.png')}">`
  }${head ? `\n${head}` : ''}
</head>
<body${layout ? ` class="${layout}"` : ''}><main class="${
    layout.split(/\s+/).filter(Boolean).map((name) =>
      name + (name == 'Talk_Page' ? 'Main' : '_Main')
    ).join(' ')
  }">${main}`
  let close = `</main><script type="module" src="${
    file('_dates.js')
  }"></script>${
    main.includes('data-sort=')
      ? `<script type="module" src="${file('_sort.js')}"></script>`
      : ''
  }${
    main.includes('data-chart')
      ? `<script type="module" src="${file('chart.js')}"></script>`
      : ''
  }${
    main.includes('data-menu')
      ? `<script src="${file('menu.js')}" defer></script>`
      : ''
  }${
    main.includes('data-idle')
      ? `<script src="${file('idle.js')}" defer></script>`
      : ''
  }${
    main.includes('data-side')
      ? `<script src="${file('side.js')}" defer></script>`
      : ''
  }${
    main.includes('data-pane')
      ? `<script src="${file('pane.js')}" defer></script>`
      : ''
  }${
    main.includes('data-modal-close')
      ? `<script src="${file('modal.js')}" defer></script>`
      : ''
  }${
    main.includes('data-find')
      ? `<script src="${file('find.js')}" defer></script>`
      : ''
  }${
    main.includes('data-save=')
      ? `<script type="module" src="${file('_settings.js')}"></script>`
      : ''
  }${
    main.includes('data-alerts-offer')
      ? `<script type="module" src="${file('_alerts.js')}"></script>`
      : ''
  }<script src="${file('drop.js')}" defer></script>${deployed(env)}</body>
</html>`
  return new Response(
    later
      ? staged(open, later.then((said) => said + close, () => close))
      : open + close,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    },
  )
}

// A body sent in two parts: `first` at once, `rest` once it settles. A reader
// that went away meanwhile is owed nothing more.
let staged = (first: string, rest: Promise<string>) => {
  let bytes = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(body) {
      body.enqueue(bytes.encode(first))
      let last = await rest
      try {
        body.enqueue(bytes.encode(last))
        body.close()
      } catch {
        // Cancelled: nobody is reading.
      }
    },
  })
}

/** What a page says about itself: its title, the line under it where it
 * opens with the two, its status, the headers beside its content type (the
 * provisioning page's `Retry-After`, the dashboard's no-store), the class
 * its body wears, and tags for its head beside the platform's own. */
export type Said = {
  title: string
  preview?: Preview
  lead?: Kids
  status?: number
  headers?: Record<string, string>
  layout?: string
  head?: string
  /** Same-origin mount for the sheet and its SVG filters, fonts and scripts. */
  assets?: string
  /** what the page says once it knows: drawn after its parts when it
   * settles, and everything before it shown meanwhile, so nothing a person
   * can already read or press waits on it */
  later?: Promise<Kids>
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
    at.later?.then(markup),
    at.assets,
    at.preview ?? {
      title: `${at.title} · yaks.app`,
      description: typeof at.lead == 'string' ? at.lead : undefined,
    },
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
      { class: 'Page_Form', method: 'post', action: '/' },
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
export let dropZone = (slug?: string, to = '/deploy') =>
  h(
    'form',
    {
      class: 'Deploy Page_Form',
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
export let dropping = () =>
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
    out.push(
      text.slice(from, m.index),
      h('a', { class: 'Chat_Link', href: to }, to),
    )
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
export let transcript = (frames: Frame[]) => {
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
          h('p', { class: 'Chat_BuiltWords' }, 'It is live.'),
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
export let address = (to: string) =>
  h(
    'p',
    { class: 'Url' },
    h('a', { href: to }, h('code', { class: 'Url_Code' }, to)),
  )

// The line a person types. `required` is the browser's own guard; the door
// keeps the same one, for whoever posts without it. While a build runs, the
// script shows the yak at its keyboard above the button; its files are the
// apex's, which a space's page names whole.
export let chatAsk = (env: Host, to = '/api/build') =>
  h(
    'form',
    { class: 'Chat_Ask Page_Form', method: 'post', action: to },
    h(
      'p',
      null,
      h(Field, {
        class: 'Chat_Input',
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

// The live half (public/build.js), served at the address of the page it is
// on: the builder's own on a space's hostname (apps.ts serves it there), so a
// space's page needs no asset of the apex, and the public file at the apex.
// A module, because it is one, and nothing on the page waits for it.
export let chatLive = (src = '/api/build.js') =>
  h('script', { type: 'module', src })

export let back = (env: Host, space: string) =>
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
        h(
          'ol',
          { class: 'Files Card_List' },
          at.files.map((f) => h('li', { class: 'Files_Item' }, f)),
        ),
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
export let copyable = (said: Kids, what = '') =>
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
export let copying = () =>
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
  // Where its logo is drawn from (@yaks/platform/routes `logoPath`), where it has one.
  logo?: string
}

export type DeskPage = {
  /** the space the page is in, or on a page of the person's own, the one the
   * side's selector holds */
  space: string
  /** the signed-in person whose settings drafts this page keeps */
  person?: string
  /** each with its open errors, newest first (unseen.ts `plain`), and when
   * it was made and last deployed, and by whom, where known */
  apps: (Listed & {
    errors?: Plain[]
    made?: Stamp | null
    deployed?: Stamp | null
  })[]
  /** what each writer those stamps name is called (stamps.ts `writers`) */
  writers?: Writers
  trash?: { eid: string; slug: string; title: string; days: number }[]
  name?: string
  email?: string
  /** the person's connected agents; none while not yet known, which leaves
   * what depends on them for the page's script to settle (`state`) */
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
  /** whether the person keeps the side collapsed to its icons
   * (`desk_sidebar{collapsed}`) */
  collapsed?: boolean
}

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
              }`,
              e.at
                ? [`, ${e.times == 1 ? '' : 'last '}`, h(Time, { at: e.at })]
                : null,
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

// A sentence out of a lowercase line: what a failed seal wrote beside it. An
// email address that opens it stays as it was typed.
/// sentence('no app x in y') -> 'No app x in y.'
/// sentence('ana@x.test is you') -> 'ana@x.test is you.'
export let sentence = (text: string) =>
  (/^\S+@/.test(text) ? text : text.charAt(0).toUpperCase() + text.slice(1)) +
  (/[.!?]$/.test(text) ? '' : '.')

// A service's logo, drawn as an image of its own SVG and never as markup: an
// SVG an <img> loads runs no script and fetches nothing. A catalog's service
// with none kept here is drawn from our own door at the apex (catalog.ts
// `logoDoor`), once it scrolls near.
export let logo = (f: Face, env: Host = {}) =>
  f.logo || f.image
    ? h(Card.Mark, {
      as: 'img',
      src: f.logo
        ? `data:image/svg+xml,${encodeURIComponent(f.logo)}`
        : url(env, f.image),
      alt: '',
      width: 24,
      height: 24,
      ...f.logo ? {} : { loading: 'lazy', decoding: 'async' },
    })
    : null

// A line about a service and a link to its site, where it has them. Only an
// https address is linked, so a site can never be a script.
export let about = (f: Face) => {
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
export let howTo = (f: Face, open: boolean) =>
  f.instructions
    ? h(
      More,
      { open },
      h(More.Summary, null, 'How to get the key'),
      h(More.Body, null, raw(f.instructions)),
    )
    : null

// The box a key is pasted in and the button that saves it, one line under
// its label; or, for a service that asks for several fields, a box for each
// under its own label, masked unless the field is shown, and the button under
// them. connections.ts `givenOf` reads what was typed.
export let keyBox = (
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
    send ? h(Form.Actions, null, send) : null,
    hint ? h(Form.Hint, null, hint) : null,
  ]
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
      assets: `${at.at}/_web/assets/`,
    },
    h(
      'header',
      { class: 'Desk_Head' },
      h(
        'div',
        null,
        h('a', { class: 'Head_Address', href: `${at.at}/` }, `${at.app} ↗`),
        h(Head.Title, { mod: 'page' }, 'Data'),
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
    h(Card, null, heading(host), h('pre', { class: 'Card_Pre' }, said)),
    home(env),
  )

// A door a later leaf fills (the connector): plain, not a mystery.
export let soon = (what: string, env: Host = {}) =>
  page(env, {
    title: `${what} is not available yet.`,
    lead: 'This feature is still being built.',
    status: 404,
  }, home(env))

// One button that sends the form it is in.
export let send = (label: Kids) =>
  h(Button, { mod: 'go', type: 'submit' }, label)

// A TV paired with a person (screen.ts, T-136193). The TV's own two pages
// are a screen across a room, so they say one thing each, large: the code
// and where to type it, or the draft. Each asks `/tv/now` again (RFC 8628's
// polling) and moves when the answer does; a draft's own page hears each
// write as it lands, so the TV asks only which draft to show.

// What a TV page's script does: keep the screen awake, ask again every
// `data-ask` ms, and move when the answer moves. Constant code: what it
// reads comes from its page's data attributes.
// How long a TV says what just changed.
let SAID = 8000

let TV = `(() => {
  let page = document.querySelector('[data-tv]')
  let ask = Number(page.dataset.ask)
  let awake = () => navigator.wakeLock?.request('screen').catch(() => {})
  awake()
  document.addEventListener('visibilitychange', awake)
  if (page.dataset.until) setTimeout(() => location.reload(), Number(page.dataset.until))
  let look = async () => {
    let now = await fetch('/tv/now', { cache: 'no-store' }).then((r) => r.json()).catch(() => null)
    let frame = page.querySelector('iframe')
    let url = now?.paired ? now.showing?.url ?? '' : null
    if (now && (url == null) != !!page.dataset.code) return location.reload()
    if (now && url != null && url != (frame?.getAttribute('src') ?? '')) return location.reload()
    setTimeout(look, ask)
  }
  setTimeout(look, ask)
  // Each write the framed draft takes, said over it for a few seconds: the
  // TV's half of what the phone says aloud.
  let line = page.querySelector('.Tv_Said')
  let named = (paths) => paths.length > 3 ? paths.length + ' files'
    : paths.length > 1 ? paths.slice(0, -1).join(', ') + ' and ' + paths.at(-1)
    : paths[0]
  let said = (files) => {
    let wrote = files.filter((f) => f.sha).map((f) => f.path)
    let gone = files.filter((f) => !f.sha).map((f) => f.path)
    return [
      wrote.length ? 'Wrote ' + named(wrote) : '',
      gone.length ? 'Removed ' + named(gone) : '',
    ].filter(Boolean).join('. ') || 'Released ' + page.dataset.title
  }
  let quiet
  addEventListener('message', (e) => {
    let frame = page.querySelector('iframe')
    let news = e.data?.['yak-draft']
    if (!line || !frame || e.source != frame.contentWindow || !Array.isArray(news?.files)) return
    line.textContent = said(news.files)
    clearTimeout(quiet)
    quiet = setTimeout(() => line.textContent = '', ${SAID})
  })
})()`

let pairAt = (env: Host) => url(env, '/tv/pair')

/** The TV before it is paired: its code, where to type it, and the same
 * address as a code a phone's camera opens with the code filled in. */
export let screenCode = (code: string, left: number, env: Host = {}) => {
  let at = `${pairAt(env)}?code=${code.replace('-', '')}`
  return page(
    env,
    { title: 'Show your drafts on this screen', layout: 'Tv' },
    h(
      'section',
      {
        class: 'Tv_Pair',
        'data-tv': '',
        'data-code': code,
        'data-ask': 5000,
        'data-until': Math.max(left, 0),
      },
      h('h1', null, 'Show your drafts on this screen'),
      h(
        'p',
        null,
        'On your phone, go to ',
        h('strong', null, `${apex(env)}/tv/pair`),
        ' and enter this code:',
      ),
      h('p', { class: 'Tv_Code', 'aria-label': 'Your code' }, code),
      h(
        'a',
        { class: 'Tv_Qr', href: at },
        raw(qr(at, 'Scan to pair this screen')),
      ),
      h(
        'p',
        { class: 'Note' },
        'This screen only shows what you are building. It can change nothing.',
      ),
    ),
    run(TV),
  )
}

/** A paired TV: the draft the person last wrote, filling the screen, with
 * a line over it saying each change as it lands, or a line saying nothing is
 * being built. */
export let watching = (
  shows: { app: string; title: string; url: string } | null,
  env: Host = {},
) =>
  page(
    env,
    { title: shows ? shows.title : 'Your screen', layout: 'Tv' },
    h(
      'section',
      {
        class: 'Tv_Watch',
        'data-tv': '',
        'data-ask': 15000,
        'data-title': shows?.title,
      },
      shows
        ? [
          h('iframe', {
            class: 'Tv_Frame',
            src: shows.url,
            title: shows.title,
          }),
          h(Notice, { class: 'Tv_Said', role: 'status' }),
        ]
        : h(
          Empty,
          null,
          'Nothing is being built right now. When your agent writes a draft, it shows here.',
        ),
    ),
    run(TV),
  )

/** The phone's side: a box for the code the TV shows, then every screen
 * paired with this person, each with its Unpair button. */
export let pairing = (
  at: {
    code?: string
    why?: string
    done?: 'paired' | 'unpaired' | null
    screens: { eid: string; paired: string; at: string | null }[]
  },
  status = 200,
  env: Host = {},
) =>
  page(
    env,
    {
      title: 'Pair a screen',
      lead:
        'Enter the code your TV shows. The TV then shows, read-only, whatever draft your agent is building.',
      status,
    },
    at.why || at.done
      ? h(
        Notice,
        { role: 'status', mod: at.why ? 'negative' : undefined },
        at.why ??
          (at.done == 'paired'
            ? 'Paired. Your screen shows your newest draft in a few seconds; if it still shows a code, check the code and enter it again.'
            : 'Unpaired. That screen shows nothing of yours now.'),
      )
      : null,
    h(
      'form',
      { class: 'Page_Form', method: 'post', action: '/tv/pair' },
      labeled(
        'tv-code',
        'Code',
        h(Field, {
          id: 'tv-code',
          class: 'Code',
          name: 'code',
          value: at.code ?? '',
          required: true,
          autofocus: !at.code,
          autocomplete: 'off',
          autocapitalize: 'characters',
          spellcheck: false,
          placeholder: 'BCDF-GHJK',
        }),
      ),
      send('Pair this screen'),
    ),
    at.screens.length
      ? h(
        Card,
        null,
        heading('Your screens'),
        h(
          Rows,
          { as: 'ul' },
          at.screens.map((s) =>
            h(
              Rows.Item,
              { as: 'li' },
              h(
                Rows.Main,
                null,
                h(Rows.Name, null, 'Screen'),
                h(
                  Rows.Meta,
                  null,
                  s.at
                    ? ['Paired ', h(Time, { at: s.paired })]
                    : 'Waiting for the screen to show it',
                ),
              ),
              h(
                Rows.Actions,
                null,
                h(
                  'form',
                  {
                    class: 'Page_Form Rows_Form',
                    method: 'post',
                    action: '/tv/unpair',
                  },
                  held('screen', s.eid),
                  h(Button, { type: 'submit' }, 'Unpair'),
                ),
              ),
            )
          ),
        ),
      )
      : null,
    home(env),
  )

/** An invitation as its link may tell it to somebody not yet in: what the
 * letter said and no more (invite.ts `door`). */
export type Offer = {
  /** the address it went to */
  email: string
  /** the letter's sealed link, which the press posts back */
  t?: string
  /** whether the link still signs its person in (invite.ts `DAYS`) */
  signs?: boolean
  /** the address the browser is signed in as instead, when it is */
  as?: string | null
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
    h(
      'form',
      { class: 'Page_Form', method: 'post', action: at.action },
      send('Join'),
    ),
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

// What a press answered, said back on the page it drew again.
export let said = (say?: string, no?: boolean) =>
  say ? h(Notice, { mod: no && 'negative', role: 'status' }, say) : null

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
  person?: string
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
export let addressBox = (
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
export let mine = (y: Yours, env: Host) =>
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
      {
        class: 'Addr Page_Form',
        method: 'post',
        action: '/connect',
        'data-save': 'address',
        'data-save-person': y.person,
      },
      labeled(
        'your-space',
        'Your address',
        h(
          Form.Line,
          null,
          addressBox('your-space', 'space', y.said ?? y.slug, env),
        ),
        MOVES,
      ),
      h(Notice, { mod: y.no && 'negative', role: 'status' }, y.say ?? ''),
    ),
  )

// What changing an address does, said on both cards that change it: the
// apps go along, and the old address redirects only until somebody else takes
// the name, which is free the moment it is left (D-131924).
export let MOVES =
  'You can change it at any time. Every app moves with it, and ' +
  'the old address sends people to the new one until someone else takes ' +
  'that name.'

// The plan card, for a person who is signed in (T-33125). One card: the paid
// plans when they are free, manage-billing when they are paying. Each button
// POSTs to billing.ts and follows the URL the payment provider answers, so no
// provider's address is written into this page and nothing here knows a key. The Pro
// plan (D-134567) is offered only where its prices exist (billing.ts `Card`).
//
// A day, not a timestamp: "runs until 14 October 2026" is what somebody wants
// to know, and the hour is noise on a monthly bill.
export let plan = (
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
    tier == 'pro' ? `, AI use included, and email support` : ''
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
        ...(y.plan.pro ?? []).map((per) => buy({ tier: 'pro', per })),
      ]
      : []),
    y.plan.known ? billButton('portal', 'Manage billing', target) : null,
  ].filter(Boolean)
  // An organization that pays by check or bank transfer asks for an invoice
  // instead, where the plan card posts to a settings page.
  let invoiced = target && y.plan.invoice && (tier == 'free' || y.plan.free)
    ? byInvoice(target, y.plan.invoice)
    : null
  // Where the Pro plan has no price yet, a free space still hears
  // how to get it: the pricing page offers it everywhere.
  let ask = tier == 'free' && !y.plan.pro?.length
    ? h(
      Form.Hint,
      null,
      'The Pro plan is not on sale here yet. Email ',
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
        : status(tier == 'plus' ? 'Plus' : 'Pro', 'positive'),
      actions: doors.length ? doors : null,
    }),
    head,
    billedLine(y.plan, y.payer, y.provider),
    target && y.plan.credit ? credit(y.plan.credit, space, target) : null,
    invoiced,
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

// The plan card's invoice (T-163754): the Pro plan for a year, invoiced to
// the address typed here and paid by bank transfer or check. A plain form to
// the settings page, like the cap, since nothing leaves for the provider's
// page: the plan starts when it is sent, and the invoice follows by email.
let byInvoice = (target: string, due: number) =>
  h(
    More,
    null,
    h(More.Summary, null, 'Pay by invoice instead'),
    h(
      More.Body,
      null,
      h(
        Form,
        { class: 'Page_Form', method: 'post', action: target },
        h('input', { type: 'hidden', name: 'billing', value: 'invoice' }),
        labeled(
          'invoice-email',
          'Send the invoice to',
          h(Field, {
            id: 'invoice-email',
            name: 'email',
            type: 'email',
            autocomplete: 'email',
            required: true,
          }),
          `For an organization that pays by check or bank transfer: ${NAMES.pro} for a year, ${
            priced({ tier: 'pro', per: 'year' })
          }, due ${due} days after each invoice is sent. The plan starts now, and each year's invoice comes as the year turns.`,
        ),
        labeled(
          'invoice-name',
          'Made out to',
          h(Field, {
            id: 'invoice-name',
            name: 'name',
            maxlength: 200,
            autocomplete: 'organization',
          }),
          'Your organization’s name, as the invoice should show it.',
        ),
        h(Button, { type: 'submit', mod: 'go' }, 'Send the invoice'),
      ),
    ),
  )

// The plan card's AI credit (D-134567): past its monthly budget a space
// spends credit bought in blocks, up to the cap its owner types here, which
// is $0 until they choose one. The cap is a plain form to the settings page;
// the block is a billing button like the plans', since it leaves for the
// provider's checkout.
let credit = (
  c: NonNullable<Billed['credit']>,
  space: string,
  target: string,
) =>
  h(
    Form,
    {
      class: 'Page_Form',
      method: 'post',
      action: target,
      'data-save': 'credit-cap',
    },
    h('input', { type: 'hidden', name: 'billing', value: 'cap' }),
    labeled(
      'credit-cap',
      'Monthly cap on AI credit',
      h(
        Form.Line,
        null,
        h(Field, {
          id: 'credit-cap',
          name: 'cap',
          type: 'number',
          min: 0,
          step: 1,
          inputmode: 'numeric',
          value: c.cap,
          required: true,
        }),
        c.buy ? billButton('credit', `Buy $${BLOCK} of credit`, target) : null,
      ),
      c.cap
        ? `Past its monthly AI budget, ${space} spends credit you buy in $${BLOCK} blocks, never more than ${
          dollars(c.cap)
        } a month. ${dollars(c.left)} is left to spend this month, and ${
          dollars(c.drawn)
        } spent. Credit not spent carries to next month.`
        : `Past its monthly AI budget, ${space} can spend credit you buy in $${BLOCK} blocks, up to a monthly cap in dollars you choose here. Nothing is ever charged past it.`,
    ),
  )

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

// A paid plan as it is said: "the Plus plan", never bare "Plus" (M-37846).
let NAMES = { plus: 'the Plus plan', pro: 'the Pro plan' }

// Connector forms do not ask the same questions. Keep each answer beside the
// provider step that asks for it, so a person never has to work out whether a
// field belongs to the form they are looking at.
export let field = (label: string, value: Kids, what?: string) =>
  h(
    'div',
    { class: 'Fields_Row' },
    h('dt', { class: 'Fields_Label' }, label),
    what == null
      ? value
      : h('dd', { class: 'Fields_Value' }, copyable(value, what)),
  )

export let fields = (...rows: Kids[]) => h('dl', { class: 'Fields' }, rows)

export let b = (words: string) => h('b', null, words)

export let code = (words: string) => h('code', null, words)

// What a person asks for their first app. The assistant already knows them,
// so the ask hands it their own situation rather than a scenario we made up
// for them (the app-ideas prompt's own question, prompts/app-ideas.md).
export let firstAsk = () =>
  copyable(
    "Any yaks.app ideas you think I'd like, based on our chat history?",
    'the first app request',
  )

// An address on this platform, written out for somebody to type or paste.
export let at = (path: string, env: Host) => code(url(env, path))

// Shows a part only while an agent is connected, or only while none is, as
// `agents` says, and neither on a page drawn before they were known, which
// marks it unsettled (connected_ui.ts `agentLive` settles it as the page
// loads, and keeps it true as agents come and go).
export let state = (connected: boolean, agents?: readonly unknown[]) => ({
  [`data-${connected ? 'connected' : 'disconnected'}`]: '',
  hidden: !agents || connected != agents.length > 0,
  ...agents ? {} : { 'data-unsettled': '' },
})

// The only script a tab needs, and it is not what switches one: the radios do
// that with no script at all. This keeps the chosen one in the address, so a
// link can name a tab and a reload comes back to it. Matched by value, never
// built into a selector — a hash is whatever a stranger put in it.
export let tabbing = () =>
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

// The billing buttons: ask our own door for the payment provider's URL and
// follow it. The
// URL is minted per person and expires, so it is never written into the page.
export let billing = () =>
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
