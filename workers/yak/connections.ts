// Connected chatbots are a view of the OAuth provider's surviving grants.
// Callback hosts identify web clients; local and older clients use their
// registered names. Multiple installations of one chatbot share one entry.
import type {
  ClientInfo,
  GrantSummary,
  OAuthHelpers,
} from '@cloudflare/workers-oauth-provider'

export type Provider = 'chatgpt' | 'claude' | 'claude-code' | 'cursor'
export type Connection = {
  id: string
  name: string
  provider?: Provider
  connectedAt: number
}

let names: Record<Provider, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
}

let named = (name = ''): Provider | undefined => {
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
        return { provider: 'chatgpt' as Provider }
      }
      if (['claude.ai', 'claude.com'].includes(url.hostname)) {
        return { provider: 'claude' as Provider }
      }
    }
  } catch { /* An invalid callback cannot identify a chatbot. */ }
  return {}
}

export let connectionsOf = async (
  oauth: Pick<OAuthHelpers, 'listUserGrants' | 'lookupClient'>,
  person: string,
  now = Math.floor(Date.now() / 1000),
): Promise<Connection[]> => {
  let clients = new Map<string, Promise<ClientInfo | null>>()
  let found = new Map<string, Connection>()
  let identify = async (grant: GrantSummary) => {
    let host = callback(grant.redirectUri)
    let provider = host.provider
    let client: ClientInfo | null = null
    if (!provider) {
      let lookup = clients.get(grant.clientId)
      if (!lookup) {
        lookup = oauth.lookupClient(grant.clientId)
        clients.set(grant.clientId, lookup)
      }
      client = await lookup
      if (!client) return
      if (host.local) provider = named(client.clientName)
    }
    let id = provider ?? grant.clientId
    let previous = found.get(id)
    found.set(id, {
      id,
      name: provider
        ? names[provider]
        : client?.clientName?.trim() || 'Other chatbot',
      ...(provider ? { provider } : {}),
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
