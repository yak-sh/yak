// Connected agents are a view of the OAuth provider's surviving grants.
// Callback hosts identify web clients; local and older clients use their
// registered names. Multiple installations of one agent share one entry.
// A grant a re-authorization replaces is revoked here too, once the new one
// is in the client's hands (`replace`), and the person disconnects an entry
// by revoking the grants it stands for (`disconnect`).
//
// A service that signs in the way an agent does is not one: Zapier holds a
// yaks.app grant as a space holds a Google Calendar token, so its grant is a
// connection (D-38019), known by the host its callback returns to and listed
// by `servicesOf`, never by `agentsOf`.
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

// Which listed agent a grant stands for, or nothing: a service's grant
// (`servicesOf`) and one whose registration is gone are no agent. Each
// client is looked up once however many grants it holds.
let identifier = (oauth: Pick<Clients, 'lookupClient'>) => {
  let clients = new Map<string, Promise<ClientInfo | null | undefined>>()
  let lookup = (id: string) => {
    let client = clients.get(id) ?? oauth.lookupClient(id)
    clients.set(id, client)
    return client
  }
  return async (grant: GrantSummary) => {
    if (serviceOf(grant.redirectUri)) return
    let host = callback(grant.redirectUri)
    let brand = host.brand
    let client: ClientInfo | null | undefined
    if (!brand) {
      client = await lookup(grant.clientId)
      if (client === null) return
      if (host.local) brand = named(client?.clientName)
    }
    return {
      id: brand ?? grant.clientId,
      name: brand ? names[brand] : client?.clientName?.trim() || 'Other agent',
      ...(brand ? { brand } : {}),
    }
  }
}

export let agentsOf = async (
  oauth: Clients,
  person: string,
  now = Math.floor(Date.now() / 1000),
): Promise<Agent[]> => {
  let which = identifier(oauth)
  let found = new Map<string, Agent>()
  for await (let grant of live(oauth, person, now)) {
    let agent = await which(grant)
    if (!agent) continue
    let previous = found.get(agent.id)
    found.set(agent.id, {
      ...agent,
      connectedAt: Math.min(grant.createdAt, previous?.connectedAt ?? Infinity),
    })
  }
  return [...found.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  )
}

/**
 * Disconnects one listed agent: revokes every grant the person holds that
 * `agentsOf` folds into the entry `agent` names, and no other, a service's
 * least of all. Answers the grants revoked. A revocation that fails throws:
 * the person asked for it, and must not be told it is done.
 */
export let disconnect = async (
  oauth: Clients & Pick<OAuthHelpers, 'revokeGrant'>,
  person: string,
  agent: string,
) => {
  let which = identifier(oauth)
  let gone: string[] = []
  for await (let grant of live(oauth, person, 0)) {
    if ((await which(grant))?.id == agent) gone.push(grant.id)
  }
  await Promise.all(gone.map((id) => oauth.revokeGrant(id, person)))
  return gone
}

// A client named by the URL of its metadata document (CIMD) is one id for
// every account that uses it: every ChatGPT signs in as
// https://chatgpt.com/oauth/client.json. A registered client's id is its own.
let shared = (clientId: string) => clientId.startsWith('https://')

/**
 * The grants a newly exchanged one replaces: the person's others from the
 * same client, and for a shared client only those returning to the same
 * callback, the library's own rule for re-authorization.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * let g = (id: string, clientId: string, redirectUri?: string) =>
 *   ({ id, clientId, redirectUri, userId: 'p', createdAt: 0, metadata: {},
 *     scope: [] })
 * let mine = g('new', 'abc')
 * assertEquals(superseded([g('old', 'abc'), g('other', 'xyz'), mine], mine),
 *   ['old'])
 * let gpt = 'https://chatgpt.com/oauth/client.json'
 * let here = g('new', gpt, 'https://chatgpt.com/cb/1')
 * assertEquals(superseded([g('old', gpt, 'https://chatgpt.com/cb/1'),
 *   g('elsewhere', gpt, 'https://chatgpt.com/cb/2'), here], here), ['old'])
 * ```
 */
export let superseded = (grants: GrantSummary[], mine: GrantSummary) =>
  grants.filter((g) =>
    g.id != mine.id && g.clientId == mine.clientId &&
    (!shared(mine.clientId) || g.redirectUri == mine.redirectUri)
  ).map((g) => g.id)

// Re-authorizing a client replaces the person's older grant for it, but only
// once the new grant's code is exchanged. The library would revoke at consent
// instead (`revokeExistingGrants`), before the client has the new grant: an
// exchange that then fails, or a sign-in abandoned at the client, left the
// person with neither, and their assistant could no longer reach yaks.app
// with nothing on our side to say so (T-121901). A revocation that fails is
// left standing; it is a grant the person still holds, not a broken one.
export let replace = async (
  oauth: Pick<OAuthHelpers, 'listUserGrants' | 'revokeGrant'>,
  person: string,
  grantId: string,
) => {
  let grants: GrantSummary[] = []
  for await (let grant of live(oauth, person, 0)) grants.push(grant)
  let mine = grants.find((g) => g.id == grantId)
  let gone = mine ? superseded(grants, mine) : []
  await Promise.allSettled(gone.map((id) => oauth.revokeGrant(id, person)))
  return gone
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
