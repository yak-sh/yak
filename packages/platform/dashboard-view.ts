/**
 * A space's Dashboard (T-3702), the view at its own address, yaks.app/<space>:
 * its apps to open, most opened first; a box to ask its Operator for something
 * new, with what the space could use next to try in it; what its agents did
 * lately, each line opening what it made (a fix its conversation, a release its
 * version's page, ./version-view.ts); and its Updates. It is drawn from rows (./dashboard.ts), by the
 * server for the first paint and by the browser as they move
 * (./dashboard-browser.ts).
 *
 * @module
 */
import { type ComponentChildren as Kids, h } from 'preact'
import { Badge } from '@yaks/ui/Badge'
import { Button } from '@yaks/ui/Button'
import { Card } from '@yaks/ui/Card'
import { Field } from '@yaks/ui/Field'
import { Form } from '@yaks/ui/Form'
import { Icon } from '@yaks/ui/Icon'
import { Time } from '@yaks/ui/Time'
import { MarkdownInline } from '@yaks/markdown'
// @ts-types="@yaks/ui/lucide"
import ArrowUpRight from 'lucide/dist/esm/icons/arrow-up-right.mjs'
import type { Bundle } from '@yaks/graph'
import {
  type Did,
  fixesOf,
  type Opens,
  releasesOf,
  type Suggestion,
  suggestionsOf,
  summary,
  worked,
  workingOf,
} from './dashboard.ts'
import { type Broken, listedOf } from './space-apps.ts'
import { type Update, updatesIn } from './update-rows.ts'
import { appMarkImage, chatPath, managePath, versionPath } from './routes.ts'

/** What the Dashboard says beside its rows: whose it is, its space, where
 * its apps answer (`at`), and its Operator's chat and Updates. */
export type DashboardView = {
  person: string
  space: { eid: string; slug: string; title: string; operator: string }
  at: string
  chat: string
  updates: string
}

/** The Dashboard's view element's attribute, holding its `DashboardView`. */
export let VIEW_ATTR = 'data-dashboard-view'

/** What the Dashboard draws, read from its rows. */
export type Dashboard = {
  /** its rows are not in yet: it draws its frame, and says nothing is
   * there only once they are */
  pending?: boolean
  apps: Broken[]
  did: Did[]
  working?: string
  suggestions: Suggestion[]
  updates: Update[]
}

// Most opened first, then by name.
let opened = (a: Broken, b: Broken) =>
  (b.visits ?? 0) - (a.visits ?? 0) ||
  (a.title || a.slug).localeCompare(b.title || b.slug)

/** The Dashboard of `view`'s space as `rows` hold it, or `pending`, before
 * they are in. */
export let dashboardOf = (
  view: DashboardView,
  rows: Bundle[],
  pending = false,
): Dashboard => {
  let { eid, operator } = view.space
  let apps = listedOf(rows, eid).toSorted(opened)
  let titles = new Map(apps.map((a) => [a.eid, a.title || a.slug]))
  let fixes = fixesOf(rows, eid)
  let now = workingOf(fixes)
  return {
    pending,
    apps,
    did: worked(operator, releasesOf(rows, eid), fixes, titles),
    working: now?.app
      ? `fixing a break in ${titles.get(now.app) ?? 'an app'}`
      : now?.asked
      ? `“${now.asked}”`
      : undefined,
    suggestions: suggestionsOf(rows, eid),
    updates: updatesIn(rows, eid),
  }
}

let head = (id: string, title: Kids, ...end: Kids[]) =>
  h(
    'div',
    { class: 'Dash_PanelHead' },
    h('h2', { id, class: 'Dash_Head' }, title),
    ...end,
  )

let opens = (a: Broken) =>
  a.installed
    ? 'From the gallery'
    : a.visits
    ? `${a.visits} ${a.visits == 1 ? 'open' : 'opens'}`
    : ''

// An app's tile: its icon, or its colored initial until the icon comes, its
// name, and how often it was opened; a press opens it to use.
let tile = (at: string, a: Broken) => {
  let mark = appMarkImage(`${at}/${a.slug}`, a)
  return h(
    'a',
    { class: 'Dash_App', href: `${at}/${a.home ? '' : `${a.slug}/`}` },
    h(Icon, { of: ArrowUpRight, class: 'Dash_Opens' }),
    h(
      'span',
      { class: 'Dash_Icon', ...mark.backdrop },
      h('img', { ...mark.image, width: 56, height: 56 }),
    ),
    h('span', { class: 'Dash_AppName' }, a.title || a.slug),
    h('span', { class: 'Dash_AppSub' }, opens(a)),
  )
}

let appsPart = (view: DashboardView, { apps, pending }: Dashboard) =>
  h(
    'section',
    { class: 'Dash_Apps', 'aria-labelledby': 'dash-apps' },
    h(
      'div',
      { class: 'Dash_AppsHead' },
      h('h2', { id: 'dash-apps', class: 'Dash_Head' }, 'Open an app'),
      h(
        'a',
        { class: 'Dash_EditAll', href: view.chat },
        `${
          apps.length ? 'Change one' : 'Make one'
        } with ${view.space.operator}`,
      ),
    ),
    apps.length || pending
      ? h('div', { class: 'Dash_AppGrid' }, apps.map((a) => tile(view.at, a)))
      : h('p', { class: 'Dash_None' }, 'No apps here yet.'),
  )

// A suggestion: its short line, which a press turns into its longer request
// in the box (./dashboard-browser.ts), or without a script into the chat's
// box; and its dismissal.
let suggestion = (view: DashboardView, s: Suggestion) =>
  h(
    'span',
    { class: 'Dash_Suggest', key: s.name },
    h('a', {
      href: `${view.chat}?${new URLSearchParams({ say: s.ask })}`,
      'data-ask': s.ask,
    }, s.says),
    h('button', {
      type: 'button',
      'data-dismiss': s.name,
      'aria-label': `Dismiss: ${s.says}`,
      title: 'Dismiss',
    }, '×'),
  )

// The box to ask the Operator for something new, and what to try: sending
// starts a conversation and opens it.
let askPart = (view: DashboardView, all: Suggestion[]) => {
  let { slug, operator } = view.space
  return h(
    Card,
    {
      as: 'section',
      class: 'Dash_Panel Dash_Ask',
      'aria-labelledby': 'dash-ask',
    },
    head(
      'dash-ask',
      `Ask ${operator}`,
      h('a', { href: view.chat }, 'Open the chat'),
    ),
    h(
      'form',
      {
        class: 'Dash_AskForm',
        method: 'post',
        action: managePath('operator', slug),
        enctype: 'multipart/form-data',
      },
      h(Field, {
        lines: true,
        name: 'say',
        rows: 2,
        required: true,
        class: 'Dash_AskBox',
        placeholder: `What should ${operator} do next?`,
        'aria-label': `Ask ${operator}`,
      }),
      h(Button, { mod: 'go', type: 'submit' }, 'Send'),
    ),
    all.length
      ? h(
        'div',
        { class: 'Dash_Suggests' },
        h('span', { class: 'Dash_SuggestLead' }, 'Try'),
        all.map((s) => suggestion(view, s)),
      )
      : null,
  )
}

// Where a line of Recent work leads: a fix to the conversation it was worked
// in, a release to its version's page; none for an app no longer listed.
let opening = (
  view: DashboardView,
  slugs: Map<string, string>,
  o?: Opens,
) => {
  if (!o) return undefined
  if ('request' in o) return chatPath(view.space.slug, o.request)
  let slug = slugs.get(o.app)
  return slug && versionPath(view.space.slug, slug, o.version)
}

let didLine = (d: Did, href?: string) =>
  h(
    'li',
    { class: 'Dash_Did' },
    h(
      href ? 'a' : 'span',
      { class: 'Dash_DidTitle', href },
      `${d.who} ${d.does} ${d.app}`,
      d.times > 1
        ? [
          ' ',
          h(Badge, {
            mod: 'quiet',
            title: `${d.times} times in a row`,
          }, `×${d.times}`),
        ]
        : null,
    ),
    d.said
      ? h(
        'span',
        { class: 'Dash_DidMeta' },
        h(MarkdownInline, { source: d.said, flat: true }),
      )
      : null,
    h(Time, { at: d.at, class: 'Dash_When' }),
  )

let workPart = (view: DashboardView, read: Dashboard) => {
  let slugs = new Map(read.apps.map((a) => [a.eid, a.slug]))
  return h(
    Card,
    {
      as: 'section',
      class: 'Dash_Panel Dash_Work',
      'aria-labelledby': 'dash-work',
    },
    head('dash-work', 'Recent work'),
    read.working
      ? h(
        'p',
        { class: 'Dash_Now' },
        h('span', { class: 'Dash_Pip' }),
        `Working now: ${read.working}`,
      )
      : null,
    read.did.length || read.pending
      ? h(
        'ul',
        { class: 'Dash_List' },
        read.did.map((d) => didLine(d, opening(view, slugs, d.opens))),
      )
      : h(
        'p',
        { class: 'Dash_None' },
        `What ${view.space.operator} and your other agents do here shows up here.`,
      ),
  )
}

// How many Updates the panel shows; the rest are a press away.
let SHOWN = 4

// An update's one action in place: the choice it recommends, taken as the
// Updates page takes it (@yaks/inbox actions); else a way to it there.
let act = (view: DashboardView, u: Update) => {
  if (!u.needs) return null
  let choice = u.recommended && u.choices?.find((c) => c.label == u.recommended)
  if (!choice) {
    return h(
      Button,
      { mod: 'go', href: `${view.updates}#u-${u.eid}` },
      'Answer',
    )
  }
  return h(
    'form',
    {
      class: 'Page_Form',
      method: 'post',
      action: view.updates,
      'data-inbox-action': 'choose',
      'data-inbox-space': view.space.eid,
    },
    h(Form.Hidden, { name: 'choose', value: u.eid }),
    h(Form.Hidden, { name: 'id', value: crypto.randomUUID() }),
    h(
      Button,
      { mod: 'go', name: 'choice', value: choice.label },
      choice.label,
    ),
  )
}

let updateLine = (
  view: DashboardView,
  u: Update,
  titles: Map<string, string>,
) => {
  let app = u.about && titles.get(u.about)
  return h(
    'li',
    {
      class: 'Dash_Update',
      'data-inbox-card': u.eid,
      'data-inbox-waits': u.needs ? view.space.slug : undefined,
    },
    u.needs ? h('span', { class: 'Dash_Needs', title: 'Needs you' }) : null,
    h(
      'span',
      { class: 'Dash_UpdateText' },
      h(
        'a',
        { class: 'Dash_UpdateTitle', href: `${view.updates}#u-${u.eid}` },
        h(MarkdownInline, {
          source: u.subject || summary(u.words, 90),
          flat: true,
        }),
      ),
      h(
        'span',
        { class: 'Dash_DidMeta' },
        app ? [h('b', null, app), ' · '] : null,
        h(Time, { at: u.at }),
      ),
    ),
    h(
      'span',
      { class: 'Dash_UpdateActs', 'data-inbox-pending': '' },
      act(view, u),
    ),
    h('output', { 'data-inbox-status': '', hidden: true }),
  )
}

let updatesPart = (view: DashboardView, read: Dashboard) => {
  let needs = read.updates.filter((u) => u.needs).length
  let titles = new Map(read.apps.map((a) => [a.eid, a.title || a.slug]))
  return h(
    Card,
    {
      as: 'section',
      class: 'Dash_Panel Dash_Updates',
      'aria-labelledby': 'dash-updates',
      'data-inbox-actions': '',
      'data-inbox-scope': view.person,
      'data-inbox-home': view.space.slug,
    },
    head(
      'dash-updates',
      ['Updates', needs ? [' ', h(Badge, null, needs)] : null],
      h('a', { href: view.updates }, 'All updates'),
    ),
    read.updates.length || read.pending
      ? h(
        'ul',
        { class: 'Dash_List' },
        read.updates.slice(0, SHOWN).map((u) => updateLine(view, u, titles)),
      )
      : h('p', { class: 'Dash_None' }, 'Nothing new.'),
  )
}

/** The work and Updates the Dashboard can send after its opening panels. */
export let dashboardActivity = (view: DashboardView, read: Dashboard) => [
  workPart(view, read),
  updatesPart(view, read),
]

/** The Dashboard of `view`'s space, as `read` says it. */
export let dashboardView = (
  view: DashboardView,
  read: Dashboard,
  activity: Kids = dashboardActivity(view, read),
) => [
  appsPart(view, read),
  askPart(view, read.suggestions),
  activity,
]
