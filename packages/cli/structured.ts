/** Structured command identity with the existing graph Tool execution contract. */
import type { Tool } from '@yaks/graph'
import type { Ctx, Plugin } from './plugin.ts'

export type Command = Omit<Tool, 'name'> & {
  noun: readonly string[]
  verb: string
  /** Explicit alternate token paths; no automatic English grammar. */
  aliases?: readonly (readonly string[])[]
}

const word = /^[a-z][a-z0-9-]*$/
export const toolName = (c: Command): string => [...c.noun, c.verb].join('_')
export const pathOf = (c: Command): readonly string[] => [...c.noun, c.verb]

/** Reject CLI and MCP collisions before either adapter registers commands. */
export const defineCommands = (
  commands: readonly Command[],
): readonly Command[] => {
  const paths = new Set<string>(), tools = new Set<string>()
  for (const c of commands) {
    if (!c.noun.length) throw new Error('Command requires a noun')
    for (const path of [pathOf(c), ...c.aliases ?? []]) {
      if (!path.length || path.some((part) => !word.test(part))) {
        throw new Error(
          'Command paths require lowercase words without underscores',
        )
      }
      const key = path.join(' ')
      if (paths.has(key)) throw new Error(`Duplicate command path: ${key}`)
      // Prefix commands are ambiguous without a delimiter; reject in this pilot.
      for (const old of paths) {
        if (old.startsWith(key + ' ') || key.startsWith(old + ' ')) {
          throw new Error(`Ambiguous command paths: ${old}, ${key}`)
        }
      }
      paths.add(key)
    }
    const name = toolName(c)
    if (tools.has(name)) throw new Error(`Duplicate tool name: ${name}`)
    tools.add(name)
  }
  return commands
}

/** Feed these directly to @yaks/mcp's existing tools option. */
export const commandTools = (commands: readonly Command[]): Tool[] =>
  defineCommands(commands).map((
    { noun, verb, aliases: _aliases, ...tool },
  ) => ({
    ...tool,
    name: [...noun, verb].join('_'),
  }))

export const resolveCommand = (
  commands: readonly Command[],
  argv: readonly string[],
) => {
  for (const command of commands) {
    for (const path of [pathOf(command), ...command.aliases ?? []]) {
      if (path.every((part, i) => argv[i] === part)) {
        return { command, args: argv.slice(path.length) }
      }
    }
  }
  return undefined
}

/** CLI owns argument decoding and output; the command owns execution/schema. */
export const commandPlugin = (
  commands: readonly Command[],
  execute: (
    command: Command,
    args: readonly string[],
    ctx: Ctx,
  ) => number | Promise<number>,
): Plugin => {
  defineCommands(commands)
  const roots = [
    ...new Set(
      commands.flatMap((c) =>
        [pathOf(c), ...c.aliases ?? []].map((path) => path[0])
      ),
    ),
  ]
  return {
    name: 'structured-commands',
    about: 'Installed commands',
    verbs: () =>
      roots.map((name) => ({
        name,
        about: commands.flatMap((c) => [pathOf(c), ...c.aliases ?? []])
          .filter((p) => p[0] === name).map((p) => p.slice(1).join(' ')).join(
            ' | ',
          ),
        run: (ctx) => {
          const found = resolveCommand(commands, [name, ...ctx.args])
          if (!found) {
            ctx.note(`Unknown command: ${name} ${ctx.args.join(' ')}`)
            return 2
          }
          return execute(found.command, found.args, ctx)
        },
      })),
  }
}
