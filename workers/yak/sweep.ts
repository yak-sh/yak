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
//
// The gate is the one the fee answers to (sell.ts `fees`): an owner of the
// platform's own space, read off the session cookie. A store is named by the
// kernel, never by a caller, so a name the listing does not hold is refused
// rather than waking an object nobody made.
import * as dirPart from './directory.ts'
import { directory, storeName } from './directory.ts'
import { GIT_STORE, PLATFORM_STORE, storeOf } from './door.ts'
import { bound, type Env } from './env.ts'
import { KERNEL } from './meta.ts'
import { whoIs } from './session.ts'

export let PATH = '/api/move'

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
  return [
    ...apps,
    { store: GIT_STORE, at: 'git' },
    { store: PLATFORM_STORE, at: 'directory' },
  ]
}

export let fetch = async (req: Request, env: Env): Promise<Response> => {
  let dir = dirOf(env)
  let meta = await dir.space(dirPart.META.space)
  if (!meta) return json(503, 'no_platform', 'the directory has not seeded yet')
  let who = await whoIs(
    req,
    env.SESSION_SECRET,
    (person) => dir.role(meta, person),
  )
  if (who.role != 'owner') {
    return json(403, 'not_owner', `a sweep is an owner of ${meta.slug}'s`)
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
