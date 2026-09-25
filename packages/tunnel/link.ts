// The link's two ends: what stands between a hosted space's apps and the one
// service they reach on a linked machine.
//
// In the cloud, a gateway: a Worker the hosting platform uploads for each link
// (./cloudflare.ts `gateways`), and the only thing bound to the link's VPC
// Service. The platform hands it a request only once it has decided the app
// may reach the machine, and the gateway adds the link's secret on the way
// through. An app never holds the binding or the secret, so all it can send
// the machine is what the platform passes on.
//
// On the machine, a door (`link`): the one port the VPC Service names, apart
// from the machine's own server. It answers only a request carrying the
// secret, and only at the paths the machine opened to the link, and passes
// what it admits on to that server with the secret taken off. Everything else
// on the machine stays its own, whatever a request through the tunnel says.

/** The header the gateway adds, holding the link's secret. */
export let HEADER = 'x-yak-link'

/** The gateway's one module: the request as the platform passed it on, with
 * the link's secret (`SECRET`, a secret binding) added, to the machine behind
 * the VPC Service (`BOX`). */
export let GATEWAY = `export default {
  fetch(req, env) {
    let headers = new Headers(req.headers)
    headers.set('${HEADER}', env.SECRET)
    return env.BOX.fetch(new Request(req, { headers }))
  },
}
`

/** What the machine's door reads on every request, so a secret written to
 * the vault after it started is the one it checks. */
export type Opened = {
  /** the link's secret; until there is one, nothing is admitted */
  secret?: string
  /** the paths the link answers, as URLPattern pathnames (`/mail/inbound`,
   * `/hooks/*`); none opens nothing */
  routes?: string[]
}

// Equal, in a time that says nothing about where two strings differ.
let same = (a: string, b: string) => {
  let [x, y] = [new TextEncoder().encode(a), new TextEncoder().encode(b)]
  if (x.length != y.length) return false
  let d = 0
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]
  return d == 0
}

/** Whether the link answers at `path`.
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

let no = (status: number, said: string) => new Response(said, { status })

/** The machine's door: a request the link admits goes on to the server at
 * `to` (an origin), and anything else is refused here. */
export let link = (
  opened: Opened,
  to: string,
  send: (req: Request) => Promise<Response> = fetch,
) =>
(req: Request): Response | Promise<Response> => {
  let { secret, routes } = opened
  if (!secret || !same(req.headers.get(HEADER) ?? '', secret)) {
    return no(403, 'not a request through the link')
  }
  let { pathname, search } = new URL(req.url)
  if (!opens(routes, pathname)) {
    return no(404, `the link does not answer ${pathname}`)
  }
  let headers = new Headers(req.headers)
  headers.delete(HEADER)
  return send(
    new Request(new URL(pathname + search, to), {
      method: req.method,
      headers,
      body: req.body,
      redirect: 'manual',
    }),
  )
}
