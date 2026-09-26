// Connected agents are a view of the OAuth provider's surviving grants.
// Callback hosts identify web clients; local and older clients use their
// registered names. Multiple installations of one agent share one entry.
//
// A service that signs in the way an agent does is not one: Zapier holds a
// yaks.app grant as a space holds a Google Calendar token, so its grant is a
// connection (D-38019), known by the host its callback returns to and listed
// by `servicesOf`, never by `agentsOf`.
// @ts-types="npm:@cloudflare/workers-oauth-provider@0.10.3"
import type {
  ClientInfo,
  GrantSummary,
  OAuthHelpers,
} from '@cloudflare/workers-oauth-provider'

export type Brand = 'chatgpt' | 'claude' | 'claude-code' | 'cursor'
export type Agent = {
  id: string
  name: string
  brand?: Brand
  connectedAt: number
}
/** An outside service holding a grant, as the connections page lists it. */
export type Service = { name: string; connectedAt: number }

type Clients = Pick<OAuthHelpers, 'listUserGrants'> & {
  // Missing registrations are null; unavailable metadata is undefined. The
  // latter still has a grant and must not disappear during a client outage.
  lookupClient: (id: string) => Promise<ClientInfo | null | undefined>
}

let names: Record<Brand, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
}

let named = (name = ''): Brand | undefined => {
  switch (name.trim().toLowerCase().replaceAll(/[-_]/g, ' ')) {
    case 'chatgpt':
      return 'chatgpt'
    case 'claude':
    case 'claude.ai':
    case 'claude desktop':
      return 'claude'
    case 'claude code':
      return 'claude-code'
    case 'cursor':
      return 'cursor'
  }
}

// The services, by the host their callback returns to.
let SERVICES: Record<string, string> = { 'zapier.com': 'Zapier' }

let serviceOf = (uri: string | undefined): string | undefined => {
  try {
    let url = new URL(uri ?? '')
    return url.protocol == 'https:' ? SERVICES[url.hostname] : undefined
  } catch {
    return undefined
  }
}

// Every grant still standing, page by page.
let live = async function* (
  oauth: Pick<Clients, 'listUserGrants'>,
  person: string,
  now: number,
) {
  let cursor: string | undefined
  do {
    let page = await oauth.listUserGrants(person, { cursor, limit: 100 })
    for (let grant of page.items) {
      if (grant.expiresAt === undefined || grant.expiresAt > now) yield grant
    }
    cursor = page.cursor
  } while (cursor)
}

let callback = (uri: string | undefined) => {
  if (!uri) return { local: true }
  try {
    let url = new URL(uri)
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      return { local: true }
    }
    if (url.protocol == 'https:') {
      if (['chatgpt.com', 'chat.openai.com'].includes(url.hostname)) {
        return { brand: 'chatgpt' as Brand }
      }
      if (['claude.ai', 'claude.com'].includes(url.hostname)) {
        return { brand: 'claude' as Brand }
      }
    }
  } catch { /* An invalid callback cannot identify an agent. */ }
  return {}
}

export let agentsOf = async (
  oauth: Clients,
  person: string,
  now = Math.floor(Date.now() / 1000),
): Promise<Agent[]> => {
  let clients = new Map<string, Promise<ClientInfo | null | undefined>>()
  let found = new Map<string, Agent>()
  let identify = async (grant: GrantSummary) => {
    let host = callback(grant.redirectUri)
    let brand = host.brand
    let client: ClientInfo | null | undefined
    if (!brand) {
      let lookup = clients.get(grant.clientId)
      if (!lookup) {
        lookup = oauth.lookupClient(grant.clientId)
        clients.set(grant.clientId, lookup)
      }
      client = await lookup
      if (client === null) return
      if (host.local) brand = named(client?.clientName)
    }
    let id = brand ?? grant.clientId
    let previous = found.get(id)
    found.set(id, {
      id,
      name: brand ? names[brand] : client?.clientName?.trim() || 'Other agent',
      ...(brand ? { brand } : {}),
      connectedAt: Math.min(grant.createdAt, previous?.connectedAt ?? Infinity),
    })
  }
  for await (let grant of live(oauth, person, now)) {
    if (!serviceOf(grant.redirectUri)) await identify(grant)
  }
  return [...found.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  )
}

/** The services holding a grant from this person, one entry per service. */
export let servicesOf = async (
  oauth: Pick<Clients, 'listUserGrants'>,
  person: string,
  now = Math.floor(Date.now() / 1000),
): Promise<Service[]> => {
  let found = new Map<string, number>()
  for await (let grant of live(oauth, person, now)) {
    let name = serviceOf(grant.redirectUri)
    if (name) {
      found.set(name, Math.min(grant.createdAt, found.get(name) ?? Infinity))
    }
  }
  return [...found].sort(([a], [b]) => a.localeCompare(b))
    .map(([name, connectedAt]) => ({ name, connectedAt }))
}
