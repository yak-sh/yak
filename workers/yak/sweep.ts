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
//   DELETE /api/account?address=<address>   it erased (erase.ts `closed`); a
//                                           test account may end itself
//   GET  /api/operator-copy                 every space
//   POST /api/operator-copy?space=<eid>     a page of that space's Operator
//                                           store (operator-copy.ts)
//
// The gate is the one the fee answers to (sell.ts `fees`): an owner of the
// platform's own space, read off a website session or an OAuth token. A store is named by the
// kernel, never by a caller, so a name the listing does not hold is refused
// rather than waking an object nobody made.
import * as dirPart from './directory.ts'
import { directory, storeName } from './directory.ts'
import { GIT_STORE, storeOf } from './door.ts'
import { PLATFORM_STORE } from '@yaks/platform/names'
import type { Swept } from '@yaks/platform/mover'
import { bound, type Env } from './env.ts'
import { KERNEL } from './meta.ts'
import { adminWho } from './asking.ts'
import { vouched, type Who } from './session.ts'
import { LEAVE, WHERE } from './relocate.ts'
import { visits } from './visit.ts'
import { builderOf } from './build-door.ts'
import { COPY } from './operator-copy.ts'

export let PATH = '/api/move'
export let RELOCATE_PATH = '/api/relocate'
export let IDLE_PATH = '/api/idle-spaces'
export let ACCOUNT_PATH = '/api/account'
export let OPERATOR_PATH = '/api/operator-copy'

let dirOf = (env: Env) => directory(bound(env.DIRECTORY, dirPart.fetch, env))

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

/** Every store there is, trashed apps' included: a restore brings one back
 * holding whatever shape it was left in. An app's sample and the stores its
 * visitors were given (visit.ts) hold its words too, so a migration reaches
 * them as well. */
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
  let visited = (await visits(env)).flatMap(({ app, visit }) =>
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
  if (req.method != 'GET' && req.method != 'DELETE') {
    return json(405, 'method_not_allowed', 'read or delete an account')
  }
  let { closed, closing } = await import('./erase.ts')
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
  if (req.method == 'DELETE') await closed(env, dir, address, who)
  return Response.json({
    address,
    erased: req.method == 'DELETE',
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
    return Response.json({ worker: colo, ...await r.json() }, {
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
  return Response.json({ ...await r.json(), app: app.eid, forgot: true })
}

// A space's Operator store read out (operator-copy.ts), for a rehearsal on
// a copy: GET lists every space, and a POST naming `space=<eid>` is that
// space's Builder answering the asked page. A space the directory does not
// hold wakes no object.
let copying = async (
  req: Request,
  env: Env,
  dir: ReturnType<typeof dirOf>,
): Promise<Response> => {
  let spaces = await dir.all()
  if (req.method == 'GET') {
    return Response.json(spaces.map(({ eid, slug }) => ({ eid, slug })), {
      headers: { 'cache-control': 'private, no-store' },
    })
  }
  if (req.method != 'POST') {
    return json(405, 'method_not_allowed', 'list the spaces, or post to one')
  }
  let space = new URL(req.url).searchParams.get('space') ?? ''
  if (!spaces.some((s) => s.eid == space)) {
    return json(404, 'no_space', `no space is ${space || '(nothing)'}`)
  }
  let body = await req.text()
  return await builderOf(env, space)(() =>
    new Request(`https://builder${COPY}`, {
      method: 'POST',
      headers: { 'x-yak-kernel': '1', 'content-type': 'application/json' },
      body,
    })
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
    return copying(req, env, dir)
  }
  let all = await stores(env)
  if (req.method == 'GET') return Response.json(all)
  if (req.method != 'POST') {
    return json(405, 'method_not_allowed', 'list the stores, or post to one')
  }
  let url = new URL(req.url)
  let name = url.searchParams.get('store') ?? ''
  if (!all.some((s) => s.store == name)) {
    return json(404, 'no_store', `no store is named ${name || '(nothing)'}`)
  }
  let rehearse = url.searchParams.get('rehearse') == '1'
  return await storeOf(env.STORE, name)(
    `/move${rehearse ? '?rehearse=1' : ''}`,
    { method: 'POST' },
    KERNEL,
  )
}
