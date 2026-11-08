// Brokers: services that hold an OAuth grant for us and hand back a fresh
// access token. A broker signs a person in through its own app with the
// service (Nango's CASA-verified Google app, for Gmail), keeps the refresh
// token, and answers the current access token when asked. Our egress still
// sends that token straight to the integration's hosts: a broker is a source
// of credentials, never a proxy.
//
// An integration names its broker as data (`integration.broker{name,
// integration}`), and a connection made through one says so
// (`connection.broker`), so swapping an integration's broker changes no
// caller and leaves every connection working through what made it. A broker
// is implemented once, here, and each integration it serves is a row. Its key
// is the secret `broker <name>`, kept the way an OAuth client is.

import { reveal, sealed, type Vault } from '@yaks/secrets'
import type { Bundle } from '@yaks/graph'

/** What a broker answers for a connection: its access token, when it
 * expires (epoch milliseconds), what it grants, and an id token or address
 * naming the account where the broker knows one. */
export type Grant = {
  access_token: string
  expires_at?: number
  scopes?: string[]
  id_token?: string
  account?: string
}

/** A broker's refusal. `refused` is the broker saying the grant is gone or
 * revoked, which means connect again; anything else is a failure on the wire
 * or of our own key. */
export class BrokerError extends Error {
  status: number
  refused: boolean
  constructor(status: number, message: string) {
    super(message)
    this.name = 'BrokerError'
    this.status = status
    this.refused = status >= 400 && status < 500 &&
      ![401, 403, 429].includes(status)
  }
}

/** One broker, for the integration it calls `integration`, and our
 * connection's eid as the tag it finds a sign-in by. */
export type Broker = {
  /** the link a person follows to sign in for connection `eid` */
  begin(integration: string, eid: string): Promise<string>
  /** the broker's own id for the sign-in made for `eid`, once one finished */
  found(integration: string, eid: string): Promise<string | undefined>
  /** the grant's current token, refreshed by the broker when it is due, or
   * at once with `fresh` */
  grant(integration: string, id: string, fresh?: boolean): Promise<Grant>
  /** end the broker's connection; one already gone is no failure */
  forget(integration: string, id: string): Promise<void>
}

type Fetch = typeof fetch

let NANGO = 'https://api.nango.dev'

let strs = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map(String)
    : typeof v == 'string'
    ? v.split(/[\s,]+/).filter(Boolean)
    : []

/** Nango (nango.dev), reached with an environment's secret key. */
export let nango = (key: string, fetcher: Fetch = fetch): Broker => {
  let ask = async (path: string, init: RequestInit = {}) => {
    let res = await fetcher(`${NANGO}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    })
    let body = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!res.ok) {
      let error = body.error as Record<string, unknown> | string | undefined
      let said = typeof error == 'string'
        ? error
        : error?.message ?? error?.code
      throw new BrokerError(
        res.status,
        `Nango refused ${init.method ?? 'GET'} ${
          path.split('?')[0]
        }: ${res.status}${said ? ` ${said}` : ''}`,
      )
    }
    return body
  }
  let of = (integration: string) =>
    `provider_config_key=${encodeURIComponent(integration)}`
  return {
    begin: async (integration, eid) => {
      let made = await ask('/connect/sessions', {
        method: 'POST',
        body: JSON.stringify({
          tags: { end_user_id: eid },
          allowed_integrations: [integration],
        }),
      })
      let link = ((made.data ?? made) as Record<string, unknown>).connect_link
      if (typeof link != 'string') {
        throw new Error('Nango answered no connect link')
      }
      return link
    },
    found: async (integration, eid) => {
      let q = new URLSearchParams({
        'tags[end_user_id]': eid,
        integrationId: integration,
      })
      let { connections } = await ask(`/connections?${q}`) as {
        connections?: Record<string, unknown>[]
      }
      let mine = (connections ?? [])
        .filter((c) =>
          c.provider_config_key == integration &&
          (c.tags as Record<string, unknown> | undefined)?.end_user_id == eid
        )
        .sort((a, b) => String(b.created).localeCompare(String(a.created)))
      return mine[0] ? String(mine[0].connection_id) : undefined
    },
    grant: async (integration, id, fresh) => {
      let c = await ask(
        `/connections/${encodeURIComponent(id)}?${of(integration)}${
          fresh ? '&force_refresh=true' : ''
        }`,
      )
      let creds = (c.credentials ?? {}) as Record<string, unknown>
      let raw = (creds.raw ?? {}) as Record<string, unknown>
      if (typeof creds.access_token != 'string') {
        throw new Error(`Nango holds no access token for ${integration}`)
      }
      let at = Date.parse(String(creds.expires_at ?? ''))
      let config = {
        ...c.metadata as Record<string, unknown> ?? {},
        ...c.connection_config as Record<string, unknown> ?? {},
      }
      let account = [config.emailAddress, config.email]
        .find((a) => typeof a == 'string' && a.includes('@')) as
          | string
          | undefined
      return {
        access_token: creds.access_token,
        ...isNaN(at) ? {} : { expires_at: at },
        ...raw.scope ? { scopes: strs(raw.scope) } : {},
        ...typeof raw.id_token == 'string' ? { id_token: raw.id_token } : {},
        ...account ? { account: account.toLowerCase() } : {},
      }
    },
    forget: async (integration, id) => {
      try {
        await ask(`/connections/${encodeURIComponent(id)}?${of(integration)}`, {
          method: 'DELETE',
        })
      } catch (e) {
        if (!(e instanceof BrokerError && e.status == 404)) throw e
      }
    },
  }
}

/** The brokers this package implements, by the name an integration gives. */
export let BROKERS: Record<string, (key: string, f?: Fetch) => Broker> = {
  nango,
}

// The name a broker's key is kept under among the graph's secrets.
let keptAs = (name: string) => `broker ${name}`

/** The bundle that keeps a broker's key: the vault holds it, and the graph
 * its handle. */
export let brokerKey = (name: string, key: string): Bundle =>
  sealed(keptAs(name), key)

/** The broker named `name`, ready to ask, once its key is kept; none while it
 * is not, or for a name this package does not implement. */
export let brokerOf = async (
  vault: Vault,
  name: string,
  fetcher?: Fetch,
): Promise<Broker | undefined> => {
  let make = BROKERS[name]
  if (!make) return undefined
  let key = await reveal(vault, keptAs(name), { env: () => undefined })
  return key ? make(key, fetcher) : undefined
}
