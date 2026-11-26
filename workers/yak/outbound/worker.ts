// yak-out: the outbound Worker of the kernel's dispatch namespace. Every fetch
// an app's worker makes arrives here instead of leaving, with the CALLER the
// kernel said for that request (dispatch.ts). Store reads on space hosts
// use the query Worker. The kernel's Outbound entrypoint handles other calls.

import { appQuery, outgoing } from '@yaks/platform/app-outbound'
import type { Host } from '@yaks/platform/host'
import { QUERY_PASS } from '@yaks/platform/routes'
import { caught, origin, queue, type Sink } from '@yaks/tracker/report'

type Env = Host & {
  YAK: Parameters<typeof outgoing>[2]
  QUERY?: { fetch(req: Request): Promise<Response> }
  ERRORS?: { send(body: never): Promise<void> }
  CF_VERSION_METADATA?: { id: string }
  WORKER_NAME?: string
  CALLER: unknown
}

type Lent = { waitUntil(work: Promise<unknown>): void }

let read = async (req: Request, env: Env, ctx: Lent) => {
  let query = env.QUERY
  if (!query) return null
  let asked = appQuery(req, env.CALLER, env)
  if (!asked) return null
  try {
    let answer = await query.fetch(asked)
    if (answer.status == 204 && answer.headers.get(QUERY_PASS) == '1') {
      return null
    }
    return answer
  } catch (error) {
    ctx.waitUntil(caught(error, {
      sink: env.ERRORS ? queue(env.ERRORS as never) : (() => {}) as Sink,
      ...origin(
        env.WORKER_NAME ?? 'yak-out',
        env.CF_VERSION_METADATA?.id,
        'outbound query',
        req,
      ),
    }))
    return null
  }
}

export default {
  fetch: async (req: Request, env: Env, ctx: Lent): Promise<Response> =>
    await read(req, env, ctx) ?? outgoing(req, env.CALLER, env.YAK),
}
