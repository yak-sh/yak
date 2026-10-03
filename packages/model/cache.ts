// Cached-prefix expiry is provider bookkeeping, not response storage or token
// usage. Writers snapshot the effective expiry on each ask; readers never
// recalculate it from a provider row that may have changed since the request.
import type { Reply } from './mod.ts'

/** The dispatch instant and the provider's documented retention in seconds. */
export type CacheContext = { requestedAt: number; retention?: unknown }

/** An ISO instant, or a provider's Unix seconds, normalized to an ISO instant.
 * Dates without a timezone, durations, and nonfinite numbers are unknown. */
export let cacheExpiry = (value: unknown): string | undefined => {
  let ms = typeof value == 'number' ? value * 1000 : typeof value == 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
        .test(value)
    ? Date.parse(value)
    : NaN
  if (!Number.isFinite(ms) || ms < 0 || ms > 8.64e15) return
  return new Date(ms).toISOString()
}

/** Provider expiry wins, including an expired or invalid explicit value.
 * Unknown retention clears a prior mark rather than implying a warm cache. */
export let prefixCacheMark = (
  reply: Reply,
  cache?: CacheContext,
): { cache_expires_at: string | null } => {
  let expiry: string | undefined
  if (reply.cacheExpiresAt !== undefined) {
    expiry = cacheExpiry(reply.cacheExpiresAt)
  } else if (
    cache && Number.isFinite(cache.requestedAt) && cache.requestedAt >= 0 &&
    typeof cache.retention == 'number' &&
    Number.isSafeInteger(cache.retention) && cache.retention > 0
  ) {
    expiry = cacheExpiry((cache.requestedAt + cache.retention * 1000) / 1000)
  }
  return { cache_expires_at: expiry ?? null }
}

/** Read only the recorded request expiry from provider components. Missing,
 * malformed, or ambiguous provider bookkeeping is cold. Callers also require
 * a completed ask and known usage/model context before deciding to reuse it. */
export let cachedPrefixExpires = (
  comps: Record<string, unknown>,
): string | undefined => {
  let values = Object.values(comps).filter((value) =>
    value != null && typeof value == 'object' && !Array.isArray(value) &&
    'cache_expires_at' in value
  ) as Record<string, unknown>[]
  return values.length == 1
    ? cacheExpiry(values[0].cache_expires_at)
    : undefined
}
