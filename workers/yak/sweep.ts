// The mover's sweep door (mover.ts, D-45640): every store the platform has,
// and one store at a time asked to rehearse its rules or to move what it owes.
// `yak admin move` walks the list and paces the asking; this door never loops
// over the platform itself, so one request reaches one store.
//
//   GET  /api/move                        every store, in the order a sweep
//                                         takes them: the app stores, the git
//                                         object store, then the directory
//   POST /api/move?store=<name>&rehearse=1  that store's rehearsal
//   POST /api/move?store=<name>           that store woken to move what it
//                                         owes, and where each rule stands
//   GET  /api/account?address=<address>     what erasing that test account
//                                           would take
//   DELETE /api/account?address=<address>   it erased (erase.ts `closed`); a
//                                           test account may end itself
//
// The gate is the one the fee answers to (sell.ts `fees`): an owner of the
// platform's own space, read off a website session or an OAuth token. A store is named by the
// kernel, never by a caller, so a name the listing does not hold is refused
// rather than waking an object nobody made.
import * as dirPart from './directory.ts'
import { directory, storeName } from './directory.ts'
import { GIT_STORE, PLATFORM_STORE, storeOf } from './door.ts'
import { bound, type Env } from './env.ts'
import { KERNEL } from './meta.ts'
import { adminWho } from './identity.ts'
import type { Who } from './session.ts'
import { LEAVE, WHERE } from './relocate.ts'

export let PATH = '/api/move'
export let RELOCATE_PATH = '/api/relocate'
export let IDLE_PATH = '/api/idle-spaces'
export let ACCOUNT_PATH = '/api/account'

/** One store a sweep asks: its name, and what a person calls it. */
export type Swept = { store: string; at: string }

let dirOf = (env: Env) =>
  directory(bound(env.DIRECTORY, dirPart.fetch, env), true)

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

/** Every store there is, trashed apps' included: a restore brings one back
 * holding whatever shape it was left in. */
export let stores = async (env: Env): Promise<Swept[]> => {
  let dir = dirOf(env)
  let spaces = await dir.all()
  let of = new Map(spaces.map((s) => [s.eid, s]))
  let apps = (await dir.apps(spaces)).flatMap((app) => {
    let space = of.get(app.space)
    return space
      ? [{ store: storeName(space, app), at: `${space.slug}/${app.slug}` }]
      : []
  })
  let all = [
    ...apps,
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
  let address = new URL(req.url).searchParams.get('address') ?? ''
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

// The directory's move to a new object (relocate.ts): `?where=<name>&colo=ORD`
// reaches the object of that name from a Worker in that colo, which is what
// places an object that has never been reached, and says where it stands.
// `?rehearse=<name>` copies it to a throwaway object while it serves.
// `?to=<name>` copies the directory there and answers both ends' tallies, and
// `?back=1` returns it, for a new object that can't serve.
let relocating = async (req: Request, env: Env): Promise<Response> => {
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
    k == 'to' || k == 'rehearse' || k == 'back'
  )
  if (!asked.length) return json(400, 'arguments', 'name where, to or rehearse')
  return await storeOf(env.STORE, PLATFORM_STORE)(
    `${LEAVE}?${new URLSearchParams(asked)}`,
    { method: 'POST' },
    KERNEL,
  )
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
  if (new URL(req.url).pathname == RELOCATE_PATH) return relocating(req, env)
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
