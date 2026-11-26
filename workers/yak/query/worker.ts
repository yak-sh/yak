import { query, queryPass } from '../apps.ts'
import type { Env } from '../env.ts'
import { gateway } from '../gateway.ts'
import { queryRequest } from '@yaks/platform/routes'

export let QUERY_VERSION = 'x-yak-query-version'

export let fetch = async (req: Request, env: Env) => {
  if (!env.SESSION_SECRET || !queryRequest(req, env)) return queryPass()
  let answer = await gateway(req, env, (given) => query(given, env))
  answer.headers.set(QUERY_VERSION, env.CF_VERSION_METADATA?.id ?? '')
  return answer
}
