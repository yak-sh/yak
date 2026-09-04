// The runtime. `loadVocab(docs)` reads one or more JSON Schema vocab documents
// into an in-memory `Vocab` and exposes the interrogation + routing API a binder
// (@yaks/sql) consumes: what a column IS, how a dotted path routes to
// {comp, prop} hops, the derived kindOrder and the kind an entity carries, and
// whether an instance is well-formed. It is a GENERALIZATION of what the fleet's
// hand-generated src/types.ts + src/query.ts answer over the one hardcoded
// vocabulary — the same questions, over a LOADED instance, parameterized.
//
// A vocab ships zero components: the fleet's ~90 comps are an instance it loads,
// and a customer app is a smaller instance in the same format.

import type {
  Column,
  CompInfo,
  Death,
  Hop,
  PropSchema,
  Scalar,
  VocabDoc,
} from './types.ts'
import { kindOrder as deriveKindOrder } from './order.ts'

// One property schema → the column it describes. The scalar spelling is
// reconstructed from native JSON Schema (`type` + `format` + `store`), so a
// vocab authored in plain JSON Schema round-trips to the fleet's tiny type set.
let scalarOf = (s: PropSchema): Scalar => {
  if (s.type == 'boolean') return 'bool'
  if (s.type == 'number' || s.type == 'integer') {
    return s.format == 'priority' ? 'priority' : 'number'
  }
  if (s.store == 'blob') return 'body'
  if (s.format == 'date-time') return 'time'
  if (s.format == 'uri') return 'url'
  if (s.format == 'query') return 'query'
  return 'text'
}

let affinityOf = (
  category: Column['category'],
  scalar: Scalar | undefined,
): Column['affinity'] =>
  category == 'ref' || scalar == 'bool'
    ? 'integer'
    : scalar == 'number' || scalar == 'priority'
    ? 'real'
    : 'text'

// A death word, narrowed honestly — anything outside the four is undefined
// here and refused by the storable check.
let deathOf = (s?: string): Death | undefined =>
  s == 'cascade' || s == 'detach' || s == 'release' || s == 'keep'
    ? s
    : undefined

let columnOf = (comp: string, prop: string, s: PropSchema): Column => {
  let category: Column['category'] = s.ref != null
    ? 'ref'
    : s.enum != null
    ? 'enum'
    : 'scalar'
  let scalar = category == 'scalar' ? scalarOf(s) : undefined
  let death = deathOf(s.death)
  return {
    comp,
    prop,
    category,
    scalar,
    values: s.enum ? [...s.enum] : undefined,
    aliases: s.aliases,
    ref: s.ref,
    death,
    stamped: !!s.stamped,
    persist: s.persist !== false,
    store: s.store == 'blob' ? 'blob' : undefined,
    affinity: affinityOf(category, scalar),
    // A reference carries an FK to entity(id) unless its death is 'keep' — a
    // kept ref outlives its target's tombstone, so it stays FK-free (ddl.ts).
    fk: category == 'ref' && death != 'keep',
  }
}

// The interrogation surface. Every method answers over the loaded instance;
// none reads a global.
export type Vocab = {
  docs: VocabDoc[]
  comps: string[] // wire-writable component names, alphabetical
  all: string[] // every declared component name, alphabetical
  kinds: string[] // kindOrder: alphabetical, refined by `before`, topo-sorted
  comp: (name: string) => CompInfo | undefined
  columns: (comp: string) => string[] // readable columns (writable ∪ stamped)
  column: (comp: string, prop: string) => Column | undefined
  route: (prop: string) => { comp: string; prop: string }
  aim: (path: string) => Hop[]
  kindOf: (has: Record<string, unknown>) => string
  deaths: (word: Death) => [string, string][]
  refCols: () => [string, string][]
  check: (
    comp: string,
    value: Record<string, unknown>,
    opts?: { stamped?: boolean },
  ) => string[]
}

// A component's whole shape in one line, for a refusal that teaches: `doc has
// title (text), body (body)`. A refusal naming only what it failed to parse
// teaches nothing.
let shapeOf = (v: Vocab, comp: string): string => {
  let cols = v.columns(comp)
  if (!cols.length) return `${comp} has no columns`
  let said = cols.map((p) => {
    let c = v.column(comp, p)!
    let t = c.category == 'enum'
      ? c.values!.join('|')
      : c.category == 'ref'
      ? 'eid'
      : c.scalar
    return `${p} (${t})`
  })
  return `${comp} has ${said.join(', ')}`
}

export let loadVocab = (input: VocabDoc | VocabDoc[]): Vocab => {
  let docs = Array.isArray(input) ? input : [input]
  // Merge every doc's $defs into one component table; a name declared twice is a
  // conflict (a word has one home).
  let defs: Record<string, PropSchema> = {}
  for (let doc of docs) {
    for (let [name, schema] of Object.entries(doc.$defs ?? {})) {
      if (name in defs) throw new Error(`component '${name}' is declared twice`)
      defs[name] = schema
    }
  }

  let props = (name: string): Record<string, PropSchema> =>
    defs[name]?.properties ?? {}
  let cols = new Map<string, Column>() // `${comp}.${prop}` → Column
  let colFor = (comp: string, prop: string): Column | undefined => {
    let key = `${comp}.${prop}`
    if (cols.has(key)) return cols.get(key)
    let s = props(comp)[prop]
    if (!s) return undefined
    let c = columnOf(comp, prop, s)
    cols.set(key, c)
    return c
  }

  let names = Object.keys(defs).sort()
  let wire = (name: string) => defs[name].wire !== false
  let compNames = names.filter(wire)

  let infoOf = (name: string): CompInfo | undefined => {
    let d = defs[name]
    if (!d) return undefined
    let entries = Object.keys(props(name))
    return {
      name,
      wire: d.wire !== false,
      kind: !!d.kind,
      before: d.before ?? [],
      // A computed column (persist: false) is readable, never writable — like a
      // stamped one, but with no storage either.
      writable: entries.filter((p) => {
        let s = props(name)[p]
        return !s.stamped && s.persist !== false
      }),
      stamped: entries.filter((p) => props(name)[p].stamped),
      prefix: d.prefix,
      byName: d.by_name,
    }
  }

  // The readable routing table: every component to its readable columns. A tag
  // component routes with an empty list (`.about!` is a presence test).
  let routes = new Map<string, string[]>()
  for (let name of names) routes.set(name, Object.keys(props(name)))

  // Reverse index: a bare prop to the components that declare it. A column (or
  // whole component) marked `bare: false` never claims a bare spelling — it is
  // reached qualified only — so it stays out of this index entirely.
  let owners = new Map<string, string[]>()
  for (let [comp, ps] of routes) {
    if (defs[comp].bare === false) continue
    for (let p of ps) {
      if (props(comp)[p].bare === false) continue
      owners.set(p, [...(owners.get(p) ?? []), comp])
    }
  }

  let kinds = deriveKindOrder(
    names.filter((n) => defs[n].kind),
    (k) => defs[k].before ?? [],
  )

  let v: Vocab = {
    docs,
    comps: compNames,
    all: names,
    kinds,
    comp: infoOf,
    columns: (comp) => routes.get(comp) ?? [],
    column: colFor,
    // Bare prop → its owning component. A stamped lifecycle column never steals
    // a bare spelling from a live one (`.status` stays the task's even though
    // sessions carry a stamped status), so non-stamped owners are preferred
    // first. A unique owner wins; several owners that are all references are one
    // read concept (comp '' — the filter scans every owner); any other collision
    // is ambiguous and names the candidates. A bare word that is itself a
    // component name routes as that facet (presence).
    route: (prop) => {
      let own = owners.get(prop) ?? []
      if (own.length > 1) {
        let live = own.filter((c) => !colFor(c, prop)!.stamped)
        if (live.length) own = live
      }
      if (own.length == 1) return { comp: own[0], prop }
      if (own.length > 1) {
        if (own.every((c) => colFor(c, prop)?.category == 'ref')) {
          return { comp: '', prop }
        }
        throw new Error(
          `.${prop} is ambiguous (${own.join(', ')}) — use .${own[0]}.${prop}`,
        )
      }
      if (routes.has(prop)) return { comp: prop, prop: '' }
      throw new Error(`unknown prop: .${prop}`)
    },
    // A dotted path → the hops it names, one rule per step: a segment naming a
    // COMPONENT with another segment behind it is the explicit `comp.prop`
    // spelling and eats two; anything else is a bare prop routed by name and
    // eats one. Every non-final hop must be a reference for the deref to stand.
    aim: (path) => {
      let segs = path.split('.')
      let out: Hop[] = []
      for (let i = 0; i < segs.length;) {
        let own = routes.get(segs[i])
        if (own && i + 1 < segs.length) {
          let [a, b] = [segs[i], segs[i + 1]]
          if (!own.includes(b)) {
            throw new Error(`no such prop: .${a}.${b} — ${shapeOf(v, a)}`)
          }
          out.push({ comp: a, prop: b })
          i += 2
        } else {
          out.push(v.route(segs[i]))
          i += 1
        }
      }
      return out
    },
    // The most specific kind an entity carries names it — first present in
    // kindOrder, else the bare spine.
    kindOf: (has) => kinds.find((k) => has[k]) ?? 'entity',
    // The reaper's worklist: every WIRE-WRITABLE reference wearing a death word,
    // as (comp, col) pairs. Stamped refs stay out — server rows die by server
    // code, not the wire's cascade (types.ts deaths()).
    deaths: (word) =>
      compNames.flatMap((comp) =>
        infoOf(comp)!.writable.flatMap((p) => {
          let c = colFor(comp, p)!
          return c.category == 'ref' && c.death == word
            ? [[comp, p] as [string, string]]
            : []
        })
      ),
    // Every reference column, wire-writable OR stamped — index derivation and
    // reverse-hop grammar key off this one list.
    refCols: () =>
      names.flatMap((comp) =>
        Object.keys(props(comp)).flatMap((p) => {
          let c = colFor(comp, p)!
          return c.category == 'ref' ? [[comp, p] as [string, string]] : []
        })
      ),
    // Ordinary well-formedness of an instance: a known component, an object of
    // known columns (wire-writable unless stamped is allowed), each value a
    // scalar the column can hold — no nesting or arrays a table cannot lower.
    check: (comp, value, opts) => {
      let errs: string[] = []
      let info = infoOf(comp)
      if (!info) return [`unknown component '${comp}'`]
      if (value == null || typeof value != 'object' || Array.isArray(value)) {
        return [`${comp} is an object of columns`]
      }
      let allowed = new Set(opts?.stamped ? v.columns(comp) : info.writable)
      for (let [k, val] of Object.entries(value)) {
        if (!allowed.has(k)) {
          errs.push(`no such column ${comp}.${k} — ${shapeOf(v, comp)}`)
          continue
        }
        if (val == null) continue // a null clears the column
        let c = colFor(comp, k)!
        if (typeof val == 'object') {
          errs.push(
            `${comp}.${k} is a scalar, not ${
              Array.isArray(val) ? 'an array' : 'an object'
            }`,
          )
          continue
        }
        if (
          c.category == 'enum' && !c.values!.includes(String(val)) &&
          !(String(val) in (c.aliases ?? {}))
        ) {
          errs.push(`${comp}.${k} is one of ${c.values!.join(', ')}`)
        } else if (
          c.category == 'scalar' &&
          (c.scalar == 'number' || c.scalar == 'priority') &&
          typeof val != 'number'
        ) {
          errs.push(`${comp}.${k} is a number`)
        } else if (
          c.category == 'scalar' && c.scalar == 'bool' &&
          typeof val != 'boolean' && val !== 0 && val !== 1
        ) {
          errs.push(`${comp}.${k} is a bool`)
        }
      }
      return errs
    },
  }
  return v
}
