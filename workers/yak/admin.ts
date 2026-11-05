// The platform admin's directory (T-124291): every person, space and app on
// yaks.app and what each uses, at /admin on the apex. A person's row says
// what the spaces they own spent this month (each against its own budget), the
// storage and apps of the spaces they own, and when they were last active; a
// space's says its own spend, storage, apps and latest use; an app's, its
// requests, visits, storage, version, owners, last deploy, last write to its
// store, last error and latest use. Each opens to a page of its own. The
// Invites page says who signed up through whose invite and the month each
// first app gave, and who was given the starter and when.
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
// drawn as its own chat app draws it (operator-view.ts `talk`), with
// everything its model was told and offered, for inspecting while the
// Operator's prompts change (T-137672). They are read from the space's
// Builder object, which lets the admin in by the platform's administrative
// vouch.

import type { Env } from './env.ts'
import { type Held, holding } from './held.ts'
import {
  appAbout,
  type Directory,
  idOf,
  META,
  type Row,
  type Space,
  spaceOf,
} from './directory.ts'
import { budget, monthOf, starterOf } from './meter.ts'
import { isTestAddress } from './lib/bots.ts'
import { sessionAt } from './session.ts'
import { drawn } from './render/mod.ts'
import type { Ref, Uses } from './render/directory.ts'
import { esc } from './html.ts'
import { lost, shell } from './pages.ts'
import { icon, type IconName } from './icons.ts'
import { type Host, spaceHost, url } from './host.ts'
import { DAYS, NOT_ON, statsOf } from './views.ts'
import { type Funnel, funnel, STEPS } from './funnel.ts'
import { type ByDay, series, summed } from '@yaks/ui/chart'
import { caught } from './defects.ts'
import { operatorDoor } from './operator-page.ts'
import { listed, type Worked } from './operator-view.ts'
import { managePath } from './route.ts'

export let PATH = '/admin'

// Who may read it: an owner of the meta space, by the platform session cookie
// and nothing else, never a bearer token, which is what an agent holds. Null
// for nobody signed in, '' for somebody who is not the admin.
export let staff = async (req: Request, env: Env, dir: Directory) => {
  let person = (await sessionAt(req, env.SESSION_SECRET))?.person
  if (!person) return null
  let meta = await dir.space(META.space)
  return meta && await dir.role(meta, person) == 'owner' ? person : ''
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
let personName = (r: Row) =>
  r.doc?.title || (r.email?.address ?? '').split('@')[0] || 'Someone'

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

let read = (env: Host, census: Census, tests: boolean): Reading => ({
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

let rows = (d: Reading, all: Row[]) =>
  all.length
    ? `<ul class="Card Directory">${
      ordered(d, all).map((r) =>
        `<li>${drawn(r, 'Directory.List.Tile', around(d, r))}</li>`
      ).join('')
    }</ul>`
    : ''
let grouped = (d: Reading, title: string, all: Row[]) =>
  all.length ? `<h2 class="Group">${esc(title)}</h2>${rows(d, all)}` : ''

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
  `<ul class="Card Directory">${
    all.map((r) =>
      `<li>${
        drawn(r, 'Directory.List.Tile', {
          base: PATH,
          invitee: personRef(d, idOf(r.referral!.invitee)),
          inviter: personRef(d, idOf(r.referral!.inviter)),
          space: r.rewarded ? slugOf(d, idOf(r.rewarded.space)) : '',
        })
      }</li>`
    ).join('')
  }</ul>`

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
    ? `<ul class="Card Directory">${
      all.map((r) => {
        let space = d.spaces.get(idOf(r.started!.space!))
        return `<li>${
          drawn(r, 'Directory.Starter.Tile', {
            base: PATH,
            uses: d.uses.get(r.entity.eid),
            at: given(r),
            space: space?.slug ?? '',
            left: space ? starterOf(space) : 0,
          })
        }</li>`
      }).join('')
    }</ul>`
    : '<section class="Empty"><h2>Nobody has been given the starter yet</h2></section>'
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
    `<h2 class="Group">Signed up through an invite</h2>${
      all.length
        ? referrals(d, all)
        : '<section class="Empty"><h2>Nobody has signed up through an invite yet</h2></section>'
    }<h2 class="Group">Given the starter</h2>${starters(d)}`,
  )
}

let lists = (c: Census): Record<List, Row[]> => ({
  people: c.people,
  spaces: c.spaces,
  apps: c.apps,
})
let tested = (d: Reading) => d.tests ? '?tests=1' : ''

// The desk: the three lists down the side, each with how many it holds, the
// funnel below them, and the invites with how many signed up through one.
let desk = (
  d: Reading,
  title: string,
  current: List | 'funnel' | 'invites' | null,
  body: string,
  kicker = '',
  status = 200,
) => {
  let all = lists(d.census)
  let at = (key: string) => current == key ? ' aria-current="page"' : ''
  let counted = (n: number) => `<span class="Desk_Count">${n}</span>`
  let nav =
    KEYS.map((key) =>
      `<a href="${PATH}/${key}${tested(d)}"${at(key)}>${icon(LISTS[key].icon)}${
        LISTS[key].title
      }${counted(shown(d, all[key]).length)}</a>`
    ).join('') +
    `<a href="${PATH}/funnel"${at('funnel')}>${
      icon('chart-no-axes-column-increasing')
    }Funnel</a>` +
    `<a href="${PATH}/invites${tested(d)}"${at('invites')}>${
      icon('qr-code')
    }Invites${counted(invited(d).length)}</a>`
  return shell(
    d.env,
    esc(title),
    null,
    status,
    `<a class="Desk_Skip" href="#content">Skip to content</a>
<aside class="Desk_Side">
<a class="Desk_Brand" href="${url(d.env, '/')}"><img src="${
      url(d.env, '/yaks-app.png')
    }" width="36" height="36" alt="">yaks.app</a>
<nav class="SideNav" aria-label="Directory">${nav}</nav>
</aside><div class="Desk_Body"><header class="Desk_Head"><div>${kicker}<h1>${
      esc(title)
    }</h1></div></header><div class="Desk_Content Directory_Content" id="content" tabindex="-1">${body}</div></div>`,
    { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' },
    'Desk',
  )
}

// One list, searched: a word finds every row that says it anywhere.
let list = (d: Reading, key: List, q: string) => {
  let all = shown(d, lists(d.census)[key])
  let found = q ? all.filter((r) => said(d, r).includes(q.toLowerCase())) : all
  let hidden = lists(d.census)[key].length - all.length
  let what = LISTS[key].title.toLowerCase()
  let toggle = d.tests
    ? `<a href="${PATH}/${key}${
      q ? `?q=${encodeURIComponent(q)}` : ''
    }">Leave out test accounts</a>`
    : hidden
    ? `<a href="${PATH}/${key}?tests=1${
      q ? `&q=${encodeURIComponent(q)}` : ''
    }">Show ${hidden} more from test accounts</a>`
    : ''
  return desk(
    d,
    LISTS[key].title,
    key,
    `<div class="Directory_Bar"><form class="Directory_Find" method="get" action="${PATH}/${key}" role="search"><input class="Field" type="search" name="q" value="${
      esc(q)
    }" placeholder="Search ${what}" aria-label="Search ${what}">${
      d.tests ? '<input type="hidden" name="tests" value="1">' : ''
    }<button class="Button Button-quiet" type="submit">Search</button></form>${toggle}</div>${
      found.length
        ? rows(d, found)
        : `<section class="Empty"><h2>${
          q ? `Nothing here says “${esc(q)}”` : `No ${what} yet`
        }</h2></section>`
    }`,
  )
}

// One row's page: its own facts, drawn by its renderer, then what it holds.
let page = async (d: Reading, dir: Directory, r: Row, env: Env) => {
  let c = d.census
  let byId = (eid: string) =>
    [...c.people, ...c.spaces, ...c.apps].find((x) => x.entity.eid == eid)
  let ctx: Record<string, unknown> = around(d, r)
  let more = ''
  let key: List = r.person ? 'people' : r.space ? 'spaces' : 'apps'
  if (r.person) {
    let seats = c.seats.filter((s) => seatPerson(s) == r.entity.eid)
    let held = (role: string) =>
      seats.filter((s) => s.member!.role == role)
        .flatMap((s) => byId(seatSpace(s)) ?? [])
    let owns = new Set(held('owner').map((s) => s.entity.eid))
    let brought = invited(d).filter((i) =>
      idOf(i.referral!.inviter) == r.entity.eid
    )
    more = grouped(d, 'Owner of', held('owner')) +
      grouped(d, 'Editor of', held('editor')) +
      grouped(d, 'Viewer of', held('viewer')) +
      grouped(d, 'Apps', c.apps.filter((a) => owns.has(appSpace(a)))) +
      (brought.length
        ? `<h2 class="Group">Invited</h2>${referrals(d, brought)}`
        : '')
  }
  if (r.space) {
    let seats = c.seats.filter((s) => seatSpace(s) == r.entity.eid)
    let held = (role: string) =>
      seats.filter((s) => s.member!.role == role)
        .flatMap((s) => byId(seatPerson(s)) ?? [])
    ctx.owners = held('owner').map((p) => refOf(d, p))
    more =
      `<p><a href="${PATH}/${r.entity.eid}/operator">${
        esc(spaceOf(r).operator)
      }’s conversations, and what its model was told</a></p>` +
      grouped(d, 'Owners', held('owner')) +
      grouped(d, 'Editors', held('editor')) +
      grouped(d, 'Viewers', held('viewer')) +
      grouped(d, 'Apps', c.apps.filter((a) => appSpace(a) == r.entity.eid))
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
    drawn(r, 'Directory.Page', ctx) + more,
    `<a class="Desk_Address" href="${PATH}/${key}${tested(d)}">${
      LISTS[key].title
    }</a>`,
  )
}

// What the admin is to a space's Builder object: the platform's
// administrative access, which it checks against the directory again.
let vouch = (person: string) => ({
  person,
  role: null,
  administrative: true,
})

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
    `<a class="Desk_Address" href="${to}${tested(d)}">${esc(said)}</a>`
  let ask = (path: string, args: unknown) =>
    operatorDoor(env, space, vouch(person), path, args).catch((e) => {
      caught(e, { request: `admin operator ${path}` })
      return e instanceof Error ? e : new Error(String(e))
    })
  let failed = (e: Error) =>
    `<section class="Empty"><h2>The Operator could not be read: ${
      esc(e.message)
    }</h2></section>`
  if (!open) {
    let items = await ask('work', { everyone: true }) as Worked[] | Error
    return desk(
      d,
      `${space.operator}’s conversations`,
      'spaces',
      items instanceof Error
        ? failed(items)
        : items.length
        ? `<div class="Card">${listed(items, (o) => `${home}/${o}`)}</div>`
        : '<section class="Empty"><h2>Nobody has talked to this Operator yet</h2></section>',
      back(`${PATH}/${r.entity.eid}`, space.slug),
    )
  }
  let talked = await ask('conversation', {
    at: managePath('operator', space.slug),
    open,
    everyone: true,
  }) as { title: string; html: string } | Error
  let found = !(talked instanceof Error) && talked.html
  return desk(
    d,
    talked instanceof Error || !talked.title
      ? 'Not a conversation'
      : talked.title,
    'spaces',
    talked instanceof Error
      ? failed(talked)
      : found
      ? talked.html
      : '<section class="Empty"><h2>This Operator has no conversation with that id</h2></section>',
    back(home, `${space.operator}’s conversations`),
    talked instanceof Error || found ? 200 : 404,
  )
}

// The windows the funnel is read over, in days.
let WINDOWS = [1, 7, 30, 90]

// yaks.app's own funnel (funnel.ts): each step's count over the window, and
// its share of the step it follows, then the sites that sent the home page
// its visitors.
let funnelPage = (
  d: Reading,
  f: Funnel | null | Error,
  days: number,
) => {
  let windows = WINDOWS.map((n) =>
    `<a href="${PATH}/funnel?days=${n}"${
      n == days ? ' aria-current="page"' : ''
    }>${n == 1 ? '1 day' : `${n} days`}</a>`
  ).join(' · ')
  let say = (name: string) => STEPS.find((s) => s.name == name)!.say
  let of = (name: string) => {
    let s = STEPS.find((s) => s.name == name)
    return s && 'of' in s ? say(s.of).toLowerCase() : ''
  }
  let body = f instanceof Error
    ? `<section class="Empty"><h2>The counts could not be read: ${
      esc(f.message)
    }</h2></section>`
    : !f
    ? `<section class="Empty"><h2>${esc(NOT_ON)}</h2></section>`
    : `<div class="Card"><dl class="Fields Directory_Facts">${
      f.steps.map((s) =>
        `<div><dt>${esc(s.say)}</dt><dd>${s.n}${
          s.share == null
            ? ''
            : ` · ${Math.round(s.share * 100)}% of ${esc(of(s.name))}`
        }</dd></div>`
      ).join('')
    }</dl></div>${
      f.from.length
        ? `<h2 class="Group">Came to the home page from</h2><div class="Card"><dl class="Fields Directory_Facts">${
          f.from.map((r) => `<div><dt>${esc(r.site)}</dt><dd>${r.n}</dd></div>`)
            .join('')
        }</dl></div>`
        : ''
    }`
  return desk(
    d,
    'Funnel',
    'funnel',
    `<div class="Directory_Bar"><nav aria-label="Window">${windows}</nav></div>${body}`,
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
      '<section class="Empty"><h2>Nothing in the directory has that id</h2></section>',
      '',
      404,
    )
  }
  return part
    ? await operatorPage(d, env, r, who, open)
    : await page(d, dir, r, env)
}
