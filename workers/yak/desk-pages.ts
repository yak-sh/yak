// The dashboard's pages (manage.ts, admin.ts, operator-page.ts): a space's
// desk and each of its pages, the side that picks a space, and the person's
// own. Apart from pages.ts, so a page that only serves a space never compiles
// them (T-148886).
import { agentSetup, pasteLink } from './signin-pages.ts'
import {
  Button,
  Card,
  Chip,
  Chips,
  Empty,
  Field,
  Form,
  Grid,
  Group,
  Icon,
  More,
  Notice,
  Report,
  Rows,
  SideNav,
  TabSet,
} from '@yaks/ui/parts'
import { h, type VNode } from 'preact'
import type {
  Borrowed,
  Connections,
  Face,
  Offered,
  Shown,
  Using,
} from './connections.ts'
import { INTEGRATIONS } from './integrations.ts'
import { agentList, agentLive } from './connected_ui.ts'
import { type IconName, icons } from './icons.ts'
import { day, fileDrop, raw } from './html.ts'
import { LOGO } from './logo.ts'
import { holder, tile } from './render/mod.ts'
import type { Person } from './people.ts'
import { type Invitation, qr } from './referral.ts'
import {
  accountView,
  chatPath,
  enabling,
  LOGOUT,
  MANAGE,
  managePath,
  type ManageView,
} from './route.ts'
import { apex, type Host, spaceHost, url } from './host.ts'
import { type Ceiling, count, PRICE, share, size, WARN } from './meter.ts'
import { columns } from '@yaks/ui/chart'

import {
  about,
  addressBox,
  billButton,
  billing,
  chatAsk,
  chatLive,
  copying,
  type DeskPage,
  dropping,
  dropZone,
  firstAsk,
  fixing,
  heading,
  held,
  howTo,
  keyBox,
  type Kids,
  labeled,
  logo,
  MOVES,
  page,
  type Picked,
  plan,
  said,
  send,
  sentence,
  type Side,
  state,
  status,
  tabbing,
  transcript,
  type Visits,
} from './pages.ts'

// The meter's prices are whole US dollars, as on the public pricing page.
let plusPrice = () => `$${count(PRICE.plus)}`

// A label for what may be left empty.
let optional = (label: Kids) => [
  label,
  ' ',
  h(Form.Optional, null, '(optional)'),
]

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

// Words beside an icon of the side, which its rail does not show: still the
// element's accessible text, and said by its title.
export let worded = (words: Kids) => h('span', { class: 'Desk_Label' }, words)

/**
 * The side's own button (T-151458): it collapses the side to a rail of its
 * icons, and opens it again. It is a form keeping the choice on the person's
 * row (`desk_sidebar{collapsed}`, manage.ts `account`), so it holds on every page
 * and device; public/side.js sends it without leaving the page, and sets
 * `rail`, the body's modifier, and `SideNav-rail` on the side's navs. Without
 * script the page is drawn again at `back`, the page it was pressed on.
 */
export let fold = (collapsed: boolean, back: string, rail: string) => {
  let said = collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'
  return h(
    'form',
    {
      class: 'Desk_Fold',
      method: 'post',
      action: managePath('profile'),
      'data-side': rail,
    },
    h('input', {
      type: 'hidden',
      name: 'sidebar',
      value: collapsed ? 'open' : 'collapsed',
    }),
    h('input', { type: 'hidden', name: 'back', value: back }),
    h(
      Button,
      {
        type: 'submit',
        class: 'Desk_Folder',
        title: said,
        'aria-label': said,
        'aria-controls': 'menu',
        'aria-expanded': String(!collapsed),
      },
      h(Icon, { of: icons['panel-left-close'], class: 'Desk_Shut' }),
      h(Icon, { of: icons['panel-left-open'], class: 'Desk_Unshut' }),
    ),
  )
}

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
      {
        href: to,
        title: label,
        mod: on && 'on',
        'aria-current': on ? 'page' : undefined,
      },
      glyph(navIcons[key]),
      h(SideNav.Label, null, label),
      key == 'trash' && at.trash?.length
        ? h('span', { class: 'Desk_Count' }, at.trash.length)
        : null,
    )
  }
  let { title, back } = yourOperator(at)
  let operator = link('operator', title)
  let host = spaceHost(env, at.space)
  let rail = at.collapsed ? 'rail' : undefined
  return {
    label: 'Manage',
    top: [
      h(
        Button,
        {
          mod: 'go',
          class: 'Desk_Back',
          href: chatPath(at.space),
          title: `Back to ${back}`,
          'aria-label': `Back to ${back}`,
        },
        glyph('chevron-left'),
        // The Operator's name, and before it "Back to" where the button has
        // room for both on its one line (pages.css `.Desk_Way`).
        h(
          'span',
          { class: 'Desk_Label Desk_Way' },
          h('span', { class: 'Desk_To' }, back),
          h('span', null, 'Back to'),
        ),
      ),
      fold(!!at.collapsed, managePath(view, at.space), 'Desk-rail'),
    ],
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
            { 'aria-labelledby': 'side-space', mod: rail },
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
          { 'aria-labelledby': 'side-account', mod: rail },
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
          {
            href: `https://${host}/`,
            target: '_blank',
            rel: 'noopener',
            title: `Open ${host}`,
          },
          glyph('external-link'),
          worded(`Open ${host}`),
        ),
        h(
          'a',
          {
            href: url(env, '/help'),
            target: '_blank',
            rel: 'noopener',
            title: 'Help',
          },
          glyph('circle-question-mark'),
          worded('Help'),
        ),
        h(
          'form',
          { method: 'post', action: url(env, LOGOUT) },
          h(
            'button',
            { class: 'Desk_Out', type: 'submit', title: 'Sign out' },
            glyph('log-out'),
            worded('Sign out'),
          ),
        ),
      ),
    ],
  }
}

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
    h(
      'a',
      { class: 'Desk_New', href: managePath('space'), title: 'New space' },
      glyph('plus'),
      worded('New space'),
    ),
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
      {
        class: 'Desk_Space',
        title: `Change space: ${named(here)}`,
        'aria-label': `Change space: ${named(here)}`,
      },
      box(here),
      h('span', { class: 'Desk_Change' }, glyph('chevrons-up-down')),
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
    { class: 'Desk_Connect', ...state(false, at.agents) },
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
              made: a.made,
              deployed: a.deployed,
              writers: at.writers,
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
          state(true, at.agents),
          h('p', null, 'Ask your agent for your first app. Try this:'),
          firstAsk(),
        ),
        h(
          'div',
          state(false, at.agents),
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

// How a connection stands, as its head says it.
let STATUS = {
  needed: 'Needs connecting',
  connected: 'Connected',
  broken: 'Needs reconnecting',
}

// Where a key may be sent, said once beside wherever it is pasted.
// Addresses, each as code, a comma apart.
let codes = (hosts: string[]) =>
  hosts.flatMap((x, i) => [i ? ', ' : null, h('code', null, x)])

let reach = (hosts: string[]) =>
  hosts.length
    ? ['yaks.app keeps it and only ever sends it to ', codes(hosts), '.']
    : null

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

// A connection, a service or a loan as a card in a grid: its logo, name and
// one line, how it stands where it is connected, and the one link that opens
// the rest. What it asks for and how to get it are behind that link, drawn
// whole at the top of the page (`setup`).
let card = (
  env: Host,
  face: Face,
  line: Kids,
  go: Kids,
  stands: Kids = null,
) =>
  h(
    Card,
    null,
    heading(face.title, { mark: logo(face, env), status: stands }),
    line ? h(Card.Sub, null, line) : null,
    go ? h(Card.Actions, null, go) : null,
  )

// The link a card's button follows: this page, opened on one thing.
let openedOn = (action: string, key: string, value: string) => {
  let to = new URL(action, 'https://page.invalid')
  to.searchParams.set(key, value)
  return `${to.pathname}${to.search}#connect`
}

// The page: one space's connections, short on first visit. Each thing is a
// card in a grid, and what it asks for (a key, a sign-in, how to get one) is
// behind its button: Connect, or Manage for one already connected, which
// opens the page on it (`?connect=<eid>`, `?add=<name>`) with it drawn whole
// at the top, saying which space it goes to. Under that, what agents asked
// this space for and nobody has connected yet, then what is connected (on the
// person's own space, theirs too: what they connected for apps that ask each
// person, and the services holding a grant from them), then the catalog:
// featured services, or what a search found, every service a broker lists
// among them, and a key for a service nobody lists.
let connections = (at: DeskPage, env: Host) => {
  let c: Connections = at.connections ?? {
    on: false,
    list: [],
    services: [],
    built: [],
    borrowed: [],
  }
  let host = spaceHost(env, at.space)
  let action = enabling(managePath('connections', at.space), c.enable)
  // The service the page was opened to add: a key to paste, or a sign-in to
  // start, and which space it goes to.
  let offer = (i: Offered) =>
    h(
      Card,
      { as: 'form', method: 'post', action },
      held('integration', i.name),
      heading(`Connect ${i.face.title}`, {
        mark: logo(i.face, env),
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
    h(
      Card.Sub,
      null,
      "For a service your apps call that isn't listed. Services others have added are in the ",
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
          placeholder:
            'Where to sign up, which page gives the key, and what to paste',
        }),
      ),
      h(Form.Actions, null, press('add', 'Save key', false)),
    ),
  )
  // What the space holds already that could replace a loan: a connected
  // connection through the same service.
  let mine = (b: Borrowed) =>
    c.list.find((one) =>
      !one.own && one.integration == b.integration &&
      one.status == 'connected' && !one.failed && !one.each
    )
  // What agents asked for and nobody connected: an app's ask, never the
  // space's side of an ask each person answers with their own.
  let asks = c.list.filter((one) =>
    one.status == 'needed' && !one.own && !one.each
  )
  let rest = c.list.filter((one) => !asks.includes(one))
  // The one the page was opened on, drawn whole: a connection, a loan, or a
  // service to add.
  let open = c.open ? c.list.find((one) => one.eid == c.open) : undefined
  let loan = c.open ? c.borrowed.find((b) => b.eid == c.open) : undefined
  let manage = (eid: string, label: string) =>
    h(Button, { href: openedOn(action, 'connect', eid) }, label)
  let shown = (one: Shown) =>
    card(
      env,
      one.face,
      one.each && !one.own
        ? `Each person connects their own, from ${
          one.apps.map((a) => a.title).join(', ') || 'the app'
        }.`
        : one.apps.length
        ? `For ${one.apps.map((a) => a.title).join(', ')}`
        : one.face.tagline,
      manage(
        one.eid,
        one.status == 'needed'
          ? 'Connect'
          : one.status == 'broken' || one.failed
          ? 'Reconnect'
          : 'Manage',
      ),
      one.status == 'needed' ? null : status(
        one.failed ? 'Not saved' : STATUS[one.status],
        one.status == 'connected' && !one.failed ? 'positive' : 'negative',
      ),
    )
  let grid = (cards: Kids[]) => cards.length ? h(Grid, null, cards) : null
  let group = (title: Kids, ...kids: Kids[]) =>
    kids.some(Boolean) ? [h(Group, null, title), kids] : null
  let yours = [
    ...rest.filter((one) => one.own).map(shown),
    ...c.services.map((s) =>
      card(
        env,
        { title: s.name, logo: '', image: '' } as Face,
        `Signed in with your yaks.app account on ${
          day(new Date(s.connectedAt * 1000).toISOString())
        }.`,
        null,
        status('Connected', 'positive'),
      )
    ),
  ]
  let here = [
    ...rest.filter((one) => !one.own).map(shown),
    ...c.borrowed.map((b) =>
      card(
        env,
        b.face,
        `${b.app.title} borrows ${b.lender}’s`,
        manage(b.eid, 'Manage'),
        status('Borrowed', 'positive'),
      )
    ),
  ]
  // The catalog: a search box over every service, what it found or the
  // featured ones, and the kinds to look through.
  let cat = c.catalog
  let tile = (i: Offered) =>
    card(
      env,
      i.face,
      i.face.tagline,
      h(Button, { href: openedOn(action, 'add', i.name) }, 'Connect'),
    )
  let finding = cat
    ? h(
      Form,
      {
        method: 'get',
        action: managePath('connections', at.space),
        role: 'search',
        'data-find': '',
      },
      c.enable?.length ? held('enable', c.enable.join(',')) : null,
      h(
        Form.Line,
        null,
        h(Field, {
          type: 'search',
          name: 'q',
          value: cat.q,
          placeholder: `Search ${count(cat.total)} services`,
          'aria-label': 'Search services',
          autocomplete: 'off',
        }),
        h(Button, { type: 'submit' }, 'Search'),
      ),
    )
    : null
  let browse = (k: { name: string; label: string }) =>
    h(Chip, {
      as: 'a',
      href: `${managePath('connections', at.space)}?q=${
        encodeURIComponent(k.name)
      }#find`,
    }, k.label)
  let found = cat?.q
    ? [
      h(
        Card.Sub,
        null,
        cat.matched
          ? cat.matched > cat.found.length
            ? `The first ${cat.found.length} of ${
              count(cat.matched)
            } services matching “${cat.q}”.`
            : `${
              cat.matched == 1
                ? 'One service matches'
                : `${cat.matched} services match`
            } “${cat.q}”.`
          : `No service matches “${cat.q}”. Add a key for it below.`,
      ),
      grid(cat.found.map(tile)),
    ]
    : cat
    ? [
      grid(cat.featured.map(tile)),
      cat.kinds.length
        ? h(Chips, null, cat.kinds.slice(0, 16).map(browse))
        : null,
    ]
    : grid(c.built.map(tile))
  // At the top, the one the page was opened on, saying where it goes, and
  // the other spaces it could go to instead.
  let elsewhere = (at.spaces ?? []).filter((s) => s.owner && s.slug != at.space)
  let to = (what: string, other?: (slug: string) => string) =>
    h(
      Card.Sub,
      null,
      `${what} ${host}, for its apps to use.`,
      other && elsewhere.length
        ? [
          ' Connect it to another space instead: ',
          elsewhere.flatMap((s, i) => [
            i ? ', ' : '',
            h('a', { href: other(s.slug) }, s.title || s.slug),
          ]),
          '.',
        ]
        : null,
    )
  let addTo = (name: string) => (slug: string) =>
    openedOn(managePath('connections', slug), 'add', name)
  let setup = c.asked
    ? [to('It will be connected to', addTo(c.asked.name)), offer(c.asked)]
    : open
    ? [
      open.own ? null : to(
        open.status == 'needed' ? 'It will be connected to' : 'Connected for',
      ),
      connection(open, c.on, action),
    ]
    : loan
    ? [borrowing(loan, c.on, action, mine(loan))]
    : null
  let back = setup
    ? h(
      'p',
      null,
      h(
        'a',
        { href: managePath('connections', at.space) },
        'Back to all connections',
      ),
    )
    : null
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
    setup ? h('div', { id: 'connect' }, setup, back) : null,
    group('Requested by agents', grid(asks.map(shown))),
    group('Yours', grid(yours)),
    group(yours.length ? `Connected for ${host}` : 'Connected', grid(here)),
    c.list.length || c.services.length || c.borrowed.length ? null : empty(
      'No connections yet',
      h(
        'p',
        null,
        'Connect a service below, or ask an agent to build an app that uses one: what it asks for shows up here.',
      ),
    ),
    h(Group, { id: 'find' }, 'All services'),
    finding,
    h('div', { 'data-found': '' }, found),
    c.on
      ? h(
        More,
        null,
        h('summary', null, 'Add a key for a service not listed'),
        h(More.Body, null, add),
      )
      : null,
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
        { class: 'Desk_Start', ...state(true, at.agents) },
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
      layout: at.collapsed ? 'Desk Desk-rail' : 'Desk',
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
  [
    'seconds',
    'Compute seconds',
    count,
    'The sandbox, and compiling at deploy.',
  ],
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
