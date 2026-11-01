import type { Description, Registry } from '@yaks/tools'

type Schema = Record<string, unknown>
let node = (s: unknown): Schema => s && typeof s == 'object' ? s as Schema : {}
let joined = (s: unknown, root: Schema, sep: string, seen: string[]): string =>
  (s as unknown[]).map((v) => type(v, root, seen)).join(sep)

/** JSON Schema expressed as TypeScript, retaining unions, literal values,
 * references, tuples and open object properties. Validation stays at dispatch. */
export let type = (
  value: unknown,
  root = node(value),
  seen: string[] = [],
): string => {
  if (value === false) return 'never'
  let s = node(value)
  if (typeof s.$ref == 'string') {
    if (!s.$ref.startsWith('#/') || seen.includes(s.$ref)) return 'unknown'
    let ref = s.$ref.slice(2).split('/').reduce<unknown>(
      (v, k) => node(v)[k.replaceAll('~1', '/').replaceAll('~0', '~')],
      root,
    )
    return type(ref, root, [...seen, s.$ref])
  }
  if ('const' in s) return JSON.stringify(s.const)
  if (Array.isArray(s.enum)) {
    return s.enum.map((v) => JSON.stringify(v)).join(' | ') || 'never'
  }
  if (s.anyOf || s.oneOf) {
    return `(${joined(s.anyOf ?? s.oneOf, root, ' | ', seen)})`
  }
  if (s.allOf) return `(${joined(s.allOf, root, ' & ', seen)})`
  if (Array.isArray(s.type)) {
    return s.type.map((t) => type({ ...s, type: t }, root, seen)).join(' | ')
  }
  if (s.type == 'array') {
    return Array.isArray(s.prefixItems ?? s.items)
      ? `[${joined(s.prefixItems ?? s.items, root, ', ', seen)}]`
      : `Array<${type(s.items, root, seen)}>`
  }
  if (s.type == 'object' || s.properties) {
    let required = new Set(s.required as string[] ?? [])
    let props = Object.entries(node(s.properties)).map(([k, v]) =>
      `${JSON.stringify(k)}${required.has(k) ? '' : '?'}: ${
        type(v, root, seen)
      }`
    )
    let closed = s.additionalProperties === false
    let open = closed
      ? ''
      : ` & Record<string, ${type(s.additionalProperties, root, seen)}>`
    return `{ ${props.join('; ')} }${open}`
  }
  return ({
    string: 'string',
    number: 'number',
    integer: 'number',
    boolean: 'boolean',
    null: 'null',
  } as Record<string, string>)[String(s.type)] ?? 'unknown'
}

export type Entry = Description & { path: [string, string] }
/** Names are preserved as object keys, including punctuation; bracket notation
 * gives every registry name one unambiguous path without alias collisions. */
export let catalog = (registry: Registry): Entry[] =>
  registry.list()
    .map((t) => registry.describe(t.name)!)
    .map((t) => ({ ...t, path: [t.provider, t.name] }))

/** Declarations are generated from the same schemas that discovery serves. */
export let declarations = (entries: Entry[]): string => {
  let groups = Map.groupBy(entries, (e) => e.provider)
  return 'declare const tools: {\n' +
    [...groups].map(([set, entries]) =>
      `  ${JSON.stringify(set)}: {\n` + entries.map((t) =>
        `    ${JSON.stringify(t.name)}: (args: ${
          type(t.inputSchema)
        }) => Promise<{ content: Array<{type: string; [key: string]: unknown}>; structuredContent?: ${
          type(t.outputSchema)
        }; isError?: boolean }>`
      ).join('\n') + '\n  }'
    ).join('\n') + '\n}'
}
