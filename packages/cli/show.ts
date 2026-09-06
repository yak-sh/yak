// What reaches the terminal: the listing and the help a tool's own schema
// already describes, and the boundary everything printed crosses first.
//
// Everything printed here came off a wire, so it passes `safe` first: the
// control class is stripped, tabs become spaces chosen here rather than cursor
// movement chosen by a terminal, and only `\n` survives. A tool's answer is
// content, never an escape sequence.

import { type Prop, titleOf, type Tool, typeOf } from './tool.ts'

// deno-lint-ignore no-control-regex -- the control class IS the subject
let ctrl = /[\x00-\x1f\x7f-\x9f]/g

/** Text off the wire, with every escape a terminal could act on removed. */
export let safe = (text: string): string =>
  text.replaceAll('\t', '  ').replace(ctrl, (c) => c == '\n' ? c : '')

let pad = (s: string, n: number): string => s.padEnd(n)

/** Every tool, one per line, with the one word that says what it is. */
export let toolLines = (tools: Tool[]): string => {
  let wide = Math.max(0, ...tools.map((t) => t.name.length))
  return tools
    .map((t) => `  ${pad(t.name, wide)}  ${titleOf(t)}`.trimEnd())
    .join('\n')
}

// `--name <type>`, bracketed when the tool can do without it.
let slot = (name: string, p: Prop | undefined, need: boolean): string => {
  let said = `--${name} ${typeOf(p) == 'boolean' ? '' : `<${typeOf(p)}>`}`
    .trim()
  return need ? said : `[${said}]`
}

/** One tool's help: the line to type, what it is for, and a row per argument
 * with its type, whether it is required, and what the schema says it means. */
export let toolHelp = (t: Tool): string => {
  let props = t.inputSchema?.properties ?? {}
  let need = new Set(t.inputSchema?.required ?? [])
  let names = Object.keys(props)
  let head = `yaks ${t.name} ${
    names.map((n) => slot(n, props[n], need.has(n))).join(' ')
  }`.trimEnd()
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
