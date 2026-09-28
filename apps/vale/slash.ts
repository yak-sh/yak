// Chat's slash form is an adapter for this app's declared commands. It reads
// their names and argument types from vocab.json; the app command door checks
// access and runs them exactly as it does for an agent.
import words from './vocab.json' with { type: 'json' }

type Arg = { type?: string; enum?: unknown[] }
type Tool = {
  tool?: boolean
  input?: Record<string, Arg>
  required?: string[]
}
let tools: Record<string, Tool> = {}
for (let [name, def] of Object.entries(words.$defs)) {
  if ('tool' in def && def.tool === true) tools[name] = def
}

export type Command = {
  name: string
  args: Record<string, string | number | boolean>
}
export type Slash = { command: Command } | { error: string }

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

/** A declared app command, a usage error, or null for ordinary chat. */
export let slash = (text: string): Slash | null => {
  if (!text.startsWith('/')) return null
  let [word, ...tokens] = text.slice(1).trim().split(/\s+/)
  let name = word?.toLowerCase() ?? ''
  let tool = tools[name]
  if (!tool) return { error: `Unknown command: /${name}.` }
  let inputs = tool.input ?? {}
  let positional = Object.keys(inputs).filter((key) => key != 'player')
  let args: Command['args'] = {}
  for (let token of tokens) {
    let equal = token.indexOf('=')
    let key = equal >= 0 ? token.slice(0, equal) : positional.shift()
    let raw = equal >= 0 ? token.slice(equal + 1) : token
    if (!key || !Object.hasOwn(inputs, key) || key in args) {
      return { error: `Use /${name} with its declared arguments.` }
    }
    let parsed = value(raw, inputs[key])
    if (parsed == null) return { error: `${key} has the wrong value.` }
    args[key] = parsed
  }
  for (let key of tool.required ?? []) {
    if (key != 'player' && !(key in args)) {
      return { error: `${key} is required for /${name}.` }
    }
  }
  return { command: { name, args } }
}
