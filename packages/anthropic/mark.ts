// What a host writes on the entry recording a reply, importable without the
// model (./mod.ts): a host that loads it lazily still marks its replies at once.
import { type CacheContext, prefixCacheMark, type Reply } from '@yaks/model'

// The documented lifetime of an ephemeral cache entry, in seconds.
let RETENTION = 300

/** `anthropic{response_id, cache_expires_at}` for a reply: the expiry is the
 * request's start plus the cache's five minutes. */
export let mark = (
  reply: Reply,
  cache?: CacheContext,
): { anthropic: Record<string, unknown> } => ({
  anthropic: {
    response_id: reply.id,
    ...prefixCacheMark(reply, cache && { ...cache, retention: RETENTION }),
  },
})
