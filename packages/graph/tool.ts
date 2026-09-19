/** Transport-independent identity for graph tools. */
import type { Tool, ToolCtx } from './plugin.ts'

/** The three fields that decide what a tool is CALLED — the only part of a
 * tool naming reads, so it costs nothing to ask about one whose context and
 * result are somebody else's. */
export type ToolId = { name?: string; noun?: string; verb?: string }

export type NamedTool<C = ToolCtx, R = unknown> = Tool<C, R> & { name: string }

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
