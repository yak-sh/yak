import type { Bundle, Comp } from '@yaks/graph'
import { history } from './steps.ts'
import { document, type DocumentLens, type Json } from './document.ts'
import {
  and,
  every,
  map,
  never,
  or,
  present,
  type Query,
  want,
} from '@yaks/query'

/** A caller's latest step timestamp, keyed by the declaring package's eid. */
export type Speaks = Record<string, number>
/** The pilot's single operation. Paths name a component and one property. */
export type Rename = { rename: { from: string; to: string } }
/** The four pure directions of a compiled vocabulary change. */
export type Lens = {
  put: (bundle: Bundle) => Bundle
  get: (bundle: Bundle, held?: Bundle) => Bundle
  ask: (query: Query) => Query
  find: () => Query
}

type Pair = {
  from: [string, string]
  to: [string, string]
  change: DocumentLens
}
let own = (o: object, k: string) => Object.hasOwn(o, k)
let same = (a: unknown, b: unknown) => JSON.stringify(a) == JSON.stringify(b)
let fail = (why: string): never => {
  throw new Error(`Lens: ${why}`)
}
let path = (p: unknown): [string, string] => {
  if (typeof p != 'string' || !/^[_a-zA-Z]\w*\.[_a-zA-Z]\w*$/.test(p)) {
    return fail(`expected comp.prop, got ${JSON.stringify(p)}`)
  }
  return p.split('.') as [string, string]
}

// A rename consumes only the property the patch says. Null clears that
// property; omission never becomes a clear. A component deletion clears the
// moved property too, without deleting unrelated destination properties.
let put = (b: Bundle, pairs: Pair[]): Bundle => {
  let out = b
  for (let { from: [fc, fp], to: [tc], change } of pairs) {
    let source = out[fc] as Comp | null | undefined
    if (source === undefined || source !== null && !own(source, fp)) continue
    let dest = out[tc] as Comp | null | undefined
    if (source === null && fc == tc) continue
    if (dest === null && source !== null && source[fp] !== null) {
      fail(`conflicting writes to ${fc}.${fp} and removed ${tc}`)
    }
    // Component null is a patch instruction, rather than JSON null data.
    // Expose its property clear to the shared document operation, then retain
    // the component removals on the translated patch.
    let patch = source === null ? { ...out, [fc]: { [fp]: null } } : out
    if (dest === null) patch = { ...patch, [tc]: {} }
    out = change.put(patch as Json) as Bundle
    if (source === null) out = { ...out, [fc]: null }
    if (dest === null) out = { ...out, [tc]: null }
  }
  if (b.$was) {
    let guard = put({ entity: b.entity, ...b.$was }, pairs)
    let { entity: _, ...was } = guard
    if (!same(was, b.$was)) out = { ...out, $was: was as Bundle['$was'] }
  }
  return out
}

// Keep the target: it was already a word in the old vocabulary, too. A
// snapshot supplies its own membership. A feed patch may consult a held row
// for membership, but never copies that row's unrelated properties.
let get = (b: Bundle, pairs: Pair[], held?: Bundle): Bundle => {
  let out = b
  for (let { from: [fc, fp], to: [tc, tp] } of pairs.toReversed()) {
    let src = out[fc] as Comp | null | undefined
    let dst = out[tc] as Comp | null | undefined
    if (fc != tc) {
      if (src === null || !(src === undefined ? held?.[fc] : src)) continue
      if (dst === null) {
        out = { ...out, [fc]: { ...(src ?? {}), [fp]: null } }
        continue
      }
    }
    if (!dst || !own(dst, tp)) continue
    out = { ...out, [fc]: { ...(src ?? {}), [fp]: dst[tp] } }
    if (fc == tc) {
      let c = out[fc] as Comp
      delete c[tp]
    }
  }
  return out
}

let identity: Lens = {
  put: (b) => b,
  get: (b) => b,
  ask: (q) => q,
  find: () => and(never()),
}
let cache = new Map<string, Lens>()

/** Compile stored `_lens` rows once. Missing `speaks` means before all steps
 * for moving stored rows; a plugin bypasses compilation for current callers.
 * Each package's immutable timestamp steps run in order. */
export let compile = (rows: Bundle[], speaks?: Speaks): Lens => {
  let groups = new Map<string, (Comp & { step: number })[]>()
  for (let row of rows) {
    if (!row._lens) continue
    let s = row._lens as Comp & { step: number }
    if (typeof s.package != 'string' || !s.package) {
      fail('a step needs its package eid')
    }
    let pkg = String(s.package)
    let steps = groups.get(pkg) ?? []
    steps.push(s)
    groups.set(pkg, steps)
  }
  let ordered = [...groups].toSorted(([a], [b]) => a.localeCompare(b)).map(
    ([pkg, steps]) => [pkg, history(steps, speaks ? speaks[pkg] : 0)] as const,
  )
  for (let [pkg, version] of Object.entries(speaks ?? {})) {
    if (typeof version != 'number') {
      fail(`unknown version ${version} for ${pkg}`)
    }
    if (!groups.has(pkg)) history([], version)
  }
  let key = JSON.stringify([ordered.map(([pkg, h]) => [pkg, h.steps]), speaks])
  let hit = cache.get(key)
  if (hit) return hit
  let pairs: Pair[] = []
  for (let [, { steps, remaining }] of ordered) {
    let selected = new Set(remaining)
    for (let s of steps) {
      if (!Array.isArray(s.ops)) fail(`step ${s.step} ops must be an array`)
      for (let op of s.ops as Rename[]) {
        if (!op || !op.rename || Object.keys(op).length != 1) {
          fail('only rename is supported')
        }
        let from = path(op.rename.from), to = path(op.rename.to)
        if (from.join('.') == to.join('.')) {
          fail('a rename must change its path')
        }
        if (selected.has(s)) {
          pairs.push({ from, to, change: document([{ rename: { from, to } }]) })
        }
      }
    }
  }
  let lens: Lens = !pairs.length ? identity : {
    put: (b) => put(b, pairs),
    get: (b, held) => get(b, pairs, held),
    ask: (q) => {
      let extra = new Map<string, ReturnType<typeof want>>()
      let rewrite = (p: string[]): string[] => {
        let out = p
        for (let { from, to } of pairs) {
          for (let i = 0; i < out.length - 1; i++) {
            if (out[i] == from[0] && out[i + 1] == from[1]) {
              if (i == 0 && from[0] != to[0]) {
                extra.set(`want:${from[0]}`, want(from[0]))
              }
              out = [...out.slice(0, i), ...to, ...out.slice(i + 2)]
              i++
            }
          }
        }
        return out
      }
      let out = map(q, (c) => {
        if (c.kind == 'pred' && c.path.length == 1) {
          for (let { from, to } of pairs) {
            if (c.path[0] == from[0] && from[0] != to[0] && c.op != '=') {
              extra.set(`want:${to[0]}`, want(to[0]))
            }
          }
        }
        if ('path' in c) {
          let p = rewrite(c.path)
          if (p === c.path) return c
          let changed = { ...c, path: p }
          if (
            c.kind == 'pred' && c.path.length == 2 && p[0] != c.path[0] &&
            c.op != '?' &&
            !(c.op == '=' && c.value?.kind == 'scalar' && c.value.raw == '')
          ) return and(present(c.path[0]), changed)
          return changed
        }
        if (c.kind == 'fields') {
          return {
            ...c,
            fields: c.fields.map((f) => ({ ...f, path: rewrite(f.path) })),
          }
        }
        if (c.kind == 'edges') {
          return {
            ...c,
            peers: c.peers.map(rewrite),
            ...(c.select?.via
              ? { select: { ...c.select, via: rewrite(c.select.via) } }
              : {}),
          }
        }
        if (c.kind == 'order') {
          let sign = c.value.startsWith('-') ? '-' : ''
          return {
            ...c,
            value: sign +
              rewrite(c.value.slice(sign.length).split('.')).join('.'),
          }
        }
        if ((c.kind == 'ensure' || c.kind == 'mutable') && c.prop) {
          let [comp, prop] = rewrite([c.comp, c.prop])
          return { ...c, comp, prop }
        }
        return c
      }) as Query
      return extra.size ? and(...out.clauses, ...extra.values()) : out
    },
    find: () =>
      and(or(...pairs.map((p) => present(p.from.join('.')))), every()),
  }
  if (cache.size >= 64) cache.delete(cache.keys().next().value!)
  cache.set(key, lens)
  return lens
}
