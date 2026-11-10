// The tunnel's machine end: the filter the machine's own server puts in front
// of its routes (./routes.ts). A request the gateway marked (./gateway.ts)
// passes only at the paths the machine's owner opened to the tunnel, and the
// rest are refused before any route sees them. Where an opened path lists and
// runs tools, a marked request is offered only the ones the owner named
// (`offered`). An unmarked request did not come through the tunnel, so
// everything the machine already answered locally it still does.
//
// The platform says who is asking (./gateway.ts `CALLER`), and the owner can
// open more to one kind of caller than to the rest (`Callers`): a path every
// app in the space may reach, and beside it a path only the owner's assistant
// may. A request saying no word, or one the owner named nothing for, gets what
// every request through the tunnel does.
import { CALLER, HEADER } from './gateway.ts'

/** What a machine's owner opens to requests through the tunnel: the paths
 * answered, the tools offered where a path runs them, and the persona written
 * as. */
export type Opened = {
  /** the paths answered, as URLPattern pathnames; none opens nothing */
  routes?: string[]
  /** the tools offered at a path that runs them, by name; none offers
   * nothing */
  tools?: string[]
  /** the persona written as, by eid, number or name */
  persona?: string
}

/** What a machine's owner opens to one kind of caller on top of what every
 * request through the tunnel gets, by the platform's word for the caller. */
export type Callers = Record<string, Opened>

/** What the caller this request is from was opened, on top of what every
 * request through the tunnel is: the entry for the platform's word on it, or
 * nothing. */
export let named = (callers: Callers = {}, req: Request): Opened => {
  let word = req.headers.get(CALLER) ?? ''
  return Object.hasOwn(callers, word) ? callers[word] : {}
}

/** Whether the gateway marked this request: it came through the tunnel. */
export let marked = (req: Request): boolean => req.headers.has(HEADER)

// Patterns depend on their pathname, not the mutable list of opened routes.
let patterns = new Map<string, URLPattern>()
let pattern = (pathname: string): URLPattern => {
  let found = patterns.get(pathname)
  if (found) return found
  let compiled = new URLPattern({ pathname })
  patterns.set(pathname, compiled)
  if (patterns.size > 256) patterns.delete(patterns.keys().next().value!)
  return compiled
}

/** Whether the tunnel answers at `path`: `routes` are URLPattern pathnames
 * (`/mail/inbound`, `/hooks/*`), and none opens nothing.
 *
 * ```ts
 * import { assert } from '@std/assert'
 * assert(opens(['/mail/inbound', '/hooks/*'], '/hooks/github'))
 * assert(!opens(['/mail/inbound'], '/apply'))
 * ```
 */
export let opens = (routes: string[] = [], path: string): boolean =>
  routes.some((pathname) => pattern(pathname).test({ pathname: path }))

/** A marked request at a path the machine did not open. Its name is the
 * policy refusal's, so a server answers it 403. */
export class Closed extends Error {
  override name = 'Denied'
}

/** The machine's word on the tunnel: a marked request passes only at a path
 * opened to every request (`routes`) or to the caller the platform says it is
 * from (`callers`), and an unmarked one always does.
 *
 * ```ts
 * import { assertThrows } from '@std/assert'
 * import { CALLER, HEADER } from './gateway.ts'
 * let only = filter(['/mail/inbound'], { operator: { routes: ['/mcp'] } })
 * let through = (path: string, caller = 'app') =>
 *   new Request(`http://box${path}`, {
 *     headers: { [HEADER]: '1', [CALLER]: caller },
 *   })
 * only(new Request('http://box/apply'))
 * only(through('/mail/inbound'))
 * only(through('/mcp', 'operator'))
 * assertThrows(() => only(through('/mcp')))
 * assertThrows(() => only(through('/apply', 'operator')))
 * ```
 */
export let filter =
  (routes: string[] = [], callers?: Callers) => (req: Request): void => {
    if (!marked(req)) return
    let { pathname } = new URL(req.url)
    if (
      !opens(routes, pathname) && !opens(named(callers, req).routes, pathname)
    ) {
      throw new Closed(`the tunnel does not answer ${pathname}`)
    }
  }

/** The tools a request is offered, by name: for a marked request the ones the
 * machine's owner named for every request (`tools`) and for the caller the
 * platform says it is from (`callers`), and none names nothing; an unmarked
 * request is not narrowed (`undefined`).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { CALLER, HEADER } from './gateway.ts'
 * let tools = offered(['task_list'], { operator: { tools: ['task_new'] } })
 * let through = (caller: string) =>
 *   new Request('http://box/mcp', {
 *     headers: { [HEADER]: '1', [CALLER]: caller },
 *   })
 * assertEquals(tools(new Request('http://box/mcp')), undefined)
 * assertEquals(tools(through('app')), ['task_list'])
 * assertEquals(tools(through('operator')), ['task_list', 'task_new'])
 * ```
 */
export let offered =
  (tools: string[] = [], callers?: Callers) =>
  (req: Request): string[] | undefined =>
    marked(req) ? [...tools, ...named(callers, req).tools ?? []] : undefined
