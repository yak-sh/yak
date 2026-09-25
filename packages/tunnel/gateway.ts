// The tunnel's cloud end: the gateway, a Worker the hosting platform uploads
// for each tunnel (./cloudflare.ts `gateways`) and the only thing bound to its
// VPC Service. The platform hands it a request only once it has decided the
// app may reach the machine, and the gateway marks every request it passes on
// with `x-yak-tunnel`, over whatever the request said. An app never holds the
// binding, so all it can send the machine is what the platform passes on, and
// always marked. The machine's end is ./filter.ts.

/** The header the gateway marks every request with. */
export let HEADER = 'x-yak-tunnel'

/** The gateway's one module: the request as the platform passed it on, marked
 * as the tunnel's, to the machine behind the VPC Service (`BOX`). */
export let GATEWAY = `export default {
  fetch(req, env) {
    let headers = new Headers(req.headers)
    headers.set('${HEADER}', '1')
    return env.BOX.fetch(new Request(req, { headers }))
  },
}
`
