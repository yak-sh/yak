/**
 * yaks.app's sidebar, its parts drawn from data: a link, a section of them,
 * and the space selector. The page's frame around them is the Worker's
 * (workers/yak sidebar.ts). What the person's spaces and apps say is drawn
 * from their rows (./side-rows.ts) by {@link sideParts}, the same on the
 * server, for the page's first paint, and in the browser, as the rows change
 * (./side-browser.ts).
 *
 * @module
 */
import { createElement as h } from 'react'
import type { IconNode } from 'lucide'
// @ts-types="@yaks/ui/lucide"
import Check from 'lucide/dist/esm/icons/check.mjs'
// @ts-types="@yaks/ui/lucide"
import ChevronsUpDown from 'lucide/dist/esm/icons/chevrons-up-down.mjs'
// @ts-types="@yaks/ui/lucide"
import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
// @ts-types="@yaks/ui/lucide"
import Inbox from 'lucide/dist/esm/icons/inbox.mjs'
// @ts-types="@yaks/ui/lucide"
import LayoutGrid from 'lucide/dist/esm/icons/layout-grid.mjs'
// @ts-types="@yaks/ui/lucide"
import Plus from 'lucide/dist/esm/icons/plus.mjs'
// Each part by its own module: the parts' index brings every part along.
import { Badge } from '@yaks/ui/Badge'
import { Form } from '@yaks/ui/Form'
import { Icon } from '@yaks/ui/Icon'
import { Identity } from '@yaks/ui/Identity'
import { Menu } from '@yaks/ui/Menu'
import { SideNav } from '@yaks/ui/SideNav'
import { HOLD, NAMES, READY, WARM } from '@yaks/ui/navigate'
import {
  accountView,
  appMarkImage,
  appWarmAt,
  chatPath,
  dashboardPath,
  managePath,
  type MarkedApp,
  type Setting,
  talkPath,
} from './routes.ts'
import type { Picked } from './side-rows.ts'

export type Item = {
  href: string
  label: string
  /** What the page it opens is called, where that is known here: the
   * page's title says it the moment the link is pressed (@yaks/ui/navigate
   * `NAMES`). */
  names?: string
  /** Whether its page is kept ready, fetched ahead once the page is drawn
   * (@yaks/ui/navigate `READY`): one its server is slow to answer. */
  ready?: boolean
  /** Whether its page is held as the browser idles (@yaks/ui/navigate
   * `HOLD`), as every page link's is unless it says not. */
  held?: boolean
  warm?: string
  icon: IconNode
  image?: ReturnType<typeof appMarkImage>
  current?: boolean
  /** Open beside the current page rather than the page itself: a quiet
   * "Open" mark, not the lit tab (an app beside the one conversation). */
  beside?: boolean
  /** The row an Operator app link was drawn from, used to open its canvas. */
  app?: MarkedApp
  /** How many there are, a plain number. */
  count?: number
  /** How many are new or wait on the person, on the red badge, which is
   * drawn hidden at none so a page can add what it learns later to it
   * (`data-waiting`, operator-page.ts `lateScript`). */
  waiting?: number
  /** How many of the person's Updates wait on them across their spaces
   * (`acrossBadge`), where the rows have said. */
  across?: { count?: number }
  submit?: boolean
  /** What a `submit` item's form posts besides its press. */
  fields?: Record<string, string>
  external?: boolean
}

export type Section = {
  id: string
  label: string
  heading?: boolean
  fit?: boolean
  items: Item[]
  empty?: string
}

let glyph = (of: IconNode) => h(Icon, { of })

/** How many wait on the person, `n`, on the red badge: hidden at none, and
 * saying the count it was drawn with for a page to add to. */
export let waitingBadge = (n: number, cls?: string) =>
  h(
    Badge,
    { className: cls, hidden: !n || undefined, 'data-waiting': n },
    n || '',
  )

/** How many of the person's Updates wait on them in the space `slug`, or in
 * all their spaces where it is empty: hidden until the tab's page graph has
 * said (`count` undefined), and at none. */
export let acrossBadge = (slug: string, cls?: string, count?: number) =>
  h(
    Badge,
    { className: cls, hidden: !count || undefined, 'data-across': slug },
    count || '',
  )

/** One item's link, or its form's button for a `submit` item. */
export let link = (at: Item) => {
  let node = h(
    SideNav.Link,
    {
      href: at.submit ? undefined : at.href,
      as: at.submit ? 'button' : 'a',
      type: at.submit ? 'submit' : undefined,
      title: at.label,
      [NAMES]: at.names,
      [READY]: at.ready || undefined,
      [HOLD]: at.held != false && !(at.submit || at.external || at.app) ||
        undefined,
      [WARM]: at.warm,
      'data-side-app': at.app ? JSON.stringify(at.app) : undefined,
      mod: at.current && 'on',
      'aria-current': at.current ? 'page' : at.beside ? 'true' : undefined,
      target: at.external ? '_blank' : undefined,
      rel: at.external ? 'noopener' : undefined,
    },
    at.image
      ? h(
        'span',
        { className: 'Sidebar_Icon', ...at.image.backdrop },
        h('img', { ...at.image.image, width: 24, height: 24 }),
      )
      : glyph(at.icon),
    h(SideNav.Label, null, at.label),
    at.beside
      ? besideMark()
      : at.across
      ? acrossBadge('', 'Sidebar_Count', at.across.count)
      : at.waiting != null
      ? waitingBadge(at.waiting, 'Sidebar_Count')
      : at.count != null
      ? h(Badge, { mod: 'quiet', className: 'Sidebar_Count' }, at.count)
      : null,
  )
  return at.submit
    ? h(
      'form',
      { className: 'Sidebar_Form', method: 'post', action: at.href },
      Object.entries(at.fields ?? {}).map(([name, value]) =>
        h(Form.Hidden, { name, value })
      ),
      node,
    )
    : node
}

/** The mark on an app open beside the conversation. */
export let besideMark = () =>
  h(
    Badge,
    { mod: 'quiet', className: 'Sidebar_Count', 'data-side-open': '' },
    'Open',
  )

let more = () =>
  h(
    SideNav.Link,
    {
      as: 'button',
      type: 'button',
      className: 'Sidebar_More',
      title: 'More',
      'aria-expanded': 'false',
      'data-fit-more': '',
      hidden: true,
    },
    glyph(Ellipsis),
    h(SideNav.Label, { 'data-fit-label': '' }, 'More'),
  )

/** One section of links, under its heading where it has one. The side's
 * script finds it by its `id` (`data-side-part`). */
export let section = (at: Section, collapsed: boolean) =>
  h(
    'div',
    { className: 'Sidebar_Section', 'data-side-part': at.id },
    at.heading
      ? h('h3', { className: 'Sidebar_Group', id: at.id }, at.label)
      : null,
    at.items.length
      ? h(
        SideNav,
        {
          className: 'Sidebar_Nav',
          mod: collapsed && 'rail',
          'data-fit-list': at.fit ? '' : undefined,
          'aria-labelledby': at.heading ? at.id : undefined,
          'aria-label': at.heading ? undefined : at.label,
        },
        at.items.map(link),
        at.fit ? more() : null,
      )
      : h('p', { className: 'Sidebar_None' }, at.empty),
  )

let named = (s: Picked) => s.title || s.slug

/** A space's logo, or where it has none its first letter. */
export let spaceTile = (s: Picked, mod?: string) =>
  s.logo
    ? h(Identity.Avatar, {
      as: 'img',
      mod,
      src: s.logo,
      width: 32,
      height: 32,
      alt: '',
      decoding: 'async',
    })
    : h(
      Identity.Avatar,
      { mod, 'aria-hidden': 'true' },
      named(s).charAt(0).toUpperCase(),
    )

/** How many of the person's Updates wait on them in each space, by slug,
 * once the page graph has said: the selector's badges. */
export type Counts = Map<string, number>

// The space selector over `all`, holding `here`: each space opens at `to`,
// `make` follows the list, and `about` leads the line under each space's name
// (the dashboard's side, and the Operator's chat app, which names each
// space's Operator: operator-page.ts `chatPage`), and `ask` heads the list
// (the connect dialog asks where a connection goes: desk-pages.ts `to`).
// `counted` badges each space in the list with how many of the person's
// Updates wait on them there (the Operator's), as `counts` says once it has.
// The selector itself carries no count: All Updates above it says the total.
export let choice = (
  here: Picked,
  all: Picked[],
  to: (s: Picked) => string,
  make: { href: string; label: string } | null = null,
  about: (s: Picked) => string = () => '',
  ask = 'Which space do you want to work in?',
  counted = false,
  counts?: Counts,
) => {
  let add = make
    ? h(
      Identity.Add,
      { href: make.href, title: make.label },
      glyph(Plus),
      h('span', { className: 'Sidebar_Label' }, make.label),
    )
    : null
  let box = (s: Picked, line = '') => {
    let said = [about(s), line].filter(Boolean).join(' · ')
    return [
      spaceTile(s),
      h(
        Identity.Text,
        {},
        h(Identity.Name, {}, named(s)),
        said ? h(Identity.Note, {}, said) : null,
      ),
    ]
  }
  if (all.length < 2) {
    return [
      h(Identity, { title: named(here) }, box(here)),
      add,
    ]
  }
  return h(
    Menu.Fold,
    { 'data-menu': '' },
    h(
      Menu.Summary,
      {
        as: Identity,
        title: `Change space: ${named(here)}`,
        'aria-label': `Change space: ${named(here)}`,
      },
      box(here),
      h(Identity.Action, {}, glyph(ChevronsUpDown)),
    ),
    h(
      Menu,
      { mod: 'below' },
      h(Menu.Ask, {}, ask),
      all.map((s) =>
        h(
          Menu.Item,
          {
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
          counted
            ? acrossBadge(
              s.slug,
              undefined,
              counts && (counts.get(s.slug) ?? 0),
            )
            : null,
          s.slug == here.slug ? h(Identity.Mark, {}, glyph(Check)) : null,
        )
      ),
      add ? h(Menu.Rule, {}) : null,
      add ? h(Menu.Footer, {}, add) : null,
    ),
  )
}

/** What a side drawn from rows says about the page it is on: whose it is,
 * which space it is in, and how its links lead. The page writes it on the
 * side (`data-side-view`) for its script to draw again from the rows. */
export type SideView = {
  person: string
  /** The space the side is in, as it is drawn where the person's spaces do
   * not say it. */
  here: Picked
  /** The Operator's side: the space's eid, whose apps it lists, the
   * conversation open, the app beside it, whether every space's Updates is
   * the page, and where the space's apps answer. */
  talk?: { space: string; open: string; app?: string; all: boolean; at: string }
  /** The dashboard's side: the setting open. */
  desk?: { view: Setting }
}

/** An app beside the conversation already open: every app shares the one
 * conversation, so the side keeps it lit and marks the app only Open. */
export let aboutPath = (space: string, app: string, open = 'new') =>
  `${chatPath(space, open)}?app=${encodeURIComponent(app)}`

/** What the side draws from the person's rows: their spaces in the
 * selector, Updates across them where they have several, and the apps of the
 * space it is in. `counts` are the selector's badges, once known. */
export type Parts = {
  picker: ReturnType<typeof choice>
  personal?: Section
  apps?: Section
}

/** The side's parts drawn from `spaces` and `apps`, as `view` leads them. */
export let sideParts = (
  view: SideView,
  spaces: Picked[],
  apps: MarkedApp[],
  counts?: Counts,
): Parts => {
  let { talk, desk } = view
  let here = spaces.find((s) => s.slug == view.here.slug) ?? view.here
  let all = spaces.some((s) => s.slug == here.slug) ? spaces : [here, ...spaces]
  if (desk) {
    let { view: open } = desk
    return {
      picker: choice(
        here,
        spaces,
        (s) =>
          accountView(open)
            ? `${managePath(open)}?space=${encodeURIComponent(s.slug)}`
            : managePath(
              !s.owner ? 'operator' : open == 'new' ? 'apps' : open,
              s.slug,
            ),
        { href: managePath('space'), label: 'New space' },
      ),
    }
  }
  let operator = here.operator ?? ''
  return {
    picker: choice(
      here,
      all,
      (s) => dashboardPath(s.slug),
      null,
      (s) => s.operator ?? '',
      undefined,
      true,
      counts,
    ),
    personal: spaces.length > 1
      ? {
        id: 'side-personal',
        label: 'Across your spaces',
        items: [
          {
            href: `${talkPath('updates')}?in=${encodeURIComponent(here.slug)}`,
            current: talk?.all,
            icon: Inbox,
            label: 'All updates',
            names: 'All updates',
            across: {
              count: counts && [...counts.values()].reduce((n, c) => n + c, 0),
            },
          },
        ],
      }
      : undefined,
    apps: {
      id: 'side-apps',
      label: 'Edit apps',
      heading: true,
      fit: true,
      items: apps.map((a) => ({
        href: aboutPath(here.slug, a.slug, talk?.open),
        beside: a.slug == talk?.app,
        app: a,
        warm: talk?.at ? appWarmAt(`${talk.at}/${a.slug}`) : undefined,
        icon: LayoutGrid,
        image: appMarkImage(`${talk?.at}/${a.slug}`, a),
        label: a.title || a.slug,
      })),
      empty: `None yet. Ask ${operator} to make one.`,
    },
  }
}
