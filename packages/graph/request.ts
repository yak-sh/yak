// The `$` keys a change may carry. A bundle's ordinary keys name components,
// and an undeclared component is dropped so a newer client can still write the
// rest of its change. A `$` key is the opposite kind of thing: it asks the
// pipeline to DO something, and a request nobody implements did not happen —
// `$num: true` on a graph with no allocator would return a bundle with no
// number and no word about why. So an unknown request is refused, and a plugin
// says which ones it answers (`Plugin.requests`).
//
// `$alias` and `$quiet` are the core's own bookkeeping rather than a caller's
// ask, and they are admitted for the same reason a stamped property is: a
// caller that read a bundle back and sent it again is doing a normal thing.

import type { Bundle } from './bundle.ts'
import { Refused } from './admit.ts'

/** The requests `apply()` answers itself. */
export let REQUESTS: string[] = [
  '$delete',
  '$was',
  '$actor',
  '$alias',
  '$quiet',
]

/**
 * Every bundle's `$` keys, checked against what this graph can answer. The
 * refusal names the request and lists the ones it has, because a caller asking
 * for something nobody registered has the wrong idea of this graph.
 */
export let requested = (bundles: Bundle[], answered: string[]): Bundle[] => {
  let known = new Set([...REQUESTS, ...answered])
  for (let b of bundles) {
    let alien = Object.keys(b).filter((k) => k.startsWith('$') && !known.has(k))
    if (alien.length) {
      throw new Refused(
        `unknown request${alien.length > 1 ? 's' : ''}: ${
          alien.join(', ')
        } — this graph answers ${[...known].join(', ')}`,
      )
    }
  }
  return bundles
}
