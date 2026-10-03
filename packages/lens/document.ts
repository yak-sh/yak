import { history } from './steps.ts'

/** JSON documents have no graph vocabulary, storage or effects. */
export type Json = null | boolean | number | string | Json[] | {
  [key: string]: Json
}
/** Dotted paths are convenient; arrays preserve keys containing dots. */
export type Path = string | readonly (string | number)[]
type Move = { from: Path; to: Path }
type Default = { path: Path; default: Json }
type Part = Path | { value: string }
export type Op =
  | { rename: Move }
  | { hoist: Move }
  | { plunge: Move }
  | { add: Default }
  | { remove: Default }
  | {
    concat: {
      from: readonly Part[]
      to: Path
      separator?: string
      /** Append the joined string to a list; inverse consumes its last item. */
      append?: boolean
    }
  }
  | {
    scatter: {
      from: Path
      to: Path
      keyword: string
      /** A short-name map keys its destination by the entry's value. */
      key?: 'name' | 'value'
    }
  }
  | { in: { path: Path; ops: readonly Op[] } }
export type DocumentLens = {
  put: <T extends Json>(value: T) => Json
  get: <T extends Json>(value: T) => Json
}

const absent = Symbol('absent')
type Value = Json | typeof absent
let object = (v: Value): v is { [key: string]: Json } =>
  v !== absent && v !== null && typeof v == 'object' && !Array.isArray(v)
let fail: (why: string) => never = (why) => {
  throw new Error(`Lens: ${why}`)
}
let same = (a: Value, b: Value): boolean => {
  if (a === b) return true
  if (a === absent || b === absent) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length == b.length && a.every((v, i) => same(v, b[i]))
  }
  return object(a) && object(b) &&
    Object.keys(a).length == Object.keys(b).length &&
    Object.keys(a).every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
}
let path = (p: Path): string[] => {
  let parts = typeof p == 'string' ? p.split('.') : [...p].map(String)
  if (!parts.length || parts.some((k) => !k)) fail('a path needs nonempty keys')
  return parts
}
let read = (doc: Value, p: readonly string[]): Value => {
  let out = doc
  for (let key of p) {
    if (out === absent || out === null || typeof out != 'object') return absent
    if (!Object.hasOwn(out, key)) return absent
    out = (out as { [key: string]: Json })[key]
  }
  return out
}
// Copy only changed ancestors. No operation can mutate a caller's document or
// an authored default, including a later operation using that default.
let write = (doc: Value, p: readonly string[], value: Value): Value => {
  if (!p.length) return value
  let [key, ...rest] = p
  if (doc !== absent && (doc === null || typeof doc != 'object')) {
    fail(`cannot descend into ${key}`)
  }
  let held = doc === absent ? {} : doc as Json[] | { [key: string]: Json }
  let before = Object.hasOwn(held, key)
    ? (held as { [key: string]: Json })[key]
    : absent
  let after = write(before, rest, value)
  if (before === after || same(before, after)) return doc
  if (Array.isArray(held)) {
    let n = Number(key)
    if (!Number.isInteger(n) || n < 0 || n > held.length || String(n) != key) {
      fail(`invalid array index ${key}`)
    }
    let out = [...held]
    if (after === absent) out.splice(n, 1)
    else out[n] = after
    return out
  }
  let out = { ...held }
  if (after === absent) delete out[key]
  else {Object.defineProperty(out, key, {
      value: after,
      enumerable: true,
      writable: true,
      configurable: true,
    })}
  return out
}
let set = (doc: Json, p: string[], value: Json): Json => {
  let held = read(doc, p)
  if (held !== absent && !same(held, value)) {
    fail(`conflicting writes to ${p.join('.')}`)
  }
  return write(doc, p, value) as Json
}
let drop = (doc: Json, p: string[]): Json => write(doc, p, absent) as Json
let move = (doc: Json, from: string[], to: string[]): Json => {
  let value = read(doc, from)
  if (value === absent) return doc
  // Array moves consume before assigning, so indexes address the resulting
  // document. Object moves retain their now-empty source containers.
  return set(drop(doc, from), to, value)
}
let constant = (part: Part): part is { value: string } =>
  typeof part == 'object' && !Array.isArray(part) && 'value' in part
let escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
type Run = (doc: Json, backwards: boolean) => Json

let operation = (op: Op): Run => {
  if (!op || typeof op != 'object' || Object.keys(op).length != 1) {
    return fail('an operation needs exactly one name')
  }
  if ('rename' in op || 'hoist' in op || 'plunge' in op) {
    let spec = 'rename' in op ? op.rename : 'hoist' in op ? op.hoist : op.plunge
    let from = path(spec.from), to = path(spec.to)
    if (from.join('\0') == to.join('\0')) fail('a move must change its path')
    if (from.every((k, i) => to[i] == k) || to.every((k, i) => from[i] == k)) {
      fail('a move cannot contain its own source')
    }
    if ('hoist' in op && from.length <= to.length) {
      fail('hoist needs a shallower destination')
    }
    if ('plunge' in op && from.length >= to.length) {
      fail('plunge needs a deeper destination')
    }
    return (doc, backwards) =>
      backwards ? move(doc, to, from) : move(doc, from, to)
  }
  if ('add' in op || 'remove' in op) {
    let spec = 'add' in op ? op.add : op.remove
    let p = path(spec.path), value = structuredClone(spec.default)
    return (doc, backwards) => {
      let adding = 'add' in op ? !backwards : backwards
      let held = read(doc, p)
      if (adding) {
        return held === absent ? set(doc, p, structuredClone(value)) : doc
      }
      if (held === absent) return doc
      if (!same(held, value)) {
        fail(`removing ${p.join('.')} would lose a nondefault value`)
      }
      return drop(doc, p)
    }
  }
  if ('concat' in op) {
    let spec = op.concat, to = path(spec.to), separator = spec.separator ?? ''
    if (!spec.from.length) fail('concat needs parts')
    let parts = spec.from.map((p) =>
      constant(p) ? { value: p.value } : { path: path(p) }
    )
    let variables = parts.filter((p) => 'path' in p)
    if (!variables.length || variables.length > 1 && !separator) {
      fail('concat with multiple variable parts needs a separator')
    }
    let pattern = new RegExp(
      '^' + parts.map((p) =>
        'value' in p ? escape(p.value!) : '(.*?)'
      ).join(escape(separator)) + '$',
      's',
    )
    return (doc, backwards) => {
      if (!backwards) {
        let values = parts.map((p) =>
          'value' in p ? p.value : read(doc, p.path!)
        )
        if (
          values.some((v) =>
            v === absent
          )
        ) return doc
        if (values.some((v) => typeof v != 'string')) {
          fail('concat parts must be strings')
        }
        if (
          variables.length > 1 && values.some((v, i) =>
            'path' in parts[i] && String(v).includes(separator)
          )
        ) {
          fail('concat value contains its separator')
        }
        let joined = values.join(separator), out = doc
        for (let p of variables) out = drop(out, p.path!)
        if (!spec.append) return set(out, to, joined)
        let held = read(out, to)
        if (held !== absent && !Array.isArray(held)) {
          fail('concat append needs an array')
        }
        return write(out, to, [
          ...(held === absent ? [] : held as Json[]),
          joined,
        ]) as Json
      }
      let held = read(doc, to)
      if (held === absent) return doc
      let value: Value = held
      if (spec.append) {
        if (!Array.isArray(held)) fail('concat append needs an array')
        if (!held.length) return doc
        value = held.at(-1)!
      }
      if (typeof value != 'string') fail('concat inverse needs a string')
      let matched = pattern.exec(value)
      // An array may end in an ordinary positional, with no rest argument.
      if (!matched && spec.append) return doc
      if (!matched) fail('concat inverse does not match its literals')
      if (
        variables.length > 1 &&
        matched.slice(1).some((v) => v.includes(separator))
      ) {
        fail('concat inverse contains an ambiguous separator')
      }
      let out = spec.append
        ? held instanceof Array && held.length > 1
          ? write(doc, to, held.slice(0, -1)) as Json
          : drop(doc, to)
        : drop(doc, to)
      for (let i = 0; i < variables.length; i++) {
        out = set(out, variables[i].path!, matched![i + 1])
      }
      return out
    }
  }
  if ('scatter' in op) {
    let spec = op.scatter, from = path(spec.from), to = path(spec.to)
    if (!spec.keyword) fail('scatter needs a keyword')
    if (spec.key && spec.key != 'name' && spec.key != 'value') {
      fail('unknown scatter key')
    }
    return (doc, backwards) => {
      let source = read(doc, backwards ? to : from)
      if (source === absent) return doc
      if (!object(source)) fail('scatter needs an object')
      let out = doc
      if (!backwards) {
        for (let [name, value] of Object.entries(source)) {
          let key = spec.key == 'value' ? value : name
          if (typeof key != 'string') {
            fail('scatter destination keys must be strings')
          }
          let target = [...to, key]
          if (!object(read(out, target))) {
            fail(`scatter destination ${target.join('.')} must exist`)
          }
          out = set(
            out,
            [...target, spec.keyword],
            spec.key == 'value' ? name : value,
          )
        }
        return drop(out, from)
      }
      let gathered: { [key: string]: Json } = {}
      for (let [name, entry] of Object.entries(source)) {
        if (!object(entry) || !Object.hasOwn(entry, spec.keyword)) continue
        let value = entry[spec.keyword],
          key = spec.key == 'value' ? value : name
        if (typeof key != 'string') fail('gathered keys must be strings')
        if (Object.hasOwn(gathered, key)) fail(`duplicate gathered key ${key}`)
        Object.defineProperty(gathered, key, {
          value: spec.key == 'value' ? name : value,
          enumerable: true,
        })
        out = drop(out, [...to, name, spec.keyword])
      }
      return Object.keys(gathered).length ? set(out, from, gathered) : out
    }
  }
  if ('in' in op) {
    let parts = path(op.in.path), child = document(op.in.ops)
    let visit = (doc: Json, rest: string[], backwards: boolean): Json => {
      if (!rest.length) return backwards ? child.get(doc) : child.put(doc)
      let [head, ...tail] = rest
      if (doc === null || typeof doc != 'object') return doc
      let keys = head == '*' ? Object.keys(doc) : [head]
      let out: Json = doc
      for (let key of keys) {
        let value = read(out, [key])
        if (value !== absent) {
          out = write(out, [key], visit(value, tail, backwards)) as Json
        }
      }
      return out
    }
    return (doc, backwards) => visit(doc, parts, backwards)
  }
  return fail('unknown operation')
}

/** Compile a reversible JSON document change once. Omitted paths stay omitted;
 * null is data. Add/remove invert within their declared default, concat within
 * its delimiter, and scatter within the map's unique keys. Empty containers
 * survive moves; defaults and empty maps/lists have a canonical inverse. */
export let document = (ops: readonly Op[]): DocumentLens => {
  let runs = structuredClone(ops).map(operation), reverse = runs.toReversed()
  return {
    put: (value) => runs.reduce((out, run) => run(out, false), value as Json),
    get: (value) => reverse.reduce((out, run) => run(out, true), value as Json),
  }
}

/** Compile the timestamp suffix of a JSON format's declared changes. Zero
 * speaks before all changes, including when the argument is omitted. */
export let documentChain = (
  steps: readonly { step: number; ops: readonly Op[] }[],
  speaks = 0,
): DocumentLens =>
  document(history(steps, speaks).remaining.flatMap(({ ops }) => [...ops]))
