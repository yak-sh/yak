import { mint } from '@yaks/graph'
import { contactCard } from '@yaks/platform/support-contract-view'
import { supportFor } from './support-contracts.ts'
// The dashboard, at the apex: the person's own pages and each space's, drawn
// and their forms saved. apps.ts serves a space's pages and loads this on the
// first request to `/manage`, so an isolate that only serves pages never
// compiles it (T-148886).
import { copyOf } from './directory-copy.ts'
import { AGAIN, lookingAhead } from '@yaks/ui/navigate'
import { apex, spaceHost, url as hostUrl } from '@yaks/platform/host'
import { browserImmutable } from '@yaks/platform/kept'
import { heard, type Said, telling, unsaid } from '@yaks/platform/cookie'
import { directory, type Seat, type Space, walkTo } from './directory.ts'
import { paid } from '@yaks/platform/plans'
import * as dirPart from './directory.ts'
import { bound, type Env } from './env.ts'
import type { Beside } from './operator-page.ts'
import { pilled, standing } from './gallery-row.ts'
import { buyDomain, renewDomain } from './billing.ts'
import { payments } from './payments.ts'
import {
  chatRows,
  connecting,
  connectionsAsked,
  connectionsRow,
} from './connections.ts'
import { paymentRead } from './payment-reads.ts'
import { allowancesLine, type Part } from '@yaks/platform/payment-rows'
import { type DeskPage, nothingHere, sentence } from './pages.ts'
import { askOf } from '@yaks/platform/connections-page'
import { desk as deskPage } from './desk-pages.ts'
import { logoed, logoImage, logoPosted } from './logo.ts'
import { monogram } from '@yaks/platform/monogram'
import type { LogoSize } from '@yaks/platform/space-logo'
import { peopleLines } from '@yaks/platform/people-view'
import { CallError } from '@yaks/tools/errors'
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
  renamed,
  signInReturn,
  spaced,
  type SpaceView,
  type Talk,
  talkPath,
} from '@yaks/platform/routes'
import { REACH } from '@yaks/platform/page-graph'
import { SLUG } from '@yaks/platform/names'
import { vouched, type Who, whoIs } from './session.ts'
import { asking, bearerIn } from './asking.ts'
import { upgrading } from './protocol.ts'
import { writes } from '@yaks/member'
import { type Clock, clock } from './timing.ts'
import { woken } from './build-door.ts'
import { DAYS } from './views.ts'
import { admin } from './tool.ts'
import { reachOf } from './operator-reach.ts'
import { friendsOf as standingWith } from './friends.ts'
import { json } from '@yaks/platform/refused'
import { moved, redirect, shelf } from './apps.ts'
import {
  appsFor,
  listedApps,
  personRows,
  pickable,
  sideApps,
  visitsRows,
} from './side.ts'
import { warmApp, warmApps } from './app-warm.ts'
import { background, caught } from './defects.ts'
import { listedRows } from '@yaks/platform/space-apps'
import { brokenOf } from './apps-reads.ts'
import { agentsIn } from './agent-rows.ts'
import {
  ACCOUNT,
  accountOf,
  CHAT_LINKS,
  INVITE_PAGE,
  SHARED_APPS,
  SIGNED_IN,
} from '@yaks/platform/account-rows'
import { SIDE_SPACES, sideApps as sideAppsLine } from '@yaks/platform/side-rows'
import { billedDomains } from './domains.ts'
import type { SpacePage } from '@yaks/platform/space-pages-view'
import { spaceHeld } from './space-pages.ts'

// The identity part, asked for at request time rather than imported at the
// top: it carries the OAuth provider, whose `cloudflare:` modules exist only
// inside workerd, and this part's own tests run outside it. The two are peers
// in one Worker (index.ts binds each), so this is the in-process form of
// the service binding a split would give them — a `bound` with no namespace to
// call. Nothing above the owner block below asks for it, so nothing else pays.
let identity = () => import('./identity.ts')

// What a read has answered by now, or nothing while it is still out: a page
// that shows it only when it is in hand never waits on it.
let inHand = <T>(read?: Promise<T>) => Promise.race([read, undefined])

// What a press answered (@yaks/platform/cookie `Said`). A page's script
// (@yaks/ux save-browser) asks for it as JSON and says it beside the button
// it pressed, the page staying where it is; a plain form is sent on to `to`
// with it in a one-time cookie, which that page says once and spends, as is a
// script whose page moves (a space's new address). The address never carries
// it.
let scripted = (req: Request) =>
  (req.headers.get('accept') ?? '').startsWith('application/json')
let answered = (
  req: Request,
  env: Env,
  said: Said,
  to = sentFrom(req, env).href,
) =>
  !scripted(req)
    ? telling(redirect(to, 303), said, MANAGE)
    : new URL(to).pathname == new URL(req.url).pathname
    ? Response.json({ ...said, to })
    : telling(Response.json({ ...said, to }), said, MANAGE)

// A refusal: to a page's script, in a word; to a plain form, the page drawn
// again saying why, with what was typed still in it.
let refusal = (req: Request, said: Said, draw: () => Promise<Response>) =>
  scripted(req) ? Response.json(said, { status: 400 }) : draw()

// What the press before this page carried to it, said once.
let saying = (req: Request, said?: Said) =>
  said ?? heard(req.headers.get('cookie'))
let spend = (req: Request, res: Response) =>
  heard(req.headers.get('cookie')) ? unsaid(res, MANAGE) : res

// A person's spaces and account, at the apex (T-39354): the person's own
// pages at `/manage/account/<page>`, each space's settings at
// `/manage/<space>/<page>` (T-136122), and its Operator at its own address,
// `/<space>` (D-473), where its old addresses under Manage are sent on. A
// space's owner is shown all of its pages and a member who may change it its
// Operator; anybody else is answered what a wrong address is.
export let manage = async (
  req: Request,
  env: Env,
  c: Clock = clock(),
): Promise<Response> => {
  let url = new URL(req.url)
  let dirOf = () =>
    directory(bound(env.DIRECTORY, dirPart.fetch, env), {
      copy: copyOf(env),
      time: env.CLOCK,
    })
  // The page graph's door (reach-door.ts), as the browser's own session.
  if (url.pathname.startsWith(`${REACH}/`)) {
    let { reachDoor } = await import('./reach-door.ts')
    let dir = dirOf()
    let who = await whoIs(req, env, () => Promise.resolve(null), null, dir)
    return reachDoor(req, env, dir, who, c, dirOf)
  }
  let at = managed(url.pathname) ?? spaced(url.pathname)
  if (!at) return nothingHere(env)
  if ('moved' in at) return moved(req, hostUrl(env, at.moved) + url.search)
  let dir = dirOf()
  let page: ReturnType<typeof dir.page> | undefined
  let ahead = (person: string) => {
    let reads = req.method == 'GET' || req.method == 'HEAD'
    if ('space' in at) {
      page = dir.page(
        at.space,
        null,
        person,
        at.view == 'operator' || at.view == 'updates' ||
          at.view == 'matches' || at.view == 'dashboard',
      )
      page.catch(() => {})
      if (reads && !at.door) {
        let drawn = !at.open && !at.logo && !at.manifest
        let chat = !!at.open && !url.searchParams.has('attachment')
        foresee(
          dir,
          person,
          at.view,
          drawn || chat
            ? {
              env,
              slug: at.space,
              space: page.then((p) => p.space, () => null),
              add: url.searchParams.get('detail'),
              drawn,
            }
            : undefined,
          chat,
        )
      }
    } else if ('account' in at && reads) {
      foresee(dir, person, at.account)
      if (at.account == 'profile') {
        void dir.browserSessions(person).catch(() => {})
      }
    }
    return Promise.resolve(null)
  }
  // A browser's socket the person lends their Operator comes from an
  // extension, which holds no cookie of ours: it bears the token it signed in
  // for (asking.ts `bearerIn`). Only that door accepts its bearer; every
  // other page and form reads the browser's own session.
  let socket = req.method == 'GET' && upgrading(req) &&
    'space' in at && url.pathname == managePath('operator', at.space) &&
    url.searchParams.has('browser') && url.searchParams.size == 1 &&
    !!bearerIn(req)
  let caller = socket ? (await asking(env, req)).who : undefined
  let { person, until, session } = caller
    ? { person: caller.person, until: caller.until, session: undefined }
    : socket
    ? { person: null, until: undefined, session: undefined }
    : await whoIs(req, env, ahead, null, dir)
  if (!person && socket) return json(401, 'signed_out', 'Sign in again.')
  if (!person) return signInReturn(req, env)
  if (url.searchParams.has('settings-draft')) {
    let { settingsDraft } = await import('./settings-draft.ts')
    return settingsDraft(req, dir, { person, role: null, until })
  }
  // A token narrowed to one space reaches that space alone.
  if (
    caller?.space && !caller.spaceEid && 'space' in at &&
    caller.space != at.space
  ) {
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
  // A link the Operator sent to link their chat account: straight on.
  let link = url.searchParams.get('link')
  if (
    'account' in at && at.account == 'profile' && req.method == 'GET' && link
  ) {
    return await linkFrom(
      req,
      env,
      dir,
      { person, role: null, until, session },
      link,
      url.searchParams.get('back'),
    )
  }
  if ('account' in at) {
    return mine(
      req,
      env,
      dir,
      { person, role: null, until, session },
      at.account,
    )
  }
  if ('updates' in at) {
    return everyUpdate(req, env, dir, person, until, asked, c)
  }
  let view = at.view
  let paged = page ?? dir.page(
    at.space,
    null,
    person,
    view == 'operator' || view == 'updates' || view == 'matches' ||
      view == 'dashboard',
  )
  if (!page && (req.method == 'GET' || req.method == 'HEAD') && !at.door) {
    // The page drawn on the dashboard, not a conversation in the chat app
    // or one of the space's files.
    let drawn = !at.open && !at.logo && !at.manifest
    let chat = !!at.open && !url.searchParams.has('attachment')
    foresee(
      dir,
      person,
      view,
      drawn || chat
        ? {
          env,
          slug: at.space,
          // A page read that fails is the page's to meet, below.
          space: paged.then((p) => p.space, () => null),
          add: url.searchParams.get('detail'),
          drawn,
        }
        : undefined,
      chat,
    )
  }
  let { space, role, administrative } = await paged
  if (caller?.spaceEid && space && caller.spaceEid != space.eid) {
    return json(403, 'not_a_member', 'That token is for another space.')
  }
  if (!space) {
    // A link written before the space moved to another name (T-34658).
    let was = await dir.formerly(at.space)
    if (!was) return nothingHere(env)
    return moved(req, hostUrl(env, renamed(at, was.slug)) + url.search)
  }
  let who: Owner = {
    person,
    role: administrative ? 'owner' : role ?? null,
    administrative,
    until,
  }
  if (at.logo) return logoOf(req, env, space, who, at.logo)
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
  let chat = view == 'operator' && !url.searchParams.has('attachment')
    ? at.open
    : undefined
  let chosen = view == 'operator' ? url.searchParams.get('app') : null
  let canWarm = reading && !at.door && writes(who.role) && !administrative &&
    !space.trashed
  let roster: ReturnType<typeof appsFor> | undefined
  let apps = () => roster ??= appsFor(dir, space, who)
  let warm = (start: (mine: Awaited<ReturnType<typeof appsFor>>) => void) =>
    background(
      apps().then(
        start,
        (error) =>
          caught(error, { request: 'app warm roster', space: space.eid }),
      ),
    )
  let warmRoster = () => warm((mine) => warmApps(env, space, mine, chosen))
  let ready = async (page: Promise<Response>) => {
    let answer = await page
    if (canWarm && answer.ok) warmRoster()
    return answer
  }
  let sidebar = (contact = true) =>
    c.time(
      'sidebar',
      () => beside(env, dir, space, who, apps().then(sideApps), contact),
    )
  // Chat and Updates boot the Operator with their read, so its wake cannot
  // start owed work before that read. Their links warm once the page is
  // drawn, with only the app already asked for starting alongside it.
  if (canWarm) {
    if (!chat && view != 'updates') {
      woken(env, space.eid)
      warmRoster()
    } else if (chosen) {
      warm((mine) => {
        let app = mine.find((app) => app.slug == chosen)
        if (app) warmApp(env, space, app)
      })
    }
  }
  if (view == 'updates' && writes(who.role) && !space.trashed) {
    if (req.method == 'POST') {
      let { updatesAnswer } = await import('./updates.ts')
      return c.time('updates_form', () => updatesAnswer(req, env, space, who))
    }
    if (!reading) return nothingHere(env)
    let { shownAnswer } = await import('./updates.ts')
    let shown = await shownAnswer(req, env, space, who)
    if (shown) return shown
    let { updatesPage } = await c.time(
      'page_modules',
      () => import('./operator-page.ts'),
    )
    return ready(unread(
      req,
      updatesPage(
        env,
        space,
        who,
        sidebar(false),
        url.searchParams.has('dismissed'),
        !lookingAhead(req),
        c,
        dir,
      ),
    ))
  }
  // Its Dashboard is the space's own address (T-3702). A link to that
  // address from before the chat moved under `/operator` names the chat by
  // its query (`?app=`, `?from=`, `?say=`), and opens it there still.
  if (view == 'dashboard' && writes(who.role) && !space.trashed) {
    if (!reading) return nothingHere(env)
    if (url.search) {
      return moved(req, hostUrl(env, chatPath(space.slug)) + url.search)
    }
    let { dashboardPage } = await c.time(
      'page_modules',
      () => import('./operator-page.ts'),
    )
    return ready(dashboardPage(env, space, who, dir, sidebar(), c))
  }
  // Its Matches are its members' to pick in (matches.ts).
  if (view == 'matches' && writes(who.role) && !space.trashed) {
    if (!reading) return nothingHere(env)
    let { sideAnswer } = await import('./matches.ts')
    let side = await sideAnswer(req, env, space, who)
    if (side) return side
    let { matchesPage } = await import('./operator-page.ts')
    return matchesPage(req, env, space, who, await beside(env, dir, space, who))
  }
  if (view == 'operator' && writes(who.role) && !space.trashed) {
    let { chatPage, openingChat, operatorAnswer, storeAnswer } = await c.time(
      'page_modules',
      () => import('./operator-page.ts'),
    )
    if (at.door) return storeAnswer(req, env, space, who, at.door)
    if (chat) {
      let full = url.searchParams.has('conversation') ||
        req.headers.get('purpose') == 'prefetch'
      return reading
        ? ready((chat == 'new' && !full ? openingChat : chatPage)(
          env,
          space,
          who,
          chat,
          sidebar(),
          chosen,
          url.searchParams.has('from')
            ? Number(url.searchParams.get('from'))
            : undefined,
          c,
        ))
        : nothingHere(env)
    }
    return await operatorAnswer(req, env, space, who) ??
      desk(req, env, dir, space, who, view)
  }
  if (
    reading && view == 'billing' && role && !space.trashed &&
    who.role != 'owner'
  ) {
    let support = await supportFor(env, walkTo(space.slug, space.eid), dir)
    if (support) {
      return deskPage({
        person,
        space: space.slug,
        spaceEid: space.eid,
        apps: [],
        member: true,
        supportAvailable: true,
        view: 'billing',
        support: contactCard(space.slug, support, {
          id: mint(),
          sent: url.searchParams.get('support') == 'sent',
          log: support.contract.provider == person,
        }),
      }, env)
    }
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
  // The Operator's own pages were answered above; the rest are settings.
  if (view == 'updates' || view == 'matches' || view == 'dashboard') {
    return nothingHere(env)
  }
  let softphone = url.searchParams.get('softphone')
  if (softphone && view == 'settings') {
    if (role != 'owner') return nothingHere(env)
    let { numberLogin } = await import('./number-login.ts')
    return numberLogin(req, env, dir, space, person, softphone)
  }
  if (req.method == 'POST') return saved(req, env, dir, space, who, view)
  if (req.method != 'GET' && req.method != 'HEAD') return nothingHere(env)
  if (view == 'billing' && url.searchParams.has('domain')) {
    return redirect(
      hostUrl(env, managePath('domains', space.slug)) + url.search,
      303,
    )
  }
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
// space, so the side's selector comes with the person's seats; a page with
// the chat app's side (`beside`) asks the space's chat connections, which
// its Reach section lists.
let foresee = (
  dir: ReturnType<typeof directory>,
  person: string,
  view: ManageView,
  here?: Ahead,
  chat = false,
) => {
  let seats = dir.seated(person)
  let sided = view == 'matches' || view == 'dashboard' ||
    view == 'operator' && chat
  void Promise.allSettled([
    dir.nameAt(person),
    seats,
    ...view == 'shared' ? [dir.granted(person)] : [],
    // Profile's linked chat accounts (side.ts `personRows`, CHAT_LINKS).
    ...view == 'profile' ? [dir.ownConnections(person)] : [],
    // The chat draws the lists their servers offer (operator-lists.ts), once
    // it knows the conversation is their landing.
    ...view == 'operator' && chat ? [dir.listings(person)] : [],
    ...here?.drawn
      ? [
        dir.lines(walkTo(here.slug, here.space.then((s) => s?.eid ?? ''))),
        ...rowsAhead(dir, person, view, seats, here),
      ]
      : [],
    ...here && sided
      ? [chatRows(dir, walkTo(here.slug, here.space.then((s) => s?.eid ?? '')))]
      : [],
  ])
}

// The space a page of one is at, while the read that learns it is in flight,
// and whether the page is drawn on the dashboard, not the chat app.
type Ahead = {
  env: Env
  slug: string
  space: Promise<Space | null>
  add: string | null
  drawn: boolean
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
    return [agentsIn(at.env, dir, person), dir.provenance(walk)]
  }
  if (view == 'new') return [agentsIn(at.env, dir, person)]
  if (view == 'billing') {
    return [
      dir.domainOrders(walk),
      dir.freeBudget(),
      supportFor(at.env, walk, dir),
    ]
  }
  if (view == 'people') {
    return [dir.people(walk), dir.admits(walk), standingWith(dir, person)]
  }
  if (view == 'operator') {
    return [
      supportFor(at.env, walk, dir),
      reachOf(dir, walk, person),
      chatRows(dir, walk),
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

let sentFrom = (req: Request, env: Env) => {
  let at = new URL(req.url)
  return new URL(at.pathname + at.search, hostUrl(env))
}

// The person's Updates from every space's Operator they talk with, at
// `/updates` (operator-page.ts `allUpdatesPage`), beside the side of
// the space they came from (`?in=`), else their own. An address from before the space was in
// the path (`?space=`) still goes to that space's Updates.
let everyUpdate = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  person: string,
  until: number | undefined,
  asked: string | null,
  c: Clock,
): Promise<Response> => {
  let url = new URL(req.url)
  // A tab drawn before the reach watch still asks here without opening Updates.
  if (url.searchParams.has('waiting')) {
    return new Response(null, { status: 410 })
  }
  if (asked) {
    let to = new URL(talkPath('updates', asked), hostUrl(env))
    for (let [k, v] of url.searchParams) {
      if (k != 'space') to.searchParams.append(k, v)
    }
    return moved(req, to.href)
  }
  if (req.method != 'GET' && req.method != 'HEAD') return nothingHere(env)
  let seats = (await c.time('directory_read', () => dir.seated(person))).filter(
    (s) => !s.space.trashed && writes(s.role),
  ).sort((a, b) => Number(b.own) - Number(a.own))
  let held = seats.map(({ space, role }) => ({
    space,
    who: { person, role, until } satisfies Owner,
  }))
  let into = url.searchParams.get('in')
  let home = held.find((s) => s.space.slug == into) ?? held[0]
  if (!home) return redirect(hostUrl(env, MANAGE), 303)
  let shelves = new Map(held.map(({ space, who }) => [
    space.slug,
    appsFor(dir, space, who),
  ]))
  let roster = shelves.get(home.space.slug)!
  let apps = Promise.all(
    [...shelves].map(async ([slug, read]) =>
      [slug, sideApps(await read)] as const
    ),
  ).then((all) => new Map(all))
  apps.catch(() => {})
  let { allUpdatesPage } = await c.time(
    'page_modules',
    () => import('./operator-page.ts'),
  )
  let answer = await unread(
    req,
    allUpdatesPage(
      env,
      home,
      held,
      c.time(
        'sidebar',
        () =>
          beside(env, dir, home.space, home.who, roster.then(sideApps), false),
      ),
      apps,
      !lookingAhead(req),
      c,
      dir,
    ),
  )
  if (answer.ok) warmApps(env, home.space, await roster)
  return answer
}

// Updates fetched ahead marked nothing read, and say so: the navigator asks
// for them again once they are opened (@yaks/ui/navigate `AGAIN`).
let unread = async (req: Request, page: Promise<Response>) => {
  let res = await page
  if (!lookingAhead(req)) return res
  let told = new Response(res.body, res)
  told.headers.set(AGAIN, '1')
  return told
}

// What the chat app's side holds (operator-page.ts `Beside`), asked at once:
// the spaces its selector offers, the apps here this person may open, what
// they are called, whether they are the platform's admin, and every way to
// reach its Operator. All Updates reads seats across spaces without the
// page read that normally answers `administrative`.
let beside = async (
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  who: Owner,
  roster = appsFor(dir, space, who).then((mine) => (
    warmApps(env, space, mine), sideApps(mine)
  )),
  contact = true,
): Promise<Beside> => {
  let [spaces, apps, name, panes, ways, platformAdmin] = await Promise.all([
    pickable(dir, who.person),
    roster,
    dir.nameAt(who.person),
    dir.panes(who.person),
    // As the page asked it ahead (`foresee`), so it is answered from there.
    contact
      ? chatRows(dir, walkTo(space.slug, space.eid)).then(async (rows) =>
        (await import('./operator-ways.ts')).waysOf(
          env,
          space,
          who.role == 'owner',
          rows,
        )
      )
      : undefined,
    who.administrative ?? admin({ dir, person: who.person }),
  ])
  return {
    spaces,
    apps,
    name,
    admin: platformAdmin,
    panes,
    ways,
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
  view: Exclude<SpaceView, Talk>,
  said?: Said,
): Promise<Response> => {
  let owner = who.person
  let q = new URL(req.url).searchParams
  // Back from the payment provider's checkout (billing.ts): the page again
  // without the provider's word in its address, saying it went through when
  // it did. The webhook is what moves the tier and it may not have landed
  // yet, so the line says "in a moment" rather than claiming something this
  // request cannot see.
  if (q.has('paid') && req.method == 'GET') {
    let to = sentFrom(req, env)
    to.searchParams.delete('paid')
    let res = redirect(to.href, 303)
    return q.get('paid') == '1'
      ? telling(res, {
        say:
          'Thanks — that went through. Your space moves to its new plan in a moment.',
      }, MANAGE)
      : res
  }
  // Everything a page shows, asked at once: nothing here waits on anything but
  // the apps it says something about.
  let shelved = dir.apps(space).then((apps) => shelf(apps, space, who))
  // The agents the person connected, for the pages that say how to make an
  // app with one: Apps and New app. They are drawn with them only if their
  // row is in hand once everything else is, since a person whose grants are
  // not yet in the directory has them read from the provider's KV, which
  // takes longer than the rest of the page (T-149703, grant-rows.ts); the
  // page graph asks for the row when it is not (agent-rows.ts), and what
  // depends on it waits unsettled (@yaks/platform/page-parts `state`).
  let agentsRow = view == 'apps' || view == 'new'
    ? agentsIn(env, dir, owner)
    : undefined
  let [
    { here, all },
    drawn,
    picks,
    operator,
    provider,
    panes,
    lines,
    held,
    renewals,
    support,
  ] = await Promise.all([
    shelved,
    // The rows a page drawn from the page graph's reads is drawn from,
    // carried for its first paint: Apps' apps, as the directory answers them
    // live, and what is broken in each, one read of the space's tracker, no
    // app's store woken (apps-reads.ts); Visits' apps and their views
    // (side.ts `visitsRows`); People's lines, as its view watches them
    // (@yaks/platform/people-view); what Selling and Billing are drawn
    // from (@yaks/platform/payment-rows); and the row Connections is drawn
    // from, as its address asks it (connections.ts `connectionsRow`). New
    // app is drawn from the agents alone (`agentsRow`).
    view == 'apps'
      ? Promise.all([
        listedApps(dir, space, who).then((apps) =>
          listedRows(owner, space.eid, apps)
        ),
        brokenOf(env, dir, space, who),
      ]).then((rows) => rows.flat())
      : view == 'visits'
      ? visitsRows(env, dir, owner, space.eid).then((r) => [
        ...r.apps,
        ...r.counts,
      ])
      : view == 'people'
      ? Promise.all(
        Object.values(
          peopleLines({
            person: owner,
            space: { eid: space.eid, slug: space.slug },
          }),
        ).map((l) => personRows(dir, owner, l)),
      ).then((all) => all.flat())
      : view == 'selling' || view == 'billing'
      ? paymentDrawn(env, dir, space, owner, view)
      : view == 'connections'
      ? connectionsRow(env, dir, who, space, askOf(q)).then((row) => [row])
      : view == 'new'
      ? []
      : undefined,
    // Every space this person may work in, which the side's selector offers.
    pickable(dir, owner),
    view == 'operator'
      ? import('./operator-page.ts').then((part) =>
        part.operatorBody(env, space, who, dir)
      )
      : undefined,
    payments(env),
    // How the person keeps the panes (directory.ts `Panes`).
    dir.panes(owner),
    dir.lines(walkTo(space.slug, space.eid)),
    // The rows a page drawn from the page graph's reads is drawn from
    // (@yaks/platform/space-pages-view), carried for its first paint.
    view == 'settings' || view == 'domains' || view == 'trash'
      ? spaceHeld(env, dir, owner, space.eid, view, q.get('q') ?? '')
      : undefined,
    // As the page asked them ahead (`rowsAhead`), by its walk.
    view == 'billing'
      ? billedDomains(env, dir, space, walkTo(space.slug, space.eid))
      : undefined,
    view == 'billing' || view == 'operator' && who.role != 'owner'
      ? supportFor(env, walkTo(space.slug, space.eid), dir)
      : null,
  ])
  let connected = await inHand(agentsRow)
  let page = deskPage({
    person: who.person,
    // Apps' and New app's rows carry the agents connected, where in hand; a
    // space's Settings, Domains and Trash carry each of their lines'.
    drawn: drawn ? [...drawn, ...connected ?? []] : held &&
      Object.values(held).flatMap((rows) => Array.isArray(rows) ? rows : []),
    viewDays: DAYS,
    space: space.slug,
    spaceEid: space.eid,
    view,
    apps: all.map((a) => ({
      eid: a.eid,
      slug: a.slug,
      title: a.title,
      source: a.source,
      generatedIcon: a.generatedIcon,
      home: a.home,
      access: a.access,
      gallery: pilled(standing(a)),
    })),
    sift: { q: q.get('q') ?? '', sort: q.get('sort') ?? '' },
    binned: here.filter((a) => a.trashed).length +
      lines.filter((l) => l.trashed).length,
    shops: provider.shops.on(),
    paying: paid(space.tier),
    ...held && {
      spaceView: {
        person: owner,
        space: space.eid,
        page: view as SpacePage,
        apex: apex(env),
        checkout: provider.plans.on(),
        renewed: q.get('renewed') ?? undefined,
        ordered: q.get('domain') ?? undefined,
      },
      held,
    },
    supportAvailable: !!support,
    support: view == 'billing' && support
      ? contactCard(space.slug, support, {
        id: mint(),
        sent: q.get('support') == 'sent',
        log: support.contract.provider == who.person,
      })
      : undefined,
    renewals,
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
    panes,
    say: saying(req, said)?.say ?? '',
    no: saying(req, said)?.no,
  }, env)
  return spend(req, keptIn(page, space.slug))
}

// The rows Selling or Billing of `space` is drawn from: its plan card, and
// on Selling where it stands and its apps, on Billing its month. The
// payer joins through the page graph after paint, since that read goes to
// the payment provider.
let paymentDrawn = async (
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  person: string,
  view: 'selling' | 'billing',
) => {
  let parts: Exclude<Part, 'allowances'>[] = view == 'selling'
    ? ['planCard', 'selling']
    : ['planCard']
  let lines = [
    view == 'selling' ? sideAppsLine(space.eid) : allowancesLine(space.eid),
  ]
  return (await Promise.all([
    ...parts.map((part) => paymentRead(env, dir, space, part)),
    ...lines.map((line) => personRows(dir, person, line)),
  ])).flat()
}

// The lines of the page graph each page of the person's own is drawn from
// (@yaks/platform/account-rows, side-rows).
let DRAWN: Partial<Record<AccountView, string[]>> = {
  profile: [ACCOUNT, SIDE_SPACES, SIGNED_IN, CHAT_LINKS],
  friends: [ACCOUNT],
  invite: [INVITE_PAGE, SIDE_SPACES],
  shared: [SHARED_APPS],
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
  said?: Said,
  typed?: Pick<DeskPage, 'made'>,
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
  let [
    picks,
    name,
    own,
    panes,
    provider,
    drawn,
  ] = await Promise.all([
    pickable(dir, person),
    dir.nameAt(person),
    dir.own(person),
    dir.panes(person),
    payments(env),
    // The rows a page drawn from the page graph's reads is drawn from
    // (@yaks/platform/account-rows), carried for its first paint, and the
    // agents Agents lists (agent-rows.ts).
    view == 'agents' ? agentsIn(env, dir, person) : DRAWN[view] &&
      Promise.all(DRAWN[view].map((l) => personRows(dir, person, l, env)))
        .then((rows) => rows.flat()),
  ])
  let chosen = q.get('space') ?? inOf(req)
  let space = picks.find((s) => s.slug == chosen)?.slug ?? own.slug
  // The Operator of the space the side holds wakes, as every page of a space
  // wakes it (`woken`), so its settings and chat, a press away, find it up.
  let side = picks.find((s) => s.slug == space)
  if (side && req.method == 'GET') woken(env, side.eid)
  let page = deskPage({
    person: who.person,
    space,
    view,
    apps: [],
    name: name ?? '',
    presenceHidden: drawn && accountOf(drawn)?.hidden,
    drawn,
    session: who.session,
    shops: provider.shops.on(),
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
    panes,
    ...typed,
    say: saying(req, said)?.say ?? '',
    no: saying(req, said)?.no,
  }, env)
  return spend(req, q.has('space') ? keptIn(page, space) : page)
}

// Linking the person's own account on a chat platform (`link`, one of
// `ownLinks`' integrations), the sign-in held under their own space: from
// Profile's Connect Discord, or a link the Operator sent them in a room
// (operator-escalate.ts `verifying`), which opens straight onto the
// platform's own confirm step and comes back to `space`'s chat.
let linkFrom = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  who: Owner,
  linking: string,
  space?: string | null,
) => {
  let { ownLinks } = await import('./chat.ts')
  if (
    !(await ownLinks(env, await dir.ownConnections(who.person))).some((l) =>
      l.integration == linking
    )
  ) {
    return nothingHere(env)
  }
  let { linkOwn } = await import('./connections.ts')
  return await linkOwn(
    req,
    env,
    who,
    await dir.own(who.person),
    linking,
    hostUrl(
      env,
      space && SLUG.test(space) ? chatPath(space) : managePath('profile'),
    ),
  )
}

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
      operator: String(form.get('operator') ?? '').trim(),
    }
    let { said } = await pressed(env, dir, who, 'space_new', {
      slug: made.slug,
      title: made.title || made.slug,
      ...made.operator ? { operator: made.operator } : {},
    })
    if (said) {
      return refusal(
        req,
        said,
        () => mine(req, env, dir, who, view, said, { made }),
      )
    }
    return keptIn(
      redirect(hostUrl(env, chatPath(made.slug)), 303),
      made.slug,
    )
  }
  if (view != 'profile' && view != 'friends') return nothingHere(env)
  // The side's fold (sidebar.ts `fold`) and the aside's (frame.ts `toggle`),
  // pressed on any page: kept on the person's row, then that page again, or
  // for the script that sent it, nothing more.
  if (form.has('sidebar') || form.has('aside')) {
    await dir.apply({
      entities: [{
        entity: { eid: who.person },
        ...form.has('sidebar')
          ? { desk_sidebar: { collapsed: form.get('sidebar') == 'collapsed' } }
          : { desk_aside: { shut: form.get('aside') == 'shut' } },
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
  return nothingHere(env)
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
    let { TOOLS } = await import('./tools.ts')
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
// insufficient: a page at another address never gets here (@yaks/platform/routes
// `guarded`).
let saved = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof directory>,
  space: Space,
  who: Owner,
  view: Exclude<SpaceView, Talk>,
): Promise<Response> => {
  let refused = (view: Exclude<SpaceView, Talk>, said: Said) =>
    refusal(req, said, () => desk(req, env, dir, space, who, view, said))
  // The Logo form streams its picture to its own address (`logoUpload`):
  // Settings' Save posts a multipart form here too, and is read whole below.
  if (view == 'settings' && new URL(req.url).searchParams.has('logo')) {
    let no = await logoPosted(
      req,
      (input) => logoed(env, dir, space, input, vouched(who)),
    ).catch((e) => {
      if (e instanceof CallError) return e.message
      throw e
    })
    return no
      ? refused('settings', { say: no, no: true })
      : answered(req, env, { say: 'Saved.' })
  }
  let form = await req.formData().catch(() => new FormData())
  // The connections page's buttons (connections.ts): each is one form with a
  // `do`, answered with the page saying what came of it, or sent on to a
  // service to sign in there.
  if (form.has('do')) {
    let said = await connecting(req, env, space, who, form)
    return said instanceof Response
      ? said
      : said.no
      ? refused('connections', said)
      : answered(req, env, said)
  }
  if (form.get('billing') == 'domain') {
    let checkout = await buyDomain(env, req, space, form)
    if (view != 'domains' || scripted(req)) return checkout
    let out = await checkout.json() as {
      url: string
      error: { message: string }
    }
    return checkout.ok ? redirect(out.url, 303) : refused('domains', {
      say: sentence(out.error.message),
      no: true,
    })
  }
  if (view == 'domains' && form.has('renew_domain')) {
    let paid = await renewDomain(env, req, space, form)
    let out = await paid.json() as {
      url: string
      error: { message: string }
    }
    return paid.ok ? redirect(out.url, 303) : refused('domains', {
      say: out.error.message,
      no: true,
    })
  }
  return nothingHere(env)
}

// Both the original and its display sizes are private to the space.
let logoOf = async (
  req: Request,
  env: Env,
  space: Space,
  who: Owner,
  sha: string,
) => {
  if (
    !who.role || space.logo?.sha != sha || !['GET', 'HEAD'].includes(req.method)
  ) {
    return nothingHere(env)
  }
  let variant = new URL(req.url).searchParams.get('size')
  let size: LogoSize | undefined = variant == 'avatar'
    ? 'avatar'
    : variant == 'icon'
    ? 'icon'
    : undefined
  let image = await logoImage(env, space, sha, size)
  if (!image) {
    if (size == 'icon') return redirect('/connector-512.png')
    if (size == 'avatar') {
      return new Response(
        req.method == 'HEAD'
          ? null
          : monogram(space.title || space.slug, space.eid),
        {
          headers: {
            'content-type': 'image/svg+xml',
            'cache-control': 'private, no-cache',
          },
        },
      )
    }
    return nothingHere(env)
  }
  return new Response(req.method == 'HEAD' ? null : await image.read(), {
    headers: {
      'content-type': image.type,
      'content-length': String(image.size),
      'cache-control': browserImmutable,
      'x-content-type-options': 'nosniff',
    },
  })
}
