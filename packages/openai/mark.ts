// What a host writes on the entry recording a reply, importable without the
// model (./responses.ts): ./provider.ts marks its replies before loading it.
import { type CacheContext, prefixCacheMark, type Reply } from '@yaks/model'

/** The shortest time OpenAI's API documents keeping a cached prefix, in
 * seconds: five minutes for the earlier models, thirty for GPT-5.6 on. */
export let RETENTION = 300

/**
 * The mark of a reply under `name`: `openai{response_id, cache_expires_at}`.
 * The expiry is the request's start plus `retention`, a provider row's own
 * `cache_retention` first; with neither, it is unknown.
 *
 * ```ts
 * let reply = { id: 'resp_1', model: 'gpt', items: [] }
 * marking('openai', 300)(reply, { requestedAt: 0 })
 * // { openai: { response_id: 'resp_1', cache_expires_at: '1970-01-01T00:05:00.000Z' } }
 * marking('openai')(reply, { requestedAt: 0 })
 * // { openai: { response_id: 'resp_1', cache_expires_at: null } }
 * ```
 */
export let marking = (name: string, retention?: number) =>
(
  reply: Reply,
  cache?: CacheContext,
): Record<string, Record<string, unknown>> => ({
  [name]: {
    response_id: reply.id,
    ...prefixCacheMark(
      reply,
      cache && { ...cache, retention: cache.retention ?? retention },
    ),
  },
})
