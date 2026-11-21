import { audit } from './admin-action.ts'
import { door as confirmationDoor } from './confirm.ts'
// The mover's sweep door (mover.ts, D-45640): every store the platform has,
// and one store at a time asked to rehearse its rules or to move what it owes.
// `yak admin move` walks the list and paces the asking; this door never loops
// over the platform itself, so one request reaches one store.
//
//   GET  /api/move                        every store, in the order a sweep
//                                         takes them: the app stores, their
//                                         samples and their visitors' stores,
//                                         the git object store, then the
//                                         directory
//   POST /api/move?store=<name>&rehearse=1  that store's rehearsal
//   POST /api/move?store=<name>           that store woken to move what it
//                                         owes, and where each rule stands
//   GET  /api/account?address=<address>     what erasing that test account
//                                           would take
//   DELETE /api/account?address=<address>   trash it, preserving its work
//   POST /api/account?address=<address>     restore its account record
//   GET  /api/operator-copy                 every space
//   POST /api/operator-copy?space=<eid>     a page of that space's Operator
//                                           store (store-copy.ts)
//   POST /api/operator-graph?space=<slug>  that space's Operator store:
//                                           {q} queried, or {bundles, check}
//                                           applied as the admin
//   GET  /api/store-copy                    every app's store, its sample's
//                                           and its visitors'
//   POST /api/store-copy?store=<name>       a page of that store
//   GET  /api/graves?since=<t>&until=<t>    a page of the directory's
//                                           tombstones, each with what still
//                                           tells of it (@yaks/platform/graves);
//                                           `after` continues
//   GET  /api/uses?app=<space>/<app>        the words that app borrows, each
//                                           to the slug of its home, with
//                                           its own and each home's access
//
// The gate is the one the fee answers to (sell.ts `fees`): an owner of the
// platform's own space, read off a website session or an OAuth token. A store is named by the
// kernel, never by a caller, so a name the listing does not hold is refused
// rather than waking an object nobody made. A copy asks its store's plan
// first, and only that ask reads the listing: a copy takes a page per
// request, and a listing per page read the whole directory each time. A table
// page goes straight to the object, which answers only a
// table its file holds.
import * as dirPart from './directory.ts'
import { appStore, directory, storeName } from './directory.ts'
import { mode } from '@yaks/member'
import { GIT_STORE, storeOf } from './door.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Swept } from '@yaks/platform/mover'
import { bound, type Env } from './env.ts'
import { KERNEL, meta } from './meta.ts'
import { adminWho } from './asking.ts'
import { vouched, type Who } from './session.ts'
import { LEAVE, WHERE } from './relocate.ts'
import { visits } from '@yaks/platform/visits'
import { ledgerOf } from './visit.ts'
import { builderOf } from './build-door.ts'
import { type Asked, COPY } from './store-copy.ts'
import { GRAPH, type Graphed } from './operator-graph.ts'
import { type JobPage, JOBS } from '../../packages/platform/finished-jobs.ts'
import { graves } from '@yaks/platform/graves'
import { inspect } from './store-inspect.ts'

export let PATH = '/api/move'
export let RELOCATE_PATH = '/api/relocate'
export let IDLE_PATH = '/api/idle-spaces'
export let ACCOUNT_PATH = '/api/account'
export let OPERATOR_PATH = '/api/operator-copy'
export let OPERATOR_GRAPH_PATH = '/api/operator-graph'
export let STORE_COPY_PATH = '/api/store-copy'
export let GRAVES_PATH = '/api/graves'
export let USES_PATH = '/api/uses'

let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

/** Every store there is, trashed apps' included: a restore brings one back
 * holding whatever shape it was left in. An app's sample and the stores its
 * visitors were given (@yaks/platform/visits) hold its words too, so a
 * migration reaches them as well. */
export let stores = async (env: Env): Promise<Swept[]> => {
  let dir = dirOf(env)
  let spaces = await dir.all()
  let of = new Map(spaces.map((s) => [s.eid, s]))
  let at = new Map<string, string>()
  let apps = (await dir.apps(spaces)).flatMap((app) => {
    let space = of.get(app.space)
    if (!space) return []
    let name = `${space.slug}/${app.slug}`
    at.set(app.eid, name)
    return [
      { store: storeName(space, app), at: name },
      ...app.demo ? [{ store: app.demo.store, at: `${name} sample` }] : [],
    ]
  })
  let visited = (await visits(ledgerOf(env))).flatMap(({ app, visit }) =>
    at.has(app) ? [{ store: visit.store, at: `${at.get(app)} visit` }] : []
  )
  let all = [
    ...apps,
    ...visited,
    { store: GIT_STORE, at: 'git' },
    { store: PLATFORM_STORE, at: 'directory' },
  ]
  // A directory app can name the same physical handle as a platform store.
  // Keep its final listing so each handle is asked once, the directory last.
  let last = new Map(all.map((row, i) => [row.store, i]))
  return all.filter((row, i) => last.get(row.store) == i)
}

let account = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof dirOf>,
  who: Who,
) => {
  if (!['GET', 'DELETE', 'POST'].includes(req.method)) {
    return json(405, 'method_not_allowed', 'read, trash or restore an account')
  }
  let { closed, closing, untrashAccount } = await import('./erase.ts')
  // By address, or by eid an account whose row has none left (erase.ts
  // `account`).
  let asked = new URL(req.url).searchParams
  let address = asked.get('address') ?? asked.get('person') ?? ''
  // The caller first, so nobody learns from the answer who has an account.
  let self = req.method == 'DELETE' && !!who.person &&
    await dir.emailAt(who.person) == address
  if (who.role != 'owner' && !self) {
    return json(403, 'not_owner', 'an account is erased by an owner of yak')
  }
  let at = await closing(env, dir, address)
  if (!at) {
    return json(404, 'no_account', `no account is ${address || '(nothing)'}`)
  }
  if (req.method == 'POST') await untrashAccount(dir, at.person, who)
  let result = req.method == 'DELETE'
    ? await closed(env, dir, address, who)
    : null
  return Response.json({
    address,
    erased: false,
    trashed: req.method == 'DELETE' || req.method == 'GET' && at.trashed,
    restored: req.method == 'POST',
    ...(req.method == 'DELETE' || at.trashed
      ? {
        purge: confirmationDoor('yak', 'account', at.person, undefined, env),
      }
      : {}),
    ...(result?.pending ? { pending: true } : {}),
    spaces: at.spaces.map((s) => s.slug),
    seats: at.seats.map((s) => s.slug),
  }, { headers: { 'cache-control': 'private, no-store' } })
}

// A store's move to a new object (relocate.ts), the directory's unless
// `store=<handle>` names an app's: `?where=<name>&colo=ORD` reaches the object
// of that name from a Worker in that colo and says where it stands.
// `?prepare=<name>` copies the store there while it serves, `?to=<name>`
// finishes the copy in a short hold and hands every request on, and `?back=1`
// returns them, for a new object that can't serve. An app's store, once handed
// on, is named by its new object in the directory (`app.store`), so callers go
// straight there, and the old object forgets its rows.
let relocating = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof dirOf>,
  who: Who,
): Promise<Response> => {
  let url = new URL(req.url)
  let where = url.searchParams.get('where')
  let colo = (req as { cf?: { colo?: string } }).cf?.colo ??
    req.headers.get('cf-ray')?.split('-')[1]
  if (where) {
    if (colo != url.searchParams.get('colo')) {
      return json(409, 'wrong_colo', `this Worker is in ${colo}`)
    }
    let r = await storeOf(env.STORE, where)(WHERE, {}, KERNEL)
    return Response.json({ worker: colo, ...await r.json() as object }, {
      status: r.status,
    })
  }
  let asked = [...url.searchParams].filter(([k]) =>
    k == 'to' || k == 'prepare' || k == 'back'
  )
  if (!asked.length) return json(400, 'arguments', 'name where, prepare or to')
  let store = url.searchParams.get('store') ?? PLATFORM_STORE
  let app = store == PLATFORM_STORE ? null : await appAt(dir, store)
  if (store != PLATFORM_STORE && !app) {
    return json(404, 'no_store', `no app's store is ${store}`)
  }
  let leave = (query: [string, string][]) =>
    storeOf(env.STORE, store)(
      `${LEAVE}?${new URLSearchParams(query)}`,
      { method: 'POST' },
      KERNEL,
    )
  let r = await leave(asked)
  if (!app || !r.ok || !url.searchParams.has('to')) return r
  let { to } = await r.clone().json() as { to: string }
  await dir.stamp(
    { entities: [{ entity: { eid: app.eid }, app: { store: to } }] },
    vouched(who),
  )
  let forgot = await leave([['forget', '1']])
  if (!forgot.ok) return forgot
  return Response.json({
    ...await r.json() as object,
    app: app.eid,
    forgot: true,
  })
}

// Whether a copy's ask is its store's plan, the one ask that reads the
// listing.
let planned = (body: string) =>
  (JSON.parse(body || '{}') as Asked).table == null

// A space's Operator store read out (store-copy.ts), for a rehearsal on
// a copy: GET lists every space, and a POST naming `space=<eid>` is that
// space's Builder answering the asked page. A plan asked of a space the
// directory does not hold wakes no object.
let copying = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof dirOf>,
  who: Who,
): Promise<Response> => {
  let listed = async () =>
    (await dir.all()).map(({ eid, slug }) => ({ eid, slug }))
  if (req.method == 'GET') {
    return Response.json(await listed(), {
      headers: { 'cache-control': 'private, no-store' },
    })
  }
  if (req.method != 'POST') {
    return json(405, 'method_not_allowed', 'list the spaces, or post to one')
  }
  let space = new URL(req.url).searchParams.get('space') ?? ''
  let body = await req.text()
  let plan = planned(body)
  if (plan && !(await listed()).some((s) => s.eid == space)) {
    return json(404, 'no_space', `no space is ${space || '(nothing)'}`)
  }
  // A copy of a space is one act, recorded at its plan, as graves records
  // only its first page: a sweep takes a page per 2,000 rows, and a record a
  // page wrote tens of thousands of entities to the directory in an hour.
  if (plan) await audit(env, who, { operation: 'operator_copy', space })
  // A page is a read: it is taken whole inside the retry that asked it, so a
  // body cut off on its way from the object is asked again, and the answer
  // leaves with its length, never as a stream that can end early behind a 200
  // (bug 756bd62283).
  return await builderOf(env, space)(
    () =>
      new Request(`https://builder${COPY}`, {
        method: 'POST',
        headers: { 'x-yak-kernel': '1', 'content-type': 'application/json' },
        body,
      }),
    { replayable: true },
  )
}

// A space's Operator store queried, or written as the admin: its rules,
// journal and trash hold, and a write is audited.
let graphing = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof dirOf>,
  who: Who,
): Promise<Response> => {
  if (req.method != 'POST') {
    return json(405, 'method_not_allowed', "query or write a space's Operator")
  }
  let slug = new URL(req.url).searchParams.get('space') ?? ''
  let space = slug ? await dir.space(slug) : null
  if (!space) return json(404, 'no_space', `no space is ${slug || '(nothing)'}`)
  let asked = await req.json() as Graphed
  if (asked.bundles && !asked.check) {
    await audit(env, who, { operation: 'operator_apply', space: space.eid })
  }
  let body = JSON.stringify({ ...asked, by: who.person })
  return await builderOf(env, space.eid)(
    () =>
      new Request(`https://builder${GRAPH}`, {
        method: 'POST',
        headers: { 'x-yak-kernel': '1', 'content-type': 'application/json' },
        body,
      }),
    { replayable: !asked.bundles },
  )
}

// The app whose own store this handle names.
let appAt = async (dir: ReturnType<typeof dirOf>, store: string) => {
  let spaces = await dir.all()
  let of = new Map(spaces.map((s) => [s.eid, s]))
  return (await dir.apps(spaces)).find((app) => {
    let space = of.get(app.space)
    return space && storeName(space, app) == store
  }) ?? null
}

// An app's store read out the same way: GET lists every app's store, its
// sample's and its visitors' (`stores`), and a POST naming `store=<name>` is
// that store's object answering the asked page from its file as it stands.
// A plan asked of a name the listing does not hold wakes no object, and
// neither the git store nor the directory is an app's.
let storeCopying = async (req: Request, env: Env): Promise<Response> => {
  let listed = async () =>
    (await stores(env)).filter((s) =>
      s.store != GIT_STORE && s.store != PLATFORM_STORE
    )
  if (req.method == 'GET') {
    return Response.json(await listed(), {
      headers: { 'cache-control': 'private, no-store' },
    })
  }
  if (req.method != 'POST') {
    return json(405, 'method_not_allowed', 'list the stores, or post to one')
  }
  let name = new URL(req.url).searchParams.get('store') ?? ''
  let body = await req.text()
  let refused = name == GIT_STORE || name == PLATFORM_STORE ||
    planned(body) && !(await listed()).some((s) => s.store == name)
  if (refused) {
    return json(404, 'no_store', `no app's store is ${name || '(nothing)'}`)
  }
  return await storeOf(env.STORE, name)(COPY, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  }, KERNEL)
}

// The directory's graves laid in a window (@yaks/platform/graves), a page of
// its tombstones at a time. A window that is not one is the caller's to fix.
let buried = async (req: Request, env: Env, who: Who): Promise<Response> => {
  if (req.method != 'GET') {
    return json(405, 'method_not_allowed', 'read the graves')
  }
  let asked = new URL(req.url).searchParams
  let after = asked.get('after')
  let window = {
    since: asked.get('since') ?? '',
    until: asked.get('until') ?? new Date().toISOString(),
    after: after == null ? undefined : Number(after),
  }
  let dir = meta(env)
  try {
    let page = await graves({
      buried: async (w) =>
        (await inspect(storeOf(env.STORE, PLATFORM_STORE), {
          deletions: { ...w, eids: true },
        })).deletions!,
      query: (q) => dir.query(q as never),
      trash: (eids, page) => dir.trash!(eids, page),
    }, window)
    // A walk is recorded once, at its first page.
    if (window.after == null) await audit(env, who, { operation: 'graves' })
    return Response.json(page, {
      headers: { 'cache-control': 'private, no-store' },
    })
  } catch (e) {
    if (!(e instanceof RangeError)) throw e
    return json(400, 'window', e.message)
  }
}

// One app's wiring to its siblings: its store's `uses` slot, every word it
// borrows to the slug of the app that homes it, beside its own access and
// each home's, whether its release built a worker (null where none recorded
// it), and how many people hold a grant on it without a seat in its space.
// The directory and the declaration slot answer it, so no store is queried
// for a word, and no row and no home's own words leave it.
let using = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof dirOf>,
  who: Who,
): Promise<Response> => {
  if (req.method != 'GET') {
    return json(405, 'method_not_allowed', "read an app's uses")
  }
  let at = new URL(req.url).searchParams.get('app') ?? ''
  let [s, a, ...rest] = at.split('/')
  let space = s && a && !rest.length ? await dir.space(s) : null
  let app = space ? await dir.app(space, a) : null
  if (!space || !app) {
    return json(404, 'no_app', `no app is ${at || '(nothing)'}`)
  }
  await audit(env, who, {
    operation: 'uses',
    space: space.eid,
    target: app.eid,
  })
  let r = await appStore(env.STORE, space, app, env)('/uses', {}, KERNEL)
  if (!r.ok) throw new Error(`${at} /uses: ${await r.text()}`)
  let uses = await r.json() as Record<string, string>
  let homes = Object.fromEntries(
    await Promise.all(
      [...new Set(Object.values(uses))].map(async (slug) => {
        let home = await dir.app(space, slug)
        return [slug, home ? mode(home.access) : null] as const
      }),
    ),
  )
  let { held } = await dir.people([space.eid])
  let seated = new Set(
    held.filter((h) => h.held == 'seat').map((h) => h.person),
  )
  let grantees = new Set(
    held.filter((h) =>
      h.held == 'grant' && h.on == app.eid && !seated.has(h.person)
    ).map((h) => h.person),
  ).size
  return Response.json({
    app: at,
    access: mode(app.access),
    worker: app.worker == null ? null : !!app.worker,
    grantees,
    uses,
    homes,
  }, { headers: { 'cache-control': 'private, no-store' } })
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let dir = dirOf(env)
  let meta = await dir.space(dirPart.META.space)
  if (!meta) return json(503, 'no_platform', 'the directory has not seeded yet')
  let who = await adminWho(
    env,
    req,
    (person) => dir.role(meta, person),
  )
  if (new URL(req.url).pathname == ACCOUNT_PATH) {
    return await account(req, env, dir, who)
  }
  if (who.role != 'owner') {
    return json(403, 'not_owner', `a sweep is an owner of ${meta.slug}'s`)
  }
  if (new URL(req.url).pathname == IDLE_PATH) {
    if (req.method != 'GET') {
      return json(405, 'method_not_allowed', 'read the idle spaces')
    }
    let { abandoned } = await import('./erase.ts')
    let idle = new Set(await abandoned(env))
    return Response.json(
      (await dir.all()).filter((space) => idle.has(space.eid))
        .map(({ eid, slug }) => ({ eid, slug })),
      { headers: { 'cache-control': 'private, no-store' } },
    )
  }
  if (new URL(req.url).pathname == RELOCATE_PATH) {
    return relocating(req, env, dir, who)
  }
  if (new URL(req.url).pathname == OPERATOR_PATH) {
    return copying(req, env, dir, who)
  }
  if (new URL(req.url).pathname == OPERATOR_GRAPH_PATH) {
    return graphing(req, env, dir, who)
  }
  if (new URL(req.url).pathname == STORE_COPY_PATH) {
    return storeCopying(req, env)
  }
  if (new URL(req.url).pathname == GRAVES_PATH) {
    return buried(req, env, who)
  }
  if (new URL(req.url).pathname == USES_PATH) {
    return using(req, env, dir, who)
  }
  let url = new URL(req.url)
  if (req.method == 'POST' && url.searchParams.has('operator_jobs')) {
    let space = url.searchParams.get('operator_jobs')!
    if (!(await dir.all()).some((row) => row.eid == space)) {
      return json(404, 'no_space', 'no such Operator store')
    }
    let page = await req.json() as JobPage | null
    if (page?.erase && !page.after) {
      await audit(env, who, {
        operation: 'erase_finished_jobs',
        space,
      })
    }
    let body = JSON.stringify(page)
    return await builderOf(env, space)(
      () =>
        new Request(`https://builder${JOBS}`, {
          method: 'POST',
          headers: { 'x-yak-kernel': '1', 'content-type': 'application/json' },
          body,
        }),
      { replayable: false },
    )
  }
  let all = await stores(env)
  if (req.method == 'GET') return Response.json(all)
  if (req.method != 'POST') {
    return json(405, 'method_not_allowed', 'list the stores, or post to one')
  }
  let name = url.searchParams.get('store') ?? ''
  if (!all.some((s) => s.store == name)) {
    return json(404, 'no_store', `no store is named ${name || '(nothing)'}`)
  }
  if (url.searchParams.has('jobs')) {
    let page = await req.json() as JobPage | null
    if (page?.erase && !page.after) {
      await audit(env, who, {
        operation: 'erase_finished_jobs',
        store: name,
      })
    }
    return await storeOf(env.STORE, name)(JOBS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(page),
    }, KERNEL)
  }
  let rehearse = url.searchParams.get('rehearse') == '1'
  await audit(env, who, { operation: 'move', store: name, rehearse })
  return await storeOf(env.STORE, name)(
    `/move${rehearse ? '?rehearse=1' : ''}`,
    { method: 'POST' },
    KERNEL,
  )
}
