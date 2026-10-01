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
import { directory } from './directory.ts'
import { GIT_STORE, PLATFORM_STORE, storeOf } from './door.ts'
import { bound, type Env } from './env.ts'
import { repair } from './key-repair.ts'
import { auditRows, keys, pages, part } from './key-audit.ts'
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
  // The roster itself must not stop at a listing cap, nor omit trash or
  // private apps. The directory's immutable app.store is the authority.
  let roster = storeOf(env.STORE, PLATFORM_STORE)
  let rows = [
    ...await pages(roster, '.space&*'),
    ...await pages(roster, '.app&*'),
  ]
  let spaces = new Map(
    rows.filter((row) => part(row, 'space')).map((
      row,
    ) => [row.entity.eid, part(row, 'space')!]),
  )
  let apps = rows.flatMap((row) => {
    let app = part(row, 'app')
    let space = typeof app?.space == 'string'
      ? spaces.get(app.space)
      : undefined
    if (!app || !space) return []
    let at = `${space.slug}/${app.slug ?? row.entity.eid}`
    let store = typeof app.store == 'string' ? app.store : at
    return [{ store, at }]
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
  let url = new URL(req.url)
  let audit = url.searchParams.get('audit')
  if (req.method == 'GET' && !audit) return Response.json(all)
  if (req.method == 'GET' && audit != 'builder-keys') {
    return json(400, 'no_audit', 'the sweep reads builder-keys')
  }
  if (req.method != 'POST' && req.method != 'GET') {
    return json(405, 'method_not_allowed', 'list the stores, or post to one')
  }
  let name = url.searchParams.get('store') ?? ''
  if (!all.some((s) => s.store == name)) {
    return json(404, 'no_store', `no store is named ${name || '(nothing)'}`)
  }
  if (req.method == 'GET') {
    // This is evidence retrieval, not a write door or a second query grammar.
    // UUIDs bound the selection; .refs is the graph's existing provenance read.
    let select = url.searchParams.get('select')
    if (select) {
      if (!/^[a-z][a-z0-9_]*$/.test(select)) {
        return json(400, 'bad_select', 'select one component name')
      }
      let after = url.searchParams.get('after') ?? ''
      if (
        after &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          after,
        )
      ) return json(400, 'bad_eid', 'after must be an eid UUID')
      let q = `.${select}&*&.limit=200${after ? `&.after=${after}` : ''}`
      return await storeOf(env.STORE, name)(
        `/query?q=${encodeURIComponent(q)}`,
        { method: 'GET' },
        KERNEL,
      )
    }
    let eid = url.searchParams.get('eid') ?? ''
    if (
      !eid && !url.searchParams.has('refs') && !url.searchParams.has('after')
    ) {
      return Response.json({
        store: name,
        ...keys(await auditRows(storeOf(env.STORE, name))),
      })
    }
    let after = url.searchParams.get('after') ?? ''
    let uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuid.test(eid) || (after && !uuid.test(after))) {
      return json(
        400,
        'bad_eid',
        'select an eid UUID, and an optional after UUID',
      )
    }
    let refs = url.searchParams.get('refs') == '1'
    let q = refs ? `.refs=${eid}&*` : `.entity.eid=${eid}&*`
    q += `&.limit=200${after ? `&.after=${after}` : ''}`
    return await storeOf(env.STORE, name)(
      `/query?q=${encodeURIComponent(q)}`,
      { method: 'GET' },
      KERNEL,
    )
  }
  let fix = url.searchParams.get('repair')
  if (fix) {
    if (fix != 'builder-keys') {
      return json(400, 'no_repair', 'the sweep repairs builder-keys metadata')
    }
    return await repair(req, storeOf(env.STORE, name))
  }
  let rehearse = url.searchParams.get('rehearse') == '1'
  return await storeOf(env.STORE, name)(
    `/move${rehearse ? '?rehearse=1' : ''}`,
    { method: 'POST' },
    KERNEL,
  )
}
