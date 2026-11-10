// The tunnel's cloud end: the gateway, a Worker the hosting platform uploads
// for each tunnel (./cloudflare.ts `gateways`) and the only thing bound to its
// VPC Service. The platform hands it a request only once it has decided the
// app may reach the machine, and the gateway marks every request it passes on
// with `x-yak-tunnel`, over whatever the request said. An app never holds the
// binding, so all it can send the machine is what the platform passes on, and
// always marked. The machine's end is ./filter.ts.
//
// The platform also says who is asking, in `x-yak-caller`: a word of its own
// for each kind of caller it passes on (an app's worker, its owner's
// assistant), set on every request it hands the gateway and taken off
// whatever a caller sent. The gateway passes it on as it came, and the
// machine opens a path to the callers it names (./filter.ts `Callers`).
// Where a request carries its owner's own words, the platform says who that
// is too, in `x-yak-by`, and where it was made in a conversation, whose that
// is, in `x-yak-with`.

/** The header the gateway marks every request with. */
export let HEADER = 'x-yak-tunnel'

/** The header the platform says who is asking in: its own word for the kind of
 * caller, which only it sets. */
export let CALLER = 'x-yak-caller'

/** The header the platform names a person in, by its own id for them: the
 * request is that person's own act (their words, their answer), where one
 * without it is their assistant's. Only the platform says it, as it does
 * `x-yak-caller`. The machine's end decides whose act it then is
 * (./routes.ts). */
export let BY = 'x-yak-by'

/** The header the platform names the person a request's conversation is
 * held with, by its own id for them: whose assistant is asking, where
 * `x-via` names the conversation. Only the platform says it. */
export let WITH = 'x-yak-with'

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
