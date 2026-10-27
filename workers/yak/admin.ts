// The platform admin's directory (T-124291): every person, space and app on
// yaks.app and what each uses, at /admin on the apex. A person's row says
// what their account spent this month against its one budget (M-42105), the
// storage and apps of the spaces they own, and when they were last active; a
// space's says its own spend, storage, apps and latest use; an app's, its
// requests, storage, version and latest use. Each opens to a page of its own.
//
// Only an owner of the `yak` space sees it, signed in by the platform's
// session cookie (`staff`); anybody else is told nothing is here, and an
// agent reads the same rows through `yak admin query yak/platform`. It only
// reads: four directory reads a page, nothing written and no socket, so an
// open tab costs the directory nothing.
//
// The rows and pages are drawn by the worker's registry (render/directory.ts);
// this file counts what each uses and draws the desk around them.

import type { Env } from './env.ts'
import { type Held, holding } from './held.ts'
import {
  appOf,
  type Directory,
  idOf,
  META,
  type Row,
  type Space,
  spaceOf,
} from './directory.ts'
import { budget, monthOf } from './meter.ts'
import { isTestAddress } from './lib/bots.ts'
import { sessionAt } from './session.ts'
import { drawn } from './render/mod.ts'
import type { Ref, Uses } from './render/directory.ts'
import { esc } from './html.ts'
import { lost, shell } from './pages.ts'
import { icon, type IconName } from './icons.ts'
import { type Host, spaceHost, url } from './host.ts'
import { statsOf } from './views.ts'
import { caught } from './defects.ts'

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

/**
 * What every row uses, counted once over the whole directory. A space: what
 * models and voice cost in it this month, its database and files, its apps
 * and the latest use of it or of any of them. An app: this month's requests,
 * its database and files and its latest use. A person: their budget over the
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
    return [s.eid, holding(s, (everyIn.get(s.eid) ?? []).map(appOf))]
  }))
  let stored = (h?: Held) => (h?.bytes ?? 0) + (h?.files ?? 0)
  let out = new Map<string, Uses>()
  for (let r of c.spaces) {
    let s = spaces.get(r.entity.eid)!
    let apps = appsIn.get(s.eid) ?? []
    out.set(s.eid, {
      spend: { spent: budget([s], now).spent },
      storage: stored(held.get(s.eid)),
      apps: apps.length,
      active: latest(r.used?.at, ...apps.map((a) => a.used?.at)),
      test: tested(s.eid),
    })
  }
  for (let r of c.apps) {
    out.set(r.entity.eid, {
      requests: r.meter?.month == month ? r.meter.requests ?? 0 : 0,
      storage: stored(held.get(appSpace(r))?.apps.get(r.app!.slug)),
      active: r.used?.at ?? null,
      test: out.get(appSpace(r))?.test ?? false,
    })
  }
  for (let r of c.people) {
    let owned = (seatsOf.get(r.entity.eid) ?? [])
      .filter((s) => s.member!.role == 'owner')
      .flatMap((s) => spaces.get(seatSpace(s)) ?? [])
      .filter((s) => s.slug != META.space)
    out.set(r.entity.eid, {
      spend: budget(owned, now),
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

let personName = (r: Row) =>
  r.doc?.title || (r.email?.address ?? '').split('@')[0] || 'Someone'
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
      ? `${spaceHost(d.env, space)}/${r.app.slug}`
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
    ? `<ul class="Directory">${
      ordered(d, all).map((r) =>
        `<li>${drawn(r, 'Directory.List.Tile', around(d, r))}</li>`
      ).join('')
    }</ul>`
    : ''
let grouped = (d: Reading, title: string, all: Row[]) =>
  all.length ? `<h2 class="Group">${esc(title)}</h2>${rows(d, all)}` : ''

let lists = (c: Census): Record<List, Row[]> => ({
  people: c.people,
  spaces: c.spaces,
  apps: c.apps,
})
let tested = (d: Reading) => d.tests ? '?tests=1' : ''

// The desk: the three lists down the side, each with how many it holds.
let desk = (
  d: Reading,
  title: string,
  current: List | null,
  body: string,
  kicker = '',
  status = 200,
) => {
  let all = lists(d.census)
  let nav = KEYS.map((key) =>
    `<a href="${PATH}/${key}${tested(d)}"${
      current == key ? ' aria-current="page"' : ''
    }>${icon(LISTS[key].icon)}${LISTS[key].title}<span class="Desk_Count">${
      shown(d, all[key]).length
    }</span></a>`
  ).join('')
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
    css,
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
    more = grouped(d, 'Owner of', held('owner')) +
      grouped(d, 'Editor of', held('editor')) +
      grouped(d, 'Viewer of', held('viewer')) +
      grouped(d, 'Apps', c.apps.filter((a) => owns.has(appSpace(a))))
  }
  if (r.space) {
    let seats = c.seats.filter((s) => seatSpace(s) == r.entity.eid)
    let held = (role: string) =>
      seats.filter((s) => s.member!.role == role)
        .flatMap((s) => byId(seatPerson(s)) ?? [])
    ctx.owners = held('owner').map((p) => refOf(d, p))
    more = grouped(d, 'Owners', held('owner')) +
      grouped(d, 'Editors', held('editor')) +
      grouped(d, 'Viewers', held('viewer')) +
      grouped(d, 'Apps', c.apps.filter((a) => appSpace(a) == r.entity.eid))
  }
  if (r.app) {
    let home = byId(appSpace(r))
    let from = r.installed?.of ? d.apps.get(idOf(r.installed.of)) : undefined
    let [deploys, visits] = await Promise.all([
      dir.deploys(appOf(r)),
      (statsOf(env, r.entity.eid) ?? Promise.resolve(null))
        .then((s) => s?.total ?? null, (e) => {
          caught(e, { request: 'admin visits' })
          return null
        }),
    ])
    ctx.home = home ? refOf(d, home) : undefined
    ctx.from = from ? refOf(d, from) : undefined
    ctx.deploys = { count: deploys.length, at: deploys[0]?.at ?? '' }
    ctx.visits = visits
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
  let r = [...d.census.people, ...d.census.spaces, ...d.census.apps]
    .find((x) => x.entity.eid == rest)
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
  return await page(d, dir, r, env)
}

// The directory's own parts: a search bar, and one card of rows with
// hairlines between them, as the style guide draws .Rows, each saying what it
// uses, each figure under the word for it; one column on a phone.
let css = `
.Directory_Bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .75rem 1.5rem; margin: 0 0 1.5rem }
.Directory_Find { display: flex; gap: .5rem; flex: 1 1 20rem; max-width: 30rem; margin: 0 }
.Directory_Find .Field { flex: 1 }
.Directory_Bar > a { font-size: .9rem }
.Directory { display: grid; margin: 0; padding: 0; list-style: none; border: 1px solid var(--edge); border-radius: .75rem; background: var(--paper); overflow: hidden }
.Directory_Row { position: relative; display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 2fr); align-items: center; gap: .5rem 1.5rem; padding: .85rem 1.25rem; border-top: 1px solid var(--line) }
.Directory_Row:first-child { border-top: 0 }
.Directory_Row:hover { background: color-mix(in srgb, var(--ground), var(--paper) 55%) }
.Directory_Who { display: grid; gap: .1rem; min-width: 0 }
.Directory_Who .Apps_Tags { margin: .25rem 0 0; padding: 0 }
.Directory_Open { color: var(--ink); text-decoration: none; overflow-wrap: anywhere }
.Directory_Open::after { content: ''; position: absolute; inset: 0; border-radius: inherit }
.Directory_Open:focus-visible { outline: 0 }
.Directory_Open:focus-visible::after { outline: 3px solid var(--accent); outline-offset: 3px }
.Directory_Sub { color: var(--soft-ink); font-size: .85rem; overflow-wrap: anywhere }
.Directory_Uses { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .5rem 1rem; margin: 0 }
.Directory_Uses dt { color: var(--soft-ink); font-size: .8rem }
.Directory_Uses dd { margin: 0; font-variant-numeric: tabular-nums }
.Directory_Facts > div { grid-template-columns: 10rem minmax(0, 1fr) }
.Directory_Facts dt { font-weight: 700; color: var(--soft-ink) }
.Directory_Content .Group { margin-top: 2rem }
@media (max-width: 700px) {
  .Directory_Row { grid-template-columns: minmax(0, 1fr) }
  .Directory_Uses { grid-template-columns: repeat(2, minmax(0, 1fr)) }
  .Directory_Facts > div { grid-template-columns: 8rem minmax(0, 1fr) }
}
`
