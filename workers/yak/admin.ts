// The platform admin's directory (T-124291): every person, space and app on
// yaks.app and what each uses, at /admin on the apex. A person's row says
// what the spaces they own spent this month (each against its own budget), the
// storage and apps of the spaces they own, and when they were last active; a
// space's says its own spend, storage, apps and latest use; an app's, its
// requests, visits, storage, version, owners, last deploy, last write to its
// store, last error and latest use. Each opens to a page of its own. The
// Invites page says who signed up through whose invite and the month each
// first app gave, and who was given the starter and when. The Visitor builds
// page says how many builds the home page's box opened today against the
// day's cap, what each spent against its budget and which were kept by
// signing up (newcomer.ts, D-146737).
//
// Only an owner of the `yak` space sees it, signed in by the platform's
// session cookie (`staff`); anybody else is told nothing is here, and an
// agent reads the same rows through `yak admin query yak/platform`. It only
// reads: six directory reads a page, one trip together, nothing written and
// no socket, so an open tab costs the directory nothing. What a row says is
// kept on the rows as the app changes (used.ts, usage.ts), so no store, tracker
// or analytics read waits under a list.
//
// The rows and pages are drawn by the worker's registry (render/directory.ts);
// this file counts what each uses and draws the desk around them.
//
// A space's page opens on its Operator's conversations, every person's, each
// read and drawn as its own chat app reads and draws it (operator-page.ts
// `conversationOf`, `column`), with everything its model was told and
// offered, for inspecting while the Operator's prompts change (T-137672). They are read from the space's
// Builder object, which lets the admin in by the platform's administrative
// vouch. The Sessions page lists them across the most recently active spaces,
// newest first, each opening on that same page.

import type { Env } from './env.ts'
import { type Held, holding } from './held.ts'
import {
  appAbout,
  type Directory,
  idOf,
  META,
  newcomerIs,
  type Row,
  type Space,
  spaceOf,
} from './directory.ts'
import { budget, dollars, monthOf, starterOf } from './meter.ts'
import { DAILY, opened, PER_BUILD, PER_SOURCE } from './newcomer.ts'
import { isTestAddress } from './lib/bots.ts'
import { sessionAt } from './session.ts'
import { drawn } from './render/mod.ts'
import { personName, type Ref, type Uses } from './render/directory.ts'
import { type ComponentChildren, Fragment, h, type VNode } from 'preact'
import {
  Button,
  Card,
  Empty,
  Field,
  Group,
  Icon,
  SideNav,
} from '@yaks/ui/parts'
import { esc, markup, raw } from './html.ts'
import { deskFrame, lost, shell } from './pages.ts'
import { type IconName, icons } from './icons.ts'
import { type Host, spaceHost, url } from './host.ts'
import { DAYS, NOT_ON, statsOf } from './views.ts'
import { type Funnel, funnel, STEPS } from './funnel.ts'
import { type ByDay, series, summed } from '@yaks/ui/chart'
import { caught } from './defects.ts'
import { operatorDoor } from './build-door.ts'
import { type Listed, listed, type Worked } from './operator-view.ts'
import { column, conversationOf } from './operator-page.ts'
import { ADMIN, managePath } from './route.ts'
import { admin } from './tool.ts'
import { Idle } from './mascot.ts'

export let PATH = ADMIN

// Who may read it: an owner of the meta space, by the platform session cookie
// and nothing else, never a bearer token, which is what an agent holds. Null
// for nobody signed in, '' for somebody who is not the admin.
export let staff = async (req: Request, env: Env, dir: Directory) => {
  let person = (await sessionAt(req, env.SESSION_SECRET))?.person
  if (!person) return null
  return await admin({ dir, person }) ? person : ''
}

type List = 'people' | 'spaces' | 'apps'
let KEYS: List[] = ['people', 'spaces', 'apps']
let LISTS: Record<List, { title: string; icon: IconName }> = {
  people: { title: 'People', icon: 'users' },
  spaces: { title: 'Spaces', icon: 'globe' },
  apps: { title: 'Apps', icon: 'layout-grid' },
}
let isList = (s: string): s is List => KEYS.some((k) => k == s)

/** Every person, space, app and seat, as the directory keeps them. */
export type Census = Awaited<ReturnType<Directory['census']>>

let latest = (...at: (string | null | undefined)[]) =>
  at.filter((a): a is string => !!a).sort().at(-1) ?? null
let sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0)
let group = (rows: Row[], key: (r: Row) => string) => {
  let out = new Map<string, Row[]>()
  for (let r of rows) out.set(key(r), [...out.get(key(r)) ?? [], r])
  return out
}
let seatSpace = (r: Row) => idOf(r.member!.space)
let seatPerson = (r: Row) => idOf(r.member!.person)
let appSpace = (r: Row) => idOf(r.app!.space)

// A figure's days, for a row that has kept any.
let days = (
  name: 'spending' | 'requesting',
  byDay: ByDay | undefined,
  now: Date,
) =>
  byDay && Object.keys(byDay).length
    ? { [name]: series(byDay, DAYS, now.getTime()) }
    : {}

/**
 * What every row uses, counted once over the whole directory. A space: what
 * models and voice cost in it this month, its database and files, its apps
 * and the latest use of it or of any of them. An app: this month's requests,
 * its database and files, its 30 days' visits as the hourly reading found them,
 * when it was last deployed, written to and last reported an error, who owns its
 * space and its latest use. A person: their budget over the
 * spaces they own, those spaces' storage and apps, and the latest of their last
 * use (a tool call, a page view), last sign-in and their spaces' latest use. A space is a test space when everyone seated in it is
 * a test account, and its apps are test apps.
 */
export let uses = (c: Census, now = new Date()): Map<string, Uses> => {
  let month = monthOf(now)
  let spaces = new Map(c.spaces.map((r) => [r.entity.eid, spaceOf(r)]))
  let live = c.apps.filter((r) => !r.trashed)
  let appsIn = group(live, appSpace)
  let everyIn = group(c.apps, appSpace)
  let seatsIn = group(c.seats, seatSpace)
  let seatsOf = group(c.seats, seatPerson)
  let emails = new Map(
    c.people.map((r) => [r.entity.eid, r.email?.address ?? '']),
  )
  let tested = (space: string) => {
    let seats = seatsIn.get(space) ?? []
    return seats.length > 0 &&
      seats.every((s) => isTestAddress(emails.get(seatPerson(s)) ?? ''))
  }
  // What each space holds and each app's share, those in the trash included
  // (held.ts): app data and photos and files together.
  let held = new Map(c.spaces.map((r) => {
    let s = spaces.get(r.entity.eid)!
    return [s.eid, holding(s, (everyIn.get(s.eid) ?? []).map(appAbout))]
  }))
  let stored = (h?: Held) => (h?.bytes ?? 0) + (h?.files ?? 0)
  let names = new Map(c.people.map((r) => [r.entity.eid, personName(r)]))
  let deployed = new Map<string, string>()
  for (let r of c.deploys) {
    let app = idOf(r.deploy!.app), at = r.created?.at ?? ''
    if (at > (deployed.get(app) ?? '')) deployed.set(app, at)
  }
  let trends = new Map(c.spaces.map((r) => [r.entity.eid, r.trend]))
  let out = new Map<string, Uses>()
  for (let r of c.spaces) {
    let s = spaces.get(r.entity.eid)!
    let apps = appsIn.get(s.eid) ?? []
    out.set(s.eid, {
      spend: { spent: budget(s, now).spent },
      ...days('spending', r.trend?.spend, now),
      ...days('requesting', r.trend?.requests, now),
      storage: stored(held.get(s.eid)),
      apps: apps.length,
      active: latest(r.used?.at, ...apps.map((a) => a.used?.at)),
      test: tested(s.eid),
    })
  }
  for (let r of c.apps) {
    out.set(r.entity.eid, {
      requests: r.meter?.month == month ? r.meter.requests ?? 0 : 0,
      visits: r.meter?.visits ?? null,
      ...days('requesting', r.trend?.requests, now),
      storage: stored(held.get(appSpace(r))?.apps.get(r.entity.eid)),
      active: r.used?.at ?? null,
      deployed: deployed.get(r.entity.eid) ?? null,
      changed: r.changed?.at ?? null,
      errored: r.errored?.at ?? null,
      owners: (seatsIn.get(appSpace(r)) ?? [])
        .filter((s) => s.member!.role == 'owner')
        .map((s) => names.get(seatPerson(s)) ?? ''),
      test: out.get(appSpace(r))?.test ?? false,
    })
  }
  for (let r of c.people) {
    let owned = (seatsOf.get(r.entity.eid) ?? [])
      .filter((s) => s.member!.role == 'owner')
      .flatMap((s) => spaces.get(seatSpace(s)) ?? [])
      .filter((s) => s.slug != META.space)
    out.set(r.entity.eid, {
      spend: { spent: sum(owned.map((s) => budget(s, now).spent)) },
      ...days(
        'spending',
        summed(owned.map((s) => trends.get(s.eid)?.spend)),
        now,
      ),
      storage: sum(owned.map((s) => out.get(s.eid)?.storage ?? 0)),
      apps: sum(owned.map((s) => out.get(s.eid)?.apps ?? 0)),
      active: latest(
        r.used?.at,
        r.signed_in?.at,
        ...owned.map((s) => out.get(s.eid)?.active),
      ),
      test: isTestAddress(r.email?.address ?? ''),
    })
  }
  return out
}

// One page's reading of the census: what each row uses, and the names a row
// points at by.
type Reading = {
  env: Host
  census: Census
  uses: Map<string, Uses>
  spaces: Map<string, Space>
  apps: Map<string, Row>
  tests: boolean
}

export let read = (env: Host, census: Census, tests: boolean): Reading => ({
  env,
  census,
  uses: uses(census),
  spaces: new Map(census.spaces.map((r) => [r.entity.eid, spaceOf(r)])),
  apps: new Map(census.apps.map((r) => [r.entity.eid, r])),
  tests,
})

let slugOf = (d: Reading, space: string) => d.spaces.get(space)?.slug ?? ''
let refOf = (d: Reading, r: Row): Ref => ({
  eid: r.entity.eid,
  name: r.person
    ? personName(r)
    : r.space
    ? r.space.slug
    : `${slugOf(d, appSpace(r))}/${r.app?.slug ?? ''}`,
})

// The context a row is drawn with: what it uses, and its address.
let around = (d: Reading, r: Row) => {
  let space = r.app ? slugOf(d, appSpace(r)) : ''
  return {
    base: PATH,
    uses: d.uses.get(r.entity.eid),
    space,
    address: r.space
      ? spaceHost(d.env, r.space.slug)
      : r.app
      ? `${spaceHost(d.env, space)}/${r.app.slug ?? r.former?.slug ?? ''}`
      : '',
  }
}

// What a search finds a row by: an app by its space and slug together too.
let said = (d: Reading, r: Row) =>
  [
    r.entity.eid,
    r.doc?.title,
    r.email?.address,
    r.space?.slug,
    r.published?.name,
    r.app ? refOf(d, r).name : '',
  ].filter(Boolean).join(' ').toLowerCase()

// Who is shown: everyone with tests asked for, else nobody's work left out.
let shown = (d: Reading, rows: Row[]) =>
  d.tests ? rows : rows.filter((r) => !d.uses.get(r.entity.eid)?.test)

// Most recently active first; never-active last, by name.
let ordered = (d: Reading, rows: Row[]) =>
  [...rows].sort((a, b) =>
    (d.uses.get(b.entity.eid)?.active ?? '').localeCompare(
      d.uses.get(a.entity.eid)?.active ?? '',
    ) || refOf(d, a).name.localeCompare(refOf(d, b).name)
  )

// A list on one card, each row drawn by the worker's registry.
let card = (drawings: string[]) =>
  h(
    Card,
    { as: 'ul', class: 'Directory' },
    drawings.map((html) => h('li', null, raw(html))),
  )
// What a page says where it has nothing to show.
let empty = (said: ComponentChildren) => h(Empty, null, h('h2', null, said))

let rows = (d: Reading, all: Row[]) =>
  all.length
    ? card(
      ordered(d, all).map((r) => drawn(r, 'Directory.List.Tile', around(d, r))),
    )
    : null
let grouped = (d: Reading, title: string, all: Row[]) =>
  all.length ? h(Fragment, null, h(Group, null, title), rows(d, all)) : null

// A person a row points at, by name, or said gone once erased.
let personRef = (d: Reading, eid: string): Ref => {
  let r = d.census.people.find((p) => p.entity.eid == eid)
  return r ? refOf(d, r) : { eid, name: 'Someone gone' }
}
let newest = (rows: Row[], at: (r: Row) => string) =>
  [...rows].sort((a, b) => at(b).localeCompare(at(a)))

// Who signed up through somebody's invite (referral.ts), newest first; with
// tests asked for, those between test accounts too.
let invited = (d: Reading) =>
  newest(
    d.census.referrals.filter((r) =>
      d.tests || [r.referral!.invitee, r.referral!.inviter]
        .every((p) => !d.uses.get(idOf(p))?.test)
    ),
    (r) => r.created?.at ?? '',
  )
let referrals = (d: Reading, all: Row[]) =>
  card(all.map((r) =>
    drawn(r, 'Directory.List.Tile', {
      base: PATH,
      invitee: personRef(d, idOf(r.referral!.invitee)),
      inviter: personRef(d, idOf(r.referral!.inviter)),
      space: r.rewarded ? slugOf(d, idOf(r.rewarded.space)) : '',
    })
  ))

// Everybody given the starter (meter.ts `STARTER`), newest first: when their
// first space was made, what of it is left and what their spaces spent.
let starters = (d: Reading) => {
  let made = new Map(
    d.census.spaces.map((r) => [r.entity.eid, r.created?.at ?? '']),
  )
  let given = (r: Row) => made.get(idOf(r.started!.space!)) ?? ''
  let all = newest(
    shown(d, d.census.people.filter((r) => r.started?.space)),
    given,
  )
  return all.length
    ? card(all.map((r) => {
      let space = d.spaces.get(idOf(r.started!.space!))
      return drawn(r, 'Directory.Starter.Tile', {
        base: PATH,
        uses: d.uses.get(r.entity.eid),
        at: given(r),
        space: space?.slug ?? '',
        left: space ? starterOf(space) : 0,
      })
    }))
    : empty('Nobody has been given the starter yet')
}

// What was counted, a fact a line, on a card.
let facts = (all: [string, string][]) =>
  h(
    Card,
    { as: 'div' },
    h(
      'dl',
      { class: 'Fields Directory_Facts' },
      all.map(([say, n]) =>
        h('div', null, h('dt', null, say), h('dd', null, n))
      ),
    ),
  )

// Every visitor's build (newcomer.ts), newest first: each space the home
// page's box opened a newcomer (its `visitor_build`), and who owns it now when
// a newcomer no longer does: whoever kept it by signing up (newcomer.ts
// `keep`).
let builds = (d: Reading) => {
  let owners = group(
    d.census.seats.filter((s) => s.member!.role == 'owner'),
    seatSpace,
  )
  let newcomers = new Set(
    d.census.people.filter(newcomerIs).map((r) => r.entity.eid),
  )
  return newest(
    d.census.spaces.filter((r) => r.visitor_build),
    (r) => r.visitor_build!.at ?? '',
  ).map((r) => ({
    r,
    space: d.spaces.get(r.entity.eid),
    keeper: (owners.get(r.entity.eid) ?? []).map(seatPerson)
      .find((p) => !newcomers.has(p)),
  }))
}

// The visitors' builds: how many the box opened today against the day's cap,
// how many were kept and what they spent, then each of them.
let buildsPage = (d: Reading, today: number) => {
  let all = builds(d)
  let spent = sum(all.map((b) => b.space ? budget(b.space).spent : 0))
  return desk(
    d,
    'Visitor builds',
    'builds',
    h(
      Fragment,
      null,
      facts([
        ['Opened today', `${today} of ${DAILY}`],
        ['Kept', `${all.filter((b) => b.keeper).length} of ${all.length}`],
        ['Spent this month', dollars(spent)],
        [
          'Limits',
          `${dollars(PER_BUILD)} a build, ${PER_SOURCE} a day from one address`,
        ],
      ]),
      h(Group, null, 'Builds'),
      all.length
        ? card(
          all.map(({ r, space, keeper }) =>
            drawn(r, 'Directory.Build.Tile', {
              base: PATH,
              uses: space && {
                ...d.uses.get(space.eid),
                spend: budget(space),
              },
              space: space && { eid: space.eid, name: space.slug },
              address: space ? spaceHost(d.env, space.slug) : '',
              trashed: !!space?.trashed,
              keeper: keeper ? personRef(d, keeper).name : '',
            })
          ),
        )
        : empty('Nobody has built from the home page yet'),
    ),
  )
}

// Who invited whom and the month each first app gave, then everybody given
// the starter. Inviting yourself and making accounts for the starter are
// against the terms, and are watched here rather than refused anywhere
// (D-136811, 'Invites').
let invitesPage = (d: Reading) => {
  let all = invited(d)
  return desk(
    d,
    'Invites',
    'invites',
    h(
      Fragment,
      null,
      h(Group, null, 'Signed up through an invite'),
      all.length
        ? referrals(d, all)
        : empty('Nobody has signed up through an invite yet'),
      h(Group, null, 'Given the starter'),
      starters(d),
    ),
  )
}

let lists = (c: Census): Record<List, Row[]> => ({
  people: c.people,
  spaces: c.spaces,
  apps: c.apps,
})
let tested = (d: Reading) => d.tests ? '?tests=1' : ''

// The desk: the three lists down the side, each with how many it holds, the
// funnel below them, the invites with how many signed up through one, and the
// visitors' builds with how many there have been.
let desk = (
  d: Reading,
  title: string,
  current: List | 'sessions' | 'funnel' | 'invites' | 'builds' | null,
  body: ComponentChildren,
  kicker: ComponentChildren = null,
  status = 200,
) => {
  let all = lists(d.census)
  // A page down the side: its icon, its name, and how many it holds.
  let link = (
    key: string,
    href: string,
    glyph: IconName,
    name: string,
    n?: number,
  ) =>
    h(
      SideNav.Link,
      {
        href,
        mod: current == key && 'on',
        'aria-current': current == key ? 'page' : undefined,
      },
      h(Icon, { of: icons[glyph] }),
      name,
      n == null ? null : h('span', { class: 'Desk_Count' }, n),
    )
  let nav = [
    ...KEYS.map((key) =>
      link(
        key,
        `${PATH}/${key}${tested(d)}`,
        LISTS[key].icon,
        LISTS[key].title,
        shown(d, all[key]).length,
      )
    ),
    link(
      'sessions',
      `${PATH}/sessions${tested(d)}`,
      'message-square',
      'Sessions',
    ),
    link(
      'funnel',
      `${PATH}/funnel`,
      'chart-no-axes-column-increasing',
      'Funnel',
    ),
    link(
      'invites',
      `${PATH}/invites${tested(d)}`,
      'qr-code',
      'Invites',
      invited(d).length,
    ),
    link(
      'builds',
      `${PATH}/builds${tested(d)}`,
      'bot',
      'Visitor builds',
      builds(d).length,
    ),
  ]
  return shell(
    d.env,
    esc(title),
    null,
    status,
    markup(deskFrame({
      label: 'Directory',
      top: h(
        'a',
        { class: 'Desk_Brand', href: url(d.env, '/') },
        h(Idle, { base: url(d.env), size: 44 }),
        'yaks.app',
      ),
      side: h(SideNav, { 'aria-label': 'Directory' }, nav),
      where: [h('b', null, title), h('small', null, 'Admin')],
      head: h('div', null, kicker, h('h1', null, title)),
      content: body,
      class: 'Directory_Content',
    })),
    { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
    'Desk',
  )
}

// One list, searched: a word finds every row that says it anywhere.
export let listing = (d: Reading, key: List, q: string) => {
  let all = shown(d, lists(d.census)[key])
  let found = q ? all.filter((r) => said(d, r).includes(q.toLowerCase())) : all
  let hidden = lists(d.census)[key].length - all.length
  let what = LISTS[key].title.toLowerCase()
  let toggle = d.tests
    ? h('a', {
      href: `${PATH}/${key}${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    }, 'Leave out test accounts')
    : hidden
    ? h('a', {
      href: `${PATH}/${key}?tests=1${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    }, `Show ${hidden} more from test accounts`)
    : null
  return h(
    Fragment,
    null,
    h(
      'div',
      { class: 'Directory_Bar' },
      h(
        'form',
        {
          class: 'Directory_Find',
          method: 'get',
          action: `${PATH}/${key}`,
          role: 'search',
        },
        h(Field, {
          type: 'search',
          name: 'q',
          value: q,
          placeholder: `Search ${what}`,
          'aria-label': `Search ${what}`,
        }),
        d.tests && h('input', { type: 'hidden', name: 'tests', value: '1' }),
        h(Button, { type: 'submit' }, 'Search'),
      ),
      toggle,
    ),
    found.length
      ? rows(d, found)
      : empty(q ? `Nothing here says “${q}”` : `No ${what} yet`),
  )
}

export let list = (d: Reading, key: List, q: string) =>
  desk(d, LISTS[key].title, key, listing(d, key, q))

export let possessions = (d: Reading, r: Row) => {
  let c = d.census
  let byId = (eid: string) =>
    [...c.people, ...c.spaces, ...c.apps].find((x) => x.entity.eid == eid)
  let seats = c.seats.filter((s) => seatPerson(s) == r.entity.eid)
  let held = (role: string) =>
    seats.filter((s) => s.member!.role == role)
      .flatMap((s) => byId(seatSpace(s)) ?? [])
  let owns = new Set(held('owner').map((s) => s.entity.eid))
  let brought = invited(d).filter((i) =>
    idOf(i.referral!.inviter) == r.entity.eid
  )
  return h(
    Fragment,
    null,
    grouped(d, 'Owner of', held('owner')),
    grouped(d, 'Editor of', held('editor')),
    grouped(d, 'Viewer of', held('viewer')),
    grouped(d, 'Apps', c.apps.filter((a) => owns.has(appSpace(a)))),
    brought.length
      ? h(Fragment, null, h(Group, null, 'Invited'), referrals(d, brought))
      : null,
  )
}

// One row's page: its own facts, drawn by its renderer, then what it holds.
export let page = async (d: Reading, dir: Directory, r: Row, env: Env) => {
  let c = d.census
  let byId = (eid: string) =>
    [...c.people, ...c.spaces, ...c.apps].find((x) => x.entity.eid == eid)
  let ctx: Record<string, unknown> = around(d, r)
  let more: VNode | null = r.person ? possessions(d, r) : null
  let key: List = r.person ? 'people' : r.space ? 'spaces' : 'apps'
  if (r.space) {
    let seats = c.seats.filter((s) => seatSpace(s) == r.entity.eid)
    let held = (role: string) =>
      seats.filter((s) => s.member!.role == role)
        .flatMap((s) => byId(seatPerson(s)) ?? [])
    ctx.owners = held('owner').map((p) => refOf(d, p))
    more = h(
      Fragment,
      null,
      h(
        'p',
        null,
        h(
          'a',
          { href: `${PATH}/${r.entity.eid}/operator` },
          `${spaceOf(r).operator}’s conversations, and what its model was told`,
        ),
      ),
      grouped(d, 'Owners', held('owner')),
      grouped(d, 'Editors', held('editor')),
      grouped(d, 'Viewers', held('viewer')),
      grouped(d, 'Apps', c.apps.filter((a) => appSpace(a) == r.entity.eid)),
    )
  }
  if (r.app) {
    let home = byId(appSpace(r))
    let from = r.installed?.of ? d.apps.get(idOf(r.installed.of)) : undefined
    let [deploys, visits] = await Promise.all([
      dir.deploys(appAbout(r)),
      (statsOf(env, r.entity.eid) ?? Promise.resolve(null))
        .then((s) => s, (e) => {
          caught(e, { request: 'admin visits' })
          return null
        }),
    ])
    ctx.home = home ? refOf(d, home) : undefined
    ctx.from = from ? refOf(d, from) : undefined
    ctx.deploys = { count: deploys.length, at: deploys[0]?.at ?? '' }
    ctx.visits = visits?.total ?? null
    ctx.visiting = visits?.daily.length
      ? { from: visits.daily[0].day, values: visits.daily.map((d) => d.views) }
      : undefined
    let copies = c.apps.filter((a) =>
      a.installed?.of && idOf(a.installed.of) == r.entity.eid
    )
    more = grouped(d, 'Installed as', copies)
  }
  return desk(
    d,
    (r.app && r.doc?.title) || refOf(d, r).name,
    key,
    h(Fragment, null, raw(drawn(r, 'Directory.Page', ctx)), more),
    h(
      'a',
      { class: 'Desk_Address', href: `${PATH}/${key}${tested(d)}` },
      LISTS[key].title,
    ),
  )
}

// What the admin is to a space's Builder object: the platform's
// administrative access, which it checks against the directory again.
let vouch = (person: string) => ({
  person,
  role: null,
  administrative: true,
})

// A space's Operator, asked as the admin: its answer, or what kept it from one.
let asking = (
  env: Env,
  space: Space,
  person: string,
  path: string,
  args: unknown,
) =>
  operatorDoor(env, space, vouch(person), path, args).catch((e) => {
    caught(e, { request: `admin operator ${path}` })
    return e instanceof Error ? e : new Error(String(e))
  })
let failed = (e: Error) => empty(`The Operator could not be read: ${e.message}`)

// A space's Operator, inspected: every person's conversation with it and the
// work each started, or, with `open`, one of them drawn as its chat app
// draws it. Each is read when asked, so a reload shows what has happened.
let operatorPage = async (
  d: Reading,
  env: Env,
  r: Row,
  person: string,
  open: string,
) => {
  let space = spaceOf(r)
  let home = `${PATH}/${r.entity.eid}/operator`
  let back = (to: string, said: string) =>
    h('a', { class: 'Desk_Address', href: `${to}${tested(d)}` }, said)
  let ask = (path: string, args: unknown) =>
    asking(env, space, person, path, args)
  if (!open) {
    let items = await ask('work', { everyone: true }) as Worked[] | Error
    return desk(
      d,
      `${space.operator}’s conversations`,
      'spaces',
      items instanceof Error
        ? failed(items)
        : items.length
        ? h(Card, { as: 'div' }, raw(listed(items, (w) => `${home}/${w.open}`)))
        : empty('Nobody has talked to this Operator yet'),
      back(`${PATH}/${r.entity.eid}`, space.slug),
    )
  }
  // Read and drawn as the chat app reads and draws it.
  let talked = await conversationOf(
    env,
    space,
    vouch(person),
    managePath('operator', space.slug),
    open,
    true,
    home,
  ).catch((e) => {
    caught(e, { request: 'admin operator conversation' })
    return e instanceof Error ? e : new Error(String(e))
  })
  let found = !(talked instanceof Error) && !!talked.html
  return desk(
    d,
    talked instanceof Error || !talked.title
      ? 'Not a conversation'
      : talked.title,
    'spaces',
    talked instanceof Error
      ? failed(talked)
      : found
      ? column(talked.html)
      : empty('This Operator has no conversation with that id'),
    back(home, `${space.operator}’s conversations`),
    talked instanceof Error || found ? 200 : 404,
  )
}

// How many spaces the Sessions page asks, and how many sessions it shows.
let SPACES = 30
let SESSIONS = 100

// Every person's sessions with the Operator in the most recently active
// spaces, newest first, each saying its space and opening on its page, then
// the spaces whose Operator could not be read.
let sessionsPage = async (d: Reading, env: Env, person: string) => {
  let spaces = ordered(d, shown(d, d.census.spaces)).slice(0, SPACES)
  let asked = await Promise.all(spaces.map(async (r) => ({
    r,
    items: await asking(env, spaceOf(r), person, 'work', { everyone: true }) as
      | Worked[]
      | Error,
  })))
  let all = asked
    .flatMap(({ r, items }) =>
      items instanceof Error ? [] : items.map((w) => ({
        ...w,
        where: r.space!.slug,
        space: r.entity.eid,
      }))
    )
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, SESSIONS)
  let unread = asked.filter((a) => a.items instanceof Error)
  return desk(
    d,
    'Sessions',
    'sessions',
    h(
      Fragment,
      null,
      all.length
        ? h(
          Card,
          { as: 'div' },
          raw(listed<Listed & { space: string }>(
            all,
            (w) => `${PATH}/${w.space}/operator/${w.open}`,
          )),
        )
        : empty('Nobody has talked to an Operator yet'),
      unread.length
        ? h(
          Fragment,
          null,
          h(Group, null, 'Could not be read'),
          card(unread.map(({ r, items }) =>
            esc(`${r.space!.slug}: ${(items as Error).message}`)
          )),
        )
        : null,
    ),
  )
}

// The windows the funnel is read over, in days.
let WINDOWS = [1, 7, 30, 90]

// yaks.app's own funnel (funnel.ts): each step's count over the window, and
// its share of the step it follows, then the sites that sent the home page
// its visitors, the calls to action they clicked and the campaigns.
let funnelPage = (
  d: Reading,
  f: Funnel | null | Error,
  days: number,
) => {
  let windows = WINDOWS.flatMap((n, i) => [
    i ? ' · ' : null,
    h('a', {
      href: `${PATH}/funnel?days=${n}`,
      'aria-current': n == days ? 'page' : undefined,
    }, n == 1 ? '1 day' : `${n} days`),
  ])
  let say = (name: string) => STEPS.find((s) => s.name == name)!.say
  let of = (name: string) => {
    let s = STEPS.find((s) => s.name == name)
    return s && 'of' in s ? say(s.of).toLowerCase() : ''
  }
  let body = f instanceof Error
    ? empty(`The counts could not be read: ${f.message}`)
    : !f
    ? empty(NOT_ON)
    : h(
      Fragment,
      null,
      facts(f.steps.map((s) => [
        s.say,
        `${s.n}${
          s.share == null
            ? ''
            : ` · ${Math.round(s.share * 100)}% of ${of(s.name)}`
        }`,
      ])),
      f.from.length
        ? h(
          Fragment,
          null,
          h(Group, null, 'Came to the home page from'),
          facts(f.from.map((r) => [r.site, String(r.n)])),
        )
        : null,
      f.buttons.length
        ? h(
          Fragment,
          null,
          h(Group, null, 'Clicked on the home page'),
          facts(f.buttons.map((r) => [r.say, String(r.n)])),
        )
        : null,
      ...([
        ['Came from campaigns', f.campaigns],
        ['Home page variants', f.variants],
      ] as const).map(([say, all]) =>
        all.length
          ? h(
            Fragment,
            null,
            h(Group, null, say),
            facts(all.map((r) => [
              r.name,
              `${r.home} visits · ${r.click} clicks · ${r.signup} sign-ups · ` +
              `${r.checkout} checkouts`,
            ])),
          )
          : null
      ),
    )
  return desk(
    d,
    'Funnel',
    'funnel',
    h(
      Fragment,
      null,
      h(
        'div',
        { class: 'Directory_Bar' },
        h('nav', { 'aria-label': 'Window' }, windows),
      ),
      body,
    ),
  )
}

/** The admin's directory, at {@link PATH}, or null for any other path. */
export let answer = async (
  req: Request,
  env: Env,
  path: string,
  dir: Directory,
): Promise<Response | null> => {
  if (path != PATH && !path.startsWith(`${PATH}/`)) return null
  let asked = new URL(req.url)
  // Signed out: sent to sign in and handed back here. Signed in as anybody
  // but the platform's admin: nothing is here, the same as a wrong address.
  let who = await staff(req, env, dir)
  if (who == null) {
    return new Response(null, {
      status: 302,
      headers: {
        location: `/login?return=${
          encodeURIComponent(asked.pathname + asked.search)
        }`,
      },
    })
  }
  if (!who || (req.method != 'GET' && req.method != 'HEAD')) return lost(env)
  let rest = path.slice(PATH.length + 1)
  if (!rest) {
    return new Response(null, {
      status: 302,
      headers: { location: `${PATH}/people` },
    })
  }
  let d = read(env, await dir.census(), asked.searchParams.has('tests'))
  if (isList(rest)) return list(d, rest, asked.searchParams.get('q') ?? '')
  if (rest == 'invites') return invitesPage(d)
  if (rest == 'builds') return buildsPage(d, await opened(dir))
  if (rest == 'sessions') return await sessionsPage(d, env, who)
  if (rest == 'funnel') {
    let days = Number(asked.searchParams.get('days')) || 7
    let f = await funnel(env, days).catch((e) => {
      caught(e, { request: 'admin funnel' })
      return e instanceof Error ? e : new Error(String(e))
    })
    return funnelPage(d, f, f && !(f instanceof Error) ? f.days : days)
  }
  let [eid, part, open = ''] = rest.split('/')
  let r = [...d.census.people, ...d.census.spaces, ...d.census.apps]
    .find((x) =>
      x.entity.eid == eid && (!part || part == 'operator' && x.space)
    )
  if (!r) {
    return desk(
      d,
      'Not in the directory',
      null,
      empty('Nothing in the directory has that id'),
      null,
      404,
    )
  }
  return part
    ? await operatorPage(d, env, r, who, open)
    : await page(d, dir, r, env)
}
