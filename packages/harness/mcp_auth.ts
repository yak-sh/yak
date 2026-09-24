/** MCP connections that carry the harness's sign-in to each server, and
 * reconnect after one. No authorization input enters a transcript. */
import {
  connect,
  type Connection,
  MCPAuthorizationRequired,
  type Server,
} from '@yaks/mcp-client'
import type { AuthorizationChallenge } from '@yaks/mcp-client/oauth'
import { tokenFor } from '@yaks/cli'
import type { Tool } from '@yaks/graph'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

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

/** The token a server is called with: its sign-in (./signin.ts), if any. */
export type Token = (s: Server) => Promise<string | undefined>

export const authorizedMCP = (servers: Server[], token: Token) => {
  const connections = new Map<string, Connection>()
  const challenges = new Map<string, AuthorizationChallenge>()
  const retired: Connection[] = []
  const get = (s: Server) => {
    let c = connections.get(s.name)
    if (!c) {
      c = connect(s, {
        token: async () =>
          await token(s) ?? (s.credential ? tokenFor(s.credential) : null),
      })
      connections.set(s.name, c)
    }
    return c
  }
  return {
    /** What the server asked for when it last refused, asking it again. */
    challenge: async (s: Server): Promise<AuthorizationChallenge> => {
      try {
        await get(s).list()
      } catch (error) {
        if (error instanceof MCPAuthorizationRequired) {
          challenges.set(s.name, error.challenge)
        }
      }
      return challenges.get(s.name) ?? {}
    },
    /** A new connection after a sign-in. Already-issued calls keep the old. */
    reconnect: async (s: Server) => {
      const previous = connections.get(s.name)
      connections.delete(s.name)
      if (previous) retired.push(previous)
      await get(s).list()
    },
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
      await Promise.all(
        [...connections.values(), ...retired].map((c) => c.close()),
      )
    },
  }
}
