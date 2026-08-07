// Typed scalar parsing and formatting. PropType declares the language;
// this module gives every declaration one canonical stored and shown value.
import { type Change, comps, edges, type PropType, stamped } from './types.ts'
import { instant, local } from './time.ts'
import { normalize } from './url.ts'

export type PropContext = {
  now?: number
  resolve?: (id: string) => string | undefined
  describe?: (eid: string) => string | undefined
  // What the caller probably meant, already checked to resolve (near.ts).
  // `comp` is the reference's declared target, so a bad `.project=` can
  // only ever be answered with a project.
  near?: (id: string, comp: string) => string | undefined
}

export type Prop = {
  comp: string
  prop: string
  name: string
  type: PropType
}

let types = (comp: string) => ({ ...comps[comp], ...stamped[comp] })

// The qualified name is only noise until two components share the column.
export let propAt = (comp: string, prop: string): Prop | undefined => {
  let type = types(comp)[prop]
  if (!type) return
  let owners = [...new Set([...Object.keys(comps), ...Object.keys(stamped)])]
    .filter((c) => prop in types(c))
  return {
    comp,
    prop,
    name: owners.length > 1 ? `${comp}.${prop}` : prop,
    type,
  }
}

// The columns a component declares as BODIES — the long markdown that no
// board, list or dot view reads, and the one slice a payload may leave
// behind (subs.ts `bodyless`). Derived from the vocabulary, so a new body
// column is deferred and healed without touching either end.
export let bodyCols = (comp: string) =>
  Object.entries(types(comp)).filter(([, t]) => t == 'body').map(([p]) => p)

let got = (v: unknown) => String(v)
let fail = (p: Prop, grammar: string, v: unknown): never => {
  throw new Error(`${p.name} is ${grammar} — got '${got(v)}'`)
}

let DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
let UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let number = (p: Prop, v: unknown): number => {
  let s = typeof v == 'string' ? v.trim() : String(v)
  if (
    (typeof v != 'string' && typeof v != 'number') ||
    !DECIMAL.test(s) ||
    !Number.isFinite(Number(s))
  ) {
    return fail(p, 'a finite decimal number (1, -2.5, 6e3)', v)
  }
  return Number(s)
}

let priority = (p: Prop, v: unknown) => {
  let s = typeof v == 'string' ? v.trim().replace(/^p/i, '') : String(v)
  if (
    (typeof v != 'string' && typeof v != 'number') ||
    !DECIMAL.test(s) ||
    !Number.isFinite(Number(s))
  ) {
    return fail(p, 'a finite number, optionally P-prefixed (P2, p02, 1.5)', v)
  }
  return Number(s)
}

let bool = (p: Prop, v: unknown): number => {
  let s = String(v).trim().toLowerCase()
  if (s == 'true' || s == '1' || s == 'yes') return 1
  if (s == 'false' || s == '0' || s == 'no') return 0
  return fail(p, 'a boolean (true, false, 1, 0, yes, no)', v)
}

let time = (p: Prop, v: unknown, ctx: PropContext): string => {
  if (typeof v != 'string') {
    return fail(p, 'a time (today, 1 hour ago, in 60m, or ISO stamp)', v)
  }
  let at = instant(v, ctx.now)
  if (at == null || !Number.isFinite(at)) {
    return fail(p, 'a time (today, 1 hour ago, in 60m, or ISO stamp)', v)
  }
  return new Date(at).toISOString()
}

let oneOf = (p: Prop, v: unknown): string => {
  let type = p.type as Extract<PropType, { enum: readonly string[] }>
  let s = typeof v == 'string' ? v : ''
  let declared = type.enum.find((x) => x.toLowerCase() == s.toLowerCase())
  let alias = Object.entries(type.aliases ?? {})
    .find(([a]) => a.toLowerCase() == s.toLowerCase())?.[1]
  let value = declared ??
    type.enum.find((x) => x.toLowerCase() == alias?.toLowerCase())
  return value ?? fail(p, `one of ${type.enum.join(', ')}`, v)
}

// `.project=tasks` is the shape: a token that IS a venture in the fleet,
// under an alias that diverges. When a near match resolves, naming it is
// the whole message — the grammar is not what the caller got wrong, and
// it is spelled by the noun the column carries ('no project', not 'no
// project_eid'). Nothing close: the grammar line, plainly, no guess.
let noun = (p: Prop) => p.prop == 'eid' ? 'entity' : p.prop.replace(/_eid$/, '')
let eid = (p: Prop, v: unknown, ctx: PropContext): string => {
  let s = String(v).trim()
  if (UUID.test(s)) return s.toLowerCase()
  let found = ctx.resolve?.(s)
  if (found && UUID.test(found)) return found.toLowerCase()
  let target = typeof p.type == 'object' && 'eid' in p.type ? p.type.eid : ''
  let near = ctx.near?.(s, target)
  if (near) throw new Error(`no ${noun(p)} '${s}' — did you mean ${near}?`)
  return fail(p, 'a human id / alias / UUID', v)
}

let text = (p: Prop, v: unknown): string =>
  typeof v == 'string' ? v : fail(p, 'text', v)

// A page address is text with ONE canonical spelling (url.ts normalize).
// Living here is what keeps a save and a query in agreement without
// either side knowing: both grammars parse their scalars through this
// module, so `.url=https://x.com/p?utm_source=n#top` written and the same
// string filtered land on the same characters.
let url = (p: Prop, v: unknown): string => normalize(text(p, v))

let tag = (t: PropType) =>
  typeof t == 'string' ? t : 'enum' in t ? 'enum' : 'eid' in t ? 'eid' : 'text'

let nullable = (t: PropType) =>
  ['number', 'priority', 'bool', 'time', 'eid'].includes(tag(t))

type Parser = (
  p: Prop,
  input: unknown,
  ctx: PropContext,
) => string | number

let parsers: Record<string, Parser> = {
  number,
  priority,
  bool,
  time,
  enum: oneOf,
  eid,
  text,
  url,
}

// Null always passes through. Empty text is text; empty optional scalars clear.
export let parseProp = (
  p: Prop,
  input: unknown,
  ctx: PropContext = {},
): string | number | null => {
  if (input == null) return null
  if (input === '' && nullable(p.type)) return null
  return (parsers[tag(p.type)] ?? text)(p, input, ctx)
}

export let formatProp = (
  p: Prop,
  value: unknown,
  ctx: PropContext = {},
): string | null => {
  let parsed = parseProp(p, value, ctx)
  if (parsed == null) return null
  if (tag(p.type) == 'priority') return `P${parsed}`
  if (tag(p.type) == 'bool') return parsed ? 'true' : 'false'
  // A stamp is stored Zulu but SHOWN local — one door for every face.
  if (tag(p.type) == 'time') return local(String(parsed))
  if (tag(p.type) == 'eid') {
    return ctx.describe?.(String(parsed)) ?? String(parsed)
  }
  return String(parsed)
}

let ref = (name: string): Prop => ({
  comp: 'entity',
  prop: name,
  name,
  type: { eid: '', death: 'keep' },
})
let dep: Record<string, Prop> = {
  type: {
    comp: 'dependency',
    prop: 'type',
    name: 'dependency.type',
    type: { enum: [...edges] },
  },
  child_eid: ref('child_eid'),
  gone: {
    comp: 'dependency',
    prop: 'gone',
    name: 'dependency.gone',
    type: 'bool',
  },
}

let requiredRef = (
  p: Prop,
  value: unknown,
  ctx: PropContext,
): string => {
  let parsed = parseProp(p, value, ctx)
  if (parsed == null) return fail(p, 'a human id / alias / UUID', value)
  return String(parsed)
}

// A batch gets one value language before any writer observes it. Unknown
// components and server-owned columns stay untouched for the db allowlist;
// every declared scalar and dependency word leaves in canonical form.
export let normalizeChanges = (
  changes: Change[],
  ctx: PropContext = {},
): Change[] =>
  changes.map((change) => {
    let eid = requiredRef(ref('eid'), change.eid, ctx)
    if (change.comp == null) return { ...change, eid }
    let props = change.name == 'dependency' ? dep : undefined
    let comp = Object.fromEntries(
      Object.entries(change.comp).map(([name, value]) => {
        let p = props?.[name] ??
          (name in (comps[change.name] ?? {})
            ? propAt(change.name, name)
            : undefined)
        if (!p) return [name, value]
        if (change.name == 'dependency' && name == 'child_eid') {
          return [name, requiredRef(p, value, ctx)]
        }
        return [name, parseProp(p, value, ctx)]
      }),
    )
    return { ...change, eid, comp }
  })
