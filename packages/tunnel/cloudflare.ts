// The account side of a tunnel: the two Cloudflare resources that let a
// Worker reach a service on somebody's machine, and nothing else.
//
// A Cloudflare Tunnel is the machine's outbound connection: `cloudflared` runs
// there with the tunnel's token (./service.ts) and dials Cloudflare, so the
// machine needs no open port and no public address. A Workers VPC Service
// names one host and port behind that tunnel; a Worker bound to it reaches
// exactly that service and nothing else on the network, whatever URL it
// fetches (https://developers.cloudflare.com/workers-vpc/api/).
//
// The token is a credential: whoever holds it can run the tunnel. So this
// module hands it back to its caller and never keeps or logs it; where it goes
// next is the caller's business (a vault, a sealed secret).
//
// The API token these calls are made with needs Cloudflare Tunnel Write and
// the Connectivity Directory Admin role
// (https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/).

/** The account, and the token its calls are made with. */
export type Api = {
  account: string
  token: string
  /** the fetch the calls go through; the global one when left out */
  fetch?: (url: string, init: RequestInit) => Promise<Response>
}

/** A tunnel as made: its id, and the token `cloudflared` runs it with. */
export type Made = { id: string; token: string }

/** What a machine is linked by: the tunnel, and the VPC Service behind it. */
export type Link = { tunnel: string; service: string }

/** Where a VPC Service sends a Worker's requests: a port on the machine, and
 * the address it listens on there (`127.0.0.1` unless said). */
export type Target = { port: number; host?: string }

type Envelope = {
  success?: boolean
  errors?: { message?: string }[]
  result?: unknown
}

/** One call, and what it answered, or the sentence Cloudflare refused it
 * with. Every reply is wrapped `{success, errors, result}`, so a failure is
 * read out of the body and not only off the status. */
let call = async (
  api: Api,
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> => {
  let r = await (api.fetch ?? fetch)(
    `https://api.cloudflare.com/client/v4/accounts/${api.account}${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${api.token}`,
        ...body === undefined ? {} : { 'content-type': 'application/json' },
      },
      ...body === undefined ? {} : { body: JSON.stringify(body) },
    },
  )
  let text = await r.text()
  let said: Envelope | null = null
  try {
    said = JSON.parse(text)
  } catch {
    // not JSON: the status and the text say it
  }
  if (r.ok && said?.success) return said.result
  let why = said?.errors?.map((e) => e.message).filter(Boolean).join('; ')
  throw new Error(`cloudflare: ${why || text.slice(0, 400) || r.status}`)
}

let field = (v: unknown, name: string): string => {
  let got = (v as Record<string, unknown> | null)?.[name]
  if (typeof got != 'string' || !got) {
    throw new Error(`cloudflare: the answer named no ${name}`)
  }
  return got
}

/** A tunnel secret: 32 random bytes, base64, the size Cloudflare asks for. */
let secret = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))

/** The account's Cloudflare Tunnels, each run by `cloudflared` with its
 * token and configured from the account rather than a file on the machine. */
export let tunnels = (api: Api) => ({
  /** A new tunnel, and the token to run it with. */
  create: async (name: string): Promise<Made> => {
    let r = await call(api, 'POST', '/cfd_tunnel', {
      name,
      config_src: 'cloudflare',
    })
    return { id: field(r, 'id'), token: field(r, 'token') }
  },
  /** The token a tunnel runs with now. */
  token: async (id: string): Promise<string> => {
    let r = await call(api, 'GET', `/cfd_tunnel/${id}/token`)
    if (typeof r != 'string' || !r) {
      throw new Error('cloudflare: the answer named no token')
    }
    return r
  },
  /** A new token for the tunnel. The old one opens no new connection, and a
   * connector already running keeps going until it restarts. */
  rotate: async (id: string): Promise<string> =>
    field(
      await call(api, 'PATCH', `/cfd_tunnel/${id}`, {
        tunnel_secret: secret(),
      }),
      'token',
    ),
  /** The tunnel gone. One that is already gone is not a failure. */
  remove: (id: string): Promise<void> =>
    gone(call(api, 'DELETE', `/cfd_tunnel/${id}`)),
})

/** The account's Workers VPC Services, each one host and port behind one
 * tunnel. */
export let services = (api: Api) => ({
  /** A new HTTP service behind a tunnel; answers its id. */
  create: async (
    name: string,
    tunnel: string,
    to: Target,
  ): Promise<string> =>
    field(
      await call(api, 'POST', '/connectivity/directory/services', {
        type: 'http',
        name,
        http_port: to.port,
        host: { ipv4: to.host ?? '127.0.0.1', network: { tunnel_id: tunnel } },
      }),
      'service_id',
    ),
  /** The service gone. One that is already gone is not a failure. */
  remove: (id: string): Promise<void> =>
    gone(call(api, 'DELETE', `/connectivity/directory/services/${id}`)),
})

// A delete of something already deleted has done what was asked.
let gone = async (p: Promise<unknown>): Promise<void> => {
  try {
    await p
  } catch (e) {
    if (!/not found|does not exist|404/i.test(String(e))) throw e
  }
}

/**
 * A machine linked: a tunnel, and a VPC Service behind it on `to`. Answers
 * both ids and the token. A service that cannot be made takes its tunnel
 * with it, so a failure leaves nothing behind in the account.
 */
export let connect = async (
  api: Api,
  name: string,
  to: Target,
): Promise<Link & { token: string }> => {
  let made = await tunnels(api).create(name)
  try {
    let service = await services(api).create(name, made.id, to)
    return { tunnel: made.id, service, token: made.token }
  } catch (e) {
    await tunnels(api).remove(made.id)
    throw e
  }
}

/** A machine unlinked: the service first, since it names the tunnel. */
export let disconnect = async (api: Api, link: Link): Promise<void> => {
  await services(api).remove(link.service)
  await tunnels(api).remove(link.tunnel)
}
