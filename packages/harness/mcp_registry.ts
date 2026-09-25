/** Graph-owned definitions; runtime handles are refreshed before discovery or
 * authorization. A server's sign-in is a connection it owns (./signin.ts),
 * through an integration discovered from the server itself. */
import type { Harness } from './store.ts'
import { checkNamespaces, checkToolNames, type Server } from '@yaks/mcp-client'
import type { Remote } from './mcp_auth.ts'
import { graphToolName, serverOf } from '@yaks/mcp-client/graph'
import { discover } from '@yaks/mcp-client/oauth'
import { INTEGRATION, integrationEid, known } from '@yaks/connections'
import {
  authorizedMCP,
  type MCPAuthAction,
  type MCPAuthReply,
} from './mcp_auth.ts'
import { REDIRECT, type SignIns } from './signin.ts'

type Handle = ReturnType<typeof authorizedMCP>
type Live = { signature: string; label: string; server: Server; handle: Handle }
export const graphMCP = (h: Pick<Harness, 'g' | 'vault'>, signin: SignIns) => {
  const g = h.g
  // A server's name is its entity, which owns its sign-in.
  const token = (s: Server) => signin.key(s.name, s.url)
  const live = new Map<string, Live>()
  // Already-admitted calls retain their original transport. All handles drain at host close.
  const retired: Handle[] = []
  const errors = new Map<string, string>()
  let tail = Promise.resolve()
  let closed = false
  const refresh = () => {
    const next = tail.then(async () => {
      if (closed) throw new Error('MCP registry is closed')
      const rows = await g.read('.mcp_server&*')
      // Validate the complete configured namespace set before opening transports.
      const valid = rows.flatMap((row) => {
        try {
          const c = serverOf(row)
          return c ? [c.server] : []
        } catch {
          return []
        }
      })
      checkNamespaces(valid)
      const wanted = new Set<string>()
      const existing = new Set(rows.map((row) => row.entity.eid))
      for (const id of errors.keys()) if (!existing.has(id)) errors.delete(id)
      for (const row of rows) {
        const id = row.entity.eid
        try {
          const config = serverOf(row)
          if (!config) {
            errors.delete(id)
            continue
          }
          wanted.add(id)
          const signature = JSON.stringify(config.server)
          const old = live.get(id)
          if (old?.signature === signature) {
            old.label = config.label
            continue
          }
          errors.delete(id)
          if (old) {
            signin.cancel(id)
            retired.push(old.handle)
          }
          live.set(id, {
            signature,
            label: config.label,
            server: config.server,
            handle: authorizedMCP([config.server], token),
          })
        } catch (e) {
          errors.set(
            id,
            e instanceof Error ? e.message : 'Invalid MCP definition',
          )
        }
      }
      for (const [id, old] of live) {
        if (!wanted.has(id)) {
          live.delete(id)
          signin.cancel(id)
          retired.push(old.handle)
        }
      }
    })
    tail = next.catch(() => {})
    return next
  }
  return {
    refresh,
    tools: async (): Promise<Remote[]> => {
      await refresh()
      const result = (await Promise.all([...live].map(async ([id, item]) => {
        try {
          const tools = await item.handle.tools()
          errors.delete(id)
          return await Promise.all(tools.map(async (tool) => ({
            ...tool,
            name: await graphToolName(
              id,
              item.server,
              String(tool.meta?.remoteName),
            ),
            description: tool.description.replace(
              '[' + id + ']',
              '[' + item.label + ']',
            ),
          })))
        } catch (e) {
          errors.set(
            id,
            e instanceof Error ? e.message : 'MCP discovery failed',
          )
          return []
        }
      }))).flat()
      checkToolNames(result)
      return result
    },
    control: async (
      action: MCPAuthAction,
      name = '',
      callback = '',
    ): Promise<MCPAuthReply> => {
      await refresh()
      if (action === 'list') {
        return {
          servers: [...live].map(([id, item]) => `${item.label} [${id}]`),
          ...(errors.size
            ? {
              message: [...errors].map(([id, error]) => `${id}: ${error}`).join(
                '\n',
              ),
            }
            : {}),
        }
      }
      const found =
        [...live].find(([id, item]) =>
          name === id || name === `${item.label} [${id}]`
        ) ??
          [...live].filter(([, item]) => item.label === name).filter((
            _,
            __,
            all,
          ) => all.length === 1)[0]
      if (!found) throw new Error('Unknown or ambiguous configured MCP server')
      const [id, { server: s, handle }] = found
      if (action === 'cancel') {
        signin.cancel(id)
        return { message: 'Authorization cancelled.' }
      }
      if (action === 'begin') {
        // Where the server signs in, kept as its integration with the client
        // this harness registered there.
        const redirect = s.oauth?.redirectUrl ?? REDIRECT
        const { integration, register } = await discover(s.url, {
          ...await handle.challenge(s),
          ...s.oauth?.scope ? { scope: s.oauth.scope } : {},
        })
        const client = s.oauth?.clientId ?? s.oauth?.clientMetadataUrl ??
          (await known(g.read, integration.name, {}))?.client ??
          await register(redirect)
        await g.apply([{
          entity: { eid: integrationEid(integration.name) },
          [INTEGRATION]: { ...integration, client },
        }])
        return await signin.begin(id, s.url, redirect)
      }
      if (action !== 'complete') throw new Error('Unknown authorization action')
      await signin.complete(id, s.url, callback)
      await handle.reconnect(s)
      return {
        message: 'Connected. Tools will be available on the next request.',
      }
    },
    close: async () => {
      await tail
      closed = true
      await Promise.all(
        [...live.values()].map((v) => v.handle).concat(retired).map((h) =>
          h.close()
        ),
      )
    },
  }
}
