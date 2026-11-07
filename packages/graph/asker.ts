// Who a piece of work answers: the door it came through and, where the door
// knows, the session or page that sent it. A door says it once, where its
// work begins (`asking`), and whatever that work starts deep inside, such as a
// read on another thread, takes it (`asker`) so a failure names its sender.
// Nothing reads it to decide how to answer.

/** The door work came through (a route such as `/query`, `/ws`, a tool's
 * name) and the session or page that sent it, where known. */
export type Asker = {
  door: string
  /** the session whose call it is */
  session?: string
  /** the path of the page that sent it */
  page?: string
}

/** A host's task-local carrier, such as an `AsyncLocalStorage`. */
export type AskerCarrier = {
  get: () => Asker | undefined
  run: <T>(asker: Asker | undefined, work: () => T) => T
}

let carrier: AskerCarrier | undefined
let current: Asker | undefined

/** Install the host's task-local carrier, once per runtime. Without one an
 * asker reaches only the synchronous part of its work. The returned cleanup
 * restores the carrier before it. */
export let installAsker = (next: AskerCarrier | undefined): () => void => {
  let before = carrier
  carrier = next
  return () => {
    if (carrier == next) carrier = before
  }
}

/** Who the work running now answers, if a door said. */
export let asker = (): Asker | undefined => carrier ? carrier.get() : current

/**
 * Run `work` for `who`, which says what it knows over what an outer door
 * said: a tool call inside the `/mcp` route keeps the route's page.
 *
 * ```ts
 * import { equal } from '@yaks/testing'
 * import { asker, asking } from '@yaks/graph/asker'
 *
 * equal(
 *   asking({ door: '/mcp', page: '/P-19' }, () =>
 *     asking({ door: 'graph_query', session: 's' }, asker)),
 *   { door: 'graph_query', page: '/P-19', session: 's' },
 * )
 * equal(asker(), undefined)
 * ```
 */
export let asking = <T>(who: Asker | undefined, work: () => T): T => {
  let outer = asker()
  let next = who && outer ? { ...outer, ...who } : who ?? outer
  if (carrier) return carrier.run(next, work)
  let before = current
  current = next
  try {
    return work()
  } finally {
    current = before
  }
}
