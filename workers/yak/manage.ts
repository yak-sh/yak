// The dashboard, at the apex: the person's own pages and each space's, drawn
// and their forms saved. apps.ts serves a space's pages and loads this on the
// first request to `/manage`, so an isolate that only serves pages never
// compiles it (T-148886).
import { copyOf } from './directory-copy.ts'
import { spaceHost, url as hostUrl } from './host.ts'
import { browserImmutable } from './cache.ts'
import {
  type App,
  daysLeft,
  directory,
  META,
  paid,
  type Role,
  type Seat,
  type Space,
  walkTo,
} from './directory.ts'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import type { Beside } from './operator-page.ts'
import { pilled, standing } from './gallery-row.ts'
import {
  billedTo,
  buy,
  checkout,
  planCard,
  portal,
  setCap,
  wanted,
} from './billing.ts'
import { payments, plans } from './payments.ts'
import {
  connecting,
  connectionsAsked,
  connectionsOf,
  enabled,
} from './connections.ts'
import {
  connect,
  disconnect,
  feeOf,
  rate,
  refusedSell,
  selling,
} from './sell.ts'
import { type File } from './uploads.ts'
import { type DeskPage, nothingHere, sentence, type Visits } from './pages.ts'
import { desk as deskPage } from './desk-pages.ts'
import { LOGO, logoBytes, logoed } from './logo.ts'
import { again } from './invite.ts'
import { peopleIn } from './people.ts'
import { CallError } from '@yaks/tools/errors'
import { untrash } from './erase.ts'
import {
  type AccountView,
  accountView,
  backTo,
  chatPath,
  landing,
  logoPath,
  MANAGE,
  managed,
  managePath,
  type ManageView,
  signInAt,
  type SpaceView,
} from './route.ts'
import { SLUG } from '@yaks/platform/names'
import { vouched, type Who, whoIs } from './session.ts'
import { asking, bearerIn } from './asking.ts'
import { upgrading } from './protocol.ts'
import { nameOf } from './names.ts'
import { writes } from '@yaks/member'
import { brokenIn, fault, trackedIn } from './unseen.ts'
import { TOOLS } from './tools.ts'
import { caught } from './defects.ts'
import { woken } from './build-door.ts'
import { invitation } from './referral.ts'
import { budget, gauges, spent } from './meter.ts'
import { DAYS, NOT_ON, statsFor } from './views.ts'
import { refuse } from './tool.ts'
import { letIn, letOut, reachOf } from './operator-reach.ts'
import { json, kernels, moved, redirect, shelf } from './apps.ts'

// The identity part, asked for at request time rather than imported at the
// top: it carries the OAuth provider, whose `cloudflare:` modules exist only
// inside workerd, and this part's own tests run outside it. The two are peers
// in one Worker (index.ts binds each), so this is the in-process form of
// the service binding a split would give them — a `bound` with no namespace to
// call. Nothing above the owner block below asks for it, so nothing else pays.
let identity = () => import('./identity.ts')

// The agents a person has connected (connected.ts `agentsOf`), asked in the
// page's directory trip.
let agentsOf = (
  env: Env,
  person: string,
  dir: ReturnType<typeof directory>,
) => identity().then((part) => part.agents(env, person, dir))

// What a read has answered by now, or nothing while it is still out: a page
// that shows it only when it is in hand never waits on it.
let inHand = <T>(read?: Promise<T>) => Promise.race([read, undefined])

// Every app's visitors, for the owner's block: every app in the same four
// queries (views.ts `statsFor`), each answer already cached for a few minutes
// there — and a failure is `null` rather than a throw, because this is the
// space's front door and it does not go down because Cloudflare's analytics
// did.
let visits = async (env: Env, apps: App[]): Promise<Visits[] | null> => {
  let asked = statsFor(env, apps.map((a) => a.eid))
  if (!asked) return null
  try {
    let all = await asked
    return apps.map((a) => ({
      slug: a.slug,
      title: a.title,
      stats: all.get(a.eid)!,
    }))
  } catch (e) {
    caught(e, { request: 'views' })
    return null
  }
}

// What a page arrived back from says: a form saved, a service's sign-in
// finished or not (connections.ts `callback`), or an agent was disconnected
// (identity.ts).
let returned = (q: URLSearchParams) =>
  q.has('saved')
    ? { say: 'Saved.', no: false }
    : q.has('sent')
    ? { say: 'Sent again.', no: false }
    : q.has('invited')
    ? { say: 'Invitation sent.', no: false }
    : q.has('removed')
    ? { say: 'Removed.', no: false }
    : q.has('connected')
    ? { say: 'Connected.', no: false }
    : q.has('disconnected')
    ? { say: 'Disconnected.', no: false }
    : q.has('refused')
    ? { say: "The sign-in didn't finish. Try connecting again.", no: true }
    : null

// The dashboard, at the apex (T-39354): the person's own pages at
// `/manage/account/<page>`, and each space's at `/manage/<space>/<page>`
// (T-136122). A space's owner is shown all of its pages and a member who may
// change it its Operator; anybody else is answered what a wrong address is.
export let manage = async (req: Request, env: Env): Promise<Response> => {
  let url = new URL(req.url)
  let at = managed(url.pathname)
  if (!at) return nothingHere(env)
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), {
    copy: copyOf(env),
    time: env.CLOCK,
  })
  // A browser's socket the person lends their Operator comes from an
  // extension, which holds no cookie of ours: it bears the token it signed in
  // for (identity.ts `bearerIn`), and is refused rather than sent to sign in.
  let socket = upgrading(req) && !!bearerIn(req)
  let caller = socket ? (await asking(env, req)).who : undefined
  let { person, until } = caller
    ? { person: caller.person, until: caller.until }
    : socket
    ? { person: null, until: undefined }
    : await whoIs(req, env.SESSION_SECRET, () => Promise.resolve(null))
  if (!person && socket) return json(401, 'signed_out', 'Sign in again.')
  if (!person) return redirect(signInAt(sentFrom(req, env).href, env), 303)
  if (url.searchParams.has('settings-draft')) {
    let { settingsDraft } = await import('./settings-draft.ts')
    return settingsDraft(req, dir, { person, role: null, until })
  }
  // A token narrowed to one space reaches that space alone.
  if (caller?.space && 'space' in at && caller.space != at.space) {
    return json(403, 'not_a_member', 'That token is for another space.')
  }
  let asked = url.searchParams.get('space')
  if (asked && !SLUG.test(asked)) return nothingHere(env)
  // `/manage` opens a new chat in the space the person opens first, and an
  // address from before the space was in the path (`?space=`, or none for
  // their own) is sent on to where its page is now, so links in letters keep
  // working.
  if ('first' in at || 'legacy' in at) {
    let account = 'legacy' in at && accountView(at.legacy)
    let own = account || asked ? null : await dir.own(person)
    // The chat `/manage` opens asks the space's Operator before anything.
    if (own && 'first' in at) woken(env, own.eid)
    let slug = account ? '' : asked ?? own!.slug
    let to = new URL(landing(at, slug), hostUrl(env))
    for (let [k, v] of url.searchParams) {
      if (k != 'space') to.searchParams.append(k, v)
    }
    to.hash = url.hash
    return 'first' in at ? redirect(to.href) : moved(req, to.href)
  }
  if ('account' in at) {
    return mine(req, env, dir, { person, role: null, until }, at.account)
  }
  let view = at.view
  let paged = dir.page(
    at.space,
    null,
    person,
    view == 'operator' || view == 'updates',
  )
  if (req.method == 'GET' || req.method == 'HEAD') {
    // The page drawn on the dashboard, not a conversation in the chat app
    // or one of the space's files.
    let drawn = !at.open && !at.logo && !at.manifest
    foresee(
      dir,
      person,
      view,
      drawn
        ? {
          env,
          slug: at.space,
          // A page read that fails is the page's to meet, below.
          space: paged.then((p) => p.space, () => null),
          add: url.searchParams.get('detail'),
        }
        : undefined,
      !!at.open && !url.searchParams.has('attachment'),
    )
  }
  let { space, role, administrative } = await paged
  if (!space) {
    // A link written before the space moved to another name (T-34658).
    let was = await dir.formerly(at.space)
    if (!was) return nothingHere(env)
    return moved(req, hostUrl(env, managePath(view, was.slug)) + url.search)
  }
  if (space.slug == META.space) return nothingHere(env)
  let who: Owner = {
    person,
    role: administrative ? 'owner' : role ?? null,
    administrative,
    until,
  }
  if (at.logo) return logoOf(env, space, who, at.logo)
  if (at.manifest) {
    let open = req.method == 'GET' || req.method == 'HEAD'
    if (!open || !writes(who.role) || space.trashed) return nothingHere(env)
    let { installing } = await import('./operator-page.ts')
    return installing(space)
  }
  // The Operator is open to every member who may change the space; its own
  // requests are answered by it, its settings page is drawn like every
  // other, and each conversation with it opens in its chat app, which
  // opens the files sent in it where it stands (operator-view.ts `attached`).
  // Its Updates open in the chat app too.
  let reading = req.method == 'GET' || req.method == 'HEAD'
  // Any other page of the space wakes its Operator for a member who talks to
  // it, so the chat they open next finds it up (build-door.ts `woken`); the
  // chat and Updates ask it themselves.
  let asks = view == 'updates' || view == 'operator' && at.open
  if (
    reading && !asks && writes(who.role) && !administrative && !space.trashed
  ) {
    woken(env, space.eid)
  }
  if (view == 'updates' && writes(who.role) && !space.trashed) {
    if (req.method == 'POST') {
      let { updatesAnswer } = await import('./updates.ts')
      return updatesAnswer(req, env, space, who)
    }
    if (!reading) return nothingHere(env)
    let { updatesPage } = await import('./operator-page.ts')
    return updatesPage(env, space, who, await beside(dir, space, who))
  }
  if (view == 'operator' && writes(who.role) && !space.trashed) {
    let { chatPage, operatorAnswer } = await import('./operator-page.ts')
    if (at.open && !new URL(req.url).searchParams.has('attachment')) {
      return reading
        ? chatPage(
          env,
          space,
          who,
          at.open,
          await beside(dir, space, who),
          url.searchParams.get('app'),
        )
        : nothingHere(env)
    }
    return await operatorAnswer(req, env, space, who) ??
      desk(req, env, dir, space, who, view)
  }
  if (who.role != 'owner') {
    // Of a space they don't own, a member who may change it has its
    // Operator, which every other page of it sends them to.
    return writes(who.role) && !space.trashed &&
        (req.method == 'GET' || req.method == 'HEAD')
      ? redirect(hostUrl(env, managePath('operator', space.slug)))
      : nothingHere(env)
  }
  // A space in the trash is brought back from its own address (`closed`).
  if (space.trashed) {
    return redirect(`https://${spaceHost(env, space.slug)}/`, 303)
  }
  if (req.method == 'POST') return saved(req, env, dir, space, who, view)
  if (req.method != 'GET' && req.method != 'HEAD') return nothingHere(env)
  if (view == 'connections') {
    let old = url.searchParams.get('add') ?? url.searchParams.get('connect')
    if (old) {
      url.searchParams.delete('add')
      url.searchParams.delete('connect')
      url.hash = encodeURIComponent(old)
      return redirect(url.href, 303)
    }
  }
  return desk(req, env, dir, space, who, view)
}

// Which space the side's selector holds on a page of the person's own: the
// one whose pages this browser opened last, kept in a cookie of the
// dashboard's alone, so going back from Profile to Apps returns to it.
let IN = 'yak-in'
let inOf = (req: Request) =>
  /(?:^|;\s*)yak-in=([a-z0-9-]+)/.exec(req.headers.get('cookie') ?? '')?.[1]
let keptIn = (res: Response, slug: string) => {
  res.headers.append(
    'set-cookie',
    `${IN}=${slug}; Path=${MANAGE}; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`,
  )
  return res
}

// What a dashboard page will ask the directory, asked at once so it travels
// with whatever else this moment asks (directory-copy.ts `gathered`): each is
// answered again from this reading when the page comes to it (hops.ts
// `recall`), and a failure is the page's to meet when it does. A seat names its
// space, so the side's selector comes with the person's seats.
let foresee = (
  dir: ReturnType<typeof directory>,
  person: string,
  view: ManageView,
  here?: Ahead,
  chat = false,
) => {
  let seats = dir.seats(person)
  void Promise.allSettled([
    feeOf(dir),
    dir.nameAt(person),
    seats,
    ...view == 'shared' ? [dir.granted(person)] : [],
    // The chat draws the lists their servers offer (operator-lists.ts), once
    // it knows the conversation is their landing.
    ...view == 'operator' && chat ? [dir.listings(person)] : [],
    ...here ? rowsAhead(dir, person, view, seats, here) : [],
  ])
}

// The space a page of one is at, while the read that learns it is in flight.
type Ahead = {
  env: Env
  slug: string
  space: Promise<Space | null>
  add: string | null
}

// The rows a page of a space shows of its own (`desk`), asked by the walk to
// its address as the page asks them once it knows the space, so they travel
// beside the read that learns it (`page`). What the page may show is decided
// only once that read answers.
let rowsAhead = (
  dir: ReturnType<typeof directory>,
  person: string,
  view: ManageView,
  seats: Promise<Seat[]>,
  at: Ahead,
): Promise<unknown>[] => {
  let walk = walkTo(at.slug, at.space.then((s) => s?.eid ?? ''))
  // The person's own agents, which the page shows only if they are in hand
  // by the time it is drawn (`desk`), and who made and last deployed each app.
  if (view == 'apps') {
    return [agentsOf(at.env, person, dir), dir.provenance(walk)]
  }
  if (view == 'new') return [agentsOf(at.env, person, dir)]
  if (view == 'people') return [dir.people(walk), dir.admits(walk)]
  if (view == 'operator') {
    return [
      reachOf(dir, walk, person),
      dir.texting(person),
      dir.alerts(person),
      dir.emailAt(person),
      dir.pushes(person),
    ]
  }
  if (view != 'connections') return []
  return [
    // The outside services holding a grant from the person, shown only on
    // their own space, asked before the page knows whether it is.
    identity().then((part) => part.services(at.env, person, dir)),
    connectionsAsked(
      at.env,
      at.space.then((s) => s ?? Promise.reject(new Error('no space here'))),
      person,
      {
        dir,
        by: walk.path,
        own: seats.then((all) =>
          all.some((s) => s.own && s.space.slug == at.slug)
        ),
        add: at.add ?? undefined,
      },
    ),
  ]
}

// Who a dashboard page is drawn for: a person signed in, who owns the space.
type Owner = Who & { person: string }

// The apps of other people's spaces this person may open (T-124081): each app
// of a space they hold a seat in and do not own, and each app they are a guest
// of. What is in the trash opens onto nothing, so it is left out, and an app
// of a space they own is on that space's own page.
export let shared = async (
  dir: ReturnType<typeof directory>,
  person: string,
) => {
  let [seats, granted] = await Promise.all([
    dir.seats(person),
    dir.granted(person),
  ])
  let owned = new Set(
    seats.filter((s) => s.role == 'owner').map((s) => s.space.eid),
  )
  let spaces = seats.map((s) => s.space)
    .filter((s) => !owned.has(s.eid) && !s.trashed)
  let seated = (await dir.apps(spaces)).map((app) => ({
    space: spaces.find((s) => s.eid == app.space)!,
    app,
  }))
  // One row an app, however it was shared: a seat and a grant can both
  // reach it.
  let each = new Map([...seated, ...granted].map((g) => [g.app.eid, g]))
  return [...each.values()]
    .filter(({ space, app }) =>
      !owned.has(space.eid) && !space.trashed && !app.trashed &&
      !kernels(space, app.slug)
    )
    .map(({ space, app }) => ({
      eid: app.eid,
      slug: app.slug,
      title: app.title,
      space: space.slug,
    }))
}

let sentFrom = (req: Request, env: Env) => {
  let at = new URL(req.url)
  return new URL(at.pathname + at.search, hostUrl(env))
}

// The spaces the side's selector offers (pages.ts `Picked`): every one this
// person may work in, the one they open first at the top, then those they
// own, then those they are a member of, each named by whose it is: every
// owner's name in one read.
let pickable = async (dir: ReturnType<typeof directory>, seats: Seat[]) => {
  let kept = seats.filter((s) => !s.space.trashed && writes(s.role))
    .sort((a, b) =>
      Number(b.own) - Number(a.own) ||
      Number(b.role == 'owner') - Number(a.role == 'owner')
    )
  let names = await dir.persons([
    ...new Set(
      kept.flatMap((s) => s.role != 'owner' && s.owner ? [s.owner] : []),
    ),
  ])
  return kept.map((s) => ({
    slug: s.space.slug,
    title: s.space.title,
    owner: s.role == 'owner',
    own: s.own,
    whose: s.role == 'owner' ? undefined : names.get(s.owner!)?.name,
    operator: s.space.operator,
    logo: logoPath(s.space),
  }))
}

// What the chat app's side holds (operator-page.ts `Beside`), asked at once:
// the spaces its selector offers, the apps here this person may open, and
// what they are called, and whether they are the platform's admin, which the
// page's read said (`administrative`).
let beside = async (
  dir: ReturnType<typeof directory>,
  space: Space,
  who: Owner,
): Promise<Beside> => {
  let [spaces, { mine }, name] = await Promise.all([
    dir.seats(who.person).then((seats) => pickable(dir, seats)),
    dir.apps(space).then((apps) => shelf(apps, space, who)),
    dir.nameAt(who.person),
  ])
  return {
    spaces,
    apps: mine.map((a) => ({ eid: a.eid, slug: a.slug, title: a.title })),
    name,
    admin: !!who.administrative,
  }
}

// One page of a space's (pages.ts `desk`), for its owner, or its Operator for
// a member who may change it.
let desk = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  who: Owner,
  view: SpaceView,
  said?: { say: string; no: boolean },
  typed?: Pick<DeskPage, 'invite' | 'typed'>,
): Promise<Response> => {
  let owner = who.person
  let q = new URL(req.url).searchParams
  // Everything a page shows, asked at once: nothing here waits on anything but
  // the apps it says something about.
  if (view == 'apps') {
    void trackedIn(env, space, who, true).catch(() => {})
  }
  let shelved = dir.apps(space).then((apps) => shelf(apps, space, who))
  // Whether an agent is connected, for the pages that say how to make an app
  // with one. They are drawn with it only if it is in hand once everything
  // else is, since a person whose grants are not yet in the directory has
  // them read from the provider's KV, which takes longer than the rest of
  // the page (T-149703, grant-rows.ts), and the page's script
  // settles what depends on it (pages.ts `state`). A read that fails is
  // reported and left to the script too.
  let agents = view == 'apps' || view == 'new'
    ? agentsOf(env, owner, dir).catch((e) => {
      caught(e, { request: 'read agents', space: space.slug })
      return undefined
    })
    : undefined
  let [
    { here, all },
    broken,
    views,
    fee,
    people,
    connections,
    picks,
    operator,
    billed,
    provider,
    made,
    collapsed,
  ] = await Promise.all([
    shelved,
    // What is broken in each app (unseen.ts `brokenIn`), read only for the
    // page that lists them: one read of the space's tracker, no app's store
    // woken. A read that fails is reported and the apps are drawn without it.
    view == 'apps'
      ? shelved.then(({ all }) =>
        all.length
          ? brokenIn(env, space, who, all).catch((e) => {
            caught(e, { request: 'read open errors', space: space.slug })
            return undefined
          })
          : undefined
      )
      : undefined,
    // Who visited (views.ts, T-34497). `null` is the platform with no
    // analytics token set, and a read that fails is `null` too: the page
    // does not go down because Cloudflare's analytics did.
    view == 'visits'
      ? shelved.then(({ all }) => all.length ? visits(env, all) : undefined)
      : undefined,
    feeOf(dir),
    // Who is in the space and its apps (people.ts), read only for the page
    // that shows it.
    view == 'people'
      ? Promise.all([
        shelved.then(({ all }) => peopleIn(dir, space, all)),
        dir.admits(walkTo(space.slug, space.eid)),
      ])
      : undefined,
    // What this space calls out through (connections.ts), read only for the
    // page that shows it; on the person's own space (`member.own`), what they
    // connected for themselves and the services holding a grant from them.
    view == 'connections'
      ? connectionsOf(env, space, owner, {
        dir,
        by: walkTo(space.slug, space.eid).path,
        own: dir.seats(owner, 'owner').then((seats) =>
          seats.some((s) => s.own && s.space.eid == space.eid)
        ),
        // Asked beside the directory's reads, and kept only on their own.
        services: identity().then((part) => part.services(env, owner, dir)),
        enable: enabled(req),
        add: q.get('detail') ?? undefined,
        find: q.get('q') ?? undefined,
        open: q.get('detail') ?? undefined,
      })
      : undefined,
    // Every space this person may work in, which the side's selector offers.
    dir.seats(owner).then((seats) => pickable(dir, seats)),
    view == 'operator'
      ? import('./operator-page.ts').then((part) =>
        part.operatorBody(env, space, who)
      )
      : undefined,
    // Whom the payment provider bills, for the Billing page (T-131895). A
    // read that fails is reported, and the page says only that it bills.
    view == 'billing'
      ? plans(env).then((lent) => billedTo(lent, space)).catch((e) => {
        caught(e, { request: 'read billing customer', space: space.slug })
        return undefined
      })
      : undefined,
    payments(env),
    // Who made each app and who deployed it last (T-151161), for the page
    // that lists them. A read that fails is reported and the apps are drawn
    // without it.
    view == 'apps'
      ? dir.provenance(walkTo(space.slug, space.eid)).catch((e) => {
        caught(e, { request: 'read app provenance', space: space.slug })
        return undefined
      })
      : undefined,
    // How the person keeps the side (`desk_sidebar{collapsed}`).
    dir.collapsed(owner),
  ])
  let known = await inHand(agents)
  let page = deskPage({
    person: who.person,
    views,
    viewDays: DAYS,
    viewsOff: NOT_ON,
    space: space.slug,
    view,
    apps: all.map((a) => ({
      eid: a.eid,
      slug: a.slug,
      title: a.title,
      home: a.home,
      access: a.access,
      gallery: pilled(standing(a)),
      errors: broken?.get(a.eid),
      made: made?.of.get(a.eid)?.made,
      deployed: made?.of.get(a.eid)?.deployed,
    })),
    writers: made?.writers,
    trash: here.filter((a) => a.trashed).map((a) => ({
      eid: a.eid,
      slug: a.slug,
      title: a.title,
      days: daysLeft(a.trashed!),
    })),
    // Where the space stands with selling (sell.ts, T-34524), and only where
    // the platform's payment provider can be asked at all, since a button
    // that cannot work is worse than no block.
    sell: provider.shops.on() ? selling(space) : undefined,
    provider: provider.name,
    paying: paid(space.tier),
    plan: planCard(provider.plans, space),
    paid: q.get('paid') == '1',
    // The space's month against its allowances (meter.ts), as the
    // directory's row holds it.
    bill: view == 'billing'
      ? {
        limits: gauges(space, all.length),
        budget: budget(space),
        read: spent(space).at || null,
        payer: billed,
      }
      : undefined,
    fee: rate(fee),
    agents: known,
    people: people?.[0],
    operators: people?.[1].map((r) => ({
      eid: r.space.eid,
      slug: r.space.slug,
      title: r.space.title,
      role: r.role,
    })),
    connections,
    spaces: picks.some((s) => s.slug == space.slug) ? picks : [
      {
        slug: space.slug,
        title: space.title,
        owner: who.role == 'owner',
        own: false,
        operator: space.operator,
        logo: logoPath(space),
      },
      ...picks,
    ],
    operator,
    member: who.role != 'owner',
    collapsed,
    ...typed,
    say: said?.say ?? returned(q)?.say ?? '',
    no: said?.no ?? returned(q)?.no,
  }, env)
  return keptIn(page, space.slug)
}

// One page of the person's own (pages.ts `desk`): their profile, their
// agents, what others shared with them, a new space. The side's selector
// holds the space this browser was last in, or the one `?space=` chose.
let mine = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  who: Owner,
  view: AccountView,
  said?: { say: string; no: boolean },
  typed?: Pick<DeskPage, 'typed' | 'made'>,
): Promise<Response> => {
  let person = who.person
  let q = new URL(req.url).searchParams
  if (req.method == 'POST' && !said) {
    return account(req, env, dir, who, view)
  }
  if (req.method != 'GET' && req.method != 'HEAD' && req.method != 'POST') {
    return nothingHere(env)
  }
  if (req.method != 'POST') foresee(dir, person, view)
  let [picks, name, email, agents, theirs, referral, own, collapsed] =
    await Promise.all([
      dir.seats(person).then((seats) => pickable(dir, seats)),
      dir.nameAt(person),
      view == 'profile' ? dir.emailAt(person) : undefined,
      view == 'agents' ? agentsOf(env, person, dir) : [],
      view == 'shared' ? shared(dir, person) : undefined,
      view == 'invite' ? invitation(env, dir, person) : undefined,
      dir.own(person),
      dir.collapsed(person),
    ])
  let chosen = q.get('space') ?? inOf(req)
  let space = picks.find((s) => s.slug == chosen)?.slug ?? own.slug
  let page = deskPage({
    person: who.person,
    space,
    view,
    apps: [],
    name: name ?? '',
    email: email ?? '',
    agents,
    shared: theirs,
    referral,
    spaces: picks.some((s) => s.slug == own.slug) ? picks : [
      {
        slug: own.slug,
        title: own.title,
        owner: true,
        own: true,
        logo: logoPath(own),
      },
      ...picks,
    ],
    member: !picks.find((s) => s.slug == space)?.owner,
    collapsed,
    ...typed,
    say: said?.say ?? returned(q)?.say ?? '',
    no: said?.no ?? returned(q)?.no,
  }, env)
  return q.has('space') ? keptIn(page, space) : page
}

// What a page of the person's own posts: Profile's name and the space they
// open first, and a new space.
let account = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  who: Owner,
  view: AccountView,
): Promise<Response> => {
  let form = await req.formData().catch(() => new FormData())
  if (view == 'space') {
    let made = {
      title: String(form.get('title') ?? '').trim().slice(0, 60),
      slug: String(form.get('slug') ?? '').trim().toLowerCase(),
    }
    let { said } = await pressed(env, dir, who, 'space_new', {
      slug: made.slug,
      title: made.title || made.slug,
    })
    if (said) return mine(req, env, dir, who, view, said, { made })
    return keptIn(
      redirect(hostUrl(env, chatPath(made.slug)), 303),
      made.slug,
    )
  }
  if (view != 'profile') return nothingHere(env)
  // The side's fold (desk-pages.ts `fold`), pressed on any page: kept on the
  // person's row, then that page again, or for the script that sent it,
  // nothing more.
  if (form.has('sidebar')) {
    await dir.apply({
      entities: [{
        entity: { eid: who.person },
        desk_sidebar: { collapsed: form.get('sidebar') == 'collapsed' },
      }],
    }, { 'x-yak-person': who.person, 'x-yak-role': 'owner' })
    if (!req.headers.get('accept')?.includes('text/html')) {
      return new Response(null, { status: 204 })
    }
    return redirect(
      backTo(env, String(form.get('back') ?? ''), managePath('profile')),
      303,
    )
  }
  // Cleared, the front of their address comes back — a person always has a
  // title, because a member row names them by it and a titleless one reads
  // back as a bare eid (T-32733). `nameOf` is the same fallback signing in
  // writes.
  if (form.has('name')) {
    await dir.apply({
      entities: [{
        entity: { eid: who.person },
        doc: {
          title: String(form.get('name') ?? '').trim().slice(0, 60) ||
            nameOf(null, await dir.emailAt(who.person) ?? ''),
        },
      }],
    }, { 'x-yak-person': who.person, 'x-yak-role': 'owner' })
  }
  // The space they open first is the one their seat marks theirs
  // (`member.own`): the mark moves to another space they own.
  let first = String(form.get('first') ?? '').trim()
  if (first) {
    let seats = await dir.seats(who.person, 'owner')
    let to = seats.find((s) => s.space.slug == first && !s.space.trashed)
    if (to && !to.own) {
      await dir.apply({
        entities: seats.filter((s) => s.own || s == to).map((s) => ({
          entity: { eid: s.seat },
          member: { own: s == to },
        })),
      }, { 'x-yak-person': who.person, 'x-yak-role': 'owner' })
    }
  }
  let to = sentFrom(req, env)
  to.searchParams.set('saved', '1')
  return redirect(to.href, 303)
}

// A dashboard control is the tool the person's assistant would call, called
// as the person pressing it, so the page and the assistant invite, remove and
// choose a homepage one way. What the tool refuses is what the page says.
let pressed = async (
  env: Env,
  dir: ReturnType<typeof directory>,
  who: Owner,
  name: string,
  args: Record<string, unknown>,
) => {
  try {
    let out = await TOOLS.find((t) => t.name == name)!.run(
      { env, dir, person: who.person },
      args,
    )
    return { out }
  } catch (e) {
    if (e instanceof CallError) {
      return { said: { say: sentence(e.message), no: true } }
    }
    throw e
  }
}

// A space's forms return to the page that submitted them. Every space's page
// shares the cookie's site, so ownership alone is
// insufficient: a page at another address never gets here (route.ts
// `guarded`).
let saved = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  who: Owner,
  view: SpaceView,
): Promise<Response> => {
  let form = await req.formData().catch(() => new FormData())
  // The connections page's buttons (connections.ts): each is one form with a
  // `do`, answered with the page saying what came of it, or sent on to a
  // service to sign in there.
  if (form.has('do')) {
    let said = await connecting(req, env, space, who, form)
    return said instanceof Response
      ? said
      : desk(req, env, dir, space, who, 'connections', said)
  }
  // The People page's button: another letter for an invitation not yet
  // accepted, exactly as asking member_add again sends one (invite.ts).
  if (form.has('again')) {
    let said = await again(env, dir, space, who, String(form.get('again')))
    if (said) return desk(req, env, dir, space, who, 'people', said)
    let to = sentFrom(req, env)
    to.searchParams.set('sent', '1')
    return redirect(to.href, 303)
  }
  // The People page's invitation: member_add, as the assistant asks it. A
  // refusal draws the page again with what was typed still in the form.
  if (form.has('invite')) {
    let asked = {
      email: String(form.get('invite') ?? '').trim(),
      app: String(form.get('app') ?? '').trim(),
      role: String(form.get('role') ?? '').trim(),
      note: String(form.get('note') ?? '').trim(),
    }
    let { out, said } = await pressed(env, dir, who, 'member_add', {
      space: space.slug,
      email: asked.email,
      ...asked.app ? { app: asked.app } : {},
      ...asked.role ? { role: asked.role } : {},
      ...asked.note ? { note: asked.note } : {},
    })
    if (said) {
      return desk(req, env, dir, space, who, 'people', said, { invite: asked })
    }
    let to = sentFrom(req, env)
    to.searchParams.set(out?.value?.invited ? 'invited' : 'saved', '1')
    return redirect(to.href, 303)
  }
  // The People page's Operators (operator-reach.ts): one of the owner's
  // other spaces whose Operator they let work here, or take back out. Only a
  // space they sit in is offered, and only such a one is let in.
  if (form.has('operator') || form.has('unreach')) {
    try {
      if (form.has('operator')) {
        let slug = String(form.get('operator')).trim()
        let other = await dir.space(slug)
        if (!other || !await dir.role(other, who.person)) {
          throw refuse('missing', `you are in no space ${slug}`)
        }
        let role = String(form.get('role') ?? 'editor') as Role
        await letIn(dir, space, other, role, who.person, vouched(who))
      } else {
        await letOut(dir, space, String(form.get('unreach')), vouched(who))
      }
    } catch (e) {
      if (!(e instanceof CallError)) throw e
      return desk(req, env, dir, space, who, 'people', {
        say: sentence(e.message),
        no: true,
      })
    }
    let to = sentFrom(req, env)
    to.searchParams.set(form.has('operator') ? 'saved' : 'removed', '1')
    return redirect(to.href, 303)
  }
  // A People row's Remove, or Withdraw for an invitation: member_remove, as
  // the assistant asks it.
  if (form.has('remove')) {
    let app = String(form.get('app') ?? '').trim()
    let { said } = await pressed(env, dir, who, 'member_remove', {
      space: space.slug,
      email: String(form.get('remove')).trim(),
      ...app ? { app } : {},
    })
    if (said) return desk(req, env, dir, space, who, 'people', said)
    let to = sentFrom(req, env)
    to.searchParams.set('removed', '1')
    return redirect(to.href, 303)
  }
  if (form.get('billing') == 'checkout') {
    return checkout(env, req, space, wanted(form))
  }
  if (form.get('billing') == 'portal') return portal(env, req, space)
  if (form.get('billing') == 'credit') return buy(env, req, space)
  // The plan card's cap on AI credit: a plain form, so it lands back on the
  // page saying it saved, or why not.
  if (form.get('billing') == 'cap') {
    let no = await setCap(env, req, space, Number(form.get('cap')))
    if (no) {
      return desk(req, env, dir, space, who, 'billing', {
        say: sentence(no),
        no: true,
      })
    }
    let to = sentFrom(req, env)
    to.searchParams.set('saved', '1')
    return redirect(to.href, 303)
  }
  // The other button on this page: one app out of the trash (erase.ts,
  // T-34430). Its own form, so it is its own POST — a plain button and no
  // script, the way the drop zone and the settings form are — and it lands
  // back on this page with the app in the listing again.
  let back = String(form.get('restore') ?? '').trim()
  if (back) {
    let app = await dir.binned(space, back)
    if (app?.trashed) await untrash(env, dir, space, app, who)
    return redirect(sentFrom(req, env).href, 303)
  }
  // The selling block's button (sell.ts, T-34524). Its own form and its own
  // POST, like the restore button above — and `start` answers a redirect to
  // the payment provider's own hosted onboarding, which is the one thing on
  // this page that leaves the site. A call to it that fails is filed and the
  // page comes back saying so, rather than a 502 on somebody's own front door.
  let till = String(form.get('sell') ?? '').trim()
  if (till == 'stop') {
    if (space.seller?.account) await disconnect(env, space)
    return redirect(sentFrom(req, env).href, 303)
  }
  if (till == 'start') {
    let no = refusedSell(space, env)
    if (no) {
      return desk(req, env, dir, space, who, 'selling', { say: no, no: true })
    }
    try {
      let made = await connect(env, space, await dir.emailAt(who.person) ?? '')
      return redirect(made.url, 303)
    } catch (e) {
      await fault(env, 'POST /manage/selling', e)
      let { name } = await payments(env)
      return desk(req, env, dir, space, who, 'selling', {
        say: `we couldn't reach ${name} just now — try again in a minute`,
        no: true,
      })
    }
  }
  // Settings' Logo: a picture chosen, or Remove.
  if (form.has('logo') || form.has('unlogo')) {
    let file = form.get('logo')
    let no = !file
      ? await logoed(env, dir, space, null, vouched(who))
      : !(file instanceof File)
      ? 'choose a picture for the logo'
      : file.size > LOGO.size
      ? 'a logo can be up to 1 MB'
      : await logoed(
        env,
        dir,
        space,
        new Uint8Array(await file.arrayBuffer()),
        vouched(who),
      )
    if (no) {
      return desk(req, env, dir, space, who, 'settings', { say: no, no: true })
    }
    let to = sentFrom(req, env)
    to.searchParams.set('saved', '1')
    return redirect(to.href, 303)
  }
  // Settings: the space's name, homepage and address, one form and one Save. A
  // refusal draws the page again with everything typed still in the fields,
  // and the address goes last because moving renames the space the homepage
  // is written against.
  if (view != 'settings') return nothingHere(env)
  let typed = {
    title: String(form.get('title') ?? '').trim(),
    space: String(form.get('space') ?? '').trim().toLowerCase(),
    home: String(form.get('home') ?? '').trim(),
  }
  let refused = (said: { say: string; no: boolean }) =>
    desk(req, env, dir, space, who, 'settings', said, { typed })
  // The name is space_set's `title`, as the assistant asks it; a blank one
  // leaves the name as it was. The move below reads the space as renamed, so
  // a new name saved with a new address stays.
  if (typed.title && typed.title != space.title) {
    let { said } = await pressed(env, dir, who, 'space_set', {
      space: space.slug,
      title: typed.title,
    })
    if (said) return refused(said)
    space = (await dir.at(space.eid)) ?? space
  }
  // The homepage is app_set's `home`, as the assistant asks it. The library is
  // no app at all, so choosing it takes the word off the app that has it.
  if (form.has('home')) {
    let now = await dir.home(space)
    let { said } = typed.home == (now?.slug ?? '')
      ? {}
      : await pressed(env, dir, who, 'app_set', {
        space: space.slug,
        app: typed.home || now!.slug,
        home: !!typed.home,
      })
    if (said) return refused(said)
  }
  let moving = typed.space && typed.space != space.slug
    ? await (await identity()).choose(env, who.person, typed.space, space)
    : null
  if (moving?.error) return refused({ say: moving.error, no: true })
  // The page names the space by its new address.
  let to = new URL(
    managePath('settings', moving?.slug ?? space.slug),
    hostUrl(env),
  )
  to.searchParams.set('saved', '1')
  return redirect(to.href, 303)
}

// The bytes of a space's logo, to anyone in the space, at the address only
// these bytes have (route.ts `logoPath`), so a browser keeps them for good.
let logoOf = async (env: Env, space: Space, who: Owner, sha: string) => {
  let bytes = who.role ? await logoBytes(env, space, sha) : null
  if (!bytes) return nothingHere(env)
  return new Response(bytes, {
    headers: {
      'content-type': space.logo!.type,
      'cache-control': browserImmutable,
      'x-content-type-options': 'nosniff',
    },
  })
}
