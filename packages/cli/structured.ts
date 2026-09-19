/** CLI traversal of graph Tool nouns and verbs. No separate command identity. */
import {
  type NamedTool,
  namedTool,
  type Tool,
  type ToolId,
  toolName,
} from '@yaks/graph'
import type { Ctx, Plugin } from './plugin.ts'

export { toolName }
export const pathOf = (tool: ToolId): readonly string[] => {
  if (!tool.noun || !tool.verb) {
    throw new Error('CLI traversal requires a tool noun and verb')
  }
  toolName(tool)
  return [tool.noun, tool.verb]
}

/** Reject duplicate identities and ambiguous word pairs before registration. */
export const defineCommands = <C, R>(
  tools: readonly Tool<C, R>[],
): readonly Tool<C, R>[] => {
  const paths = new Set<string>(), names = new Set<string>()
  for (const tool of tools) {
    const [noun, verb] = pathOf(tool)
    for (const path of new Set([`${noun} ${verb}`, `${verb} ${noun}`])) {
      if (paths.has(path)) {
        throw new Error(`Ambiguous or duplicate tool words: ${path}`)
      }
      paths.add(path)
    }
    const name = toolName(tool)
    if (names.has(name)) throw new Error(`Duplicate tool name: ${name}`)
    names.add(name)
  }
  return tools
}

/** Legacy adapter name; name generation is shared with MCP/provider adapters. */
export const commandTools = (tools: readonly Tool[]): NamedTool[] =>
  defineCommands(tools).map(namedTool)

export const resolveCommand = <C, R>(
  tools: readonly Tool<C, R>[],
  argv: readonly string[],
): { command: Tool<C, R>; args: string[] } | undefined => {
  defineCommands(tools)
  const command = tools.find((t) =>
    t.noun === argv[0] && t.verb === argv[1] ||
    t.verb === argv[0] && t.noun === argv[1]
  )
  return command ? { command, args: argv.slice(2) } : undefined
}

/** Completions are registry traversals, independent of the chosen word order. */
export const completeCommand = <C, R>(
  tools: readonly Tool<C, R>[],
  words: readonly string[],
): string[] => {
  defineCommands(tools)
  return [
    ...new Set(
      tools.flatMap((t) =>
        words.length === 0 ? [t.noun!, t.verb!] : words.length === 1
          ? [
            ...(t.noun === words[0] ? [t.verb!] : []),
            ...(t.verb === words[0] ? [t.noun!] : []),
          ]
          : []
      ),
    ),
  ].sort()
}

/**
 * A plugin whose table IS the tools it was handed. Word order is the registry's
 * (plugin.ts `verbFor` resolves `session list` and `list session` alike), and
 * the line's words become the arguments through each tool's own input schema,
 * so nothing here parses anything.
 */
export const commandPlugin = <C, R>(
  tools: readonly Tool<C, R>[],
  execute: (
    tool: Tool<C, R>,
    args: Record<string, unknown>,
    ctx: Ctx,
  ) => number | Promise<number>,
): Plugin => {
  defineCommands(tools)
  return {
    name: 'structured-tools',
    about: 'Installed tools',
    verbs: () =>
      tools.map((tool) => ({
        ...tool,
        run: (args: Record<string, unknown>, ctx: Ctx) =>
          execute(tool, args, ctx),
      })),
  }
}
