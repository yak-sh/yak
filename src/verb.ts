// The shell verb vocabulary: one declaration of positional arguments,
// options and dot-param policy, rendered by the manual and parsed by the CLI.

import type { Param } from './client.ts'
import type { PropType } from './types.ts'

export type Kind = {
  name: string
  // The finite candidate set, when one is knowable HERE. `undefined` means
  // "this process cannot say" — a catalog that lives in the graph, read by a
  // CLI with no graph beside it — and every reader must then fall back to the
  // metavar name and to accepting the value, never to rejecting everything.
  of?: () => string[] | undefined
  test?: RegExp
  id?: boolean
  read?: boolean | 'file'
}

export type Arg = {
  name: string
  kind: Kind
  eg?: string
  rest?: boolean
  need?: boolean
}

export type Opt = {
  name: string
  kind?: Kind
  or?: string
  alias?: string
}

export type Dots = 'filters' | 'params' | string[] | undefined

// String values stay faithful to argv. `many` preserves token boundaries for
// a trailing slot whose grammar cares about them (filters and passthrough),
// while `args` gives ordinary handlers the named value they asked for.
export type Got = {
  args: Record<string, string>
  many: Record<string, string[]>
  opts: Record<string, string>
  flags: Set<string>
  params: Param[]
  words: string[]
  body?: string
}

export type Run = (got: Got) => unknown

export type Decl = {
  name: string
  about: string
  args?: Arg[]
  opts?: Opt[]
  dots?: Dots
  body?: 'body' | 'text'
  door: ('cli' | 'palette')[]
  some?: string[]
  examples?: string[]
  detail?: string
  retired?: Record<string, string>
  root?: boolean
  alias?: boolean
  passthrough?: boolean
  // Subject-first and colon syntax are routers rather than ordinary verbs.
  syntax?: string
}

export type Verb = Decl & { run: Run }

export let text: Kind = { name: 'text', test: /.+/ }
export let id: Kind = { name: 'id', test: /.+/, id: true }
export let path: Kind = { name: 'dir', test: /.+/ }
export let body: Kind = { name: 'body', test: /.+/, read: true }
export let file: Kind = { name: 'file', test: /.+/, read: 'file' }
export let num: Kind = { name: 'n', test: /^[1-9]\d*$/ }
// Bare durations retain the CLI's seconds convention.
export let duration: Kind = { name: 'duration', test: /^[1-9]\d*[smh]?$/ }

export let of = (
  name: string,
  values: () => string[] | undefined,
): Kind => ({
  name,
  of: values,
  // A remote catalog may be unknown, but an empty value is still missing.
  test: /.+/,
})

export let enumOf = (type: PropType, name = 'value'): Kind => {
  if (typeof type != 'object' || !('enum' in type)) return { name }
  return of(name, () => [
    ...type.enum,
    ...Object.keys(type.aliases ?? {}),
  ])
}

let slot = (arg: Arg) => `${arg.name}${arg.rest ? '…' : ''}`

let positional = (arg: Arg) =>
  arg.need === false ? `[${slot(arg)}]` : `<${slot(arg)}>`

// The positional shape of an argument list, `<name>`/`[name…]` — the usage
// half of the vocabulary, shared by CLI verbs (usageOf) and the `:` commands
// (commands.ts). The ghost paints the concrete `eg` instead; this paints the
// metavar name, the reference shape.
export let slotsOf = (args: Arg[] = []) => args.map(positional).join(' ')

let meta = (kind: Kind) => {
  let values = kind.of?.()?.join('|')
  return values && values.length <= 24 ? values : kind.name.toUpperCase()
}

let option = (opt: Opt, verb: Decl) => {
  let value = opt.kind ? `=${opt.or ?? meta(opt.kind)}` : ''
  let shape = `${opt.name}${value}`
  return verb.some?.length == 1 && verb.some[0] == opt.name
    ? shape
    : `[${shape}]`
}

export let usageOf = (verb: Decl) =>
  verb.syntax ?? [
    verb.name,
    slotsOf(verb.args),
    ...(verb.opts ?? []).map((opt) => option(opt, verb)),
  ].filter(Boolean).join(' ')

export let wordsOf = (verb: Decl): [number, number?] => {
  let args = verb.args ?? []
  let min = args.filter((arg) => arg.need !== false).length
  return args.some((arg) => arg.rest) ? [min] : [min, args.length]
}
