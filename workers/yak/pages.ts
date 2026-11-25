import type { Picked } from '@yaks/platform/side-rows'
import type { Bundle } from '@yaks/graph'
import {
  copyable,
  firstAsk,
  heading,
  labeled,
  send,
  state,
  status,
} from '@yaks/platform/page-parts'
export { copyable, firstAsk, heading, labeled, send, state, status }
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

import { type Field as Fielded, KEY } from '@yaks/connections'

import {
  At,
  Button,
  Card,
  Chip,
  Chips,
  Empty,
  Field,
  Form,
  Logo,
  More,
  Notice,
  Rows,
} from '@yaks/ui/parts'

import { type ComponentChildren, h } from 'preact'

import type { Agent } from './connected.ts'

import type { Connections, Face } from './connections.ts'

import { esc, fileDrop, markup, raw } from './html.ts'

import type { Befriended } from './friends.ts'

import type { Panes, Role } from './directory.ts'

import { type Invitation, qr } from './referral.ts'

export { esc } from './html.ts'

import {
  integrationLogo,
  managePath,
  type MarkedApp,
  type Setting,
} from '@yaks/platform/routes'

import { apex, type Host, spaceHost, url } from '@yaks/platform/host'
import { PLATFORM_BACKGROUND } from '@yaks/platform/woven'

import { versionOf } from './running.ts'

import { asset, links } from './sheets.ts'
import { FRAMED } from './frame.ts'
import { type Preview, tags as previewTags } from './link-preview.ts'
import { decodeHTML } from 'entities'

import { FILED } from '@yaks/api/refuse'

import type { Accepts } from '@yaks/blob'

import type { VocabDoc } from '@yaks/vocab'

import { kinds } from '@yaks/data-editor'

import type { Domain, DomainPage } from '@yaks/platform/domain-pages'
import { importMap } from './page-imports.ts'

export type Kids = ComponentChildren

// A page's own script: constant code, which says nothing a person typed. A
// page brought in place (@yaks/ui/navigate) runs it again, so it runs in a
// block of its own, and adds what it listens for with `signal`, aborted once
// its page leaves. Its lines end in semicolons: code opening with `(` would
// otherwise be read as a call on the line before.
export let run = (code: string) =>
  h('script', {
    dangerouslySetInnerHTML: {
      __html: `{
let leave = new AbortController();
document.addEventListener('yak-leave', () => leave.abort(), { once: true });
let signal = leave.signal;
${code.trim()}
}`,
    },
  })

// A form's hidden field, only when there is something to carry.
export let held = (name: string, value?: string | null) =>
  value ? h(Form.Hidden, { name, value }) : null

export let home = (env: Host) =>
  h('a', { class: 'Away', href: url(env, '/') }, 'yaks.app')

// The style guide's parts (public/style-guide.html, One design language),
// said once: a card's head, a status word, and a field under its label.

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
  let layouts = layout.split(/\s+/).filter(Boolean)
  let framed = layouts.includes(FRAMED)
  let open = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content">
<meta name="color-scheme" content="light dark">
${importMap(file)}${
    framed
      ? `
<meta name="theme-color" content="${PLATFORM_BACKGROUND}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#2b231f" media="(prefers-color-scheme: dark)">
<script type="module" src="${file('_navigate.js')}" data-navigate></script>`
      : ''
  }
<title>${preview ? esc(preview.title) : `${title} · yaks.app`}</title>
${previewTags(env, preview ?? { title: `${decodeHTML(title)} · yaks.app` })}
${
    links(
      env,
      'pages.css',
      undefined,
      assets,
      false,
      !head.includes('rel="icon"'),
    )
  }${
    head.includes('rel="apple-touch-icon"')
      ? ''
      : `\n<link rel="apple-touch-icon" href="${file('apple-touch-icon.png')}">`
  }${head ? `\n${head}` : ''}
</head>
<body${layout ? ` class="${layout}"` : ''}><main class="${
    layouts.map((name) => name + '_Main').join(' ')
  }">${main}`
  let close = `</main><script type="module" src="${
    file('_dates.js')
  }"></script>${
    main.includes('data-sort=')
      ? `<script type="module" src="${file('_sort.js')}"></script>`
      : ''
  }${
    main.includes(' data-inbox-actions') ||
      main.includes(' data-side-view=') &&
        !main.includes(' data-operator-chat=')
      ? `<script type="module" src="${file('_inbox-actions.js')}"></script>`
      : ''
  }${
    main.includes('data-friends-view=')
      ? `<script type="module" src="${file('_friends.js')}"></script>`
      : ''
  }${
    main.includes('data-profile-view=')
      ? `<script type="module" src="${file('_profile.js')}"></script>`
      : ''
  }${
    main.includes('data-updates-view=')
      ? `<script type="module" src="${file('_updates.js')}"></script>`
      : ''
  }${
    main.includes('data-apps-view=')
      ? `<script type="module" src="${file('_apps.js')}"></script>`
      : ''
  }${
    main.includes('data-people-view=')
      ? `<script type="module" src="${file('_people.js')}"></script>`
      : ''
  }${
    main.includes('data-operator-view=')
      ? `<script type="module" src="${file('_operator-settings.js')}"></script>`
      : ''
  }${
    main.includes('data-visits-view=')
      ? `<script type="module" src="${file('_visits.js')}"></script>`
      : ''
  }${
    main.includes('data-payment-view=')
      ? `<script type="module" src="${file('_payment.js')}"></script>`
      : ''
  }${
    main.includes('data-canvas-view=')
      ? `<script type="module" src="${file('_app-canvas.js')}"></script>`
      : ''
  }${
    main.includes('data-domain-search=')
      ? `<script type="module" src="${file('_domains.js')}"></script>`
      : ''
  }${
    main.includes('data-chart')
      ? `<script type="module" src="${file('chart.js')}"></script>`
      : ''
  }${
    main.includes('data-contents')
      ? `<script type="module" src="${file('_contents.js')}"></script>`
      : ''
  }${
    main.includes('data-fit-list')
      ? `<script type="module" src="${file('_fit-list.js')}"></script>`
      : ''
  }${
    main.includes('data-app-mark')
      ? `<script type="module" src="${file('_image-fallback.js')}"></script>`
      : ''
  }${
    main.includes('<form')
      ? `<script type="module" src="${file('_sending.js')}"></script>`
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
    main.includes('data-note=')
      ? `<script src="${file('note.js')}" defer></script>`
      : ''
  }${
    main.includes('data-save=')
      ? `<script type="module" src="${file('_settings.js')}"></script>`
      : ''
  }${
    main.includes('data-alerts-offer')
      ? `<script type="module" src="${file('_alerts.js')}"></script>`
      : ''
  }<script src="${file('drop.js')}" defer></script><script src="${
    file('away.js')
  }" data-home="${esc(apex(env))}" defer></script>${deployed(env)}</body>
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
        'kept until you restore it or confirm permanent erasure.',
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
        'here, and no page. Everything is kept until you restore it or ' +
        'confirm permanent erasure.',
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
      placeholder: 'e.g. oak-street-church',
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
  }, { signal })
}
`)

// An address something is live at, to open or copy.
export let address = (to: string) =>
  h(
    'p',
    { class: 'Url' },
    h('a', { href: to }, h('code', { class: 'Url_Code' }, to)),
  )

export let back = (env: Host, space: string) =>
  h(
    'p',
    null,
    h('a', {
      class: 'Away',
      href: url(env, managePath('apps', space)),
    }, 'Back to your apps'),
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

// The button's half. Constant code, no interpolation, and nothing is written
// to the page but a class: the words come from the span beside the button
// rather than an attribute of its own, so there is one copy of them on the
// page and nothing to keep in step. A copy turns its glyph to a check for a
// moment (`Copy-copied`). Where the clipboard is refused — an insecure origin,
// a browser that asks first — the words are selected instead, so the person's
// own copy keystroke lands.
export let copying = () =>
  run(`
for (let go of document.querySelectorAll('.Copy_Go')) {
  let said = go.previousElementSibling, box = go.parentElement, done
  go.hidden = false
  go.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(said.textContent)
      box.classList.add('Copy-copied')
      clearTimeout(done)
      done = setTimeout(() => box.classList.remove('Copy-copied'), 2000)
    } catch (_) {
      let range = document.createRange()
      range.selectNodeContents(said)
      let sel = getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    }
  }, { signal })
}
`)

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

type Listed = MarkedApp & {
  gallery?: string
  home?: boolean
  access?: string | null
}

export type { Picked }

export type DeskPage = {
  /** the space the page is in, or on a page of the person's own, the one the
   * side's selector holds */
  space: string
  /** the signed-in person whose settings drafts this page keeps */
  person?: string
  /** the space's apps, as the pages other than Apps list them; Apps is drawn
   * from `drawn` (@yaks/platform/space-apps) */
  apps: Listed[]
  /** what the apps page was asked to find and how to order it
   * (@yaks/platform/space-apps-view `sifted`) */
  sift?: { q: string; sort: string }
  trash?: { eid: string; slug: string; title: string; days: number }[]
  numbers?: { eid: string; number: string; monthly: string; days: number }[]
  name?: string
  email?: string
  sessions?: import('./browser-sessions.ts').BrowserSession[]
  /** the person's own accounts on each chat platform yaks.app's bot is on,
   * which Profile links (chat.ts `ownLinks`) */
  links?: { platform: string; integration: string; accounts: string[] }[]
  /** the session the asking browser holds, among `sessions` */
  session?: string
  /** the person's connected agents; none while not yet known, which leaves
   * what depends on them for the page's script to settle (`state`) */
  agents?: Agent[]
  /** the days the Visits page counts */
  viewDays?: number
  /** the eid of the space the page is of, which its lines name */
  spaceEid?: string
  /** whether the platform's payment provider takes sellers at all, which
   * puts Selling in the side on every manage page */
  shops?: boolean
  domains?: DomainPage
  renewals?: Domain[]
  /** on a paid plan, which is what taking payments needs */
  paying?: boolean
  /** whether its apps' pages say "Website by yaks.app" at their foot
   * (`byline`), which Settings offers on a paid plan */
  byline?: boolean
  say?: string
  no?: boolean
  view?: Setting
  connections?: Connections
  /** whether the person hides their presence from their friends
   * (`presence{hidden}`), on their profile */
  presenceHidden?: boolean
  /** the person's confirmed friends on their Friends page, online first,
   * and whether it shows them all (`?all`) or the first few */
  friendList?: Befriended[]
  allFriends?: boolean
  /** what was typed into the settings form, when a change was refused and
   * the page is drawn again */
  typed?: { title: string; space: string; home: string }
  /** what was typed into the new space form, when it was refused */
  made?: { title: string; slug: string }
  /** the apps of other people's spaces this person may open, each with the
   * slug of the space it lives in */
  shared?: (Listed & { space: string })[]
  /** the rows a page drawn from the page graph's reads was drawn from, which
   * it carries for its first paint (@yaks/platform/page-graph `drawnRows`) */
  drawn?: Bundle[]
  /** every space this person may work in, this one among them */
  spaces?: Picked[]
  /** the person's own invite to yaks.app (referral.ts `invitation`) */
  referral?: Invitation
  /** the Operator page's content (operator-page.ts `operatorBody`) */
  operator?: string
  /** a member of the space who does not own it: of its pages they may open
   * only the Operator, so the side links only that */
  member?: boolean
  /** how the person keeps the panes (directory.ts `Panes`) */
  panes?: Panes
}

export { sentence } from './html.ts'

// A service's logo at the head of its card, read from its integration's row
// (@yaks/platform/routes `integrationLogo`); a neutral mark where it has none.
export let logo = (
  f: { name: string; logo?: string; image?: string },
  env: Host = {},
) => h(Logo.Mark, { src: integrationLogo(f, env), class: 'Card_Mark' })

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
// them. Each box shows what its field looks like, where the integration says,
// and a row of dots where it does not. connections.ts `givenOf` reads what was
// typed.
export let keyBox = (
  id: string,
  label: Kids,
  send: Kids,
  hint: Kids = '',
  fields: Fielded[] = [KEY],
) => {
  let box = (at: string, name: string, f: Fielded) =>
    h(Field, {
      id: at,
      name,
      type: f.shown ? 'text' : 'password',
      placeholder: f.example || '••••••••',
      autocomplete: 'off',
      spellcheck: 'false',
      required: true,
    })
  if (fields.length == 1) {
    return labeled(
      id,
      fields[0].label == KEY.label ? label : fields[0].label,
      h(Form.Line, null, box(id, 'key', fields[0]), send),
      hint,
    )
  }
  return [
    ...fields.map((f) =>
      labeled(
        `${id}-${f.name}`,
        f.label,
        box(`${id}-${f.name}`, `key.${f.name}`, f),
      )
    ),
    send ? h(Form.Actions, null, send) : null,
    hint ? h(Form.Hint, null, hint) : null,
  ]
}

/** The data editor's page (@yaks/data-editor/editor, served as data.js,
 * draws what is in it): what an app's words keep (@yaks/data-editor `kinds`)
 * and the files it takes, handed to the script as data. */
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

export let oops = (env: Host = {}, requestId?: string, filed = false) =>
  page(env, {
    title: 'Something went wrong.',
    lead:
      'Try again shortly. If the problem continues, ask your assistant to check the app.' +
      (requestId ? ` Request ID: ${requestId}.` : ''),
    status: 500,
    headers: {
      ...requestId ? { 'x-request-id': requestId } : {},
      // Reported where it was caught (@yaks/api `FILED`).
      ...filed ? { [FILED]: '1' } : {},
    },
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

/** The button that begins a sign-in at `face`'s service, sending its form's
 * `do` as `act` where it names one, `quiet` where it is not the next step.
 * A sign-in through a broker (Nango) opens in a new tab, since the broker's
 * page never sends the person back here; this page is read again once they
 * come back to it (public/away.js). */
export let signingIn = (
  face: Pick<Face, 'broker'>,
  label: Kids,
  act?: string,
  quiet = false,
) =>
  h(Button, {
    mod: !quiet && 'go',
    type: 'submit',
    ...act ? { name: 'do', value: act } : {},
    ...face.broker ? { formtarget: '_blank' } : {},
  }, label)

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

/** The TV before it is paired: its code and where to type it. The QR opens
 * a blank form: a shared link must not supply another screen's code. */
export let screenCode = (code: string, left: number, env: Host = {}) => {
  let at = pairAt(env)
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
        'Enter the code shown on the TV in front of you, never a code someone sent you. That screen will be able to read your drafts.',
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
      placeholder: 'e.g. oak-street',
      autocomplete: 'off',
      spellcheck: 'false',
      ...more,
      value,
    }),
    h(At.End, null, `.${apex(env)}`),
  )

// What changing an address does, said on both cards that change it: the
// apps go along, and the old address redirects only until somebody else takes
// the name, which is free the moment it is left (D-131924).
export let MOVES =
  'You can change it at any time. Every app moves with it, and ' +
  'the old address sends people to the new one until someone else takes ' +
  'that name.'

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

// An address on this platform, written out for somebody to type or paste.
export let at = (path: string, env: Host) => code(url(env, path))

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
  addEventListener('hashchange', pick, { signal })
  tabs.addEventListener('change', (e) => {
    if (e.target.name == 'agent') {
      history.replaceState(null, '', '#' + e.target.value)
    }
  }, { signal })
}
`)
