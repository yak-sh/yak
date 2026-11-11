// What a host writes on the entry recording a reply, importable without the
// model (./mod.ts): a host that loads it lazily still marks its replies at once.
import { type CacheContext, prefixCacheMark, type Reply } from '@yaks/model'

/** `claude{response_id, session_id, cache_expires_at}` for a reply. The CLI
 * chooses how long its cache keeps a prefix and names no expiry, so the expiry
 * is the request's start plus the lifetime its provider row records
 * (`provider{cache_retention}`), and unknown where the row records none. */
export let mark = (
  reply: Reply & { claudeSession?: string },
  cache?: CacheContext,
): { claude: Record<string, unknown> } => ({
  claude: {
    response_id: reply.id,
    session_id: reply.claudeSession,
    ...prefixCacheMark(reply, cache),
  },
})
