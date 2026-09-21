// What reaches the terminal: the listing and the help a tool's own schema
// already describes, and the boundary everything printed crosses first.
//
// Everything printed here came off a wire, so it passes `safe` first: the
// control class is stripped, tabs become spaces chosen here rather than cursor
// movement chosen by a terminal, and only `\n` survives. A tool's answer is
// content, never an escape sequence.

import { type Grammar } from './args.ts'
import { commandOf, type Prop, type Schema, titleOf, typeOf } from './tool.ts'

// deno-lint-ignore no-control-regex -- the control class IS the subject
let ctrl = /[\x00-\x1f\x7f-\x9f]/g

/** Text off the wire, with every escape a terminal could act on removed. */
export let safe = (text: string): string =>
  text.replaceAll('\t', '  ').replace(ctrl, (c) => c == '\n' ? c : '')

let pad = (s: string, n: number): string => s.padEnd(n)

/** Every tool, one per line, with the one word that says what it is. */
export let toolLines = (
  tools: (Grammar & { title?: string; description?: string })[],
): string => {
  let wide = Math.max(0, ...tools.map((t) => commandOf(t).length))
  return tools
    .map((t) => `  ${pad(commandOf(t), wide)}  ${titleOf(t)}`.trimEnd())
    .join('\n')
}

// `--name <type>`, bracketed when the tool can do without it.
let slot = (name: string, p: Prop | undefined, need: boolean): string => {
  let said = `--${name} ${typeOf(p) == 'boolean' ? '' : `<${typeOf(p)}>`}`
    .trim()
  return need ? said : `[${said}]`
}

/**
 * The arguments part of the line to type: the positionals in their order, then
 * every other property as an option, bracketed where the tool can do without
 * it. The tool's own schema is the whole grammar, so this is the only place
 * that decides how one is spelled on a line.
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

/** The whole line to type, without the program's own name. */
export let lineOf = (t: Grammar): string =>
  `${commandOf(t)} ${sketch(t)}`.trimEnd()

/** One tool's help: the line to type, what it is for, and a row per argument
 * with its type, whether it is required, and what the schema says it means. */
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

/** Prose at a width, so a description written for a model reads on a
 * terminal. */
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
