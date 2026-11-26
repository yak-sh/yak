/**
 * The agents a person connected, as the tab's page graph holds them (D-475
 * step 5), which the Agents and New app pages (./agents-view.ts) and the Apps
 * page's connect card (./space-apps-view.ts) are drawn from:
 *
 * - `agentsConnected{agents}`: the person's one row, each agent connected
 *   `{id, name, brand}`, in the order listed. No store holds it: the page
 *   graph's door reads it from the person's OAuth grants (yaks.app's
 *   connected.ts `agentsOf`), and again each time their grants move. Until it
 *   is in, what depends on it stays unsettled (./page-parts.ts `state`).
 * - `disconnectAgent{agent, said}`: a press of Disconnect, which the door
 *   does as the person, revoking every grant the agent `agent` stands for,
 *   and answers with what it came to and the row read again.
 * - `agentGrant{id, client, created}`: each grant the person holds, as the
 *   directory lists it, live (`GRANTS`). The door watches it to read the
 *   agents again as one is connected or disconnected.
 *
 * @module
 */
import type { Bundle } from '@yaks/graph'
import { derivedEid } from '@yaks/graph/identity'
import type { VocabDoc } from '@yaks/vocab'

/** The agents named by who they are, not by what they called themselves. */
export type Brand = 'chatgpt' | 'claude' | 'claude-code' | 'cursor'

/** One agent connected, as the pages list it. */
export type Agent = { id: string; name: string; brand?: Brand }

/** The agents the person connected. */
export let AGENTS = '.agentsConnected'

/** The grants the person holds, which move as an agent connects or
 * disconnects. */
export let GRANTS = '.agentGrant'

/** A grant as the directory lists it: no secret of it, only which it is. */
export type Grant = { id: string; client: string; created: number }

let NAMES: Record<Brand, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
}

let branded = (name = ''): Brand | undefined => {
  switch (name.trim().toLowerCase().replaceAll(/[-_]/g, ' ')) {
    case 'chatgpt':
      return 'chatgpt'
    case 'claude':
    case 'claude ai':
    case 'claude.ai':
    case 'claude desktop':
      return 'claude'
    case 'claude code':
      return 'claude-code'
    case 'cursor':
      return 'cursor'
  }
}

// The brand a callback's host names, or `local` for a client on the person's
// own machine, which can only be known by the name it gives.
let hosted = (uri: string | undefined): { brand?: Brand; local?: boolean } => {
  if (!uri) return { local: true }
  try {
    let url = new URL(uri)
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      return { local: true }
    }
    if (url.protocol == 'https:') {
      if (['chatgpt.com', 'chat.openai.com'].includes(url.hostname)) {
        return { brand: 'chatgpt' }
      }
      if (['claude.ai', 'claude.com'].includes(url.hostname)) {
        return { brand: 'claude' }
      }
    }
  } catch { /* An invalid callback cannot identify an agent. */ }
  return {}
}

/**
 * What an agent is called, as the person's connections name it, from what
 * its OAuth grant keeps: the host its callback returns to, else the name the
 * client gave itself (at consent, or at an MCP `initialize`). A known agent
 * is named by its brand; any other by its own name, or none.
 *
 * ```ts
 * import { assertEquals } from '@std/assert'
 * assertEquals(agentCalled('https://claude.ai/api/mcp/auth_callback'), { brand: 'claude', name: 'Claude' })
 * assertEquals(agentCalled(undefined, 'claude-code'), { brand: 'claude-code', name: 'Claude Code' })
 * assertEquals(agentCalled(undefined, ' Zed '), { name: 'Zed' })
 * assertEquals(agentCalled('https://example.com/cb'), {})
 * ```
 */
export let agentCalled = (
  redirect?: string,
  name?: string,
): { brand?: Brand; name?: string } => {
  let host = hosted(redirect)
  let brand = host.brand ?? (host.local ? branded(name) : undefined)
  if (brand) return { brand, name: NAMES[brand] }
  return name?.trim() ? { name: name.trim() } : {}
}

/** Where an agent with a web app is opened, to ask it for an app there. */
export let DESTINATIONS: Partial<
  Record<Brand, { href: string; label: string }>
> = {
  chatgpt: { href: 'https://chatgpt.com/', label: 'Open ChatGPT' },
  claude: { href: 'https://claude.ai/new', label: 'Open Claude' },
}

let strings = { type: 'string' }

export let agentsWords: VocabDoc = {
  $defs: {
    agentsConnected: {
      component: true,
      type: 'object',
      properties: { agents: { type: 'array', items: { type: 'object' } } },
      required: ['agents'],
    },
    agentGrant: {
      component: true,
      type: 'object',
      properties: {
        id: strings,
        client: strings,
        created: { type: 'integer' },
      },
      required: ['id', 'client', 'created'],
    },
    disconnectAgent: {
      component: true,
      type: 'object',
      properties: { agent: strings, said: strings },
      required: ['agent'],
    },
  },
}

/** The agents `person` connected, as their row. */
export let agentsRow = (person: string, agents: Agent[]): Bundle => ({
  entity: { eid: derivedEid(`agents-connected|${person}`) },
  agentsConnected: {
    agents: agents.map(({ id, name, brand }) => ({
      id,
      name,
      ...brand ? { brand } : {},
    })),
  },
})

/** The grants `person` holds, as their rows. */
export let grantRows = (person: string, grants: Grant[]): Bundle[] =>
  grants.map(({ id, client, created }) => ({
    entity: { eid: derivedEid(`agent-grant|${person}|${id}`) },
    agentGrant: { id, client, created },
  }))

/** The agents `rows` say the person connected, or undefined until the row is
 * in. */
export let agentsOf = (rows: Bundle[]): Agent[] | undefined =>
  (rows.find((r) => r.agentsConnected)?.agentsConnected as
    | { agents: Agent[] }
    | undefined)?.agents

/** The agent `bundles` disconnect, when they are one press of Disconnect;
 * else undefined. */
export let disconnecting = (bundles: Bundle[]): string | undefined =>
  bundles.length == 1
    ? (bundles[0].disconnectAgent as { agent?: string } | undefined)?.agent
    : undefined
