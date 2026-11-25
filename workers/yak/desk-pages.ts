import { contents, Shell } from '@yaks/ui/parts'
import { Head } from '@yaks/ui/parts'
// The dashboard's pages, apart from pages.ts so a page that only serves a
// space never compiles them. Its sidebar is composed by desk-sidebar.ts.
import { deskSide } from './desk-sidebar.ts'
import { frame, FRAMED } from './frame.ts'
import { agentSetup } from './signin-pages.ts'
import { AGENT } from './docs.ts'
import { Button, Card, Field, Form, Rows, TabSet } from '@yaks/ui/parts'
import { h } from 'preact'
import {
  type ConnectionsView,
  connectionsView,
} from '@yaks/platform/connections-view'
import { pageOf } from '@yaks/platform/connections-page'
import { agentList, agentLive } from './connected_ui.ts'
import { markup, raw } from './html.ts'
import { drawnRows } from '@yaks/platform/page-graph'
import { agentsOf, listedOf } from '@yaks/platform/space-apps'
import {
  type AppsView,
  appsView,
  connectCard as connecting,
} from '@yaks/platform/space-apps-view'
import { type FriendsView, friendsView } from '@yaks/platform/friends-view'
import { type VisitsView, visitsView } from '@yaks/platform/visits-view'
import { countsOf } from '@yaks/platform/visit-counts'
import { addressBox, empty, fieldsOf, saving } from '@yaks/platform/page-parts'
import { heldRows, spacePageView } from '@yaks/platform/space-pages-view'
import { tile } from './render/mod.ts'
import {
  peopleRows,
  type PeopleView,
  peopleView,
} from '@yaks/platform/people-view'
import { type Invitation, qr } from './referral.ts'
import { accountView, managePath, type Setting } from '@yaks/platform/routes'
import { apex, type Host, spaceHost, url } from '@yaks/platform/host'
import { type ProfileView, profileView } from '@yaks/platform/profile-view'
import { accountOf, signedInOf } from '@yaks/platform/account-rows'
import { appsOf, pickedOf } from '@yaks/platform/side-rows'
import { STARTER } from '@yaks/platform/plans'
import { domainRenewals } from '@yaks/platform/domain-pages'
import {
  paymentOf,
  type PaymentView,
  paymentView,
} from '@yaks/platform/payment-view'
import { yak } from './mascot.ts'

import {
  copying,
  type DeskPage,
  dropping,
  dropZone,
  firstAsk,
  heading,
  type Kids,
  labeled,
  page,
  type Picked,
  said,
  state,
  tabbing,
} from './pages.ts'

// The New app screen's own way to ask: the person's words, sent to their
// Operator's door as a request for a new app (operator-channels.ts
// `new_app`), which sends them on to that conversation, where the app opens
// beside the chat as it is made. The dashboard's page is at the apex, as that
// door is.
let asking = (space: string) =>
  h(
    Card,
    null,
    heading('Ask your Operator'),
    h(
      Card.Sub,
      null,
      'Say what the app is for. Your Operator builds it in your conversation.',
    ),
    h(
      'form',
      {
        class: 'Desk_Ask Page_Form',
        method: 'post',
        action: managePath('operator', space),
        enctype: 'multipart/form-data',
      },
      h(Form.Hidden, {
        name: 'page',
        value: managePath('new', space),
      }),
      h(Form.Hidden, { name: 'new_app', value: '1' }),
      h(
        'p',
        null,
        h(Field, {
          class: 'Desk_Words',
          placeholder: 'Describe the app you need…',
          lines: true,
          name: 'say',
          rows: 3,
          required: true,
          'aria-label': 'What do you want to build?',
        }),
      ),
      h(Button, { mod: 'go', type: 'submit' }, 'Build it'),
    ),
  )

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
  },
) =>
  frame({
    side: at.sidebar,
    title: at.title,
    sub: at.sub,
    headed: true,
    sheet: true,
    content: h(
      'div',
      { class: 'Desk_Body', 'data-contents-root': '' },
      h('header', { class: 'Desk_Head' }, at.head),
      contents({ class: 'Desk_Contents', from: SECTIONS }),
      h(Shell.Content, {
        class: ['Desk_Content', at.class].filter(Boolean).join(' '),
        'data-save-person': at.person,
      }, at.content),
    ),
  })

// Where a person who has not connected an agent is asked to
// (@yaks/platform/space-apps-view `connectCard`).
let connectCard = (at: DeskPage, env: Host) =>
  connecting(at.agents?.length, url(env, AGENT.path))

// What others let this person into (Your account › Shared with you): drawn by
// the same Tile as their own, each with the address it lives at.
let sharedWith = (at: DeskPage, env: Host) =>
  at.shared?.length
    ? h(
      Card,
      null,
      h(
        Rows,
        { as: 'ul' },
        at.shared.map((a) => {
          let host = spaceHost(env, a.space)
          return tile(a, { at: `https://${host}`, host, editor: true })
        }),
      ),
    )
    : empty(
      'Nothing shared with you yet',
      h(
        'p',
        null,
        'An app someone invites you to, in a space of theirs, appears here.',
      ),
    )

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
      agents: agentsOf(rows),
    }),
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
    links: at.links ?? [],
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

// Friends (Your account), drawn from the person's rows as the browser draws
// it again (@yaks/platform/friends-view), which the page carries for its
// first paint (`data-view`).
let friendsPage = (at: DeskPage, env: Host) => {
  let view: FriendsView = {
    person: at.person ?? '',
    apex: apex(env),
    all: !!at.allFriends,
  }
  return h(
    'div',
    { 'data-view': 'friends', 'data-friends-view': JSON.stringify(view) },
    friendsView(view, at.friendList ?? [], { hidden: !!at.presenceHidden }),
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
  }
  let rows = at.drawn ?? []
  return h(
    'div',
    { 'data-view': 'visits', 'data-visits-view': JSON.stringify(view) },
    visitsView(
      view,
      appsOf(rows, view.space),
      countsOf(rows, view.space),
    ),
    drawing(at),
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
      `Show this to a friend. They scan it with their phone’s camera and send what opens: that signs them up, with their own space ready, $${STARTER} of building credit and its Operator writing back.`,
    ),
    h(
      TabSet,
      { class: 'Invite' },
      h(TabSet.Legend, null, 'Sign up by'),
      ways.map((w, i) =>
        h(
          TabSet.Item,
          null,
          h(TabSet.Input, {
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
          addressBox('space-slug', 'slug', at.made?.slug ?? '', apex(env), {
            required: true,
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
    loading: markup(yak('calculating')),
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
  if (view == 'friends') body = friendsPage(at, env)
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
        { class: 'Desk_Start', ...state(true, at.agents?.length) },
        heading('Ask your agent for a new yaks app'),
        agentList(at.agents ?? [], 'links'),
        h(Form.Field, null, h(Form.Label, { as: 'p' }, 'Try this'), firstAsk()),
      ),
      connectCard(at, env),
      h(
        'div',
        { class: 'Desk_Options' },
        asking(at.space),
        h(
          Card,
          null,
          heading('Upload your website'),
          dropZone(undefined, `${site}/deploy`),
        ),
      ),
      dropping(),
    ]
  }
  if (view == 'visits') body = visitsPage(at, site)
  if (view == 'selling') body = payment(at, env, 'selling')
  if (view == 'settings' || view == 'domains' || view == 'trash') {
    body = spacePage(at)
  }
  if (view == 'billing') {
    body = [
      payment(at, env, 'billing'),
      domainRenewals(at.space, at.renewals ?? []),
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
      title: titles[view],
      sub: whose,
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
    view == 'new' ? copying() : null,
    ['new', 'agents'].includes(view) ? agentLive('/oauth/agents') : null,
  )
}
