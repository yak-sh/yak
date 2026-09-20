/** Transport-independent identity for graph tools, and the one thing every
 * tool that takes an id does with it. */
import type { Bundle, Eid } from './bundle.ts'
import type { Tool, ToolCtx } from './plugin.ts'

/**
 * The ids a caller typed, as the eids they name — whatever a plugin says
 * addresses one (a name, a human id), and the word itself where nothing does,
 * since an eid needs nobody to say so.
 *
 * Every tool taking an id owes its caller this: an argument is what a person
 * types, never what the store happens to key by.
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

/** The three fields that decide what a tool is CALLED — the only part of a
 * tool naming reads, so it costs nothing to ask about one whose context and
 * result are somebody else's. */
export type ToolId = { name?: string; noun?: string; verb?: string }

export type NamedTool<C = ToolCtx, R = Bundle[]> = Tool<C, R> & {
  name: string
}

export const toolName = (tool: ToolId): string => {
  if (tool.noun != null || tool.verb != null) {
    const word = /^[a-z][a-z0-9-]*$/
    if (
      !tool.noun || !tool.verb || !word.test(tool.noun) || !word.test(tool.verb)
    ) {
      throw new Error('Tool noun and verb must both be single lowercase words')
    }
    return tool.name ?? `${tool.noun}_${tool.verb}`
  }
  if (!tool.name) throw new Error('Tool needs noun and verb, or a legacy name')
  return tool.name
}

export const namedTool = <C, R>(tool: Tool<C, R>): NamedTool<C, R> => ({
  ...tool,
  name: toolName(tool),
})
