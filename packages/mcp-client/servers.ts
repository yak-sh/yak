/** Persisted MCP server definitions. Connections and credentials are not graph data. */
import type { Bundle, Comp } from '@yaks/graph'
import { MACHINE, nameOf, namespaceOf, type Server } from './mod.ts'

export type GraphServer = { id: string; label: string; server: Server }

// Headers the transport, the protocol or the browser own, which a credential
// never replaces.
const OWNED = new Set([
  'accept',
  'connection',
  'content-length',
  'content-type',
  'cookie',
  'host',
  'last-event-id',
  'mcp-protocol-version',
  'mcp-session-id',
  'origin',
  'transfer-encoding',
])
/** Whether a credential may be sent in the header `name`. */
export const credentialHeader = (name: string): boolean =>
  /^[A-Za-z0-9-]+$/.test(name) && !OWNED.has(name.toLowerCase())

/** Validate one definition before connecting. Invalid rows need not block other servers. */
export const serverOf = (row: Bundle): GraphServer | undefined => {
  const c = row.mcp_server as Comp | undefined
  if (!c || c.enabled === false) return undefined
  if (
    typeof c.url !== 'string' || typeof c.name !== 'string' || !c.name.trim()
  ) {
    throw new Error('MCP server requires a name and URL')
  }
  const machine = c.machine == null ? undefined : String(c.machine)
  let url: URL
  try {
    url = machine ? new URL(c.url, MACHINE) : new URL(c.url)
  } catch {
    throw new Error('Invalid MCP URL')
  }
  if (machine && (!c.url.startsWith('/') || url.origin !== MACHINE)) {
    throw new Error(
      'An MCP server on a machine needs its path there, such as /mcp',
    )
  }
  if (
    !['http:', 'https:'].includes(url.protocol) || url.username || url.password
  ) {
    throw new Error('MCP URL must be HTTP(S) without embedded credentials')
  }
  let allow: string[] | undefined
  if (c.allow != null) {
    const value = JSON.parse(String(c.allow))
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
      throw new Error('MCP allow must be a JSON array of tool names')
    }
    allow = value
  }
  const header = c.header == null ? undefined : String(c.header)
  if (header !== undefined && !credentialHeader(header)) {
    throw new Error(
      'MCP header must be a header name a credential may go in, such as X-API-Key',
    )
  }
  const oauth = Object.fromEntries([
    ['redirectUrl', c.redirect_url],
    ['clientId', c.client_id],
    ['clientMetadataUrl', c.client_metadata_url],
    ['scope', c.scope],
  ].filter(([, v]) => v != null)) as Server['oauth']
  return {
    id: row.entity.eid,
    label: c.name,
    server: {
      name: row.entity.eid,
      label: c.name,
      namespace: namespaceOf(c.name),
      url: url.href,
      ...machine ? { machine } : {},
      ...allow ? { allow } : {},
      ...header ? { header } : {},
      ...Object.keys(oauth!).length ? { oauth } : {},
    },
  }
}

/** Public names are readable; identity and connection revisions are separate. */
export const graphToolName = (
  _id: string,
  server: Server,
  remote: string,
): string => nameOf(server.namespace ?? server.name, remote)
