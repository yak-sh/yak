// Chat's slash form reads the commands this caller may discover from the app
// door. That door owns the access rule and runs the command after this parses it.

type Arg = { type?: string; enum?: unknown[]; description?: string }
type Tool = {
  description?: string
  input?: Record<string, Arg>
  required?: string[]
  model?: boolean
}
export type Tools = Record<string, Tool>

export type Command = {
  name: string
  args: Record<string, string | number | boolean>
}
export type Slash = { command: Command } | { error: string } | { help: string }
let seen = (tool: Tool) => tool.model !== true

let shape = (arg: Arg) =>
  arg.type == 'boolean' ? 'on|off' : arg.enum?.join('|') || arg.type || 'value'

let usage = (name: string, tool: Tool) => {
  let required = new Set(tool.required ?? [])
  let args = Object.entries(tool.input ?? {}).filter(([key]) => key != 'player')
    .map(([key, arg]) =>
      required.has(key) ? `<${key}:${shape(arg)}>` : `[${key}=<${shape(arg)}>]`
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

let value = (raw: string, arg: Arg): string | number | boolean | null => {
  if (arg.type == 'boolean') {
    return /^(on|true)$/i.test(raw)
      ? true
      : /^(off|false)$/i.test(raw)
      ? false
      : null
  }
  if (arg.type == 'number' || arg.type == 'integer') {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return null
    let n = Number(raw)
    return Number.isFinite(n) && (arg.type != 'integer' || Number.isInteger(n))
      ? n
      : null
  }
  return arg.enum && !arg.enum.includes(raw) ? null : raw
}

// Quotes keep a name with spaces in one argument, including after `key=`.
let tokens = (line: string): string[] | null => {
  let out: string[] = []
  let word = '', quote = '', started = false
  for (let i = 0; i < line.length; i++) {
    let c = line[i]
    if (quote && c == '\\' && line[i + 1] == quote) {
      word += line[++i]
    } else if (c == quote) {
      quote = ''
    } else if (quote) {
      word += c
    } else if (c == '"' || c == "'") {
      quote = c
      started = true
    } else if (/\s/.test(c)) {
      if (started) out.push(word)
      word = ''
      started = false
    } else {
      word += c
      started = true
    }
  }
  if (quote) return null
  if (started) out.push(word)
  return out
}

/** A declared app command, a usage error, or null for ordinary chat. */
export let slash = (
  text: string,
  tools: Tools,
): Slash | null => {
  if (!text.startsWith('/')) return null
  let parts = tokens(text.slice(1).trim())
  if (!parts) return { error: 'Close the quoted argument.' }
  let [word, ...argsIn] = parts
  let name = word?.toLowerCase() ?? ''
  if (name == 'help') {
    if (argsIn.length > 1) return { error: 'Use /help <command>.' }
    return help(argsIn[0]?.replace(/^\//, '').toLowerCase(), tools)
  }
  let tool = tools[name]
  if (!tool || !seen(tool)) {
    return { error: `Unknown command: /${name}. Try /help.` }
  }
  let inputs = tool.input ?? {}
  let positional = Object.keys(inputs).filter((key) => key != 'player')
  let args: Command['args'] = {}
  for (let token of argsIn) {
    let equal = token.indexOf('=')
    let key = equal >= 0 ? token.slice(0, equal) : positional.shift()
    let raw = equal >= 0 ? token.slice(equal + 1) : token
    if (!key || !Object.hasOwn(inputs, key) || key in args) {
      return { error: `Usage: ${usage(name, tool)}` }
    }
    let parsed = value(raw, inputs[key])
    if (parsed == null) {
      return {
        error: `${key} has the wrong value. Usage: ${usage(name, tool)}`,
      }
    }
    args[key] = parsed
  }
  for (let key of tool.required ?? []) {
    if (key != 'player' && !(key in args)) {
      return { error: `${key} is required. Usage: ${usage(name, tool)}` }
    }
  }
  return { command: { name, args } }
}
