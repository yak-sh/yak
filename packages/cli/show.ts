// What reaches the terminal: the tool listing and the help pages, both
// generated from a tool's own input schema, and the boundary everything
// printed crosses first.
//
// Anything printed here may have come from a remote server, so it passes
// through `safe` first: control characters are stripped, tabs become spaces
// chosen here rather than cursor movement chosen by the terminal, and only
// `\n` survives. A tool's output is content, never an escape sequence.

import { type Grammar } from './args.ts'
import { commandOf, type Prop, type Schema, titleOf, typeOf } from './tool.ts'

// deno-lint-ignore no-control-regex -- control characters ARE the subject
let ctrl = /[\x00-\x1f\x7f-\x9f]/g

/** Text from a server, with every escape sequence a terminal could act on
 * removed. */
export let safe = (text: string): string =>
  text.replaceAll('\t', '  ').replace(ctrl, (c) => c == '\n' ? c : '')

let pad = (s: string, n: number): string => s.padEnd(n)

/** Every tool, one per line, with the short label that says what it is. */
export let toolLines = (
  tools: (Grammar & { title?: string; description?: string })[],
): string => {
  let wide = Math.max(0, ...tools.map((t) => commandOf(t).length))
  return tools
    .map((t) => `  ${pad(commandOf(t), wide)}  ${titleOf(t)}`.trimEnd())
    .join('\n')
}

// `--name <type>`, in brackets when the argument is optional.
let slot = (name: string, p: Prop | undefined, need: boolean): string => {
  let said = `--${name} ${typeOf(p) == 'boolean' ? '' : `<${typeOf(p)}>`}`
    .trim()
  return need ? said : `[${said}]`
}

/**
 * The argument part of the command line to type: the positional arguments in
 * order, then every other property as an option, in brackets where it is
 * optional. The tool's own schema is the whole grammar, so this is the only
 * place that decides how a tool is written on a command line.
 */
export let sketch = (t: Grammar): string => {
  let schema = (t.inputSchema ?? {}) as Schema
  let props = schema.properties ?? {}
  let need = new Set(schema.required ?? [])
  let positional = t.options?.positional ?? []
  let rest = t.options?.rest
  let named = Object.keys(props).filter(
    (n) => !positional.includes(n) && n != rest,
  )
  return [
    ...positional.map((n) => need.has(n) ? `<${n}>` : `[${n}]`),
    ...(rest
      ? [typeOf(props[rest]) == 'array' ? '[word ...]' : '[key=value ...]']
      : []),
    ...named.map((n) => slot(n, props[n], need.has(n))),
  ].join(' ')
}

/** The whole command line to type, without the program's own name. */
export let lineOf = (t: Grammar): string =>
  `${commandOf(t)} ${sketch(t)}`.trimEnd()

/** One tool's help page: the command line to type, what it is for, and a row
 * per argument with its type, whether it is required, and the description the
 * schema gives it. */
export let toolHelp = (
  t: Grammar & { description?: string },
  program = 'yak',
): string => {
  let schema = (t.inputSchema ?? {}) as Schema
  let props = schema.properties ?? {}
  let need = new Set(schema.required ?? [])
  let names = Object.keys(props)
  let head = `${program} ${lineOf(t)}`.trimEnd()
  let wide = Math.max(0, ...names.map((n) => n.length))
  let kind = Math.max(0, ...names.map((n) => typeOf(props[n]).length))
  let rows = names.map((n) => {
    let p = props[n]
    let about = [
      p.description ?? '',
      p.enum ? `one of ${p.enum.join(', ')}` : '',
      p.default !== undefined ? `default ${JSON.stringify(p.default)}` : '',
    ].filter(Boolean).join(' — ')
    return `  --${pad(n, wide)}  ${pad(typeOf(p), kind)}  ${
      pad(need.has(n) ? 'required' : '', 8)
    }  ${about}`.trimEnd()
  })
  return [
    head,
    ...(t.description ? ['', wrap(t.description, 76, '  ')] : []),
    ...(rows.length ? ['', ...rows] : ['', '  (no arguments)']),
  ].join('\n')
}

/** Wrap prose to a width, so a description written for a model is readable in
 * a terminal. */
export let wrap = (text: string, width: number, lead = ''): string => {
  let out: string[] = []
  for (let para of text.split('\n')) {
    let line = lead
    for (let word of para.split(/\s+/).filter(Boolean)) {
      if (line.length > lead.length && line.length + 1 + word.length > width) {
        out.push(line)
        line = lead
      }
      line += (line.length > lead.length ? ' ' : '') + word
    }
    out.push(line)
  }
  return out.join('\n')
}
