// `/api/orphan?id=<64 hex>`: one Store object the fleet-shaped store left
// behind, addressed by the id the runtime gave it. GET says what it holds —
// the name in its memory, whether it is fleet-shaped, its entities — and
// whether any app in the directory still reaches that name; DELETE deletes all
// of it, only when it is fleet-shaped, holds no entity and no app reaches it
// (graph.ts `#orphan`). The platform's owner alone, as the fee is (sell.ts
// `fees`): a seat in `yak`, read off the session cookie.
import * as dirPart from './directory.ts'
import { directory, storeName } from './directory.ts'
import { GIT_STORE, PLATFORM_STORE } from './door.ts'
import { bound, type Env } from './env.ts'
import { whoIs } from './session.ts'

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

export type Orphan = {
  name: string | null
  fleet: boolean
  entities: number
  // Whether an app, trashed or not, or the platform's own two stores, answer
  // to that name.
  reached: boolean
}

export let orphan = async (req: Request, env: Env): Promise<Response> => {
  if (req.method != 'GET' && req.method != 'DELETE') {
    return json(405, 'method_not_allowed', 'read an orphan, or delete it')
  }
  let dir = directory(bound(env.DIRECTORY, dirPart.fetch, env), true)
  let meta = await dir.space(dirPart.META.space)
  if (!meta) return json(503, 'no_platform', 'the directory has not seeded yet')
  let who = await whoIs(
    req,
    env.SESSION_SECRET,
    (person) => dir.role(meta, person),
  )
  if (who.role != 'owner') {
    return json(
      403,
      'not_owner',
      `an orphan is read and deleted by an owner of ${meta.slug}`,
    )
  }
  let id = new URL(req.url).searchParams.get('id') ?? ''
  let at = /^[0-9a-f]{64}$/.test(id) ? env.STORE.idFromString?.(id) : null
  if (at == null) {
    return json(400, 'bad_id', `not a Store object id: ${id || '(none)'}`)
  }
  let stub = env.STORE.get(at)
  let ask = (method: string) =>
    stub.fetch(
      new Request('http://store/orphan', {
        method,
        headers: { 'x-yak-kernel': '1' },
      }),
    )
  let held: Omit<Orphan, 'reached'> = await (await ask('GET')).json()
  let spaces = await dir.all()
  let names = new Set([
    PLATFORM_STORE,
    GIT_STORE,
    ...(await dir.apps(spaces)).flatMap((app) => {
      let space = spaces.find((s) => s.eid == app.space)
      return space ? [storeName(space, app)] : []
    }),
  ])
  let found: Orphan = { ...held, reached: !!held.name && names.has(held.name) }
  if (req.method == 'GET') return Response.json(found)
  if (!found.fleet || found.entities || found.reached) {
    return json(
      409,
      'not_orphan',
      `${found.name ?? 'this object'} is not an orphan: ` +
        (found.reached
          ? 'an app answers to its name'
          : !found.fleet
          ? 'it is on the packages'
          : `it holds ${found.entities} entities`),
    )
  }
  let gone = await ask('DELETE')
  return gone.ok ? Response.json({ ...found, deleted: true }) : gone
}
