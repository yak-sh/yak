// The command line, parsed into a tool's arguments. The tool's own input
// schema is the only grammar there is: `--name value` names a property, and
// the type that property declares decides whether the argument stays a string,
// is parsed as JSON, or becomes a number.
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
  options?: {
    positional?: readonly string[]
    short?: Readonly<Record<string, string>>
    rest?: string
  }
}

/** The command line was wrong — nothing ran, and the exit code is 2. */
export class Usage extends Error {}

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
export let inflate = async (word: string, reads: Reads): Promise<string> => {
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

/**
 * Bare `key=value` arguments as an object — the arguments of something whose
 * schema this program does not have, such as an app's own command. Each value
 * is parsed as JSON where it parses as JSON, so a number stays a number and a
 * list stays a list, and is used as given otherwise; `@path` and `-` expand
 * first, the same three forms every value here accepts.
 *
 * ```ts
 * await pairsIn(['serves=4', 'title=Lemon cake'], reads)
 * // { serves: 4, title: 'Lemon cake' }
 * ```
 */
export let pairsIn = async (
  words: string[],
  reads: Reads,
): Promise<Record<string, unknown>> => {
  let out: Record<string, unknown> = {}
  for (let word of words) {
    let eq = word.indexOf('=')
    if (eq <= 0) throw new Usage(`not an argument: ${word} — want key=value`)
    let raw = await inflate(word.slice(eq + 1), reads)
    try {
      out[word.slice(0, eq)] = JSON.parse(raw)
    } catch {
      out[word.slice(0, eq)] = raw
    }
  }
  return out
}

let listed = (names: string[]): string =>
  names.length ? names.map((n) => `--${n}`).join(', ') : '(no arguments)'

/**
 * The arguments a tool was given, parsed through its own input schema — the
 * one grammar there is. The bare words fill `options.positional` in order and
 * then `options.rest`; `--name value`, `--name=value` and a declared short
 * `-n` name a property, a boolean one is a flag, a repeated one builds its
 * list, and `--` ends the options. Every value expands (`@path`, `-`) before
 * its type is consulted, and the whole object is then validated against the
 * schema, which is also what fills in its defaults.
 *
 * Throws {@link Usage} — exit code 2 — for anything the command line got
 * wrong.
 */
export let argsFor = async (
  tool: Grammar,
  argv: readonly string[],
  reads: Reads,
): Promise<Record<string, unknown>> => {
  let schema = (tool.inputSchema ?? {}) as Schema
  let props = schema.properties ?? {}
  let positional = tool.options?.positional ?? []
  let shorts = tool.options?.short ?? {}
  let rest = tool.options?.rest
  let out: Record<string, unknown> = {}
  let spare: string[] = []
  let at = 0
  let literal = false

  let prop = (name: string, flag: string): Prop => {
    let p = props[name]
    if (!p) {
      throw new Usage(
        `Unknown option: ${flag} — ${commandOf(tool)} takes ${
          listed(Object.keys(props))
        }`,
      )
    }
    return p
  }
  let put = async (name: string, raw: string) => {
    let value = valueOf(name, await inflate(raw, reads), props[name])
    let had = out[name]
    // A repeated option builds the list its property asked for.
    out[name] = Array.isArray(had) && Array.isArray(value)
      ? [...had, ...value]
      : value
  }

  for (let i = 0; i < argv.length; i++) {
    let word = argv[i]
    if (!literal && word == '--') {
      literal = true
      continue
    }
    // An option is `--name`, or a `-n` the tool declared as a short. Anything
    // else starting with a dash is a bare word: `-5` is a number somebody
    // typed, not an option nobody declared.
    let eq = word.indexOf('=')
    let flag = eq > 0 ? word.slice(0, eq) : word
    let short = flag.length > 1 && !flag.startsWith('--') &&
      flag.startsWith('-') && shorts[flag.slice(1)]
    if (!literal && (flag.startsWith('--') && flag.length > 2 || short)) {
      let name = flag.startsWith('--') ? flag.slice(2) : shorts[flag.slice(1)]
      let p = prop(name, flag)
      if (eq > 0) {
        await put(name, word.slice(eq + 1))
        continue
      }
      if (typeOf(p) == 'boolean') {
        out[name] = true
        continue
      }
      let next = argv[i + 1]
      if (next == undefined || next.startsWith('--')) {
        throw new Usage(`${flag} needs a value`)
      }
      await put(name, argv[++i])
      continue
    }
    if (at < positional.length) await put(positional[at++], word)
    else if (rest) spare.push(word)
    else {
      throw new Usage(
        `${commandOf(tool)} takes ${listed(Object.keys(props))}, not ${word}`,
      )
    }
  }

  // The bare words nothing claimed, where the tool asked for them: an app's
  // own arguments as `key=value` pairs, or a plain list.
  if (rest && spare.length) {
    out[rest] = typeOf(props[rest]) == 'array'
      ? await Promise.all(spare.map((w) => inflate(w, reads)))
      : await pairsIn(spare, reads)
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
