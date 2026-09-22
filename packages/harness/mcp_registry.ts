/** Graph-owned definitions; runtime handles are refreshed before discovery or authorization. */
import type { Graph } from '@yaks/graph'
import { checkNamespaces, checkToolNames, type Server } from '@yaks/mcp-client'
import type { Remote } from './mcp_auth.ts'
import { graphToolName, serverOf } from '@yaks/mcp-client/graph'
import {
  authorizedMCP,
  type MCPAuthAction,
  type MCPAuthReply,
} from './mcp_auth.ts'

type Handle = ReturnType<typeof authorizedMCP>
type Live = { signature: string; label: string; server: Server; handle: Handle }
export const graphMCP = (g: Graph) => {
  const live = new Map<string, Live>()
  // Already-admitted calls retain their original transport. All handles drain at host close.
  const retired: Handle[] = []
  const errors = new Map<string, string>()
  let tail = Promise.resolve()
  let closed = false
  const refresh = () => {
    const next = tail.then(async () => {
      if (closed) throw new Error('MCP registry is closed')
      const rows = await g.read('.mcp_server')
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
            old.handle.cancel()
            retired.push(old.handle)
          }
          live.set(id, {
            signature,
            label: config.label,
            server: config.server,
            handle: authorizedMCP([config.server]),
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
          old.handle.cancel()
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
      return await found[1].handle.control(action, found[0], callback)
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
