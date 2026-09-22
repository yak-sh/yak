/** Host-owned OAuth storage and reconnects. No authorization input enters a transcript. */
import {
  connect,
  type Connection,
  MCPAuthorizationRequired,
  type Server,
} from '@yaks/mcp-client'
import { type Authorization, authorization } from '@yaks/mcp-client/oauth'
import { fileAuthorizationStore } from '@yaks/mcp-client/host'
import { tokenFor } from '@yaks/cli'
import type { Tool } from '@yaks/graph'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { home } from './paths.ts'

/** A remote tool wearing the connection that listed it: `reply` is that
 * server's own endpoint, recorded, so an issued call never moves to a transport
 * opened after it. */
export type Remote = Tool & {
  reply: (args: Record<string, unknown>) => Promise<CallToolResult>
}

export type MCPAuthAction = 'list' | 'begin' | 'complete' | 'cancel'
export type MCPAuthReply = {
  servers?: string[]
  url?: string
  redirectUrl?: string
  message?: string
}
export const authorizedMCP = (
  servers: Server[],
  path = Deno.env.get('HARNESS_MCP_AUTH') ?? `${home()}/mcp-auth.json`,
) => {
  const store = fileAuthorizationStore(path)
  const auths = new Map<string, Authorization>()
  const connections = new Map<string, Connection>()
  const challenges = new Map<
    string,
    { resourceMetadataUrl?: string; scope?: string }
  >()
  const retired: Connection[] = []
  const getAuth = (s: Server) => {
    let a = auths.get(s.name)
    if (!a) {
      a = authorization({ serverUrl: s.url, ...s.oauth, store })
      auths.set(s.name, a)
    }
    return a
  }
  const get = (s: Server) => {
    let c = connections.get(s.name)
    if (!c) {
      c = connect(s, {
        token: async () =>
          await getAuth(s).token() ??
            (s.credential ? tokenFor(s.credential) : null),
      })
      connections.set(s.name, c)
    }
    return c
  }
  const control = async (
    action: MCPAuthAction,
    name = '',
    callback = '',
  ): Promise<MCPAuthReply> => {
    if (action === 'list') return { servers: servers.map((s) => s.name) }
    const s = servers.find((s) => s.name === name)
    if (!s) throw new Error('Unknown configured MCP server')
    const a = getAuth(s)
    if (action === 'cancel') {
      a.cancel()
      return { message: 'Authorization cancelled.' }
    }
    if (action === 'begin') {
      try {
        await get(s).list()
      } catch (error) {
        if (error instanceof MCPAuthorizationRequired) {
          challenges.set(s.name, error.challenge)
        } else throw error
      }
      return await a.begin(challenges.get(s.name))
    }
    if (action !== 'complete') throw new Error('Unknown authorization action')
    await a.complete(callback)
    const previous = connections.get(name)
    connections.delete(name)
    if (previous) retired.push(previous) // Already-issued calls keep their original handlers.
    await get(s).list()
    return {
      message: 'Connected. Tools will be available on the next request.',
    }
  }
  return {
    cancel: () => {
      for (const a of auths.values()) a.cancel()
    },
    control,
    // Each tool wearing the connection that listed it (`reply`). A tool on
    // another server is a request to that server, not a function this graph
    // holds, and the harness renders the reply whole — artifacts and all — so
    // it asks here rather than through the graph-tool projection. The capture
    // is the point: a call issued from an older listing keeps its original
    // transport even after a refresh replaced the connection.
    tools: async (): Promise<Remote[]> =>
      (await Promise.all(servers.map(async (s) => {
        try {
          const conn = get(s)
          return (await conn.tools()).map((tool): Remote => ({
            ...tool,
            reply: (args) =>
              conn.call(String(tool.meta?.remoteName ?? tool.name), args),
          }))
        } catch (error) {
          if (!(error instanceof MCPAuthorizationRequired)) throw error
          challenges.set(s.name, error.challenge)
          // An unauthenticated optional server must not prevent ordinary conversation.
          // A new connection is made after explicit successful authorization.
          return []
        }
      }))).flat(),
    close: async () => {
      for (const a of auths.values()) a.cancel()
      await Promise.all(
        [...connections.values(), ...retired].map((c) => c.close()),
      )
    },
  }
}
