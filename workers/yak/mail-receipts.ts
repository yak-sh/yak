// A provider's notice about a letter, posted at `/mail/<via>`, is read by the
// notices that provider lends (config.ts `posts`), and a verified receipt is
// routed to the graph its sender named. The provider's API ids stay outside
// those graphs; only RFC Message-IDs land. A notice that it received letters
// hands them to the inbox (inbox.ts `received`), the path a letter from
// Email Routing takes, and a failure of ours answers 500 so the provider
// tries again.
import { fromBase64url } from '@yaks/fp'
import { and, eq, every, list, stringify } from '@yaks/query'
import { Unsigned } from '@yaks/host/senders'
import { receipted } from '@yaks/mail'
import type { Env } from './env.ts'
import { lent } from './lent.ts'
import { KERNEL, metaOf } from './meta.ts'
import { storeOf } from './door.ts'
import { builderOf, SPACE } from './build-door.ts'
import { caught } from './defects.ts'

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
  if (arrived.letters) {
    let { received } = await import('./inbox.ts')
    try {
      await received(arrived.letters, env)
    } catch (error) {
      caught(error, {
        request: 'mail arrival',
        provider: via,
        domain: arrived.letters[0]?.to.split('@').pop(),
      })
      throw error
    }
    return Response.json({ ok: true })
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
    // The letter is the platform's own bookkeeping, read whoever its readers
    // are: an app's letters are kept to its owners and editors (`mail`).
    try {
      await receipted({
        get: (eids) =>
          graph.query(
            stringify(and(eq('entity.eid', list(...eids)), every())),
            {
              trusted: true,
              graves: true,
            },
          ),
        apply: (bundles) => graph.apply(bundles, KERNEL),
      }, found)
    } catch (error) {
      caught(error, {
        request: 'mail receipt',
        provider: via,
        store: name,
        letter: found.letter,
      })
      throw error
    }
  }
  return Response.json({ ok: true })
}
