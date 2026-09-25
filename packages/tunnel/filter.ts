// The tunnel's machine end: the filter the machine's own server puts in front
// of its routes (./routes.ts). A request the gateway marked (./gateway.ts)
// passes only at the paths the machine's owner opened to the tunnel, and the
// rest are refused before any route sees them. An unmarked request did not
// come through the tunnel, so everything the machine already answered locally
// it still does.
import { HEADER } from './gateway.ts'

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
  routes.some((pathname) =>
    new URLPattern({ pathname }).test({ pathname: path })
  )

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
  if (!req.headers.has(HEADER)) return
  let { pathname } = new URL(req.url)
  if (!opens(routes, pathname)) {
    throw new Closed(`the tunnel does not answer ${pathname}`)
  }
}
