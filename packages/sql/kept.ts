// A query compiled once per shape. Lowering a query is the expensive part of
// a read, and a read is asked again and again with only its values changed: the
// effects pool asks for each handler's due run at a new `now` every pass, a
// write scopes its effects to the entities it touched. So `compile` keeps the
// statement each shape lowered to and binds the next call's values into it.
//
// A shape is the AST with every generated id it compares against stood in for
// by its place, plus every input the lowering reads: the options' data, the
// registries by identity, the extensions' hooks, and the archetype catalog's
// answers. The values a kept statement binds anew are the clock, the root
// candidates (`eids`), those ids, and the integer ids they resolve to.
//
// Where each value lands is proved, never inferred from the binder's code: a
// shape seen a second time is lowered twice more, at two fixed instants, with
// stand-in ids. Each parameter must then be the same in all of them (a
// constant), or the clock plus one fixed offset in both (`now`, `1 hour ago`),
// or exactly the stand-in for one input. The instants differ in their month's
// length, day, hour, minute and second, so a phrase that does not move one for
// one with the clock (`today`, `1 month ago`) never passes for one that does,
// and its shape is lowered on every call, as is a shape an extension compiled
// any part of (a `.near` reads its neighbourhood while it lowers). The proof
// ends by binding the first call's values into the kept statement and asking
// for the first call's statement back.
//
// Every answer for a shape carries the statement its first call lowered to as
// its `origin`: the observers that read it read structure (tables, verbs),
// never the values (./ast.ts `Raw`), and the structure is the shape's.
//
// The catalog is asked again on each call, every question in the order the
// lowering asked it: a statement is kept only while each answer stands.

import { type And, map, type Value } from '@yaks/query/core'
import type { Presence, Vocab } from '@yaks/vocab'
import { parse } from '@yaks/id'
import { type Param, type Raw, raw, type Stmt } from './ast.ts'
import { type BindOpts, type Prepared, prepared } from './bind.ts'
import type { ArchetypeSet } from './archetype.ts'
import { idOf } from './derived.ts'
import type { Extension, Site } from './extend.ts'
import { render } from './render.ts'

// The values one call binds into a kept statement.
type Call = {
  now: number
  roots: string[]
  operands: string[]
  refs: (number | null | undefined)[]
}
// A parameter a call supplies.
type Bind = (call: Call) => Param
// One question the lowering asked the catalog, and its answer.
type Asked =
  | { held: boolean | undefined }
  | { presence: Presence; ids: readonly number[] | undefined }
type Kept = {
  sql: string
  params: (Param | Bind)[]
  table?: string
  origin?: Stmt
  asked: Asked[]
}
// A shape seen once: its statement and what that call bound.
type Seen = { first: Raw; call: Call; asked: Asked[] }
// A shape that is lowered on every call.
type Lowered = null
type Shelf = Map<string, Kept | Seen | Lowered>

let SHELF = 512
let shelves = new WeakMap<Vocab, Shelf>()
let shelf = (v: Vocab): Shelf => {
  let found = shelves.get(v)
  if (!found) shelves.set(v, found = new Map())
  return found
}
let put = (s: Shelf, key: string, entry: Kept | Seen | Lowered) => {
  s.delete(key)
  if (s.size >= SHELF) s.delete(s.keys().next().value!)
  s.set(key, entry)
}

// A registry by identity: one the store holds is the same object every call.
let named = new WeakMap<object, number>(), names = 0
let identify = (o: object | undefined): number => {
  if (!o) return 0
  let n = named.get(o)
  if (n == null) named.set(o, n = ++names)
  return n
}

// The catalog as the lowering asks it, each question written down.
let recorded = (
  set: ArchetypeSet | undefined,
  log: Asked[],
): ArchetypeSet | undefined =>
  set && Object.defineProperty(
    (presence: Presence) => {
      let ids = set(presence)
      log.push({ presence, ids })
      return ids
    },
    'held',
    {
      get: () => {
        let held = set.held
        log.push({ held })
        return held
      },
    },
  ) as ArchetypeSet

let alike = (a?: readonly number[], b?: readonly number[]) =>
  a === b || !!a && !!b && a.length == b.length && a.every((x, i) => x === b[i])

// Whether the catalog still answers every question as it did.
let stands = (asked: Asked[], set?: ArchetypeSet): boolean =>
  asked.every((a) =>
    'presence' in a
      ? !!set && alike(set(a.presence), a.ids)
      : set?.held === a.held
  )

let agree = (a: Asked[], b: Asked[]) =>
  a.length == b.length && a.every((x, i) => {
    let y = b[i]
    return 'presence' in x
      ? 'presence' in y && alike(x.ids, y.ids) &&
        JSON.stringify(x.presence) == JSON.stringify(y.presence)
      : !('presence' in y) && x.held === y.held
  })

// The call whose extensions are watched: whether one answered for a clause
// or an order while it prepared and lowered. A lowering inside a lowering (a
// store read an extension makes) watches its own.
let watching: { any: boolean } | undefined
let within = <T>(touched: { any: boolean }, run: () => T): T => {
  let outer = watching
  watching = touched
  try {
    return run()
  } finally {
    watching = outer
  }
}
let mark = <T>(out: T): T => {
  if (out != null && watching) watching.any = true
  return out
}

// Each extension as the binder sees it, kept per extension so a call builds
// nothing: its hooks read live, each answer noted. A probe's extensions never
// begin: only a caller's call begins a query.
let hooked = new WeakMap<object, Extension['compile']>()
let hooks = (compile: Extension['compile']) => {
  let found = hooked.get(compile)
  if (!found) {
    hooked.set(
      compile,
      found = new Proxy(compile, {
        get: (hooks, kind) => {
          let f = hooks[kind as keyof typeof hooks]
          return f && ((c: never, s: Site) => mark(f(c, s)))
        },
      }),
    )
  }
  return found
}
let viewed = [new WeakMap<Extension, Extension>(), new WeakMap()]
let view = (e: Extension, begins: boolean): Extension => {
  let views = viewed[begins ? 1 : 0], found = views.get(e)
  if (!found) {
    views.set(
      e,
      found = {
        name: e.name,
        get compile() {
          return hooks(e.compile)
        },
        get order() {
          let order = e.order
          return order && ((value: string, s: Site) => mark(order(value, s)))
        },
        get begin() {
          return begins ? e.begin : undefined
        },
      },
    )
  }
  return found
}
let watched = (ext: Extension[] | undefined, begins: boolean) =>
  ext?.map((e) => view(e, begins))

// The ids a lowering treats as opaque: a uuid or a content hash.
let generated = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$|^[0-9a-f]{40,64}$/i

// The AST with every generated id a predicate compares against renamed.
let renamed = (ast: And, name: (id: string) => string): And => {
  let value = (v: Value): Value =>
    v.kind == 'scalar'
      ? generated.test(v.raw) ? { ...v, raw: name(v.raw) } : v
      : v.kind == 'list'
      ? { ...v, items: v.items.map(value) }
      : v.kind == 'range'
      ? { ...v, lo: value(v.lo), hi: value(v.hi) }
      : v
  return map(
    ast,
    (c) => c.kind == 'pred' && c.value ? { ...c, value: value(c.value) } : c,
  )
}

// A stand-in for an id, of its form, unlike any id in use. `family` keeps the
// two probes apart.
let stand = (id: string, family: number, k: number): string => {
  let tail = family.toString(16) + k.toString(16).padStart(11, '0')
  return id.includes('-')
    ? `ffffffff-ffff-4fff-bfff-${tail}`
    : 'f'.repeat(id.length - 12) + tail
}
let marker = (family: number, k: number) =>
  Number.MIN_SAFE_INTEGER + 2 * k + family

// Two instants a moment phrase is tested at, apart in every unit a phrase can
// round to: the first in a leap February's overflow, the second mid-May.
let PROBES = [
  +new Date(2024, 2, 31, 13, 14, 15, 678),
  +new Date(2023, 4, 15, 7, 41, 52, 123),
]

// The call this is, and the shape it has; undefined for a call whose ids the
// lowering reads as more than opaque (a human id, a computed row's id).
let called = (ast: And, opts: BindOpts, p: Prepared) => {
  let o = p.opts
  let place = new Map<string, number>(), operands: string[] = []
  let shape = renamed(ast, (id) => {
    let k = place.get(id)
    if (k == null) {
      place.set(id, k = operands.length)
      operands.push(id)
    }
    return `\u0000${k}`
  })
  let backed = Object.values(opts.backed ?? {})
  let virtual = (eid: string) =>
    backed.some((b) => b.tag && idOf(b.tag, eid) != null)
  let roots = o.eids ? [...o.eids] : undefined
  if (operands.some((id) => parse(id) || virtual(id)) || roots?.some(virtual)) {
    return
  }
  let refs = operands.map((id) =>
    o.references && Object.hasOwn(o.references, id)
      ? o.references[id]
      : undefined
  )
  if (refs.some((r) => r != null && !Number.isSafeInteger(r))) return
  // What an id the shape spells out resolves to is part of the shape too.
  let spelled = Object.entries(o.references ?? {})
    .filter(([id]) => !place.has(id))
    .sort(([a], [b]) => a < b ? -1 : 1)
  let ext = opts.extend ?? []
  let key = JSON.stringify([
    shape,
    operands.map((
      id,
      k,
    ) => [
      id.length,
      id.includes('-'),
      refs[k] === undefined ? 0 : refs[k] === null ? 1 : 2,
    ]),
    roots?.map((r) => roots!.indexOf(r)) ?? null,
    spelled,
    o.storageOrder ?? null,
    o.unordered ?? null,
    o.exactIds ?? null,
    o.missingIndexes ?? null,
    o.visibility ?? null,
    opts.absent ?? null,
    opts.population ?? null,
    identify(opts.derived),
    identify(opts.backed),
    ext.map((e) => [
      e.name,
      Object.keys(e.compile).filter((k) =>
        e.compile[k as keyof typeof e.compile]
      ),
      !!e.order,
    ]),
    !!opts.archetypes,
    p.spine ?? null,
  ])
  return {
    key,
    call: { now: o.now!, roots: roots ?? [], operands, refs } as Call,
  }
}

let bound = (k: Kept, call: Call): Raw =>
  raw(
    k.sql,
    k.params.map((p) => typeof p == 'function' ? p(call) : p),
    k.table,
    k.origin,
  )

let iso = (x: Param): number | undefined => {
  if (typeof x != 'string') return
  let ms = Date.parse(x)
  return Number.isFinite(ms) && new Date(ms).toISOString() == x ? ms : undefined
}

type Probe = { out: Raw; call: Call }

// What a parameter is, from its value in each probe: a constant, the clock
// plus an offset, an input, or a JSON array of inputs; undefined when it is
// none of these.
let slot = (
  values: Param[],
  probes: Probe[],
): Param | Bind | undefined => {
  if (values.every((v) => v === values[0])) return values[0]
  if (values.every((v) => typeof v == 'number')) {
    let offsets = values.map((v, i) => (v as number) - probes[i].call.now)
    if (offsets.every((o) => o === offsets[0])) {
      return (call) => call.now + offsets[0]
    }
  }
  let times = values.map(iso)
  if (times.every((t) => t != null)) {
    let offsets = times.map((t, i) => t! - probes[i].call.now)
    if (offsets.every((o) => o === offsets[0])) {
      return (call) => new Date(call.now + offsets[0]).toISOString()
    }
  }
  let input = (i: number) => (v: unknown): Bind | undefined => {
    let { call } = probes[i]
    let k = call.operands.indexOf(v as string)
    if (k >= 0 && typeof v == 'string') return (c) => c.operands[k]
    k = call.roots.indexOf(v as string)
    if (k >= 0 && typeof v == 'string') return (c) => c.roots[k]
    k = call.refs.indexOf(v as number)
    if (k >= 0 && typeof v == 'number') return (c) => c.refs[k] ?? null
  }
  let reads = (v: Param, i: number): string | undefined => {
    let one = input(i)(v)
    if (one) return String(one(probes[0].call))
    if (typeof v != 'string' || !v.startsWith('[')) return
    let items: unknown
    try {
      items = JSON.parse(v)
    } catch {
      return
    }
    if (!Array.isArray(items)) return
    let binds = items.map(input(i))
    if (binds.some((b) => !b) || JSON.stringify(items) != v) return
    return JSON.stringify(binds.map((b) => b!(probes[0].call)))
  }
  // Read in the first probe's terms, each probe's value must say the same.
  let said = values.map(reads)
  if (said.some((s) => s == null || s != said[0])) return
  let one = input(0)(values[0])
  if (one) return one
  let binds = (JSON.parse(values[0] as string) as unknown[]).map(input(0))
  return (call) => JSON.stringify(binds.map((b) => b!(call)))
}

let same = (a: Raw, b: Raw) =>
  a.sql == b.sql && a.params.length == b.params.length &&
  a.params.every((p, i) =>
    p === b.params[i] ||
    p instanceof Uint8Array && b.params[i] instanceof Uint8Array &&
      String(p) == String(b.params[i])
  )

// The shape's statement with its values located, proved as the comment at the
// top says; null when it cannot be. `ast` and `opts` are the call asking now,
// whose ids may differ from the seen call's: the stand-ins replace its own ids
// at their places, which the shape makes the seen call's places too.
let proven = (
  ast: And,
  vocab: Vocab,
  opts: BindOpts,
  seen: Seen,
  asking: Call,
): Kept | null => {
  let { call } = seen
  let probes: Probe[] = []
  for (let [family, now] of PROBES.entries()) {
    let asked: Asked[] = [], touched = { any: false }
    let operands = call.operands.map((id, k) => stand(id, family, k))
    let roots = call.roots.map((r) =>
      stand('-', family, call.roots.indexOf(r) + call.operands.length)
    )
    let refs = call.refs.map((r, k) =>
      r === undefined || r === null ? r : marker(family, k)
    )
    let references = opts.references && { ...opts.references }
    if (references) {
      for (let id of asking.operands) delete references[id]
      call.operands.forEach((_, k) => {
        if (refs[k] !== undefined) references![operands[k]] = refs[k]!
      })
    }
    let out = within(touched, () =>
      render(
        prepared(
          renamed(ast, (id) => operands[asking.operands.indexOf(id)]),
          vocab,
          { ...opts, now, eids: opts.eids && roots, references },
          undefined,
          undefined,
          undefined,
          {
            archetypes: recorded(opts.archetypes, asked),
            extend: watched(opts.extend, false),
          },
        ).lower(),
      ))
    if (touched.any || !agree(asked, seen.asked) || out.sql != seen.first.sql) {
      return null
    }
    probes.push({ out, call: { now, roots, operands, refs } })
  }
  let n = seen.first.params.length
  if (probes.some((p) => p.out.params.length != n)) return null
  let params: (Param | Bind)[] = []
  for (let i = 0; i < n; i++) {
    let s = slot(probes.map((p) => p.out.params[i]), probes)
    if (s === undefined) return null
    params.push(s)
  }
  let { first } = seen
  let kept: Kept = {
    sql: first.sql,
    params,
    table: first.table,
    origin: first.origin,
    asked: seen.asked,
  }
  // The first call again, from the kept statement.
  return same(bound(kept, call), first) ? kept : null
}

/**
 * Compile an AST against a vocabulary into SQL plus parameters, as
 * `render(bind(ast, vocab, opts))` would. `opts.derived` supplies
 * computed-property expressions, `opts.extend` registers other packages'
 * clause compilers, and `opts.now` fixes the moment a relative time phrase
 * resolves against. Throws `Unsupported` for a clause outside the common path
 * that no extension claims. A shape asked again binds its new values into the
 * statement it lowered to before.
 *
 * ```ts
 * import { compile } from '@yaks/sql'
 * import { and, eq, time, le } from '@yaks/query'
 * import { equal } from '@yaks/testing'
 * import { loadVocab } from '@yaks/vocab'
 *
 * let vocab = loadVocab({
 *   $defs: {
 *     run: {
 *       component: true,
 *       properties: { next: { type: 'string', format: 'date-time' } },
 *     },
 *   },
 * })
 * let due = and(le('run.next', time('now')))
 * let [a, b, c] = [1e12, 2e12, 3e12].map((now) => compile(due, vocab, { now }))
 * equal(c.sql, a.sql)
 * equal(c.params.at(-1), new Date(3e12).toISOString())
 * equal(b.params.at(-1), new Date(2e12).toISOString())
 * ```
 */
export let compile = (
  ast: And,
  vocab: Vocab,
  opts: BindOpts = {},
): Raw => {
  let asked: Asked[] = [], touched = { any: false }
  let p = within(
    touched,
    () =>
      prepared(ast, vocab, opts, undefined, undefined, undefined, {
        archetypes: recorded(opts.archetypes, asked),
        extend: watched(opts.extend, true),
      }),
  )
  let lowered = () => within(touched, () => render(p.lower()))
  let shaped = called(ast, opts, p)
  if (!shaped) return lowered()
  let { key, call } = shaped
  let s = shelf(vocab), held = s.get(key)
  if (held === null) return lowered()
  if (held && 'sql' in held && stands(held.asked, opts.archetypes)) {
    put(s, key, held)
    return bound(held, call)
  }
  // Seen once, under a catalog that still answers as it did: prove it.
  if (held && 'first' in held && stands(held.asked, opts.archetypes)) {
    let kept = proven(ast, vocab, opts, held, call)
    put(s, key, kept)
    return kept ? bound(kept, call) : lowered()
  }
  let first = lowered()
  put(s, key, touched.any ? null : { first, call, asked })
  return first
}
