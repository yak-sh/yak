// Connected agents are a view of the OAuth provider's surviving grants.
// Callback hosts identify web clients; local and older clients use their
// registered names. Multiple installations of one agent share one entry.
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
  let cursor: string | undefined
  do {
    let page = await oauth.listUserGrants(person, { cursor, limit: 100 })
    for (let grant of page.items) {
      if (grant.expiresAt !== undefined && grant.expiresAt <= now) continue
      await identify(grant)
    }
    cursor = page.cursor
  } while (cursor)
  return [...found.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  )
}
