import { contents, Shell } from '@yaks/ui/parts'
import { Head } from '@yaks/ui/parts'
// The dashboard's pages, apart from pages.ts so a page that only serves a
// space never compiles them. Its sidebar is composed by desk-sidebar.ts.
import { deskSide } from './desk-sidebar.ts'
import { frame, FRAMED } from './frame.ts'
import { AGENT } from './docs.ts'
import { Button, Card, Field } from '@yaks/ui/parts'
import { createElement as h } from 'react'
import { LONGEST } from '@yaks/persona/name'
import { FRAME, TITLE } from '@yaks/ui/navigate'
import {
  type ConnectionsView,
  connectionsView,
} from '@yaks/platform/connections-view'
import { pageOf } from '@yaks/platform/connections-page'
import { markup, raw } from './html.ts'
import { drawnRows } from '@yaks/platform/page-graph'
import { listedOf } from '@yaks/platform/space-apps'
import { agentsOf } from '@yaks/platform/agents'
import { type AgentsView, agentsView } from '@yaks/platform/agents-view'
import { type AppsView, appsView } from '@yaks/platform/space-apps-view'
import { type FriendsView, friendsView } from '@yaks/platform/friends-view'
import { type VisitsView, visitsView } from '@yaks/platform/visits-view'
import { countsOf } from '@yaks/platform/visit-counts'
import { addressBox, fieldsOf, saving } from '@yaks/platform/page-parts'
import { heldRows, spacePageView } from '@yaks/platform/space-pages-view'
import {
  peopleRows,
  type PeopleView,
  peopleView,
} from '@yaks/platform/people-view'
import {
  accountView,
  MANAGE,
  managePath,
  type Setting,
} from '@yaks/platform/routes'
import { apex, type Host, spaceHost, url } from '@yaks/platform/host'
import { type ProfileView, profileView } from '@yaks/platform/profile-view'
import {
  accountOf,
  chatLinksOf,
  inviteOf,
  sharedOf,
  signedInOf,
} from '@yaks/platform/account-rows'
import { type InviteView, inviteView } from '@yaks/platform/invite-view'
import { type SharedView, sharedView } from '@yaks/platform/shared-view'
import { appsOf, pickedOf } from '@yaks/platform/side-rows'
import { domainRenewals } from '@yaks/platform/domain-pages'
import {
  paymentOf,
  type PaymentView,
  paymentView,
} from '@yaks/platform/payment-view'
import { Yak } from './mascot.ts'

import {
  type DeskPage,
  heading,
  type Kids,
  labeled,
  page,
  type Picked,
  said,
} from './pages.ts'

let picked = (at: DeskPage) =>
  at.spaces?.find((s) => s.slug == at.space) ??
    { slug: at.space, title: '', owner: !at.member, own: false }
let named = (s: Pick<Picked, 'slug' | 'title'>) => s.title || s.slug

// A dashboard page in the frame (frame.ts), as every one is drawn (`desk`,
// and the platform's admin directory, admin.ts `desk`): a sheet under the
// head that names it, the side beside it, and on a phone the frame's bar
// naming it too, whose Menu opens the side over the whole screen. A page of
// more than a few sections wears what is on it beside it, or at its top on a
// phone (@yaks/ui `Contents`): made in the browser from the page's own
// section headings, a card's title or a group's, but not those of the cards
// in a grid, which are the things a section lists.
let SECTIONS =
  '.Desk_Content :is(.Card_Title, .Group):not(:is(.Cards, .Modal) *)'

export let deskFrame = (
  at: {
    sidebar: Kids
    title: string
    sub: Kids
    head: Kids
    content: Kids
    class?: string
    person?: string
    apex?: string
    /** the path whose pages share this frame (@yaks/ui/navigate `FRAME`):
     * a press on a link to one draws its heading over an empty body at once */
    framed?: string
    /** what the frame's heading says above its title, as the page's does */
    eyebrow?: Kids
  },
) =>
  frame({
    friends: at.person && at.apex
      ? { person: at.person, apex: at.apex }
      : undefined,
    side: at.sidebar,
    title: at.title,
    sub: at.sub,
    headed: true,
    sheet: true,
    content: h(
      'div',
      { className: 'Desk_Body', 'data-contents-root': '' },
      at.framed
        ? h(
          'template',
          { [FRAME]: at.framed },
          h(
            'header',
            { className: 'Desk_Head' },
            h(
              'div',
              null,
              at.eyebrow == null ? null : h(Head.Eyebrow, {}, at.eyebrow),
              h(Head.Title, { mod: 'page', [TITLE]: '' }),
            ),
          ),
          h(Shell.Content, {
            className: ['Desk_Content', at.class].filter(Boolean).join(' '),
          }),
        )
        : null,
      h('header', { className: 'Desk_Head' }, at.head),
      contents({ class: 'Desk_Contents', from: SECTIONS }),
      h(Shell.Content, {
        className: ['Desk_Content', at.class].filter(Boolean).join(' '),
        'data-save-person': at.person,
      }, at.content),
    ),
  })

// Shared with you (Your account), drawn from the person's rows as the
// browser draws it again (@yaks/platform/shared-view), which the page carries
// for its first paint (`data-view`).
let sharedPage = (at: DeskPage, env: Host) => {
  let view: SharedView = { person: at.person ?? '', apex: apex(env) }
  return h(
    'div',
    { 'data-view': 'shared', 'data-shared-view': JSON.stringify(view) },
    sharedView(view, sharedOf(at.drawn ?? [])),
    drawing(at),
  )
}

// Invite a friend (Your account), drawn from the person's invite and spaces
// as the browser draws it again (@yaks/platform/invite-view), which the page
// carries for its first paint (`data-view`).
let invitePage = (at: DeskPage, env: Host) => {
  let rows = at.drawn ?? []
  let invite = inviteOf(rows)
  if (!invite) return null
  let view: InviteView = { person: at.person ?? '', apex: apex(env) }
  return h(
    'div',
    { 'data-view': 'invite', 'data-invite-view': JSON.stringify(view) },
    inviteView(view, invite, pickedOf(rows)),
    drawing(at),
  )
}

// Apps, drawn from the space's rows as the browser draws it again
// (@yaks/platform/space-apps-view), which the page carries for its first
// paint (`data-view`).
export let library = (at: DeskPage, env: Host) => {
  let view: AppsView = {
    person: at.person ?? '',
    space: { eid: at.spaceEid ?? '', slug: at.space },
    host: spaceHost(env, at.space),
    agent: url(env, AGENT.path),
    sift: at.sift ?? { q: '', sort: '' },
  }
  let rows = at.drawn ?? []
  return h(
    'div',
    { 'data-view': 'apps', 'data-apps-view': JSON.stringify(view) },
    appsView(view, {
      apps: listedOf(rows, view.space.eid, rows),
      agents: agentsOf(rows)?.length,
    }),
    drawing(at),
  )
}

// Agents (Your account) and a space's New app, drawn from the agents the
// person connected as the browser draws them again
// (@yaks/platform/agents-view), which the page carries for its first paint
// (`data-view`).
let agentsPage = (at: DeskPage, env: Host, page: 'agents' | 'new') => {
  let view: AgentsView = {
    person: at.person ?? '',
    page,
    env: { APEX: apex(env) },
    agent: url(env, AGENT.path),
    ...page == 'new' ? { space: at.space } : {},
  }
  return h(
    'div',
    { 'data-view': 'agents', 'data-agents-view': JSON.stringify(view) },
    agentsView(view, agentsOf(at.drawn ?? [])),
    drawing(at),
  )
}

// Profile (Your account), drawn from the person's rows as the browser draws
// it again (@yaks/platform/profile-view), which the page carries for its
// first paint (`data-view`).
let profile = (at: DeskPage, env: Host) => {
  let view: ProfileView = {
    person: at.person ?? '',
    apex: apex(env),
    session: at.session,
  }
  let rows = at.drawn ?? []
  return h(
    'div',
    { 'data-view': 'profile', 'data-profile-view': JSON.stringify(view) },
    profileView(
      view,
      accountOf(rows) ?? { name: '', email: '', hidden: false },
      pickedOf(rows),
      signedInOf(rows),
      chatLinksOf(rows),
    ),
    drawing(at),
  )
}

// The rows the page was drawn from, carried for its first paint
// (@yaks/platform/page-graph `drawnRows`).
let drawing = (at: DeskPage) =>
  at.drawn && at.person
    ? h('script', {
      type: 'application/json',
      'data-page-graph': '',
      dangerouslySetInnerHTML: { __html: drawnRows(at.person, at.drawn) },
    })
    : null

// A space's Connections, drawn from its `connectionsPage` row as the browser
// draws it again (@yaks/platform/connections-view), which the page carries
// for its first paint (`data-view`).
let connectionsPage = (at: DeskPage, env: Host) => {
  let rows = at.drawn ?? []
  let row = rows.find((r) => r.connectionsPage)?.connectionsPage as
    | { space: string; ask: string }
    | undefined
  let c = pageOf(rows)
  if (!row || !c) return null
  let view: ConnectionsView = {
    person: at.person ?? '',
    space: { eid: row.space, slug: at.space },
    env: { APEX: apex(env) },
    spaces: at.spaces ?? [],
    ask: row.ask,
  }
  return h(
    'div',
    {
      'data-view': 'connections',
      'data-connections-view': JSON.stringify(view),
    },
    connectionsView(view, c),
    drawing(at),
  )
}

// Friends (Your account): what the person sets about friends, drawn from
// their account row as the browser draws it again
// (@yaks/platform/friends-view), which the page carries for its first paint
// (`data-view`). Friends themselves are over every page (frame.ts).
let friendsPage = (at: DeskPage) => {
  let view: FriendsView = { person: at.person ?? '' }
  return h(
    'div',
    { 'data-view': 'friends', 'data-friends-view': JSON.stringify(view) },
    friendsView(view, { hidden: !!at.presenceHidden }),
    drawing(at),
  )
}

// Visits (a space's), drawn from its apps and their views as the browser
// draws it again (@yaks/platform/visits-view), which the page carries for its
// first paint (`data-view`).
let visitsPage = (at: DeskPage, site: string) => {
  let view: VisitsView = {
    person: at.person ?? '',
    space: at.spaceEid ?? '',
    site,
    bots: !!at.bots,
  }
  let rows = at.drawn ?? []
  return h(
    'div',
    { 'data-view': 'visits', 'data-visits-view': JSON.stringify(view) },
    visitsView(
      view,
      appsOf(rows, view.space),
      countsOf(rows, view.space, view.bots),
    ),
    drawing(at),
  )
}

// A new space (from the selector's + New space): its name, its address and
// its Operator's name, space_new as the assistant asks it.
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
          addressBox('space-slug', 'slug', at.made?.slug ?? '', apex(env), {
            required: true,
          }),
        ),
        labeled(
          'space-operator',
          "Operator's name",
          h(Field, {
            id: 'space-operator',
            name: 'operator',
            maxlength: LONGEST,
            placeholder: 'Picked for you',
            value: at.made?.operator ?? '',
          }),
        ),
      ),
    ),
    'Create space',
  )

// A space's Settings, Domains and Trash, drawn from its rows as the browser
// draws them again (@yaks/platform/space-pages-view), which the page carries
// for its first paint (`data-view`).
let spacePage = (at: DeskPage) => {
  let view = at.spaceView!
  let rows = heldRows(view, at.held ?? { settings: [], apps: [] })
  return h(
    'div',
    { 'data-view': 'space-page', 'data-space-view': JSON.stringify(view) },
    rows ? spacePageView(view, rows) : null,
    drawing(at),
  )
}

// Selling and Billing, drawn from the space's rows as the browser draws them
// again (@yaks/platform/payment-view), which the page carries for its first
// paint (`data-view`).
let payment = (at: DeskPage, env: Host, view: 'selling' | 'billing') => {
  let rows = at.drawn ?? []
  let shown: PaymentView = {
    person: at.person ?? '',
    view,
    space: { eid: at.spaceEid ?? '', slug: at.space, title: named(picked(at)) },
    apex: apex(env),
    loading: markup(h(Yak, { pose: 'calculating' })),
  }
  let drawn = paymentOf(shown.space.eid, rows)
  return h(
    'div',
    { 'data-view': 'payment', 'data-payment-view': JSON.stringify(shown) },
    drawn ? paymentView(shown, drawn) : null,
    drawing(at),
  )
}

// Who is in the space and its apps, drawn from the owner's rows as the
// browser draws it again (@yaks/platform/people-view), which the page carries
// for its first paint (`data-view`).
let peoplePage = (at: DeskPage) => {
  if (!at.person || !at.spaceEid || !at.drawn) return null
  let view: PeopleView = {
    person: at.person,
    space: { eid: at.spaceEid, slug: at.space },
  }
  let rows = at.drawn
  return h(
    'div',
    { 'data-view': 'people', 'data-people-view': JSON.stringify(view) },
    peopleView(
      view,
      peopleRows(view, {
        holders: rows,
        admitted: rows,
        apps: rows,
        spaces: rows,
        friends: rows,
      }),
    ),
    drawing(at),
  )
}

// The dashboard's page for one space, at the apex (apps.ts `manage`). What
// it aims at the space itself (an app, the drop zone) it names by the space's
// own address.
export let desk = (at: DeskPage, env: Host = {}) => {
  let view = at.view ?? 'apps'
  let site = `https://${spaceHost(env, at.space)}`
  let titles = {
    profile: 'Profile',
    friends: 'Friends',
    invite: 'Invite a friend',
    agents: 'Agents',
    shared: 'Shared with you',
    space: 'New space',
    operator: 'Operator',
    apps: 'Apps',
    people: 'People',
    connections: 'Connections',
    new: 'New app',
    visits: 'Visits',
    selling: 'Selling',
    settings: 'Space settings',
    billing: 'Billing',
    domains: 'Domains',
    trash: 'Trash',
  } satisfies Record<Setting, string>
  // The line over the title names whose the page is: the person's own, or
  // the space it changes.
  let space = accountView(view) ? null : picked(at)
  let whose = space ? named(space) : 'Your account'
  let body: Kids = null
  if (view == 'profile') body = profile(at, env)
  if (view == 'friends') body = friendsPage(at)
  if (view == 'invite') body = invitePage(at, env)
  if (view == 'shared') body = sharedPage(at, env)
  if (view == 'space') body = newSpace(at, env)
  if (view == 'apps') body = library(at, env)
  if (view == 'agents' || view == 'new') body = agentsPage(at, env, view)
  if (view == 'visits') body = visitsPage(at, site)
  if (view == 'selling') body = payment(at, env, 'selling')
  if (view == 'settings' || view == 'domains' || view == 'trash') {
    body = spacePage(at)
  }
  if (view == 'billing') {
    body = [
      at.member ? null : payment(at, env, 'billing'),
      at.support,
      at.member ? null : domainRenewals(at.space, at.renewals ?? []),
    ]
  }
  if (view == 'connections') body = connectionsPage(at, env)
  if (view == 'people') body = peoplePage(at)
  // The Operator's page is drawn by operator-page.ts, as markup.
  if (view == 'operator') body = at.operator ? raw(at.operator) : null
  return page(
    env,
    {
      title: `${titles[view]} · ${whose}`,
      head: space?.logo
        ? markup(h('link', { rel: 'icon', href: space.logo }))
        : undefined,
      status: at.no ? 400 : 200,
      headers: {
        'cache-control': 'private, no-store',
        'x-robots-tag': 'noindex',
      },
      layout: FRAMED,
    },
    deskFrame({
      sidebar: deskSide(at, view, env),
      person: at.person,
      apex: apex(env),
      title: titles[view],
      sub: whose,
      // A press on another of the space's pages draws its heading at once,
      // and the page under it as it comes.
      framed: `${MANAGE}/${encodeURIComponent(at.space)}`,
      eyebrow: whose,
      head: [
        h(
          'div',
          null,
          h(Head.Eyebrow, {}, whose),
          h(Head.Title, { mod: 'page' }, titles[view]),
          view == 'visits'
            ? h(Head.Period, {}, `Last ${at.viewDays ?? 30} days`)
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
  )
}
