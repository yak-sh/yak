// The platform's admin's door onto a space's Operator store (sweep.ts
// `graphing`, `yak admin query|apply --operator`): a query, or bundles
// applied as the admin. The kernel names the space and the actor; the store's
// rules, journal and trash hold as for any write.
import type { Bundle } from '@yaks/graph'

/** The path the Operator's object answers it on, for the kernel alone. */
export let GRAPH = '/graph'

/** What is asked: a query line, or bundles applied by `by`, rehearsed when
 * `check`. */
export type Graphed = {
  q?: string
  bundles?: Bundle[]
  by?: string
  check?: boolean
}
