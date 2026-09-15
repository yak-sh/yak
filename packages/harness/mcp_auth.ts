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

export type MCPAuthAction = 'list' | 'begin' | 'complete' | 'cancel'
export type MCPAuthReply = {
  servers?: string[]
  url?: string
  redirectUrl?: string
  message?: string
}
export const authorizedMCP = (
  servers: Server[],
  path = Deno.env.get('HARNESS_MCP_AUTH') ??
    `${Deno.env.get('HOME')}/.yaks/mcp-auth.json`,
) => {
  const store = fileAuthorizationStore(path)
  const auths = new Map<string, Authorization>()
  const connections = new Map<string, Connection>()
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
    if (action === 'begin') return await a.begin()
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
    control,
    tools: async () =>
      (await Promise.all(servers.map(async (s) => {
        try {
          return await get(s).tools()
        } catch (error) {
          if (!(error instanceof MCPAuthorizationRequired)) throw error
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
