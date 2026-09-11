/** Transport-independent identity for graph tools. */
import type { Tool } from './plugin.ts'

export type NamedTool = Tool & { name: string }

export const toolName = (tool: Tool): string => {
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

export const namedTool = (tool: Tool): NamedTool => ({
  ...tool,
  name: toolName(tool),
})
