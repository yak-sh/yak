/** Persisted MCP server definitions. Connections and credentials are not graph data. */
import type { Bundle, Comp } from '@yaks/graph'
import type { VocabDoc } from '@yaks/vocab'
import { nameOf, type Server } from './mod.ts'

export const mcpDoc: VocabDoc = {
  title: 'mcp-client',
  $defs: {
    mcp_server: {
      type: 'object',
      description:
        'A shared remote MCP server; its entity ID is its tool namespace.',
      properties: {
        name: {
          type: 'string',
          description: 'Display name, not credential identity.',
        },
        url: {
          type: 'string',
          description: 'Streamable HTTP endpoint without embedded credentials.',
        },
        enabled: {
          type: 'boolean',
          description: 'False disables discovery; omission enables it.',
        },
        credential: {
          type: 'string',
          description:
            'Optional host credential-store reference, never a token.',
        },
        allow: {
          type: 'string',
          description:
            'Optional JSON array of exact remote tool names; [] exposes none.',
        },
        redirect_url: { type: 'string' },
        client_id: { type: 'string' },
        client_metadata_url: { type: 'string' },
        scope: { type: 'string' },
      },
    },
  },
}

export type GraphServer = { id: string; label: string; server: Server }

/** Validate one definition before connecting. Invalid rows need not block other servers. */
export const serverOf = (row: Bundle): GraphServer | undefined => {
  const c = row.mcp_server as Comp | undefined
  if (!c || (c.enabled === false || c.enabled === 0)) return undefined
  if (
    typeof c.url !== 'string' || typeof c.name !== 'string' || !c.name.trim()
  ) {
    throw new Error('MCP server requires a name and URL')
  }
  let url: URL
  try {
    url = new URL(c.url)
  } catch {
    throw new Error('Invalid MCP URL')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) || url.username || url.password
  ) {
    throw new Error('MCP URL must be HTTP(S) without embedded credentials')
  }
  if (c.credential && c.credential !== url.hostname) {
    throw new Error('MCP credential host must match the server hostname')
  }
  let allow: string[] | undefined
  if (c.allow != null) {
    const value = JSON.parse(String(c.allow))
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
      throw new Error('MCP allow must be a JSON array of tool names')
    }
    allow = value
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
      url: url.href,
      ...allow ? { allow } : {},
      ...c.credential ? { credential: String(c.credential) } : {},
      ...Object.keys(oauth!).length ? { oauth } : {},
    },
  }
}

/** Connection revisions prevent a later edit from retargeting already-issued calls. */
export const graphToolName = (
  id: string,
  server: Server,
  remote: string,
): Promise<string> =>
  nameOf(
    id,
    JSON.stringify([
      server.url,
      server.credential ?? null,
      server.allow ?? null,
      server.oauth ?? null,
      remote,
    ]),
  )
