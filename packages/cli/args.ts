// The command line as a tool's arguments. The tool's own input schema is the
// only grammar there is: `--name value` names a property, and what the schema
// says that property IS decides whether the word stays a word, parses as JSON,
// or becomes a number.
//
// Three spellings inflate a value before its type is ever consulted, because a
// body is rarely something a person types: `@path` is that file's text, `-` and
// `@-` are stdin, and everything else is the word itself. That is what makes
//
//   yaks app_files --app recipes --path index.html --content @index.html
//
// the same command whether the page is two lines or two hundred.
//
// Refusing a name the schema does not declare is deliberate: the roster keeps
// the cached schema fresh (store.ts), so an undeclared `--nmae` is a typo and
// worth a sentence here rather than a refusal one round trip away.

import { type Prop, type Schema, type Tool, typeOf } from './tool.ts'

/** The command line was wrong — nothing was called, and the exit code is 2. */
export class Usage extends Error {}

/** Where an inflated value comes from. A test hands over two functions and
 * touches no disk. */
export type Reads = {
  file: (path: string) => string | Promise<string>
  stdin: () => string | Promise<string>
}

/** What the words on a command line said: options in the order they were
 * given (a bare flag says `true`), and the words that named nothing. */
export type Said = {
  opts: [string, string | true][]
  words: string[]
}

/**
 * Split a command line into options and bare words. A `--name` whose next word
 * is not itself an option takes it as its value; otherwise it is a flag.
 * `--name=value` always takes the value, which is how a value that starts with
 * `--` is given at all.
 *
 * ```ts
 * saidIn(['--q', '.recipe!', '--json'])
 * // { opts: [['q', '.recipe!'], ['json', true]], words: [] }
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

/** `@path` is that file, `-` and `@-` are stdin, anything else is itself. */
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

/** One inflated word given the type its property declares. A string stays a
 * string — JSON-looking or not — so a title that reads like a number is still
 * a title. */
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
    // quoting brackets past a shell.
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

/**
 * The arguments a tool was given, mapped through its schema. Throws
 * {@link Usage} for a name the tool does not declare, a value its type cannot
 * be, and a required argument nobody gave.
 */
export let argsFor = async (
  tool: Tool,
  argv: string[],
  reads: Reads,
): Promise<Record<string, unknown>> => {
  let schema: Schema = tool.inputSchema ?? {}
  let props = schema.properties ?? {}
  let { opts, words } = saidIn(argv)
  if (words.length) {
    throw new Usage(
      `${tool.name} takes named arguments — try --${
        Object.keys(props)[0] ?? 'name'
      } ${words[0]}`,
    )
  }
  let out: Record<string, unknown> = {}
  for (let [name, given] of opts) {
    let p = props[name]
    if (!p) {
      throw new Usage(
        `${tool.name} takes ${listed(Object.keys(props))}, not --${name}`,
      )
    }
    if (given === true) {
      if (typeOf(p) != 'boolean') throw new Usage(`--${name} needs a value`)
      out[name] = true
      continue
    }
    let value = valueOf(name, await inflate(given, reads), p)
    // A repeated option builds the list its property asked for.
    let had = out[name]
    out[name] = Array.isArray(had) && Array.isArray(value)
      ? [...had, ...value]
      : value
  }
  let missing = (schema.required ?? []).filter((n) => !(n in out))
  if (missing.length) {
    throw new Usage(`${tool.name} needs ${listed(missing)}`)
  }
  return out
}
