// What a host writes on the entry recording a reply, importable without the
// model (./responses.ts): ./provider.ts marks its replies before loading it.
import { type CacheContext, prefixCacheMark, type Reply } from '@yaks/model'

// Retention for the default request settings. Earlier models that support
// extended retention can default to 24h depending on the account's policy.
// https://developers.openai.com/api/docs/guides/prompt-caching
let retentionOf = (model: string): number =>
  /^gpt-(?:[6-9]|[1-9]\d|5\.[6-9]|5\.[1-9]\d)/.test(model)
    ? 1_800
    : /^gpt-(?:5(?:\.(?:1|2|4|5)(?=-|$)|(?:-codex)?(?=-\d|$))|4\.1(?=-\d|$))/
        .test(model)
    ? 86_400
    : 3_600

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
export let marking = (
  name: string,
  retention?: number | 'openai-default',
) =>
(
  reply: Reply,
  cache?: CacheContext,
): Record<string, Record<string, unknown>> => ({
  [name]: {
    response_id: reply.id,
    ...prefixCacheMark(
      reply,
      cache && {
        ...cache,
        retention: cache.retention ??
          (retention == 'openai-default'
            ? retentionOf(reply.model)
            : retention),
      },
    ),
  },
})
