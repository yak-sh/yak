// `DELETE /api/orphan?id=<64 hex>`: one Store object that no name reaches and
// that holds nothing, deleted whole (graph.ts `#orphan`, migrate.ts
// `orphaned`). The fleet-shaped store left such objects behind, and nothing
// remembers the names they were made under, so they are addressed by the id
// the runtime gave them. The platform's owner alone, as the fee is (sell.ts
// `fees`): a seat in `yak`, read off the session cookie.
import * as dirPart from './directory.ts'
import { directory } from './directory.ts'
import { bound, type Env } from './env.ts'
import { whoIs } from './session.ts'

let json = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status })

export let orphan = async (req: Request, env: Env): Promise<Response> => {
  if (req.method != 'DELETE') {
    return json(405, 'method_not_allowed', 'an orphan is deleted by its id')
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
      `an orphan is deleted by an owner of ${meta.slug}`,
    )
  }
  let id = new URL(req.url).searchParams.get('id') ?? ''
  let at = /^[0-9a-f]{64}$/.test(id) ? env.STORE.idFromString?.(id) : null
  if (at == null) {
    return json(400, 'bad_id', `not a Store object id: ${id || '(none)'}`)
  }
  return await env.STORE.get(at).fetch(
    new Request('http://store/orphan', {
      method: 'DELETE',
      headers: { 'x-yak-kernel': '1' },
    }),
  )
}
