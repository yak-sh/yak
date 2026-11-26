// The Worker's binding of @yaks/fp's shared reads: work under way is shared
// within the current invocation, and what outlives it is a value.
import { type Kept, sharing as shared, singleFlight } from '@yaks/fp'
import { background, invocationKey } from '../defects.ts'

export let inFlight = singleFlight(invocationKey, background)

/** Keep completed values across invocations and pending reads within one
 * (@yaks/fp `sharing`). */
export let sharing = <K, T>(
  kept: Kept<K, T>,
  key: K,
  read: () => Promise<T>,
  limit?: number,
): Promise<T> =>
  shared(kept, key, read, { limit, scope: invocationKey, hold: background })
