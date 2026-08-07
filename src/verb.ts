// The shell verb vocabulary: one declaration of positional arguments,
// options and dot-param policy, rendered by the manual and parsed by the CLI.

import type { PropType } from './types.ts'

export type Kind = {
  name: string
  of?: () => string[]
  test?: RegExp
  id?: boolean
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
  separate?: boolean
}

export type Dots = 'any' | string[] | undefined

// `run` joins this declaration in stage 2. The routing fields below keep the
// current dispatcher explicit until every handler consumes the parsed shape.
export type Verb<Run = unknown> = {
  name: string
  about: string
  args?: Arg[]
  opts?: Opt[]
  dots?: Dots
  body?: 'body' | 'text'
  door: ('cli' | 'palette')[]
  run?: Run
  some?: string[]
  examples?: string[]
  detail?: string
  deprecated?: string
  retired?: Record<string, string>
  root?: boolean
  alias?: boolean
  passthrough?: boolean
  // Subject-first and colon syntax are routers rather than ordinary verbs.
  syntax?: string
}

export let text: Kind = { name: 'text', test: /.+/ }
export let id: Kind = { name: 'id', test: /.+/, id: true }
export let path: Kind = { name: 'dir', test: /.+/ }
export let body: Kind = { name: 'body', test: /.+/ }
export let num: Kind = { name: 'n', test: /^[1-9]\d*$/ }

export let of = (name: string, values: () => string[]): Kind => ({
  name,
  of: values,
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

let meta = (kind: Kind) => {
  let values = kind.of?.().join('|')
  return values && values.length <= 24 ? values : kind.name.toUpperCase()
}

let option = (opt: Opt, verb: Verb) => {
  let value = opt.kind ? `=${opt.or ?? meta(opt.kind)}` : ''
  let shape = `${opt.name}${value}`
  return verb.some?.length == 1 && verb.some[0] == opt.name
    ? shape
    : `[${shape}]`
}

export let usageOf = (verb: Verb) =>
  verb.syntax ?? [
    verb.name,
    ...(verb.args ?? []).map(positional),
    ...(verb.opts ?? []).map((opt) => option(opt, verb)),
  ].join(' ')

export let wordsOf = (verb: Verb): [number, number?] => {
  let args = verb.args ?? []
  let min = args.filter((arg) => arg.need !== false).length
  return args.some((arg) => arg.rest) ? [min] : [min, args.length]
}
