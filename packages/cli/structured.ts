import { validateToolInput } from '@yaks/vocab/tools'
/** CLI traversal of graph Tool nouns and verbs. No separate command identity. */
import { type NamedTool, namedTool, type Tool, toolName } from '@yaks/graph'
import type { Ctx, Plugin } from './plugin.ts'

export { toolName }
export const pathOf = (tool: Tool): readonly string[] => {
  if (!tool.noun || !tool.verb) {
    throw new Error('CLI traversal requires a tool noun and verb')
  }
  toolName(tool)
  return [tool.noun, tool.verb]
}

/** Reject duplicate identities and ambiguous word pairs before registration. */
export const defineCommands = (tools: readonly Tool[]): readonly Tool[] => {
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

export const resolveCommand = (
  tools: readonly Tool[],
  argv: readonly string[],
): { command: Tool; args: string[] } | undefined => {
  defineCommands(tools)
  const command = tools.find((t) =>
    t.noun === argv[0] && t.verb === argv[1] ||
    t.verb === argv[0] && t.noun === argv[1]
  )
  return command ? { command, args: argv.slice(2) } : undefined
}

/** Completions are registry traversals, independent of the chosen word order. */
export const completeCommand = (
  tools: readonly Tool[],
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

type Property = { type?: string; [key: string]: unknown }
/** Decode CLI presentation, then validate with the same JSON Schema as MCP. */
export const commandArguments = (
  tool: Tool,
  argv: readonly string[],
): Record<string, unknown> => {
  const schema = tool.inputSchema
  if (!schema) {
    if (argv.length) {
      throw new Error('This tool has no JSON Schema CLI arguments')
    }
    return {}
  }
  if (schema.type !== 'object') {
    throw new Error('CLI tool inputSchema must describe an object')
  }
  const props = (schema.properties ?? {}) as Record<string, Property>
  const positional = tool.options?.positional ?? []
  const shorts = tool.options?.short ?? {}
  const result: Record<string, unknown> = {}
  let at = 0, literal = false
  const put = (name: string, raw: string | boolean) => {
    if (!Object.hasOwn(props, name)) throw new Error(`Unknown option: ${name}`)
    if (Object.hasOwn(result, name)) {
      throw new Error(`Repeated argument: ${name}`)
    }
    const type = props[name].type
    let value: unknown = raw
    if (type === 'boolean') {
      if (raw === true || raw === 'true') value = true
      else if (raw === 'false') value = false
      else throw new Error(`Expected boolean: ${name}`)
    } else if (typeof raw !== 'string') {
      throw new Error(`Missing value: ${name}`)
    } else if (type === 'integer' || type === 'number') {
      if (!raw.trim() || !Number.isFinite(Number(raw))) {
        throw new Error(`Expected number: ${name}`)
      }
      value = Number(raw)
    } else if (type === 'array' || type === 'object') value = JSON.parse(raw)
    Object.defineProperty(result, name, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!literal && arg === '--') {
      literal = true
      continue
    }
    if (!literal && arg.startsWith('-') && arg !== '-') {
      const [flag, ...rest] = arg.split('=')
      const name = flag.startsWith('--') ? flag.slice(2) : shorts[flag.slice(1)]
      if (!name || !Object.hasOwn(props, name)) {
        throw new Error(`Unknown option: ${flag}`)
      }
      let raw: string | boolean
      if (rest.length) raw = rest.join('=')
      else if (props[name].type === 'boolean') raw = true
      else {
        if (argv[i + 1] == null || argv[i + 1].startsWith('--')) {
          throw new Error(`Missing value: ${flag}`)
        }
        raw = argv[++i]
      }
      put(name, raw)
    } else {
      const name = positional[at++]
      if (!name) throw new Error(`Unexpected argument: ${arg}`)
      put(name, arg)
    }
  }
  return validateToolInput(tool, result)
}

export const commandPlugin = (
  tools: readonly Tool[],
  execute: (
    tool: Tool,
    args: Record<string, unknown>,
    ctx: Ctx,
  ) => number | Promise<number>,
): Plugin => {
  defineCommands(tools)
  return {
    name: 'structured-tools',
    about: 'Installed tools',
    verbs: () =>
      completeCommand(tools, []).map((name) => ({
        name,
        about: completeCommand(tools, [name]).join(' | '),
        run: (ctx) => {
          try {
            const found = resolveCommand(tools, [name, ...ctx.args])
            if (!found) {
              throw new Error(
                `Unknown tool: ${name} ${ctx.args.join(' ')}`,
              )
            }
            return execute(
              found.command,
              commandArguments(found.command, found.args),
              ctx,
            )
          } catch (error) {
            ctx.note((error as Error).message)
            return 2
          }
        },
      })),
  }
}
