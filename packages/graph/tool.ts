/** How a tool is named, independently of any transport, plus the id
 * resolution every tool that takes an id needs. */
import type { Bundle, Eid } from './bundle.ts'
import type { Tool, ToolCtx } from './plugin.ts'

/**
 * The ids a caller passed, resolved to the eids they refer to — through
 * whatever a plugin resolves (a name, a human-readable id), and left as they
 * are when no plugin resolves them, since an eid needs no resolution.
 *
 * Every tool that takes an id owes its caller this: an argument is what a
 * person types, not what the store happens to key rows by.
 */
export let addressed = async (
  graph: {
    address: (ids: string[]) => Map<string, Eid> | Promise<Map<string, Eid>>
  },
  ids: string[],
): Promise<Eid[]> => {
  let at = await graph.address(ids)
  return ids.map((id) => at.get(id) ?? id)
}

/** The three fields that decide what a tool is CALLED — all `toolName` reads,
 * so it can be called on a tool whose context and result types belong to
 * another package. */
export type ToolId = { name?: string; noun?: string; verb?: string }

export type NamedTool<C = ToolCtx, R = Bundle[]> = Tool<C, R> & {
  name: string
}

/** The name a tool is listed and called under: its own `name` where it has
 * one, otherwise derived from what it declared — `noun_verb` for a pair, and
 * the single word for a tool that declared only a noun or only a verb, where
 * the command and the tool name are the same word. */
export const toolName = (tool: ToolId): string => {
  const said = [tool.noun, tool.verb].filter((w) => w != null)
  if (said.length) {
    const word = /^[a-z][a-z0-9-]*$/
    if (!said.every((w) => word.test(w))) {
      throw new Error('A tool noun and verb are single lowercase words')
    }
    return tool.name ?? said.join('_')
  }
  if (!tool.name) throw new Error('Tool needs a noun, a verb, or a legacy name')
  return tool.name
}

export const namedTool = <C, R>(tool: Tool<C, R>): NamedTool<C, R> => ({
  ...tool,
  name: toolName(tool),
})
