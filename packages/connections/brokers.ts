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
import type { Field } from './integrations.ts'

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

/** A service a broker can connect, as its catalog lists it: what the broker
 * calls it, what a person calls it, the address of its logo (an SVG), the
 * kinds of service it is, and the API hosts a credential for it goes to
 * (none where they depend on the account). `connects` is how: signing in
 * through the broker's own app with the service, giving the broker an OAuth
 * client of the person's own, or a key, as the `fields` it names (none is
 * one key). `instructions` say, in markdown, what each field is. `popular` is
 * one the broker features. */
export type Listing = {
  name: string
  title: string
  logo: string
  categories: string[]
  hosts: string[]
  connects: 'signin' | 'client' | 'key'
  fields?: Field[]
  instructions?: string
  popular?: boolean
}

/** One broker, for the integration it calls `integration`, and our
 * connection's eid as the tag it finds a sign-in by. */
export type Broker = {
  /** every service it can connect: one it signs in to and hands back an
   * access token for, or one reached with a plain key */
  catalog(): Promise<Listing[]>
  /** make ready to sign people in to the service it calls `integration`, as
   * `listing` says it connects; one already ready is left as it is */
  enable(integration: string, connects: Listing['connects']): Promise<void>
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

// How Nango says a service is reached, as what a connection through it is:
// a sign-in its own app makes (a Nango-managed OAuth app), one with the
// person's own OAuth client, or a key. Nango hands back an access token for
// the first two, and a key is ours to keep. Any other way is left out.
let CONNECTS: Record<string, Listing['connects']> = {
  OAUTH2: 'signin',
  OAUTH2_CC: 'client',
  API_KEY: 'key',
  BASIC: 'key',
}

// Nango's own categories that say nothing of what a service is.
let UNSAID = new Set(['popular', 'other', 'mcp'])

// A credential's name as a field's: Nango's apiKey is api_key.
let snake = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/^_/, '')

// A field typed in the open, where its name and its label both say so.
let OPEN = /^(username|user|email|region|account|subdomain)$/

type Provider = {
  name: string
  display_name: string
  logo_url?: string
  categories?: string[]
  auth_mode?: string
  proxy?: { base_url?: string }
  credentials?: Record<string, { title?: string; description?: string }>
}

/** A Nango provider (GET /providers) as the listing it is, or none where
 * Nango hands back nothing a connection here can use. Its hosts are its API's,
 * none where the account names them (`${connectionConfig.subdomain}`). */
export let listingOf = (p: Provider): Listing | undefined => {
  let connects = CONNECTS[p.auth_mode ?? '']
  if (!connects || !p.name || !p.display_name) return undefined
  let base = p.proxy?.base_url ?? ''
  let host = !base.includes('${') && URL.canParse(base)
    ? new URL(base).hostname
    : ''
  let given = connects == 'key' ? Object.entries(p.credentials ?? {}) : []
  let fields = given.map(([name, f]): Field => {
    let label = f.title || name
    let shown = OPEN.test(name) && !/key|secret|token|password/i.test(label)
    return { name: snake(name), label, ...shown ? { shown } : {} }
  })
  let said = given.filter(([, f]) => f.description)
    .map(([name, f]) => `- **${f.title || name}**: ${f.description}`)
  return {
    name: p.name,
    title: p.display_name,
    logo: p.logo_url ?? '',
    categories: (p.categories ?? []).filter((c) => !UNSAID.has(c)),
    hosts: host ? [host] : [],
    connects,
    ...fields.length > 1 ? { fields } : {},
    ...said.length ? { instructions: said.join('\n') } : {},
    ...p.categories?.includes('popular') ? { popular: true } : {},
  }
}

// Where a logo a broker names is also kept: Nango's CDN can answer a missing
// one with its web app's page, and cache that error for hours, so the same
// file in Nango's repository stands behind it.
let MIRRORS: [from: string, to: string][] = [[
  'https://app.nango.dev/images/template-logos/',
  'https://raw.githubusercontent.com/NangoHQ/nango/master/packages/webapp/public/images/template-logos/',
]]

/** Every address a listing's logo may be fetched from, its own first. */
/// logoSources('https://logos.example/hub.svg') -> ['https://logos.example/hub.svg']
export let logoSources = (at: string): string[] => [
  at,
  ...MIRRORS.filter(([from]) => at.startsWith(from))
    .map(([from, to]) => to + at.slice(from.length)),
]

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
    catalog: async () => {
      let { data } = await ask('/providers') as { data?: Provider[] }
      return (data ?? []).flatMap((p) => listingOf(p) ?? [])
    },
    enable: async (integration, connects) => {
      let at = `/integrations/${encodeURIComponent(integration)}`
      try {
        await ask(at)
        return
      } catch (e) {
        if (!(e instanceof BrokerError && e.status == 404)) throw e
      }
      // A sign-in goes through Nango's own app with the service; a client
      // of the person's own, or a key, is given when they connect.
      await ask('/integrations', {
        method: 'POST',
        body: JSON.stringify({
          unique_key: integration,
          provider: integration,
          ...connects == 'signin'
            ? { credentials: { type: 'NANGO_MANAGED' } }
            : {},
        }),
      })
    },
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
