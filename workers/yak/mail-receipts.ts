// A provider's notice about a letter, posted at `/mail/<via>`, is read by the
// notices that provider lends (config.ts `posts`), and a verified receipt is
// routed to the graph its sender named. The provider's API ids stay outside
// those graphs; only RFC Message-IDs land.
import { fromBase64url } from '@yaks/fp'
import { and, eq, every, list, stringify } from '@yaks/query'
import { Unsigned } from '@yaks/host/senders'
import { receipted } from '@yaks/mail'
import type { Env } from './env.ts'
import { lent } from './lent.ts'
import { KERNEL, metaOf } from './meta.ts'
import { storeOf } from './door.ts'
import { builderOf, SPACE } from './build.ts'

export let receipts = async (
  request: Request,
  env: Env,
  via: string,
): Promise<Response> => {
  let notices = await lent(env, 'notices')
  if (!Object.hasOwn(notices, via)) return new Response(null, { status: 404 })
  if (request.method != 'POST') return new Response(null, { status: 405 })
  let arrived
  try {
    arrived = await notices[via](request)
  } catch (error) {
    if (error instanceof Unsigned) {
      return Response.json({ error: error.message }, { status: 401 })
    }
    throw error
  }
  let found = arrived.receipt, tags = arrived.tags
  if (!found) return Response.json({ ok: true })
  if (tags?.yak_operator) {
    let response = await builderOf(env, tags.yak_operator)(() =>
      new Request('https://builder/operator/receipt', {
        method: 'POST',
        headers: {
          ...KERNEL,
          [SPACE]: tags.yak_operator,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...found, kind: tags.yak_kind }),
      })
    )
    if (!response.ok) throw new Error('Operator receipt was not recorded')
  } else if (tags?.yak_store) {
    let name = new TextDecoder().decode(fromBase64url(tags.yak_store))
    let graph = metaOf(storeOf(env.STORE, name), KERNEL)
    await receipted({
      get: (eids) =>
        graph.query(stringify(and(eq('entity.eid', list(...eids)), every()))),
      apply: (bundles) => graph.apply(bundles, KERNEL),
    }, found)
  }
  return Response.json({ ok: true })
}
