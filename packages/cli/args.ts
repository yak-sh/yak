// The command line, parsed into a tool's arguments. The tool's own input
// schema is the only grammar there is: `name=value` and `--name value` name a
// property, and the type that property declares decides whether the argument
// stays a string, is parsed as JSON, or becomes a number.
//
// Three forms expand a value before its type is ever consulted, because a body
// is rarely something a person types out: `@path` is that file's text, `-` and
// `@-` are stdin, and anything else is the argument itself. That is what makes
//
//   yak app_files --app recipes --path index.html --content @index.html
//
// the same command whether the page is two lines or two hundred.
//
// Rejecting a name the schema does not declare is deliberate: the cached
// schema is kept fresh (store.ts), so an undeclared `--nmae` is a typo worth
// an error message here rather than a rejection one round trip away.

import { validateToolInput } from '@yaks/vocab/tools'
import { CallError } from '@yaks/tools'
import { commandOf, type Prop, type Schema, typeOf } from './tool.ts'

/** As much of a tool as a command line reads: what it is called, the schema
 * its arguments must satisfy, and how they are written on a command line. A
 * tool an MCP server listed (tool.ts `Listed`) and one this process runs
 * (@yaks/graph `Tool`) both carry this much. */
export type Grammar = {
  name?: string
  noun?: string
  verb?: string
  inputSchema?: Schema | Record<string, unknown>
  positional?: readonly string[]
  /** Words retained verbatim for another schema to parse. */
  forward?: string
}

/** An app's vocabulary declaration, in the same grammar as package tools.
 * Positionals and short flags come only from its declaration. */
export let appGrammar = (
  name: string,
  tool: {
    input?: Record<string, Prop>
    required?: string[]
    positional?: Grammar['positional']
  },
): Grammar => ({
  name,
  inputSchema: {
    type: 'object',
    properties: tool.input ?? {},
    required: tool.required ?? [],
    additionalProperties: false,
  },
  positional: tool.positional,
})

/** The command line was wrong — nothing ran, and the exit code is 2. The
 * caller's own mistake, so a refusal (@yaks/tools `CallError`), never a
 * defect to report. */
export class Usage extends CallError {
  constructor(message: string) {
    super('usage', message)
  }
}

/** Where an expanded value is read from. A test passes two functions and
 * touches no disk. */
export type Reads = {
  file: (path: string) => string | Promise<string>
  stdin: () => string | Promise<string>
}

/** A parsed command line: options in the order they were given (a bare flag
 * is `true`), and the bare words that named no option. */
export type Said = {
  opts: [string, string | true][]
  words: string[]
}

/**
 * Split a command line into options and bare words. A `--name` whose next word
 * is not itself an option takes that word as its value; otherwise it is a
 * flag. `--name=value` always takes the value, which is the only way to pass a
 * value that itself starts with `--`.
 *
 * ```ts
 * saidIn(['--q', '.recipe', '--json'])
 * // { opts: [['q', '.recipe'], ['json', true]], words: [] }
 * ```
 */
export let saidIn = (argv: string[]): Said => {
  let opts: [string, string | true][] = []
  let words: string[] = []
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    if (!a.startsWith('--')) {
      words.push(a)
      continue
    }
    let eq = a.indexOf('=')
    if (eq > 2) {
      opts.push([a.slice(2, eq), a.slice(eq + 1)])
      continue
    }
    let next = argv[i + 1]
    if (next != undefined && !next.startsWith('--')) {
      opts.push([a.slice(2), next]), i++
    } else opts.push([a.slice(2), true])
  }
  return { opts, words }
}

/** `@path` reads that file, `-` and `@-` read stdin, anything else is used as
 * given. */
export let inflate = async (word: string, reads?: Reads): Promise<string> => {
  if (!reads) return word
  if (word == '-' || word == '@-') return await reads.stdin()
  return word.startsWith('@') ? await reads.file(word.slice(1)) : word
}

let parsed = (name: string, raw: string, want: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    throw new Usage(`--${name} wants ${want}, and this is not JSON: ${raw}`)
  }
}

/** One expanded argument, converted to the type its property declares. A
 * string stays a string — JSON-looking or not — so a title that reads like a
 * number is still a title. */
export let valueOf = (name: string, raw: string, p?: Prop): unknown => {
  let want = typeOf(p)
  if (want == 'boolean') {
    if (raw == 'true' || raw == '1') return true
    if (raw == 'false' || raw == '0') return false
    throw new Usage(`--${name} wants true or false, got ${raw}`)
  }
  if (want == 'number' || want == 'integer') {
    let n = Number(raw)
    if (raw.trim() == '' || Number.isNaN(n)) {
      throw new Usage(`--${name} wants a number, got ${raw}`)
    }
    return n
  }
  if (want == 'object') {
    let v = parsed(name, raw, 'an object')
    if (!v || typeof v != 'object' || Array.isArray(v)) {
      throw new Usage(`--${name} wants an object, got ${raw}`)
    }
    return v
  }
  if (want == 'array') {
    // A whole array as JSON, or one item — repeat the option for more
    // (`--filters .a --filters .b`), which is how a list is typed without
    // getting brackets past a shell.
    let v = raw.trimStart().startsWith('[')
      ? parsed(name, raw, 'an array')
      : null
    if (Array.isArray(v)) return v
    return [valueOf(name, raw, p?.items)]
  }
  return raw
}

let listed = (names: string[]): string =>
  names.length ? names.map((n) => `--${n}`).join(', ') : '(no arguments)'

let restOf = (tool: Grammar): string | undefined => {
  let last = tool.positional?.at(-1)
  return last?.endsWith('...') ? last.slice(0, -3) : undefined
}

/**
 * The arguments a tool was given, parsed through its own input schema — the
 * one grammar there is. The bare words fill `positional` in order; a final
 * name suffixed `...` takes the remaining words; `name=value`, `--name value`,
 * `--name=value` and a declared short `-n` name a property, a boolean one is a
 * flag, a repeated one builds its list, and `--` ends the options. Every value
 * expands (`@path`, `-`) before its type is consulted, and the whole object is
 * then validated against the schema, which is also what fills in its defaults.
 *
 * Throws {@link Usage} — exit code 2 — for anything the command line got
 * wrong.
 */
export let argsFor = async (
  tool: Grammar,
  argv: readonly string[],
  reads?: Reads,
): Promise<Record<string, unknown>> => {
  let props = ((tool.inputSchema ?? {}) as Schema).properties ?? {}
  let rest = restOf(tool)
  let forward = tool.forward
  let { pairs, spare } = scanned(tool, argv)
  let out: Record<string, unknown> = {}
  for (let [name, raw] of pairs) {
    let value = raw === true
      ? true
      : valueOf(name, await inflate(raw, reads), props[name])
    let had = out[name]
    out[name] = Array.isArray(had) && Array.isArray(value)
      ? [...had, ...value]
      : value
  }

  // Forwarded words keep their spelling until the receiving schema parses
  // them. In particular, a file value must expand exactly once, at that door.
  if (forward) out[forward] = spare
  else if (rest && spare.length) {
    let had = out[rest]
    let values = await Promise.all(spare.map((w) => inflate(w, reads)))
    out[rest] = typeOf(props[rest]) == 'array'
      ? [
        ...Array.isArray(had) ? had : [],
        ...values.flatMap((v) => valueOf(rest, v, props[rest])),
      ]
      : [had, ...values].filter((w) => w != undefined).join(' ')
  }

  if (!tool.inputSchema) {
    if (Object.keys(out).length) {
      throw new Usage(`${commandOf(tool)} takes no arguments`)
    }
    return out
  }
  try {
    return validateToolInput(
      { inputSchema: tool.inputSchema as Record<string, unknown> },
      out,
    )
  } catch (e) {
    throw new Usage((e as Error).message)
  }
}

export let commandFor = <T extends Grammar>(
  tools: readonly T[],
  argv: readonly string[],
): { verb: T; args: string[] } | undefined => {
  let [word, next] = argv
  if (!word) return undefined
  for (let t of tools) {
    if (t.noun && t.verb) {
      if (
        (t.noun == word && t.verb == next) || (t.verb == word && t.noun == next)
      ) return { verb: t, args: argv.slice(2) }
    } else if (commandOf(t) == word) return { verb: t, args: argv.slice(1) }
  }
}

/** A typed line's words and their replacement ranges. Incomplete quotes are
 * allowed only while completing; parsing asks for a closed line. */
export let tokensIn = (
  line: string,
  partial = false,
): { value: string; from: number; to: number }[] => {
  let words: { value: string; from: number; to: number }[] = []
  let value = '', quote = '', from = -1
  for (let i = 0; i < line.length; i++) {
    let c = line[i]
    if (from < 0 && !/\s/.test(c)) from = i
    if (c == '\\' && i + 1 < line.length) value += line[++i]
    else if (quote) {
      if (c == quote) quote = ''
      else value += c
    } else if (c == '"' || c == "'") quote = c
    else if (/\s/.test(c)) {
      if (from >= 0) words.push({ value, from, to: i })
      value = '', from = -1
    } else value += c
  }
  if (quote && !partial) throw new Usage('Close the quoted argument.')
  if (from >= 0) words.push({ value, from, to: line.length })
  else if (partial) {
    words.push({ value: '', from: line.length, to: line.length })
  }
  return words
}

/** The single argument walk used by parsing and completion. A partial walk
 * reports the property still awaiting a value, without requiring the schema's
 * remaining mandatory properties. */
export let scanned = (
  tool: Grammar,
  argv: readonly string[],
  partial = false,
): {
  pairs: [string, string | true][]
  spare: string[]
  given: Set<string>
  literal: boolean
  pending: string | undefined
  awaiting: string | undefined
} => {
  let props = ((tool.inputSchema ?? {}) as Schema).properties ?? {}
  let rest = restOf(tool)
  let forward = tool.forward
  let positional = (tool.positional ?? []).filter((n) => !n.endsWith('...'))
  let shorts = Object.fromEntries(
    Object.entries(props).flatMap(([name, p]) =>
      p.short ? [[p.short, name]] : []
    ),
  )
  let pairs: [string, string | true][] = [], spare: string[] = []
  let given = new Set<string>(),
    at = 0,
    literal = false,
    awaiting: string | undefined,
    pending: string | undefined
  let put = (name: string, raw: string | true) => {
    if (
      partial && name != rest && raw !== true && !raw.startsWith('@') &&
      raw != '-'
    ) {
      let value = valueOf(name, raw, props[name])
      try {
        validateToolInput({
          inputSchema: { type: 'object', properties: { [name]: props[name] } },
        }, { [name]: value })
      } catch (e) {
        throw new Usage((e as Error).message)
      }
    }
    pairs.push([name, raw])
    given.add(name)
  }
  for (let i = 0; i < argv.length; i++) {
    let word = argv[i]
    if (!literal && word == '--') {
      literal = true
      if (forward) spare.push(word)
      continue
    }
    let eq = word.indexOf('=')
    let flag = eq > 0 ? word.slice(0, eq) : word
    let name = flag.startsWith('--') ? flag.slice(2) : shorts[flag.slice(1)]
    if (!literal && (flag.startsWith('--') || flag.startsWith('-') && name)) {
      let p = forward &&
          (name == forward || positional.includes(name) && given.has(name))
        ? undefined
        : props[name]
      if (!p && forward) {
        spare.push(word)
        continue
      }
      if (!p) {
        throw new Usage(
          `Unknown option: ${flag} — ${commandOf(tool)} takes ${
            listed(Object.keys(props))
          }`,
        )
      }
      if (eq > 0) {
        put(name, word.slice(eq + 1))
        continue
      }
      let next = argv[i + 1]
      if (
        typeOf(p) == 'boolean' &&
        (next == undefined ||
          !['true', 'false', '1', '0', '-'].includes(next) &&
            !next.startsWith('@'))
      ) {
        put(name, true)
        if (partial && next == undefined) awaiting = name
      } else if (next == undefined || next.startsWith('--')) {
        if (!partial || next != undefined) {
          throw new Usage(`${flag} needs a value`)
        }
        awaiting = name
        pending = name
      } else put(name, argv[++i])
      continue
    }
    if (!literal && eq > 0 && Object.hasOwn(props, word.slice(0, eq))) {
      put(word.slice(0, eq), word.slice(eq + 1))
      continue
    }
    while (at < positional.length && given.has(positional[at])) at++
    if (at < positional.length) put(positional[at++], word)
    else if (rest && !given.has(rest)) put(rest, word)
    else if (rest || forward) spare.push(word)
    else {throw new Usage(
        `${commandOf(tool)} takes ${listed(Object.keys(props))}, not ${word}`,
      )}
  }
  if (partial && rest && given.has(rest)) {
    let raw = pairs.filter(([name]) => name == rest).at(-1)?.[1]
    let words = [raw, ...spare].filter((w): w is string => typeof w == 'string')
    if (!words.some((w) => w.startsWith('@') || w == '-')) {
      let prop = props[rest]
      let value = typeOf(prop) == 'array'
        ? words.flatMap((w) => valueOf(rest, w, prop))
        : words.join(' ')
      try {
        validateToolInput({
          inputSchema: { type: 'object', properties: { [rest]: prop } },
        }, { [rest]: value })
      } catch (e) {
        throw new Usage((e as Error).message)
      }
    }
  }
  while (at < positional.length && given.has(positional[at])) at++
  return {
    pairs,
    spare,
    given,
    literal,
    pending,
    awaiting: awaiting ?? positional[at] ??
      (rest && props[rest]?.type != undefined && typeOf(props[rest]) == 'string'
        ? rest
        : undefined),
  }
}
