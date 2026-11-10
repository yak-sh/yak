// The tunnel's machine end: the filter the machine's own server puts in front
// of its routes (./routes.ts). A request the gateway marked (./gateway.ts)
// passes only at the paths the machine's owner opened to the tunnel, and the
// rest are refused before any route sees them. Where an opened path lists and
// runs tools, a marked request is offered only the ones the owner named
// (`offered`). An unmarked request did not come through the tunnel, so
// everything the machine already answered locally it still does.
import { HEADER } from './gateway.ts'

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

/** The machine's word on the tunnel: a marked request passes only at an
 * opened path, and an unmarked one always does.
 *
 * ```ts
 * import { assertThrows } from '@std/assert'
 * import { HEADER } from './gateway.ts'
 * let only = filter(['/mail/inbound'])
 * only(new Request('http://box/apply'))
 * only(new Request('http://box/mail/inbound', { headers: { [HEADER]: '1' } }))
 * assertThrows(() =>
 *   only(new Request('http://box/apply', { headers: { [HEADER]: '1' } }))
 * )
 * ```
 */
export let filter = (routes: string[] = []) => (req: Request): void => {
  if (!marked(req)) return
  let { pathname } = new URL(req.url)
  if (!opens(routes, pathname)) {
    throw new Closed(`the tunnel does not answer ${pathname}`)
  }
}

/** The tools a request is offered, by name: for a marked request the ones the
 * machine's owner named, and none names nothing; an unmarked request is not
 * narrowed (`undefined`).
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * import { HEADER } from './gateway.ts'
 * let tools = offered(['task_list'])
 * assertEquals(tools(new Request('http://box/mcp')), undefined)
 * assertEquals(
 *   tools(new Request('http://box/mcp', { headers: { [HEADER]: '1' } })),
 *   ['task_list'],
 * )
 * ```
 */
export let offered =
  (tools: string[] = []) => (req: Request): string[] | undefined =>
    marked(req) ? tools : undefined
