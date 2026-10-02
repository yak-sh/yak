// Chat's slash form reads the commands this caller may discover from the app
// door. That door owns the access rule and runs the command after this parses it.

import {
  appGrammar,
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
  positional?: Grammar['positional']
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
  let positions = (tool.positional ?? []).map((key) => ({
    key: key.replace(/\.\.\.$/, ''),
    rest: key.endsWith('...'),
  }))
  let positional = new Set(positions.map(({ key }) => key))
  let input = tool.input ?? {}
  let names = [
    ...positions.map(({ key }) => key),
    ...Object.keys(input).filter((key) => !positional.has(key)),
  ]
  let args = names.map((key) => {
    let value = `<${key}:${shape(input[key])}${
      positions.find((p) => p.key == key)?.rest ? '...' : ''
    }>`
    if (!positional.has(key)) value = `--${key} <${shape(input[key])}>`
    return required.has(key) ? value : `[${value}]`
  })
  return `/${name}${args.length ? ` ${args.join(' ')}` : ''}`
}

let help = (name: string | undefined, tools: Tools) => {
  if (name) {
    let tool = tools[name]
    if (!tool || !seen(tool)) {
      return { error: `No available command /${name}.` }
    }
    let args = Object.entries(tool.input ?? {})
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

/** The caller's listing, parsed exactly as each command declares it. */
export let grammars = (tools: Tools): Grammar[] =>
  Object.entries(tools).filter(([, tool]) => seen(tool)).map(([name, tool]) =>
    appGrammar(name, tool)
  )

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
