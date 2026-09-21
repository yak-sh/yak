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

/** What a tool is called on the wire: its own name where it has one, else the
 * words it declared — `noun_verb` for a pair, and the single word for a tool
 * that declared one alone, where the line and the name are the same word. */
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
