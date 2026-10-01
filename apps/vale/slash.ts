// Chat's slash form reads the commands this caller may discover from the app
// door. That door owns the access rule and runs the command after this parses it.

import {
  argsFor,
  commandFor,
  type Grammar,
  type Prop,
  tokensIn,
} from '@yaks/cli/grammar'

type Arg = Prop
type Tool = {
  description?: string
  input?: Record<string, Arg>
  required?: string[]
  model?: boolean
}
export type Tools = Record<string, Tool>

export type Command = {
  name: string
  args: Record<string, unknown>
}
export type Slash = { command: Command } | { error: string } | { help: string }
let seen = (tool: Tool) => tool.model !== true

let shape = (arg: Arg) =>
  arg.type == 'boolean'
    ? 'true|false'
    : arg.enum?.join('|') || arg.type || 'value'

let usage = (name: string, tool: Tool) => {
  let required = new Set(tool.required ?? [])
  let args = Object.entries(tool.input ?? {}).filter(([key]) => key != 'player')
    .map(([key, arg]) =>
      required.has(key)
        ? `<${key}:${shape(arg)}>`
        : `[--${key} <${shape(arg)}>]`
    )
  return `/${name}${args.length ? ` ${args.join(' ')}` : ''}`
}

let help = (name: string | undefined, tools: Tools) => {
  if (name) {
    let tool = tools[name]
    if (!tool || !seen(tool)) {
      return { error: `No available command /${name}.` }
    }
    let args = Object.entries(tool.input ?? {})
      .filter(([key]) => key != 'player')
      .map(([key, arg]) =>
        `- \`${key}\`${tool.required?.includes(key) ? ' (required)' : ''}: ` +
        (arg.description ?? shape(arg))
      )
    return {
      help: `**${name}** — ${tool.description ?? ''}\n\n` +
        `Usage: \`${usage(name, tool)}\`${
          args.length ? `\n\n${args.join('\n')}` : ''
        }`,
    }
  }
  let listed = Object.entries(tools).filter(([, tool]) => seen(tool))
  return {
    help: `**Commands**\n\n${
      listed.map(([name, tool]) =>
        `- \`${usage(name, tool)}\` — ${
          tool.description?.split(/(?<=[.!?])\s/)[0] ?? ''
        }`
      ).join('\n')
    }\n\nUse \`/help <command>\` for details. Quote names with spaces.`,
  }
}

/** The caller's listing, adapted without declaring a second grammar. Player
 * is supplied by the door, not typed in chat. */
export let grammars = (tools: Tools): Grammar[] =>
  Object.entries(tools).filter(([, t]) => seen(t)).map(([name, t]) => ({
    name,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(t.input ?? {}).filter(([key]) => key != 'player'),
      ),
      required: (t.required ?? []).filter((key) => key != 'player'),
      additionalProperties: false,
    },
    options: {
      positional: Object.keys(t.input ?? {}).filter((key) => key != 'player'),
    },
  }))

/** A declared app command, a usage error, or null for ordinary chat. */
export let slash = async (
  text: string,
  tools: Tools,
): Promise<Slash | null> => {
  if (!text.startsWith('/')) return null
  try {
    let parts = tokensIn(text.slice(1).trim()).map((w) => w.value)
    let [word, ...argsIn] = parts
    let name = word?.toLowerCase() ?? ''
    if (name == 'help') {
      if (argsIn.length > 1) return { error: 'Use /help <command>.' }
      return help(argsIn[0]?.replace(/^\//, '').toLowerCase(), tools)
    }
    let found = commandFor(grammars(tools), [name, ...argsIn])
    if (!found) return { error: `Unknown command: /${name}. Try /help.` }
    return { command: { name, args: await argsFor(found.verb, found.args) } }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}
