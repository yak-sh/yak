// Tool identity and surface metadata, independent of calls or a graph.
import type { Bundle } from './bundle.ts'
import type { Surface, Tool } from './plugin.ts'

/** The three fields that decide what a tool is called — all `toolName` reads,
 * so it can be called on a command whose `run` and result types belong to
 * another package. */
export type ToolId = { name?: string; noun?: string; verb?: string }

export type NamedTool<R = Bundle[]> = Tool<R> & {
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

/** Is a tool offered on this surface? A tool that names no surfaces is
 * offered on every one.
 *
 * ```ts
 * import { offered } from '@yaks/graph'
 *
 * offered('mcp')({ surfaces: ['cli'] }) // false
 * offered('mcp')({}) // true
 * ```
 */
export let offered =
  (surface: Surface) => (tool: { surfaces?: readonly Surface[] }): boolean =>
    !tool.surfaces || tool.surfaces.includes(surface)
